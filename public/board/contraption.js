// The Starlight Catcher v2 — a Rube Goldberg machine that tours the whole village loop.
// Contract v2 (docs/protocol.md):
//   createCatcher({ scene, anchor, stages, layout, textures, images, deckHeight })
//   -> { group, update(dt,t), reset(), play({caught,perfect,onStage,onCue}) -> Promise, bridgeSlots, cameraPath,
//        basketWorldPos, stages, duration }
// Stages sit at layout.CATCHER_STAGES anchors and are joined by conduits laid beside the route with pointAt():
// bell -rope-> net -zip line-> bucket -chute-> tub -pipe-> vine (beanstalk) -> drop -steps+gutter-> apple
// -jump-> seesaw/pup -flight-> washtub -rill-> music -staff wire-> bridge lamppost -> basket.
// Everything lives in world space under `group` (identity transform). Every scripted motion is a pure function of
// the show clock (pose(t)), so play, scrubbing and the reverse flourish in reset() share one code path.
// Procedural geometry only; textures are optional (flat pastel colours otherwise).
import * as THREE from 'three';
import gsap from 'gsap';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const C = {
  peri: 0x6E8FE0, lav: 0xB48BE0, pink: 0xF29BC8, cream: 0xFFF6E0, mint: 0xA8E0B8, gold: 0xF2C14E,
  sky: 0xBFE3F5, stone: 0xC9B9A3, wood: 0x8B5E3C, roof: 0x3E6FD6, fmn: 0x5B8DEF, green: 0x7FB069,
  purple: 0x5E3A8C, ink: 0x2B2440, red: 0xE5484D, pup: 0xF2B544, terracotta: 0xE0895A,
};
const ORDER = ['bell', 'net', 'bucket', 'tub', 'pipe', 'vine', 'drop', 'apple', 'pup', 'music', 'basket'];

// ---------------------------------------------------------------- small math helpers
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const seg = (t, a, b) => clamp01((t - a) / Math.max(1e-6, b - a));
const easeIn = (k) => k * k;
const easeIn3 = (k) => k * k * k;
const easeOut = (k) => 1 - (1 - k) * (1 - k);
const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const sineInOut = (k) => 0.5 - 0.5 * Math.cos(Math.PI * k);
const sineOut = (k) => Math.sin((k * Math.PI) / 2);
const backOut = (k, s = 1.9) => { const c = s + 1; return 1 + c * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2); };
const elasticOut = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : Math.pow(2, -10 * k) * Math.sin((k * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1);
const damped = (t, amp, freq, decay) => (t <= 0 ? 0 : amp * Math.sin(t * freq) * Math.exp(-t * decay));
const hop = (k, h) => 4 * h * k * (1 - k);
// piecewise track: keys [[time, value, easeFn?], ...]; the ease applies to the segment that ENDS at that key
function track(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e] = keys[i];
    if (t <= t1) { const [t0, v0] = keys[i - 1]; const k = (t - t0) / Math.max(1e-6, t1 - t0); return v0 + (v1 - v0) * (e ? e(k) : k); }
  }
  return keys[keys.length - 1][1];
}
// time <-> arc length for a speed profile v(s) along a curve of length len
function speedTable(len, vFn, n = 320) {
  const ts = [0], ss = [0]; let t = 0;
  for (let i = 1; i <= n; i++) { const s0 = ((i - 1) / n) * len, s1 = (i / n) * len; t += (s1 - s0) / Math.max(0.05, vFn((s0 + s1) / 2)); ts.push(t); ss.push(s1); }
  return {
    dur: t, len,
    sAt(tau) {
      if (tau <= 0) return 0; if (tau >= t) return len;
      let lo = 0, hi = n; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] < tau) lo = m; else hi = m; }
      return ss[lo] + ((ss[hi] - ss[lo]) * (tau - ts[lo])) / (ts[hi] - ts[lo]);
    },
    tAt(s) { const i = Math.min(n, Math.max(0, Math.round((s / len) * n))); return ts[i]; },
  };
}

// ---------------------------------------------------------------- materials (book pastels + ink outline)
let gradientMap = null;
function getGradient() {
  if (gradientMap) return gradientMap;
  const d = new Uint8Array([150, 205, 245, 255]);
  gradientMap = new THREE.DataTexture(d, d.length, 1, THREE.RedFormat);
  gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.generateMipmaps = false; gradientMap.needsUpdate = true;
  return gradientMap;
}
const matCache = new Map();
function toon(color, o = {}) {
  const key = JSON.stringify([color, o.emissive || 0, o.ei || 0, o.side || 0, o.opacity || 1, o.map ? o.map.uuid : 0, !!o.vc, o.alphaTest || 0]);
  if (!o.unique && matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshToonMaterial({
    color, gradientMap: getGradient(), emissive: o.emissive ?? 0x000000, emissiveIntensity: o.ei ?? 1,
    side: o.side ?? THREE.FrontSide, transparent: (o.opacity ?? 1) < 1 || !!o.transparent, opacity: o.opacity ?? 1,
    map: o.map || null, vertexColors: !!o.vc, alphaTest: o.alphaTest ?? 0,
  });
  if (o.opacity < 1) m.depthWrite = !!o.depthWrite;
  if (!o.unique) matCache.set(key, m);
  return m;
}
const outlineMats = new Map();
function outlineMat(th) {
  if (outlineMats.has(th)) return outlineMats.get(th);
  const m = new THREE.MeshBasicMaterial({ color: C.ink, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n transformed += normalize(normal) * ${th.toFixed(4)};`);
  };
  m.customProgramCacheKey = () => 'ol' + th;
  outlineMats.set(th, m);
  return m;
}
// inverted-hull ink outline: a back-face copy pushed out along normals (child, identity transform)
function ol(m, th = 0.025) {
  const o = new THREE.Mesh(m.geometry, outlineMat(th));
  o.castShadow = false; o.receiveShadow = false; o.name = 'outline';
  if (m.isInstancedMesh) return m;
  m.add(o); return m;
}
function mesh(geo, mat, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s, outline = 0.025, shadow = true, parent } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  if (s !== undefined) { if (typeof s === 'number') m.scale.setScalar(s); else m.scale.set(s[0], s[1], s[2]); }
  m.castShadow = shadow; m.receiveShadow = true;
  if (outline) ol(m, outline);
  if (parent) parent.add(m);
  return m;
}
const rbox = (w, h, d, r = 0.06) => new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2.01, h / 2.01, d / 2.01));
const cyl = (rt, rb, h, seg2 = 16, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg2, 1, open);
const sph = (r, ws = 16, hs = 12) => new THREE.SphereGeometry(r, ws, hs);

// ---------------------------------------------------------------- canvas textures (procedural)
function canvasTex(w, h, draw, { repeat, srgb = true } = {}) {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = 4;
  return t;
}
function glowTex() {
  return canvasTex(128, 128, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  }, { srgb: false });
}
function starTex() {
  return canvasTex(128, 128, (g, w) => {
    const c = w / 2;
    const gr = g.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
    g.fillStyle = '#fff'; g.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 - Math.PI / 2; const r = i % 2 ? 9 : 60; g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); }
    g.closePath(); g.fill();
  }, { srgb: false });
}
function wickerTex() {
  // over-under basket weave: wide golden weavers, thin darker stakes, see-through gaps
  return canvasTex(256, 256, (g, w) => {
    g.clearRect(0, 0, w, w);
    const rows = 4, cols = 4, rh = w / rows, cw = w / cols;
    g.lineCap = 'round';
    for (let c = 0; c <= cols; c++) { const x = c * cw; g.fillStyle = '#2B2440'; g.fillRect(x - 7, 0, 14, w); g.fillStyle = '#9C6431'; g.fillRect(x - 4, 0, 8, w); }
    for (let r = 0; r < rows; r++) {
      const y = r * rh + rh * 0.5;
      for (let c = 0; c < cols; c++) {
        const over = (r + c) % 2 === 0, x0 = c * cw, x1 = x0 + cw;
        g.strokeStyle = '#2B2440'; g.lineWidth = rh * 0.6; g.beginPath(); g.moveTo(x0 - 2, y); g.lineTo(x1 + 2, y); g.stroke();
        const gr = g.createLinearGradient(0, y - rh * 0.23, 0, y + rh * 0.23);
        const hi = over ? '#F4C985' : '#D9A060', lo = over ? '#C98A45' : '#A86D35';
        gr.addColorStop(0, lo); gr.addColorStop(0.35, hi); gr.addColorStop(1, lo);
        g.strokeStyle = gr; g.lineWidth = rh * 0.46; g.beginPath(); g.moveTo(x0 - 1, y); g.lineTo(x1 + 1, y); g.stroke();
        if (!over) { g.fillStyle = '#2B2440'; g.fillRect(x0 + cw / 2 - 6, y - rh * 0.3, 12, rh * 0.6); g.fillStyle = '#B07238'; g.fillRect(x0 + cw / 2 - 3, y - rh * 0.3, 6, rh * 0.6); }
        g.fillStyle = 'rgba(255,248,225,0.55)'; g.fillRect(x0 + 8, y - rh * 0.16, cw - 16, 4);
      }
    }
  }, { repeat: [11, 3.5] });
}
function sheetTex() {
  return canvasTex(256, 192, (g, w, h) => {
    g.fillStyle = '#FFF6E0'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2B2440'; g.lineWidth = 3; g.strokeRect(3, 3, w - 6, h - 6);
    g.lineWidth = 2;
    for (let s = 0; s < 2; s++) for (let i = 0; i < 5; i++) { const y = 40 + s * 80 + i * 9; g.beginPath(); g.moveTo(16, y); g.lineTo(w - 16, y); g.stroke(); }
    const cols = ['#F29BC8', '#6E8FE0', '#B48BE0', '#F2C14E'];
    for (let k = 0; k < 9; k++) {
      const x = 40 + k * 23, y = 44 + (k % 2) * 80 + ((k * 7) % 5) * 5;
      g.fillStyle = cols[k % 4]; g.beginPath(); g.ellipse(x, y, 7, 5, -0.4, 0, Math.PI * 2); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(x + 6, y - 2); g.lineTo(x + 6, y - 26); g.stroke();
    }
  });
}
// music note glyph (pastel fill, ink outline, soft glow)
function noteTex(fill, kind) {
  return canvasTex(128, 128, (g, w) => {
    const glow = g.createRadialGradient(64, 70, 4, 64, 70, 62);
    glow.addColorStop(0, 'rgba(255,255,255,0.75)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glow; g.fillRect(0, 0, w, w);
    g.lineJoin = 'round'; g.lineCap = 'round';
    const path = () => {
      g.beginPath();
      if (kind === 0) {
        g.ellipse(48, 92, 17, 12, -0.45, 0, Math.PI * 2); g.moveTo(62, 88); g.rect(60, 26, 7, 64);
        g.moveTo(66, 26); g.bezierCurveTo(90, 38, 98, 52, 86, 70); g.bezierCurveTo(88, 56, 80, 48, 66, 46); g.closePath();
      } else if (kind === 1) {
        g.ellipse(34, 96, 15, 11, -0.45, 0, Math.PI * 2); g.ellipse(88, 86, 15, 11, -0.45, 0, Math.PI * 2);
        g.rect(44, 34, 6, 60); g.rect(98, 24, 6, 60);
        g.moveTo(44, 34); g.lineTo(104, 22); g.lineTo(104, 36); g.lineTo(44, 48); g.closePath();
      } else {
        g.moveTo(52, 104); g.bezierCurveTo(20, 84, 30, 62, 50, 74); g.bezierCurveTo(66, 60, 82, 82, 52, 104); g.rect(66, 24, 7, 62);
      }
    };
    path(); g.fillStyle = fill; g.fill('nonzero'); g.strokeStyle = '#2B2440'; g.lineWidth = 6; g.stroke(); path(); g.fill('nonzero');
  });
}

// ---------------------------------------------------------------- small geometry builders
function colorize(geo, color) {
  const c = new THREE.Color(color); const n = geo.attributes.position.count; const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo;
}
function clean(geo) { for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'color'].includes(k)) geo.deleteAttribute(k); return geo.index ? geo.toNonIndexed() : geo; }
// a five-petal forget-me-not (or blossom) as one vertex-coloured solid facing +Z
function flowerGeo(petal, center = C.gold, size = 0.11) {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const p = new THREE.SphereGeometry(size * 0.62, 5, 2); p.scale(1, 1, 0.42); p.translate(Math.cos(a) * size * 0.7, Math.sin(a) * size * 0.7, 0);
    parts.push(colorize(clean(p), petal));
  }
  const c = new THREE.SphereGeometry(size * 0.38, 5, 3); c.scale(1, 1, 0.6); c.translate(0, 0, size * 0.18);
  parts.push(colorize(clean(c), center));
  const g = mergeGeometries(parts); g.computeBoundingSphere(); return g;
}
function leafGeo(len = 0.3, wid = 0.13) {
  const s = new THREE.Shape(); s.moveTo(0, 0);
  s.quadraticCurveTo(wid, len * 0.45, 0, len); s.quadraticCurveTo(-wid, len * 0.45, 0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false, curveSegments: 5 });
  g.translate(0, 0, -0.01); g.deleteAttribute('uv'); return g;
}
function heartShape(s = 1) {
  const h = new THREE.Shape(); h.moveTo(0, -0.5 * s);
  h.bezierCurveTo(-0.15 * s, -0.35 * s, -0.55 * s, -0.05 * s, -0.5 * s, 0.22 * s);
  h.bezierCurveTo(-0.45 * s, 0.5 * s, -0.08 * s, 0.52 * s, 0, 0.25 * s);
  h.bezierCurveTo(0.08 * s, 0.52 * s, 0.45 * s, 0.5 * s, 0.5 * s, 0.22 * s);
  h.bezierCurveTo(0.55 * s, -0.05 * s, 0.15 * s, -0.35 * s, 0, -0.5 * s);
  return h;
}
// Ring frames along a point list. frames 'pt' = parallel transport (loops are safe), 'up' = keep N near world-up
// (open troughs stay open to the sky). Ring angle 0 = N, PI/2 = B = T x N. Writes into pos/nor arrays.
const _T = V(), _N = V(), _B = V(), _Tp = V(), _ax = V(), _q = new THREE.Quaternion();
function fillRings(pts, pos, nor, { radius = 0.1, radial = 8, rFn = null, a0 = 0, a1 = Math.PI * 2, frames = 'pt' }) {
  const n = pts.length - 1;
  for (let i = 0; i <= n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n, i + 1)];
    _T.subVectors(b, a); if (_T.lengthSq() < 1e-12) _T.set(1, 0, 0); _T.normalize();
    if (frames === 'up' || i === 0) {
      _N.copy(UP).addScaledVector(_T, -_T.y); if (_N.lengthSq() < 1e-6) _N.set(1, 0, 0).addScaledVector(_T, -_T.x); _N.normalize();
    } else {
      _ax.crossVectors(_Tp, _T); const s = _ax.length();
      if (s > 1e-7) { _q.setFromAxisAngle(_ax.multiplyScalar(1 / s), Math.atan2(s, _Tp.dot(_T))); _N.applyQuaternion(_q); }
      _N.addScaledVector(_T, -_T.dot(_N)).normalize();
    }
    _B.crossVectors(_T, _N); _Tp.copy(_T);
    const r = rFn ? rFn(i / n) : radius;
    for (let j = 0; j <= radial; j++) {
      const ang = a0 + (a1 - a0) * (j / radial), c = Math.cos(ang), s2 = Math.sin(ang);
      const nx = _N.x * c + _B.x * s2, ny = _N.y * c + _B.y * s2, nz = _N.z * c + _B.z * s2;
      const k = (i * (radial + 1) + j) * 3;
      nor[k] = nx; nor[k + 1] = ny; nor[k + 2] = nz;
      pos[k] = pts[i].x + nx * r; pos[k + 1] = pts[i].y + ny * r; pos[k + 2] = pts[i].z + nz * r;
    }
  }
}
function tubeIndex(n, radial) {
  const idx = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = (i + 1) * (radial + 1) + j, c = (i + 1) * (radial + 1) + j + 1, d = i * (radial + 1) + j + 1;
    idx.push(a, d, b, b, d, c);
  }
  return idx;
}
function tubeGeo(pts, opts = {}) {
  const radial = opts.radial || 8, n = pts.length - 1;
  const pos = new Float32Array((n + 1) * (radial + 1) * 3), nor = new Float32Array(pos.length);
  fillRings(pts, pos, nor, { ...opts, radial });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(tubeIndex(n, radial));
  g.userData.segTris = radial * 6; g.userData.segs = n;
  g.computeBoundingSphere(); return g;
}
// a rope whose points are rewritten every frame (ropes, tie lines)
class Strand {
  constructor(parent, n, { radius = 0.03, radial = 5, mat, outline = 0.012 } = {}) {
    this.n = n; this.radial = radial; this.radius = radius;
    this.pts = Array.from({ length: n + 1 }, () => V());
    const count = (n + 1) * (radial + 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(tubeIndex(n, radial));
    this.geo = g; this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.castShadow = true;
    if (outline) ol(this.mesh, outline);
    parent.add(this.mesh);
  }
  commit() {
    fillRings(this.pts, this.geo.attributes.position.array, this.geo.attributes.normal.array, { radius: this.radius, radial: this.radial, frames: 'up' });
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.normal.needsUpdate = true;
  }
  set visible(v) { this.mesh.visible = v; }
}

// Merge the static meshes under `container` into one mesh per material (fewer draw calls).
// Anything in `keep` (and everything below it) is left alone so it can still animate.
function bake(container, keep = []) {
  const keepSet = new Set(keep);
  container.updateMatrixWorld(true);
  const inv = container.matrixWorld.clone().invert();
  const buckets = new Map(), victims = [];
  const isKept = (o) => { for (let p = o; p && p !== container; p = p.parent) if (keepSet.has(p)) return true; return false; };
  container.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSprite || o.isPoints || isKept(o) || o.userData.noBake) return;
    const mat = o.material; if (Array.isArray(mat)) return;
    if (o.matrixWorld.determinant() < 0) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!(mat.map) && g.attributes.uv) g.deleteAttribute('uv');
    if (mat.map && !g.attributes.uv) return;
    if (!mat.vertexColors && g.attributes.color) g.deleteAttribute('color');
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const b = buckets.get(mat) || { geos: [], cast: false }; b.geos.push(g); b.cast = b.cast || o.castShadow; buckets.set(mat, b);
    victims.push(o);
  });
  for (const o of victims) if (o.parent) o.parent.remove(o);
  for (const [mat, b] of buckets) {
    const merged = mergeGeometries(b.geos); if (!merged) continue;
    const m = new THREE.Mesh(merged, mat); m.castShadow = b.cast; m.receiveShadow = true; container.add(m);
  }
}

// ---------------------------------------------------------------- particles: bubbles + droplets (instanced, world space)
class Particles {
  constructor(root, { max = 60, geo, mat, gravity = 0, rise = 0 }) {
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false; this.mesh.castShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(this.mesh);
    this.p = []; for (let i = 0; i < max; i++) this.p.push({ on: false, pos: V(), vel: V(), life: 0, max: 1, size: 0.1, ph: 0 });
    this.gravity = gravity; this.rise = rise; this.cursor = 0; this._m = new THREE.Matrix4();
    this.clear();
  }
  emit(pos, vel, size, life) {
    const q = this.p[this.cursor]; this.cursor = (this.cursor + 1) % this.p.length;
    q.on = true; q.pos.copy(pos); q.vel.copy(vel); q.size = size; q.life = 0; q.max = life; q.ph = Math.random() * 6.28;
  }
  clear() { for (const q of this.p) q.on = false; this.update(0, 0); }
  update(dt, t) {
    const m = this._m; let i = 0;
    for (const q of this.p) {
      let s = 0;
      if (q.on) {
        q.life += dt;
        if (q.life >= q.max) q.on = false;
        else {
          q.vel.y += (this.gravity + this.rise) * dt;
          q.pos.addScaledVector(q.vel, dt);
          if (this.rise) { q.pos.x += Math.sin(t * 3 + q.ph) * dt * 0.15; q.vel.multiplyScalar(1 - dt * 1.5); }
          const k = q.life / q.max;
          s = q.size * (this.rise ? Math.min(1, k * 6) * (k > 0.85 ? (1 - k) / 0.15 : 1) * (0.85 + 0.3 * k) : 1 - k * 0.6);
        }
      }
      m.makeScale(s || 1e-5, s || 1e-5, s || 1e-5); m.setPosition(q.pos);
      this.mesh.setMatrixAt(i++, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- sparkles (twinkling additive points)
function makeSparkles(root, count, tex, { radius = 1, color = 0xFFF1B0, size = 0.35 } = {}) {
  const pos = new Float32Array(count * 3), ph = new Float32Array(count), col = new Float32Array(count * 3);
  const base = [], vel = [];
  const pal = [0xFFF1B0, 0xF29BC8, 0xBFE3F5, 0xB48BE0, 0xffffff, 0xA8E0B8].map((c) => new THREE.Color(c));
  for (let i = 0; i < count; i++) {
    const v = V().randomDirection().multiplyScalar(radius * (0.6 + Math.random() * 0.4));
    base.push(v); vel.push(V().randomDirection().multiplyScalar(1 + Math.random() * 2.5));
    pos.set([v.x, v.y, v.z], i * 3); ph[i] = Math.random() * 100;
    const cc = color === 'rainbow' ? pal[i % pal.length] : new THREE.Color(color);
    col.set([cc.r, cc.g, cc.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSize: { value: size }, uMap: { value: tex }, uAlpha: { value: 1 } },
    vertexShader: `attribute float phase; attribute vec3 color; uniform float uTime; uniform float uSize; varying float vA; varying vec3 vC;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); float tw = 0.5 + 0.5*sin(uTime*3.0 + phase*1.7);
      vA = tw; vC = color; gl_PointSize = uSize * (0.35 + 0.9*tw) * 420.0 / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D uMap; uniform float uAlpha; varying float vA; varying vec3 vC;
      void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb, t.a * uAlpha * (0.35 + 0.65*vA)); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 5;
  root.add(pts);
  return { pts, mat, base, vel, age: 99, strength: 1 };
}
// soft additive glow dots with per-point size (flower halos, tip glows) — one draw call
function makeGlowPoints(root, count, tex, color, alpha = 0.85) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex }, uColor: { value: new THREE.Color(color) }, uAlpha: { value: alpha } },
    vertexShader: `attribute float size; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * 420.0 / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D uMap; uniform vec3 uColor; uniform float uAlpha; void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(uColor * t.rgb, t.a * uAlpha); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 5; root.add(pts);
  return { pts, pos: g.attributes.position, size: g.attributes.size, mat };
}

// ================================================================= createCatcher
export async function createCatcher({ scene, anchor, stages, layout, textures, images, deckHeight = 0.1 } = {}) {
  const L = layout;
  if (!L || typeof L.pointAt !== 'function') throw new Error('[catcher] createCatcher needs { layout } (the public/board/layout.js module)');
  const STG = stages && stages.length ? stages : L.CATCHER_STAGES;
  const byId = {}; for (const s of STG) byId[s.id] = s;
  for (const id of ORDER) if (!byId[id]) throw new Error('[catcher] missing stage anchor: ' + id);
  const TX = textures || {}; const texOf = (k) => (TX[k] && TX[k].isTexture ? TX[k] : null);
  const group = new THREE.Group(); group.name = 'StarlightCatcher';
  const root = group;
  const LOOP = L.LOOP_LENGTH, GH = (x, z) => L.heightAt(x, z);

  // ---------------------------------------------------------------- route helpers
  function rf(d) { const p = L.pointAt(d), a = L.pointAt(d - 0.4), b = L.pointAt(d + 0.4); const t = V(b.x - a.x, 0, b.z - a.z).normalize(); return { x: p.x, z: p.z, t, n: V(-t.z, 0, t.x) }; }
  const R = (d, off = 0, h = 0) => { const f = rf(d); const x = f.x + f.n.x * off, z = f.z + f.n.z * off; return V(x, GH(x, z) + h, z); };
  const RA = (d, off, y) => { const f = rf(d); return V(f.x + f.n.x * off, y, f.z + f.n.z * off); };
  // unwrapped route distance of every stage: bell first, increasing around the loop to the basket
  const D = {};
  { let prev = -Infinity, base = 0; for (const id of ORDER) { let d = L.SPACES[byId[id].near].dist + base; while (d < prev) { base += LOOP; d += LOOP; } D[id] = d; prev = d; } }
  // stage frame: origin at the anchor, X along the route, Z away from the path (toward the stage's side), Y up
  function frame(id) {
    const s = byId[id], sp = L.SPACES[s.near], sg = s.side < 0 ? -1 : 1;
    const t = V(sp.dir[0], 0, sp.dir[1]).normalize().multiplyScalar(sg), n = V(-sp.dir[1], 0, sp.dir[0]).normalize().multiplyScalar(sg);
    const o = V(s.anchor[0], s.anchor[1], s.anchor[2]);
    const g = new THREE.Group(); g.name = 'catcher:' + id; g.position.copy(o);
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(t, UP, n)); root.add(g); g.updateMatrixWorld(true);
    const W = (x, y, z) => o.clone().addScaledVector(t, x).addScaledVector(n, z).add(V(0, y, 0));
    const gy = (x, z) => GH(o.x + t.x * x + n.x * z, o.z + t.z * x + n.z * z) - o.y; // ground height in local y
    return { id, g, o, t, n, sg, d: D[id], W, gy };
  }
  const FB = frame('bell'), FN = frame('net'), FBk = frame('bucket'), FT = frame('tub'), FP = frame('pipe'), FV = frame('vine');
  const FD = frame('drop'), FA = frame('apple'), FPu = frame('pup'), FM = frame('music');
  // the bridge frame: origin = bridge tile (anchor), X along the route, Z toward the inside of the loop
  const BA = anchor ? V(anchor.x, anchor.y, anchor.z) : V(...L.BRIDGE_POS);
  const FBr = (() => {
    const sp = L.SPACES[byId.basket.near]; const t = V(sp.dir[0], 0, sp.dir[1]).normalize(), n = V(-t.z, 0, t.x);
    const g = new THREE.Group(); g.name = 'catcher:basket'; g.position.copy(BA); g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(t, UP, n)); root.add(g); g.updateMatrixWorld(true);
    return { g, o: BA, t, n, W: (x, y, z) => BA.clone().addScaledVector(t, x).addScaledVector(n, z).add(V(0, y, 0)), gy: (x, z) => GH(BA.x + t.x * x + n.x * z, BA.z + t.z * x + n.z * z) - BA.y };
  })();
  const DECK = deckHeight;
  const worldOf = (obj, out = V()) => { obj.updateWorldMatrix(true, false); return obj.getWorldPosition(out); };

  // ---------------------------------------------------------------- materials
  const GLOW = glowTex(), STAR = starTex();
  const halo = (color, size, parent, pos, opacity = 0.9) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.scale.setScalar(size); if (pos) s.position.copy(pos); s.renderOrder = 4; parent.add(s); return s;
  };
  const woodTex = texOf('tex_wood'), stoneTex = texOf('tex_stone') || texOf('tex_cobble');
  const tiled = (t, rx, ry) => { if (!t) return null; const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(rx, ry); c.needsUpdate = true; return c; };
  const M = {
    iron: toon(0x3F5BB5), ironDark: toon(0x2F4590), gold: toon(C.gold, { emissive: 0x6b4a00, ei: 0.35 }),
    wood: woodTex ? toon(0xE8C9A8, { map: tiled(woodTex, 1, 2) }) : toon(0xA8713F), woodPlain: toon(0xB07A48), woodDark: toon(C.wood), plank: toon(0xC98E55),
    stone: stoneTex ? toon(0xF2E6D6, { map: tiled(stoneTex, 1, 1) }) : toon(C.stone), stone2: toon(0xD8C9B2), stone3: toon(0xBBA88E),
    cream: toon(C.cream), pink: toon(C.pink), lav: toon(C.lav), peri: toon(C.peri), mint: toon(C.mint), green: toon(C.green),
    leaf: toon(0x5FA35A, { side: THREE.DoubleSide }), white: toon(0xFFFFFF), ink: toon(C.ink), rope: toon(0xF0DDB0),
    red: toon(C.red, { emissive: 0x5a0a10, ei: 0.25 }), purple: toon(C.purple), water: toon(0x8FD6F2, { emissive: 0x2a7fa8, ei: 0.35 }),
    glass: toon(0xFFF1B8, { emissive: 0xFFC860, ei: 0.9 }), bubble: toon(0xF4FBFF, { emissive: 0xBFE3F5, ei: 0.35, opacity: 0.72 }),
    terracotta: toon(C.terracotta), pipeGlass: toon(0xC4D6FF, { emissive: 0x6E8FE0, ei: 0.35, opacity: 0.48 }),
    trough: toon(0xD29A5E, { side: THREE.DoubleSide }), rail: toon(0xF6D2E2), rillWater: toon(0x9CD8F5, { emissive: 0x3a9fd0, ei: 0.35, side: THREE.DoubleSide }),
    vine: toon(0x6FAE5C), vine2: toon(0x9BD08A), duck: toon(0xFFE45C), beak: toon(0xFF9A3C), soil: toon(0x7A5236),
  };
  const FMN = flowerGeo(C.fmn), BLOSSOM = flowerGeo(C.pink, 0xFFF6E0), LEAF = leafGeo(), BIGLEAF = leafGeo(0.5, 0.22);
  const fmnMat = toon(0xFFFFFF, { vc: true });
  const tuft = (parent, x, y, z, n = 3, geo = FMN) => {
    for (let k = 0; k < n; k++) { const f = mesh(geo, fmnMat, { x: x + Math.cos(k * 2.1) * 0.12, y: y + 0.06, z: z + Math.sin(k * 2.1) * 0.1, rx: -1.2, rz: k, outline: 0, parent }); f.scale.setScalar(0.9 + (k % 2) * 0.2); }
    mesh(LEAF, M.leaf, { x, y, z, rx: -0.9, rz: 0.8, outline: 0, parent }); mesh(LEAF, M.leaf, { x, y, z, rx: -0.9, rz: -0.9, outline: 0, parent });
  };
  const heartG = new THREE.ExtrudeGeometry(heartShape(0.62), { depth: 0.06, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 2, curveSegments: 10 });
  heartG.center();
  // a wooden support post from the ground (+0.25 below) up to world height `top`, with a little cradle
  const postGeo = cyl(0.055, 0.07, 1, 7); postGeo.translate(0, 0.5, 0);
  function post(parent, p, top, mat = M.woodPlain, r = 1) {
    const base = GH(p.x, p.z) - 0.25, h = Math.max(0.05, top - base);
    const m = mesh(postGeo, mat, { parent, outline: 0.012 }); m.position.set(p.x, base, p.z); m.scale.set(r, h, r); return m;
  }
  // a fancy iron lamppost (lantern on top), base buried a little for slopes
  function buildLamp(parent, h, { banner = false, lantern = 0xFFD98A } = {}) {
    mesh(rbox(0.66, 1.0, 0.66, 0.08), M.ironDark, { y: -0.3, parent });
    mesh(cyl(0.19, 0.28, 0.5, 14), M.iron, { y: 0.45, parent });
    mesh(cyl(0.085, 0.11, h - 0.6, 10), M.iron, { y: 0.6 + (h - 0.6) / 2, parent });
    for (const y of [0.95, h * 0.45, h * 0.8]) mesh(new THREE.TorusGeometry(0.12, 0.04, 6, 14), M.gold, { y, rx: Math.PI / 2, parent, outline: 0 });
    mesh(cyl(0.2, 0.12, 0.16, 6), M.ironDark, { y: h + 0.08, parent });
    mesh(cyl(0.2, 0.15, 0.42, 6), M.glass, { y: h + 0.37, parent, outline: 0.02 });
    mesh(new THREE.ConeGeometry(0.3, 0.32, 6), M.iron, { y: h + 0.74, parent });
    mesh(sph(0.07, 10, 8), M.gold, { y: h + 0.95, parent, outline: 0.015 });
    const hl = halo(lantern, 1.5, parent, V(0, h + 0.37, 0), 0.55);
    if (banner) {
      const heart = mesh(heartG, M.pink, { x: 0.38, y: h * 0.62, z: 0.0, outline: 0, parent });
      mesh(heartG, M.ink, { s: [1.13, 1.13, 0.6], z: -0.035, outline: 0, shadow: false, parent: heart });
      mesh(cyl(0.02, 0.02, 0.3, 6), M.gold, { x: 0.15, y: h * 0.62 + 0.33, rz: Math.PI / 2, parent, outline: 0 });
    }
    return hl;
  }
  const statics = []; // groups to bake at the end: [container, keep[]]

  // =========================================================== 1 BELL — riverside lamppost
  const bellLamp = new THREE.Group(); bellLamp.position.set(0.8, FB.gy(0.8, 0.9), 0.9); FB.g.add(bellLamp);
  const BELL_H = 5.0;
  buildLamp(bellLamp, BELL_H, { banner: true });
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0, 4.4, 0), V(-0.25, 4.78, -0.45), V(-0.55, 4.7, -0.85)]), 12, 0.045, 6), M.iron, { parent: bellLamp, outline: 0.015 });
  const pulley = mesh(new THREE.TorusGeometry(0.11, 0.035, 6, 14), M.gold, { x: 0.13, y: 4.0, parent: bellLamp, outline: 0.01 });
  const bellPivot = new THREE.Group(); bellPivot.position.set(-0.55, 4.68, -0.85); bellLamp.add(bellPivot);
  const bellIdle = new THREE.Group(); bellPivot.add(bellIdle);
  const BS = 1.55;
  const bellProfile = [[0.0, -0.06], [0.08, -0.07], [0.13, -0.12], [0.155, -0.24], [0.17, -0.37], [0.22, -0.5], [0.255, -0.56], [0.235, -0.585], [0.16, -0.5], [0.125, -0.3], [0.1, -0.15], [0.0, -0.12]].map(([r, y]) => new THREE.Vector2(r * BS, y * BS)).reverse();
  const bellMat = toon(C.gold, { emissive: 0x9a6a00, ei: 0.4, unique: true });
  mesh(new THREE.LatheGeometry(bellProfile, 20), bellMat, { parent: bellIdle, outline: 0.02 });
  mesh(new THREE.TorusGeometry(0.075, 0.025, 6, 12), M.gold, { y: -0.06, parent: bellIdle, outline: 0.01 });
  mesh(sph(0.08, 10, 8), M.ironDark, { y: -0.82, parent: bellIdle, outline: 0 });
  const bellHalo = halo(0xFFD36A, 1.4, bellIdle, V(0, -0.45, 0.05), 0.5);
  const bellLip = new THREE.Object3D(); bellLip.position.set(0.33, -0.78, 0); bellIdle.add(bellLip);
  statics.push([bellLamp, [bellPivot]]);

  // =========================================================== 2 NET — Grabble's net on a hook, then a zip line
  const netPost = new THREE.Group(); netPost.position.set(0, 0, 0.35); FN.g.add(netPost);
  mesh(rbox(0.55, 0.9, 0.55, 0.06), M.stone3, { y: -0.2, parent: netPost });
  mesh(cyl(0.1, 0.12, 3.75, 10), M.wood, { y: 1.875, parent: netPost });
  mesh(sph(0.15, 12, 8), M.purple, { y: 3.84, parent: netPost, outline: 0.015 });
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0, 3.62, 0), V(0.22, 3.62, 0), V(0.32, 3.5, 0)]), 8, 0.035, 6), M.ironDark, { parent: netPost, outline: 0.012 });
  const pin = new THREE.Group(); pin.position.set(-0.14, 3.45, 0); netPost.add(pin);
  mesh(cyl(0.035, 0.035, 0.3, 8), M.gold, { rz: Math.PI / 2, parent: pin, outline: 0.01 });
  mesh(sph(0.06, 8, 6), M.pink, { x: -0.15, parent: pin, outline: 0.01 });
  statics.push([netPost, [pin]]);
  const PIN_W = FN.W(-0.29, 3.45, 0.35);

  // =========================================================== 3 BUCKET — Puddle Paws bucket on a little table
  const TBL = 1.5, BKS = 1.15, BKX = -0.12;
  const table = new THREE.Group(); table.position.set(0, 0, 0.3); FBk.g.add(table);
  mesh(rbox(1.0, 0.1, 0.9, 0.04), M.plank, { y: TBL - 0.05, parent: table });
  for (const [lx, lz] of [[-0.4, -0.34], [0.4, -0.34], [-0.4, 0.34], [0.4, 0.34]]) mesh(cyl(0.045, 0.05, TBL + 0.3, 6), M.woodDark, { x: lx, y: (TBL - 0.3) / 2, z: lz, parent: table, outline: 0.01 });
  tuft(table, -0.55, FBk.gy(-0.55, 0.3), -0.2, 3, BLOSSOM);
  // zip-line end post behind the table
  const zipPost = new THREE.Group(); zipPost.position.set(1.6, 0, 0.9); FBk.g.add(zipPost);
  mesh(rbox(0.45, 0.8, 0.45, 0.05), M.stone3, { y: -0.15, parent: zipPost });
  mesh(cyl(0.08, 0.1, 3.15, 8), M.wood, { y: 1.57, parent: zipPost });
  mesh(sph(0.13, 10, 8), M.purple, { y: 3.2, parent: zipPost, outline: 0.015 });
  const ZIP_A = FN.W(0.32, 3.44, 0.35), ZIP_B = FBk.W(1.6, 3.02, 0.9);
  const bucketPivot = new THREE.Group(); bucketPivot.position.set(BKX + 0.27 * BKS, TBL, 0.3); FBk.g.add(bucketPivot);
  const bucket = new THREE.Group(); bucket.position.set(-0.27 * BKS, 0, 0); bucket.scale.setScalar(BKS); bucketPivot.add(bucket);
  function buildBucket(parent, color = 0x8FB6F0, paw = true) {
    const prof = [[0, 0.02], [0.24, 0.0], [0.27, 0.04], [0.31, 0.56], [0.33, 0.58], [0.3, 0.6], [0.27, 0.56], [0.23, 0.06], [0, 0.06]].map(([r, y]) => new THREE.Vector2(r, y));
    mesh(new THREE.LatheGeometry(prof, 20), toon(color), { parent, outline: 0.02 });
    mesh(new THREE.TorusGeometry(0.29, 0.025, 6, 20), M.cream, { y: 0.42, rx: Math.PI / 2, parent, outline: 0 });
    mesh(new THREE.TorusGeometry(0.255, 0.025, 6, 20), M.cream, { y: 0.14, rx: Math.PI / 2, parent, outline: 0 });
    mesh(new THREE.TorusGeometry(0.3, 0.018, 6, 16, Math.PI), M.ironDark, { y: 0.58, parent, outline: 0 });
    if (paw) for (const [px, py, r] of [[0, 0.27, 0.06], [-0.06, 0.35, 0.025], [0, 0.37, 0.025], [0.06, 0.35, 0.025]]) mesh(cyl(r, r, 0.02, 10), M.white, { x: px, y: py, z: 0.3, rx: Math.PI / 2 - 0.05, parent, outline: 0 });
  }
  buildBucket(bucket);
  const marbleSeatA = new THREE.Object3D(); marbleSeatA.position.set(0, 0.22, 0); bucket.add(marbleSeatA);
  statics.push([table, []], [zipPost, []], [bucket, [marbleSeatA]]);

  // =========================================================== 4 TUB — the pale-blue pet-wash clawfoot tub
  const TS = 1.15, TUBX = 1.75;
  const tub = new THREE.Group(); tub.position.set(0, 0, 0.35); tub.scale.setScalar(TS); FT.g.add(tub);
  const tubProfile = [[0, 0], [0.3, 0.02], [0.39, 0.12], [0.43, 0.32], [0.45, 0.56], [0.49, 0.7], [0.49, 0.74], [0.44, 0.74], [0.41, 0.6], [0.38, 0.3], [0.3, 0.12], [0, 0.1]].map(([r, y]) => new THREE.Vector2(r, y));
  mesh(new THREE.LatheGeometry(tubProfile, 28), toon(0x9CCFF0), { y: 0.26, s: [TUBX, 1, 1], parent: tub, outline: 0.02 });
  mesh(new THREE.TorusGeometry(0.47, 0.035, 6, 28), M.white, { y: 0.995, rx: Math.PI / 2, s: [TUBX, 1, 1], parent: tub, outline: 0.012 });
  const tubWater = mesh(new THREE.CircleGeometry(0.41, 28), M.water, { y: 0.86, rx: -Math.PI / 2, s: [TUBX, 1, 1], parent: tub, outline: 0, shadow: false });
  for (const [fx2, fz2] of [[-0.55, -0.24], [0.55, -0.24], [-0.55, 0.24], [0.55, 0.24]]) mesh(sph(0.09, 10, 8), M.gold, { x: fx2, y: 0.12, z: fz2, s: [1, 1.4, 1], parent: tub, outline: 0.012 });
  const foamG = sph(1, 8, 6);
  for (let k = 0; k < 9; k++) mesh(foamG, M.bubble, { x: -0.25 + Math.cos(k * 1.9) * 0.3, y: 0.9 + (k % 3) * 0.04, z: Math.sin(k * 2.7) * 0.2, s: 0.07 + (k % 4) * 0.025, parent: tub, outline: 0, shadow: false });
  // drain stub and a scrubbing brush on the rim
  mesh(cyl(0.12, 0.12, 0.22, 10), M.peri, { x: 0.86, y: 0.25, rz: Math.PI / 2, parent: tub, outline: 0.015 });
  mesh(rbox(0.32, 0.08, 0.12, 0.03), M.pink, { x: -0.55, y: 1.03, z: 0.34, ry: 0.4, parent: tub, outline: 0.01 });
  const swirlTex = canvasTex(128, 128, (g, w) => {
    g.clearRect(0, 0, w, w); g.translate(w / 2, w / 2); g.lineCap = 'round';
    for (let arm = 0; arm < 3; arm++) { g.beginPath(); for (let i = 0; i <= 40; i++) { const a = arm * 2.09 + i * 0.16, r = 4 + i * 1.45; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 6; g.stroke(); }
  }, { srgb: false });
  const whirl = new THREE.Mesh(new THREE.CircleGeometry(0.34, 24), new THREE.MeshBasicMaterial({ map: swirlTex, transparent: true, opacity: 0, depthWrite: false }));
  whirl.rotation.x = -Math.PI / 2; whirl.position.set(0.5, 0.875, 0); whirl.renderOrder = 3; tub.add(whirl);
  const DRAIN_L = V(0.5, 0.86, 0); // tub-local
  statics.push([tub, [tubWater, whirl]]);

  // helpers for open troughs: the two rim lines of an 'up'-framed trough around axis points
  function rimLines(pts, r) {
    const a = [], b = [], T = V(), N = V(), B = V();
    for (let i = 0; i < pts.length; i++) {
      T.subVectors(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      N.copy(UP).addScaledVector(T, -T.y).normalize(); B.crossVectors(T, N);
      a.push(pts[i].clone().addScaledVector(B, r)); b.push(pts[i].clone().addScaledVector(B, -r));
    }
    return [a, b];
  }
  // an open half-pipe trough (inside visible), ink outline and two rolled rims
  function trough(parent, axisPts, r, mat, railMat, { railR = 0.045, radial = 8 } = {}) {
    const m = mesh(tubeGeo(axisPts, { radius: r, radial, a0: Math.PI / 2, a1: Math.PI * 1.5, frames: 'up' }), mat, { parent, outline: 0.02 });
    for (const line of rimLines(axisPts, r)) mesh(tubeGeo(line, { radius: railR, radial: 4, frames: 'pt' }), railMat, { parent, outline: 0 });
    return m;
  }
  const conduits = new THREE.Group(); conduits.name = 'catcher:conduits'; root.add(conduits);
  const collarGeo = new THREE.TorusGeometry(1, 0.17, 5, 12);
  const collarList = []; // {pos, dir, r, s (arc pos on its conduit), kind}

  // ---------------------------------------------------------------- conduit 1: bunting rope, bell -> net (along the river)
  root.updateMatrixWorld(true);
  const PULLEY_W = worldOf(pulley);
  const ropeSup = [D.bell + 3.4, D.bell + 6.9].map((d) => R(d, 2.95, 3.12));
  for (const p of ropeSup) { post(conduits, p, p.y - 0.03, M.woodPlain, 1.15); mesh(sph(0.1, 10, 8), M.gold, { x: p.x, y: p.y + 0.03, z: p.z, parent: conduits, outline: 0.012 }); }
  const ropeKnots = [PULLEY_W, ...ropeSup, PIN_W];
  const ropeRest = [], ropeU = [];
  {
    const lens = []; let total = 0;
    for (let i = 0; i < ropeKnots.length - 1; i++) { const l = ropeKnots[i].distanceTo(ropeKnots[i + 1]); lens.push(l); total += l; }
    for (let i = 0; i < ropeKnots.length - 1; i++) {
      const n = Math.max(6, Math.round((lens[i] / total) * 76));
      for (let k = i ? 1 : 0; k <= n; k++) { const u = k / n; const p = ropeKnots[i].clone().lerp(ropeKnots[i + 1], u); p.y -= lens[i] * 0.055 * 4 * u * (1 - u); ropeRest.push(p); }
    }
    let acc = 0; ropeU.push(0);
    for (let i = 1; i < ropeRest.length; i++) { acc += ropeRest[i].distanceTo(ropeRest[i - 1]); ropeU.push(acc); }
    for (let i = 0; i < ropeU.length; i++) ropeU[i] /= acc;
  }
  const rope = new Strand(root, ropeRest.length - 1, { radius: 0.034, radial: 4, mat: M.rope });
  const bellTug = new Strand(root, 5, { radius: 0.026, radial: 5, mat: M.rope });
  const pulse = new THREE.Sprite(new THREE.SpriteMaterial({ map: STAR, color: 0xFFE59A, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pulse.scale.setScalar(0.9); pulse.renderOrder = 6; pulse.visible = false; root.add(pulse);
  // pennant bunting hanging from the rope
  const FLAGS = 18;
  const flagShape = new THREE.Shape(); flagShape.moveTo(-0.14, 0); flagShape.lineTo(0.14, 0); flagShape.lineTo(0, -0.34); flagShape.closePath();
  const flagG = new THREE.ShapeGeometry(flagShape); flagG.deleteAttribute('uv');
  const flagInkG = flagG.clone(); flagInkG.scale(1.32, 1.22, 1); flagInkG.translate(0, 0.025, 0);
  const flagMesh = new THREE.InstancedMesh(flagG, toon(0xffffff, { side: THREE.DoubleSide }), FLAGS);
  const flagInk = new THREE.InstancedMesh(flagInkG, new THREE.MeshBasicMaterial({ color: C.ink, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 6 }), FLAGS);
  flagMesh.frustumCulled = flagInk.frustumCulled = false; flagMesh.castShadow = true;
  const flagCols = [C.pink, C.cream, C.lav, C.mint, C.gold, C.sky].map((c) => new THREE.Color(c));
  const flagIdx = [];
  for (let f = 0; f < FLAGS; f++) {
    flagMesh.setColorAt(f, flagCols[f % flagCols.length]);
    const u = 0.05 + (0.9 * f) / (FLAGS - 1); let i = 0; while (i < ropeU.length - 2 && ropeU[i + 1] < u) i++;
    flagIdx.push({ u, i, k: (u - ropeU[i]) / Math.max(1e-6, ropeU[i + 1] - ropeU[i]) });
  }
  root.add(flagMesh, flagInk);

  // ---------------------------------------------------------------- conduit 2: zip line, net post -> bucket
  const zipAt = (s, out = V()) => out.copy(ZIP_A).lerp(ZIP_B, s).addScaledVector(UP, -0.1 * 4 * s * (1 - s));
  mesh(tubeGeo(Array.from({ length: 21 }, (_, i) => zipAt(i / 20)), { radius: 0.022, radial: 5 }), M.ironDark, { parent: conduits, outline: 0.01 });
  const netRig = new THREE.Group(); root.add(netRig);
  const zipDir = ZIP_B.clone().sub(ZIP_A).setY(0).normalize();
  netRig.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(zipDir, UP, zipDir.clone().cross(UP)));
  mesh(new THREE.TorusGeometry(0.11, 0.035, 6, 14), M.ironDark, { y: -0.1, parent: netRig, outline: 0.01 });
  const netSwing = new THREE.Group(); netSwing.position.y = -0.1; netRig.add(netSwing);
  const netBody = new THREE.Group(); netSwing.add(netBody);
  mesh(cyl(0.03, 0.03, 0.2, 6), M.ironDark, { y: -0.1, parent: netBody, outline: 0.008 });
  mesh(cyl(0.045, 0.045, 1.15, 8), M.woodDark, { y: -0.75, parent: netBody, outline: 0.012 });
  // hoop faces the inside of the loop (where the cameras are); the mesh bag trails away from it
  mesh(new THREE.TorusGeometry(0.5, 0.055, 8, 26), toon(0x7B4FB5), { y: -1.72, parent: netBody, outline: 0.016 });
  const bagG = new THREE.ConeGeometry(0.47, 0.9, 14, 3, true); bagG.rotateX(-Math.PI / 2); bagG.translate(0, 0, -0.45);
  mesh(bagG, toon(0xEEE3FF, { opacity: 0.8, side: THREE.DoubleSide }), { y: -1.72, parent: netBody, outline: 0, shadow: false });
  for (const k of [0.33, 0.66]) mesh(new THREE.TorusGeometry(0.47 * (1 - k), 0.014, 4, 16), M.lav, { z: -0.9 * k, y: -1.72, parent: netBody, outline: 0 });
  mesh(new THREE.ConeGeometry(0.06, 0.4, 6), M.red, { y: -1.25, z: 0.07, rz: 0.5, parent: netBody, outline: 0.01 });
  const netHoop = new THREE.Object3D(); netHoop.position.set(0, -1.72, 0); netBody.add(netHoop);
  const NET_HOOP = 1.82; // pivot -> hoop centre
  const zipLen = ZIP_A.distanceTo(ZIP_B);
  const bucketW0 = FBk.W(BKX, TBL + 0.35, 0.3);
  const sBucket = bucketW0.clone().sub(ZIP_A).dot(ZIP_B.clone().sub(ZIP_A)) / (zipLen * zipLen);
  const S_STOP = Math.max(0.35, sBucket - (0.31 * BKS + 0.5 + NET_HOOP * Math.sin(0.55)) / zipLen); // hoop rim meets the bucket at full swing

  // ---------------------------------------------------------------- conduit 3: wooden chute, bucket -> tub
  const MR = 0.21, CH_R = 0.28;
  const C0 = FBk.W(1.2, TBL + 0.02 + MR, 0.3), C1 = FT.W(-0.6, 1.47, 0.35);
  const chuteCurve = new THREE.CatmullRomCurve3([C0, C0.clone().lerp(C1, 0.5).addScaledVector(UP, -0.1), C1]);
  const chuteAxis = chuteCurve.getSpacedPoints(30).map((p) => p.clone().addScaledVector(UP, CH_R - MR));
  trough(conduits, chuteAxis, CH_R, M.trough, M.rail, { railR: 0.035, radial: 8 });
  for (const u of [0.08, 0.5, 0.9]) { const p = chuteCurve.getPointAt(u); post(conduits, p, p.y - MR - 0.04, M.woodPlain, 0.8); }
  const CHUTE_LEN = chuteCurve.getLength();

  // =========================================================== 7 DROP — castle-gate tower with a catapult lever (built early: the vine aims at it)
  const TOWER = 1.8, LEVER_ARMED = -0.26, LEVER_FIRED = 0.3;
  const tower = new THREE.Group(); tower.position.set(0, 0, 0.45); FD.g.add(tower);
  mesh(rbox(2.5, TOWER + 1.0, 1.25, 0.1), M.stone, { y: (TOWER - 1.0) / 2, parent: tower });
  mesh(rbox(2.62, 0.14, 1.37, 0.05), M.stone2, { y: TOWER - 0.03, parent: tower, outline: 0.02 });
  for (let k = 0; k < 5; k++) for (const sz of [-1, 1]) mesh(rbox(0.32, 0.3, 0.22, 0.05), M.stone2, { x: -1.1 + k * 0.55, y: TOWER + 0.15, z: sz * 0.57, parent: tower, outline: 0.015 });
  mesh(cyl(0.03, 0.03, 1.3, 6), M.woodDark, { x: -1.15, y: TOWER + 0.8, z: 0.5, parent: tower, outline: 0.01 });
  { const fl = new THREE.Shape(); fl.moveTo(0, 0); fl.lineTo(0.5, -0.14); fl.lineTo(0, -0.3); fl.closePath(); mesh(new THREE.ShapeGeometry(fl), toon(C.fmn, { side: THREE.DoubleSide }), { x: -1.15, y: TOWER + 1.42, z: 0.5, parent: tower, outline: 0 }); }
  mesh(heartG, M.pink, { y: TOWER * 0.45, z: -0.65, s: 0.75, parent: tower, outline: 0.015 });
  const fulG = new THREE.CylinderGeometry(0.26, 0.26, 0.42, 3); fulG.rotateX(Math.PI / 2); fulG.rotateZ(Math.PI / 2);
  mesh(fulG, M.pink, { y: TOWER + 0.15, parent: tower, outline: 0.02 });
  const lever = new THREE.Group(); lever.position.set(0, TOWER + 0.36, 0); lever.rotation.z = LEVER_ARMED; tower.add(lever);
  mesh(rbox(2.4, 0.1, 0.42, 0.04), M.plank, { parent: lever });
  mesh(cyl(0.05, 0.05, 0.5, 8), M.gold, { rx: Math.PI / 2, parent: lever, outline: 0.01 });
  const bucket2 = new THREE.Group(); bucket2.position.set(-0.85, 0.05, 0); lever.add(bucket2);
  buildBucket(bucket2, 0xC7A6EE, false);
  mesh(new THREE.TorusGeometry(0.06, 0.02, 6, 10), M.gold, { y: 0.33, z: 0.31, parent: bucket2, outline: 0 });
  const dropSeat = new THREE.Object3D(); dropSeat.position.set(0, 0.22, 0); bucket2.add(dropSeat);
  const appleCup = new THREE.Group(); appleCup.position.set(0.95, 0.05, 0); lever.add(appleCup);
  mesh(new THREE.SphereGeometry(0.3, 14, 7, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), toon(0xC98E55, { side: THREE.DoubleSide }), { y: 0.26, parent: appleCup, outline: 0.015 });
  mesh(new THREE.TorusGeometry(0.3, 0.04, 6, 18), M.cream, { y: 0.26, rx: Math.PI / 2, parent: appleCup, outline: 0.01 });
  const AR = 0.33; // the big red apple
  const appleSeatC = new THREE.Object3D(); appleSeatC.position.set(0, 0.12 + AR, 0); appleCup.add(appleSeatC);
  statics.push([tower, [lever]], [lever, [bucket2, appleCup]], [bucket2, [dropSeat]], [appleCup, [appleSeatC]]);
  root.updateMatrixWorld(true);
  const DROP_MOUTH = lever.localToWorld(V(-0.85, 0.05 + 0.62, 0));
  const VEND = DROP_MOUTH.clone().add(V(0, 1.05, 0)); // where the vine tip parks its leaf cup

  // =========================================================== 5 PIPE — long periwinkle pipe with windows and a loop
  const PIPE_R = 0.27, PIPE_H = 0.55, PIPE_OFF = 2.75, RL = 0.9, LOOP_DZ = 0.72;
  const pp = [];
  tub.updateMatrixWorld(true);
  pp.push(tub.localToWorld(V(0.98, 0.25, 0)), tub.localToWorld(V(1.25, 0.32, 0.05)));
  for (let d = D.tub + 2.0; d <= D.pipe - 1.7; d += 0.7) pp.push(R(d, PIPE_OFF + 0.25 * (1 - seg(d, D.tub + 2, D.tub + 4)), PIPE_H));
  const loopH0 = FP.gy(0, 0.45) + PIPE_H, loopZ0 = PIPE_OFF - 2.6;
  const iLoop0 = pp.length;
  pp.push(FP.W(-1.0, loopH0, loopZ0));
  for (let i = 0; i <= 28; i++) { const ph = (i / 28) * Math.PI * 2; pp.push(FP.W(RL * Math.sin(ph), loopH0 + RL * (1 - Math.cos(ph)), loopZ0 + LOOP_DZ * (i / 28))); }
  pp.push(FP.W(1.0, loopH0, loopZ0 + LOOP_DZ));
  const iLoop1 = pp.length - 1;
  for (let d = D.pipe + 1.7; d <= D.vine - 1.4; d += 0.7) pp.push(R(d, PIPE_OFF + LOOP_DZ * (1 - smooth01(seg(d, D.pipe + 1.7, D.pipe + 4.5))), PIPE_H));
  pp.push(FV.W(-0.95, 0.4 + Math.max(0, FV.gy(-0.95, 0.35)), 0.35), FV.W(-0.52, 0.42, 0.35));
  function smooth01(k) { return k * k * (3 - 2 * k); }
  const pipeCurve = new THREE.CatmullRomCurve3(pp, false, 'centripetal', 0.5); pipeCurve.arcLengthDivisions = 1200;
  const PIPE_LEN = pipeCurve.getLength();
  const pipeLens = pipeCurve.getLengths(1200);
  const sOfIndex = (i) => pipeLens[Math.round((i / (pp.length - 1)) * 1200)];
  const sLoop0 = sOfIndex(iLoop0) - 0.15, sLoop1 = sOfIndex(iLoop1) + 0.15;
  {
    const secs = []; let s = 0, glass = false;
    while (s < PIPE_LEN - 0.01) {
      if (s >= sLoop0 && s < sLoop1) { secs.push([s, sLoop1, true]); s = sLoop1; glass = false; continue; }
      let e = s + (glass ? 0.6 : 1.7); if (s < sLoop0 && e > sLoop0) e = sLoop0; if (e > PIPE_LEN - 0.5) e = PIPE_LEN;
      if (s < 0.6) { e = Math.min(e, 1.4); glass = false; }
      secs.push([s, e, glass]); s = e; glass = !glass;
    }
    const og = [], gg = [];
    for (const [a, b, gl] of secs) {
      const n = Math.max(3, Math.ceil((b - a) / (b > sLoop0 && a < sLoop1 ? 0.09 : 0.18))); const pts = [];
      for (let i = 0; i <= n; i++) pts.push(pipeCurve.getPointAt((a + ((b - a) * i) / n) / PIPE_LEN));
      (gl ? gg : og).push(tubeGeo(pts, { radius: PIPE_R, radial: 8 }));
      if (gl) for (const sc of [a, b]) collarList.push({ s: sc, conduit: 'pipe' });
    }
    mesh(mergeGeometries(og), M.peri, { parent: conduits, outline: 0.022 });
    const glassMesh = mesh(mergeGeometries(gg), M.pipeGlass, { parent: conduits, outline: 0, shadow: false });
    glassMesh.renderOrder = 2; glassMesh.userData.noBake = true;
    for (let s2 = 2.2; s2 < PIPE_LEN - 1; s2 += 2.3) {
      if (s2 > sLoop0 - 0.6 && s2 < sLoop1 + 0.6) continue;
      const p = pipeCurve.getPointAt(s2 / PIPE_LEN); post(conduits, p, p.y - PIPE_R, M.woodPlain, 0.9);
    }
    // loop frame: two posts and a crossbar over the top of the loop
    const top = loopH0 + 2 * RL + PIPE_R + 0.06;
    for (const z of [loopZ0 - 0.5, loopZ0 + LOOP_DZ + 0.5]) { const p = FP.W(0, 0, z); post(conduits, p, FP.o.y + top, M.woodDark, 1.1); }
    const a = FP.W(0, top, loopZ0 - 0.56), b = FP.W(0, top, loopZ0 + LOOP_DZ + 0.56);
    mesh(tubeGeo([a, b], { radius: 0.07, radial: 6 }), M.woodDark, { parent: conduits, outline: 0.012 });
    mesh(sph(0.12, 10, 8), M.gold, { x: (a.x + b.x) / 2, y: top + 0.1, z: (a.z + b.z) / 2, parent: conduits, outline: 0.012 });
  }
  // gold collars at every window edge (they jump as the marble rattles past)
  const pipeCollars = new THREE.InstancedMesh(collarGeo, M.gold, collarList.length); pipeCollars.frustumCulled = false; pipeCollars.castShadow = true; root.add(pipeCollars);
  for (const c of collarList) { c.pos = pipeCurve.getPointAt(Math.min(1, c.s / PIPE_LEN)); c.q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), pipeCurve.getTangentAt(Math.min(1, c.s / PIPE_LEN))); }
  function setCollars(sM) {
    const m = new THREE.Matrix4(), sc = V();
    collarList.forEach((c, i) => { const k = 1 + (sM == null ? 0 : 0.35 * Math.exp(-(((sM - c.s) / 0.35) ** 2))); m.compose(c.pos, c.q, sc.setScalar(PIPE_R * 1.1 * k)); pipeCollars.setMatrixAt(i, m); });
    pipeCollars.instanceMatrix.needsUpdate = true;
  }
  setCollars(null);
  const pipeSpeed = speedTable(PIPE_LEN, (s) => (s > sLoop0 && s < sLoop1 ? 6.4 - 2.6 * Math.sin((Math.PI * (s - sLoop0)) / (sLoop1 - sLoop0)) : 6.4 + (s < 2 ? -1.5 * (1 - s / 2) : 0)));

  // =========================================================== 6 VINE — Kyah's beanstalk along the hill path
  const pot = new THREE.Group(); pot.position.set(0, 0, 0.35); FV.g.add(pot);
  const potProf = [[0, -0.35], [0.36, -0.35], [0.4, -0.3], [0.48, 0.55], [0.58, 0.57], [0.6, 0.7], [0.52, 0.74], [0.47, 0.66], [0, 0.62]].map(([r, y]) => new THREE.Vector2(r, y));
  mesh(new THREE.LatheGeometry(potProf, 22), M.terracotta, { parent: pot, outline: 0.02 });
  mesh(cyl(0.47, 0.47, 0.04, 20), M.soil, { y: 0.63, parent: pot, outline: 0 });
  for (let k = 0; k < 6; k++) mesh(k % 2 ? BLOSSOM : FMN, fmnMat, { x: Math.cos(k * 1.05) * 0.56, y: 0.72, z: Math.sin(k * 1.05) * 0.56, ry: -k * 1.05 + Math.PI / 2, s: 1.3, parent: pot, outline: 0 });
  mesh(new THREE.TorusGeometry(0.2, 0.06, 6, 12, Math.PI * 1.4), M.vine, { y: 0.8, rx: Math.PI / 2 - 0.3, parent: pot, outline: 0.012 }); // curled sprout
  mesh(BIGLEAF, M.leaf, { x: 0.1, y: 0.66, rz: -0.6, parent: pot, outline: 0 }); mesh(BIGLEAF, M.leaf, { x: -0.1, y: 0.66, rz: 0.7, parent: pot, outline: 0 });
  mesh(heartG, M.pink, { y: 0.15, z: -0.48, s: 0.42, parent: pot, outline: 0.012 });
  statics.push([pot, []]);
  root.updateMatrixWorld(true);
  const POT_TOP = FV.W(0, 0.8, 0.35);
  const vp = [FV.W(0, 0.62, 0.35), FV.W(0.06, 1.25, 0.42), FV.W(0.45, 1.95, 0.5)];
  const dV0 = D.vine + 1.4, dV1 = D.drop - 2.3;
  for (let d = dV0; d <= dV1 + 1e-6; d += 0.8) { const u = seg(d, dV0, dV1); vp.push(R(d, 2.95 + 0.3 * Math.sin(d * 0.9), 2.25 + 0.28 * Math.sin(d * 0.6 + 1) + 0.6 * smooth01(seg(u, 0.55, 1)))); }
  vp.push(VEND.clone().addScaledVector(FD.t, -1.2).add(V(0, 0.15, 0)), VEND.clone());
  const vineCurve = new THREE.CatmullRomCurve3(vp, false, 'centripetal', 0.5); vineCurve.arcLengthDivisions = 800;
  const VINE_LEN = vineCurve.getLength();
  const VSEG = 200, vinePts = vineCurve.getSpacedPoints(VSEG);
  const vineMat = toon(0x6FAE5C, { emissive: 0x2f7a2a, ei: 0, unique: true });
  const vineGeo = tubeGeo(vinePts, { radius: 0.17, rFn: (u) => 0.18 - 0.085 * u, radial: 6 });
  const vineMesh = mesh(vineGeo, vineMat, { parent: root, outline: 0.022 }); vineMesh.frustumCulled = false;
  // per-sample side vectors (horizontal) for tendril, leaves and flowers
  const vineSide = vinePts.map((p, i) => { const T = vinePts[Math.min(VSEG, i + 1)].clone().sub(vinePts[Math.max(0, i - 1)]).normalize(); const B = T.clone().cross(UP); if (B.lengthSq() < 1e-4) B.set(1, 0, 0); return { T, B: B.normalize(), N: B.clone().cross(T).normalize() }; });
  const vineAt = (u) => { const f = u * VSEG, i = Math.min(VSEG - 1, Math.floor(f)), k = f - i; return { p: vinePts[i].clone().lerp(vinePts[i + 1], k), ...vineSide[Math.round(f)] }; };
  const tendrilPts = [];
  for (let i = 0; i <= 190; i++) { const u = 0.1 + 0.9 * (i / 190); const a = vineAt(u), ang = u * VINE_LEN * 2.6, rr = 0.2 - 0.06 * u; tendrilPts.push(a.p.clone().addScaledVector(a.B, Math.cos(ang) * rr).addScaledVector(a.N, Math.sin(ang) * rr)); }
  const tendrilGeo = tubeGeo(tendrilPts, { radius: 0.038, radial: 4 });
  const tendril = mesh(tendrilGeo, M.vine2, { parent: root, outline: 0 }); tendril.frustumCulled = false;
  // trellis stakes + guide twine show where the beanstalk will grow (visible while armed)
  for (let u = 0.16; u < 0.97; u += 2.5 / VINE_LEN) { const a = vineAt(u); const g = a.p.clone(); post(conduits, g, a.p.y - 0.17, M.woodPlain, 0.75); mesh(sph(0.06, 8, 6), M.gold, { x: g.x, y: a.p.y - 0.15, z: g.z, parent: conduits, outline: 0 }); }
  mesh(tubeGeo(vineCurve.getSpacedPoints(120).map((p) => p.clone().add(V(0, -0.15, 0))), { radius: 0.014, radial: 4 }), M.vine2, { parent: conduits, outline: 0 });
  // leaves and flowers along the stalk (instanced; they pop as the tip passes)
  const NLEAF = 44, NFLOW = 24;
  const leafI = new THREE.InstancedMesh(BIGLEAF, M.leaf, NLEAF); leafI.frustumCulled = false; leafI.castShadow = true; root.add(leafI);
  const leaves = Array.from({ length: NLEAF }, (_, l) => ({ u: 0.035 + (0.94 * l) / (NLEAF - 1), side: l % 2 ? 1 : -1, ph: l * 1.7, sc: 0 }));
  const vineFlowerMat = toon(0xFFFFFF, { vc: true, emissive: 0x3d6be0, ei: 0, unique: true });
  const flowI = [new THREE.InstancedMesh(FMN, vineFlowerMat, NFLOW / 2), new THREE.InstancedMesh(BLOSSOM, vineFlowerMat, NFLOW / 2)];
  for (const f of flowI) { f.frustumCulled = false; root.add(f); }
  const flowers = Array.from({ length: NFLOW }, (_, k) => {
    const u = 0.06 + (0.92 * k) / (NFLOW - 1), side = k % 2 ? 1 : -1, a = vineAt(u);
    const face = a.B.clone().multiplyScalar(side).addScaledVector(UP, 0.75).normalize();
    const pos = a.p.clone().addScaledVector(face, 0.2);
    return { u, pos, q: new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), face), base: 1.9 + (k % 3) * 0.35, sc: 0, inst: flowI[k % 2], idx: k >> 1 };
  });
  const flowerGlow = makeGlowPoints(root, NFLOW, GLOW, 0x9FC0FF, 0.8);
  flowers.forEach((f, k) => flowerGlow.pos.setXYZ(k, f.pos.x, f.pos.y, f.pos.z));
  flowerGlow.pos.needsUpdate = true;
  // leaf cup that carries the marble at the growing tip
  const cup = new THREE.Group(); root.add(cup);
  const cupTilt = new THREE.Group(); cup.add(cupTilt);
  mesh(new THREE.SphereGeometry(0.32, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), toon(0x5FA35A, { side: THREE.DoubleSide }), { parent: cupTilt, outline: 0.015 });
  for (let k = 0; k < 4; k++) mesh(BIGLEAF, M.leaf, { x: Math.cos(k * 1.57) * 0.24, z: Math.sin(k * 1.57) * 0.24, rx: 0, ry: -k * 1.57 + Math.PI / 2, rz: 0, parent: cupTilt, outline: 0 }).rotation.set(Math.sin(k * 1.57) * 0.9, 0, -Math.cos(k * 1.57) * 0.9);
  const cupSeat = new THREE.Object3D(); cupSeat.position.set(0, -0.1, 0); cupTilt.add(cupSeat);
  const tipBud = mesh(new THREE.ConeGeometry(0.1, 0.32, 8), M.vine, { parent: root, outline: 0.012 });
  const tipGlow = halo(0xBFE0FF, 1.3, root, V(), 0.0);
  statics.push([cupTilt, [cupSeat]]);

  // =========================================================== 8 APPLE — castle steps, then a gutter rail down the bakery street
  const STEP_N = 7, dS0 = D.drop + 1.45, dS1 = D.apple - 0.25, STEP_OFF = 2.65;
  const stepTop0 = FD.o.y + TOWER - 0.2, stepTopN = FA.o.y + 1.3;
  const steps = [];
  const stairs = new THREE.Group(); stairs.name = 'catcher:steps'; root.add(stairs);
  const stepMats = [M.stone2, M.stone, M.stone3];
  for (let i = 0; i < STEP_N; i++) {
    const run = (dS1 - dS0) / STEP_N, d = dS0 + (i + 0.5) * run, f = rf(d), c = R(d, STEP_OFF);
    const top = stepTop0 + ((stepTopN - stepTop0) * i) / (STEP_N - 1);
    let gmin = Infinity; for (const [ax, az] of [[-0.5, -0.6], [0.5, -0.6], [-0.5, 0.6], [0.5, 0.6]]) gmin = Math.min(gmin, GH(c.x + f.t.x * ax * run + f.n.x * az, c.z + f.t.z * ax * run + f.n.z * az));
    const bottom = gmin - 0.35, ry = Math.atan2(-f.t.z, f.t.x);
    mesh(rbox(run + 0.06, top - bottom, 1.2, 0.07), stepMats[i % 3], { x: c.x, y: (top + bottom) / 2, z: c.z, ry, parent: stairs });
    mesh(rbox(run + 0.12, 0.08, 1.28, 0.03), i % 2 ? M.cream : toon(0xF6D2E2), { x: c.x, y: top + 0.01, z: c.z, ry, parent: stairs, outline: 0.015 });
    steps.push(V(c.x, top + 0.05 + AR, c.z));
    if (i % 3 === 1) tuft(stairs, c.x + f.n.x * 0.45, top + 0.04, c.z + f.n.z * 0.45, 3, i % 2 ? FMN : BLOSSOM);
  }
  const GR = 0.46, dG0 = D.apple + 0.2, dLip = D.pup - 3.1;
  const yG0 = stepTopN + AR - 0.32, yG1 = Math.max(1.0, FA.o.y + 0.75);
  const gp = [];
  for (let d = dG0; d <= dLip - 0.9; d += 0.6) {
    const u = seg(d, dG0, dLip - 0.9), q = RA(d, STEP_OFF, 0);
    gp.push(V(q.x, Math.max(yG0 + (yG1 - yG0) * u, GH(q.x, q.z) + 0.38 + AR), q.z));
  }
  { const last = gp[gp.length - 1].y; for (const k of [0.45, 0.9]) { const q = RA(dLip - 0.9 + k, STEP_OFF - 0.15 * k, 0); gp.push(V(q.x, last + 0.36 * (k / 0.9) ** 2, q.z)); } }
  const gutterCurve = new THREE.CatmullRomCurve3(gp, false, 'centripetal', 0.5); gutterCurve.arcLengthDivisions = 1500;
  const GUT_LEN = gutterCurve.getLength();
  const gutAxis = gutterCurve.getSpacedPoints(Math.ceil(GUT_LEN / 0.25)).map((p) => p.clone().addScaledVector(UP, GR - AR));
  trough(conduits, gutAxis, GR, M.trough, M.rail, { railR: 0.055, radial: 7 });
  for (let s = 0.6; s < GUT_LEN - 0.3; s += 2.4) { const p = gutterCurve.getPointAt(s / GUT_LEN); post(conduits, p, p.y - AR + 0.02, M.woodPlain, 1.0); }
  // little end cap at the start so the apple cannot roll back out
  { const p = gutAxis[0], T = gutAxis[1].clone().sub(p).normalize(); const cap = mesh(new THREE.CircleGeometry(GR, 16, Math.PI, Math.PI), M.trough, { parent: conduits, outline: 0 }); cap.position.copy(p); cap.lookAt(p.clone().sub(T)); }
  const gutSpeed = speedTable(GUT_LEN, (s) => (4.6 + 2.9 * (s / GUT_LEN)) * (s > GUT_LEN - 1 ? 0.8 : 1));
  const LIP_END = gutterCurve.getPointAt(1);
  statics.push([stairs, []]);

  // the apple: `apple` = centre position, `appleRoll` = rolling rotation, `appleSq` = squash
  const apple = new THREE.Group(); root.add(apple);
  const appleSq = new THREE.Group(); apple.add(appleSq);
  const appleRoll = new THREE.Group(); appleSq.add(appleRoll);
  const appleG = new THREE.SphereGeometry(AR, 20, 14); appleG.scale(1, 0.92, 1);
  mesh(appleG, M.red, { parent: appleRoll, outline: 0.022 });
  mesh(cyl(0.022, 0.03, 0.18, 6), M.woodDark, { y: AR * 0.95, rz: 0.2, parent: appleRoll, outline: 0 });
  mesh(LEAF, M.leaf, { x: 0.03, y: AR * 0.95, rz: -1.1, s: 0.9, parent: appleRoll, outline: 0 });
  mesh(sph(0.07, 8, 6), M.white, { x: -0.14, y: 0.12, z: 0.22, parent: appleRoll, outline: 0, shadow: false }).scale.set(1, 1.4, 0.5);
  statics.push([appleRoll, []]);

  // =========================================================== 9 PUP — seesaw on the square, Charli flies into the washtub
  const SEE_H = 0.5, PLANK = 2.7, SE = 0.3;
  const seeBase = new THREE.Group(); seeBase.position.set(0, 0, 0.35); FPu.g.add(seeBase);
  const fulG2 = new THREE.CylinderGeometry(0.36, 0.36, 0.5, 3); fulG2.rotateX(Math.PI / 2); fulG2.rotateZ(Math.PI / 2);
  mesh(fulG2, M.pink, { y: 0.24, parent: seeBase, outline: 0.02 });
  mesh(rbox(0.9, 0.12, 0.8, 0.04), M.stone2, { y: 0.0, parent: seeBase });
  const seesaw = new THREE.Group(); seesaw.position.set(0, SEE_H, 0.35); FPu.g.add(seesaw);
  mesh(cyl(0.06, 0.06, 0.6, 8), M.gold, { rx: Math.PI / 2, parent: seesaw, outline: 0.01 });
  const plank = new THREE.Group(); plank.rotation.z = SE; seesaw.add(plank);
  mesh(rbox(PLANK, 0.1, 0.5, 0.04), M.plank, { y: 0.06, parent: plank });
  mesh(rbox(0.12, 0.2, 0.5, 0.03), M.woodDark, { x: PLANK / 2 - 0.08, y: 0.15, parent: plank });
  mesh(rbox(0.12, 0.2, 0.5, 0.03), M.woodDark, { x: -PLANK / 2 + 0.08, y: 0.15, parent: plank });
  mesh(cyl(0.2, 0.2, 0.03, 14), M.pink, { x: PLANK / 2 - 0.42, y: 0.12, parent: plank, outline: 0.01 });
  const seatUp = new THREE.Object3D(); seatUp.position.set(PLANK / 2 - 0.42, 0.12 + AR, 0); plank.add(seatUp);
  const seatDn = new THREE.Object3D(); seatDn.position.set(-PLANK / 2 + 0.42, 0.11, 0); plank.add(seatDn);
  statics.push([seeBase, []], [seesaw, [plank]], [plank, [seatUp, seatDn]]);
  // Charli, the chunky golden doodle with the blue collar
  const PS = 1.75;
  const pup = new THREE.Group(); root.add(pup);
  const pupSpin = new THREE.Group(); pupSpin.position.y = 0.3 * PS; pup.add(pupSpin);
  const pupBody = new THREE.Group(); pupBody.position.y = -0.3 * PS; pupBody.scale.setScalar(PS); pupSpin.add(pupBody);
  const PUP = toon(C.pup), PUP2 = toon(0xF9D98E), PUP3 = toon(0xD9973A);
  mesh(new THREE.CapsuleGeometry(0.2, 0.12, 4, 10), PUP, { y: 0.27, z: -0.04, rx: 0.25, parent: pupBody, outline: 0.012 });
  for (const sx of [-1, 1]) {
    mesh(new THREE.CapsuleGeometry(0.065, 0.12, 3, 7), PUP, { x: sx * 0.1, y: 0.1, z: 0.1, parent: pupBody, outline: 0.01 });
    mesh(sph(0.07, 7, 5), PUP2, { x: sx * 0.1, y: 0.04, z: 0.15, s: [1, 0.7, 1.2], parent: pupBody, outline: 0.008 });
    mesh(sph(0.1, 8, 6), PUP, { x: sx * 0.17, y: 0.1, z: -0.12, s: [0.8, 0.9, 1.2], parent: pupBody, outline: 0.01 });
  }
  const pupHead = new THREE.Group(); pupHead.position.set(0, 0.56, 0.05); pupBody.add(pupHead);
  mesh(sph(0.2, 12, 9), PUP, { parent: pupHead, outline: 0.012 });
  for (let k = 0; k < 6; k++) mesh(sph(0.075, 6, 4), PUP2, { x: Math.cos(k * 1.05) * 0.1, y: 0.17 + (k % 2) * 0.03, z: Math.sin(k * 1.05) * 0.08 - 0.02, parent: pupHead, outline: 0.006 });
  mesh(sph(0.11, 10, 7), PUP2, { y: -0.06, z: 0.15, s: [1.1, 0.8, 0.9], parent: pupHead, outline: 0.01 });
  mesh(sph(0.04, 8, 6), M.ink, { y: -0.02, z: 0.255, s: [1.2, 0.9, 1], parent: pupHead, outline: 0 });
  mesh(sph(0.035, 8, 6), M.pink, { y: -0.13, z: 0.21, s: [1, 0.6, 1.2], parent: pupHead, outline: 0 });
  for (const sx of [-1, 1]) {
    mesh(sph(0.04, 8, 6), M.ink, { x: sx * 0.085, y: 0.05, z: 0.165, parent: pupHead, outline: 0 });
    mesh(sph(0.013, 6, 4), M.white, { x: sx * 0.085 + 0.012, y: 0.065, z: 0.2, parent: pupHead, outline: 0, shadow: false });
    const ear = new THREE.Group(); ear.position.set(sx * 0.17, 0.08, -0.02); ear.rotation.z = sx * 0.35; pupHead.add(ear);
    mesh(sph(0.09, 8, 6), PUP3, { y: -0.1, s: [0.65, 1.3, 0.75], parent: ear, outline: 0.01 });
  }
  mesh(new THREE.TorusGeometry(0.15, 0.035, 8, 18), toon(C.roof), { y: 0.42, z: 0.03, rx: Math.PI / 2 + 0.25, parent: pupBody, outline: 0.008 });
  const tag = new THREE.Group(); tag.position.set(0, 0.36, 0.18); pupBody.add(tag);
  mesh(rbox(0.1, 0.035, 0.02, 0.01), M.gold, { parent: tag, outline: 0.006 });
  const tail = new THREE.Group(); tail.position.set(0, 0.25, -0.24); pupBody.add(tail);
  mesh(new THREE.CapsuleGeometry(0.045, 0.12, 4, 8), PUP2, { y: 0.07, rx: -0.6, parent: tail, outline: 0.008 });
  statics.push([pupBody, [pupHead, tail]], [pupHead, []]);
  // the washtub by the fountain
  const WS = 1.35, WASH_W = R(D.pup + 5.0, 2.8);
  const wash = new THREE.Group(); wash.position.copy(WASH_W); wash.scale.setScalar(WS); root.add(wash);
  mesh(cyl(0.55, 0.47, 0.6, 22, true), toon(0xB07A48, { side: THREE.DoubleSide }), { y: 0.31, parent: wash, outline: 0.015 });
  mesh(cyl(0.47, 0.47, 0.3, 22), M.woodDark, { y: -0.12, parent: wash, outline: 0 });
  for (const y of [0.12, 0.5]) mesh(new THREE.TorusGeometry(0.49 + (y - 0.12) * 0.14, 0.03, 6, 26), M.gold, { y, rx: Math.PI / 2, parent: wash, outline: 0 });
  const washWater = mesh(new THREE.CircleGeometry(0.52, 24), M.water, { y: 0.5, rx: -Math.PI / 2, parent: wash, outline: 0, shadow: false });
  for (let k = 0; k < 6; k++) mesh(foamG, M.bubble, { x: Math.cos(k * 1.3) * 0.36, y: 0.53, z: Math.sin(k * 1.3) * 0.36, s: 0.06 + (k % 3) * 0.03, parent: wash, outline: 0, shadow: false });
  statics.push([wash, [washWater]]);
  const WASH_WATER_Y = WASH_W.y + 0.5 * WS;
  const washSplashAt = V(WASH_W.x, WASH_WATER_Y + 0.02, WASH_W.z);
  // the rubber duck and the rill that carries it to the music stand
  const duck = new THREE.Group(); root.add(duck);
  const duckBody = new THREE.Group(); duckBody.scale.setScalar(1.7); duck.add(duckBody);
  mesh(sph(0.11, 12, 10), M.duck, { s: [1.25, 0.85, 0.95], parent: duckBody, outline: 0.008 });
  mesh(sph(0.075, 10, 8), M.duck, { x: 0.09, y: 0.11, parent: duckBody, outline: 0.008 });
  mesh(new THREE.ConeGeometry(0.03, 0.08, 6), M.beak, { x: 0.18, y: 0.1, rz: -Math.PI / 2, parent: duckBody, outline: 0 });
  for (const sz of [-1, 1]) mesh(sph(0.014, 6, 4), M.ink, { x: 0.13, y: 0.14, z: sz * 0.04, parent: duckBody, outline: 0 });
  mesh(sph(0.05, 8, 6), M.duck, { x: -0.13, y: 0.06, s: [1, 0.6, 1.4], parent: duckBody, outline: 0.006 });
  statics.push([duckBody, []]);
  const RILL_R = 0.22, rillStart = R(D.pup + 5.75, 2.8), rillEnd = FM.W(-0.95, 0.42, 0.3);
  rillStart.y = WASH_W.y + 0.66 * WS;
  const rillPts = [];
  for (let i = 0; i <= 24; i++) { const u = i / 24, d = D.pup + 5.75 + (D.music - 0.95 - (D.pup + 5.75)) * u; const q = RA(d, 2.8 - 0.5 * u, 0); q.y = rillStart.y + (rillEnd.y - rillStart.y) * u; rillPts.push(q); }
  rillPts[rillPts.length - 1].copy(rillEnd);
  const rillCurve = new THREE.CatmullRomCurve3(rillPts, false, 'centripetal'); const RILL_LEN = rillCurve.getLength();
  const rillAxis = rillCurve.getSpacedPoints(48).map((p) => p.clone().add(V(0, RILL_R - 0.05, 0)));
  trough(conduits, rillAxis, RILL_R, toon(0xB9D7F2, { side: THREE.DoubleSide }), M.rail, { railR: 0.035, radial: 8 });
  mesh(tubeGeo(rillAxis.map((p) => p.clone().add(V(0, -0.02, 0))), { radius: RILL_R - 0.04, radial: 6, a0: Math.PI - 0.8, a1: Math.PI + 0.8, frames: 'up' }), M.rillWater, { parent: conduits, outline: 0, shadow: false });
  for (const u of [0.2, 0.6, 0.95]) { const p = rillCurve.getPointAt(u); post(conduits, p, p.y - 0.06, M.woodPlain, 0.8); }

  // =========================================================== 10 MUSIC — music stand + spiralling staff pole
  const stand = new THREE.Group(); stand.position.set(-0.25, 0, 0.3); stand.scale.setScalar(1.4); FM.g.add(stand);
  for (let k = 0; k < 3; k++) { const ang = k * 2.094 + 0.5, leg = mesh(cyl(0.022, 0.022, 0.62, 6), M.gold, { parent: stand, outline: 0.008 }); leg.position.set(Math.cos(ang) * 0.14, 0.28, Math.sin(ang) * 0.14); leg.rotation.set(Math.sin(ang) * 0.5, 0, -Math.cos(ang) * 0.5); }
  mesh(cyl(0.03, 0.03, 0.85, 8), M.gold, { y: 0.9, parent: stand, outline: 0.008 });
  const desk = new THREE.Group(); desk.position.set(0, 1.35, 0.02); desk.rotation.x = -0.35; stand.add(desk);
  mesh(rbox(0.72, 0.5, 0.04, 0.02), M.lav, { parent: desk, outline: 0.01 });
  mesh(rbox(0.74, 0.05, 0.1, 0.02), M.lav, { y: -0.25, z: 0.04, parent: desk, outline: 0.008 });
  const sheet = sheetTex();
  mesh(new THREE.PlaneGeometry(0.6, 0.42), sheet ? toon(0xFFFFFF, { map: sheet }) : M.cream, { z: 0.025, rz: 0.04, parent: desk, outline: 0, shadow: false });
  statics.push([stand, [desk]], [desk, []]);
  const NOTE_FROM = FM.W(-0.25, 1.95, 0.45);
  const POLE_H = 6.0;
  const pole = new THREE.Group(); pole.position.set(0.8, 0, 0.6); FM.g.add(pole);
  mesh(cyl(0.3, 0.36, 0.5, 16), M.lav, { y: 0.0, parent: pole, outline: 0.02 });
  mesh(cyl(0.065, 0.075, POLE_H, 10), M.cream, { y: POLE_H / 2, parent: pole, outline: 0.018 });
  const HELIX = { r: 0.34, y0: 0.75, y1: POLE_H - 0.35, turns: 2.3 };
  const helixAt = (t, off = 0, out = V()) => { const ang = t * HELIX.turns * Math.PI * 2; return out.set(Math.cos(ang) * HELIX.r, HELIX.y0 + (HELIX.y1 - HELIX.y0) * t + off, Math.sin(ang) * HELIX.r); };
  const staffParts = [];
  for (let l = 0; l < 5; l++) { const pts = []; for (let i = 0; i <= 48; i++) pts.push(helixAt(i / 48, (l - 2) * 0.055)); staffParts.push(tubeGeo(pts, { radius: 0.014, radial: 3 })); }
  const staffMat = toon(C.gold, { emissive: 0xB07A00, ei: 0.3, unique: true });
  mesh(mergeGeometries(staffParts), staffMat, { parent: pole, outline: 0, shadow: false });
  for (let k = 0; k < 5; k++) mesh(cyl(0.012, 0.012, 0.25, 4), M.gold, { x: Math.cos(k * 1.3) * 0.18, y: 0.95 + k * 0.85, z: Math.sin(k * 1.3) * 0.18, rx: Math.PI / 2, ry: -k * 1.3, s: [1, 2.8, 1], parent: pole, outline: 0, shadow: false });
  const clef = mesh(new THREE.TorusKnotGeometry(0.14, 0.04, 44, 5, 2, 3), M.gold, { y: POLE_H + 0.25, parent: pole, outline: 0.01 });
  statics.push([pole, [clef]]);
  root.updateMatrixWorld(true);
  const POLE_W = worldOf(pole);
  const noteCols = ['#F29BC8', '#B48BE0', '#6E8FE0', '#A8E0B8', '#F2C14E', '#FFB3D9'];
  const notes = [];
  for (let k = 0; k < 9; k++) {
    const tx = noteTex(noteCols[k % noteCols.length], k % 3);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, color: tx ? 0xffffff : new THREE.Color(noteCols[k % 6]), transparent: true, depthWrite: false }));
    sp.scale.setScalar(0.0001); sp.renderOrder = 6; sp.visible = false; root.add(sp); notes.push(sp);
  }

  // =========================================================== 11 BASKET — bridge lamppost with the flower-vine basket
  // The lamppost stands on the inside bank just past the bridge (clear of the deck, the parapets and a stream that may
  // run under the bridge); its curly arm reaches diagonally over the middle of the deck.
  const BLP = { x: 2.4, z: 2.6 }, BLP_Y = FBr.gy(BLP.x, BLP.z), ARM_Y = DECK + 8.9, ARM_LEN = Math.hypot(BLP.x, BLP.z);
  const bLamp = new THREE.Group(); bLamp.position.set(BLP.x, BLP_Y, BLP.z); bLamp.rotation.y = Math.atan2(BLP.x, BLP.z); FBr.g.add(bLamp);
  const BL_H = ARM_Y - BLP_Y + 0.3;
  buildLamp(bLamp, BL_H, { banner: false, lantern: 0xFFE0B0 });
  const armTop = ARM_Y - BLP_Y;
  mesh(tubeGeo(new THREE.CatmullRomCurve3([V(0, armTop - 0.35, 0), V(0, armTop + 0.06, -0.7), V(0, armTop + 0.1, -ARM_LEN * 0.6), V(0, armTop, -ARM_LEN)]).getPoints(30), { radius: 0.065, radial: 8 }), M.iron, { parent: bLamp, outline: 0.02 });
  { const sc = []; for (let i = 0; i <= 30; i++) { const t = i / 30, ang = t * Math.PI * 3.2, r = 0.45 * (1 - t * 0.75); sc.push(V(0, armTop - 0.45 - 0.15 * t + Math.sin(ang) * r * 0.6, -0.15 - t * 1.1 - Math.cos(ang) * r * 0.35)); } mesh(tubeGeo(sc, { radius: 0.03, radial: 6 }), M.iron, { parent: bLamp, outline: 0.012 }); }
  mesh(new THREE.TorusGeometry(0.09, 0.025, 6, 14), M.gold, { y: armTop - 0.08, z: -ARM_LEN, parent: bLamp, outline: 0.01 });
  for (let k = 0; k < 5; k++) mesh(k % 2 ? BLOSSOM : FMN, fmnMat, { x: 0.12 * Math.cos(k * 1.6), y: armTop + 0.02 + (k % 2) * 0.04, z: -0.6 - k * 0.55, s: 1.5, ry: Math.PI / 2, parent: bLamp, outline: 0 });
  // latch where the music arrives, turned toward the staff pole
  const LATCH_Y = armTop - 1.5;
  root.updateMatrixWorld(true);
  const poleL = FBr.g.worldToLocal(POLE_W.clone());
  const latchMount = new THREE.Group(); latchMount.position.set(BLP.x, BLP_Y + LATCH_Y, BLP.z); latchMount.rotation.y = Math.atan2(poleL.z - BLP.z, -(poleL.x - BLP.x)); FBr.g.add(latchMount);
  mesh(cyl(0.11, 0.11, 0.16, 10), M.gold, { parent: latchMount, outline: 0.012 });
  const latch = new THREE.Group(); latch.position.set(-0.1, 0, 0); latch.rotation.z = 0.15; latchMount.add(latch);
  mesh(rbox(0.42, 0.07, 0.07, 0.025), M.gold, { x: -0.2, parent: latch, outline: 0.012 });
  mesh(new THREE.TorusGeometry(0.05, 0.015, 6, 10), M.ironDark, { x: -0.42, parent: latch, outline: 0 });
  const latchEnd = new THREE.Object3D(); latchEnd.position.set(-0.42, 0, 0); latch.add(latchEnd);
  const latchHalo = halo(0xFFE7A0, 0.0001, latchMount, V(-0.3, 0, 0), 0.9);
  statics.push([bLamp, []], [latchMount, [latch]]);
  root.updateMatrixWorld(true);
  const LATCH_W = latchMount.localToWorld(V(-0.25, 0.12, 0));
  // conduit: a five-line music staff strung from the staff pole to the bridge lamppost
  const STAFF_A = POLE_W.clone().add(V(0, POLE_H - 0.15, 0)), STAFF_B = LATCH_W.clone();
  const staffAt = (k, off = 0, out = V()) => out.copy(STAFF_A).lerp(STAFF_B, k).add(V(0, off - 0.22 * 4 * k * (1 - k), 0));
  { const parts = []; for (let l = 0; l < 5; l++) { const pts = []; for (let i = 0; i <= 24; i++) pts.push(staffAt(i / 24, (l - 2) * 0.06)); parts.push(tubeGeo(pts, { radius: 0.014, radial: 4 })); } mesh(mergeGeometries(parts), staffMat, { parent: conduits, outline: 0, shadow: false }); }
  // the basket
  // Full size the basket covers 4.4-unit pawns and fits between the parapets. It hangs folded small (ARMED_SCALE) so
  // its rim is 5.5 above the deck while armed, swells to full size as it falls when it catches, and stays small and
  // swings wide when it misses (rim >= ~5 above the deck over the pawns).
  const BW = 2.15, BD = 1.22, BH = 4.9, HANDLE_TO_RIM = BH + 0.25;
  const ARMED_LEN = 0.45, ARMED_SCALE = 0.55, LAND_LEN = ARM_Y - (DECK + 0.03 + HANDLE_TO_RIM), MISS_LEN = 0.55, MISS_SCALE = 0.62, MISS_SWING = 0.72;
  const basketRig = new THREE.Group(); basketRig.position.set(0, ARM_Y, 0); FBr.g.add(basketRig);
  const bRopeG = cyl(0.03, 0.03, 1, 6, true); bRopeG.translate(0, -0.5, 0);
  const bRope = mesh(bRopeG, M.rope, { parent: basketRig, outline: 0.012 });
  const bBody = new THREE.Group(); basketRig.add(bBody);
  const bWobble = new THREE.Group(); bBody.add(bWobble);
  const DOME_POW = 0.45; const domePts = []; for (let k = 0; k <= 16; k++) { const f = ((k / 16) * Math.PI) / 2; domePts.push(new THREE.Vector2(Math.max(0.0001, Math.pow(Math.cos(f), DOME_POW)), Math.sin(f))); }
  const domeG = new THREE.LatheGeometry(domePts, 32); domeG.scale(BW, BH, BD); domeG.translate(0, -HANDLE_TO_RIM, 0);
  const wick = wickerTex(); if (wick) wick.repeat.set(12, 6.5);
  const dome = mesh(domeG, wick ? toon(0xFFFFFF, { map: wick, side: THREE.DoubleSide, alphaTest: 0.5 }) : toon(0xD9A066, { side: THREE.DoubleSide }), { parent: bWobble, outline: 0 });
  dome.castShadow = true;
  const ringG = (r, tube) => { const g = new THREE.TorusGeometry(1, tube, 6, 40); g.rotateX(Math.PI / 2); g.scale(BW * r, 1, BD * r); return g; };
  const wickerRim = toon(0xC07F45);
  mesh(ringG(1.0, 0.1), wickerRim, { y: -HANDLE_TO_RIM, parent: bWobble, outline: 0.02 });
  const bandF = 0.42, bandR = Math.pow(Math.cos(Math.asin(bandF)), DOME_POW);
  mesh(ringG(bandR + 0.01, 0.07), wickerRim, { y: -HANDLE_TO_RIM + bandF * BH, parent: bWobble, outline: 0.015 });
  mesh(new THREE.TorusGeometry(0.17, 0.045, 8, 18), wickerRim, { y: -0.13, parent: bWobble, outline: 0.015 });
  for (const sx of [-1, 1]) mesh(sph(0.1, 10, 8), M.pink, { x: sx * 0.13, y: -0.3, z: 0.05, s: [1.2, 0.7, 0.5], rz: sx * 0.4, parent: bWobble, outline: 0.012 });
  mesh(sph(0.06, 8, 6), M.pink, { y: -0.3, z: 0.08, parent: bWobble, outline: 0.01 });
  const garPts = []; for (let i = 0; i < 48; i++) { const an = (i / 48) * Math.PI * 2; garPts.push(V(Math.cos(an) * BW * 1.03, -HANDLE_TO_RIM + 0.14 + Math.sin(an * 7) * 0.07, Math.sin(an) * BD * 1.03)); }
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(garPts, true), 56, 0.035, 4, true), M.green, { parent: bWobble, outline: 0.01 });
  const garlandFlowers = [];
  for (let i = 0; i < 14; i++) {
    const an = (i / 14) * Math.PI * 2 + 0.2;
    const f = new THREE.Mesh(i % 2 ? BLOSSOM : FMN, fmnMat); f.castShadow = false;
    f.position.set(Math.cos(an) * BW * 1.06, -HANDLE_TO_RIM + 0.18 + Math.sin(an * 7) * 0.07, Math.sin(an) * BD * 1.06);
    f.lookAt(f.position.clone().multiply(V(2, 1, 2))); f.scale.setScalar(1.8);
    bWobble.add(f); garlandFlowers.push(f);
    mesh(LEAF, M.leaf, { x: f.position.x * 0.99, y: f.position.y - 0.1, z: f.position.z * 0.99, ry: -an + Math.PI / 2, rz: 2.4, outline: 0, parent: bWobble });
  }
  // dome-top flower crown (book: a vine basket with blue and pink flowers)
  for (let i = 0; i < 12; i++) {
    const s = 0.3 + (i % 3) * 0.2, an = i * 2.4; const fz = (1 - s) * Math.PI / 2, r = Math.pow(Math.cos(fz), DOME_POW) * 1.03;
    const p = V(Math.cos(an) * r * BW, -HANDLE_TO_RIM + Math.sin(fz) * BH * 1.02, Math.sin(an) * r * BD);
    const f = mesh(i % 2 ? BLOSSOM : FMN, fmnMat, { parent: bWobble, outline: 0, shadow: false }); f.position.copy(p); f.lookAt(p.clone().add(V(p.x, p.y + HANDLE_TO_RIM, p.z))); f.scale.setScalar(1.6);
  }
  const tieAnchor = new THREE.Object3D(); tieAnchor.position.set(BW * 0.55, -1.15, BD * 0.6); bWobble.add(tieAnchor);
  const domeAt = (s, an, push = 1.05) => { const f = ((1 - s) * Math.PI) / 2; const r = Math.pow(Math.cos(f), DOME_POW) * push; return V(Math.cos(an) * r * BW, -HANDLE_TO_RIM + Math.sin(f) * BH * (push - 0.02 * (1 - s)), Math.sin(an) * r * BD); };
  const wraps = [], wrapFlowers = [];
  for (let w = 0; w < 5; w++) {
    const a0 = (w / 5) * Math.PI * 2, pts = [];
    for (let i = 0; i <= 24; i++) { const s = 0.12 + (i / 24) * 0.88; pts.push(domeAt(s, a0 + s * 1.9)); }
    const g = tubeGeo(pts, { radius: 0.08, radial: 4 }); g.setDrawRange(0, 0); wraps.push(g);
    const wm = mesh(g, toon(0x6FAE5C), { parent: bWobble, outline: 0, shadow: false }); wm.userData.noBake = true;
    for (const s of [0.35, 0.75]) {
      const p = domeAt(s, a0 + s * 1.9, 1.09);
      const f = new THREE.Mesh((w + s * 10) % 2 > 1 ? BLOSSOM : FMN, vineFlowerMat); f.castShadow = false;
      f.position.copy(p); f.lookAt(p.clone().add(V(p.x, p.y + HANDLE_TO_RIM, p.z))); f.scale.setScalar(0.0001);
      bWobble.add(f); wrapFlowers.push(f);
    }
  }
  // fringe of vines that drops from the rim when the basket closes
  const fringe = new THREE.Group(); fringe.position.y = -HANDLE_TO_RIM; fringe.scale.y = 0.0001; bWobble.add(fringe);
  { const parts = []; for (let i = 0; i < 18; i++) { const an = (i / 18) * Math.PI * 2; const x = Math.cos(an) * BW * 0.99, z = Math.sin(an) * BD * 0.99; const pts = []; for (let k = 0; k <= 6; k++) pts.push(V(x + Math.sin(k * 1.3 + i) * 0.04, -k * 0.062, z)); parts.push(tubeGeo(pts, { radius: 0.035, radial: 4 })); }
    mesh(mergeGeometries(parts), toon(0x6FAE5C), { parent: fringe, outline: 0 });
    for (let i = 0; i < 18; i += 2) { const an = (i / 18) * Math.PI * 2; const f = mesh(i % 4 ? BLOSSOM : FMN, fmnMat, { x: Math.cos(an) * BW * 1.01, y: -0.3, z: Math.sin(an) * BD * 1.01, s: 1.5, parent: fringe, outline: 0, shadow: false }); f.lookAt(V(Math.cos(an) * 9, -0.3, Math.sin(an) * 9)); } }
  const basketLight = new THREE.PointLight(0xFFC8EC, 0, 6, 2); basketLight.position.set(0, -HANDLE_TO_RIM + BH * 0.45, 0); bWobble.add(basketLight);
  const sparkHolder = new THREE.Group(); sparkHolder.position.y = -HANDLE_TO_RIM + BH * 0.5; bWobble.add(sparkHolder);
  const basketSpark = makeSparkles(sparkHolder, 34, STAR, { radius: 2.5, color: 'rainbow', size: 0.26 });
  statics.push([bWobble, [tieAnchor, basketLight, sparkHolder, fringe, ...garlandFlowers, ...wrapFlowers]], [fringe, []]);
  const tieRope = new Strand(root, 7, { radius: 0.026, radial: 5, mat: M.rope });
  const tieFree = V(); let tieIsFree = false;

  // ---------------------------------------------------------------- the starlight marble (traveller for stages 3-7)
  const marble = new THREE.Group(); root.add(marble);
  const marbleMat = toon(0xFFE9A0, { emissive: 0xFFB830, ei: 1.0, unique: true });
  mesh(sph(MR, 18, 14), marbleMat, { parent: marble, outline: 0.012 });
  const marbleHalo = halo(0xFFC850, 1.6, marble, V(), 1.0);
  const travelLight = new THREE.PointLight(0xFFE2A0, 0, 5.5, 2); root.add(travelLight);

  // ---------------------------------------------------------------- particles, splash rings, bursts
  const bubbles = new Particles(root, { max: 40, geo: sph(1, 5, 3), mat: M.bubble, rise: 0.5 });
  const drops = new Particles(root, { max: 56, geo: sph(1, 5, 3), mat: toon(0xBFE3F5, { emissive: 0x4aa8d8, ei: 0.4 }), gravity: -9.5 });
  const rings = [];
  for (let i = 0; i < 4; i++) {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.56, 32), new THREE.MeshBasicMaterial({ color: 0xF4FBFF, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    r.rotation.x = -Math.PI / 2; r.visible = false; r.renderOrder = 3; root.add(r); rings.push(r);
  }
  const _r = V();
  function splash(at, power = 1, ringSet = 0) {
    for (let i = 0; i < Math.round(16 * power); i++) { const an = Math.random() * Math.PI * 2, sp = 0.7 + Math.random() * 1.3 * power; drops.emit(at, _r.set(Math.cos(an) * sp, 2.4 + Math.random() * 2.2 * power, Math.sin(an) * sp), 0.05 + Math.random() * 0.05, 0.9); }
    for (let i = 0; i < Math.round(14 * power); i++) bubbles.emit(V(at.x + (Math.random() - 0.5) * 0.7, at.y + 0.05, at.z + (Math.random() - 0.5) * 0.5), V((Math.random() - 0.5) * 0.9, 0.6 + Math.random(), (Math.random() - 0.5) * 0.9), 0.05 + Math.random() * 0.09, 1.4 + Math.random() * 1.4);
    for (let k = 0; k < 2; k++) {
      const r = rings[ringSet * 2 + k]; r.visible = true; r.position.set(at.x, at.y + 0.01, at.z);
      gsap.killTweensOf([r.scale, r.material]); r.scale.setScalar(0.3 * power); r.material.opacity = 0.95;
      gsap.to(r.scale, { x: (1.9 + k) * power, y: (1.9 + k) * power, z: (1.9 + k) * power, duration: 0.7 + k * 0.25, delay: k * 0.12, ease: 'power2.out' });
      gsap.to(r.material, { opacity: 0, duration: 0.7 + k * 0.25, delay: k * 0.12, ease: 'power1.in', onComplete: () => { r.visible = false; } });
    }
  }
  const burstHolders = [new THREE.Group(), new THREE.Group()]; root.add(...burstHolders);
  const burst = makeSparkles(burstHolders[0], 80, STAR, { radius: 0.05, color: 'rainbow', size: 0.42 });
  const burstGold = makeSparkles(burstHolders[1], 50, STAR, { radius: 0.05, color: 0xFFE59A, size: 0.38 });
  burst.mat.uniforms.uAlpha.value = burstGold.mat.uniforms.uAlpha.value = 0;
  function fireBurst(sys, at, strength = 1) { sys.pts.parent.position.copy(at); sys.age = 0; sys.strength = strength; sys.mat.uniforms.uAlpha.value = 1; }
  function stepBurst(sys, dt) {
    if (sys.age > 2) return;
    sys.age += dt; const p = sys.pts.geometry.attributes.position; const k = 1 - Math.exp(-sys.age * 3.2);
    for (let i = 0; i < sys.vel.length; i++) { const v = sys.vel[i]; p.setXYZ(i, v.x * k * 1.25 * sys.strength, v.y * k * 1.25 * sys.strength + 0.6 * k - 0.5 * sys.age * sys.age, v.z * k * 1.25 * sys.strength); }
    p.needsUpdate = true; sys.mat.uniforms.uAlpha.value = Math.max(0, 1 - sys.age / 1.8);
  }

  // ---------------------------------------------------------------- merge static parts (draw-call diet)
  for (const [c, keep] of statics) bake(c, keep);
  bake(conduits);
  if (scene) scene.add(group);
  root.updateMatrixWorld(true);

  // ================================================================= the show clock
  const T = {};
  T.bell = 0; T.net = 1.7;
  const tSlideEnd = T.net + 1.0; T.bucket = tSlideEnd + 0.15;
  const tSpill = T.bucket + 0.3, tChute0 = T.bucket + 0.46, tChute1 = tChute0 + 0.85; T.tub = tChute1 + 0.16;
  T.pipe = T.tub + 1.2;
  const tPipe1 = T.pipe + pipeSpeed.dur; T.vine = tPipe1 + 0.04;
  const tPop1 = tPipe1 + 0.4, tg0 = tPop1 - 0.05, tg1 = tg0 + 5.6; T.drop = tg1 + 0.2;
  const tLand = T.drop + 0.4, tLever1 = tLand + 0.18; T.apple = tLand + 0.12;
  const tStep0 = T.apple + 0.5, STEP_DT = 0.21, tStepsEnd = tStep0 + (STEP_N - 1) * STEP_DT, tG0 = tStepsEnd + 0.26, tG1 = tG0 + gutSpeed.dur;
  T.pup = tG1 + 0.8;
  const tLaunch = T.pup + 0.07, tSplash = tLaunch + 1.22;
  const tDuck0 = tSplash + 0.1, tDuck1 = tDuck0 + 0.36, tDuck2 = tDuck1 + RILL_LEN / 3.4; T.music = tDuck2;
  const NOTE_T0 = T.music + 0.12, NOTE_DT = 0.08, NOTE_UP = 1.25, NOTE_WIRE = 0.62;
  T.basket = NOTE_T0 + NOTE_UP + NOTE_WIRE + 0.04;
  T.caught = T.basket + 0.85; T.missed = T.basket + 0.8;
  const END = T.caught + 2.3;
  const tLoop = T.pipe + pipeSpeed.tAt(sLoop0);
  const CUES = {
    rope_tug: 0.28, net_release: T.net, bump: T.bucket, marble_spill: tSpill, tub_splash: T.tub, drain: T.pipe, loop: tLoop, pop: tPipe1,
    bloom: tg0, vine_arrive: tg1, pour: T.drop, clunk: tLand, apple_pop: T.apple, gutter: tG0, jump: tG1, boing: T.pup, woof: tLaunch,
    dog_splash: tSplash, duck_slide: tDuck1, bonk: T.music, notes_top: NOTE_T0 + NOTE_UP, latch: T.basket - 0.02, basket_land: T.caught, lift: T.caught + 1.1,
  };
  for (let i = 0; i < STEP_N - 1; i++) CUES['step_' + (i + 1)] = tStep0 + i * STEP_DT;

  // ================================================================= pose(t): every scripted motion as a pure function of time
  const S = { t: 0, playing: false, mode: { caught: true, perfect: false }, pulse: -1, bellFlash: 0, g: 0 };
  const st = { len: ARMED_LEN, swing: 0, swingX: 0, wrap: 0, scale: ARMED_SCALE };
  const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _s4 = V(), _p4 = V(), _a = V(), _b = V();
  // rest position of the rope at parameter u (0 = pulley, 1 = net pin)
  function ropePointAt(u, out = V()) { let i = 0; while (i < ropeU.length - 2 && ropeU[i + 1] < u) i++; const k = (u - ropeU[i]) / Math.max(1e-6, ropeU[i + 1] - ropeU[i]); return out.copy(ropeRest[i]).lerp(ropeRest[i + 1], clamp01(k)); }
  // the bucket mouth once the bucket has tipped over (where the marble spills from)
  bucketPivot.rotation.z = -1.75; root.updateMatrixWorld(true);
  const MOUTH_W = bucket.localToWorld(V(0, 0.62, 0)); bucketPivot.rotation.z = 0; root.updateMatrixWorld(true);
  const TUB_LAND_L = V(-0.45, 0.86, 0);

  function poseBell(t) {
    const tb = Math.max(0, t);
    bellPivot.rotation.z = damped(tb, 0.75, 12.5, 1.6);
    bellMat.emissiveIntensity = 0.4 + (t > 0 ? 1.3 * Math.exp(-3 * tb) : 0);
    S.bellFlash = t > 0 ? Math.exp(-3.5 * tb) : 0;
    S.pulse = t > 0.28 && t < T.net + 0.05 ? seg(t, 0.28, T.net - 0.02) : -1;
    pulse.visible = S.pulse > 0 && S.pulse < 1;
    if (pulse.visible) ropePointAt(S.pulse, pulse.position).y += 0.32;
  }
  function poseNet(t) {
    let s = 0, phi = 0;
    if (t > T.net - 0.18 && t < T.net) phi = -0.16 * Math.sin(Math.PI * seg(t, T.net - 0.18, T.net));
    if (t >= T.net) { const k = seg(t, T.net, tSlideEnd); s = S_STOP * k * k; phi = -0.42 * easeOut(k); }
    if (t >= tSlideEnd) { const tau = t - tSlideEnd; phi = tau < 0.15 ? -0.42 + 0.97 * easeOut(tau / 0.15) : 0.55 * Math.cos(5 * (tau - 0.15)) * Math.exp(-1.15 * (tau - 0.15)); }
    zipAt(s, netRig.position); netSwing.rotation.z = phi;
    const kp = seg(t, T.net - 0.05, T.net + 0.55);
    pin.position.set(-0.14 - 0.7 * kp, 3.45 + hop(kp, 0.45) - 1.4 * kp * kp, 0); pin.rotation.z = kp * 7; pin.visible = kp < 1;
  }
  function poseBucket(t) {
    let th = 0, q = 0;
    if (t >= T.bucket) {
      th = track(t, [[T.bucket + 0.03, 0], [T.bucket + 0.38, -1.75, easeIn], [T.bucket + 0.5, -1.58, easeOut], [T.bucket + 0.66, -1.75, easeIn]]);
      q = Math.sin(Math.PI * seg(t, T.bucket, T.bucket + 0.14));
    }
    bucketPivot.rotation.z = th; bucket.scale.set(BKS * (1 + 0.1 * q), BKS * (1 - 0.14 * q), BKS * (1 + 0.1 * q));
  }
  function poseTub(t) {
    tubWater.position.y = 0.86 + damped(t - T.tub, 0.05, 18, 3);
    const wk = t > T.tub + 0.45 && t < T.pipe + 0.6 ? Math.sin(Math.PI * seg(t, T.tub + 0.45, T.pipe + 0.6)) : 0;
    whirl.material.opacity = 0.85 * wk; whirl.rotation.z = t * 7; whirl.visible = wk > 0.01;
  }
  function poseVine(t) {
    const g = seg(t, tg0, tg1); S.g = g;
    const segs = Math.floor(g * VSEG); vineGeo.setDrawRange(0, segs * vineGeo.userData.segTris); vineMesh.visible = segs > 0;
    const gt = clamp01((g - 0.1) / 0.9 - 0.03); tendrilGeo.setDrawRange(0, Math.floor(gt * tendrilGeo.userData.segs) * tendrilGeo.userData.segTris); tendril.visible = gt > 0;
    const tip = vineAt(Math.max(0.0005, g));
    tipBud.visible = g > 0.002 && g < 0.998; tipBud.position.copy(tip.p); tipBud.quaternion.setFromUnitVectors(UP, tip.T);
    tipGlow.position.copy(tip.p); tipGlow.material.opacity = g > 0 && t < T.drop + 0.5 ? 0.7 : 0;
    if (g <= 0) cup.position.copy(POT_TOP).add(V(0, 0.12, 0)); else cup.position.copy(tip.p).add(V(0, 0.24, 0));
    const T2 = g <= 0 ? FV.t : tip.T; cup.rotation.set(0, Math.atan2(-T2.z, T2.x), 0);
    cupTilt.rotation.z = -1.3 * easeInOut(seg(t, T.drop - 0.15, T.drop + 0.22)) + 0.12 * Math.sin(Math.PI * seg(t, tPop1 - 0.05, tPop1 + 0.3));
    vineMat.emissiveIntensity = g > 0 && g < 1 ? 0.25 : 0.08;
    vineFlowerMat.emissiveIntensity = g > 0 ? 0.6 : 0;
    for (let k = 0; k < NFLOW; k++) {
      const f = flowers[k], tb = tg0 + f.u * (tg1 - tg0), sc = f.base * elasticOut(seg(t, tb + 0.04, tb + 0.6));
      f.sc = sc; _m4.compose(f.pos, f.q, _s4.setScalar(Math.max(1e-4, sc))); f.inst.setMatrixAt(f.idx, _m4);
      flowerGlow.size.setX(k, sc > 0.01 ? (0.75 + 0.9 * Math.exp(-2.5 * Math.max(0, t - tb))) * Math.min(1, sc / f.base) : 0);
    }
    for (const fi of flowI) fi.instanceMatrix.needsUpdate = true;
    flowerGlow.size.needsUpdate = true;
    for (const l of leaves) { const tb = tg0 + l.u * (tg1 - tg0); l.sc = backOut(seg(t, tb, tb + 0.32)); }
  }
  function poseDrop(t) {
    lever.rotation.z = track(t, [[tLand, LEVER_ARMED], [tLever1, LEVER_FIRED, easeIn], [tLever1 + 0.12, LEVER_FIRED - 0.08, easeOut], [tLever1 + 0.26, LEVER_FIRED, easeIn]]);
    const q = Math.sin(Math.PI * seg(t, tLand, tLand + 0.14)); bucket2.scale.set(1 + 0.1 * q, 1 - 0.14 * q, 1 + 0.1 * q);
  }
  function poseMarble(t) {
    const p = marble.position; let vis = true, sc = 1;
    if (t < tSpill) worldOf(marbleSeatA, p);
    else if (t < tChute0) { const k = seg(t, tSpill, tChute0); p.lerpVectors(MOUTH_W, C0, k); p.y += hop(k, 0.22); }
    else if (t < tChute1) { const k = seg(t, tChute0, tChute1); chuteCurve.getPointAt(Math.min(1, 0.3 * k + 0.7 * k * k), p); }
    else if (t < T.tub) { const k = seg(t, tChute1, T.tub); tub.localToWorld(_a.copy(TUB_LAND_L)); p.lerpVectors(C1, _a, k); p.y += hop(k, 0.06); }
    else if (t < T.pipe) {
      const k = t - T.tub; const lp = _a.copy(TUB_LAND_L);
      if (k < 0.22) lp.y -= 0.28 * Math.sin((Math.PI / 2) * (k / 0.22));
      else if (k < 0.5) lp.y -= 0.28 - 0.24 * sineInOut((k - 0.22) / 0.28);
      else { const kk = seg(k, 0.5, 1.05), ang = Math.PI + kk * 3 * Math.PI, r = 0.95 * (1 - kk); lp.set(DRAIN_L.x + Math.cos(ang) * r, DRAIN_L.y - 0.04 - 0.1 * kk - 0.35 * seg(k, 1.05, 1.2), Math.sin(ang) * r * 0.42); sc = 1 - 0.4 * seg(k, 1.05, 1.2); vis = k < 1.18; }
      tub.localToWorld(p.copy(lp));
    } else if (t < tPipe1) { const sM = pipeSpeed.sAt(t - T.pipe); pipeCurve.getPointAt(sM / PIPE_LEN, p); setCollars(sM); collarsBusy = true; }
    else if (t < tPop1) { const k = seg(t, tPipe1, tPop1); p.lerpVectors(pipeCurve.getPointAt(1, _a), worldOf(cupSeat, _b), k); p.y += hop(k, 0.9); }
    else if (t < T.drop + 0.12) worldOf(cupSeat, p);
    else if (t < tLand) { const k = seg(t, T.drop + 0.12, tLand); p.lerpVectors(worldOf(cupSeat, _a), worldOf(dropSeat, _b), easeIn(k)); }
    else worldOf(dropSeat, p);
    marble.visible = vis; marble.scale.setScalar(sc);
    if (collarsBusy && (t < T.pipe || t >= tPipe1)) { setCollars(null); collarsBusy = false; }
  }
  let collarsBusy = false;
  let lastAppleDir = V(1, 0, 0);
  function poseApple(t) {
    const p = apple.position, prev = _p4.copy(p); let roll = 0, sq = 0;
    if (t < T.apple) worldOf(appleSeatC, p);
    else if (t < tStep0) { const k = seg(t, T.apple, tStep0); p.lerpVectors(worldOf(appleSeatC, _a), steps[0], k); p.y += hop(k, 1.0); roll = k * 3; }
    else if (t < tStepsEnd) { const f = (t - tStep0) / STEP_DT, i = Math.min(STEP_N - 2, Math.floor(f)), k = f - i; p.lerpVectors(steps[i], steps[i + 1], k); p.y += hop(k, 0.34); roll = 3 + f * 2.2; sq = 0.28 * Math.max(0, 1 - k / 0.22); }
    else if (t < tG0) { const k = seg(t, tStepsEnd, tG0); p.lerpVectors(steps[STEP_N - 1], gutterCurve.getPointAt(0, _a), k); p.y += hop(k, 0.24); roll = 3 + (STEP_N - 1) * 2.2 + k * 2; sq = 0.28 * Math.max(0, 1 - k / 0.25); }
    else if (t < tG1) { const s = gutSpeed.sAt(t - tG0); gutterCurve.getPointAt(s / GUT_LEN, p); roll = 3 + (STEP_N - 1) * 2.2 + 2 + s / AR; sq = 0.24 * Math.max(0, 1 - (t - tG0) / 0.18); }
    else if (t < T.pup) { const k = seg(t, tG1, T.pup); p.lerpVectors(LIP_END, worldOf(seatUp, _a), k); p.y += hop(k, 3.3); roll = 3 + (STEP_N - 1) * 2.2 + 2 + GUT_LEN / AR + k * 9; }
    else { worldOf(seatUp, p); roll = 3 + (STEP_N - 1) * 2.2 + 2 + GUT_LEN / AR + 9; sq = 0.3 * Math.max(0, Math.sin(Math.PI * seg(t, T.pup, T.pup + 0.22))); }
    _b.subVectors(p, prev).setY(0); if (_b.lengthSq() > 1e-6) lastAppleDir.copy(_b.normalize());
    appleRoll.quaternion.setFromAxisAngle(_a.crossVectors(UP, lastAppleDir).normalize(), roll);
    appleSq.scale.set(1 + 0.6 * sq, 1 - sq, 1 + 0.6 * sq); appleSq.position.y = -AR * sq;
  }
  const PUP_FACE = Math.atan2(WASH_W.x - FPu.o.x, WASH_W.z - FPu.o.z);
  const WASH_IN = V(WASH_W.x, WASH_WATER_Y - 0.78, WASH_W.z);
  function posePup(t) {
    plank.rotation.z = track(t, [[T.pup, SE], [T.pup + 0.12, -SE, easeIn3], [T.pup + 0.24, -SE + 0.07, easeOut], [T.pup + 0.36, -SE, easeIn]]);
    const p = pup.position; let spin = 0, sy = 1;
    if (t < tLaunch) { worldOf(seatDn, p); const c = Math.sin(Math.PI * seg(t, T.pup - 0.02, tLaunch + 0.02)); sy = 1 - 0.18 * c; }
    else if (t < tSplash) { const k = seg(t, tLaunch, tSplash); p.lerpVectors(worldOf(seatDn, _a), WASH_IN, k); p.y += hop(k, 4.9); spin = Math.PI * 2 * easeInOut(seg(k, 0.08, 0.85)); sy = 1 + 0.12 * Math.sin(Math.PI * k); }
    else { p.copy(WASH_IN); p.y += 0.16 * easeOut(seg(t, tSplash + 0.05, tSplash + 0.4)) + 0.05 * Math.sin((t - tSplash) * 4) * seg(t, tSplash + 0.4, tSplash + 0.9); }
    pup.rotation.set(0, PUP_FACE, 0); pupSpin.rotation.x = spin; pupSpin.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
  }
  const DUCK_HOME = V().lerpVectors(WASH_W, rillStart, 0.42); DUCK_HOME.y = WASH_WATER_Y + 0.03;
  function poseDuck(t) {
    const p = duck.position; let T2 = null;
    if (t < tDuck0) p.copy(DUCK_HOME);
    else if (t < tDuck1) { const k = seg(t, tDuck0, tDuck1); p.lerpVectors(DUCK_HOME, rillCurve.getPointAt(0, _a), k); p.y += hop(k, 0.75); }
    else if (t < tDuck2) { const k = seg(t, tDuck1, tDuck2); const u = 0.35 * k + 0.65 * k * k; rillCurve.getPointAt(u, p); T2 = rillCurve.getTangentAt(u, _b); }
    else { const u = 1 - 0.14 * Math.sin(Math.PI * seg(t, tDuck2, tDuck2 + 0.45)) - 0.05 * seg(t, tDuck2 + 0.45, tDuck2 + 0.8); rillCurve.getPointAt(Math.min(1, u), p); T2 = rillCurve.getTangentAt(Math.min(1, u), _b); }
    if (!T2) T2 = rillCurve.getTangentAt(0, _b);
    duck.rotation.set(0, Math.atan2(-T2.z, T2.x), 0);
  }
  const NOTE_JIT = notes.map((_, k) => V(Math.sin(k * 2.3) * 0.18, Math.cos(k * 1.7) * 0.1, Math.sin(k * 3.1) * 0.1));
  const HELIX_TOP = V();
  function poseMusic(t) {
    stand.rotation.z = damped(t - T.music + 0.02, 0.35, 11, 2.6); stand.rotation.x = damped(t - T.music + 0.02, -0.14, 9, 2.6);
    staffMat.emissiveIntensity = 0.3 + 1.0 * Math.sin(Math.PI * seg(t, T.music + 0.3, T.basket + 0.8));
    const h = _a;
    notes.forEach((n, k) => {
      const s0 = NOTE_T0 + k * NOTE_DT, s1 = s0 + NOTE_UP, s2 = s1 + NOTE_WIRE, s3 = s2 + 0.18;
      if (t < s0 || t > s3) { n.visible = false; return; }
      n.visible = true; const off = ((k % 5) - 2) * 0.06, sz = 0.62 + (k % 3) * 0.08;
      let scl = sz * backOut(seg(t, s0, s0 + 0.22));
      if (t < s1) {
        const k2 = sineInOut(seg(t, s0, s1));
        if (k2 < 0.25) { const u = k2 / 0.25; helixAt(0, off, h).add(POLE_W); n.position.lerpVectors(_b.copy(NOTE_FROM).add(NOTE_JIT[k]), h, u); n.position.y += 0.9 * Math.sin(u * Math.PI); }
        else { helixAt((k2 - 0.25) / 0.75, off, h).add(POLE_W); n.position.copy(h); }
      } else if (t < s2) {
        const u = easeIn(seg(t, s1, s2)) * 0.85 + 0.15 * seg(t, s1, s2);
        staffAt(u, off, n.position); if (u < 0.2) { helixAt(1, off, HELIX_TOP).add(POLE_W); n.position.lerp(HELIX_TOP, 1 - u / 0.2); }
      } else { staffAt(1, off, n.position); scl = sz * (1 - seg(t, s2, s3)); }
      n.scale.setScalar(Math.max(1e-4, scl)); n.material.rotation = Math.sin(t * 9 + k) * 0.35;
    });
  }
  const TIE_ARMED = V();
  function poseBasket(t) {
    const caught = S.mode.caught, perfect = S.mode.perfect;
    latch.rotation.z = t < T.basket - 0.02 ? 0.15 : 0.15 - 1.4 * backOut(seg(t, T.basket - 0.02, T.basket + 0.16));
    latchHalo.scale.setScalar(Math.max(1e-4, 1.8 * Math.sin(Math.PI * seg(t, T.basket - 0.3, T.basket + 0.5))));
    tieIsFree = t >= T.basket;
    if (tieIsFree) { const k = easeIn(seg(t, T.basket, T.basket + 0.7)); tieFree.lerpVectors(TIE_ARMED, LATCH_W.clone().add(V(0, -1.6, 0)), k); }
    const B = T.basket, Cc = T.caught;
    if (caught) {
      st.len = track(t, [[B + 0.1, ARMED_LEN], [Cc, LAND_LEN, easeIn], [Cc + 0.13, LAND_LEN - 0.22, easeOut], [Cc + 0.26, LAND_LEN, easeIn], [Cc + 0.33, LAND_LEN - 0.06, easeOut], [Cc + 0.4, LAND_LEN, easeIn], [Cc + 1.1, LAND_LEN], [Cc + 1.65, LAND_LEN - 0.5, (k) => backOut(k, 1.6)]]);
      st.scale = track(t, [[B + 0.05, ARMED_SCALE], [Cc - 0.15, 1, easeOut]]);
      st.swing = track(t, [[B, 0], [B + 0.3, -0.2, sineOut], [B + 0.85, 0, sineInOut]]);
      st.swingX = 0;
      st.wrap = easeInOut(seg(t, Cc + 0.15, Cc + 1.05));
      fringe.scale.y = Math.max(1e-4, backOut(seg(t, Cc + 0.9, Cc + 1.45)));
      wrapFlowers.forEach((f, i) => f.scale.setScalar(Math.max(1e-4, 1.6 * backOut(seg(t, Cc + 0.55 + (i % 3) * 0.12 + i * 0.015, Cc + 0.95 + (i % 3) * 0.12 + i * 0.015)))));
      const q = Math.sin(Math.PI * seg(t, Cc, Cc + 0.3)); bWobble.scale.set(1 + 0.08 * q, 1 - 0.05 * q, 1 + 0.08 * q);
      bWobble.rotation.set(0, 0, 0.05 * Math.sin((t - Cc - 1.2) * 34) * (t > Cc + 1.2 && t < Cc + 1.9 ? 1 - seg(t, Cc + 1.2, Cc + 1.9) : 0));
      basketLight.intensity = track(t, [[B, 0], [B + 0.4, 1.5], [Cc + 1.05, 1.5], [Cc + 1.3, perfect ? 9 : 6], [Cc + 2.3, 2.5]]);
    } else {
      // missed: a short lurch, then it swoops WIDE past everyone (rim ~3 above the deck when it passes over them)
      // and ends hooked out to the side, high and clear of the pawns, still wobbling
      const M0 = T.missed;
      st.len = track(t, [[B + 0.1, ARMED_LEN], [B + 0.55, MISS_LEN, easeIn]]);
      st.scale = track(t, [[B + 0.05, ARMED_SCALE], [B + 0.5, MISS_SCALE, easeOut]]);
      st.swing = track(t, [[B + 0.02, 0], [B + 0.4, -0.45, sineOut], [M0 + 0.3, MISS_SWING + 0.28, sineInOut], [M0 + 0.75, MISS_SWING - 0.16, sineInOut],
        [M0 + 1.15, MISS_SWING + 0.09, sineInOut], [M0 + 1.5, MISS_SWING - 0.04, sineInOut], [M0 + 1.85, MISS_SWING, sineInOut]]) + (t > M0 + 1.85 ? 0.035 * Math.sin((t - M0 - 1.85) * 7) : 0);
      st.swingX = 0; st.wrap = 0; fringe.scale.y = 1e-4;
      wrapFlowers.forEach((f) => f.scale.setScalar(1e-4)); bWobble.scale.set(1, 1, 1);
      const wob = t > M0 ? Math.exp(-0.9 * (t - M0)) : 0, sway = t > M0 ? 0.06 + 0.14 * wob : 0;
      bWobble.rotation.set(0.1 * wob * Math.sin((t - M0) * 9) + 0.03 * Math.sin(t * 5), sway * Math.sin((t - M0) * 6.5), 0);
      basketLight.intensity = track(t, [[B, 0], [B + 0.4, 1.5], [M0 + 0.4, 1.5], [M0 + 1.6, 0]]);
    }
    applyBasket(lastT);
  }
  function poseLight(t) {
    if (t < 1.2) { worldOf(bellPivot, travelLight.position).y -= 0.5; travelLight.intensity = 5 * S.bellFlash; }
    else if (t > T.bucket - 0.1 && t < tLand + 0.6) { travelLight.position.copy(marble.position).y += 0.25; travelLight.intensity = 1.6 * (1 - seg(t, tLand, tLand + 0.6)); }
    else if (t > NOTE_T0 && t < T.basket + 0.4 && notes[0].visible) { travelLight.position.copy(notes[0].position); travelLight.intensity = 1.2; }
    else travelLight.intensity = 0;
  }
  function pose(t) {
    S.t = t;
    poseBell(t); poseNet(t); poseBucket(t); poseTub(t); poseVine(t); poseDrop(t); poseMarble(t); poseApple(t); posePup(t); poseDuck(t); poseMusic(t); poseBasket(t); poseLight(t);
  }
  // effects that fire once while playing (not when scrubbing or rewinding)
  function fx() {
    const caught = S.mode.caught, perfect = S.mode.perfect;
    const list = [
      [0.0, () => fireBurst(burstGold, worldOf(bellPivot).add(V(0, -0.5, 0)), perfect ? 1.2 : 0.8)],
      [T.tub, () => splash(tub.localToWorld(V(-0.45, 0.88, 0)), 0.9, 0)],
      [T.pipe - 0.1, () => { const d = tub.localToWorld(V(0.5, 0.88, 0)); for (let i = 0; i < 8; i++) bubbles.emit(d.clone().add(V((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3)), V(0, 0.5 + Math.random() * 0.5, 0), 0.05 + Math.random() * 0.05, 1.2); }],
      [tPipe1, () => fireBurst(burst, POT_TOP.clone().add(V(0, 0.4, 0)), 1.0)],
      [tLand, () => fireBurst(burstGold, DROP_MOUTH.clone(), 0.7)],
      [tSplash, () => splash(washSplashAt, 1.4, 1)],
      [T.music, () => fireBurst(burst, NOTE_FROM.clone(), 0.8)],
      [T.basket - 0.02, () => fireBurst(burstGold, LATCH_W.clone(), 0.6)],
    ];
    if (caught) {
      list.push([T.caught, () => fireBurst(burstGold, FBr.W(0, DECK + 0.25, 0), 1.6)]);
      list.push([T.caught + 1.15, () => fireBurst(burst, FBr.W(0, DECK + 3.0, 0), perfect ? 3.4 : 2.4)]);
      if (perfect) list.push([T.caught + 1.6, () => fireBurst(burstGold, FBr.W(0, DECK + 4.6, 0), 3.0)]);
    }
    return list;
  }

  // ================================================================= idle motion
  const _fx = V(), _fy = V(), _fz = V(), _fy2 = V(), _fz2 = V();
  function ropeTick(time) {
    const uP = S.pulse;
    for (let i = 0; i < ropeRest.length; i++) {
      const q = rope.pts[i].copy(ropeRest[i]);
      if (uP > 0) { const d = (ropeU[i] - uP) / 0.035; q.y += 0.32 * Math.exp(-d * d); }
      q.y += Math.sin(time * 1.6 + ropeU[i] * 9) * 0.015 * Math.sin(Math.PI * ropeU[i]);
    }
    rope.commit();
    for (let f = 0; f < FLAGS; f++) {
      const fi = flagIdx[f], a = rope.pts[fi.i], b = rope.pts[fi.i + 1];
      _p4.copy(a).lerp(b, fi.k); _fx.subVectors(b, a).setY(0).normalize();
      const flick = uP > 0 ? 1.25 * Math.exp(-(((fi.u - uP) / 0.06) ** 2)) : 0;
      const ang = flick + 0.14 * Math.sin(time * 2.2 + f * 1.3);
      _fy.set(0, 1, 0); _fz.crossVectors(_fx, _fy);
      _fy2.copy(_fy).multiplyScalar(Math.cos(ang)).addScaledVector(_fz, Math.sin(ang));
      _fz2.copy(_fz).multiplyScalar(Math.cos(ang)).addScaledVector(_fy, -Math.sin(ang));
      _m4.makeBasis(_fx, _fy2, _fz2).setPosition(_p4.x, _p4.y - 0.02, _p4.z);
      flagMesh.setMatrixAt(f, _m4); flagInk.setMatrixAt(f, _m4);
    }
    flagMesh.instanceMatrix.needsUpdate = true; flagInk.instanceMatrix.needsUpdate = true;
  }
  const leafBase = leaves.map((l) => { const a = vineAt(l.u); return { p: a.p.clone().addScaledVector(a.B, l.side * 0.1), out: a.B.clone().multiplyScalar(l.side), T: a.T.clone() }; });
  function leafTick(time) {
    for (let i = 0; i < NLEAF; i++) {
      const l = leaves[i], b = leafBase[i];
      if (l.sc < 0.002) { _m4.makeScale(1e-5, 1e-5, 1e-5); leafI.setMatrixAt(i, _m4); continue; }
      const r = 0.16 * Math.sin(time * 2.1 + l.ph);
      _fy.copy(b.out).addScaledVector(b.T, 0.35).addScaledVector(UP, 0.25 + r).normalize();
      _fz.copy(UP).addScaledVector(_fy, -_fy.y).normalize(); _fx.crossVectors(_fy, _fz);
      _m4.makeBasis(_fx, _fy, _fz).scale(_s4.setScalar(l.sc * 1.15)).setPosition(b.p);
      leafI.setMatrixAt(i, _m4);
    }
    leafI.instanceMatrix.needsUpdate = true;
  }
  const TUB_BUBBLE = tub.localToWorld(V(-0.2, 0.9, 0));
  let bubbleClock = 0, washClock = 0, lastT = 0;
  function applyBasket(time) {
    basketRig.rotation.z = st.swing + (S.playing ? 0 : Math.sin(time * 0.9) * 0.012);
    basketRig.rotation.x = st.swingX;
    bRope.scale.y = st.len; bBody.position.y = -st.len; bBody.scale.setScalar(st.scale);
    for (const g of wraps) { const n = g.index ? g.index.count : g.attributes.position.count; g.setDrawRange(0, Math.floor((n * st.wrap) / 6) * 6); }
  }
  function update(dt = 0.016, time) {
    dt = Math.min(Math.max(dt || 0, 0), 0.05);
    if (time === undefined) time = lastT + dt; lastT = time;
    bellIdle.rotation.z = Math.sin(time * 1.7) * 0.05;
    bellHalo.scale.setScalar(1.3 + 2.2 * S.bellFlash + Math.sin(time * 2.3) * 0.08); bellHalo.material.opacity = 0.45 + 0.4 * S.bellFlash;
    ropeTick(time);
    netBody.rotation.z = S.t < T.net - 0.2 || S.t > T.bucket + 4 ? Math.sin(time * 1.3) * 0.04 : 0;
    tail.rotation.z = Math.sin(time * 11) * 0.55;
    pupHead.rotation.z = Math.sin(time * 1.3) * 0.12; pupHead.rotation.x = Math.sin(time * 0.7) * 0.06;
    pupBody.scale.set(PS, PS * (1 + Math.sin(time * 3.2) * 0.025), PS);
    leafTick(time);
    const pul = Math.sin(time * 5);
    marbleHalo.scale.setScalar(1.5 + 0.3 * pul); marbleMat.emissiveIntensity = 0.95 + 0.25 * pul;
    if (S.t < tDuck0 || S.t > tDuck2 + 0.8) { duck.position.y += Math.sin(time * 2.6) * 0.0025; duck.rotation.z = Math.sin(time * 2.1) * 0.08; }
    clef.rotation.y = time * 0.8;
    garlandFlowers.forEach((f, i) => { f.rotation.z = Math.sin(time * 1.4 + i) * 0.25; });
    flowerGlow.mat.uniforms.uAlpha.value = 0.7 + 0.12 * Math.sin(time * 3.1);
    tipGlow.scale.setScalar(1.2 + 0.2 * Math.sin(time * 6));
    basketSpark.mat.uniforms.uTime.value = time; burst.mat.uniforms.uTime.value = time; burstGold.mat.uniforms.uTime.value = time;
    stepBurst(burst, dt); stepBurst(burstGold, dt);
    bubbleClock += dt; washClock += dt;
    if (bubbleClock > 0.45) { bubbleClock = 0; bubbles.emit(V(TUB_BUBBLE.x + (Math.random() - 0.5) * 0.6, TUB_BUBBLE.y, TUB_BUBBLE.z + (Math.random() - 0.5) * 0.4), V(0, 0.25 + Math.random() * 0.2, 0), 0.04 + Math.random() * 0.06, 2.2 + Math.random()); }
    if (washClock > 0.8) { washClock = 0; bubbles.emit(V(WASH_W.x + (Math.random() - 0.5) * 0.7, WASH_WATER_Y + 0.04, WASH_W.z + (Math.random() - 0.5) * 0.7), V(0, 0.2 + Math.random() * 0.2, 0), 0.04 + Math.random() * 0.05, 2 + Math.random()); }
    bubbles.update(dt, time); drops.update(dt, time);
    applyBasket(time);
    // ropes that follow moving anchors
    worldOf(bellLip, _a); _b.copy(PULLEY_W);
    for (let i = 0; i <= bellTug.n; i++) { const k = i / bellTug.n; bellTug.pts[i].lerpVectors(_a, _b, k); bellTug.pts[i].y -= 0.06 * Math.sin(Math.PI * k); }
    bellTug.commit();
    worldOf(latchEnd, _a); if (tieIsFree) _b.copy(tieFree); else worldOf(tieAnchor, _b);
    for (let i = 0; i <= tieRope.n; i++) { const k = i / tieRope.n; tieRope.pts[i].lerpVectors(_a, _b, k); tieRope.pts[i].y -= (tieIsFree ? 0.05 : 0.25) * Math.sin(Math.PI * k); }
    tieRope.commit();
  }

  // ================================================================= play / reset
  let tl = null, rewindTw = null, pending = null;
  function settle() { const r = pending; pending = null; if (r) r(); }
  function clearFx() {
    drops.clear(); burst.age = burstGold.age = 99; burst.mat.uniforms.uAlpha.value = burstGold.mat.uniforms.uAlpha.value = 0;
    rings.forEach((r) => { gsap.killTweensOf([r.scale, r.material]); r.visible = false; r.material.opacity = 0; });
  }
  // reset(): settles any running play() at once, then rewinds the machine in a short reverse flourish (<= 1.35 s).
  // Idempotent: a second call while rewinding (or when already armed) does nothing new.
  function reset() {
    if (tl) { tl.kill(); tl = null; }
    S.playing = false;
    settle();
    if (rewindTw) return;
    clearFx();
    if (S.t <= 1e-4) { pose(0); return; }
    const proxy = { t: S.t };
    rewindTw = gsap.to(proxy, { t: 0, duration: Math.min(1.35, 0.45 + S.t * 0.03), ease: 'power2.inOut', onUpdate: () => pose(proxy.t), onComplete: () => { rewindTw = null; pose(0); } });
  }
  function play({ caught = true, perfect = false, onStage, onCue } = {}) {
    if (tl) { tl.kill(); tl = null; }
    if (rewindTw) { rewindTw.kill(); rewindTw = null; }
    settle(); clearFx();
    S.mode = { caught: !!caught, perfect: !!perfect };
    pose(0); S.playing = true;
    return new Promise((resolve) => {
      pending = resolve;
      const proxy = { t: 0 };
      const tlx = gsap.timeline({ onComplete: () => { if (tl === tlx) { tl = null; S.playing = false; } settle(); } });
      tl = tlx;
      tlx.to(proxy, { t: END, duration: END, ease: 'none', onUpdate: () => pose(proxy.t) }, 0);
      const fire = (id) => { try { if (onStage) onStage(id); } catch (e) { console.error('[catcher] onStage handler failed', e); } };
      for (const id of ORDER) tlx.call(fire, [id], T[id]);
      const endId = S.mode.caught ? 'caught' : 'missed';
      tlx.call(fire, [endId], T[endId]);
      if (onCue) { const cue = (n) => { try { onCue(n); } catch (e) { console.error('[catcher] onCue handler failed', e); } }; for (const [n, at] of Object.entries(CUES)) if (n !== 'basket_land' || S.mode.caught) tlx.call(cue, [n], at); }
      for (const [at, fn] of fx()) tlx.call(fn, null, at);
    });
  }

  // ================================================================= bridge slots, basket position, camera path (world space)
  pose(0);
  TIE_ARMED.copy(worldOf(tieAnchor));
  const bridgeSlots = [[0, 0.4], [-0.8, 0.4], [0.8, 0.4], [0, -0.4], [-0.8, -0.4], [0.8, -0.4]].map(([x, z]) => FBr.W(x, DECK, z));
  const basketWorldPos = FBr.W(0, ARM_Y - (LAND_LEN - 0.5) - HANDLE_TO_RIM + BH * 0.42, 0);
  const dOfT = (t) => { for (let i = 0; i < ORDER.length - 1; i++) { const a = ORDER[i], b = ORDER[i + 1]; if (t <= T[b]) return D[a] + (D[b] - D[a]) * seg(t, T[a], T[b]); } return D.basket; };
  function nearestD(p, guess) { let best = guess, bd = Infinity; for (let d = guess - 10; d <= guess + 10; d += 0.2) { const f = L.pointAt(d); const dd = (f.x - p.x) ** 2 + (f.z - p.z) ** 2; if (dd < bd) { bd = dd; best = d; } } return best; }
  function travellerAt(t) {
    pose(t);
    if (t < 0.45) return worldOf(bellPivot, V()).add(V(0, -0.45, 0));
    if (t < T.net) return pulse.visible ? pulse.position.clone() : PIN_W.clone();
    if (t < T.bucket) return worldOf(netHoop, V());
    if (t < T.apple) return marble.position.clone();
    if (t < tLaunch) return apple.position.clone();
    if (t < tSplash + 0.15) return pup.position.clone().add(V(0, 0.7, 0));
    if (t < T.music + 0.1) return duck.position.clone();
    if (t < T.basket) return notes[0].visible ? notes[0].position.clone() : POLE_W.clone().add(V(0, 2.5, 0));
    bBody.updateWorldMatrix(true, false); return bBody.localToWorld(V(0, -HANDLE_TO_RIM + BH * 0.42, 0));
  }
  // [time, lateral offset from the route centre (+ = inside the loop), along (+ = ahead), height above the target, look lift]
  // Keys hug the machine lane (inside the loop, a little behind the traveller and well above it) so village
  // buildings set further inside never come between the camera and the action.
  const CAM_KEYS = [
    [0.0, 7.6, 0.6, 3.6, 0],                          // the bell rings
    [1.0, 7.2, -2.6, 4.6, 0],                         // the tug runs along the bunting rope
    [T.net + 0.45, 7.0, -3.0, 4.8, 0],                // the net zips down its line
    [T.bucket + 0.6, 7.0, -3.0, 5.0, 0],              // the marble spills down the chute
    [T.tub + 0.5, 7.0, -2.6, 5.0, 0],                 // splash, swirl, down the drain
    [tLoop + 0.25, 7.0, -2.8, 4.8, 0.2],              // loop-the-loop at the garden gate
    [tPipe1 - 0.6, 7.2, -3.0, 5.0, 0],                // along the west lane
    [tg0 + 1.2, 7.4, -3.0, 4.8, 0],                   // the beanstalk sprouts
    [tg0 + 3.0, 7.4, -3.0, 4.6, 0],                   // ...and climbs the hill path
    [tg1 - 0.4, 7.4, -3.0, 4.4, 0],                   // ...to the castle gate
    [tLand + 0.05, 7.6, -1.5, 4.2, 0],                // the marble drops, the lever flips
    [tStep0 + 0.6, 7.4, -3.0, 4.6, 0],                // the apple bounces down the steps
    [tG0 + (tG1 - tG0) * 0.45, 7.2, -3.0, 5.2, 0],    // ...rolls the bakery street
    [tG1 + 0.35, 6.4, -2.8, 3.8, 0],                  // ...and jumps over the path
    [tLaunch + 0.6, 6.2, -1.8, 2.2, 0],               // Charli's cannonball
    [tSplash + 0.6, 7.2, -2.4, 4.0, 0],               // splash; the duck hops into the rill
    [T.music + 0.7, 8.0, -2.6, 3.4, 0],               // notes spiral up the staff pole
    [T.basket - 0.3, 8.6, -3.0, 5.2, 0],              // ...and zip along the staff wire to the latch (from the inside, above the pawns)
    [T.caught + 0.5, -7.5, -5.0, 5.0, 0],             // the basket drops over the bridge
    [END, -12.0, -2.5, 4.6, 1.4],                     // pull back over the bridge (looks a bit high so a missed basket stays in frame)
  ];
  const camPos = [], camTarget = [], camTimes = [];
  for (const [t, lat, along, h, lift] of CAM_KEYS) {
    const tg = travellerAt(t); tg.y += lift;
    const f = rf(nearestD(tg, dOfT(t)));
    const p = V(f.x + f.n.x * lat + f.t.x * along, tg.y + h, f.z + f.n.z * lat + f.t.z * along);
    p.sub(tg).multiplyScalar(1.12).add(tg); // ~8-12 units from the action
    p.y = Math.max(p.y, GH(p.x, p.z) + 2.5);
    camPos.push(p); camTarget.push(tg); camTimes.push(+t.toFixed(3));
  }
  pose(0);
  const _h0 = V(), _h1 = V();
  function hermite(ts, arr, t, out) {
    const n = ts.length; if (t <= ts[0]) return out.copy(arr[0]); if (t >= ts[n - 1]) return out.copy(arr[n - 1]);
    let i = 0; while (i < n - 2 && t > ts[i + 1]) i++;
    const t0 = ts[i], t1 = ts[i + 1], h = t1 - t0, k = (t - t0) / h;
    const m0 = i > 0 ? _h0.subVectors(arr[i + 1], arr[i - 1]).multiplyScalar(h / (ts[i + 1] - ts[i - 1])) : _h0.set(0, 0, 0);
    const m1 = i < n - 2 ? _h1.subVectors(arr[i + 2], arr[i]).multiplyScalar(h / (ts[i + 2] - ts[i])) : _h1.set(0, 0, 0);
    const k2 = k * k, k3 = k2 * k;
    return out.copy(arr[i]).multiplyScalar(2 * k3 - 3 * k2 + 1).addScaledVector(m0, k3 - 2 * k2 + k).addScaledVector(arr[i + 1], -2 * k3 + 3 * k2).addScaledVector(m1, k3 - k2);
  }
  const cameraPath = {
    pos: camPos, target: camTarget, times: camTimes, duration: END,
    // smooth (C1) sampler through the keyframes, by show time: sample(t, outPos, outTarget)
    sample(t, outPos = V(), outTarget = V()) { hermite(camTimes, camPos, t, outPos); hermite(camTimes, camTarget, t, outTarget); return { pos: outPos, target: outTarget }; },
  };

  return {
    group, update, reset, play, bridgeSlots, cameraPath, basketWorldPos,
    stages: [...ORDER], duration: END,
    stageTimes: { ...T }, cues: { ...CUES },
    // test helpers: pose the machine at show time t without playing (mode = { caught, perfect })
    seek(t, mode) { if (mode) S.mode = { caught: mode.caught !== false, perfect: !!mode.perfect }; if (tl) { tl.pause(); } pose(Math.max(0, Math.min(END, t))); },
    get timeline() { return tl; }, get time() { return S.t; },
    _debug: { D, T, PIPE_LEN, VINE_LEN, GUT_LEN, RILL_LEN, parts: { apple, pup, marble, duck, notes, basketRig, bBody }, travellerAt: (t) => { const p = travellerAt(t); pose(S.t); return p; } },
  };
}
