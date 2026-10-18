// Storybook village diorama v2 for the Kyah & Ayva board: the route winds through the village.
// createVillage({ scene, layout, textures, images, sky }) builds the terrain from layout.heightAt (carved for the
// path, the building pads and the river), the cobble path with stone steps on the hills, the 32 tiles, the river
// with its stone bridge, the castle on its hill, the Sunbeam Bakery, the Puddle Paws Pet Wash, the fountain square,
// cottages, lampposts with heart banners, Grabble's hideout, the flower garden, trees and ambient life.
// Returns { group, update(dt, t), tiles, setTileHighlight(i, on), bridgeAnchor, heightAt, deckHeight, ... }.
// Procedural geometry only; textures/images are optional extras (tile icons, cobble/stone textures).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------- constants
const TAU = Math.PI * 2;
const HALF = 35, CORNER = 7;             // board half size and rounded-corner radius
const SOIL_Y = -2.2;                     // bottom of the soil skirt / top of the wooden base
const PATH_HW = 1.3;                     // half width of the cobble path
const LAND_H = 1.3;                      // half length of the flat landing under each tile
const BLEND = 1.7;                       // terrain blend width beside the path
const CORRIDOR = 1.6, CLEAR_R = 3.5;     // keep-free volumes for the Catcher machine
const DECK_TOP = 0.10;                   // bridge deck top at its centre (pawns stand here)
const BRIDGE_HL = 2.3, BRIDGE_HW = 1.6;  // bridge half length (along the route) / half width (across)
const BANK = 0.85;                       // river bank width
const TILE_R = 1.2;
const INK = 0x2B2440, INK_CSS = '#2B2440';
const FONT = '"Fredoka", "Baloo 2", "Chalkboard SE", "Comic Sans MS", system-ui, sans-serif';

// ---------------------------------------------------------------- small utils
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
let rnd = mulberry32(20261018);
const rand = (a = 0, b = 1) => a + (b - a) * rnd();
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
function hash2(ix, iy) { let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function vnoise(x, y) { const ix = Math.floor(x), iy = Math.floor(y); const fx = x - ix, fy = y - iy; const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); return lerp(lerp(hash2(ix, iy), hash2(ix + 1, iy), sx), lerp(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), sx), sy); }
const fbm = (x, y) => vnoise(x, y) * 0.65 + vnoise(x * 2.13 + 5.2, y * 2.13 - 1.7) * 0.35;
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function mat4(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}
// F(lx,ly,lz, rx,ry,rz, sx,sy,sz) -> world matrix inside a local frame at (x,y,z) turned by yaw (and uniformly scaled)
function frameAt(x, y, z, yaw = 0, s = 1) {
  const base = mat4(x, y, z, 0, yaw, 0, s);
  return (lx = 0, ly = 0, lz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => base.clone().multiply(mat4(lx, ly, lz, rx, ry, rz, sx, sy, sz));
}
const yawToward = (fx, fz) => Math.atan2(fx, fz);           // local +z faces (fx, fz)
const fwd = (yaw) => [Math.sin(yaw), Math.cos(yaw)];          // world xz of local +z
function mixCss(a, b, t) { return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString(); }
const wrapD = (d, L) => ((d % L) + L) % L;

// geometry shorthands
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 16, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open);
const sph = (r, ws = 12, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
const cone = (r, h, s = 16) => new THREE.ConeGeometry(r, h, s);
function archShape(w, h) { const s = new THREE.Shape(); const r = w / 2; s.moveTo(-r, 0); s.lineTo(r, 0); s.lineTo(r, h - r); s.absarc(0, h - r, r, 0, Math.PI, false); s.lineTo(-r, 0); return s; }
function archGeo(w, h, depth) { const g = new THREE.ExtrudeGeometry(archShape(w, h), { depth, bevelEnabled: false, curveSegments: 10 }); g.translate(0, 0, -depth / 2); return g; }
function prismX(span, rise, len) { const s = new THREE.Shape(); s.moveTo(-span / 2, 0); s.lineTo(span / 2, 0); s.lineTo(0, rise); s.closePath(); const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false }); g.translate(0, 0, -len / 2); g.rotateY(Math.PI / 2); return g; }
function heartShape(s, cx = 0, cy = 0) {
  const p = new THREE.Shape(); const X = (v) => cx + v * s, Y = (v) => cy + v * s;
  p.moveTo(X(0), Y(-0.5)); p.bezierCurveTo(X(-0.15), Y(-0.35), X(-0.55), Y(-0.1), X(-0.55), Y(0.18));
  p.bezierCurveTo(X(-0.55), Y(0.45), X(-0.2), Y(0.58), X(0), Y(0.32)); p.bezierCurveTo(X(0.2), Y(0.58), X(0.55), Y(0.45), X(0.55), Y(0.18));
  p.bezierCurveTo(X(0.55), Y(-0.1), X(0.15), Y(-0.35), X(0), Y(-0.5)); return p;
}
function roundRectShape(h, r) { const s = new THREE.Shape(); s.moveTo(-h + r, -h); s.lineTo(h - r, -h); s.absarc(h - r, -h + r, r, -Math.PI / 2, 0, false); s.lineTo(h, h - r); s.absarc(h - r, h - r, r, 0, Math.PI / 2, false); s.lineTo(-h + r, h); s.absarc(-h + r, h - r, r, Math.PI / 2, Math.PI, false); s.lineTo(-h, -h + r); s.absarc(-h + r, -h + r, r, Math.PI, Math.PI * 1.5, false); return s; }

// ---------------------------------------------------------------- board outline (rounded square)
function boardSD(x, z) { const qx = Math.abs(x) - (HALF - CORNER), qz = Math.abs(z) - (HALF - CORNER); return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - CORNER; }
function clampBoard(x, z) {
  x = clamp(x, -HALF, HALF); z = clamp(z, -HALF, HALF);
  const k = HALF - CORNER;
  if (Math.abs(x) > k && Math.abs(z) > k) { const cx = Math.sign(x) * k, cz = Math.sign(z) * k; const vx = x - cx, vz = z - cz; const l = Math.hypot(vx, vz); if (l > CORNER) { x = cx + vx / l * CORNER; z = cz + vz / l * CORNER; } }
  return [x, z];
}

// ---------------------------------------------------------------- spatial index of line segments (route, rivers)
class SegIndex {
  constructor(cell, reach) { this.c = cell; this.r = reach; this.map = new Map(); this.segs = []; }
  key(ix, iz) { return (ix + 4096) * 8192 + (iz + 4096); }
  add(ax, az, bx, bz, data) {
    const i = this.segs.length; this.segs.push({ ax, az, bx, bz, data }); const c = this.c, r = this.r;
    const x0 = Math.floor((Math.min(ax, bx) - r) / c), x1 = Math.floor((Math.max(ax, bx) + r) / c), z0 = Math.floor((Math.min(az, bz) - r) / c), z1 = Math.floor((Math.max(az, bz) + r) / c);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) { const k = this.key(ix, iz); let l = this.map.get(k); if (!l) this.map.set(k, l = []); l.push(i); }
  }
  nearest(x, z) {
    const list = this.map.get(this.key(Math.floor(x / this.c), Math.floor(z / this.c))); if (!list) return null;
    let best = Infinity, bs = null, bt = 0;
    for (const i of list) {
      const s = this.segs[i]; const dx = s.bx - s.ax, dz = s.bz - s.az; const l2 = dx * dx + dz * dz || 1e-9;
      let t = ((x - s.ax) * dx + (z - s.az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = s.ax + dx * t - x, qz = s.az + dz * t - z; const d2 = qx * qx + qz * qz;
      if (d2 < best) { best = d2; bs = s; bt = t; }
    }
    return bs ? { dist: Math.sqrt(best), seg: bs, t: bt } : null;
  }
}

// ---------------------------------------------------------------- the world model (filled by initWorld from the layout)
let LY, SPACES, NSP, LOOP, SPAN, TY, BR_I, BR, ANCHORS, CORR_IN, CORR_OUT, RIDX, WIDX, RIVERS, POOLS, PADS, CUTS, BLOCKS, BEDS, MOUNDS, P;
const FAR = { dist: 99, d: 0, side: 0 };
function routeNear(x, z) {
  const r = RIDX.nearest(x, z); if (!r) return FAR;
  const s = r.seg; const d = s.data[0] + (s.data[1] - s.data[0]) * r.t;
  const tx = s.bx - s.ax, tz = s.bz - s.az; const side = Math.sign((x - s.ax) * -tz + (z - s.az) * tx) || 1;
  return { dist: r.dist, d: wrapD(d, LOOP), side };
}
function routeFrame(d) { const p = LY.pointAt(d); const tx = p.dir[0], tz = p.dir[1]; return { x: p.x, z: p.z, tx, tz, nx: -tz, nz: tx }; } // n = inner side (+1)
function inCorridor(rn) {
  const list = rn.side > 0 ? CORR_IN : CORR_OUT;
  for (const [a, b] of list) if ((rn.d >= a && rn.d <= b) || (rn.d + LOOP >= a && rn.d + LOOP <= b)) return true;
  return false;
}
function waterNear(x, z) {
  let e = 99, y = 0, river = null;
  const r = WIDX.nearest(x, z);
  if (r) { const D = r.seg.data; e = r.dist - lerp(D.w0, D.w1, r.t); y = lerp(D.y0, D.y1, r.t); river = D.river; }
  for (const p of POOLS) { const pe = Math.hypot(x - p.x, z - p.z) - p.r; if (pe < e) { e = pe; y = p.y; river = null; } }
  return { e, y, river };
}
// path profile along the route: flat landings under the tiles, gentle ramps or stone steps in between
function stepsFor(D) { const a = Math.abs(D); return a < 0.22 ? 0 : Math.max(2, Math.round(a / 0.2)); }
function pathY(d) {
  d = wrapD(d, LOOP); const i = Math.min(NSP - 1, Math.floor(d / SPAN)); const u = d - i * SPAN; const j = (i + 1) % NSP;
  const y0 = TY[i], y1 = TY[j];
  if (u <= LAND_H) return y0; if (u >= SPAN - LAND_H) return y1;
  const t = (u - LAND_H) / (SPAN - 2 * LAND_H); const D = y1 - y0; const n = stepsFor(D);
  if (!n) return y0 + D * t * t * (3 - 2 * t);
  return y0 + D * Math.min(n, Math.floor(t * n + 0.5)) / n;
}
function pathYmin(d) { return Math.min(pathY(d - 0.5), pathY(d), pathY(d + 0.5)); }
function risers() { // [{ d, hi, lo }] for every stone step
  const out = [];
  for (let i = 0; i < NSP; i++) {
    const j = (i + 1) % NSP; const D = TY[j] - TY[i]; const n = stepsFor(D); if (!n) continue;
    for (let k = 0; k < n; k++) { const d = i * SPAN + LAND_H + (k + 0.5) / n * (SPAN - 2 * LAND_H); const a = TY[i] + D * k / n, b = TY[i] + D * (k + 1) / n; out.push({ d, a, b, hi: Math.max(a, b), lo: Math.min(a, b) }); }
  }
  return out;
}
function deckY(lx) { return DECK_TOP - 0.07 * smooth(LAND_H - 0.05, BRIDGE_HL, Math.abs(lx)); } // along the bridge
function toBridge(x, z) { const dx = x - BR.x, dz = z - BR.z; return { lx: dx * BR.tx + dz * BR.tz, lz: dx * BR.nx + dz * BR.nz }; }

// terrain height (rendered ground), with its ingredients
function groundInfo(x, z) {
  const rn = routeNear(x, z);
  const nat = LY.heightAt(x, z); let h = nat;
  let m = 0; for (const M of MOUNDS) { const d = Math.hypot(x - M.x, z - M.z) / M.r; if (d < 1) m += M.h * 0.5 * (1 + Math.cos(Math.PI * d)); }
  if (m) h += m * smooth(5.5, 9, rn.dist);
  for (const p of PADS) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r + p.b) h = lerp(h, p.y, 1 - smooth(p.r, p.r + p.b, d)); }
  if (rn.dist < PATH_HW + BLEND) h = lerp(h, pathYmin(rn.d) - 0.06, 1 - smooth(PATH_HW + 0.12, PATH_HW + BLEND, rn.dist));
  for (const c of CUTS) { const v = c(x, z); if (v !== null && v < h) h = v; }
  const wn = waterNear(x, z);
  if (wn.e < BANK) {
    if (wn.e >= 0) h = lerp(wn.y - 0.14, h, smooth(0, BANK, wn.e));
    else h = wn.y - 0.14 - 0.38 * smooth(0, 0.7, -wn.e);
  }
  return { h, nat, rn, wn };
}
const groundAt = (x, z) => groundInfo(x, z).h;
// the visible surface (deck, path, water or ground): what pawns/props should stand on
function surfaceAt(x, z) {
  const b = toBridge(x, z); if (Math.abs(b.lx) < BRIDGE_HL && Math.abs(b.lz) < BRIDGE_HW - 0.2) return deckY(b.lx);
  const rn = routeNear(x, z); if (rn.dist < PATH_HW) return pathY(rn.d) + 0.02;
  const wn = waterNear(x, z); if (wn.e < 0) return wn.y;
  return groundAt(x, z);
}

// ---------------------------------------------------------------- rivers
function makeRiver(ctrl, samples, name) {
  const curve = new THREE.CatmullRomCurve3(ctrl.map(p => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal');
  const n = ctrl.length; const pts = []; let L = 0;
  for (let i = 0; i <= samples; i++) {
    const u = i / samples; const p = curve.getPointAt(u); const t = curve.getUtoTmapping(u); const fi = t * (n - 1); const i0 = Math.min(n - 2, Math.floor(fi)); const f = fi - i0;
    const q = { x: p.x, z: p.z, w: lerp(ctrl[i0][2], ctrl[i0 + 1][2], f), y: lerp(ctrl[i0][3], ctrl[i0 + 1][3], f), s: 0 };
    if (pts.length) { const a = pts[pts.length - 1]; if (boardSD(q.x, q.z) > -0.01) { // clip exactly at the board edge
      let lo = 0, hi = 1; for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (boardSD(lerp(a.x, q.x, m), lerp(a.z, q.z, m)) > -0.01) hi = m; else lo = m; }
      q.x = lerp(a.x, q.x, lo); q.z = lerp(a.z, q.z, lo); q.exit = true; }
      L += Math.hypot(q.x - a.x, q.z - a.z); q.s = L; }
    pts.push(q); if (q.exit) break;
  }
  return { name, pts, length: L };
}

// ---------------------------------------------------------------- placement rules
function isFree(x, z, r, kind = 'tall') {
  if (boardSD(x, z) > -(r + 0.7)) return false;
  const rn = routeNear(x, z);
  if (rn.dist < PATH_HW + 0.4 + r) return false;
  if (rn.dist < PATH_HW + CORRIDOR + r && inCorridor(rn)) return false;
  if (kind !== 'flower') for (const a of ANCHORS) if (Math.hypot(x - a.x, z - a.z) < CLEAR_R + r) return false;
  const wn = waterNear(x, z); if (wn.e < (kind === 'flower' ? 0.5 : 0.75) + r * 0.6) return false;
  for (const b of BLOCKS) if (Math.hypot(x - b.x, z - b.z) < b.r + r) return false;
  const bl = toBridge(x, z); if (Math.abs(bl.lx) < BRIDGE_HL + 1 + r && Math.abs(bl.lz) < BRIDGE_HW + 1.2 + r) return false;
  if (kind === 'tall') for (const k of [1.2, 2.4, 3.6, 4.8, 6.0]) if (routeNear(x, z - k).dist < PATH_HW + 0.4) return false; // would hide the path from the overview camera
  return true;
}

function initWorld(layout) {
  LY = layout; SPACES = layout.SPACES; NSP = SPACES.length; LOOP = layout.LOOP_LENGTH; SPAN = LOOP / NSP;
  TY = SPACES.map(s => s.pos[1]); BR_I = layout.BRIDGE_INDEX;
  const bs = SPACES[BR_I]; const btx = bs.dir[0], btz = bs.dir[1];
  BR = { x: bs.pos[0], y: bs.pos[1], z: bs.pos[2], tx: btx, tz: btz, nx: -btz, nz: btx, yaw: Math.atan2(-btz, btx), d: bs.dist };
  ANCHORS = (layout.CATCHER_STAGES || []).map(s => ({ id: s.id, x: s.anchor[0], y: s.anchor[1], z: s.anchor[2], near: s.near, side: s.side }));
  // machine corridors beside the path between consecutive stage anchors (both sides where the stages switch sides)
  CORR_IN = []; CORR_OUT = [];
  const st = layout.CATCHER_STAGES || [];
  for (let k = 0; k < st.length - 1; k++) {
    const A = st[k], B = st[k + 1]; let a = SPACES[A.near].dist, b = SPACES[B.near].dist; if (b < a) b += LOOP;
    const sa = A.side || B.side, sb = B.side || A.side; const put = (side, x0, x1) => (side > 0 ? CORR_IN : CORR_OUT).push([x0, x1]);
    put(sa, a - 0.6, b + 0.6); if (sb !== sa) put(sb, b - SPAN * 1.6, b + 0.6);
  }
  // route samples + index
  const n = Math.ceil(LOOP / 0.25); const R = [];
  for (let i = 0; i <= n; i++) { const d = i * LOOP / n; const p = layout.pointAt(d); R.push({ d, x: p.x, z: p.z }); }
  RIDX = new SegIndex(2, 8);
  for (let i = 0; i < n; i++) RIDX.add(R[i].x, R[i].z, R[i + 1].x, R[i + 1].z, [R[i].d, i === n - 1 ? LOOP : R[i + 1].d]);

  // ---- placements (landmarks, nudged where they would collide with the route, the river or the machine)
  const LM = layout.LANDMARKS || {};
  const tileXZ = (i, off, side = -1) => { const s = SPACES[((i % NSP) + NSP) % NSP]; return [s.pos[0] - s.dir[1] * off * side, s.pos[2] + s.dir[0] * off * side]; }; // side +1 inner, -1 outer
  P = {};
  P.castle = { x: LM.castle?.pos?.[0] ?? 0, z: LM.castle?.pos?.[2] ?? -25 }; P.castle.y = layout.heightAt(P.castle.x, P.castle.z);
  { const s0 = SPACES[layout.CASTLE_INDEX ?? 0]; P.castle.yaw = yawToward(s0.pos[0] - P.castle.x, s0.pos[2] - P.castle.z); }
  P.pedestal = { x: LM.gemPedestal?.pos?.[0] ?? 0, y: LM.gemPedestal?.pos?.[1] ?? layout.heightAt(0, -21), z: LM.gemPedestal?.pos?.[2] ?? -21 };
  P.bakery = { x: LM.bakery?.pos?.[0] ?? 17.5, z: LM.bakery?.pos?.[2] ?? -13 };
  // the pet wash sits inside the loop so its yard (the net / bucket / tub stages) lies between it and the street
  P.petwash = { x: -8.6, z: 3.1, yaw: -0.36 };
  P.fountain = { x: LM.fountain?.pos?.[0] ?? 10.5, z: LM.fountain?.pos?.[2] ?? 3 };
  for (let k = 0; k < 20; k++) { const rn = routeNear(P.fountain.x, P.fountain.z); if (rn.dist >= PATH_HW + CORRIDOR + 2.5) break; const f = routeFrame(rn.d); P.fountain.x += f.nx * 0.2 * rn.side; P.fountain.z += f.nz * 0.2 * rn.side; }
  { const ci = Math.max(0, SPACES.findIndex(s => s.type === 'cake')); const f = routeFrame(SPACES[ci].dist + SPAN / 2); P.cake = { x: f.x - f.nx * 4.3, z: f.z - f.nz * 4.3, tile: ci }; } // outer side, between the cake tile and the next
  { const g = layout.GRABBLE_START ?? 0; const [x, z] = tileXZ(g, 3.5, -1); P.hideout = { x, z, tile: g }; P.hideout.yaw = yawToward(SPACES[g].pos[0] - x, SPACES[g].pos[2] - z); }
  P.cascade = { x: -6.6, z: -10.9 };
  P.pond = { x: 26.2, z: -23.2, r: 2.5 };
  P.cottages = [
    { x: -11.2, z: -3.4, wall: 'peach', roof: 'roofLav', chimney: true, face: [1, 0.6] },
    { x: 6.6, z: -4.6, wall: 'mintWall', roof: 'roofCoral', chimney: true, face: [-0.6, 1] },
    { x: 10.8, z: -19.8, wall: 'cream', roof: 'roofPink', chimney: false, face: [-0.3, 1] },
    { x: -12.2, z: -22.0, wall: 'lilacWall', roof: 'roofPeri', chimney: true, face: [0.4, 1] },
    { x: 26.8, z: 3.6, wall: 'cream', roof: 'roofCoral', chimney: false, face: [-1, 0.25] },
    { x: -27.0, z: -1.5, wall: 'mintWall', roof: 'roofPink', chimney: true, face: [1, 0.3] },
  ];
  P.lamps = [
    { tile: 1 }, { tile: 3 }, { tile: 5, banner: 'blue' }, { tile: 7 }, { tile: 18, banner: 'pink' }, { tile: 20 },
    { tile: 22, banner: 'blue' }, { tile: 24 }, { tile: 27, banner: 'pink' }, { tile: 29 }, { tile: 31 },
  ].filter(L => L.tile < NSP);
  // flight lamps follow the layout's flight tiles + colours if they differ
  if (LM.lampposts) for (const lp of LM.lampposts) { const L = P.lamps.find(q => q.tile === lp.index); const banner = /F29BC8/i.test(lp.color) ? 'pink' : 'blue'; if (L) L.banner = banner; else P.lamps.push({ tile: lp.index, banner }); }
  const fronts = [[P.bakery.x, P.bakery.z, 4.0], ...P.cottages.map(c => [c.x, c.z, 3.0]), [P.castle.x, P.castle.z, 6.5]];
  for (const L of P.lamps) { const s = SPACES[L.tile]; for (const sh of [0, -1.2, 1.2, -1.8, 1.8, -2.4]) { const f = routeFrame(s.dist + sh); L.x = f.x - f.nx * 2.1; L.z = f.z - f.nz * 2.1; L.tx = f.tx; L.tz = f.tz; if (fronts.every(([x, z, r]) => Math.hypot(L.x - x, L.z - z) >= r)) break; } }
  P.lamps = P.lamps.filter(L => { const rn = routeNear(L.x, L.z); return !inCorridor({ ...rn, side: -1 }); });

  // ---- rivers: a stream from the castle-hill waterfall crosses under the bridge and splits into the two river arms
  const B = BR; const nb = (k) => [B.x + B.nx * k, B.z + B.nz * k];
  const [s1x, s1z] = nb(4.6), [s2x, s2z] = nb(2.5), [s3x, s3z] = nb(-2.2), [jx, jz] = nb(-3.4);
  const arm = LM.river || [[-26, 22], [-8, 14.5], [2, 11], [9, 14], [16, 24]];
  const west = arm.filter(p => p[0] < B.x - 3).sort((a, b) => b[0] - a[0]), east = arm.filter(p => p[0] > B.x + 3).sort((a, b) => a[0] - b[0]);
  const push = (p, min) => { let [x, z] = p; for (let k = 0; k < 30; k++) { const rn = routeNear(x, z); if (rn.dist >= min) break; const f = routeFrame(rn.d); const s = rn.side; x += f.nx * 0.25 * s; z += f.nz * 0.25 * s; } return [x, z]; };
  const stream = [[P.cascade.x + 0.9, P.cascade.z + 2.6, 0.75, -0.05], [-5.3, -6.0, 0.55, -0.12], [-3.9, -2.6, 0.6, -0.22], [-1.9, 0.9, 0.62, -0.34], [-0.4, 4.1, 0.66, -0.48], [s1x, s1z, 0.75, -0.62], [s2x, s2z, 0.95, -0.76], [B.x, B.z, 1.1, -0.85], [s3x, s3z, 1.0, -0.88], [jx, jz, 1.0, -0.9]];
  const westCtrl = [[jx, jz, 1.0, -0.9]]; let wy = -0.92;
  for (const p of west) { const q = push([p[0], p[1] + 2.4], PATH_HW + BANK + 2.6); westCtrl.push([q[0], q[1], 1.0, wy]); wy -= 0.02; }
  { const a = westCtrl[westCtrl.length - 1], b = westCtrl[Math.max(0, westCtrl.length - 2)]; const dx = a[0] - b[0], dz = a[1] - b[1], l = Math.hypot(dx, dz) || 1; westCtrl.push([a[0] + dx / l * 14, a[1] + dz / l * 14, 1.15, wy - 0.04]); }
  const eastCtrl = [[s3x - B.nx * 0.2, s3z - B.nz * 0.2, 1.0, -0.91]]; let ey = -0.93;
  for (const p of east) { const q = push([p[0], p[1] + 2.0], PATH_HW + BANK + 2.6); eastCtrl.push([q[0], q[1], 1.0, ey]); ey -= 0.02; }
  { const a = eastCtrl[eastCtrl.length - 1], b = eastCtrl[Math.max(0, eastCtrl.length - 2)]; const dx = a[0] - b[0], dz = a[1] - b[1], l = Math.hypot(dx, dz) || 1; eastCtrl.push([a[0] + dx / l * 14, a[1] + dz / l * 14, 1.15, ey - 0.04]); }
  // widen into the arms smoothly
  westCtrl.forEach((p, i) => { p[2] = lerp(1.0, 1.15, i / (westCtrl.length - 1)); }); eastCtrl.forEach((p, i) => { p[2] = lerp(1.0, 1.15, i / (eastCtrl.length - 1)); });
  RIVERS = [makeRiver(stream.concat(westCtrl.slice(1)), 260, 'main'), makeRiver(eastCtrl, 170, 'east')];
  WIDX = new SegIndex(2, 3.5);
  for (const R2 of RIVERS) for (let i = 0; i < R2.pts.length - 1; i++) { const a = R2.pts[i], b = R2.pts[i + 1]; WIDX.add(a.x, a.z, b.x, b.z, { w0: a.w, w1: b.w, y0: a.y, y1: b.y, river: R2.name }); }
  POOLS = [{ x: P.cascade.x + 0.9, z: P.cascade.z + 2.6, r: 1.35, y: -0.05, name: 'cascadePool' }];
  { const g = layout.heightAt(P.pond.x, P.pond.z); POOLS.push({ x: P.pond.x, z: P.pond.z, r: P.pond.r, y: g - 0.32, name: 'lilyPond' }); }

  // ---- terrain shaping: meadow mounds in the outer corners, building pads, the castle stair cut
  MOUNDS = [{ x: -27, z: -27, r: 8, h: 1.4 }, { x: 28, z: -29, r: 7, h: 1.1 }, { x: -30, z: 9, r: 7, h: 0.9 }, { x: 30, z: 13, r: 6, h: 0.8 }, { x: -14, z: 29, r: 8, h: 0.7 }, { x: 9, z: 30, r: 7, h: 0.6 }, { x: 30, z: -12, r: 5, h: 0.7 }, { x: -30, z: -13, r: 5, h: 0.8 }, { x: 22, z: 26, r: 6, h: 0.6 }];
  PADS = []; CUTS = []; BLOCKS = []; BEDS = [];
  PADS.push({ x: P.castle.x, z: P.castle.z - 0.2, r: 5.0, b: 2.6, y: P.castle.y });
  PADS.push({ x: P.pedestal.x, z: P.pedestal.z, r: 1.7, b: 1.1, y: P.pedestal.y });
  P.bakery.y = 0; P.petwash.y = 0;
  // the bakery faces its street; push it back until its front leaves room for the chalkboard
  { const rn = routeNear(P.bakery.x, P.bakery.z); const f = routeFrame(rn.d); P.bakery.yaw = yawToward(f.x - P.bakery.x, f.z - P.bakery.z);
    for (let k = 0; k < 40; k++) { const [fx, fz] = fwd(P.bakery.yaw); const r2 = routeNear(P.bakery.x + fx * 1.75, P.bakery.z + fz * 1.75); if (r2.dist >= 3.4) break; P.bakery.x -= fx * 0.15; P.bakery.z -= fz * 0.15; }
    P.bakery.y = layout.heightAt(P.bakery.x, P.bakery.z); }
  PADS.push({ x: P.bakery.x, z: P.bakery.z, r: 3.0, b: 1.6, y: P.bakery.y });
  PADS.push({ x: P.petwash.x, z: P.petwash.z, r: 3.2, b: 1.6, y: P.petwash.y = layout.heightAt(P.petwash.x, P.petwash.z) });
  for (const c of P.cottages) { c.y = layout.heightAt(c.x, c.z) + 0.02; c.yaw = yawToward(c.face[0], c.face[1]); PADS.push({ x: c.x, z: c.z, r: 2.0, b: 1.8, y: c.y }); BLOCKS.push({ x: c.x, z: c.z, r: 2.1 }); }
  P.fountain.y = layout.heightAt(P.fountain.x, P.fountain.z); PADS.push({ x: P.fountain.x, z: P.fountain.z, r: 3.9, b: 1.4, y: P.fountain.y });
  P.cake.y = layout.heightAt(P.cake.x, P.cake.z); PADS.push({ x: P.cake.x, z: P.cake.z, r: 1.5, b: 1.0, y: P.cake.y });
  P.hideout.y = layout.heightAt(P.hideout.x, P.hideout.z);
  // the castle gate stair: from the pedestal plaza down to the Start tile's landing
  { const top = P.pedestal.y, bot = TY[0]; const z0 = P.pedestal.z + 1.45;
    let z1 = z0; for (let k = 0; k < 80; k++) { if (routeNear(P.pedestal.x, z1).dist <= PATH_HW + 0.05) break; z1 += 0.05; } // where the path's edge crosses the stair axis
    P.stair = { x: P.pedestal.x, z0, z1, top, bot, w: 2.2, n: Math.max(2, Math.round((top - bot) / 0.23)) };
    CUTS.push((x, z) => { const S = P.stair; if (Math.abs(x - S.x) > S.w / 2 + 0.3 || z < S.z0 - 0.3 || z > S.z1 + 0.6 || routeNear(x, z).dist < PATH_HW + 0.02) return null; const t = clamp((z - S.z0) / (S.z1 - S.z0), 0, 1); return lerp(S.top, S.bot, t) - 0.32; }); }
  BLOCKS.push({ x: P.castle.x, z: P.castle.z - 0.4, r: 5.4 }, { x: P.pedestal.x, z: P.pedestal.z, r: 1.9 }, { x: P.stair.x, z: (P.stair.z0 + P.stair.z1) / 2, r: 1.5 },
    { x: P.bakery.x, z: P.bakery.z, r: 3.3 }, { x: P.petwash.x, z: P.petwash.z, r: 3.4 }, { x: P.fountain.x, z: P.fountain.z, r: 4.0 }, { x: P.cake.x, z: P.cake.z, r: 1.9 },
    { x: P.hideout.x, z: P.hideout.z, r: 1.6 }, { x: P.cascade.x, z: P.cascade.z, r: 2.0 }, ...P.lamps.map(L => ({ x: L.x, z: L.z, r: 0.5 })));
  // flower beds (ground paint + dense flowers)
  BEDS.push(
    { x: -23.4, z: -6.8, rx: 2.4, rz: 3.6, rot: 0.3, pal: 'blue', n: 190, big: true }, { x: -22.6, z: -12.8, rx: 2.0, rz: 2.6, rot: -0.5, pal: 'pink', n: 130, big: true },
    { x: -23.9, z: 0.8, rx: 1.6, rz: 2.4, rot: 0.1, pal: 'mixed', n: 90, big: true }, { x: -20.6, z: -16.8, rx: 2.2, rz: 1.5, rot: 0.6, pal: 'mixed', n: 80, big: true },
    { x: -12.3, z: -14.6, rx: 1.0, rz: 0.8, rot: 0, pal: 'pink', n: 0 },
    { x: -9.6, z: -7.2, rx: 1.8, rz: 1.2, rot: 0.4, pal: 'blue', n: 50 }, { x: -2.4, z: -5.6, rx: 1.4, rz: 1.0, rot: -0.3, pal: 'pink', n: 34 },
    { x: 3.2, z: 1.2, rx: 1.6, rz: 1.1, rot: 0.2, pal: 'mixed', n: 40 }, { x: 13.6, z: -3.0, rx: 1.2, rz: 0.9, rot: 0.5, pal: 'blue', n: 26 },
    { x: 4.6, z: -18.6, rx: 1.8, rz: 1.1, rot: 0.2, pal: 'mixed', n: 44 }, { x: -4.8, z: -19.6, rx: 1.8, rz: 1.1, rot: -0.2, pal: 'mixed', n: 44 },
    { x: 22.6, z: -10.6, rx: 1.4, rz: 2.0, rot: 0.2, pal: 'pink', n: 40 }, { x: 24.0, z: 9.6, rx: 1.6, rz: 1.2, rot: 0, pal: 'blue', n: 36 },
    { x: -14.6, z: 15.0, rx: 2.0, rz: 1.0, rot: -0.3, pal: 'pink', n: 40 }, { x: 7.4, z: 13.6, rx: 1.4, rz: 0.8, rot: 0.3, pal: 'blue', n: 26 },
    { x: -4.2, z: -11.6, rx: 1.2, rz: 0.9, rot: 0, pal: 'blue', n: 26 },
    { x: -26.6, z: -4.0, rx: 1.8, rz: 2.6, rot: 0.2, pal: 'pink', n: 90, big: true }, { x: -26.2, z: -12.2, rx: 1.6, rz: 2.2, rot: -0.3, pal: 'blue', n: 80, big: true }, { x: -25.4, z: 4.6, rx: 1.4, rz: 1.8, rot: 0.4, pal: 'mixed', n: 50 },
    { x: -14.2, z: -6.2, rx: 1.3, rz: 1.8, rot: 0.3, pal: 'blue', n: 50 }, { x: -10.6, z: -10.4, rx: 1.4, rz: 0.9, rot: -0.5, pal: 'pink', n: 36 }, { x: -14.0, z: -1.6, rx: 1.0, rz: 1.4, rot: 0, pal: 'mixed', n: 30 },
    { x: -8.0, z: -0.8, rx: 1.4, rz: 0.8, rot: 0.2, pal: 'pink', n: 30 }, { x: 1.8, z: -10.0, rx: 1.5, rz: 1.0, rot: 0.3, pal: 'blue', n: 36 }, { x: 9.6, z: -7.2, rx: 1.4, rz: 0.9, rot: -0.2, pal: 'mixed', n: 34 },
    { x: 15.2, z: 0.4, rx: 1.2, rz: 1.6, rot: 0.1, pal: 'pink', n: 34 }, { x: 6.2, z: 5.4, rx: 1.3, rz: 0.9, rot: 0.5, pal: 'blue', n: 30 }, { x: -4.2, z: 6.8, rx: 1.3, rz: 1.0, rot: -0.4, pal: 'pink', n: 30 },
  );
  P.landmarks = { castle: [P.castle.x, P.castle.y, P.castle.z], gemPedestal: [P.pedestal.x, P.pedestal.y, P.pedestal.z], bakery: [P.bakery.x, P.bakery.y, P.bakery.z], petwash: [P.petwash.x, P.petwash.y, P.petwash.z], fountain: [P.fountain.x, P.fountain.y, P.fountain.z], caketable: [P.cake.x, P.cake.y, P.cake.z], hideout: [P.hideout.x, P.hideout.y, P.hideout.z], waterfall: [P.cascade.x, 0, P.cascade.z] };
}

// ---------------------------------------------------------------- materials
const COLORS = {
  white: 0xF6F1E8, white2: 0xFFFFFF, stone: 0xD8CCB8, stoneDark: 0xB4A690, stoneWarm: 0xCDBBA1, coping: 0xEDE5D6, bridgeStone: 0xCDBFA8,
  roofBlue: 0x3E6FD6, gold: 0xF2C14E, wood: 0x8B5E3C, woodLight: 0xC68A55, woodMid: 0xA8744A,
  cream: 0xFFF3DC, plaster: 0xFBE8CF, peach: 0xFFDCC8, pink: 0xF29BC8, pinkLight: 0xF9CBE0, roofRose: 0xE58E86, roofCoral: 0xEB9A86,
  roofPink: 0xEFA3C4, roofLav: 0xB49AE6, roofPeri: 0x7F9BE6, roofWash: 0x7F9BE6,
  paleBlue: 0xBFE0F2, periwinkle: 0x6E8FE0, lavender: 0xB48BE0, mintWall: 0xCDEFD6, lilacWall: 0xE9DDF7, mint: 0xA8E0B8,
  leaf: 0x6FAE5E, vine: 0x5E9E4E, iron: 0x4A3F6B, glass: 0xBFDDF2, windowDark: 0x46508C,
  brick: 0xCF7F63, red: 0xE5484D, terracotta: 0xD98A5E, teal: 0x4FB5A3, duck: 0xF7D23E, orange: 0xF29A3B, fmn: 0x5B8DEF,
  slate: 0x3D4A48, cloud: 0xFFFFFF, purple: 0x8A5CC2, purpleLight: 0xB48BE0, hedge: 0x6FAE5E, hedgeDark: 0x5E9E52, moss: 0x8CC271, coping2: 0xF4EEE2, plank: 0xC99A66, sand: 0xEAD9AE, reed: 0x7DB866, lotus: 0xF7B7D6, cakePink: 0xF7B3D2, cakeCream: 0xFFF1DA, baseWood: 0xE8C9A0, loaf: 0xE2A85B,
};
const GLOW = { glowWarm: [0xFFE2A0, 1.6], glassWarm: [0xFFE7B8, 1.0], flame: [0xFFC94D, 2.4], goldGlow: [0xFFD86B, 1.5] };
function makeGradient() {
  const data = new Uint8Array([128, 170, 210, 240, 255]);
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true; return tex;
}

// merges static parts by material + builds one dark-ink back-face outline mesh
class Batch {
  constructor(getMat) { this.getMat = getMat; this.parts = new Map(); this.ink = []; }
  add(geo, key, m, outline = 0.045, cast = true) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal' && n !== 'uv') g.deleteAttribute(n);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.clearGroups(); g.morphAttributes = {};
    if (outline) { const o = inkHull(g, outline); if (o) { o.applyMatrix4(m); this.ink.push(o); } }
    g.applyMatrix4(m);
    const k = key + (cast ? '' : '#nc');
    if (!this.parts.has(k)) this.parts.set(k, []);
    this.parts.get(k).push(g);
    return this;
  }
  build(parent, inkMat) {
    for (const [k, list] of this.parts) {
      const [key, nc] = k.split('#');
      const mesh = new THREE.Mesh(mergeGeometries(list, false), this.getMat(key));
      mesh.castShadow = !nc; mesh.receiveShadow = true; mesh.name = 'v:' + key; parent.add(mesh);
      list.forEach(g => g.dispose());
    }
    if (this.ink.length) { const ink = new THREE.Mesh(mergeGeometries(this.ink, false), inkMat); ink.name = 'v:ink'; parent.add(ink); this.ink.forEach(g => g.dispose()); }
    this.parts.clear(); this.ink = [];
  }
}
function inkHull(g, t) {
  g.computeBoundingBox(); const bb = g.boundingBox; const size = new THREE.Vector3(); bb.getSize(size);
  if (Math.min(size.x, size.y, size.z) < 0.004 || Math.max(size.x, size.y, size.z) < 0.3) return null;
  const c = new THREE.Vector3(); bb.getCenter(c);
  const o = new THREE.BufferGeometry(); o.setAttribute('position', g.attributes.position.clone());
  o.translate(-c.x, -c.y, -c.z); o.scale((size.x + 2 * t) / size.x, (size.y + 2 * t) / size.y, (size.z + 2 * t) / size.z); o.translate(c.x, c.y, c.z);
  return o;
}

// ---------------------------------------------------------------- canvas helpers
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function canvasTex(c, { repeat = false, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
async function ensureFont() {
  try {
    if (!document.fonts) return;
    const timeout = (ms) => new Promise(r => setTimeout(() => r(null), ms));
    const loaded = await Promise.race([document.fonts.load(`700 40px Fredoka`).then(f => f && f.length > 0).catch(() => false), timeout(1200)]);
    if (!loaded && typeof FontFace !== 'undefined') {
      const ff = new FontFace('Fredoka', 'url(/vendor/fonts/fredoka/files/fredoka-latin-700-normal.woff2)', { weight: '700' });
      const ok = await Promise.race([ff.load().then(() => true).catch(() => false), timeout(1500)]);
      if (ok) document.fonts.add(ff);
    }
  } catch { /* fonts are a nicety */ }
}
function softDotTexture(inner = 'rgba(255,255,255,1)', size = 64) {
  const [c, g] = canvas(size, size); const r = size / 2; const gr = g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, inner); gr.addColorStop(0.35, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, size, size); const t = new THREE.CanvasTexture(c); return t;
}
function sparkleTexture() {
  const S = 64; const [c, g] = canvas(S, S); const r = S / 2;
  const gr = g.createRadialGradient(r, r, 0, r, r, r * 0.55); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath();
  g.moveTo(r, 2); g.quadraticCurveTo(r + 3, r - 3, S - 2, r); g.quadraticCurveTo(r + 3, r + 3, r, S - 2); g.quadraticCurveTo(r - 3, r + 3, 2, r); g.quadraticCurveTo(r - 3, r - 3, r, 2); g.fill();
  return new THREE.CanvasTexture(c);
}
function bubbleTexture() {
  const S = 64; const [c, g] = canvas(S, S); const r = S / 2;
  const gr = g.createRadialGradient(r, r, r * 0.55, r, r, r * 0.96); gr.addColorStop(0, 'rgba(255,255,255,0.05)'); gr.addColorStop(0.75, 'rgba(210,235,255,0.55)'); gr.addColorStop(0.9, 'rgba(255,220,245,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(r, r, r, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.ellipse(r - r * 0.35, r - r * 0.38, r * 0.16, r * 0.1, -0.7, 0, TAU); g.fill();
  return new THREE.CanvasTexture(c);
}
function cobbleCanvas() {
  const S = 256; const [c, g] = canvas(S, S); rnd = mulberry32(99);
  g.fillStyle = '#D5C4A8'; g.fillRect(0, 0, S, S);
  const cols = ['#F1E7D6', '#EBDDC6', '#E4D4BA', '#F5ECDD', '#E8D8C0', '#EFE2CC'];
  const rows = 9; const rh = S / rows;
  for (let r = 0; r < rows; r++) {
    let x = (r % 2) * 14 - 20;
    while (x < S + 10) {
      const w = rand(24, 36); const h = rh - rand(3, 6); const y = r * rh + (rh - h) / 2;
      for (const off of [-S, 0, S]) {
        g.fillStyle = pick(cols); g.strokeStyle = '#C3AE8E'; g.lineWidth = 2;
        g.beginPath(); g.roundRect(x + off, y, w - 3, h, 8); g.fill(); g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(x + off + w * 0.35, y + h * 0.32, w * 0.2, h * 0.14, 0, 0, TAU); g.fill();
      }
      x += w;
    }
  }
  return c;
}
function flowCanvas() { // emissive streaks for flowing water
  const W = 128, H = 256; const [c, g] = canvas(W, H); rnd = mulberry32(5);
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x = rand(8, W - 8), y = rand(0, H), len = rand(18, 46); g.strokeStyle = `rgba(255,255,255,${rand(0.35, 0.8).toFixed(2)})`; g.lineWidth = rand(1.5, 3.5);
    for (const off of [-H, 0, H]) { g.beginPath(); g.moveTo(x, y + off); g.bezierCurveTo(x + 5, y + off + len * 0.3, x - 5, y + off + len * 0.7, x, y + off + len); g.stroke(); }
  }
  for (let i = 0; i < 30; i++) { const x = rand(4, W - 4), y = rand(0, H); g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.arc(x, y, rand(1, 2.2), 0, TAU); g.fill(); }
  return c;
}
function fallCanvas() {
  const W = 128, H = 256; const [c, g] = canvas(W, H); rnd = mulberry32(8);
  g.fillStyle = '#9ED6F0'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) { const x = rand(0, W), y = rand(0, H), len = rand(30, 90); g.strokeStyle = `rgba(255,255,255,${rand(0.4, 0.95).toFixed(2)})`; g.lineWidth = rand(2, 6); for (const off of [-H, 0, H]) { g.beginPath(); g.moveTo(x, y + off); g.lineTo(x + rand(-2, 2), y + off + len); g.stroke(); } }
  return c;
}

// ---------------------------------------------------------------- tile decals
const TILE_STYLE = {
  castle: { fill: '#3E6FD6' }, shard: { fill: '#FFE07A' }, cobble: { fill: '#E9DFCD' }, fetch: { fill: '#FFB46A' },
  flight_a: { fill: '#5B8DEF' }, flight_b: { fill: '#F29BC8' }, swish: { fill: '#8A62C4' }, launch: { fill: '#B5E0FA' },
  bridge: { fill: '#D3C9B8' }, cake: { fill: '#FFF6FA' },
};
function strokeFill(g, fill, lw, ink = INK_CSS) { g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = lw; g.strokeStyle = ink; g.stroke(); g.fillStyle = fill; g.fill(); }
function sparkle4(g, x, y, s, color = '#FFFFFF') { g.beginPath(); g.moveTo(x, y - s); g.quadraticCurveTo(x + s * 0.15, y - s * 0.15, x + s, y); g.quadraticCurveTo(x + s * 0.15, y + s * 0.15, x, y + s); g.quadraticCurveTo(x - s * 0.15, y + s * 0.15, x - s, y); g.quadraticCurveTo(x - s * 0.15, y - s * 0.15, x, y - s); g.fillStyle = color; g.fill(); }
const ICONS = {
  shard(g, k) {
    g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5; const r = i % 2 ? k * 0.47 : k; g.lineTo(Math.cos(a) * r, Math.sin(a) * r + k * 0.06); } g.closePath();
    const gr = g.createRadialGradient(-k * 0.15, -k * 0.15, k * 0.05, 0, 0, k); gr.addColorStop(0, '#FFFFFF'); gr.addColorStop(0.6, '#FFF6C8'); gr.addColorStop(1, '#FFD34D');
    strokeFill(g, gr, k * 0.16);
    sparkle4(g, k * 0.82, -k * 0.72, k * 0.2); sparkle4(g, -k * 0.86, -k * 0.5, k * 0.14); sparkle4(g, -k * 0.7, k * 0.8, k * 0.12);
  },
  launch(g, k) {
    g.save(); g.rotate(-0.18);
    g.beginPath(); g.moveTo(-k * 0.16, -k * 0.72);
    g.bezierCurveTo(-k * 0.62, -k * 0.68, -k * 0.56, 0, -k * 0.62, k * 0.34); g.quadraticCurveTo(-k * 0.86, k * 0.52, -k * 0.86, k * 0.6);
    g.lineTo(k * 0.86, k * 0.6); g.quadraticCurveTo(k * 0.86, k * 0.52, k * 0.62, k * 0.34); g.bezierCurveTo(k * 0.56, 0, k * 0.62, -k * 0.68, k * 0.16, -k * 0.72); g.closePath();
    const gr = g.createLinearGradient(-k, 0, k, 0); gr.addColorStop(0, '#FFE58A'); gr.addColorStop(0.45, '#FFD24D'); gr.addColorStop(1, '#E8A42C');
    strokeFill(g, gr, k * 0.15);
    g.beginPath(); g.arc(0, k * 0.78, k * 0.17, 0, TAU); strokeFill(g, '#E8A42C', k * 0.12);
    g.beginPath(); g.arc(0, -k * 0.86, k * 0.15, 0, TAU); g.lineWidth = k * 0.1; g.strokeStyle = INK_CSS; g.stroke();
    g.beginPath(); g.moveTo(-k * 0.38, -k * 0.35); g.quadraticCurveTo(-k * 0.44, 0, -k * 0.5, k * 0.3); g.lineWidth = k * 0.1; g.strokeStyle = 'rgba(255,255,255,0.85)'; g.stroke();
    g.restore();
    g.save(); g.translate(k * 0.62, -k * 0.62); g.rotate(0.4); for (const s of [-1, 1]) { g.beginPath(); g.ellipse(s * k * 0.18, 0, k * 0.2, k * 0.12, 0, 0, TAU); strokeFill(g, '#5B8DEF', k * 0.07); } g.beginPath(); g.arc(0, 0, k * 0.08, 0, TAU); strokeFill(g, '#5B8DEF', k * 0.06); g.restore();
  },
  swish(g, k) {
    g.beginPath(); g.moveTo(-k * 0.95, k * 0.95); g.lineTo(-k * 0.2, k * 0.2); g.lineWidth = k * 0.3; g.strokeStyle = INK_CSS; g.lineCap = 'round'; g.stroke(); g.lineWidth = k * 0.16; g.strokeStyle = '#B07A4C'; g.stroke();
    const cx = k * 0.22, cy = -k * 0.22, r = k * 0.62;
    g.save(); g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fillStyle = 'rgba(255,255,255,0.92)'; g.fill(); g.clip();
    g.strokeStyle = '#9C7FD0'; g.lineWidth = k * 0.06; for (let i = -6; i <= 6; i++) { g.beginPath(); g.moveTo(cx + i * k * 0.18 - r, cy - r); g.lineTo(cx + i * k * 0.18 + r, cy + r); g.stroke(); g.beginPath(); g.moveTo(cx + i * k * 0.18 + r, cy - r); g.lineTo(cx + i * k * 0.18 - r, cy + r); g.stroke(); }
    g.restore();
    g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.lineWidth = k * 0.3; g.strokeStyle = INK_CSS; g.stroke(); g.lineWidth = k * 0.15; g.strokeStyle = '#F2C14E'; g.stroke();
  },
  fetch(g, k) {
    const pad = (x, y, rx, ry, rot) => { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, TAU); strokeFill(g, '#8B5E3C', k * 0.13); };
    g.beginPath(); g.moveTo(0, -k * 0.02); g.bezierCurveTo(k * 0.42, -k * 0.04, k * 0.62, k * 0.5, k * 0.36, k * 0.7); g.bezierCurveTo(k * 0.18, k * 0.82, -k * 0.18, k * 0.82, -k * 0.36, k * 0.7); g.bezierCurveTo(-k * 0.62, k * 0.5, -k * 0.42, -k * 0.04, 0, -k * 0.02); strokeFill(g, '#8B5E3C', k * 0.13);
    pad(-k * 0.66, -k * 0.12, k * 0.17, k * 0.23, -0.5); pad(-k * 0.25, -k * 0.55, k * 0.18, k * 0.25, -0.15); pad(k * 0.25, -k * 0.55, k * 0.18, k * 0.25, 0.15); pad(k * 0.66, -k * 0.12, k * 0.17, k * 0.23, 0.5);
    g.fillStyle = 'rgba(255,225,200,0.6)'; g.beginPath(); g.ellipse(-k * 0.12, k * 0.3, k * 0.14, k * 0.09, -0.4, 0, TAU); g.fill();
  },
  feather(g, k) {
    g.save(); g.rotate(0.55);
    g.beginPath(); g.moveTo(0, -k * 1.0); g.bezierCurveTo(k * 0.56, -k * 0.62, k * 0.46, k * 0.32, 0, k * 0.62); g.bezierCurveTo(-k * 0.5, k * 0.28, -k * 0.46, -k * 0.6, 0, -k * 1.0);
    const gr = g.createLinearGradient(0, -k, 0, k); gr.addColorStop(0, '#FFFFFF'); gr.addColorStop(1, '#EAF2FF'); strokeFill(g, gr, k * 0.14);
    g.beginPath(); g.moveTo(0, -k * 0.82); g.lineTo(0, k * 1.0); g.lineWidth = k * 0.09; g.strokeStyle = INK_CSS; g.stroke();
    g.strokeStyle = 'rgba(43,36,64,0.55)'; g.lineWidth = k * 0.05;
    for (const [y, s] of [[-k * 0.35, 1], [k * 0.05, -1], [-k * 0.1, 1]]) { g.beginPath(); g.moveTo(0, y); g.lineTo(s * k * 0.3, y - k * 0.14); g.stroke(); }
    g.restore();
    sparkle4(g, k * 0.75, -k * 0.62, k * 0.16); sparkle4(g, -k * 0.78, k * 0.5, k * 0.12);
  },
  cake(g, k) {
    g.beginPath(); g.ellipse(0, k * 0.68, k * 0.92, k * 0.18, 0, 0, TAU); strokeFill(g, '#FFFFFF', k * 0.1);
    g.beginPath(); g.roundRect(-k * 0.72, k * 0.02, k * 1.44, k * 0.64, k * 0.12); strokeFill(g, '#F7A8CF', k * 0.12);
    g.beginPath(); g.roundRect(-k * 0.46, -k * 0.42, k * 0.92, k * 0.46, k * 0.1); strokeFill(g, '#FFF1DA', k * 0.12);
    g.fillStyle = '#FFFFFF'; g.beginPath(); g.moveTo(-k * 0.72, k * 0.06); for (let i = 0; i <= 6; i++) { const x = -k * 0.72 + i * k * 0.24; g.quadraticCurveTo(x - k * 0.12, k * 0.3, x, k * 0.12); } g.lineTo(k * 0.72, k * 0.02); g.lineTo(-k * 0.72, k * 0.02); g.fill();
    g.beginPath(); g.arc(0, -k * 0.58, k * 0.15, 0, TAU); strokeFill(g, '#E5484D', k * 0.1);
    g.beginPath(); g.moveTo(k * 0.04, -k * 0.7); g.quadraticCurveTo(k * 0.1, -k * 0.9, k * 0.25, -k * 0.95); g.lineWidth = k * 0.06; g.strokeStyle = INK_CSS; g.stroke();
    for (const [x, y, c] of [[-0.3, 0.35, '#5B8DEF'], [0.25, 0.42, '#F2C14E'], [0.5, 0.3, '#7FB069'], [-0.1, -0.2, '#F29BC8'], [0.22, -0.22, '#5B8DEF']]) { g.fillStyle = c; g.beginPath(); g.arc(x * k, y * k, k * 0.055, 0, TAU); g.fill(); }
  },
  castle(g, k) {
    const W = '#FFFFFF';
    g.beginPath(); g.rect(-k * 0.5, -k * 0.2, k * 1.0, k * 0.85); strokeFill(g, W, k * 0.12);
    for (const x of [-0.7, 0.7]) { g.beginPath(); g.rect(x * k - k * 0.22, -k * 0.4, k * 0.44, k * 1.05); strokeFill(g, W, k * 0.12); g.beginPath(); g.moveTo(x * k - k * 0.3, -k * 0.4); g.lineTo(x * k, -k * 0.85); g.lineTo(x * k + k * 0.3, -k * 0.4); g.closePath(); strokeFill(g, '#F29BC8', k * 0.12); }
    g.beginPath(); g.rect(-k * 0.24, -k * 0.55, k * 0.48, k * 0.4); strokeFill(g, W, k * 0.12);
    g.beginPath(); g.moveTo(-k * 0.32, -k * 0.55); g.lineTo(0, -k * 1.0); g.lineTo(k * 0.32, -k * 0.55); g.closePath(); strokeFill(g, '#F2C14E', k * 0.12);
    g.beginPath(); g.moveTo(-k * 0.18, k * 0.65); g.lineTo(-k * 0.18, k * 0.3); g.arc(0, k * 0.3, k * 0.18, Math.PI, 0); g.lineTo(k * 0.18, k * 0.65); g.closePath(); strokeFill(g, '#F2C14E', k * 0.09);
  },
  bridge(g, k) {
    g.beginPath(); g.ellipse(0, k * 0.62, k * 0.95, k * 0.22, 0, 0, TAU); strokeFill(g, '#7CC6E6', k * 0.09);
    g.beginPath(); g.moveTo(-k * 0.95, k * 0.5); g.lineTo(-k * 0.95, -k * 0.2); g.quadraticCurveTo(0, -k * 0.55, k * 0.95, -k * 0.2); g.lineTo(k * 0.95, k * 0.5); g.lineTo(k * 0.5, k * 0.5); g.arc(0, k * 0.5, k * 0.5, 0, Math.PI, true); g.closePath(); strokeFill(g, '#F3ECDF', k * 0.12);
    g.beginPath(); g.moveTo(-k * 0.95, -k * 0.2); g.quadraticCurveTo(0, -k * 0.55, k * 0.95, -k * 0.2); g.lineWidth = k * 0.07; g.strokeStyle = '#7FB069'; g.stroke();
  },
  cobble(g, k) {
    rnd = mulberry32(33);
    for (const [x, y, r] of [[-0.45, -0.42, 0.34], [0.32, -0.5, 0.3], [0.62, 0.1, 0.28], [-0.05, 0.05, 0.32], [-0.62, 0.28, 0.26], [0.22, 0.6, 0.3], [-0.32, 0.72, 0.22]]) {
      g.beginPath(); g.ellipse(x * k, y * k, r * k * 1.15, r * k * 0.95, rand(-0.5, 0.5), 0, TAU); strokeFill(g, pick(['#F4ECDF', '#EFE4D2', '#F7F0E4']), k * 0.06, '#BFAE94');
    }
  },
};
ICONS.flight_a = ICONS.feather; ICONS.flight_b = ICONS.feather;

function drawTileDecal(g, cx, cy, rad, s, img) {
  const fill = TILE_STYLE[s.type]?.fill || s.color;
  g.save();
  g.beginPath(); g.arc(cx, cy, rad, 0, TAU); g.fillStyle = INK_CSS; g.fill();
  g.beginPath(); g.arc(cx, cy, rad * 0.955, 0, TAU); g.fillStyle = s.color; g.fill();
  g.beginPath(); g.arc(cx, cy, rad * 0.83, 0, TAU); g.fillStyle = '#FFFDF6'; g.fill();
  const gr = g.createRadialGradient(cx - rad * 0.25, cy - rad * 0.3, rad * 0.05, cx, cy, rad * 0.8);
  gr.addColorStop(0, mixCss(fill, '#FFFFFF', 0.35)); gr.addColorStop(1, fill);
  g.beginPath(); g.arc(cx, cy, rad * 0.78, 0, TAU); g.fillStyle = gr; g.fill();
  // watercolor blotches
  g.save(); g.beginPath(); g.arc(cx, cy, rad * 0.78, 0, TAU); g.clip(); rnd = mulberry32(s.index * 17 + 3);
  for (let i = 0; i < 7; i++) { g.fillStyle = `rgba(255,255,255,${rand(0.05, 0.14).toFixed(2)})`; g.beginPath(); g.ellipse(cx + rand(-0.6, 0.6) * rad, cy + rand(-0.6, 0.6) * rad, rand(0.15, 0.35) * rad, rand(0.1, 0.25) * rad, rand(0, 3), 0, TAU); g.fill(); }
  if (s.type === 'cake') for (let i = 0; i < 26; i++) { g.fillStyle = pick(['#F29BC8', '#5B8DEF', '#F2C14E', '#7FB069', '#B48BE0']); g.save(); g.translate(cx + rand(-0.75, 0.75) * rad, cy + rand(-0.75, 0.75) * rad); g.rotate(rand(0, 3)); g.fillRect(-rad * 0.035, -rad * 0.012, rad * 0.07, rad * 0.024); g.restore(); }
  g.restore();
  // icon
  g.save(); g.translate(cx, cy - rad * 0.08);
  if (img) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height; const box = rad * 1.28; const sc = Math.min(box / iw, box / ih);
    try {
      g.shadowColor = 'rgba(255,255,255,1)'; g.shadowBlur = rad * 0.07;
      for (let k = 0; k < 3; k++) g.drawImage(img, -iw * sc / 2, -ih * sc / 2, iw * sc, ih * sc);
      g.shadowBlur = 0; g.shadowColor = 'transparent'; g.drawImage(img, -iw * sc / 2, -ih * sc / 2, iw * sc, ih * sc);
    } catch { ICONS[s.type]?.(g, rad * 0.5); }
  } else if (ICONS[s.type]) ICONS[s.type](g, s.type === 'cobble' ? rad * 0.62 : rad * 0.5);
  g.restore();
  // number badge
  const by = cy + rad * 0.66, br = rad * 0.17;
  g.beginPath(); g.arc(cx, by, br, 0, TAU); strokeFill(g, '#FFF6E0', rad * 0.04);
  g.fillStyle = INK_CSS; g.font = `700 ${Math.round(rad * 0.21)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(s.index), cx, by + rad * 0.012);
  g.restore();
}
async function loadIcon(type, textures, images) {
  const key = `icon_${type}`;
  let src = textures?.[key]?.image || images?.[key];
  if (!src) return null;
  if (typeof src === 'string') {
    src = await new Promise(res => { const im = new Image(); const tm = setTimeout(() => res(null), 5000); im.onload = () => { clearTimeout(tm); res(im); }; im.onerror = () => { clearTimeout(tm); res(null); }; im.src = src; });
  }
  if (src && typeof src.decode === 'function' && src.complete === false) { try { await src.decode(); } catch { return null; } }
  return src || null;
}
async function buildTileAtlas(textures, images) {
  const cols = 8, rows = 4, cell = 320, pad = 6; const [c, g] = canvas(cols * cell, rows * cell);
  const icons = {}; for (const type of new Set(SPACES.map(s => s.type))) icons[type] = type === 'cobble' ? null : await loadIcon(type, textures, images);
  SPACES.forEach((s, i) => { const col = i % cols, row = Math.floor(i / cols); drawTileDecal(g, col * cell + cell / 2, row * cell + cell / 2, cell / 2 - pad, s, icons[s.type]); });
  return { tex: canvasTex(c, { aniso: 8 }), cols, rows, cell, pad, W: c.width, H: c.height };
}
function decalGeo(i, A) {
  const g = new THREE.CircleGeometry(TILE_R - 0.035, 44); const uv = g.attributes.uv; const col = i % A.cols, row = Math.floor(i / A.cols); const inner = A.cell - 2 * A.pad;
  for (let k = 0; k < uv.count; k++) { const u = uv.getX(k), v = uv.getY(k); const px = col * A.cell + A.pad + u * inner; const py = row * A.cell + A.pad + (1 - v) * inner; uv.setXY(k, px / A.W, 1 - py / A.H); }
  g.rotateX(-Math.PI / 2); return g;
}

// ---------------------------------------------------------------- more canvas/geometry helpers
function worldUV(g, scale = 1) { // box-style planar UVs in world units so tiling textures keep their size
  const p = g.attributes.position, n = g.attributes.normal; const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)); let u, v;
    if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); } else if (ay >= az) { u = p.getX(i); v = p.getZ(i); } else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g;
}
function stoneBlockCanvas() {
  const S = 256; const [c, g] = canvas(S, S); rnd = mulberry32(77);
  g.fillStyle = '#B9A88E'; g.fillRect(0, 0, S, S);
  const rows = 4, rh = S / rows; const cols = ['#E6DAC6', '#DCCCB2', '#EADFCD', '#D9C9AE', '#E2D5BF'];
  for (let r = 0; r < rows; r++) { const off = (r % 2) * (S / 6); for (let k = -1; k < 4; k++) { const x = off + k * S / 3; for (const dx of [0, -S, S]) { g.fillStyle = pick(cols); g.beginPath(); g.roundRect(x + dx + 3, r * rh + 3, S / 3 - 6, rh - 6, 9); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.roundRect(x + dx + 8, r * rh + 7, S / 3 - 26, 7, 4); g.fill(); } } }
  return c;
}

// ---------------------------------------------------------------- shared building bits
function gableRoof(B, F, { cx = 0, cy, cz = 0, span, len, rise, over = 0.25, thick = 0.14, mat, ridge, outline = 0.04 }) {
  const half = span / 2 + over; const ang = Math.atan2(rise, span / 2); const slope = half / Math.cos(ang);
  for (const sgn of [1, -1]) {
    const dirZ = sgn * Math.cos(ang), dirY = -Math.sin(ang), nZ = sgn * Math.sin(ang), nY = Math.cos(ang);
    const mz = cz + dirZ * slope / 2 - nZ * thick / 2, my = cy + rise + dirY * slope / 2 - nY * thick / 2;
    B.add(box(len + over * 2, thick, slope), mat, F(cx, my, mz, sgn * ang, 0, 0), outline);
  }
  B.add(cyl(thick * 0.95, thick * 0.95, len + over * 2 + 0.06, 8), ridge || mat, F(cx, cy + rise, cz, 0, 0, Math.PI / 2), outline);
}
function windowAt(B, F, x, y, z, { w = 0.5, h = 0.62, lit = false, ry = 0, arch = true } = {}) {
  if (arch) {
    B.add(archGeo(w + 0.14, h + 0.12, 0.05), 'white2', F(x, y - 0.06, z, 0, ry, 0), 0.025);
    B.add(archGeo(w, h, 0.05), lit ? 'glassWarm' : 'windowDark', F(x, y, z + 0.025 * Math.cos(ry), 0, ry, 0), 0, false);
  } else {
    B.add(box(w + 0.14, h + 0.14, 0.05), 'white2', F(x, y + h / 2, z, 0, ry, 0), 0.025);
    B.add(box(w, h, 0.05), lit ? 'glassWarm' : 'windowDark', F(x, y + h / 2, z + 0.025 * Math.cos(ry), 0, ry, 0), 0, false);
    B.add(box(0.05, h, 0.04), 'white2', F(x, y + h / 2, z + 0.05 * Math.cos(ry), 0, ry, 0), 0, false);
  }
}
function flowerBox(B, F, x, y, z, w = 0.8, palette = ['pink', 'fmn']) {
  B.add(box(w, 0.18, 0.22), 'woodLight', F(x, y, z), 0.025);
  const n = Math.round(w / 0.13);
  for (let i = 0; i < n; i++) B.add(sph(0.075, 6, 4), palette[i % palette.length], F(x - w / 2 + 0.08 + i * (w - 0.16) / Math.max(1, n - 1), y + 0.13 + (i % 2) * 0.03, z + rand(-0.04, 0.04)), 0, false);
}
function chalkTexture(lines, { w = 256, h = 320, bg = '#3D4A48' } = {}) {
  const [c, g] = canvas(w, h); g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.06)'; for (let i = 0; i < 40; i++) g.fillRect(rand(0, w), rand(0, h), rand(10, 40), 2);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const lh = h / (lines.length + 1);
  lines.forEach((l, i) => { const [text, color = '#FFFFFF', size = 34] = Array.isArray(l) ? l : [l]; g.font = `700 ${size}px ${FONT}`; g.fillStyle = color; g.fillText(text, w / 2, lh * (i + 1)); });
  return canvasTex(c);
}
function plaqueTexture(text, { w = 512, h = 128, bg = '#FFF3DC', fg = '#8B5E3C', border = '#2B2440', size = 64 } = {}) {
  const [c, g] = canvas(w, h); g.fillStyle = border; g.beginPath(); g.roundRect(0, 0, w, h, h * 0.3); g.fill();
  g.fillStyle = bg; g.beginPath(); g.roundRect(6, 6, w - 12, h - 12, h * 0.26); g.fill();
  g.font = `700 ${size}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = fg; g.fillText(text, w / 2, h / 2 + 3);
  return canvasTex(c);
}
function texturedPlane(group, tex, w, h, m, gradientMap) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshToonMaterial({ map: tex, gradientMap })); mesh.name = 'v:sign';
  mesh.matrixAutoUpdate = false; mesh.matrix.copy(m); mesh.receiveShadow = true; group.add(mesh); return mesh;
}
function chalkboard(B, group, F, x, z, yaw, lines, gradientMap, k = 1.3) { // an A-frame chalkboard sign, k = size
  const lean = -0.2;
  B.add(box(0.74 * k, 0.92 * k, 0.05), 'woodLight', F(x, 0.5 * k, z, lean, yaw, 0), 0.03);
  B.add(box(0.7 * k, 0.88 * k, 0.04), 'woodLight', F(x - Math.sin(yaw) * 0.32 * k, 0.5 * k, z - Math.cos(yaw) * 0.32 * k, -lean, yaw, 0), 0.03);
  const tex = chalkTexture(lines);
  texturedPlane(group, tex, 0.62 * k, 0.78 * k, F(x + Math.sin(yaw) * 0.03, 0.51 * k, z + Math.cos(yaw) * 0.03, lean, yaw, 0), gradientMap);
}

const PAL = {
  blue: [0x5B8DEF, 0x7AA3F2, 0x6E8FE0, 0x8DB2F5], pink: [0xF29BC8, 0xF7B7D6, 0xE886B8, 0xFAD0E3],
  mixed: [0x5B8DEF, 0x7AA3F2, 0xF29BC8, 0xF7B7D6, 0xFFF8F0, 0xB48BE0, 0xF7D774, 0x5B8DEF, 0xF29BC8],
};
function flowerGeo() {
  const pos = [], nrm = [];
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * TAU; const c = Math.cos(a), s = Math.sin(a); const a1 = a - 0.5, a2 = a + 0.5;
    const tip = [c * 1.0, 0.22, s * 1.0], l = [Math.cos(a1) * 0.6, 0.12, Math.sin(a1) * 0.6], r = [Math.cos(a2) * 0.6, 0.12, Math.sin(a2) * 0.6], o = [c * 0.12, 0.02, s * 0.12];
    pos.push(...o, ...r, ...l, ...l, ...r, ...tip);
    for (let k = 0; k < 6; k++) nrm.push(0, 1, 0);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); return g;
}
function tuftGeo() {
  const pos = [], nrm = [];
  for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI + 0.3; const c = Math.cos(a) * 0.12, s = Math.sin(a) * 0.12; const lean = [Math.cos(a + 1.2) * 0.12, Math.sin(a + 1.2) * 0.12];
    pos.push(-c, 0, -s, c, 0, s, lean[0], 0.42 + i * 0.05, lean[1]); for (let k = 0; k < 3; k++) nrm.push(0, 1, 0); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); return g;
}

function pointsMaterial(map, { additive = false } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uMap: { value: map }, uTime: { value: 0 }, uScale: { value: 800 } },
    vertexShader: `uniform float uTime; uniform float uScale; attribute float aSize; attribute float aAlpha; attribute vec3 aColor; attribute float aPhase; attribute float aTwinkle;
      varying float vAlpha; varying vec3 vColor;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float tw = mix(1.0, pow(0.5 + 0.5 * sin(uTime * (1.6 + fract(aPhase * 7.0) * 2.2) + aPhase * 30.0), 2.5), aTwinkle);
        vAlpha = aAlpha * tw; vColor = aColor; gl_PointSize = aSize * uScale * mix(1.0, 0.45 + 0.55 * tw, aTwinkle) / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D uMap; varying float vAlpha; varying vec3 vColor;
      void main(){ vec4 c = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vColor * c.rgb, c.a * vAlpha); if (gl_FragColor.a < 0.01) discard;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
function makePoints(n, map, opts) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1)); g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3)); g.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(n), 1)); g.setAttribute('aTwinkle', new THREE.BufferAttribute(new Float32Array(n), 1));
  const mat = pointsMaterial(map, opts); const pts = new THREE.Points(g, mat); pts.frustumCulled = false;
  const size = new THREE.Vector2();
  pts.onBeforeRender = (renderer, scene, camera) => { renderer.getDrawingBufferSize(size); mat.uniforms.uScale.value = size.y / (2 * Math.tan(THREE.MathUtils.degToRad((camera.fov || 40) / 2))); };
  return pts;
}

function ginghamTexture() {
  const S = 128; const [c, g] = canvas(S, S); g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(242,155,200,0.55)'; for (let i = 0; i < 8; i++) { g.fillRect(i * 16, 0, 8, S); g.fillRect(0, i * 16, S, 8); }
  return canvasTex(c, { repeat: true });
}

// ================================================================= terrain: ground, rim skirt, wooden base
const GC = {
  low: new THREE.Color(0x9BD07A), low2: new THREE.Color(0x88C36C), high: new THREE.Color(0xC8E79E), high2: new THREE.Color(0xB6DD8E),
  worn: new THREE.Color(0xD9DDA6), sand: new THREE.Color(0xE9DAAA), bed: new THREE.Color(0x86C6D8), bed2: new THREE.Color(0x62A9C9), soil: new THREE.Color(0xA9926A),
};
const _gc2 = new THREE.Color();
const BED_TINT = { blue: new THREE.Color(0xA9C4EE), pink: new THREE.Color(0xF2BCD4), mixed: new THREE.Color(0xDCC8EA) };
function bedWeight(x, z) { // strongest flower-bed tint at (x, z): { w, col }
  let w = 0, col = null;
  for (const b of BEDS) { const c = Math.cos(b.rot), s = Math.sin(b.rot); const dx = x - b.x, dz = z - b.z; const u = (dx * c - dz * s) / b.rx, v = (dx * s + dz * c) / b.rz; const r = Math.hypot(u, v); if (r < 1.15) { const k = 1 - smooth(0.75, 1.15, r); if (k > w) { w = k; col = BED_TINT[b.pal] || BED_TINT.mixed; } } }
  return { w, col };
}
function groundColor(x, z, I, out) {
  const n = fbm(x * 0.11 + 11, z * 0.11 - 4);
  out.copy(GC.low).lerp(GC.low2, n).lerp(_gc2.copy(GC.high).lerp(GC.high2, n), smooth(0.4, 3.6, I.h));
  if (I.rn.dist < PATH_HW + 1.4) out.lerp(GC.worn, 0.5 * (1 - smooth(PATH_HW, PATH_HW + 1.2, I.rn.dist)));
  const bw = bedWeight(x, z); if (bw.w > 0) out.lerp(GC.soil, 0.18 * bw.w).lerp(bw.col, 0.5 * bw.w);
  const e = I.wn.e; if (e < 1.0) { if (e >= 0) out.lerp(GC.sand, 1 - smooth(0.1, 1.0, e)); else out.copy(GC.sand).lerp(GC.bed, smooth(0, 0.3, -e)).lerp(GC.bed2, smooth(0.3, 0.9, -e)); }
  out.multiplyScalar(0.95 + vnoise(x * 0.35 - 2, z * 0.35 + 9) * 0.09);
  return out;
}
function buildGround(group, gradientMap, inkMat) {
  const SEG = 136, NV = SEG + 1, step = 2 * HALF / SEG;
  const pos = new Float32Array(NV * NV * 3), col = new Float32Array(NV * NV * 3); const c = new THREE.Color();
  for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
    const [x, z] = clampBoard(-HALF + i * step, -HALF + j * step); const I = groundInfo(x, z); const k = (j * NV + i) * 3;
    pos[k] = x; pos[k + 1] = I.h; pos[k + 2] = z; groundColor(x, z, I, c); col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
  }
  const idx = new Uint32Array(SEG * SEG * 6); let t = 0;
  for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
    const a = j * NV + i, b = a + 1, cc = a + NV, d = cc + 1;
    if ((i + j) % 2) { idx[t++] = a; idx[t++] = cc; idx[t++] = b; idx[t++] = b; idx[t++] = cc; idx[t++] = d; }
    else { idx[t++] = a; idx[t++] = cc; idx[t++] = d; idx[t++] = a; idx[t++] = d; idx[t++] = b; }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })); ground.receiveShadow = true; ground.name = 'v:ground'; group.add(ground);
  // rim skirt: grass lip + layered soil down to the wooden base
  const ring = []; for (let i = 0; i <= SEG; i++) ring.push(i); for (let j = 1; j <= SEG; j++) ring.push(j * NV + SEG); for (let i = SEG - 1; i >= 0; i--) ring.push(SEG * NV + i); for (let j = SEG - 1; j >= 1; j--) ring.push(j * NV);
  const rows = [[0, 0x7FB062], [-0.22, 0xC39A6C], [-0.3, 0xF4E3C6], [-0.42, 0xB58C61], [null, 0x8C6747]];
  const rp = [], rc = [], ri = []; const R = rows.length;
  const rowCols = rows.map(r => new THREE.Color(r[1]));
  for (const vi of ring) { const x = pos[vi * 3], y = pos[vi * 3 + 1], z = pos[vi * 3 + 2]; rows.forEach(([dy], r) => { rp.push(x * 1.0004, dy === null ? SOIL_Y : Math.max(SOIL_Y + 0.05, y + dy), z * 1.0004); rc.push(rowCols[r].r, rowCols[r].g, rowCols[r].b); }); }
  for (let k = 0; k < ring.length; k++) { const k2 = (k + 1) % ring.length; for (let r = 0; r < R - 1; r++) { const a = k * R + r, b = k2 * R + r; ri.push(a, a + 1, b, b, a + 1, b + 1); } }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3)); rg.setIndex(ri); rg.computeVertexNormals();
  const rim = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })); rim.name = 'v:rim'; group.add(rim);
  // wooden base plate + pink trim + ink outline
  const plateGeo = new THREE.ExtrudeGeometry(roundRectShape(HALF + 0.55, CORNER + 0.55), { depth: 0.5, bevelEnabled: false, curveSegments: 16 }); plateGeo.rotateX(-Math.PI / 2); plateGeo.translate(0, SOIL_Y - 0.5, 0);
  const plate = new THREE.Mesh(plateGeo, new THREE.MeshToonMaterial({ color: 0xE8C9A0, gradientMap })); plate.receiveShadow = true; plate.name = 'v:plate'; group.add(plate);
  const trimShape = roundRectShape(HALF + 0.66, CORNER + 0.66); trimShape.holes.push(roundRectShape(HALF + 0.45, CORNER + 0.45));
  const trimGeo = new THREE.ExtrudeGeometry(trimShape, { depth: 0.12, bevelEnabled: false, curveSegments: 16 }); trimGeo.rotateX(-Math.PI / 2); trimGeo.translate(0, SOIL_Y - 0.08, 0);
  const trim = new THREE.Mesh(trimGeo, new THREE.MeshToonMaterial({ color: 0xF29BC8, gradientMap })); trim.name = 'v:trim'; group.add(trim);
  const inkGeo = new THREE.ExtrudeGeometry(roundRectShape(HALF + 0.76, CORNER + 0.76), { depth: 0.66, bevelEnabled: false, curveSegments: 16 }); inkGeo.rotateX(-Math.PI / 2); inkGeo.translate(0, SOIL_Y - 0.58, 0);
  const ink = new THREE.Mesh(inkGeo, inkMat); ink.name = 'v:plateInk'; group.add(ink);
  return { ground, ring: ring.map(vi => [pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]]) };
}

// ================================================================= the cobble path, stone steps and border stones
function onBridgeSpan(d, pad = 0) { const dd = Math.abs(wrapD(d - BR.d + LOOP / 2, LOOP) - LOOP / 2); return dd < BRIDGE_HL + pad; }
function buildPath(group, gradientMap, textures) {
  const rs = risers();
  const rows = []; for (let d = 0; d < LOOP; d += 0.2) rows.push({ d });
  rows.push({ d: LOOP });
  for (const r of rs) { rows.push({ d: r.d - 0.004, y: r.a, riser: true }, { d: r.d + 0.004, y: r.b, riser: true }); }
  rows.sort((p, q) => p.d - q.d);
  const keep = []; for (const r of rows) { const prev = keep[keep.length - 1]; if (prev && !r.riser && !prev.riser && r.d - prev.d < 0.05) continue; if (prev && !r.riser && prev.riser && r.d - prev.d < 0.03) continue; keep.push(r); }
  // per-row frame
  let s3 = 0, last = null;
  for (const r of keep) {
    const f = routeFrame(r.d); r.f = f; r.y = (r.y ?? pathY(r.d)) + 0.02;
    if (last) s3 += Math.hypot(f.x - last.f.x, f.z - last.f.z, r.y - last.y); r.s = s3; last = r;
    r.bridge = onBridgeSpan(r.d, -0.02);
  }
  const pos = [], nrm = [], uv = []; const sp = [], sn = [], sc = []; const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), nn = new THREE.Vector3();
  const tri = (P, U, a, b, c) => { v1.subVectors(b, a); v2.subVectors(c, a); nn.crossVectors(v1, v2).normalize(); for (const [p, w] of [[a, U[0]], [b, U[1]], [c, U[2]]]) { pos.push(p.x, p.y, p.z); nrm.push(nn.x, nn.y, nn.z); uv.push(w[0], w[1]); } };
  const skirtCol = [new THREE.Color(0xD8C8AE), new THREE.Color(0xB9A688)];
  const skirt = (a, b, ox, oz) => { // vertical stone curb from the path edge down into the ground
    const a2 = a.clone().setY(a.y - 0.5), b2 = b.clone().setY(b.y - 0.5);
    for (const q of [a, a2, b, b, a2, b2]) { sp.push(q.x + ox * 0.012, q.y, q.z + oz * 0.012); sn.push(ox, 0, oz); const k = q === a || q === b ? 0 : 1; sc.push(skirtCol[k].r, skirtCol[k].g, skirtCol[k].b); }
  };
  const L = (r) => new THREE.Vector3(r.f.x + r.f.nx * PATH_HW, r.y, r.f.z + r.f.nz * PATH_HW), Rr = (r) => new THREE.Vector3(r.f.x - r.f.nx * PATH_HW, r.y, r.f.z - r.f.nz * PATH_HW);
  for (let k = 0; k < keep.length - 1; k++) {
    const a = keep[k], b = keep[k + 1]; if (a.bridge || b.bridge) continue;
    const L0 = L(a), R0 = Rr(a), L1 = L(b), R1 = Rr(b); const u0 = a.s / 2.6, u1 = b.s / 2.6;
    tri(null, [[u0, 1], [u1, 1], [u0, 0]], L0, L1, R0); tri(null, [[u0, 0], [u1, 1], [u1, 0]], R0, L1, R1);
    skirt(L0, L1, a.f.nx, a.f.nz); skirt(R0, R1, -a.f.nx, -a.f.nz);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  let tex = textures.tex_cobble;
  if (tex) { tex = tex.clone(); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.needsUpdate = true; }
  else tex = canvasTex(cobbleCanvas(), { repeat: true, aniso: 8 });
  const mat = new THREE.MeshToonMaterial({ map: tex, gradientMap, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const band = new THREE.Mesh(g, mat); band.receiveShadow = true; band.name = 'v:path'; group.add(band);
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setAttribute('normal', new THREE.Float32BufferAttribute(sn, 3)); sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
  const curb = new THREE.Mesh(sg, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap, side: THREE.DoubleSide })); curb.receiveShadow = true; curb.name = 'v:pathCurb'; group.add(curb);
  // step nosings: pale stone lips on every riser
  const nose = new THREE.InstancedMesh(new THREE.BoxGeometry(PATH_HW * 2 + 0.06, 0.07, 0.16), new THREE.MeshToonMaterial({ color: 0xF4EEE2, gradientMap }), rs.length);
  rs.forEach((r, i) => { const up = r.b > r.a ? 1 : -1; const f = routeFrame(r.d + up * 0.08); nose.setMatrixAt(i, mat4(f.x, r.hi + 0.02, f.z, 0, Math.atan2(-f.nz, f.nx), 0)); });
  nose.receiveShadow = true; nose.castShadow = false; nose.name = 'v:stepNosings'; group.add(nose);
  // border stones along both edges
  rnd = mulberry32(404); const mats = []; const S = P.stair;
  for (let d = 0.2; d < LOOP; d += 0.44) {
    if (onBridgeSpan(d, 0.15)) continue; const f = routeFrame(d); const y = pathY(d);
    for (const sgn of [-1, 1]) {
      const e = PATH_HW + 0.06; const x = f.x + f.nx * e * sgn + rand(-0.03, 0.03), z = f.z + f.nz * e * sgn + rand(-0.03, 0.03);
      if (S && Math.abs(x - S.x) < S.w / 2 + 0.25 && z > S.z0 - 0.4 && z < S.z1 + 0.7) continue;
      if (waterNear(x, z).e < 0.25) continue;
      mats.push(mat4(x, y + 0.04, z, rand(-0.2, 0.2), rand(0, TAU), rand(-0.2, 0.2), rand(0.17, 0.23), rand(0.07, 0.1), rand(0.15, 0.2)));
    }
  }
  const stones = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap }), mats.length);
  const cols = [0xEFE6D6, 0xE2D5BF, 0xD8C9B0, 0xF4EDE1].map(h => new THREE.Color(h));
  mats.forEach((m, i) => { stones.setMatrixAt(i, m); stones.setColorAt(i, cols[i % cols.length]); });
  stones.receiveShadow = true; stones.name = 'v:borderStones'; group.add(stones);
  return { tex };
}

// ================================================================= tiles (merged bodies / ink hulls / atlas decals + per-tile highlight groups)
async function buildTiles(group, textures, images, gradientMap, inkMat) {
  const A = await buildTileAtlas(textures, images);
  const decalMat = new THREE.MeshToonMaterial({ map: A.tex, gradientMap, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const prof = [[0.0, -0.05], [TILE_R - 0.05, -0.05], [TILE_R, 0.02], [TILE_R - 0.015, 0.07], [TILE_R - 0.06, 0.09]].map(([r, y]) => new THREE.Vector2(r, y));
  const bodyGeo = new THREE.LatheGeometry(prof, 26); bodyGeo.deleteAttribute('uv');
  const hullGeo = new THREE.LatheGeometry([[TILE_R - 0.05, -0.05], [TILE_R, 0.02], [TILE_R - 0.06, 0.09]].map(([r, y]) => new THREE.Vector2(r, y)), 20); hullGeo.scale(1.04, 1.0, 1.04); hullGeo.translate(0, -0.008, 0); hullGeo.deleteAttribute('uv'); hullGeo.deleteAttribute('normal');
  const glowTex = (() => { const S = 128; const [c, g] = canvas(S, S); const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.62, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.78, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, S, S); return new THREE.CanvasTexture(c); })();
  const ringGeo = new THREE.TorusGeometry(TILE_R + 0.1, 0.09, 8, 56); ringGeo.rotateX(Math.PI / 2);
  const beamTex = (() => { const [c, g] = canvas(4, 128); const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0.9)'); g.fillStyle = gr; g.fillRect(0, 0, 4, 128); return new THREE.CanvasTexture(c); })();
  const beamGeo = new THREE.CylinderGeometry(TILE_R + 0.02, TILE_R + 0.12, 1.8, 40, 1, true); beamGeo.translate(0, 0.9, 0);
  const glowGeo = new THREE.CircleGeometry(TILE_R + 0.55, 48); glowGeo.rotateX(-Math.PI / 2);
  const tiles = new Map(); const hls = []; const bodies = [], hulls = [], decals = [], halos = [];
  for (const s of SPACES) {
    const base = s.index === BR_I ? DECK_TOP : s.pos[1] + 0.02; const x = s.pos[0], z = s.pos[2];
    const col = new THREE.Color(s.color);
    const b = bodyGeo.clone(); b.translate(x, base, z); const bc = col.clone().multiplyScalar(0.86); const ca = new Float32Array(b.attributes.position.count * 3); for (let i = 0; i < ca.length; i += 3) { ca[i] = bc.r; ca[i + 1] = bc.g; ca[i + 2] = bc.b; } b.setAttribute('color', new THREE.BufferAttribute(ca, 3)); bodies.push(b);
    const h = hullGeo.clone(); h.translate(x, base, z); hulls.push(h);
    const dg = decalGeo(s.index, A); dg.translate(x, base + 0.092, z); decals.push(dg);
    if (s.type !== 'cobble') {
      const rg = new THREE.RingGeometry(TILE_R - 0.05, TILE_R + 0.5, 48, 1); rg.rotateX(-Math.PI / 2); rg.translate(x, base + 0.012, z);
      const n = rg.attributes.position.count; const cc = new Float32Array(n * 4); const hc = col.clone().lerp(new THREE.Color(0xffffff), 0.15);
      for (let i = 0; i < n; i++) { const d = Math.hypot(rg.attributes.position.getX(i) - x, rg.attributes.position.getZ(i) - z); cc.set([hc.r, hc.g, hc.b, d < TILE_R + 0.1 ? 0.8 : 0], i * 4); }
      rg.setAttribute('color', new THREE.BufferAttribute(cc, 4)); rg.deleteAttribute('uv'); rg.deleteAttribute('normal'); halos.push(rg);
    }
    // per-tile object (position = tile top) + highlight
    const tg = new THREE.Group(); tg.name = `tile:${s.index}`; tg.position.set(x, base + 0.09, z);
    const hl = new THREE.Group(); hl.visible = false;
    const bright = col.clone().lerp(new THREE.Color(0xffffff), 0.35).multiplyScalar(2.2);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: bright, transparent: true, opacity: 0, depthWrite: false })); ring.position.y = 0.0; hl.add(ring);
    const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ color: col.clone().lerp(new THREE.Color(0xffffff), 0.3), map: glowTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); glow.position.y = 0.01; hl.add(glow);
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: col.clone().lerp(new THREE.Color(0xffffff), 0.4), map: beamTex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })); beam.position.y = -0.08; hl.add(beam);
    tg.add(hl); tg.userData = { index: s.index, type: s.type, top: base + 0.09, hl: { group: hl, ring, glow, beam, level: 0, target: 0 } };
    hls.push(tg.userData.hl); group.add(tg); tiles.set(s.index, tg);
  }
  const bodyMesh = new THREE.Mesh(mergeGeometries(bodies, false), new THREE.MeshToonMaterial({ vertexColors: true, gradientMap })); bodyMesh.receiveShadow = true; bodyMesh.name = 'v:tileBodies'; group.add(bodyMesh);
  const hullMesh = new THREE.Mesh(mergeGeometries(hulls, false), inkMat); hullMesh.name = 'v:tileInk'; group.add(hullMesh);
  const decalMesh = new THREE.Mesh(mergeGeometries(decals, false), decalMat); decalMesh.receiveShadow = true; decalMesh.name = 'v:tileDecals'; group.add(decalMesh);
  const halo = new THREE.Mesh(mergeGeometries(halos, false), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })); halo.name = 'v:halos'; halo.renderOrder = 1; group.add(halo);
  [bodies, hulls, decals, halos].forEach(l => l.forEach(g => g.dispose()));
  function setTileHighlight(i, on) { const t = tiles.get(i); if (!t) return; const h = t.userData.hl; h.target = on ? 1 : 0; if (on) h.group.visible = true; }
  function tileAnim(dt, t) {
    for (const h of hls) {
      if (!h.group.visible) continue;
      h.level += (h.target - h.level) * Math.min(1, dt * 7);
      if (h.target === 0 && h.level < 0.02) { h.level = 0; h.group.visible = false; continue; }
      const p = 0.5 + 0.5 * Math.sin(t * 6.5);
      h.ring.material.opacity = h.level * (0.65 + 0.35 * p); h.ring.scale.setScalar(1 + 0.05 * p * h.level);
      h.glow.material.opacity = h.level * (0.35 + 0.3 * p);
      h.beam.material.opacity = h.level * (0.45 + 0.25 * p); h.beam.scale.set(1, 0.85 + 0.15 * p, 1);
    }
  }
  return { tiles, setTileHighlight, tileAnim };
}

// ================================================================= water: river ribbons, pools, rim falls, the castle-hill cascade
function riverGeo(R) {
  const pos = [], uv = [], col = [], idx = []; const edge = new THREE.Color(0xA6DCF0), mid = new THREE.Color(0x5FB2DC); const pts = R.pts;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const p = pts[i]; const w = p.w + 0.32; const nx = -tz, nz = tx; const v = p.s / 2.6;
    pos.push(p.x + nx * w, p.y, p.z + nz * w, p.x, p.y, p.z, p.x - nx * w, p.y, p.z - nz * w); uv.push(0, v, 0.5, v, 1, v);
    col.push(edge.r, edge.g, edge.b, mid.r, mid.g, mid.b, edge.r, edge.g, edge.b);
    if (i > 0) { const A = (i - 1) * 3, B = i * 3; idx.push(A, B, A + 1, A + 1, B, B + 1, A + 1, B + 1, A + 2, A + 2, B + 1, B + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  if (g.attributes.normal.getY(1) < 0) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } g.computeVertexNormals(); }
  return g;
}
function discWaterGeo(r, y, segs = 40) {
  const g = new THREE.CircleGeometry(r, segs); g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
  const n = g.attributes.position.count; const col = new Float32Array(n * 3); const edge = new THREE.Color(0xA6DCF0), mid = new THREE.Color(0x5FB2DC);
  for (let i = 0; i < n; i++) { const d = Math.hypot(g.attributes.position.getX(i), g.attributes.position.getZ(i)) / r; const c = mid.clone().lerp(edge, smooth(0.35, 1, d)); col.set([c.r, c.g, c.b], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
}
function fallRibbon(curvePts, w0, w1, side, segs = 24) { // a ribbon along a 3D curve, widened across `side`
  const curve = new THREE.CatmullRomCurve3(curvePts); const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) { const p = curve.getPoint(i / segs); const w = lerp(w0, w1, i / segs); pos.push(p.x - side.x * w, p.y, p.z - side.z * w, p.x + side.x * w, p.y, p.z + side.z * w); uv.push(0, -i / segs * 1.6, 1, -i / segs * 1.6); if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
function buildWater(group, B, animators, foamSpots) {
  const flowTex = canvasTex(flowCanvas(), { repeat: true }); flowTex.colorSpace = THREE.NoColorSpace;
  const flowMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0, emissive: 0xffffff, emissiveMap: flowTex, emissiveIntensity: 0.32 });
  const stillTex = canvasTex(flowCanvas(), { repeat: true }); stillTex.colorSpace = THREE.NoColorSpace; stillTex.repeat.set(2, 1);
  const stillMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0, emissive: 0xffffff, emissiveMap: stillTex, emissiveIntensity: 0.18 });
  RIVERS.forEach((R, k) => { const m = new THREE.Mesh(riverGeo(R), flowMat); m.position.y = -0.012 * k; m.receiveShadow = true; m.name = 'v:river:' + R.name; group.add(m); });
  for (const p of POOLS) { const m = new THREE.Mesh(discWaterGeo(p.r + 0.32, p.y + 0.004, 40), stillMat); m.position.set(p.x, 0, p.z); m.receiveShadow = true; m.name = 'v:pool:' + p.name; group.add(m); }
  const fallTex = canvasTex(fallCanvas(), { repeat: true });
  const fallMat = new THREE.MeshBasicMaterial({ map: fallTex, side: THREE.DoubleSide });
  // rim falls where the river arms leave the board
  for (const R of RIVERS) {
    const e = R.pts[R.pts.length - 1]; if (!e.exit) continue; const pv = R.pts[R.pts.length - 3];
    let ox = e.x - pv.x, oz = e.z - pv.z; const l = Math.hypot(ox, oz) || 1; ox /= l; oz /= l;
    const top = e.y, bot = SOIL_Y + 0.02; const w = e.w + 0.3;
    const g = fallRibbon([new THREE.Vector3(e.x - ox * 0.25, top, e.z - oz * 0.25), new THREE.Vector3(e.x + ox * 0.12, top - 0.08, e.z + oz * 0.12), new THREE.Vector3(e.x + ox * 0.3, top - 0.6, e.z + oz * 0.3), new THREE.Vector3(e.x + ox * 0.42, bot, e.z + oz * 0.42)], w, w * 1.08, new THREE.Vector3(-oz, 0, ox), 12);
    const m = new THREE.Mesh(g, fallMat); m.name = 'v:rimFall'; group.add(m);
    foamSpots.push({ x: e.x + ox * 0.5, y: bot + 0.04, z: e.z + oz * 0.5, r: w * 0.8, n: 8, ox, oz });
  }
  // the waterfall from the castle hill: a rock pile with a two-step cascade into its pool
  const C = P.cascade, pool = POOLS[0]; const gy = groundAt(C.x, C.z);
  rnd = mulberry32(1203);
  const rocks = [[0, 0.5, 0, 1.45, 'stone'], [-0.95, 0.35, 0.35, 0.95, 'stoneDark'], [0.95, 0.4, 0.3, 1.0, 'stoneWarm'], [-0.4, 1.35, -0.25, 1.05, 'stoneDark'], [0.45, 1.5, -0.2, 0.95, 'stone'], [0.0, 2.15, -0.45, 0.8, 'stoneWarm'], [-0.85, 1.1, 0.75, 0.55, 'stone'], [0.85, 1.0, 0.7, 0.58, 'stoneDark'], [-1.4, 0.25, 1.1, 0.5, 'stoneWarm'], [1.35, 0.25, 1.15, 0.5, 'stone']];
  const toPool = new THREE.Vector2(pool.x - C.x, pool.z - C.z).normalize(); const yaw = Math.atan2(toPool.x, toPool.y); const F = frameAt(C.x, gy, C.z, yaw);
  rocks.forEach(([x, y, z, r, m], i) => B.add(new THREE.DodecahedronGeometry(r, 0), m, F(x, y, z, i * 0.7, i * 1.3, i * 0.4, 1, 0.82, 1), 0.05));
  for (const [x, y, z, r] of [[-0.6, 2.2, -0.1, 0.42], [0.7, 1.95, 0.05, 0.36], [-1.1, 1.3, 0.55, 0.3], [0.2, 2.75, -0.5, 0.38]]) B.add(sph(r, 9, 6), 'moss', F(x, y, z, 0, 0, 0, 1.2, 0.55, 1.1), 0.03);
  const lip = new THREE.Vector3().setFromMatrixPosition(F(0.05, 2.32, 0.55)), ledge = new THREE.Vector3().setFromMatrixPosition(F(0.12, 1.25, 1.25)), ledge2 = new THREE.Vector3().setFromMatrixPosition(F(0.15, 1.12, 1.5)), foot = new THREE.Vector3().setFromMatrixPosition(F(0.18, pool.y + 0.02 - gy, 2.05));
  const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const fall = new THREE.Mesh(fallRibbon([lip.clone().add(new THREE.Vector3(0, 0.02, 0)).sub(new THREE.Vector3(Math.sin(yaw) * 0.3, 0, Math.cos(yaw) * 0.3)), lip, ledge.clone().add(new THREE.Vector3(0, 0.25, 0)), ledge, ledge2, ledge2.clone().lerp(foot, 0.5).add(new THREE.Vector3(0, 0.1, 0)), foot], 0.32, 0.52, side, 30), fallMat);
  fall.name = 'v:waterfall'; group.add(fall);
  foamSpots.push({ x: foot.x, y: pool.y + 0.03, z: foot.z, r: 0.55, n: 9 }, { x: ledge2.x, y: ledge2.y + 0.02, z: ledge2.z, r: 0.25, n: 4 });
  animators.push((dt) => { flowTex.offset.y -= dt * 0.22; stillTex.offset.x += dt * 0.012; stillTex.offset.y -= dt * 0.02; fallTex.offset.y += dt * 0.9; });
  return { flowMat, stillMat, fallMat, cascadeFoot: foot, cascadeTop: lip };
}

// ================================================================= the stone bridge over the river (deck centred on the bridge tile)
function buildBridge(B, group, pathTex, gradientMap) {
  const F = frameAt(BR.x, 0, BR.z, BR.yaw); // local X = route tangent, local Z = inner side (stream comes from +Z)
  const L = BRIDGE_HL, D = BRIDGE_HW; const wy = waterNear(BR.x, BR.z).y;
  const AX = 1.3, AC = wy - 0.12, AY = Math.max(0.42, (DECK_TOP - 0.36) - AC); const bot = wy - 0.8; const bv = 0.05;
  const s = new THREE.Shape();
  s.moveTo(-L + bv, bot); s.lineTo(-AX - bv, bot); s.lineTo(-AX - bv, AC);
  s.absellipse(0, AC, AX + bv, AY + bv, Math.PI, 0, true);
  s.lineTo(AX + bv, bot); s.lineTo(L - bv, bot);
  for (let i = 0; i <= 20; i++) { const x = (L - bv) - i / 20 * 2 * (L - bv); s.lineTo(x, deckY(x) - bv - 0.012); }
  s.closePath();
  const body = new THREE.ExtrudeGeometry(s, { depth: D * 2 - 2 * bv, bevelEnabled: true, bevelThickness: bv, bevelSize: bv, bevelSegments: 1, curveSegments: 22 });
  body.translate(0, 0, -D + bv);
  B.add(body, 'bridgeTex', F(), 0.03);
  // arch ring stones + keystone on both faces
  const ring = new THREE.Shape(); ring.absellipse(0, AC, AX + 0.2, AY + 0.17, 0, Math.PI, false); ring.absellipse(0, AC, AX - 0.005, AY - 0.005, Math.PI, 0, true); ring.closePath();
  const ringGeo = new THREE.ExtrudeGeometry(ring, { depth: 0.08, bevelEnabled: false, curveSegments: 24 });
  for (const zs of [-1, 1]) {
    B.add(ringGeo, 'coping', F(0, 0, zs > 0 ? D + 0.03 : -D - 0.11), 0, false);
    for (let i = 1; i < 8; i++) { if (i === 4) continue; const a = i / 8 * Math.PI; B.add(box(0.035, 0.2, 0.02), 'stoneDark', F(Math.cos(a) * (AX + 0.1), AC + Math.sin(a) * (AY + 0.085), zs * (D + 0.115), 0, 0, a - Math.PI / 2), 0, false); }
    B.add(box(0.28, 0.24, 0.12), 'coping', F(0, AC + AY + 0.05, zs * (D + 0.08)), 0, false);
  }
  const vault = new THREE.CylinderGeometry(1, 1, D * 2 + 0.06, 18, 1, true, Math.PI / 2, Math.PI); vault.rotateX(Math.PI / 2); vault.scale(AX - 0.01, AY - 0.01, 1); vault.translate(0, AC, 0);
  B.add(vault, 'vault', F(), 0, false);
  // cobble deck following the deck profile
  const deck = new THREE.PlaneGeometry(L * 2 - 0.04, PATH_HW * 2, 24, 1); deck.rotateX(-Math.PI / 2);
  const dp = deck.attributes.position; for (let i = 0; i < dp.count; i++) dp.setY(i, deckY(dp.getX(i)) + 0.004); deck.computeVertexNormals();
  const uvs = deck.attributes.uv; for (let i = 0; i < uvs.count; i++) uvs.setX(i, uvs.getX(i) * (L * 2) / 2.6);
  const tex = pathTex.clone(); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.needsUpdate = true;
  const deckMesh = new THREE.Mesh(deck, new THREE.MeshToonMaterial({ map: tex, gradientMap, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  deckMesh.matrixAutoUpdate = false; deckMesh.matrix.copy(F()); deckMesh.name = 'v:bridgeDeck'; deckMesh.receiveShadow = true; group.add(deckMesh);
  // arched parapets with coping, end posts with flower pots
  const PL = L - 0.28; const topY = (x) => 0.5 + 0.2 * Math.cos(x / PL * Math.PI / 2);
  const ps = new THREE.Shape(); ps.moveTo(-PL, -0.02); ps.lineTo(PL, -0.02); for (let i = 0; i <= 16; i++) { const x = PL - i / 16 * 2 * PL; ps.lineTo(x, topY(x)); } ps.closePath();
  const pg = new THREE.ExtrudeGeometry(ps, { depth: 0.24, bevelEnabled: false, curveSegments: 4 }); pg.translate(0, 0, -0.12);
  for (const zs of [-1, 1]) {
    const z = zs * (D - 0.13);
    B.add(pg, 'bridgeTex', F(0, 0.0, z), 0.04);
    const cp = []; for (let i = 0; i <= 16; i++) { const x = -PL + i / 16 * 2 * PL; cp.push(new THREE.Vector3(x, topY(x) + 0.03, z)); }
    B.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cp), 24, 0.15, 7, false), 'coping', F(), 0.035);
    for (const xs of [-1, 1]) {
      B.add(box(0.46, 0.86, 0.46), 'coping', F(xs * (L - 0.1), 0.43, z), 0.04);
      B.add(cyl(0.17, 0.13, 0.22, 10), 'terracotta', F(xs * (L - 0.1), 0.97, z), 0.03);
      B.add(sph(0.15, 8, 5), 'leaf', F(xs * (L - 0.1), 1.07, z, 0, 0, 0, 1, 0.6, 1), 0, false);
      for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; B.add(sph(0.075, 6, 4), k % 2 ? 'fmn' : 'pink', F(xs * (L - 0.1) + Math.cos(a) * 0.12, 1.13 + (k % 3) * 0.025, z + Math.sin(a) * 0.12), 0, false); }
    }
    // vines draped along the outer faces and down around the arch
    const pts = []; for (let i = 0; i <= 24; i++) { const x = -L + 0.3 + i / 24 * 2 * (L - 0.3); pts.push(new THREE.Vector3(x, 0.3 + Math.sin(i * 0.9) * 0.1 - (Math.abs(x) < AX + 0.3 ? 0.18 * Math.cos(x / (AX + 0.3) * Math.PI / 2) : 0), zs * (D + 0.05))); }
    B.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.035, 5, false), 'vine', F(), 0, false);
    for (const sx of [-1, 1]) { const dr = []; for (let i = 0; i <= 6; i++) dr.push(new THREE.Vector3(sx * (AX + 0.45 + Math.sin(i) * 0.08), 0.25 - i * 0.14, zs * (D + 0.06))); B.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(dr), 10, 0.03, 4, false), 'vine', F(), 0, false); for (let i = 1; i < 6; i += 2) B.add(sph(0.08, 6, 4), 'leaf', F(dr[i].x + 0.05, dr[i].y, dr[i].z + zs * 0.04, 0, 0, i, 1.3, 0.6, 0.5), 0, false); B.add(sph(0.07, 6, 4), sx > 0 ? 'pink' : 'fmn', F(dr[4].x - 0.06, dr[4].y, dr[4].z + zs * 0.06), 0, false); }
    for (let i = 0; i < 14; i++) { const p = pts[1 + Math.floor(i * 22 / 14)]; B.add(sph(0.09, 6, 4), 'leaf', F(p.x, p.y + 0.04, p.z + zs * 0.04, 0.3, 0, i, 1.3, 0.6, 0.5), 0, false); if (i % 2 === 0) B.add(sph(0.075, 6, 4), i % 4 === 0 ? 'fmn' : 'pink', F(p.x + 0.08, p.y - 0.05, p.z + zs * 0.07), 0, false); }
  }
  // abutment walls holding the river banks at the four corners
}

// ================================================================= buildings and props
function prismXZ(poly, yTop, yBot) { // convex prism from an (x,z) polygon, outward-facing triangles
  const n = poly.length; const cx = poly.reduce((s, p) => s + p[0], 0) / n, cz = poly.reduce((s, p) => s + p[1], 0) / n, cy = (yTop + yBot) / 2;
  const pos = []; const A = new THREE.Vector3(), Bv = new THREE.Vector3(), Cv = new THREE.Vector3(), N = new THREE.Vector3(), M = new THREE.Vector3(), O = new THREE.Vector3(cx, cy, cz);
  const tri = (a, b, c) => { A.set(...a); Bv.set(...b); Cv.set(...c); N.crossVectors(Bv.clone().sub(A), Cv.clone().sub(A)); M.copy(A).add(Bv).add(Cv).multiplyScalar(1 / 3).sub(O); if (N.dot(M) < 0) pos.push(...a, ...c, ...b); else pos.push(...a, ...b, ...c); };
  for (let i = 1; i < n - 1; i++) { tri([poly[0][0], yTop, poly[0][1]], [poly[i][0], yTop, poly[i][1]], [poly[i + 1][0], yTop, poly[i + 1][1]]); tri([poly[0][0], yBot, poly[0][1]], [poly[i][0], yBot, poly[i][1]], [poly[i + 1][0], yBot, poly[i + 1][1]]); }
  for (let i = 0; i < n; i++) { const p = poly[i], q = poly[(i + 1) % n]; tri([p[0], yTop, p[1]], [q[0], yTop, q[1]], [p[0], yBot, p[1]]); tri([q[0], yTop, q[1]], [q[0], yBot, q[1]], [p[0], yBot, p[1]]); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
}

// ---------------------------------------------------------------- the castle on its hill, the gem pedestal and the gate stair
function buildCastle(B, group, gradientMap) {
  const S = 1.3; const F = frameAt(P.castle.x, P.castle.y - 0.02, P.castle.z, P.castle.yaw, S);
  const tower = (x, z, r, h, coneR, coneH, roof = 'roofBlue', flag = 'pink') => {
    B.add(cyl(r + 0.12, r + 0.16, 0.5, 22), 'stoneWarm', F(x, -0.02, z), 0.04);
    B.add(cyl(r, r, h, 22), 'white', F(x, h / 2, z), 0.05);
    B.add(cyl(r + 0.1, r, 0.24, 22), 'coping', F(x, h - 0.08, z), 0.04);
    B.add(cone(coneR, coneH, 22), roof, F(x, h + coneH / 2 + 0.02, z), 0.05);
    B.add(sph(0.09, 8, 6), 'gold', F(x, h + coneH + 0.06, z), 0.02);
    B.add(cyl(0.025, 0.025, 0.55, 5), 'iron', F(x, h + coneH + 0.3, z), 0, false);
    B.add(box(0.42, 0.24, 0.025), flag, F(x + 0.22, h + coneH + 0.46, z, 0, 0, -0.05), 0.02);
  };
  B.add(box(6.4, 0.7, 4.5), 'stoneWarm', F(0, -0.25, -0.2), 0.045);                       // base course on the hilltop
  B.add(box(3.7, 2.5, 2.3), 'white', F(0, 1.25, -0.6), 0.05);                              // keep
  for (let i = 0; i < 5; i++) B.add(box(0.38, 0.3, 0.32), 'white', F(-1.5 + i * 0.75, 2.62, 0.4), 0.03);
  B.add(box(4.3, 1.75, 0.62), 'white', F(0, 0.87, 1.55), 0.05);                           // front wall
  for (let i = 0; i < 7; i++) B.add(box(0.36, 0.3, 0.64), 'white', F(-1.8 + i * 0.6, 1.88, 1.55), 0.03);
  B.add(archGeo(1.32, 1.5, 0.1), 'coping', F(0, 0, 1.88), 0.03);                         // gate
  B.add(archGeo(1.04, 1.3, 0.1), 'wood', F(0, 0, 1.92), 0.03);
  B.add(box(0.04, 1.1, 0.02), 'woodMid', F(0, 0.55, 1.98), 0, false);
  for (const sx of [-1, 1]) B.add(sph(0.05, 6, 4), 'gold', F(sx * 0.14, 0.62, 1.99), 0, false);
  B.add(box(1.7, 0.36, 0.45), 'coping', F(0, -0.12, 2.12), 0.03);                           // gate apron
  for (const [sx, c] of [[-1, 'pink'], [1, 'fmn']]) {
    const s = new THREE.Shape(); s.moveTo(-0.22, 0); s.lineTo(0.22, 0); s.lineTo(0.22, -0.8); s.lineTo(0, -0.62); s.lineTo(-0.22, -0.8); s.closePath();
    B.add(new THREE.ShapeGeometry(s), c, F(sx * 1.35, 1.6, 1.875), 0, false);
    B.add(new THREE.ShapeGeometry(heartShape(0.24)), 'white2', F(sx * 1.35, 1.27, 1.88), 0, false);
  }
  tower(-2.3, 1.5, 0.78, 2.75, 0.98, 1.45, 'roofBlue', 'pink');
  tower(2.3, 1.5, 0.78, 2.75, 0.98, 1.45, 'roofBlue', 'fmn');
  tower(-2.55, -1.55, 0.8, 3.25, 1.0, 1.5, 'roofBlue', 'fmn');
  tower(2.55, -1.55, 0.8, 3.25, 1.0, 1.5, 'roofBlue', 'pink');
  tower(0, -0.75, 1.0, 3.55, 1.26, 1.8, 'roofBlue', 'gold');
  tower(1.45, 0.3, 0.38, 3.0, 0.5, 0.75, 'roofBlue', 'pink');
  for (const [x, y, z] of [[-2.3, 1.5, 2.29], [2.3, 1.5, 2.29], [0, 2.45, 0.26], [-1.05, 1.55, 0.56], [1.05, 1.55, 0.56], [-2.55, 2.1, -0.74], [2.55, 2.1, -0.74]]) windowAt(B, F, x, y, z, { w: 0.3, h: 0.46, lit: y > 2.3 });
  for (const sx of [-1, 1]) { B.add(box(0.12, 0.5, 0.12), 'iron', F(sx * 0.95, 1.05, 1.95), 0.02); B.add(box(0.2, 0.26, 0.2), 'glowWarm', F(sx * 0.95, 1.4, 1.95), 0, false); B.add(cone(0.17, 0.16, 4), 'iron', F(sx * 0.95, 1.6, 1.95, 0, Math.PI / 4, 0), 0.015); }
}
function buildPedestal(B, group, gradientMap, extraFlowers) {
  const p = P.pedestal; const F = frameAt(p.x, p.y, p.z, P.castle.yaw);
  B.add(cyl(1.75, 1.85, 0.34, 44), 'coping', F(0, -0.15, 0), 0.04);
  B.add(new THREE.TorusGeometry(1.76, 0.07, 6, 44), 'stoneWarm', F(0, 0.02, 0, Math.PI / 2, 0, 0), 0);
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; B.add(box(0.5, 0.02, 0.05), 'stoneWarm', F(Math.cos(a) * 1.15, 0.025, Math.sin(a) * 1.15, 0, -a, 0), 0, false); }
  B.add(cyl(0.64, 0.72, 0.22, 8), 'white', F(0, 0.13, 0), 0.04);
  B.add(cyl(0.4, 0.46, 0.62, 16), 'white', F(0, 0.55, 0), 0.04);
  B.add(cyl(0.6, 0.44, 0.16, 18), 'white', F(0, 0.93, 0), 0.035);
  B.add(new THREE.TorusGeometry(0.52, 0.06, 6, 24), 'gold', F(0, 1.01, 0, Math.PI / 2, 0, 0), 0);
  const heart = new THREE.ExtrudeGeometry(heartShape(0.34), { depth: 0.05, bevelEnabled: false, curveSegments: 8 });
  B.add(heart, 'pink', F(0, 0.58, 0.43), 0.02);
  for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; B.add(sph(0.075, 6, 4), i % 2 ? 'fmn' : 'pink', F(Math.cos(a) * 0.5, 1.05, Math.sin(a) * 0.5), 0, false); }
  for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + 0.3; B.add(sph(0.09, 6, 4), 'leaf', F(Math.cos(a) * 0.6, 0.97, Math.sin(a) * 0.6, 0, -a, 0, 1.4, 0.5, 0.7), 0, false); }
  // forget-me-nots and pink blooms around the plaza rim
  rnd = mulberry32(919);
  for (let i = 0; i < 70; i++) { const a = rand(0, TAU); if (Math.abs(Math.sin(a) - 1) < 0.08) continue; const r = rand(1.9, 2.35); const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r; if (routeNear(x, z).dist < PATH_HW + 0.5) continue; if (Math.abs(x - P.stair.x) < P.stair.w / 2 + 0.2 && z > p.z) continue; extraFlowers.push({ x, z, y: groundAt(x, z) + rand(0.08, 0.18), s: rand(0.1, 0.15), c: i % 3 ? pick(PAL.blue) : pick(PAL.pink) }); }
  // the stair down to the Start tile: trapezoid steps that land exactly on the path edge
  const S = P.stair; const edgeZ = (x) => { let z = S.z0; for (let k = 0; k < 120; k++) { if (routeNear(x, z).dist <= PATH_HW + 0.02) break; z += 0.03; } return z; };
  const xl = S.x - S.w / 2, xr = S.x + S.w / 2; const zl = edgeZ(xl), zr = edgeZ(xr); const n = S.n; const rise = (S.top - S.bot) / n;
  for (let k = 1; k < n; k++) {
    const a = (k - 1) / (n - 1), b = k / (n - 1); const yTop = S.top - k * rise;
    const poly = [[xl, lerp(S.z0, zl, a)], [xr, lerp(S.z0, zr, a)], [xr, lerp(S.z0, zr, b)], [xl, lerp(S.z0, zl, b)]];
    B.add(prismXZ(poly, yTop, S.bot - 0.45), k % 2 ? 'coping' : 'coping2', mat4(), 0.03);
  }
  for (const sx of [-1, 1]) { const x = sx > 0 ? xr + 0.14 : xl - 0.14; const ze = sx > 0 ? zr : zl;
    for (let k = 0; k < n; k++) { const a = Math.max(0, (k - 1) / (n - 1)), b = k / (n - 1); const z0 = k === 0 ? S.z0 - 0.35 : lerp(S.z0, ze, a); const z1 = k === 0 ? S.z0 : lerp(S.z0, ze, b) - (k === n - 1 ? 0.02 : 0);
      const top = (k === 0 ? S.top : S.top - k * rise) + 0.26; B.add(prismXZ([[x - 0.14, z0], [x + 0.14, z0], [x + 0.14, z1], [x - 0.14, z1]], top, S.bot - 0.45), 'stoneWarm', mat4(), 0.025); }
    B.add(cyl(0.16, 0.13, 0.2, 10), 'terracotta', mat4(x, S.top + 0.36, S.z0 - 0.18), 0.025); for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; B.add(sph(0.07, 6, 4), k % 2 ? 'fmn' : 'pink', mat4(x + Math.cos(a) * 0.1, S.top + 0.5, S.z0 - 0.18 + Math.sin(a) * 0.1), 0, false); } }
}

// ---------------------------------------------------------------- Sunbeam Bakery
function buildBakery(B, group, gradientMap, chimneys) {
  const F = frameAt(P.bakery.x, P.bakery.y, P.bakery.z, P.bakery.yaw, 1.08);
  const W = 4.0, D = 3.0;
  B.add(box(W + 0.3, 0.7, D + 0.3), 'stone', F(0, -0.2, 0), 0.045);
  B.add(box(W, 2.0, D), 'plaster', F(0, 1.15, 0), 0.05);
  B.add(box(W - 0.1, 1.85, 0.14), 'woodLight', F(0, 1.07, D / 2 + 0.05), 0.035);
  for (const sx of [-1, 1]) B.add(box(0.2, 2.05, 0.22), 'wood', F(sx * (W / 2 - 0.02), 1.17, D / 2 + 0.07), 0.03);
  for (const sx of [-1, 1]) {
    B.add(box(1.2, 1.0, 0.06), 'white2', F(sx * 1.2, 1.3, D / 2 + 0.14), 0.025);
    B.add(box(1.04, 0.86, 0.05), 'glassWarm', F(sx * 1.2, 1.3, D / 2 + 0.17), 0, false);
    B.add(box(0.06, 0.86, 0.04), 'white2', F(sx * 1.2, 1.3, D / 2 + 0.2), 0, false);
    B.add(box(1.32, 0.08, 0.32), 'wood', F(sx * 1.2, 0.76, D / 2 + 0.28), 0.025);
    for (let i = 0; i < 3; i++) B.add(sph(0.13, 10, 6), 'loaf', F(sx * 1.2 - 0.36 + i * 0.36, 0.86, D / 2 + 0.3, 0, 0.3, 0, 1.25, 0.65, 0.8), 0.02);
    B.add(cyl(0.09, 0.07, 0.12, 10), 'cakePink', F(sx * 1.2 + 0.18, 1.0, D / 2 + 0.2), 0, false);
  }
  B.add(archGeo(0.98, 1.62, 0.1), 'coping', F(0, 0.15, D / 2 + 0.13), 0.03);
  B.add(archGeo(0.8, 1.48, 0.1), 'wood', F(0, 0.15, D / 2 + 0.17), 0.03);
  B.add(cyl(0.17, 0.17, 0.04, 16), 'glassWarm', F(0, 1.18, D / 2 + 0.23, Math.PI / 2, 0, 0), 0, false);
  B.add(sph(0.045, 6, 4), 'gold', F(0.27, 0.82, D / 2 + 0.24), 0, false);
  const n = 9, sw = (W + 0.2) / n, a = Math.atan2(0.38, 0.95), len = Math.hypot(0.38, 0.95);
  for (let i = 0; i < n; i++) {
    const x = -W / 2 - 0.1 + sw * (i + 0.5); const m = i % 2 ? 'white2' : 'pink';
    B.add(box(sw, 0.05, len), m, F(x, 2.05 - 0.19, D / 2 + 0.16 + 0.475, a, 0, 0), 0);
    const sc = new THREE.Shape(); sc.moveTo(-sw / 2, 0); sc.lineTo(sw / 2, 0); sc.lineTo(sw / 2, -0.1); sc.absarc(0, -0.1, sw / 2, 0, Math.PI, true); sc.closePath();
    B.add(new THREE.ExtrudeGeometry(sc, { depth: 0.04, bevelEnabled: false, curveSegments: 6 }), m, F(x, 1.69, D / 2 + 1.1), 0.02);
  }
  B.add(box(W + 0.24, 0.06, 0.06), 'pink', F(0, 2.07, D / 2 + 0.16), 0.02);
  B.add(box(W - 0.2, 1.35, D - 0.2), 'peach', F(0, 2.83, 0), 0.05);
  B.add(box(W - 0.1, 0.12, D - 0.1), 'wood', F(0, 2.18, 0), 0.03);
  for (const x of [-1.85, -0.62, 0.62, 1.85]) B.add(box(0.12, 1.35, 0.06), 'wood', F(x, 2.83, (D - 0.2) / 2 + 0.03), 0, false);
  for (const sx of [-1, 1]) {
    B.add(new THREE.TorusGeometry(0.3, 0.06, 6, 18), 'white2', F(sx * 1.24, 2.95, (D - 0.2) / 2 + 0.06), 0.02);
    B.add(cyl(0.29, 0.29, 0.04, 18), 'glassWarm', F(sx * 1.24, 2.95, (D - 0.2) / 2 + 0.04, Math.PI / 2, 0, 0), 0, false);
    flowerBox(B, F, sx * 1.24, 2.52, (D - 0.2) / 2 + 0.14, 0.7);
  }
  texturedPlane(group, plaqueTexture('Sunbeam Bakery', { fg: '#C4703A', size: 58 }), 1.15, 0.29, F(0, 2.98, (D - 0.2) / 2 + 0.05), gradientMap);
  B.add(box(1.25, 0.37, 0.05), 'woodLight', F(0, 2.98, (D - 0.2) / 2 + 0.02), 0.025);
  gableRoof(B, F, { cy: 3.5, span: D - 0.2, len: W - 0.2, rise: 1.25, over: 0.3, mat: 'roofRose', ridge: 'cream' });
  B.add(prismX(D - 0.22, 1.24, W - 0.22), 'peach', F(0, 3.5, 0), 0);
  B.add(box(0.5, 1.2, 0.5), 'brick', F(1.1, 4.4, -0.55), 0.04); B.add(box(0.62, 0.14, 0.62), 'cream', F(1.1, 5.02, -0.55), 0.03);
  chimneys.push(new THREE.Vector3().setFromMatrixPosition(F(1.1, 5.15, -0.55)));
  // bread sign on a bracket
  B.add(box(0.06, 0.06, 0.95), 'iron', F(-W / 2 - 0.02, 2.55, D / 2 - 0.35, 0, Math.PI / 2, 0), 0.02);
  B.add(box(0.95, 0.06, 0.06), 'iron', F(-W / 2 - 0.47, 2.55, D / 2 - 0.1), 0.02);
  B.add(box(0.86, 0.56, 0.07), 'woodLight', F(-W / 2 - 0.55, 2.12, D / 2 - 0.1), 0.03);
  B.add(sph(0.3, 12, 8), 'loaf', F(-W / 2 - 0.55, 2.12, D / 2 - 0.02, 0, 0, 0.1, 1.15, 0.55, 0.45), 0.025);
  for (let i = -1; i <= 1; i++) B.add(box(0.05, 0.2, 0.04), 'cream', F(-W / 2 - 0.55 + i * 0.17, 2.14, D / 2 + 0.11, 0, 0, 0.5), 0, false);
  for (const sx of [-1, 1]) B.add(cyl(0.012, 0.012, 0.18, 4), 'iron', F(-W / 2 - 0.55 + sx * 0.32, 2.45, D / 2 - 0.1), 0, false);
  chalkboard(B, group, F, 1.65, D / 2 + 1.2, 0.25, [['Fresh Buns,', '#FFE07A', 32], ['Brighter', '#FFFFFF', 34], ['Days!', '#F9B6D6', 38]], gradientMap);
  // a bench with a bread basket
  B.add(box(1.2, 0.08, 0.36), 'woodLight', F(-1.35, 0.42, D / 2 + 0.75), 0.02); for (const sx of [-1, 1]) B.add(box(0.08, 0.4, 0.3), 'wood', F(-1.35 + sx * 0.5, 0.2, D / 2 + 0.75), 0.015);
  B.add(cyl(0.22, 0.17, 0.16, 12), 'woodMid', F(-1.05, 0.54, D / 2 + 0.75), 0.02); for (let i = 0; i < 3; i++) B.add(sph(0.09, 8, 5), 'loaf', F(-1.12 + i * 0.07, 0.63, D / 2 + 0.72 + (i % 2) * 0.06, 0, i, 0, 1.3, 0.7, 0.8), 0, false);
}

// ---------------------------------------------------------------- Puddle Paws Pet Wash
function buildPetWash(B, group, gradientMap, emitters) {
  const F = frameAt(P.petwash.x, P.petwash.y, P.petwash.z, P.petwash.yaw);
  const W = 4.4, D = 3.2, H = 2.45, R = W / 2 + 0.25;
  B.add(box(W + 0.3, 0.7, D + 0.3), 'stone', F(0, -0.2, 0), 0.045);
  B.add(box(W, H - 0.15, D), 'paleBlue', F(0, 0.15 + (H - 0.15) / 2, 0), 0.05);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(box(0.16, H - 0.1, 0.16), 'white2', F(sx * W / 2, H / 2 + 0.05, sz * D / 2), 0.025);
  B.add(box(W + 0.12, 0.14, D + 0.12), 'white2', F(0, H, 0), 0.03);
  const barrel = new THREE.CylinderGeometry(R, R, D + 0.5, 22, 1, true, Math.PI / 2, Math.PI); barrel.rotateX(Math.PI / 2);
  B.add(barrel, 'roofWash', F(0, H + 0.04, 0, 0, 0, 0, 1, 0.62, 1), 0.05);
  for (const sz of [-1, 1]) { const cap = new THREE.CircleGeometry(R - 0.02, 20, 0, Math.PI); if (sz < 0) cap.rotateY(Math.PI); B.add(cap, 'paleBlue', F(0, H + 0.04, sz * (D / 2 + 0.02), 0, 0, 0, 1, 0.62, 1), 0, false); }
  for (let i = 0; i < 9; i++) { const a = Math.PI * (i + 0.5) / 9; B.add(sph(0.11, 8, 5), 'white2', F(Math.cos(a) * R, H + 0.04 + Math.sin(a) * R * 0.62, D / 2 + 0.26), 0.02); }
  B.add(cyl(0.68, 0.68, 0.1, 28), 'white2', F(0, H + 0.62, D / 2 + 0.1, Math.PI / 2, 0, 0), 0.04);
  B.add(new THREE.TorusGeometry(0.68, 0.06, 6, 28), 'fmn', F(0, H + 0.62, D / 2 + 0.15), 0.0);
  B.add(sph(0.26, 14, 8), 'fmn', F(0, H + 0.48, D / 2 + 0.17, 0, 0, 0, 1.15, 0.92, 0.3), 0.02);
  for (const [x, y] of [[-0.3, 0.72], [-0.11, 0.9], [0.11, 0.9], [0.3, 0.72]]) B.add(sph(0.1, 10, 6), 'fmn', F(x, H + y, D / 2 + 0.17, 0, 0, 0, 1, 1.2, 0.35), 0.02);
  // blue striped awning over the window
  for (let i = 0; i < 6; i++) { const sw = 1.7 / 6; const x = -1.1 - 0.85 + sw * (i + 0.5); B.add(box(sw, 0.04, 0.62), i % 2 ? 'white2' : 'fmn', F(x, 2.0, D / 2 + 0.3, 0.42, 0, 0), 0); }
  B.add(box(1.8, 0.05, 0.05), 'fmn', F(-1.1, 2.12, D / 2 + 0.04), 0.02);
  B.add(box(1.5, 1.1, 0.06), 'white2', F(-1.1, 1.3, D / 2 + 0.03), 0.025);
  B.add(box(1.34, 0.94, 0.05), 'glass', F(-1.1, 1.3, D / 2 + 0.06), 0, false);
  B.add(box(0.06, 0.94, 0.04), 'white2', F(-1.1, 1.3, D / 2 + 0.09), 0, false);
  flowerBox(B, F, -1.1, 0.68, D / 2 + 0.15, 1.3, ['fmn', 'white2', 'pink']);
  B.add(archGeo(1.0, 1.7, 0.1), 'white2', F(0.95, 0.15, D / 2 + 0.03), 0.03);
  B.add(archGeo(0.82, 1.56, 0.1), 'teal', F(0.95, 0.15, D / 2 + 0.07), 0.03);
  B.add(new THREE.TorusGeometry(0.22, 0.05, 6, 18), 'white2', F(0.95, 1.2, D / 2 + 0.14), 0, false);
  B.add(cyl(0.2, 0.2, 0.03, 16), 'glass', F(0.95, 1.2, D / 2 + 0.12, Math.PI / 2, 0, 0), 0, false);
  texturedPlane(group, plaqueTexture('Puddle Paws', { fg: '#3E6FD6', size: 62 }), 1.6, 0.4, F(0, H - 0.3, D / 2 + 0.1), gradientMap);
  B.add(box(1.72, 0.5, 0.05), 'fmn', F(0, H - 0.3, D / 2 + 0.06), 0.025);
  // little wash tub with foam and a duck by the door
  const tub = [2.2, 0, D / 2 + 1.0];
  B.add(cyl(0.5, 0.42, 0.48, 18), 'woodMid', F(tub[0], 0.24, tub[2]), 0.04);
  for (const y of [0.1, 0.36]) B.add(new THREE.TorusGeometry(0.5 - y * 0.12 + 0.03, 0.028, 5, 20), 'iron', F(tub[0], y, tub[2], Math.PI / 2, 0, 0), 0);
  for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; B.add(sph(0.15 + (i % 3) * 0.04, 8, 6), 'white2', F(tub[0] + Math.cos(a) * 0.3, 0.5 + (i % 2) * 0.05, tub[2] + Math.sin(a) * 0.3), 0.02); }
  B.add(sph(0.2, 8, 6), 'white2', F(tub[0], 0.58, tub[2]), 0.02);
  B.add(sph(0.11, 10, 6), 'duck', F(tub[0] + 0.1, 0.78, tub[2] + 0.05, 0, 0, 0, 1.2, 0.9, 1), 0.02);
  B.add(sph(0.07, 8, 6), 'duck', F(tub[0] + 0.19, 0.9, tub[2] + 0.08), 0.02);
  B.add(cone(0.035, 0.08, 6), 'orange', F(tub[0] + 0.27, 0.89, tub[2] + 0.1, 0, 0, -Math.PI / 2), 0, false);
  emitters.push(new THREE.Vector3().setFromMatrixPosition(F(tub[0], 0.7, tub[2])), new THREE.Vector3().setFromMatrixPosition(F(0.95, 1.4, D / 2 + 0.3)), new THREE.Vector3().setFromMatrixPosition(F(-0.6, H + 1.2, 0.4)));
  chalkboard(B, group, F, -1.95, D / 2 + 0.85, 0.45, [['Clean Pets,', '#BFE3F5', 32], ['Happier', '#FFFFFF', 34], ['Hearts', '#F9B6D6', 38]], gradientMap);
}

// ---------------------------------------------------------------- cottages
function buildCottage(B, c, chimneys) {
  const F = frameAt(c.x, c.y, c.z, c.yaw); const W = c.w || 2.6, D = c.d || 2.2, H = c.h || 1.8;
  B.add(box(W + 0.2, 0.9, D + 0.2), 'stone', F(0, -0.3, 0), 0.04);
  B.add(box(W, H, D), c.wall, F(0, 0.15 + H / 2, 0), 0.05);
  B.add(archGeo(0.62, 1.15, 0.08), 'wood', F(0, 0.15, D / 2 + 0.03), 0.03);
  B.add(sph(0.04, 6, 4), 'gold', F(0.18, 0.7, D / 2 + 0.08), 0, false);
  for (const sx of [-1, 1]) windowAt(B, F, sx * 0.82, 0.85, D / 2 + 0.02, { w: 0.48, h: 0.5, lit: sx > 0, arch: false });
  flowerBox(B, F, -0.82, 0.78, D / 2 + 0.13, 0.62, c.wall === 'cream' ? ['fmn', 'pink'] : ['pink', 'white2', 'fmn']);
  windowAt(B, F, W / 2 + 0.02, 0.85, 0, { w: 0.42, h: 0.46, ry: Math.PI / 2, arch: false });
  gableRoof(B, F, { cy: 0.15 + H, span: D, len: W, rise: 1.05, over: 0.24, mat: c.roof, ridge: 'cream' });
  B.add(prismX(D - 0.02, 1.04, W - 0.02), c.wall, F(0, 0.15 + H, 0), 0);
  B.add(cyl(0.2, 0.2, 0.06, 14), 'glass', F(W / 2 - 0.0, 0.15 + H + 0.42, 0, 0, 0, Math.PI / 2), 0, false);
  B.add(new THREE.TorusGeometry(0.2, 0.04, 5, 14), 'white2', F(W / 2 + 0.02, 0.15 + H + 0.42, 0, 0, Math.PI / 2, 0), 0, false);
  B.add(box(0.9, 0.08, 0.5), 'coping', F(0, 0.0, D / 2 + 0.35), 0.02);
  if (c.chimney) { B.add(box(0.38, 1.0, 0.38), 'brick', F(-0.7, 0.15 + H + 0.75, -0.45), 0.035); B.add(box(0.48, 0.1, 0.48), 'cream', F(-0.7, 0.15 + H + 1.28, -0.45), 0.025); chimneys.push(new THREE.Vector3().setFromMatrixPosition(F(-0.7, 0.15 + H + 1.4, -0.45))); }
}

// ---------------------------------------------------------------- the village square: a two-tier fountain on a cobbled plaza
function buildFountain(B, group, gradientMap, stillMat, pathTex, emitters) {
  const { x: fx, y: fy, z: fz } = P.fountain; const F = frameAt(fx, fy, fz, 0);
  const plaza = new THREE.CircleGeometry(3.7, 56); plaza.rotateX(-Math.PI / 2); const uv = plaza.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.8, uv.getY(i) * 2.8);
  const tex = pathTex.clone(); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.needsUpdate = true;
  const pm = new THREE.Mesh(plaza, new THREE.MeshToonMaterial({ map: tex, gradientMap, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })); pm.position.set(fx, fy + 0.035, fz); pm.receiveShadow = true; pm.name = 'v:squarePaving'; group.add(pm);
  B.add(new THREE.TorusGeometry(3.72, 0.1, 6, 64), 'stoneWarm', F(0, 0.03, 0, Math.PI / 2, 0, 0), 0);
  const prof = [[2.12, -0.1], [2.18, 0.4], [2.08, 0.5], [1.92, 0.48], [1.84, 0.4], [1.84, 0.2]].map(([r, y]) => new THREE.Vector2(r, y));
  B.add(new THREE.LatheGeometry(prof, 56), 'coping', F(), 0.04);
  B.add(cyl(1.9, 1.9, 0.1, 48), 'stone', F(0, 0.05, 0), 0);
  const water = new THREE.Mesh(discWaterGeo(1.88, 0.33, 48), stillMat); water.name = 'v:fountainWater'; water.position.set(fx, fy, fz); water.receiveShadow = true; group.add(water);
  B.add(cyl(0.5, 0.62, 0.3, 20), 'white', F(0, 0.42, 0), 0.03);
  B.add(cyl(0.16, 0.22, 0.95, 14), 'white', F(0, 1.0, 0), 0.03);
  const bowl = [[0.05, 0], [0.62, 0.08], [0.9, 0.22], [0.94, 0.32], [0.84, 0.32], [0.6, 0.2], [0.05, 0.16]].map(([r, y]) => new THREE.Vector2(r, y));
  B.add(new THREE.LatheGeometry(bowl, 32), 'white', F(0, 1.42, 0), 0.03);
  const w2 = new THREE.Mesh(discWaterGeo(0.82, 1.42 + 0.27, 28), stillMat); w2.name = 'v:fountainWater'; w2.position.set(fx, fy, fz); group.add(w2);
  B.add(cyl(0.09, 0.12, 0.4, 10), 'white', F(0, 1.85, 0), 0.02);
  for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; B.add(sph(1, 12, 8), i % 2 ? 'fmn' : 'pink', F(Math.cos(a) * 0.16, 2.08, Math.sin(a) * 0.16, 0, -a, -0.5, 0.2, 0.05, 0.11), 0.015); }
  B.add(sph(0.07, 10, 6), 'gold', F(0, 2.1, 0), 0.015);
  // little falls from the upper bowl
  for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + 0.4; const c = Math.cos(a), s = Math.sin(a); const g = fallRibbon([new THREE.Vector3(c * 0.9, 1.7, s * 0.9), new THREE.Vector3(c * 1.02, 1.62, s * 1.02), new THREE.Vector3(c * 1.12, 1.0, s * 1.12), new THREE.Vector3(c * 1.15, 0.36, s * 1.15)], 0.09, 0.13, new THREE.Vector3(-s, 0, c), 8); g.translate(fx, fy, fz); const m = new THREE.Mesh(g, group.userData.fallMat); m.name = 'v:fountainFall'; group.add(m); }
  emitters.push(new THREE.Vector3(fx, fy + 2.1, fz));
  // benches + planters on the far side of the square
  const rn = routeNear(fx, fz); const f = routeFrame(rn.d); const away = Math.atan2(fx - f.x, fz - f.z);
  for (const da of [-0.95, 0.95]) { const a = away + da; const bx = Math.sin(a) * 3.1, bz = Math.cos(a) * 3.1; const by = Math.atan2(-bx, -bz);
    const Fb = frameAt(fx + bx, fy, fz + bz, by); B.add(box(1.3, 0.08, 0.4), 'woodLight', Fb(0, 0.45, 0), 0.02); B.add(box(1.3, 0.34, 0.07), 'woodLight', Fb(0, 0.7, -0.2, -0.15, 0, 0), 0.02); for (const sx of [-1, 1]) B.add(box(0.07, 0.45, 0.36), 'iron', Fb(sx * 0.55, 0.22, 0), 0.015); }
  for (const da of [-1.75, 0, 1.75]) { const a = away + da; const px = fx + Math.sin(a) * 3.3, pz = fz + Math.cos(a) * 3.3; B.add(cyl(0.32, 0.26, 0.38, 12), 'terracotta', mat4(px, fy + 0.19, pz), 0.03); B.add(sph(0.3, 10, 7), 'leaf', mat4(px, fy + 0.45, pz, 0, 0, 0, 1, 0.7, 1), 0.025); for (let k = 0; k < 6; k++) { const b = k / 6 * TAU; B.add(sph(0.07, 6, 4), k % 2 ? 'pink' : 'fmn', mat4(px + Math.cos(b) * 0.2, fy + 0.62, pz + Math.sin(b) * 0.2), 0, false); } }
}

// ---------------------------------------------------------------- teatime cake table
function buildCakeTable(B, flames) {
  const F = frameAt(P.cake.x, P.cake.y, P.cake.z, 0.3);
  B.add(cyl(1.0, 1.08, 0.72, 28), 'white2', F(0, 0.36, 0), 0.04);
  B.add(new THREE.TorusGeometry(1.06, 0.06, 6, 32), 'pink', F(0, 0.08, 0, Math.PI / 2, 0, 0), 0);
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; B.add(sph(0.1, 6, 4), 'pink', F(Math.cos(a) * 1.0, 0.66, Math.sin(a) * 1.0, 0, 0, 0, 1, 0.7, 1), 0, false); }
  B.add(cyl(1.02, 1.02, 0.07, 28), 'pinkLight', F(0, 0.75, 0), 0.03);
  B.add(cyl(0.58, 0.6, 0.04, 22), 'white2', F(0, 0.8, 0), 0.02);
  const tiers = [[0.5, 0.36, 'cakePink'], [0.38, 0.3, 'cakeCream'], [0.26, 0.26, 'pink']]; let y = 0.82;
  for (const [r, h, m] of tiers) { B.add(cyl(r, r, h, 24), m, F(0, y + h / 2, 0), 0.03); B.add(new THREE.TorusGeometry(r, 0.045, 5, 24), 'white2', F(0, y + h, 0, Math.PI / 2, 0, 0), 0); y += h; }
  B.add(sph(0.09, 10, 6), 'red', F(0, y + 0.08, 0), 0.02);
  for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + 0.5; const cx = Math.cos(a) * 0.15, cz = Math.sin(a) * 0.15; B.add(cyl(0.025, 0.025, 0.22, 6), i === 1 ? 'fmn' : 'gold', F(cx, y + 0.11, cz), 0, false); B.add(sph(0.04, 6, 4), 'flame', F(cx, y + 0.27, cz, 0, 0, 0, 1, 1.6, 1), 0, false); flames.push(new THREE.Vector3().setFromMatrixPosition(F(cx, y + 0.3, cz))); }
  for (const [x, z, c] of [[0.68, 0.32, 'fmn'], [-0.62, 0.42, 'lavender']]) { B.add(cyl(0.16, 0.16, 0.02, 12), 'white2', F(x, 0.8, z), 0, false); B.add(cyl(0.09, 0.07, 0.11, 10), c, F(x, 0.86, z), 0.015); B.add(new THREE.TorusGeometry(0.045, 0.015, 4, 8), c, F(x + 0.1, 0.87, z), 0, false); }
  B.add(sph(0.2, 12, 8), 'periwinkle', F(-0.45, 0.95, -0.4, 0, 0, 0, 1, 0.85, 1), 0.025); B.add(cone(0.05, 0.22, 6), 'periwinkle', F(-0.25, 0.98, -0.4, 0, 0, -1.0), 0, false); B.add(sph(0.05, 6, 4), 'gold', F(-0.45, 1.13, -0.4), 0, false);
  for (const a of [0.4, 2.3, 4.2]) { const x = Math.cos(a) * 1.6, z = Math.sin(a) * 1.6; B.add(cyl(0.12, 0.15, 0.42, 10), 'cream', F(x, 0.21, z), 0.03); B.add(new THREE.SphereGeometry(0.36, 14, 8, 0, TAU, 0, Math.PI / 2), 'red', F(x, 0.4, z, 0, 0, 0, 1, 0.55, 1), 0.035); for (let k = 0; k < 4; k++) B.add(sph(0.05, 5, 4), 'white2', F(x + Math.cos(k * 1.7) * 0.2, 0.56, z + Math.sin(k * 1.7) * 0.2, 0, 0, 0, 1, 0.5, 1), 0, false); }
}

// ---------------------------------------------------------------- lampposts, heart banners (Fairy Flight pairs), bunting
function buildLamps(B, group, gradientMap, animators) {
  const lights = []; const banners = []; const tops = new Map();
  const bannerMat = new THREE.MeshToonMaterial({ vertexColors: true, side: THREE.DoubleSide, gradientMap });
  const camX = 0, camZ = 38;
  for (const L of P.lamps) {
    const y0 = groundAt(L.x, L.z); const yaw = Math.atan2(L.tx, L.tz) - Math.PI / 2; // local +X along the route
    const side = Math.sign(L.tx * (camX - L.x) + L.tz * (camZ - L.z)) || 1;
    const F = frameAt(L.x, y0, L.z, yaw);
    B.add(cyl(0.24, 0.3, 0.4, 12), 'iron', F(0, 0.1, 0), 0.03);
    B.add(cyl(0.07, 0.085, 2.7, 10), 'iron', F(0, 1.65, 0), 0.03);
    B.add(new THREE.TorusGeometry(0.1, 0.035, 5, 12), 'gold', F(0, 1.2, 0, Math.PI / 2, 0, 0), 0);
    B.add(box(0.38, 0.06, 0.38), 'iron', F(0, 3.0, 0), 0.025);
    B.add(box(0.3, 0.4, 0.3), 'glowWarm', F(0, 3.23, 0), 0, false);
    B.add(cone(0.3, 0.3, 4), 'iron', F(0, 3.58, 0, 0, Math.PI / 4, 0), 0.03);
    B.add(sph(0.06, 6, 4), 'gold', F(0, 3.77, 0), 0, false);
    B.add(box(0.95, 0.05, 0.05), 'iron', F(side * 0.47, 2.72, 0), 0.02);
    B.add(new THREE.TorusGeometry(0.13, 0.025, 4, 10, Math.PI), 'iron', F(side * 0.2, 2.5, 0, 0, 0, Math.PI), 0);
    const hang = new THREE.Vector3().setFromMatrixPosition(F(side * 0.82, 2.7, 0));
    tops.set(L.tile, new THREE.Vector3().setFromMatrixPosition(F(0, 2.92, 0)));
    if (L.banner) {
      if (lights.length < 4) { const pl = new THREE.PointLight(0xFFC46B, 2.0, 6.5, 2); pl.position.setFromMatrixPosition(F(0, 3.23, 0)); group.add(pl); lights.push(pl); }
      const color = new THREE.Color(L.banner === 'blue' ? 0x5B8DEF : 0xF29BC8);
      const pen = new THREE.Shape(); pen.moveTo(-0.34, 0); pen.lineTo(0.34, 0); pen.lineTo(0.34, -0.92); pen.lineTo(0, -0.7); pen.lineTo(-0.34, -0.92); pen.closePath();
      const parts = [];
      const paint = (geo, c, z) => { geo.translate(0, 0, z); const n = geo.attributes.position.count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo.index ? geo.toNonIndexed() : geo; };
      const inkPen = new THREE.ShapeGeometry(pen); inkPen.scale(1.12, 1.07, 1); inkPen.translate(0, 0.02, 0);
      parts.push(paint(inkPen, new THREE.Color(INK), -0.012), paint(new THREE.ShapeGeometry(pen), color, 0));
      const hInk = new THREE.ShapeGeometry(heartShape(0.5, 0, -0.38)); hInk.scale(1.12, 1.12, 1); hInk.translate(0, 0.045, 0);
      parts.push(paint(hInk, new THREE.Color(INK), 0.008), paint(new THREE.ShapeGeometry(heartShape(0.5, 0, -0.38)), new THREE.Color(0xFFFFFF), 0.014));
      parts.push(paint(new THREE.BoxGeometry(0.78, 0.06, 0.06), new THREE.Color(0xF2C14E), 0));
      const mesh = new THREE.Mesh(mergeGeometries(parts.map(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k); return g; }), false), bannerMat);
      mesh.scale.setScalar(1.4); const pivot = new THREE.Group(); pivot.position.copy(hang); pivot.rotation.y = Math.atan2(camX - L.x, camZ - L.z); pivot.add(mesh); mesh.castShadow = true; pivot.name = 'v:banner:' + L.tile; group.add(pivot);
      banners.push({ pivot, ph: L.tile * 0.7 });
    } else { // hanging flower basket
      const Fh = frameAt(hang.x, 0, hang.z, 0);
      B.add(new THREE.SphereGeometry(0.24, 10, 6, 0, TAU, Math.PI / 2, Math.PI / 2), 'woodLight', Fh(0, hang.y - 0.52, 0), 0.025);
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; B.add(sph(0.08, 6, 4), i % 2 ? 'pink' : 'fmn', Fh(Math.cos(a) * 0.16, hang.y - 0.46 + (i % 3) * 0.03, Math.sin(a) * 0.16), 0, false); }
      B.add(sph(0.1, 6, 4), 'leaf', Fh(0, hang.y - 0.43, 0), 0, false);
      B.add(cyl(0.01, 0.01, 0.4, 3), 'iron', Fh(0, hang.y - 0.3, 0), 0, false);
    }
  }
  // bunting between neighbouring lamps on the same side of the street
  const flags = []; const flagCols = [0xF29BC8, 0xFFF6E0, 0xF7B7D6, 0xB48BE0, 0xF29BC8, 0xFFFFFF, 0x7FA6F2].map(h => new THREE.Color(h));
  const sorted = [...P.lamps].sort((a, b) => a.tile - b.tile);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i], b = sorted[(i + 1) % sorted.length]; const dt = ((b.tile - a.tile) + NSP) % NSP; if (dt < 1 || dt > 3) continue;
    if (a.tile > NSP - 3 && b.tile < 3) continue; // keep the castle gate view clear
    const A = tops.get(a.tile), Bp = tops.get(b.tile); if (!A || !Bp || A.distanceTo(Bp) > 9.5) continue;
    const pts = []; for (let k = 0; k <= 20; k++) { const s = k / 20; pts.push(new THREE.Vector3().lerpVectors(A, Bp, s).add(new THREE.Vector3(0, -0.6 * 4 * s * (1 - s), 0))); }
    B.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, 0.014, 4, false), 'iron', mat4(), 0, false);
    const len = A.distanceTo(Bp); const n = Math.max(4, Math.floor(len / 0.42));
    for (let k = 1; k < n; k++) { const s = k / n; const p = new THREE.Vector3().lerpVectors(A, Bp, s).add(new THREE.Vector3(0, -0.6 * 4 * s * (1 - s), 0)); flags.push({ p, dir: new THREE.Vector3().subVectors(Bp, A).normalize(), ph: rand(0, TAU), c: flagCols[flags.length % flagCols.length] }); }
  }
  const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute([-0.15, 0, 0, 0.15, 0, 0, 0, -0.34, 0], 3)); fg.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  const flagMesh = new THREE.InstancedMesh(fg, new THREE.MeshToonMaterial({ side: THREE.DoubleSide, gradientMap }), Math.max(1, flags.length));
  flagMesh.count = flags.length; flags.forEach((f, i) => flagMesh.setColorAt(i, f.c)); flagMesh.frustumCulled = false; flagMesh.name = 'v:bunting'; group.add(flagMesh);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), X = new THREE.Vector3(1, 0, 0);
  animators.push((dt, t) => {
    for (let i = 0; i < flags.length; i++) { const f = flags[i]; q.setFromUnitVectors(X, f.dir); q2.setFromAxisAngle(X, Math.sin(t * 2.2 + f.ph) * 0.35); q.multiply(q2); m.compose(f.p, q, one); flagMesh.setMatrixAt(i, m); }
    flagMesh.instanceMatrix.needsUpdate = true;
    for (const b of banners) { b.pivot.children[0].rotation.x = Math.sin(t * 1.6 + b.ph) * 0.12; b.pivot.children[0].rotation.z = Math.sin(t * 1.1 + b.ph * 2) * 0.06; }
    for (let i = 0; i < lights.length; i++) lights[i].intensity = 2.0 + Math.sin(t * 7 + i * 2) * 0.12 + Math.sin(t * 13 + i) * 0.08;
  });
  return { lights };
}

// ---------------------------------------------------------------- Grabble's hideout: an upturned barrel, a purple blanket and shiny things
function buildHideout(B, group, gradientMap, shinies) {
  const H = P.hideout; const F = frameAt(H.x, H.y, H.z, H.yaw); // local +z faces the path
  const prof = []; for (let i = 0; i <= 8; i++) { const t = i / 8; prof.push(new THREE.Vector2(0.62 + 0.1 * Math.sin(t * Math.PI), t * 1.35)); }
  B.add(new THREE.LatheGeometry(prof, 20), 'woodMid', F(0, -0.04, 0), 0.045);
  B.add(cyl(0.61, 0.61, 0.07, 20), 'woodLight', F(0, 1.32, 0), 0.02);
  for (const y of [0.16, 0.66, 1.18]) B.add(new THREE.TorusGeometry(0.62 + 0.1 * Math.sin((y / 1.35) * Math.PI) + 0.01, 0.035, 5, 24), 'iron', F(0, y, 0, Math.PI / 2, 0, 0), 0);
  for (let i = 0; i < 10; i++) { const a = i / 10 * TAU + 0.15; if (Math.abs(Math.sin(a) - 1) < 0.5 && Math.cos(a) > -0.3 && Math.cos(a) < 0.3) continue; B.add(box(0.025, 1.2, 0.02), 'wood', F(Math.sin(a) * 0.71, 0.66, Math.cos(a) * 0.71, 0, a, 0), 0, false); }
  B.add(archGeo(0.5, 0.78, 0.06), 'windowDark', F(0, 0.0, 0.69), 0.02);
  B.add(box(0.56, 0.05, 0.12), 'woodLight', F(0, 0.0, 0.8), 0.015);
  // purple blanket draped over the top
  const cap = new THREE.SphereGeometry(0.86, 18, 8, 0, TAU, 0, Math.PI * 0.4); B.add(cap, 'purple', F(0, 1.05, 0, 0, 0.3, 0, 1, 0.55, 1), 0.035);
  for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + 0.6; B.add(cone(0.2, 0.55, 8), 'purple', F(Math.sin(a) * 0.68, 1.02, Math.cos(a) * 0.68, Math.PI, a, 0.25), 0.03); }
  for (let i = 0; i < 7; i++) { const a = i / 7 * TAU; B.add(sph(0.06, 6, 4), 'gold', F(Math.sin(a) * 0.55, 1.33, Math.cos(a) * 0.55), 0, false); }
  // shiny things: coins, gems, a spoon, a teacup
  rnd = mulberry32(77007);
  for (let i = 0; i < 9; i++) { const a = rand(-1.2, 1.2), r = rand(0.85, 1.3); B.add(cyl(0.1, 0.1, 0.03, 12), 'gold', F(Math.sin(a) * r, 0.03 + (i % 3) * 0.03, Math.cos(a) * r, rand(-0.2, 0.2), 0, rand(-0.2, 0.2)), 0.012); }
  for (let i = 0; i < 4; i++) B.add(cyl(0.1, 0.1, 0.03, 12), 'gold', F(-0.75, 0.03 + i * 0.035, 0.75), 0.012);
  const gems = [[0.55, 0.12, 0.95, 'fmn'], [-0.45, 0.12, 1.05, 'pink'], [0.95, 0.1, 0.55, 'lavender'], [0.15, 0.1, 1.2, 'fmn']];
  for (const [x, y, z, c] of gems) { B.add(new THREE.OctahedronGeometry(0.13, 0), c, F(x, y, z, 0.2, 0.5, 0, 1, 1.4, 1), 0.015); shinies.push(new THREE.Vector3().setFromMatrixPosition(F(x, y + 0.15, z))); }
  B.add(box(0.06, 0.02, 0.36), 'white2', F(-0.95, 0.03, 0.35, 0, 0.6, 0), 0.01); B.add(sph(0.07, 8, 4), 'white2', F(-1.05, 0.04, 0.5, 0, 0, 0, 1, 0.4, 1.3), 0.01);
  B.add(cyl(0.12, 0.08, 0.13, 12), 'pinkLight', F(1.05, 0.07, 0.15), 0.015); B.add(new THREE.TorusGeometry(0.05, 0.015, 4, 8), 'pinkLight', F(1.17, 0.08, 0.15), 0, false);
  // "MINE!" sign on a stake
  B.add(box(0.06, 0.9, 0.06), 'wood', F(-0.95, 0.45, -0.3, 0, 0, 0.08), 0.015);
  texturedPlane(group, plaqueTexture('MINE!', { w: 256, h: 128, bg: '#E9DDF7', fg: '#7B4FB5', size: 70 }), 0.62, 0.31, F(-0.97, 0.85, -0.255, 0, 0, 0.08), gradientMap);
  B.add(box(0.66, 0.35, 0.03), 'woodLight', F(-0.97, 0.85, -0.285, 0, 0, 0.08), 0.015);
}

// ---------------------------------------------------------------- the flower garden: picket fence and a rose arch at the garden gate
function buildGarden(B, group, gradientMap) {
  const LM = LY.LANDMARKS || {}; const gpos = LM.garden?.pos || SPACES[LY.GRABBLE_START ?? 0].pos;
  const near = routeNear(gpos[0], gpos[2]); const d0 = near.d - SPAN * 2.2, d1 = near.d + SPAN * 1.2;
  const pickets = []; const runs = [[]]; const gateD = d0 + SPAN * 0.9;
  for (let d = d0; d <= d1; d += 0.24) {
    const f = routeFrame(d); const off = 2.75; const x = f.x - f.nx * off, z = f.z - f.nz * off;
    const blocked = Math.hypot(P.hideout.x - x, P.hideout.z - z) < 1.9 || Math.abs(d - gateD) < 0.75 || P.lamps.some(L => Math.hypot(L.x - x, L.z - z) < 0.75) || !isFree(x, z, 0.05, 'low');
    if (blocked) { if (runs[runs.length - 1].length) runs.push([]); continue; }
    const y = groundAt(x, z); pickets.push(mat4(x, y + 0.3, z, 0, Math.atan2(f.nx, f.nz), 0)); runs[runs.length - 1].push([x, y, z]);
  }
  for (const run of runs) if (run.length > 1) for (const h of [0.2, 0.45]) B.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(run.map(([x, y, z]) => new THREE.Vector3(x, y + h, z))), run.length * 2, 0.028, 4, false), 'white2', mat4(), 0, false);
  const pg = box(0.09, 0.6, 0.045); const tip = cone(0.065, 0.12, 4); tip.rotateY(Math.PI / 4); tip.translate(0, 0.36, 0); const pick2 = mergeGeometries([pg.toNonIndexed(), tip.toNonIndexed()].map(g => { g.deleteAttribute('uv'); return g; }));
  const pm = new THREE.InstancedMesh(pick2, new THREE.MeshToonMaterial({ color: 0xFFFDF6, gradientMap }), Math.max(1, pickets.length)); pm.count = pickets.length; pickets.forEach((m, i) => pm.setMatrixAt(i, m)); pm.castShadow = true; pm.receiveShadow = true; pm.name = 'v:picketFence'; group.add(pm);
  // rose arch at the garden gate (beside the path, opening onto it)
  const f = routeFrame(gateD); const gx = f.x - f.nx * 2.95, gz = f.z - f.nz * 2.95; const gy = groundAt(gx, gz);
  const F = frameAt(gx, gy, gz, Math.atan2(f.tx, f.tz) + Math.PI / 2); // arch plane spans along the path
  for (const sx of [-1, 1]) B.add(box(0.12, 1.7, 0.12), 'white2', F(sx * 0.75, 0.85, 0), 0.025);
  B.add(new THREE.TorusGeometry(0.75, 0.06, 6, 20, Math.PI), 'white2', F(0, 1.7, 0), 0.025);
  rnd = mulberry32(31);
  for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI; const x = Math.cos(a) * 0.75, y = 1.7 + Math.sin(a) * 0.75; B.add(sph(0.12, 6, 4), 'leaf', F(x, y, rand(-0.06, 0.06), 0, 0, 0, 1.3, 0.9, 0.9), 0, false); if (i % 2 === 0) B.add(sph(0.085, 6, 4), i % 4 ? 'pink' : 'fmn', F(x * 1.05, y + 0.05, 0.1), 0, false); }
  for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) { B.add(sph(0.1, 6, 4), 'leaf', F(sx * 0.75 + rand(-0.05, 0.05), 0.35 + i * 0.3, 0.06, 0, 0, i, 1.2, 0.8, 0.8), 0, false); if (i % 2) B.add(sph(0.08, 6, 4), 'pink', F(sx * 0.8, 0.45 + i * 0.3, 0.12), 0, false); }
  BLOCKS.push({ x: gx, z: gz, r: 1.0 });
}

// ---------------------------------------------------------------- meadow props: picnic blanket, toadstools
function buildMeadowProps(B, group, gradientMap) {
  const px = 2.7, pz = -1.7; const F = frameAt(px, groundAt(px, pz), pz, 0.35);
  const tex = ginghamTexture(); tex.repeat.set(2, 1.5);
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.03, 1.4), new THREE.MeshToonMaterial({ map: tex, gradientMap })); blanket.name = 'v:picnic'; blanket.matrixAutoUpdate = false; blanket.matrix.copy(F(0, 0.03, 0)); blanket.receiveShadow = true; group.add(blanket);
  B.add(box(1.96, 0.02, 1.46), 'pink', F(0, 0.015, 0), 0, false);
  B.add(cyl(0.26, 0.22, 0.26, 12), 'woodLight', F(-0.45, 0.17, -0.2), 0.03);
  B.add(new THREE.TorusGeometry(0.2, 0.03, 5, 12, Math.PI), 'wood', F(-0.45, 0.3, -0.2), 0);
  B.add(box(0.5, 0.04, 0.5), 'pink', F(-0.45, 0.31, -0.2, 0, 0.5, 0), 0, false);
  for (const [x, z] of [[0.2, 0.25], [0.38, 0.1]]) B.add(sph(0.09, 8, 6), 'red', F(x, 0.12, z), 0.02);
  B.add(cyl(0.22, 0.22, 0.02, 14), 'white2', F(0.45, 0.06, -0.3), 0, false); B.add(cyl(0.08, 0.06, 0.1, 10), 'cakePink', F(0.45, 0.12, -0.3), 0.02); B.add(sph(0.08, 8, 5), 'cream', F(0.45, 0.19, -0.3, 0, 0, 0, 1, 0.7, 1), 0, false);
  BLOCKS.push({ x: px, z: pz, r: 1.3 });
  rnd = mulberry32(606);
  for (const [cx, cz] of [[-9.2, -7.8], [9.2, -6.6], [-4.6, 8.6], [-13.2, -1.2], [5.0, 4.4], [-17.0, -15.6], [24.0, -6.0], [-24.0, 7.0], [14.6, -16.4], [-3.2, -21.6], [27.5, -17.5], [-28.6, -20.0]]) {
    for (let i = 0; i < 3; i++) {
      const x = cx + rand(-0.4, 0.4), z = cz + rand(-0.4, 0.4); if (!isFree(x, z, 0.2, 'low')) continue;
      const y = groundAt(x, z); const h = rand(0.16, 0.3), r = rand(0.12, 0.2); const cap = i === 1 ? 'pink' : 'red';
      B.add(cyl(r * 0.35, r * 0.45, h, 6, true), 'cream', mat4(x, y + h / 2, z), 0);
      B.add(new THREE.SphereGeometry(r, 8, 3, 0, TAU, 0, Math.PI / 2), cap, mat4(x, y + h - 0.02, z, rand(-0.15, 0.15), 0, rand(-0.15, 0.15), 1, 0.7, 1), 0.02);
      for (let k = 0; k < 2; k++) { const a = k * 2.1 + i; B.add(sph(r * 0.18, 5, 3), 'white2', mat4(x + Math.cos(a) * r * 0.55, y + h + r * 0.32, z + Math.sin(a) * r * 0.55), 0, false); }
    }
  }
}

// ================================================================= trees, bushes, rocks (instanced, ink-outlined)
const TREE_SPOTS = [
  [-6.9, -26.6, 1.15, 'blossom'], [6.9, -26.6, 1.15, 'blossom'], [-8.8, -30.6, 1.1, 'green'], [8.8, -30.9, 1.1, 'green'], [-3.9, -31.4, 1.0, 'blossom'], [3.9, -31.6, 1.0, 'blossom'], [0.2, -32.4, 1.05, 'green'],
  [-15.6, -27.4, 1.2, 'green'], [-20.8, -23.6, 1.1, 'dark'], [-26.4, -29.4, 1.2, 'green'], [-30.6, -23.6, 1.0, 'blossom'], [-18.2, -31.2, 1.0, 'blossom'], [15.8, -26.8, 1.15, 'green'], [20.6, -30.4, 1.1, 'blossom'], [21.0, -21.6, 1.0, 'green'], [30.8, -27.0, 1.1, 'dark'],
  [-31.2, -15.4, 1.05, 'green'], [-31.6, -6.2, 0.95, 'blossom'], [-31.0, 4.4, 1.05, 'green'], [-31.0, 13.4, 1.0, 'dark'], [-26.8, 18.4, 1.0, 'blossom'], [31.0, -18.4, 1.05, 'green'], [31.6, -4.6, 0.95, 'blossom'], [31.2, 6.2, 1.05, 'green'], [30.6, 17.6, 1.0, 'dark'], [25.8, 22.4, 1.0, 'blossom'],
  [-20.4, 27.4, 1.1, 'green'], [-9.2, 27.0, 1.0, 'blossom'], [-1.4, 25.2, 1.05, 'green'], [6.2, 27.6, 1.0, 'blossom'], [-26.0, 30.0, 1.0, 'green'], [27.2, 29.4, 1.05, 'green'], [-14.4, 31.6, 0.95, 'dark'], [12.0, 31.8, 1.0, 'green'],
  [-4.6, -4.4, 0.75, 'blossom'], [4.0, -8.3, 0.8, 'green'], [-13.8, 2.6, 0.7, 'green'], [14.4, -6.4, 0.7, 'blossom'], [0.6, -7.2, 0.7, 'green'], [-4.4, 5.2, 0.7, 'green'], [7.4, 0.2, 0.7, 'blossom'],
  [22.0, -15.8, 0.9, 'green'], [13.4, -16.2, 0.85, 'blossom'], [-25.6, -9.8, 0.9, 'blossom'], [-25.2, -16.4, 0.95, 'green'], [-24.0, 13.4, 0.9, 'green'], [24.2, 12.0, 0.9, 'blossom'], [25.0, -6.6, 0.85, 'green'],
];
const CANOPY = { green: [0x86C46F, 0x79B964, 0x92CC79], dark: [0x6FAA5C, 0x659F55, 0x78B163], blossom: [0xF7BCD8, 0xF3A9CB, 0xFAD0E3] };
function buildTrees(group, gradientMap, inkMat) {
  rnd = mulberry32(777);
  const trunks = [], blobs = [];
  const add = (x, z, s, kind, bush = false) => {
    const y = groundAt(x, z) - 0.05; const yaw = rand(0, TAU); const pal = CANOPY[kind];
    if (!bush) trunks.push(mat4(x, y, z, rand(-0.05, 0.05), yaw, rand(-0.05, 0.05), s, s * rand(1.0, 1.25), s));
    const h = bush ? 0 : 1.25 * s; const c = Math.cos(yaw), si = Math.sin(yaw);
    const parts = bush ? [[0, 0.32, 0, 0.55], [0.4, 0.22, 0.1, 0.4]] : [[0, 0.78, 0, 1.0], [-0.62, 0.38, 0.15, 0.66], [0.58, 0.48, -0.2, 0.62]];
    for (const [lx, ly, lz, r] of parts) { const wx = lx * c + lz * si, wz = -lx * si + lz * c; blobs.push({ m: mat4(x + wx * s, y + h + ly * s, z + wz * s, 0, rand(0, TAU), 0, r * s, r * s * rand(0.85, 1.0), r * s), r: r * s, c: new THREE.Color(pick(pal)) }); }
    BLOCKS.push({ x, z, r: bush ? 0.5 * s : 0.9 * s });
  };
  for (const [x, z, s, kind] of TREE_SPOTS) if (isFree(x, z, 0.95 * s, 'tall')) add(x, z, s, kind);
  let tries = 0, extra = 0;
  while (extra < 12 && tries++ < 4000) { const x = rand(-HALF, HALF), z = rand(-HALF, HALF); if (Math.abs(x) < 24 && Math.abs(z) < 21) continue; const s = rand(0.85, 1.15); if (!isFree(x, z, 0.95 * s, 'tall')) continue; add(x, z, s, pick(['green', 'green', 'dark', 'blossom'])); extra++; }
  tries = 0; let bushes = 0;
  while (bushes < 52 && tries++ < 6000) {
    const x = rand(-HALF, HALF), z = rand(-HALF, HALF); const s = rand(0.6, 1.0);
    if (!isFree(x, z, 0.55 * s, 'low')) continue;
    if (Math.abs(x) < 20 && Math.abs(z) < 12 && rnd() < 0.55) continue;
    add(x, z, s, pick(['green', 'green', 'dark', 'blossom']), true); bushes++;
  }
  const trunkGeo = cyl(0.12, 0.19, 1.3, 7); trunkGeo.translate(0, 0.65, 0);
  const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshToonMaterial({ color: COLORS.woodMid, gradientMap }), trunks.length);
  trunks.forEach((m, i) => trunk.setMatrixAt(i, m)); trunk.castShadow = true; trunk.receiveShadow = true; trunk.name = 'v:trunks'; group.add(trunk);
  const canopy = new THREE.InstancedMesh(sph(1, 8, 6), new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap }), blobs.length);
  const ink = new THREE.InstancedMesh(sph(1, 6, 4), inkMat, blobs.length);
  const tmp = new THREE.Matrix4(), S = new THREE.Matrix4();
  blobs.forEach((b, i) => { canopy.setMatrixAt(i, b.m); canopy.setColorAt(i, b.c); const k = (b.r + 0.055) / b.r; ink.setMatrixAt(i, tmp.copy(b.m).multiply(S.makeScale(k, k, k))); });
  canopy.castShadow = true; canopy.receiveShadow = true; canopy.name = 'v:canopies'; group.add(canopy); ink.name = 'v:canopyInk'; group.add(ink);
  const trunkInk = new THREE.InstancedMesh(trunkGeo, inkMat, trunks.length); trunks.forEach((m, i) => trunkInk.setMatrixAt(i, tmp.copy(m).multiply(S.makeScale(1.35, 1.0, 1.35)))); trunkInk.name = 'v:trunkInk'; group.add(trunkInk);
}
function buildRocks(group, gradientMap, inkMat) {
  rnd = mulberry32(31337); const list = [];
  for (const p of POOLS) { const n = p.name === 'lilyPond' ? 14 : 8; for (let i = 0; i < n; i++) { const a = i / n * TAU + rand(-0.1, 0.1); const r = p.r + 0.75 + rand(-0.1, 0.15); const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r; if (routeNear(x, z).dist < PATH_HW + 0.6 || waterNear(x, z).e < 0.25) continue; list.push([x, z, rand(0.16, 0.32)]); } }
  for (const R of RIVERS) for (let i = 0; i < 30; i++) { const k = Math.floor(rand(3, R.pts.length - 4)); const a = R.pts[k], b = R.pts[k + 1]; const tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; const side = rnd() < 0.5 ? -1 : 1; const d = a.w + 0.75 + rand(0, 0.3); const x = a.x - tz / l * d * side, z = a.z + tx / l * d * side; if (isFree(x, z, 0.15, 'low')) list.push([x, z, rand(0.14, 0.3)]); }
  { const F = frameAt(BR.x, 0, BR.z, BR.yaw); for (const [lx, lz, r] of [[-2.0, -2.1, 0.28], [2.05, -2.0, 0.32], [1.5, -2.7, 0.22], [-1.2, -2.9, 0.2]]) { const p = new THREE.Vector3().setFromMatrixPosition(F(lx, 0, lz)); list.push([p.x, p.z, r]); } }
  for (let i = 0; i < 26; i++) { const x = rand(-HALF, HALF), z = rand(-HALF, HALF); if (isFree(x, z, 0.3, 'low')) list.push([x, z, rand(0.18, 0.4)]); }
  const geo = new THREE.DodecahedronGeometry(1, 0); const mesh = new THREE.InstancedMesh(geo, new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap }), list.length); const ink = new THREE.InstancedMesh(geo, inkMat, list.length);
  const cols = [0xE3D7C2, 0xD6C8B0, 0xEDE4D3, 0xCDBEA4].map(h => new THREE.Color(h)); const tmp = new THREE.Matrix4(), S = new THREE.Matrix4();
  list.forEach(([x, z, r], i) => { const m = mat4(x, groundAt(x, z) + r * 0.2, z, rand(0, 3), rand(0, 3), rand(0, 3), r * 1.2, r * 0.75, r); mesh.setMatrixAt(i, m); mesh.setColorAt(i, cols[i % cols.length]); ink.setMatrixAt(i, tmp.copy(m).multiply(S.makeScale(1 + 0.05 / r, 1 + 0.05 / r, 1 + 0.05 / r))); });
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'v:rocks'; group.add(mesh); ink.name = 'v:rockInk'; group.add(ink);
}

// ================================================================= flowers, grass tufts, lily pads, reeds
function buildFlora(group, gradientMap, extraFlowers) {
  rnd = mulberry32(4242);
  const flowers = [...extraFlowers];
  const tryFlower = (x, z, pal, sMin = 0.11, sMax = 0.17) => { if (!isFree(x, z, 0.08, 'flower')) return false; const c = pick(PAL[pal]); const s = (PAL.blue.includes(c) ? 1.1 : 1.4) * rand(sMin, sMax); flowers.push({ x, z, y: groundAt(x, z) + rand(0.1, 0.24), s, c }); return true; };
  for (const b of BEDS) { const c = Math.cos(b.rot), s = Math.sin(b.rot); for (let i = 0, k = 0; i < b.n && k < b.n * 6; k++) { const a = rand(0, TAU), d = Math.sqrt(rnd()) * 0.95; const u = Math.cos(a) * b.rx * d, v = Math.sin(a) * b.rz * d; const x = b.x + u * c + v * s, z = b.z - u * s + v * c; if (tryFlower(x, z, b.pal, b.big ? 0.13 : 0.11, b.big ? 0.2 : 0.17)) i++; } }
  // blooms along the outer edge of the path (never in the machine corridors), around buildings and in the meadows
  for (let i = 0; i < 220; i++) { const d = rand(0, LOOP); const f = routeFrame(d); const side = rnd() < 0.7 ? -1 : 1; const off = PATH_HW + rand(0.5, 1.2) + (side > 0 ? CORRIDOR : 0); tryFlower(f.x + f.nx * off * side, f.z + f.nz * off * side, 'mixed', 0.09, 0.14); }
  for (const [bx, bz, r, n] of [[P.bakery.x, P.bakery.z, 3.4, 40], [P.petwash.x, P.petwash.z, 3.5, 44], [P.fountain.x, P.fountain.z, 4.2, 40], ...P.cottages.map(c => [c.x, c.z, 2.3, 22]), [P.castle.x, P.castle.z, 5.6, 60]]) { for (let i = 0; i < n; i++) { const a = rand(0, TAU), rr = r + rand(0, 0.7); tryFlower(bx + Math.cos(a) * rr, bz + Math.sin(a) * rr, rnd() < 0.5 ? 'blue' : 'pink', 0.09, 0.14); } }
  for (let i = 0; i < 180; i++) { const x = rand(-HALF, HALF), z = rand(-HALF, HALF); tryFlower(x, z, 'mixed', 0.08, 0.13); }
  const fm = new THREE.InstancedMesh(flowerGeo(), new THREE.MeshToonMaterial({ color: 0xffffff, side: THREE.DoubleSide, gradientMap }), flowers.length);
  const cm = new THREE.InstancedMesh(new THREE.CircleGeometry(0.28, 3).rotateX(-Math.PI / 2).translate(0, 0.06, 0), new THREE.MeshToonMaterial({ color: 0xF7D04A, gradientMap }), flowers.length);
  const col = new THREE.Color();
  flowers.forEach((f, i) => { const m = mat4(f.x, f.y, f.z, rand(-0.25, 0.25), rand(0, TAU), rand(-0.25, 0.25), f.s); fm.setMatrixAt(i, m); cm.setMatrixAt(i, m); fm.setColorAt(i, col.setHex(f.c)); });
  fm.receiveShadow = true; cm.receiveShadow = true; fm.name = 'v:flowers'; cm.name = 'v:flowerHearts'; group.add(fm, cm);
  // leafy tufts
  const tufts = [];
  flowers.forEach((f, i) => { if (i % 2) tufts.push([f.x + rand(-0.1, 0.1), f.z + rand(-0.1, 0.1), rand(0.7, 1.0)]); });
  for (let k = 0; k < 9000 && tufts.length < 1250; k++) { const x = rand(-HALF, HALF), z = rand(-HALF, HALF); if (!isFree(x, z, 0.05, 'flower')) continue; tufts.push([x, z, rand(0.55, 0.95)]); }
  const tm = new THREE.InstancedMesh(tuftGeo(), new THREE.MeshToonMaterial({ color: 0xffffff, side: THREE.DoubleSide, gradientMap }), tufts.length);
  const greens = [0x7DB866, 0x6DAA5A, 0x8CC873, 0x75B060].map(h => new THREE.Color(h));
  tufts.forEach(([x, z, s], i) => { tm.setMatrixAt(i, mat4(x, groundAt(x, z) - 0.03, z, 0, rand(0, TAU), 0, s)); tm.setColorAt(i, greens[i % greens.length]); });
  tm.receiveShadow = true; tm.name = 'v:tufts'; group.add(tm);
  // lily pads + lotus in the lily pond, reeds around it
  const pond = POOLS.find(p => p.name === 'lilyPond'); const pads = [];
  for (let i = 0; i < 11; i++) { const a = rand(0, TAU), r = rand(0.3, pond.r - 0.25); pads.push([pond.x + Math.cos(a) * r, pond.z + Math.sin(a) * r, rand(0.24, 0.4)]); }
  const pm = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 14, 0.35, TAU - 0.7).rotateX(-Math.PI / 2), new THREE.MeshToonMaterial({ color: 0x7DBE6A, gradientMap }), pads.length);
  pads.forEach(([x, z, r], i) => pm.setMatrixAt(i, mat4(x, pond.y + 0.03, z, 0, rand(0, TAU), 0, r))); pm.receiveShadow = true; pm.name = 'v:lilyPads'; group.add(pm);
  const lotus = new THREE.InstancedMesh(flowerGeo(), new THREE.MeshToonMaterial({ color: 0xffffff, side: THREE.DoubleSide, gradientMap }), 5);
  for (let i = 0; i < 5; i++) { const [x, z] = pads[i]; lotus.setMatrixAt(i, mat4(x, pond.y + 0.06, z, 0, rand(0, TAU), 0, 0.3)); lotus.setColorAt(i, col.setHex(i % 2 ? 0xF7B7D6 : 0xFFF0F6)); } lotus.name = 'v:lotus'; group.add(lotus);
  const reeds = []; for (let i = 0; i < 46; i++) { const a = rand(0, TAU), r = pond.r + rand(0.1, 0.55); const x = pond.x + Math.cos(a) * r, z = pond.z + Math.sin(a) * r; reeds.push(mat4(x, groundAt(x, z), z, rand(-0.15, 0.15), 0, rand(-0.15, 0.15), 1, rand(0.7, 1.3), 1)); }
  const rg = cone(0.035, 0.9, 4); rg.translate(0, 0.45, 0); const rm = new THREE.InstancedMesh(rg, new THREE.MeshToonMaterial({ color: COLORS.reed, gradientMap }), reeds.length); reeds.forEach((m, i) => rm.setMatrixAt(i, m)); rm.name = 'v:reeds'; group.add(rm);
}

// ================================================================= particles + ambient life
function buildParticles(group, gradientMap, { chimneys, emitters, flames, shinies, fountainJets, cascade }) {
  rnd = mulberry32(2026); const animators = [];
  const sp = []; const warm = new THREE.Color(1.6, 1.45, 1.1), pinkC = new THREE.Color(1.5, 1.05, 1.3), blueC = new THREE.Color(1.1, 1.3, 1.6);
  for (const j of fountainJets) for (let i = 0; i < 26; i++) { const a = rand(0, TAU), r = rand(0.2, 1.9); sp.push([j.x + Math.cos(a) * r, j.y + rand(-1.7, 0.6), j.z + Math.sin(a) * r, rand(0.12, 0.24), pick([warm, pinkC, blueC])]); }
  for (const R of RIVERS) for (let i = 0; i < 34; i++) { const k = Math.floor(rand(0, R.pts.length - 1)); const p = R.pts[k]; sp.push([p.x + rand(-0.6, 0.6), p.y + rand(0.05, 0.4), p.z + rand(-0.6, 0.6), rand(0.1, 0.2), blueC]); }
  for (let i = 0; i < 16; i++) sp.push([cascade.x + rand(-0.9, 0.9), cascade.y + rand(-1.6, 0.8), cascade.z + rand(-0.9, 0.9), rand(0.1, 0.22), blueC]);
  for (const s of SPACES.filter(s => s.type === 'shard')) for (let i = 0; i < 3; i++) sp.push([s.pos[0] + rand(-1.1, 1.1), s.pos[1] + rand(0.25, 1.2), s.pos[2] + rand(-1.1, 1.1), rand(0.14, 0.24), warm]);
  for (let i = 0; i < 18; i++) sp.push([P.castle.x + rand(-4.5, 4.5), P.castle.y + rand(1, 7), P.castle.z + rand(-2.5, 2.5), rand(0.15, 0.28), pick([warm, pinkC])]);
  for (let i = 0; i < 8; i++) sp.push([P.pedestal.x + rand(-1.2, 1.2), P.pedestal.y + rand(0.6, 2.2), P.pedestal.z + rand(-1.2, 1.2), rand(0.14, 0.24), pick([warm, blueC, pinkC])]);
  for (const s of shinies) for (let i = 0; i < 2; i++) sp.push([s.x + rand(-0.15, 0.15), s.y + rand(0, 0.3), s.z + rand(-0.15, 0.15), rand(0.14, 0.22), warm]);
  for (let i = 0; i < 30; i++) { const x = rand(-28, 28), z = rand(-28, 28); sp.push([x, groundAt(x, z) + rand(0.4, 2.2), z, rand(0.1, 0.2), pick([warm, pinkC, blueC])]); }
  const spark = makePoints(sp.length, sparkleTexture(), { additive: true }); spark.name = 'v:sparkles';
  sp.forEach(([x, y, z, s, c], i) => { spark.geometry.attributes.position.setXYZ(i, x, y, z); spark.geometry.attributes.aSize.setX(i, s); spark.geometry.attributes.aColor.setXYZ(i, c.r, c.g, c.b); spark.geometry.attributes.aPhase.setX(i, rnd()); spark.geometry.attributes.aTwinkle.setX(i, 1); });
  const spBase = sp.map(p => p[1]); group.add(spark);
  animators.push((dt, t) => { spark.material.uniforms.uTime.value = t; const pa = spark.geometry.attributes.position; for (let i = 0; i < spBase.length; i++) pa.setY(i, spBase[i] + Math.sin(t * 0.7 + i) * 0.12); pa.needsUpdate = true; });
  // bubbles from the pet wash
  const NB = 34; const bub = makePoints(NB, bubbleTexture()); bub.name = 'v:bubbles'; group.add(bub);
  const bs = []; for (let i = 0; i < NB; i++) bs.push({ e: emitters[i % emitters.length], life: rand(0, 1), speed: rand(0.35, 0.7), size: rand(0.16, 0.42), ph: rand(0, TAU), drift: new THREE.Vector2(rand(-0.25, 0.25), rand(-0.1, 0.35)) });
  animators.push((dt, t) => { const pa = bub.geometry.attributes.position, al = bub.geometry.attributes.aAlpha, sz = bub.geometry.attributes.aSize;
    bs.forEach((b, i) => { b.life += dt * b.speed * 0.25; if (b.life > 1) { b.life = 0; b.ph = rand(0, TAU); }
      const L = b.life; pa.setXYZ(i, b.e.x + b.drift.x * L * 4 + Math.sin(t * 2 + b.ph) * 0.15, b.e.y + L * 4.2, b.e.z + b.drift.y * L * 4 + Math.cos(t * 1.7 + b.ph) * 0.15);
      al.setX(i, smooth(0, 0.08, L) * (1 - smooth(0.82, 1, L))); sz.setX(i, b.size * (0.6 + L * 0.6)); });
    pa.needsUpdate = al.needsUpdate = sz.needsUpdate = true; });
  // chimney smoke + waterfall mist
  const puffs = chimneys.map(e => ({ e, kind: 'smoke' })).concat([{ e: cascade, kind: 'mist' }, ...fountainJets.map(e => ({ e: e.clone().setY(e.y - 1.6), kind: 'mist' }))]);
  const NS = puffs.length * 6;
  if (NS) {
    const smoke = makePoints(NS, softDotTexture('rgba(255,255,255,0.95)')); smoke.name = 'v:smoke'; group.add(smoke);
    const ss = []; for (let i = 0; i < NS; i++) ss.push({ p: puffs[Math.floor(i / 6)], life: (i % 6) / 6 + rand(0, 0.15), ph: rand(0, TAU) });
    for (let i = 0; i < NS; i++) { const c = ss[i].p.kind === 'mist' ? [0.92, 1.0, 1.08] : [1.0, 0.97, 0.95]; smoke.geometry.attributes.aColor.setXYZ(i, ...c); }
    animators.push((dt, t) => { const pa = smoke.geometry.attributes.position, al = smoke.geometry.attributes.aAlpha, sz = smoke.geometry.attributes.aSize;
      ss.forEach((s, i) => { const mist = s.p.kind === 'mist'; s.life += dt * (mist ? 0.35 : 0.16); if (s.life > 1) s.life -= 1; const L = s.life; const e = s.p.e;
        if (mist) { pa.setXYZ(i, e.x + Math.sin(s.ph + L * 3) * 0.5 * L, e.y + 0.1 + L * 0.9, e.z + Math.cos(s.ph + L * 2) * 0.5 * L); al.setX(i, 0.5 * smooth(0, 0.15, L) * (1 - smooth(0.4, 1, L))); sz.setX(i, 0.4 + L * 0.8); }
        else { pa.setXYZ(i, e.x + L * 1.2 + Math.sin(t + s.ph) * 0.1, e.y + L * 2.4, e.z + L * 0.4); al.setX(i, 0.75 * smooth(0, 0.1, L) * (1 - smooth(0.5, 1, L))); sz.setX(i, 0.35 + L * 0.9); } });
      pa.needsUpdate = al.needsUpdate = sz.needsUpdate = true; });
  }
  if (flames.length) { const fl = makePoints(flames.length, softDotTexture('rgba(255,240,200,1)'), { additive: true }); flames.forEach((p, i) => { fl.geometry.attributes.position.setXYZ(i, p.x, p.y, p.z); fl.geometry.attributes.aSize.setX(i, 0.28); fl.geometry.attributes.aColor.setXYZ(i, 1.8, 1.2, 0.5); fl.geometry.attributes.aPhase.setX(i, rnd()); fl.geometry.attributes.aTwinkle.setX(i, 0.4); }); fl.name = 'v:flames'; group.add(fl); animators.push((dt, t) => { fl.material.uniforms.uTime.value = t * 3; }); }
  // drifting petals
  const NP = 60; const petalShape = new THREE.Shape(); petalShape.moveTo(0, -0.1); petalShape.quadraticCurveTo(0.08, 0, 0, 0.1); petalShape.quadraticCurveTo(-0.08, 0, 0, -0.1);
  const petals = new THREE.InstancedMesh(new THREE.ShapeGeometry(petalShape, 3), new THREE.MeshToonMaterial({ color: 0xffffff, side: THREE.DoubleSide, gradientMap }), NP);
  petals.frustumCulled = false; petals.name = 'v:petals'; group.add(petals);
  const pcols = [0xF7B7D6, 0xF29BC8, 0xFFF0F6, 0xFAD0E3, 0xB9CFF7].map(h => new THREE.Color(h));
  const ps = []; const respawn = (p, first) => { p.pos.set(first ? rand(-32, 26) : rand(-38, -30), rand(3, 9), rand(-28, 24)); p.rot.set(rand(0, 3), rand(0, 3), rand(0, 3)); };
  for (let i = 0; i < NP; i++) { const p = { pos: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(rand(-2, 2), rand(-2, 2), rand(-2, 2)), ph: rand(0, TAU), sc: rand(0.8, 1.4) }; respawn(p, true); ps.push(p); petals.setColorAt(i, pcols[i % pcols.length]); }
  const pm = new THREE.Matrix4(), pq = new THREE.Quaternion(), pv = new THREE.Vector3();
  animators.push((dt, t) => { ps.forEach((p, i) => { p.pos.x += dt * (0.75 + Math.sin(t * 0.3 + p.ph) * 0.3); p.pos.z += dt * (0.25 + Math.sin(t * 0.5 + p.ph) * 0.35); p.pos.y -= dt * (0.16 + Math.sin(t * 1.3 + p.ph) * 0.12);
      p.rot.x += p.spin.x * dt; p.rot.y += p.spin.y * dt; p.rot.z += p.spin.z * dt;
      if (p.pos.x > 36 || Math.abs(p.pos.z) > 36 || p.pos.y < 0.1 + Math.max(0, LY.heightAt(p.pos.x, p.pos.z))) respawn(p, false);
      pm.compose(p.pos, pq.setFromEuler(p.rot), pv.setScalar(p.sc)); petals.setMatrixAt(i, pm); }); petals.instanceMatrix.needsUpdate = true; });
  // butterflies over the gardens
  const wing = new THREE.Shape(); wing.moveTo(0, 0); wing.bezierCurveTo(0.1, 0.22, 0.32, 0.22, 0.3, 0.06); wing.bezierCurveTo(0.3, -0.04, 0.24, -0.2, 0.12, -0.16); wing.bezierCurveTo(0.05, -0.14, 0.02, -0.06, 0, 0);
  const homes = [[-23, -8, 0xB48BE0], [3.2, 1.2, 0x5B8DEF], [P.petwash.x + 2, P.petwash.z + 3, 0xF29BC8], [P.bakery.x - 4, P.bakery.z + 1, 0xF2C14E], [-4.8, -19.6, 0x5B8DEF], [22.6, -10.6, 0xF29BC8]];
  const NBF = homes.length; const bfly = new THREE.InstancedMesh(new THREE.ShapeGeometry(wing, 5).rotateX(-Math.PI / 2), new THREE.MeshToonMaterial({ color: 0xffffff, side: THREE.DoubleSide, gradientMap }), NBF * 2); bfly.frustumCulled = false; bfly.name = 'v:butterflies'; group.add(bfly);
  const bf = homes.map(([x, z, c], i) => ({ x, z, y0: groundAt(x, z), c: new THREE.Color(c), ph: i * 1.9 }));
  bf.forEach((b, i) => { bfly.setColorAt(i * 2, b.c); bfly.setColorAt(i * 2 + 1, b.c); });
  const bm = new THREE.Matrix4(), bq = new THREE.Quaternion(), bq2 = new THREE.Quaternion(), bq3 = new THREE.Quaternion(), bp = new THREE.Vector3(), bsL = new THREE.Vector3(1, 1, 1), bsR = new THREE.Vector3(-1, 1, 1), Yax = new THREE.Vector3(0, 1, 0), Zax = new THREE.Vector3(0, 0, 1);
  animators.push((dt, t) => { bf.forEach((b, i) => { const a = t * 0.45 + b.ph; bp.set(b.x + Math.sin(a) * 2.2, b.y0 + 0.9 + Math.sin(t * 1.7 + b.ph) * 0.35, b.z + Math.sin(a * 2) * 1.2); const head = Math.atan2(Math.cos(a) * 2.2, Math.cos(a * 2) * 2.4);
      const flap = Math.sin(t * 16 + b.ph) * 0.9; bq.setFromAxisAngle(Yax, head - Math.PI / 2);
      bm.compose(bp, bq2.copy(bq).multiply(bq3.setFromAxisAngle(Zax, flap)), bsL); bfly.setMatrixAt(i * 2, bm);
      bm.compose(bp, bq2.copy(bq).multiply(bq3.setFromAxisAngle(Zax, -flap)), bsR); bfly.setMatrixAt(i * 2 + 1, bm); }); bfly.instanceMatrix.needsUpdate = true; });
  return animators;
}
function buildFoam(group, gradientMap, spots, animators) {
  const items = []; rnd = mulberry32(9);
  for (const s of spots) for (let i = 0; i < s.n; i++) items.push({ x: s.x + rand(-s.r, s.r), y: s.y, z: s.z + rand(-s.r * 0.6, s.r * 0.6), r: rand(0.1, 0.2), ph: rand(0, TAU) });
  const mesh = new THREE.InstancedMesh(sph(1, 7, 4), new THREE.MeshToonMaterial({ color: 0xFFFFFF, gradientMap }), Math.max(1, items.length)); mesh.count = items.length; mesh.frustumCulled = false; mesh.name = 'v:foam'; group.add(mesh);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  animators.push((dt, t) => { items.forEach((f, i) => { const k = 0.75 + 0.35 * Math.sin(t * 5 + f.ph); m.compose(p.set(f.x, f.y + Math.sin(t * 4 + f.ph) * 0.03, f.z), q, s.set(f.r * k, f.r * k * 0.7, f.r * k)); mesh.setMatrixAt(i, m); }); mesh.instanceMatrix.needsUpdate = true; });
}

// ================================================================= sky dome + clouds (optional)
function buildSky(group) {
  const sky = new THREE.Group(); sky.name = 'village:sky';
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { cTop: { value: new THREE.Color(0x9CCFEC) }, cHorizon: { value: new THREE.Color(0xD3ECF6) }, cLow: { value: new THREE.Color(0xBFE2F2) }, cBottom: { value: new THREE.Color(0xF4E8D4) } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 cTop, cHorizon, cLow, cBottom; varying vec3 vDir;
      void main(){ float y = vDir.y; vec3 c = y > 0.0 ? mix(cHorizon, cTop, smoothstep(0.0, 0.55, y)) : mix(cHorizon, cLow, smoothstep(0.0, -0.32, y));
        c = mix(c, cBottom, smoothstep(-0.48, -0.88, y)); gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(190, 32, 16), mat); dome.renderOrder = -10; dome.frustumCulled = false; dome.name = 'v:skyDome'; sky.add(dome);
  group.add(sky); return sky;
}
function buildClouds(sky, getMat, inkMat) {
  const B = new Batch(getMat); rnd = mulberry32(55);
  const clouds = [[-44, 7, -40, 1.9], [40, 9, -44, 1.7], [-58, 5, -10, 1.6], [58, 6, -6, 1.5], [-18, 11, -62, 2.1], [20, 12, -64, 2.2], [0, 14, -80, 2.4], [-62, 8, 20, 1.6], [62, 7, 24, 1.5]];
  for (const [x, y, z, s] of clouds) { for (let i = 0; i < 6; i++) { const r = s * rand(1.1, 1.9); B.add(sph(r, 7, 5), 'cloud', mat4(x + (i - 2.5) * s * 1.25 + rand(-0.4, 0.4), y + rand(0, 0.9) * s - (i === 0 || i === 5 ? 0.5 : 0), z + rand(-0.6, 0.6), 0, 0, 0, 1, 0.78, 1), 0, false); } }
  B.build(sky, inkMat);
}

// ================================================================= main
export async function createVillage({ scene, layout, textures = {}, images = {}, sky = true } = {}) {
  if (!layout || !layout.SPACES) layout = await import('./layout.js');
  textures = textures || {}; images = images || {};
  initWorld(layout);
  const group = new THREE.Group(); group.name = 'village'; if (scene) scene.add(group);
  const GRAD = makeGradient();
  const matCache = new Map();
  const toon = (hex, o = {}) => new THREE.MeshToonMaterial({ color: hex, gradientMap: GRAD, ...o });
  const getMat = (key) => {
    if (matCache.has(key)) return matCache.get(key);
    let m;
    if (GLOW[key]) m = new THREE.MeshBasicMaterial({ color: new THREE.Color(GLOW[key][0]).multiplyScalar(GLOW[key][1]) });
    else if (key === 'bridgeTex') { let t; if (textures.tex_stone) { t = textures.tex_stone.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(0.62, 0.62); t.needsUpdate = true; } else { t = canvasTex(stoneBlockCanvas(), { repeat: true, aniso: 8 }); t.repeat.set(1.25, 1.25); } m = toon(0xffffff, { map: t }); }
    else if (key === 'vault') m = new THREE.MeshBasicMaterial({ color: 0x9C9CC8, side: THREE.DoubleSide });
    else if (key === 'cloud') m = toon(0xFFFFFF, { emissive: 0x5A5A66 });
    else m = toon(COLORS[key] ?? 0xff00ff);
    matCache.set(key, m); return m;
  };
  const inkMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
  const B = new Batch(getMat);
  const animators = [];
  await ensureFont();

  buildGround(group, GRAD, inkMat);
  const { tex: pathTex } = buildPath(group, GRAD, textures);
  const foamSpots = [];
  const water = buildWater(group, B, animators, foamSpots); group.userData.fallMat = water.fallMat;
  const { tiles, setTileHighlight, tileAnim } = await buildTiles(group, textures, images, GRAD, inkMat); animators.push(tileAnim);
  buildBridge(B, group, pathTex, GRAD);
  const chimneys = [], emitters = [], flames = [], shinies = [], fountainJets = [], extraFlowers = [];
  buildCastle(B, group, GRAD);
  buildPedestal(B, group, GRAD, extraFlowers);
  buildBakery(B, group, GRAD, chimneys);
  buildPetWash(B, group, GRAD, emitters);
  for (const c of P.cottages) buildCottage(B, c, chimneys);
  buildFountain(B, group, GRAD, water.stillMat, pathTex, fountainJets);
  buildCakeTable(B, flames);
  buildLamps(B, group, GRAD, animators);
  buildHideout(B, group, GRAD, shinies);
  buildGarden(B, group, GRAD);
  buildMeadowProps(B, group, GRAD);
  buildTrees(group, GRAD, inkMat);
  buildRocks(group, GRAD, inkMat);
  buildFlora(group, GRAD, extraFlowers);
  animators.push(...buildParticles(group, GRAD, { chimneys, emitters, flames, shinies, fountainJets, cascade: water.cascadeFoot }));
  buildFoam(group, GRAD, foamSpots, animators);
  const skyGroup = buildSky(group); skyGroup.visible = sky !== false;
  buildClouds(skyGroup, getMat, inkMat);
  B.build(group, inkMat);

  const bridgeAnchor = new THREE.Vector3(BR.x, BR.y, BR.z);
  function update(dt = 0.016, t = 0) { for (const a of animators) a(dt, t); }
  return {
    group, update, tiles, setTileHighlight, bridgeAnchor,
    heightAt: surfaceAt,            // visible surface height (path, bridge deck, water or ground) at (x, z)
    groundAt,                       // rendered terrain height (ignores the path ribbon / deck)
    deckHeight: DECK_TOP,           // bridge deck top at its centre
    tileTop: (i) => tiles.get(i)?.userData.top,
    sky: skyGroup, landmarks: P.landmarks,
    river: RIVERS.map(R => R.pts.filter((p, i) => i % 6 === 0 || p.exit).map(p => [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)])),
    water,
  };
}
