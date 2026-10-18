// Kyah & Ayva: Starlight Gem Chase — phone mini-games (design v2 §4).
//
//   runMinigame(type, { params, onTick, onDone, audio, hero, container, deadline, signal, buzz, art })
//     -> Promise<{ score }>          ({ score: null, aborted: true } when opts.signal aborts first)
//
//   type      flight | shard | fetch | swish | cake | chase | bell
//   params    state.minigame.params (optional: sweet/perfect windows for chase & bell)
//   onTick    (progress 0..1) — throttled here to <= 5 Hz; the caller sends player:miniTick
//   onDone    (score) — fires exactly once, the moment the score is known; input is disabled from then on
//   audio     the /play/audio.js module ({ sfx, sweep })
//   hero      { id, name, color, face } — the player's hero (face = portrait URL for the title card)
//   deadline  epoch ms when the server stops waiting; the game auto-starts and ends early to beat it
//   onFrame   (blob) — optional live picture for the board: a 240 px wide JPEG (q 0.55) of the game canvas at
//             <= ~8 fps, from the Start tap until the result (a frame is skipped while the previous encode runs)
//   art       { faces: { heroId: url }, urls: { mini_*: url } } — portraits + the mini-game art from
//             /assets/images/manifest-phone.json; each game loads only its own keys, lazily, at mount
//
// Every game: title card (hero face + ONE line) -> big Start tap -> "Ready… GO!" -> <= 15 s of play on a
// full-screen canvas with a countdown ring -> result flash. Art is drawn over/with book-style canvas shapes
// (pastel fills, chunky ink outlines); every bitmap has a drawn fallback, so a missing file never blocks play.

import { MINI, TIERS, maxScore } from '../shared/difficulty.js';

const TAU = Math.PI * 2;
const INK = '#2B2440';
const FONT = 'Fredoka, "Baloo 2", ui-rounded, system-ui, sans-serif';
const SPARK = ['#FFE27A', '#F7B6D6', '#BFE3F5', '#CDB4F0', '#A8E0B8', '#FFFFFF'];
const CONF = ['#F29BC8', '#6E8FE0', '#B48BE0', '#A8E0B8', '#F2C14E', '#BFE3F5'];
const RESULT_MS = 2300;
const FRAME_MS = 120;     // live picture for the board: at most one frame every 120 ms
const FRAME_W = 240;      // ...240 px wide, aspect kept
const FRAME_Q = 0.55;     // ...JPEG quality
const FRAME_BUDGET = 130000; // bytes/s: busy backgrounds make bigger JPEGs, so the interval stretches to stay under this
const HUD_TOP = 74;

export const SWEET = [0.30, 0.75];
export const PERFECT = [0.48, 0.58];

export const GAME_INFO = {
  flight: { title: 'Flappy Flight', line: 'Tap to flap through the flower rings!', verb: 'flying through the flower rings', max: 8 },
  shard: { title: 'Look Under the Flowers', line: 'Tap the flower that twinkles!', verb: 'looking under the flowers', max: 6 },
  fetch: { title: 'Charli Catches', line: 'Slide Charli to catch the falling shards!', verb: 'helping Charli catch shards', max: 3 },
  swish: { title: 'Dodge the Net', line: 'Tap to hop when the net glows!', verb: "dodging Grabble's net", max: 3 },
  cake: { title: 'Strawberry Catch', line: 'Tap the strawberries onto the cake!', verb: 'catching strawberries', max: 8 },
  chase: { title: 'Vine Grab', line: 'Hold to grow the vine. Let go in the glow!', verb: 'chasing Grabble', max: 1 },
  bell: { title: 'Ring the Bell', line: 'Tap when the star is in the glow!', verb: 'ringing the bell', max: 1 },
};

// ------------------------------------------------------------------ small helpers
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const mod = (a, n) => ((a % n) + n) % n;
const round3 = (v) => Math.round(clamp(Number(v) || 0, 0, 1) * 1000) / 1000;
const hash = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const easeOutBack = (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const win2 = (v, d) => (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number') ? v : d);
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function hexToRgb(h) { h = String(h || '#6E8FE0').replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mixHex(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
function defaultBuzz(p) { try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(p); } catch { /* ignore */ } }

const imgCache = new Map();
function lazyImage(url) {
  if (!url) return null;
  if (imgCache.has(url)) return imgCache.get(url);
  const rec = { img: null };
  imgCache.set(url, rec);
  const im = new Image();
  im.decoding = 'async';
  im.onload = () => { rec.img = im; };
  im.src = url;
  return rec;
}

// ------------------------------------------------------------------ drawing kit (book style)
function ink(g, lw = 3) { g.lineWidth = lw; g.strokeStyle = INK; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(); }
function fillInk(g, fill, lw = 3) { g.fillStyle = fill; g.fill(); ink(g, lw); }
function circ(g, x, y, r) { g.beginPath(); g.arc(x, y, Math.max(0.1, r), 0, TAU); }
function rrect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function sparklePath(g, x, y, r, rot = 0) {
  g.beginPath();
  for (let i = 0; i < 8; i++) { const a = rot + (i * Math.PI) / 4; const rr = i % 2 ? r * 0.36 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.closePath();
}
function star5(g, x, y, r, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = rot + (i * Math.PI) / 5; const rr = i % 2 ? r * 0.48 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.closePath();
}
function drawWord(g, x, y, text, color, size, alpha = 1, scale = 1) {
  g.save(); g.globalAlpha = alpha; g.translate(x, y); g.scale(scale, scale);
  g.font = `700 ${size}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.lineWidth = size * 0.24; g.strokeStyle = INK; g.strokeText(text, 0, 0);
  g.fillStyle = color; g.fillText(text, 0, 0);
  g.restore();
}
function paper(g, W, H, c1, c2, blots = []) {
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
  g.fillStyle = gr; g.fillRect(-30, -30, W + 60, H + 60);
  for (const [x, y, r, col] of blots) {
    const R = r * Math.max(W, H);
    const rg = g.createRadialGradient(x * W, y * H, 0, x * W, y * H, R);
    rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(x * W - R, y * H - R, R * 2, R * 2);
  }
}
function drawCover(g, img, W, H, fx = 0.5, fy = 0.5, shiftX = 0) {
  const s = Math.max(W / img.width, H / img.height); const dw = img.width * s; const dh = img.height * s;
  const x = clamp((W - dw) * fx - shiftX, W - dw, 0); const y = (H - dh) * fy;
  g.drawImage(img, x, y, dw, dh);
}
function wash(g, W, H, col) { g.fillStyle = col; g.fillRect(-30, -30, W + 60, H + 60); }
function cloud(g, x, y, s) {
  g.beginPath();
  g.arc(x - s * 0.6, y + s * 0.1, s * 0.45, 0, TAU); g.arc(x, y - s * 0.12, s * 0.6, 0, TAU); g.arc(x + s * 0.62, y + s * 0.12, s * 0.42, 0, TAU);
  g.fillStyle = 'rgba(255,255,255,.92)'; g.fill();
  g.lineWidth = 2; g.strokeStyle = 'rgba(43,36,64,.18)'; g.stroke();
}
function bunting(g, W, y) {
  g.beginPath(); g.moveTo(-10, y); g.quadraticCurveTo(W / 2, y + 26, W + 10, y); ink(g, 2.5);
  const n = Math.max(6, Math.ceil(W / 36)); const cols = ['#F7B6D6', '#BFE3F5', '#FFE27A', '#CDB4F0', '#A8E0B8'];
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n; const px = -10 + u * (W + 20); const py = y + 52 * u * (1 - u);
    g.beginPath(); g.moveTo(px - 11, py); g.lineTo(px + 11, py); g.lineTo(px, py + 20); g.closePath(); fillInk(g, cols[i % cols.length], 2);
  }
}
function cobbles(g, W, y0, H) {
  g.fillStyle = '#E3D6C3'; g.fillRect(-20, y0, W + 40, H - y0 + 20);
  g.beginPath(); g.moveTo(-20, y0); g.lineTo(W + 20, y0); ink(g, 3);
  g.save(); g.globalAlpha = 0.85;
  for (let row = 0; row < 6; row++) {
    const yy = y0 + 12 + row * 22; if (yy > H + 10) break;
    for (let i = -1; i < W / 40 + 1; i++) {
      const xx = i * 40 + (row % 2) * 20 + (hash(i * 13 + row) - 0.5) * 8;
      g.beginPath(); g.ellipse(xx, yy, 16, 8, 0, 0, TAU); g.fillStyle = hash(i + row * 7) > 0.5 ? '#D3C3AC' : '#CDBBA2'; g.fill();
      g.lineWidth = 1.5; g.strokeStyle = 'rgba(43,36,64,.35)'; g.stroke();
    }
  }
  g.restore();
}
function grassBand(g, W, y0, H) {
  g.fillStyle = '#BFE6B0'; g.fillRect(-20, y0, W + 40, H - y0 + 20);
  g.beginPath(); g.moveTo(-20, y0);
  for (let x = -20; x <= W + 20; x += 18) g.quadraticCurveTo(x + 9, y0 - 7, x + 18, y0);
  g.lineTo(W + 20, H + 20); g.lineTo(-20, H + 20); g.closePath(); g.fillStyle = '#A8E0B8'; g.fill();
  g.beginPath(); g.moveTo(-20, y0); for (let x = -20; x <= W + 20; x += 18) g.quadraticCurveTo(x + 9, y0 - 7, x + 18, y0); ink(g, 3);
  for (let i = 0; i < W / 46; i++) { const fx = i * 46 + 20 + hash(i) * 16; const fy = y0 + 14 + hash(i + 5) * 20; if (fy < H) drawFlower(g, fx, fy, 7, i % 2 ? '#F7B6D6' : '#9DB8F5', { lw: 1.5 }); }
}
function drawFlower(g, x, y, r, color, o = {}) {
  const n = 6; const spread = o.open || 0; const rot = o.rot || 0; const lw = o.lw || Math.max(2, r * 0.08);
  for (let i = 0; i < n; i++) {
    const a = rot + (i * TAU) / n; const d = r * (0.55 + spread * 0.2);
    circ(g, x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.42 + spread * 0.06)); fillInk(g, color, lw);
  }
  circ(g, x, y, r * 0.34); fillInk(g, o.center || '#FFE27A', lw);
}
function drawShard(g, x, y, s, rot = 0, glow = false, fake = false) {
  if (fake) { drawFakeShard(g, x, y, s, rot); return; }
  g.save(); g.translate(x, y); g.rotate(rot);
  if (glow) {
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, s * 2.2); rg.addColorStop(0, 'rgba(255,240,170,.85)'); rg.addColorStop(1, 'rgba(255,240,170,0)');
    g.fillStyle = rg; g.fillRect(-s * 2.2, -s * 2.2, s * 4.4, s * 4.4);
  }
  const pts = [[0, -1], [0.62, -0.25], [0.4, 0.95], [-0.4, 0.95], [-0.62, -0.25]];
  g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px * s, py * s) : g.moveTo(px * s, py * s))); g.closePath();
  const gr = g.createLinearGradient(0, -s, 0, s); gr.addColorStop(0, '#CFE9FA'); gr.addColorStop(0.5, '#B48BE0'); gr.addColorStop(1, '#F29BC8');
  g.fillStyle = gr; g.fill(); ink(g, Math.max(2.5, s * 0.13));
  g.beginPath(); g.moveTo(-0.62 * s, -0.25 * s); g.lineTo(0.62 * s, -0.25 * s); g.moveTo(0, -s); g.lineTo(-0.2 * s, -0.25 * s); g.lineTo(0, 0.95 * s);
  g.moveTo(0, -s); g.lineTo(0.2 * s, -0.25 * s); g.lineWidth = Math.max(1.2, s * 0.06); g.strokeStyle = 'rgba(43,36,64,.4)'; g.stroke();
  g.beginPath(); g.moveTo(-0.34 * s, -0.42 * s); g.lineTo(-0.16 * s, -0.72 * s); g.lineWidth = Math.max(2, s * 0.12); g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineCap = 'round'; g.stroke();
  g.restore();
}
function drawFaceDisc(g, img, x, y, r, color, letter, lw) {
  g.save();
  circ(g, x, y, r); g.fillStyle = mixHex(color || '#6E8FE0', '#FFFFFF', img ? 0.72 : 0.05); g.fill();
  if (img) { g.clip(); const s = r * 2.32; g.drawImage(img, x - s / 2, y - s / 2 + r * 0.05, s, s); }
  else if (letter) {
    g.font = `700 ${Math.round(r * 1.1)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = r * 0.16; g.strokeStyle = INK; g.lineJoin = 'round'; g.strokeText(letter, x, y + r * 0.06); g.fillStyle = '#fff'; g.fillText(letter, x, y + r * 0.06);
  }
  g.restore();
  circ(g, x, y, r); ink(g, lw || Math.max(3, r * 0.1));
}
// Grabble: feet at (x, y), height h. o.dir: 1 faces right, -1 faces left. o.hand: {x,y} to reach for.
function drawGrabble(g, x, y, h, t, face, o = {}) {
  const s = h; const dir = o.dir || 1; const run = o.run ? Math.sin(t * 14) : 0; const bob = o.run ? Math.abs(Math.sin(t * 14)) * s * 0.03 : Math.sin(t * 3) * s * 0.01;
  g.save(); g.translate(0, -bob);
  if (o.shadow !== false) { g.beginPath(); g.ellipse(x, y + bob, s * 0.26, s * 0.045, 0, 0, TAU); g.fillStyle = 'rgba(43,36,64,.18)'; g.fill(); }
  // boots + legs
  for (const k of [-1, 1]) {
    const lx = x + k * s * 0.1 + k * run * s * 0.05;
    g.beginPath(); g.moveTo(lx, y - s * 0.18); g.lineTo(lx, y - s * 0.05); ink(g, s * 0.07); g.beginPath(); g.moveTo(lx, y - s * 0.18); g.lineTo(lx, y - s * 0.05); g.lineWidth = s * 0.045; g.strokeStyle = '#6A4A33'; g.stroke();
    g.beginPath(); g.ellipse(lx + dir * s * 0.03, y - s * 0.035, s * 0.085, s * 0.045, 0, 0, TAU); fillInk(g, '#8B5E3C', Math.max(2, s * 0.018));
  }
  // coat
  g.beginPath(); g.moveTo(x - s * 0.17, y - s * 0.6); g.lineTo(x + s * 0.17, y - s * 0.6); g.lineTo(x + s * 0.25, y - s * 0.16);
  g.lineTo(x + s * 0.02, y - s * 0.2); g.lineTo(x - s * 0.02, y - s * 0.2); g.lineTo(x - s * 0.25, y - s * 0.16); g.closePath();
  fillInk(g, '#6B45A0', Math.max(2.5, s * 0.02));
  for (const by of [0.48, 0.36]) { circ(g, x - s * 0.06, y - s * by, s * 0.022); fillInk(g, '#F2C14E', 1.5); circ(g, x + s * 0.06, y - s * by, s * 0.022); fillInk(g, '#F2C14E', 1.5); }
  // arms
  const sh = { x: x + dir * s * 0.14, y: y - s * 0.55 };
  const hand = o.hand || { x: x + dir * s * 0.3, y: y - s * 0.4 + run * s * 0.03 };
  const back = { x: x - dir * s * 0.24, y: y - s * 0.42 - run * s * 0.03 };
  for (const [a, b] of [[{ x: x - dir * s * 0.14, y: y - s * 0.55 }, back], [sh, hand]]) {
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); ink(g, s * 0.085); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineWidth = s * 0.055; g.strokeStyle = '#6B45A0'; g.stroke();
    circ(g, b.x, b.y, s * 0.04); fillInk(g, '#9BCB7A', 2);
  }
  // scarf
  rrect(g, x - s * 0.2, y - s * 0.66, s * 0.4, s * 0.08, s * 0.03); fillInk(g, '#F2C14E', Math.max(2, s * 0.018));
  g.save(); rrect(g, x - s * 0.2, y - s * 0.66, s * 0.4, s * 0.08, s * 0.03); g.clip();
  for (let i = -2; i <= 2; i++) { g.fillStyle = '#A0703F'; g.fillRect(x + i * s * 0.09 - s * 0.018, y - s * 0.67, s * 0.036, s * 0.1); }
  g.restore();
  // head
  const hy = y - s * 0.84; const hr = s * 0.22;
  if (face) drawFaceDisc(g, face, x, hy, hr, '#7B4FB5', null, Math.max(2.5, s * 0.022));
  else drawGoblinHead(g, x, hy, hr, dir);
  g.restore();
}
function drawGoblinHead(g, x, y, r, dir) {
  for (const k of [-1, 1]) { g.beginPath(); g.moveTo(x + k * r * 0.7, y - r * 0.1); g.lineTo(x + k * r * 1.45, y - r * 0.45); g.lineTo(x + k * r * 0.8, y + r * 0.35); g.closePath(); fillInk(g, '#9BCB7A', 2.5); }
  circ(g, x, y, r * 0.85); fillInk(g, '#9BCB7A', 3);
  for (const k of [-1, 1]) { circ(g, x + k * r * 0.3 + dir * r * 0.05, y - r * 0.15, r * 0.09); g.fillStyle = INK; g.fill(); }
  g.beginPath(); g.ellipse(x - r * 0.3, y + r * 0.28, r * 0.32, r * 0.13, 0.3, 0, TAU); g.ellipse(x + r * 0.3, y + r * 0.28, r * 0.32, r * 0.13, -0.3, 0, TAU); g.fillStyle = '#3B2A26'; g.fill();
  circ(g, x + dir * r * 0.05, y + r * 0.1, r * 0.2); fillInk(g, '#F07A7A', 2.5);
  // top hat
  g.beginPath(); g.ellipse(x, y - r * 0.72, r * 1.05, r * 0.2, 0, 0, TAU); fillInk(g, '#5E3A8C', 3);
  rrect(g, x - r * 0.62, y - r * 1.6, r * 1.24, r * 0.9, r * 0.12); fillInk(g, '#6B45A0', 3);
  g.fillStyle = '#E25B5B'; g.fillRect(x - r * 0.6, y - r * 0.98, r * 1.2, r * 0.2);
  g.beginPath(); g.ellipse(x + r * 0.75, y - r * 1.3, r * 0.18, r * 0.5, 0.6, 0, TAU); fillInk(g, '#F08A5D', 2);
}
// Charli the puppy behind a wicker basket. Bottom centre (x, y), basket width w. Catch line: y - 0.36w.
function drawCharli(g, x, y, w, t, face, o = {}) {
  const lean = o.lean || 0; const sq = o.squash || 0;
  g.save(); g.translate(x, y); g.rotate(lean * 0.12); g.scale(1 + sq * 0.08, 1 - sq * 0.1);
  // tail
  const wag = Math.sin(t * 16) * 0.5;
  g.beginPath(); g.moveTo(-w * 0.3, -w * 0.4); g.quadraticCurveTo(-w * 0.55, -w * 0.62 + wag * w * 0.1, -w * 0.48 + wag * w * 0.08, -w * 0.8); ink(g, w * 0.1);
  g.beginPath(); g.moveTo(-w * 0.3, -w * 0.4); g.quadraticCurveTo(-w * 0.55, -w * 0.62 + wag * w * 0.1, -w * 0.48 + wag * w * 0.08, -w * 0.8); g.lineWidth = w * 0.06; g.strokeStyle = '#E9B85A'; g.stroke();
  // body
  g.beginPath(); g.ellipse(0, -w * 0.38, w * 0.34, w * 0.26, 0, 0, TAU); fillInk(g, '#F2C76E', 3);
  // head
  const hy = -w * 0.76; const hr = w * 0.27;
  if (face) drawFaceDisc(g, face, 0, hy, hr, '#F2B544', null, 3);
  else {
    for (const k of [-1, 1]) { g.beginPath(); g.ellipse(k * hr * 0.9, hy + hr * 0.15, hr * 0.32, hr * 0.62, k * 0.25, 0, TAU); fillInk(g, '#D99A3A', 3); }
    circ(g, 0, hy, hr * 0.9); fillInk(g, '#F2C76E', 3);
    for (const k of [-1, 1]) { circ(g, k * hr * 0.32, hy - hr * 0.1, hr * 0.1); g.fillStyle = INK; g.fill(); }
    g.beginPath(); g.ellipse(0, hy + hr * 0.18, hr * 0.16, hr * 0.11, 0, 0, TAU); g.fillStyle = INK; g.fill();
    g.beginPath(); g.ellipse(0, hy + hr * 0.45, hr * 0.12, hr * 0.16, 0, 0, TAU); fillInk(g, '#F28C9A', 2);
  }
  // basket
  const bw = w / 2; const bh = w * 0.36;
  g.beginPath(); g.moveTo(-bw, -bh); g.lineTo(bw, -bh); g.lineTo(bw * 0.8, 0); g.lineTo(-bw * 0.8, 0); g.closePath(); fillInk(g, '#E9B872', 3);
  g.save(); g.beginPath(); g.moveTo(-bw, -bh); g.lineTo(bw, -bh); g.lineTo(bw * 0.8, 0); g.lineTo(-bw * 0.8, 0); g.closePath(); g.clip();
  g.lineWidth = 2; g.strokeStyle = 'rgba(160,100,40,.6)';
  for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(-bw, -bh + (bh * i) / 4); g.lineTo(bw, -bh + (bh * i) / 4); g.stroke(); }
  for (let i = -4; i <= 4; i++) { g.beginPath(); g.moveTo((i * bw) / 4.5, -bh); g.lineTo((i * bw * 0.8) / 4.5, 0); g.stroke(); }
  g.restore();
  rrect(g, -bw - 4, -bh - 7, w + 8, 12, 6); fillInk(g, '#D9A05B', 3);
  for (const k of [-1, 1]) { circ(g, k * w * 0.26, -bh - 4, w * 0.075); fillInk(g, '#F2C76E', 2.5); }
  g.restore();
}
function drawBucket(g, x, y, s, rot) {
  g.save(); g.translate(x, y); g.rotate(rot);
  g.beginPath(); g.arc(0, -s * 0.42, s * 0.42, Math.PI, 0); ink(g, 3);
  g.beginPath(); g.moveTo(-s * 0.5, -s * 0.42); g.lineTo(s * 0.5, -s * 0.42); g.lineTo(s * 0.38, s * 0.45); g.lineTo(-s * 0.38, s * 0.45); g.closePath(); fillInk(g, '#9DD8F2', 3);
  rrect(g, -s * 0.54, -s * 0.5, s * 1.08, s * 0.16, s * 0.06); fillInk(g, '#7CC4E6', 3);
  circ(g, 0, s * 0.05, s * 0.1); g.fillStyle = '#FFFFFF'; g.fill();
  for (const k of [-1, 0, 1]) { circ(g, k * s * 0.1, -s * 0.09 + (k ? s * 0.03 : 0), s * 0.04); g.fillStyle = '#FFFFFF'; g.fill(); }
  g.restore();
}
// Grabble's fake shard: the same shape, but dull grey-purple with a tiny green Grabble smudge (thumbprint + mustache curl)
function drawFakeShard(g, x, y, s, rot = 0) {
  g.save(); g.translate(x, y); g.rotate(rot);
  const pts = [[0, -1], [0.62, -0.25], [0.4, 0.95], [-0.4, 0.95], [-0.62, -0.25]];
  g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px * s, py * s) : g.moveTo(px * s, py * s))); g.closePath();
  const gr = g.createLinearGradient(0, -s, 0, s); gr.addColorStop(0, '#C9C2D3'); gr.addColorStop(0.5, '#8E829F'); gr.addColorStop(1, '#9E8BA6');
  g.fillStyle = gr; g.fill(); ink(g, Math.max(2.5, s * 0.13));
  g.beginPath(); g.moveTo(-0.62 * s, -0.25 * s); g.lineTo(0.62 * s, -0.25 * s); g.moveTo(0, -s); g.lineTo(-0.2 * s, -0.25 * s); g.lineTo(0, 0.95 * s);
  g.moveTo(0, -s); g.lineTo(0.2 * s, -0.25 * s); g.lineWidth = Math.max(1.2, s * 0.06); g.strokeStyle = 'rgba(43,36,64,.4)'; g.stroke();
  g.beginPath(); g.ellipse(0.18 * s, 0.45 * s, 0.17 * s, 0.13 * s, 0.4, 0, TAU); g.fillStyle = 'rgba(127,176,105,.85)'; g.fill();
  g.beginPath(); g.moveTo(-0.3 * s, 0.12 * s); g.quadraticCurveTo(-0.15 * s, 0.25 * s, 0, 0.12 * s); g.quadraticCurveTo(0.15 * s, 0.25 * s, 0.3 * s, 0.12 * s);
  g.lineWidth = Math.max(1.5, s * 0.08); g.strokeStyle = 'rgba(59,42,38,.75)'; g.lineCap = 'round'; g.stroke();
  g.restore();
}
// Grabble's mouldy berry: grey-green, fuzzy spots
function drawRottenBerry(g, x, y, r, rot = 0) {
  g.save(); g.translate(x, y); g.rotate(rot);
  g.beginPath(); g.moveTo(0, r * 1.05);
  g.bezierCurveTo(-r * 1.2, r * 0.3, -r * 1.05, -r * 0.85, 0, -r * 0.62);
  g.bezierCurveTo(r * 1.05, -r * 0.85, r * 1.2, r * 0.3, 0, r * 1.05); g.closePath();
  fillInk(g, '#8FA27A', Math.max(2.5, r * 0.1));
  for (const [sx, sy, sr] of [[-0.35, -0.15, 0.22], [0.3, 0.1, 0.28], [-0.05, 0.5, 0.18], [0.25, -0.35, 0.14]]) { circ(g, sx * r, sy * r, sr * r); g.fillStyle = 'rgba(220,226,200,.85)'; g.fill(); }
  g.beginPath(); for (let i = 0; i < 4; i++) { const a = -Math.PI / 2 + ((i - 1.5) * Math.PI) / 5; g.moveTo(0, -r * 0.62); g.lineTo(Math.cos(a) * r * 0.45, -r * 0.62 + Math.sin(a) * r * 0.25 + r * 0.05); }
  g.lineWidth = Math.max(3, r * 0.16); g.strokeStyle = '#6E6650'; g.lineCap = 'round'; g.stroke();
  g.restore();
}
function drawBerry(g, x, y, r, rot = 0) {
  g.save(); g.translate(x, y); g.rotate(rot);
  g.beginPath(); g.moveTo(0, r * 1.05);
  g.bezierCurveTo(-r * 1.2, r * 0.3, -r * 1.05, -r * 0.85, 0, -r * 0.62);
  g.bezierCurveTo(r * 1.05, -r * 0.85, r * 1.2, r * 0.3, 0, r * 1.05); g.closePath();
  fillInk(g, '#F2545B', Math.max(2.5, r * 0.1));
  g.fillStyle = '#FFE9A0';
  for (const [sx, sy] of [[-0.38, -0.2], [0.05, -0.28], [0.4, -0.15], [-0.22, 0.2], [0.22, 0.24], [0, 0.6]]) { g.beginPath(); g.ellipse(sx * r, sy * r, r * 0.07, r * 0.11, 0, 0, TAU); g.fill(); }
  g.beginPath();
  for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + ((i - 2) * Math.PI) / 5.5; g.moveTo(0, -r * 0.62); g.quadraticCurveTo(Math.cos(a) * r * 0.25, -r * 0.62 + Math.sin(a) * r * 0.25 - r * 0.1, Math.cos(a) * r * 0.55, -r * 0.62 + Math.sin(a) * r * 0.3); }
  g.lineWidth = Math.max(4, r * 0.22); g.strokeStyle = INK; g.lineCap = 'round'; g.stroke(); g.lineWidth = Math.max(2, r * 0.12); g.strokeStyle = '#6CC46A'; g.stroke();
  g.restore();
}
function drawNetHoop(g, x, y, r, rot, glow, t) {
  g.save(); g.translate(x, y); g.rotate(rot);
  if (glow) {
    const p = 0.6 + 0.4 * Math.sin(t * 18);
    const rg = g.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 2.1); rg.addColorStop(0, `rgba(255,226,122,${0.75 * p})`); rg.addColorStop(1, 'rgba(255,226,122,0)');
    g.fillStyle = rg; g.fillRect(-r * 2.2, -r * 2.2, r * 4.4, r * 4.4);
  }
  g.beginPath(); g.ellipse(0, 0, r, r * 0.8, 0, 0, TAU); g.fillStyle = 'rgba(255,255,255,.35)'; g.fill();
  g.save(); g.beginPath(); g.ellipse(0, 0, r, r * 0.8, 0, 0, TAU); g.clip();
  g.lineWidth = 1.5; g.strokeStyle = 'rgba(43,36,64,.45)';
  for (let i = -4; i <= 4; i++) { g.beginPath(); g.moveTo(i * r * 0.25 - r, -r); g.lineTo(i * r * 0.25 + r, r); g.stroke(); g.beginPath(); g.moveTo(i * r * 0.25 + r, -r); g.lineTo(i * r * 0.25 - r, r); g.stroke(); }
  g.restore();
  g.beginPath(); g.ellipse(0, 0, r, r * 0.8, 0, 0, TAU); g.lineWidth = r * 0.22; g.strokeStyle = INK; g.stroke();
  g.lineWidth = r * 0.12; g.strokeStyle = glow ? '#FFE27A' : '#A0703F'; g.stroke();
  g.restore();
}
function drawBell(g, x, y, s, swing) {
  g.save(); g.translate(x, y - s * 0.55); g.rotate(swing); g.translate(0, s * 0.55);
  g.beginPath(); g.moveTo(0, -s * 0.62); g.lineTo(0, -s * 0.5); ink(g, s * 0.07);
  g.beginPath();
  g.moveTo(-s * 0.08, -s * 0.52); g.quadraticCurveTo(-s * 0.36, -s * 0.48, -s * 0.36, -s * 0.12); g.lineTo(-s * 0.36, s * 0.12);
  g.lineTo(-s * 0.5, s * 0.3); g.lineTo(s * 0.5, s * 0.3); g.lineTo(s * 0.36, s * 0.12); g.lineTo(s * 0.36, -s * 0.12);
  g.quadraticCurveTo(s * 0.36, -s * 0.48, s * 0.08, -s * 0.52); g.closePath();
  const gr = g.createLinearGradient(-s * 0.4, 0, s * 0.4, 0); gr.addColorStop(0, '#FFE48F'); gr.addColorStop(1, '#F2C14E');
  g.fillStyle = gr; g.fill(); ink(g, Math.max(3, s * 0.035));
  g.beginPath(); g.moveTo(-s * 0.22, -s * 0.05); g.quadraticCurveTo(-s * 0.22, -s * 0.34, -s * 0.05, -s * 0.4); g.lineWidth = s * 0.05; g.strokeStyle = '#FFF6E0'; g.lineCap = 'round'; g.stroke();
  g.beginPath(); g.arc(0, s * 0.32, s * 0.1, 0, Math.PI); fillInk(g, '#E3A93B', Math.max(3, s * 0.035));
  g.restore();
}

// ------------------------------------------------------------------ particles + floating words
function makeFx() {
  const parts = []; const words = [];
  return {
    burst(x, y, o = {}) {
      const n = o.n ?? 14;
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU); const sp = rand(0.35, 1) * (o.speed ?? 220);
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.up ?? 60), g: o.gravity ?? 380, life: 0, max: rand(0.55, 1) * (o.life ?? 0.9), r: rand(0.6, 1.2) * (o.r ?? 7), c: pick(o.colors ?? SPARK), kind: o.kind ?? 'star', rot: rand(0, TAU), vr: rand(-6, 6) });
      }
    },
    word(x, y, text, color = '#FFE27A', size = 40) { words.push({ x, y, text, color, size, life: 0, max: 1.0 }); },
    confetti(W) {
      for (let i = 0; i < 70; i++) parts.push({ x: Math.random() * W, y: -20 - Math.random() * 200, vx: rand(-40, 40), vy: rand(60, 220), g: 140, life: 0, max: rand(2, 3), r: rand(4, 8), c: pick(CONF), kind: 'rect', rot: rand(0, TAU), vr: rand(-6, 6) });
    },
    update(dt) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]; p.life += dt;
        if (p.life >= p.max) { parts.splice(i, 1); continue; }
        p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      }
      for (let i = words.length - 1; i >= 0; i--) { const w = words[i]; w.life += dt; w.y -= 34 * dt; if (w.life >= w.max) words.splice(i, 1); }
    },
    draw(g) {
      for (const p of parts) {
        g.globalAlpha = clamp(1 - (p.life - p.max * 0.6) / (p.max * 0.4), 0, 1);
        if (p.kind === 'star') { sparklePath(g, p.x, p.y, p.r, p.rot); g.fillStyle = p.c; g.fill(); if (p.r > 5) { g.lineWidth = 1.5; g.strokeStyle = INK; g.stroke(); } }
        else if (p.kind === 'rect') { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = p.c; g.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); g.lineWidth = 1.3; g.strokeStyle = INK; g.strokeRect(-p.r, -p.r / 2, p.r * 2, p.r); g.restore(); }
        else if (p.kind === 'petal') { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.beginPath(); g.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, TAU); g.fillStyle = p.c; g.fill(); g.lineWidth = 1.3; g.strokeStyle = INK; g.stroke(); g.restore(); }
        else { circ(g, p.x, p.y, p.r * 0.6); g.fillStyle = p.c; g.fill(); }
      }
      g.globalAlpha = 1;
      for (const w of words) {
        const k = w.life / w.max; const sc = k < 0.2 ? Math.max(0.01, easeOutBack(k / 0.2)) : 1; const a = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
        drawWord(g, w.x, w.y, w.text, w.color, w.size, a, sc);
      }
    },
  };
}

// ------------------------------------------------------------------ the games
// A game is a factory (api) -> { duration, pips, init(), resize(), update(dt,t), draw(g,t,phase),
//   down/move/up(x,y,e), score(), progress(), result(score), timeUp() }.
const GAMES = {};

// ---- Flappy Flight: tap to flap through 8 flower-ring gates over the rooftops (12 s). Rim flowers = tumble.
GAMES.flight = (api) => {
  const cfg = api.cfg; const DUR = cfg.duration; const N = cfg.rings;
  const STEP = (DUR - 2.9) / Math.max(1, N - 1); // first hoop arrives at 1.9 s, the last ~1 s before the end
  const st = { cam: 0, rings: 0, gates: [], hero: null, tumble: 0, wing: 0, flaps: 0, trail: [], trailT: 0 };
  let A, top, bottom, roofH, speed, G, FLAP, MAXF;
  const heroId = api.hero.id;
  // the player's own hero flies (two-frame side-view sprites fly_<id>_up / fly_<id>_down, facing right)
  const TRAIL = { kyah: 'petal', ayva: 'note', poodle: 'bubble', misssuds: 'bubble', pup: 'sparkle', baker: 'flour' }[heroId] || 'sparkle';
  function layout() {
    roofH = clamp(api.H * 0.15, 76, 124);
    top = api.top + 2; bottom = api.H - roofH * 0.55;
    A = bottom - top;
    speed = clamp(api.W * 0.38, 130, 215) * (cfg.speed || 1);
    G = A * 0.95; FLAP = -A * 0.42; MAXF = A * 0.42; // floaty: slow falls are easy to catch
  }
  function init() {
    layout();
    const r = clamp(A * 0.06, 20, 34);
    st.cam = 0; st.rings = 0; st.tumble = 0; st.gates = []; st.flaps = 0; st.trail = [];
    st.hero = { x: api.W * 0.27, y: top + A * 0.45, vy: 0, r, rot: 0 };
    // a hero who never taps just bounces on the rooftops: the lower rim flower must sit above that bounce
    // (bounce apex = bottom - r - v²/2G with v = 0.8·FLAP) with room to spare, so no-input never crashes or scores
    const bounceTop = bottom - r - Math.pow(0.8 * FLAP, 2) / (2 * G);
    let prev = top + A * 0.48;
    for (let k = 0; k < N; k++) {
      const kr = 14; const safe = r * 0.55 + kr + 10;
      let gap = Math.max(A * 0.42 * (cfg.gap || 1) * (1 - (0.06 * k) / Math.max(1, N - 1)), r * 5.2);
      gap = Math.min(gap, Math.max(r * 4, bounceTop - safe - (top + A * 0.07))); // short screens: shrink before overlapping
      const lo = top + gap / 2 + A * 0.07; const hi = Math.max(lo, bounceTop - safe - gap / 2);
      // heightVar: how far a hoop's height can jump from the previous one (fraction of the playable height)
      const hv = cfg.heightVar ?? 0.15; const jump = rand(0.35, 1) * hv * A;
      const cy = k === 0 ? clamp(prev, lo, hi) : clamp(prev + (prev + jump > hi ? -1 : prev - jump < lo ? 1 : (Math.random() < 0.5 ? -1 : 1)) * jump, lo, hi);
      prev = cy;
      st.gates.push({ x: st.hero.x + speed * (1.9 + k * STEP), cy, gap, kr: Math.min(kr, clamp(gap * 0.06, 8, 14)), passed: false, got: false, flash: 0 });
    }
  }
  // sprite drawn at ~22% of the canvas height; the collision circle (0.55·r) stays on the body only
  const spriteSize = () => (api.img(`fly_${heroId}_up`) ? clamp(api.H * 0.22, 110, 220) : st.hero.r * 2);
  function drawTrail(g, p) {
    const a = clamp(1 - p.life / p.max, 0, 1); g.globalAlpha = a; const s = p.s;
    if (TRAIL === 'petal') { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.beginPath(); g.ellipse(0, 0, 8 * s, 4.5 * s, 0, 0, TAU); g.fillStyle = p.c; g.fill(); g.lineWidth = 1.5; g.strokeStyle = INK; g.stroke(); g.restore(); }
    else if (TRAIL === 'note') { g.save(); g.translate(p.x, p.y); g.rotate(p.rot * 0.15); g.font = `700 ${Math.round(24 * s)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 4; g.strokeStyle = INK; g.strokeText('♪', 0, 0); g.fillStyle = p.c; g.fillText('♪', 0, 0); g.restore(); }
    else if (TRAIL === 'bubble') { circ(g, p.x, p.y, 7 * s); g.fillStyle = 'rgba(255,255,255,.55)'; g.fill(); g.lineWidth = 1.8; g.strokeStyle = 'rgba(110,143,224,.8)'; g.stroke(); circ(g, p.x - 2.5 * s, p.y - 2.5 * s, 1.8 * s); g.fillStyle = '#fff'; g.fill(); }
    else if (TRAIL === 'flour') { circ(g, p.x, p.y, 3.5 * s); g.fillStyle = '#FFF6E0'; g.fill(); if (p.s > 1) { sparklePath(g, p.x, p.y, 6 * s, p.rot); g.fillStyle = '#FFE9A8'; g.fill(); } }
    else { sparklePath(g, p.x, p.y, 7 * s, p.rot); g.fillStyle = p.c; g.fill(); g.lineWidth = 1.2; g.strokeStyle = INK; g.stroke(); }
    g.globalAlpha = 1;
  }
  function crash(kx, ky) {
    const h = st.hero; st.tumble = 0.001; h.vy = -A * 0.32;
    api.snd('bonk'); api.buzz([80, 40, 140]); api.shake(10, 0.4);
    api.fx.word(h.x + 10, h.y - h.r - 30, 'BUMP!', '#F2C9A0', 42);
    api.fx.burst(kx, ky, { n: 12, colors: ['#F7B6D6', '#FFFFFF', '#A8E0B8'], kind: 'petal', speed: 200 });
  }
  function drawRoofs(g) {
    const unit = 104; const W = api.W; const H = api.H;
    const i0 = Math.floor(st.cam / unit) - 1; const i1 = Math.floor((st.cam + W) / unit) + 1;
    const walls = ['#FFF6E0', '#F9DCEB', '#DCEFF8', '#E5F4DE']; const roofs = ['#3E6FD6', '#6E8FE0', '#F29BC8', '#B48BE0'];
    for (let i = i0; i <= i1; i++) {
      const r1 = hash(i), r2 = hash(i + 99), r3 = hash(i * 7 + 3);
      const w = unit * (0.84 + r1 * 0.28); const x = i * unit - st.cam + (r2 - 0.5) * 14;
      const wallH = roofH * (0.5 + r2 * 0.3); const wy = H - wallH;
      rrect(g, x, wy, w, wallH + 10, 4); fillInk(g, walls[(r3 * 4) | 0], 3);
      g.beginPath(); g.moveTo(x - 7, wy + 2); g.lineTo(x + w / 2, wy - roofH * 0.42 * (0.75 + r1 * 0.45)); g.lineTo(x + w + 7, wy + 2); g.closePath(); fillInk(g, roofs[(r1 * 4) | 0], 3);
      rrect(g, x + w * 0.3, wy + wallH * 0.25, w * 0.4, wallH * 0.35, 6); fillInk(g, '#FFE9A8', 2.5);
      g.beginPath(); g.moveTo(x + w * 0.5, wy + wallH * 0.25); g.lineTo(x + w * 0.5, wy + wallH * 0.6); ink(g, 2);
    }
  }
  // ---- the gates are 3D hoops seen slightly from the side: a perspective ellipse (rx = 0.52 ry) with a small
  // tilt. The far (left) half is drawn before the flyer and the near (right) half after it, so the flyer
  // visibly goes THROUGH. The rim flowers at the top and bottom of the hoop are the only things that bump you.
  const TILT = 0.1; const SQUASH = 0.52;
  const knots = (gt, sx) => { const ry = gt.gap / 2; return [{ x: sx + Math.sin(TILT) * ry, y: gt.cy - Math.cos(TILT) * ry }, { x: sx - Math.sin(TILT) * ry, y: gt.cy + Math.cos(TILT) * ry }]; };
  const popScale = (gt) => (gt.pop > 0 ? 1 + 0.15 * Math.sin(Math.PI * (1 - gt.pop / 0.25)) : 1);
  const wreathCache = new Map(); // tinted copies of the wreath art: 'back' a touch darker, 'front' a touch brighter
  function wreath(img, kind) {
    const key = kind; if (wreathCache.has(key) && wreathCache.get(key).src === img) return wreathCache.get(key).c;
    const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
    x.drawImage(img, 0, 0, 256, 256); x.globalCompositeOperation = 'source-atop';
    x.fillStyle = kind === 'back' ? 'rgba(43,36,64,.3)' : 'rgba(255,255,255,.14)'; x.fillRect(0, 0, 256, 256);
    wreathCache.set(key, { src: img, c }); return c;
  }
  function drawGate(g, gt, half) {
    const sx = gt.x - st.cam; if (sx < -140 || sx > api.W + 140) return;
    const ry = gt.gap / 2; const rx = ry * SQUASH; const k = popScale(gt); const missed = gt.passed && !gt.got;
    const ringImg = api.img('mini_ring_flower');
    if (half === 'back') {
      // stem down to the roofs + a soft glow filling the hoop
      const kb = knots(gt, sx)[1];
      g.beginPath(); g.moveTo(kb.x, kb.y); g.quadraticCurveTo(kb.x - 10, (kb.y + api.H) / 2, kb.x + 4, api.H); ink(g, 7);
      g.beginPath(); g.moveTo(kb.x, kb.y); g.quadraticCurveTo(kb.x - 10, (kb.y + api.H) / 2, kb.x + 4, api.H); g.lineWidth = 4; g.strokeStyle = '#7FB069'; g.stroke();
      if (!gt.passed || gt.flash > 0) {
        const a = gt.flash > 0 ? 0.75 * (gt.flash / 0.6) + 0.15 : 0.3;
        g.save(); g.translate(sx, gt.cy); g.rotate(TILT); g.scale(SQUASH, 1);
        const rg = g.createRadialGradient(0, 0, 0, 0, 0, ry); rg.addColorStop(0, `rgba(255,240,170,${a})`); rg.addColorStop(1, 'rgba(255,240,170,0)');
        g.beginPath(); g.arc(0, 0, ry * 0.9, 0, TAU); g.fillStyle = rg; g.fill(); g.restore();
      }
    }
    g.save(); g.translate(sx, gt.cy); g.rotate(TILT);
    const sc = k * (half === 'front' ? 1.05 : 0.97); g.scale(sc, sc);
    g.globalAlpha = missed ? 0.55 : 1;
    // clip to this half (far = left of the hoop's axis, near = right)
    g.beginPath(); if (half === 'back') g.rect(-rx * 2.2, -ry * 2, rx * 2.2, ry * 4); else g.rect(0, -ry * 2, rx * 2.2, ry * 4); g.clip();
    if (ringImg) {
      // the wreath's flower band spans ~0.2-0.46 of the image size; scaled so the rim flowers (±ry) sit on its outer part
      const D = ry * 2 * 1.2; g.scale(SQUASH, 1);
      g.drawImage(wreath(ringImg, half), -D / 2, -D / 2, D, D);
    } else {
      const band = Math.max(10, gt.gap * 0.11);
      const col = gt.flash > 0 ? '#FFE27A' : (missed ? '#DCD5E2' : (half === 'back' ? '#D98AB8' : '#F7B6D6'));
      g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, TAU); g.lineWidth = band + 7; g.strokeStyle = INK; g.stroke(); g.lineWidth = band; g.strokeStyle = col; g.stroke();
      const n = 14;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU; const fx = Math.cos(a) * rx; const fy = Math.sin(a) * ry;
        if ((half === 'back') !== (fx < 0)) continue;
        drawFlower(g, fx, fy, band * 0.62, i % 2 ? (half === 'back' ? '#9FC4E8' : '#BFE3F5') : (half === 'back' ? '#E9A8CB' : '#FFD1E6'), { lw: 1.5 });
      }
    }
    g.restore();
    if (half === 'front') { // the two rim flowers (top and bottom) are the "edge" that bumps you; they also hide the seam
      for (const kp of knots(gt, sx)) drawFlower(g, sx + (kp.x - sx) * k, gt.cy + (kp.y - gt.cy) * k, gt.kr * 1.1, missed ? '#E4DCEA' : '#F29BC8');
    }
  }
  init();
  return {
    duration: DUR, pips: N, art: ['mini_bg_flight', 'mini_ring_flower', `fly_${heroId}_up`, `fly_${heroId}_down`], __st: () => ({ ...st, A }),
    resize() { if (!api.started) init(); else layout(); },
    update(dt) {
      const h = st.hero;
      st.wing = Math.max(0, st.wing - dt);
      // the hero's trail: drifts back with the world and fades
      for (const p of st.trail) { p.life += dt; p.x += (p.vx - (st.tumble > 0 ? 0 : speed)) * dt; p.y += p.vy * dt; p.rot += p.vr * dt; }
      st.trail = st.trail.filter((p) => p.life < p.max);
      st.trailT -= dt;
      if (st.trailT <= 0 && st.tumble === 0) {
        st.trailT = TRAIL === 'note' ? 0.16 : 0.07;
        const sz = spriteSize();
        st.trail.push({ x: h.x - sz * 0.28, y: h.y + rand(-0.1, 0.12) * sz, vx: rand(-20, 10), vy: TRAIL === 'bubble' ? rand(-40, -15) : rand(-15, 25), life: 0, max: rand(0.6, 1.0), s: rand(0.7, 1.2), rot: rand(0, TAU), vr: rand(-3, 3), c: pick(TRAIL === 'petal' ? ['#F7B6D6', '#9DB8F5', '#FFFFFF'] : TRAIL === 'note' ? ['#E86BB5', '#B48BE0', '#6E8FE0'] : ['#FFE27A', '#FFFFFF', '#BFE3F5']) });
      }
      for (const gt of st.gates) { gt.flash = Math.max(0, gt.flash - dt); gt.pop = Math.max(0, (gt.pop || 0) - dt); }
      if (st.tumble > 0) {
        st.tumble += dt; h.vy = Math.min(h.vy + G * dt, MAXF * 1.5); h.y = Math.min(h.y + h.vy * dt, api.H - roofH * 0.4); h.rot += 10 * dt;
        if (st.tumble > 1.15) api.end();
        return;
      }
      st.cam += speed * dt;
      h.vy = Math.min(h.vy + G * dt, MAXF); h.y += h.vy * dt;
      if (h.y - h.r < top) { h.y = top + h.r; h.vy = Math.max(0, h.vy); }
      if (h.y + h.r > bottom) { h.y = bottom - h.r; h.vy = FLAP * 0.8; api.snd('boing'); api.fx.burst(h.x, h.y + h.r, { n: 6, colors: ['#C9B9A3', '#FFFFFF'], speed: 90, kind: 'dot', r: 5 }); }
      h.rot = clamp(h.vy / (A * 1.4), -0.45, 0.5);
      const hb = h.r * 0.55;
      for (const gt of st.gates) {
        const sx = gt.x - st.cam;
        if (sx < h.x - 120 || sx > h.x + 120) continue;
        // only the rim flowers of a gate you have not passed yet can bump you (once through, you're through)
        if (!gt.passed) for (const kp of knots(gt, sx)) {
          if (Math.hypot(kp.x - h.x, kp.y - h.y) < gt.kr + hb) { crash(kp.x, kp.y); return; }
        }
        if (!gt.passed && sx < h.x) {
          gt.passed = true;
          if (st.flaps > 0 && Math.abs(h.y - gt.cy) < gt.gap / 2) {
            gt.got = true; gt.flash = 0.6; gt.pop = 0.25; st.rings++; api.setPips(st.rings); api.snd('ring'); api.buzz(20);
            api.fx.burst(sx, gt.cy, { n: 20, speed: gt.gap * 0.55, gravity: 40, up: 0, life: 0.7, r: 7 }); // sparkles inside the hoop
            api.fx.word(sx + 20, gt.cy - gt.gap / 2 - 22, '+1', '#FFE27A', 34);
          } else api.snd('puff');
        }
      }
      const last = st.gates[N - 1];
      if (last.passed && last.x - st.cam < h.x - 70) api.end();
    },
    down() {
      if (st.tumble > 0) return;
      st.hero.vy = FLAP; st.wing = 0.3; st.flaps++; api.snd('flap'); api.buzz(8);
      api.fx.burst(st.hero.x - st.hero.r * 0.6, st.hero.y + st.hero.r * 0.4, { n: 3, colors: ['#FFFFFF', '#BFE3F5'], speed: 60, kind: 'dot', r: 5, gravity: 50 });
    },
    draw(g, t) {
      const W = api.W, H = api.H;
      const bg = api.img('mini_bg_flight');
      if (bg) drawCover(g, bg, W, H, 0, 1, st.cam * 0.12);
      else paper(g, W, H, '#A9D8F2', '#FFF6E0', [[0.85, 0.12, 0.25, 'rgba(255,255,255,.55)']]);
      // far hills + castle
      const off = st.cam * 0.15;
      if (!bg) {
      g.beginPath(); g.moveTo(-10, H);
      for (let x = -10; x <= W + 10; x += 12) g.lineTo(x, H - roofH * 1.25 - Math.sin((x + off) * 0.012) * 16 - Math.sin((x + off) * 0.031) * 8);
      g.lineTo(W + 10, H); g.closePath(); g.fillStyle = '#CFE8C8'; g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(43,36,64,.25)'; g.stroke();
      const cx = mod(W * 0.78 - off, W + 300) - 100; const cy = H - roofH * 1.3;
      for (const [dx, hh] of [[-26, 46], [0, 64], [26, 46]]) { g.fillStyle = '#F2EEF8'; g.fillRect(cx + dx - 10, cy - hh, 20, hh); g.beginPath(); g.moveTo(cx + dx - 13, cy - hh); g.lineTo(cx + dx, cy - hh - 22); g.lineTo(cx + dx + 13, cy - hh); g.closePath(); g.fillStyle = '#7F9FE6'; g.fill(); }
      for (let i = 0; i < 5; i++) cloud(g, mod(i * 170 + 60 - st.cam * 0.4, W + 260) - 130, top + 26 + ((i * 53) % 130), 26 + (i % 3) * 9);
      }
      drawRoofs(g);
      for (const gt of st.gates) drawGate(g, gt, 'back');
      // the flyer: the player's own hero (sprite frames, or the drawn face-with-wings fallback) + her trail
      const h = st.hero;
      for (const p of st.trail) drawTrail(g, p);
      const up = api.img(`fly_${heroId}_up`); const down = api.img(`fly_${heroId}_down`);
      g.save(); g.translate(h.x, h.y); g.rotate(h.rot);
      if (up && down) {
        // a flap shows the down-stroke, then the up-stroke; gliding flaps slowly on its own
        const frame = st.wing > 0 ? (st.wing > 0.15 ? down : up) : (Math.floor(t / 0.4) % 2 ? up : down);
        const sz = spriteSize();
        g.drawImage(frame, -sz / 2, -sz / 2, sz, sz);
      } else {
        const flap = st.wing > 0 ? Math.sin(((0.3 - st.wing) / 0.3) * Math.PI) : Math.sin(t * 7) * 0.25;
        g.save(); g.translate(-h.r * 0.3, -h.r * 0.15); g.rotate(-0.95 - flap * 0.75); g.beginPath(); g.ellipse(0, -h.r * 0.72, h.r * 0.42, h.r * 0.8, 0, 0, TAU); fillInk(g, 'rgba(191,227,245,.96)', 3); g.restore();
        g.save(); g.translate(-h.r * 0.3, h.r * 0.1); g.rotate(-2.15 + flap * 0.5); g.beginPath(); g.ellipse(0, -h.r * 0.6, h.r * 0.34, h.r * 0.62, 0, 0, TAU); fillInk(g, 'rgba(247,195,221,.96)', 3); g.restore();
        drawFaceDisc(g, api.face(api.hero.id), 0, 0, h.r, api.hero.color, (api.hero.name || '?')[0]);
      }
      g.restore();
      for (const gt of st.gates) drawGate(g, gt, 'front');
    },
    score: () => st.rings,
    progress: () => clamp(api.t / DUR, 0, 1),
    result(s) {
      if (s >= Math.ceil(N / 2)) return { word: 'WOW!', line: `${s} of ${N} rings! Off you fly!`, good: true };
      if (s >= 1) return { word: 'WHOOSH!', line: `${s} ring${s > 1 ? 's' : ''}! Off you fly!`, good: true };
      return { word: 'BUMP!', line: 'No rings this time. You stay here.', good: false };
    },
  };
};

// ---- Look under the flowers: 9 flowers; the real shard twinkles under one of them for cfg.window seconds
// (cfg.rounds rounds). On harder tiers Grabble's grey fakes peek out of other flowers too: tapping one ends the game.
GAMES.shard = (api) => {
  const cfg = api.cfg; const ROUNDS = cfg.rounds; const WIN = cfg.window; const GAP = 0.45;
  const COLORS = ['#F7B6D6', '#BFE3F5', '#CDB4F0', '#A8E0B8', '#FFD98A', '#F7B6D6', '#BFE3F5', '#CDB4F0', '#A8E0B8'];
  const st = { round: -1, phase: 'gap', timer: 0.5, cur: -1, fakes: [], caught: 0, wob: new Array(9).fill(0), pop: 0, flying: [], failed: false };
  const grid = () => {
    const y0a = api.top + 8; const h = api.H - y0a - 20;
    const size = Math.min(api.W - 20, h * 0.96, 480);
    return { x0: (api.W - size) / 2, y0: y0a + (h - size) / 2, size, cell: size / 3 };
  };
  const center = (i) => { const gd = grid(); return { x: gd.x0 + ((i % 3) + 0.5) * gd.cell, y: gd.y0 + (Math.floor(i / 3) + 0.5) * gd.cell, r: gd.cell * 0.34 }; };
  const flower = (g, x, y, r, i, o = {}) => {
    const img = api.img('mini_flower_tile');
    if (!img) { drawFlower(g, x, y, r, COLORS[i], o); return; }
    const s = r * 2.3 * (o.open ? 1.12 : 1);
    g.save(); g.translate(x, y); g.rotate((o.rot || 0) * 0.15 + (i % 3 - 1) * 0.12); g.drawImage(img, -s / 2, -s / 2, s, s); g.restore();
  };
  return {
    duration: ROUNDS * (WIN + GAP) + 1.5, pips: ROUNDS, art: ['mini_bg_garden', 'mini_flower_tile'], __st: () => ({ ...st, grid }),
    update(dt) {
      for (let i = 0; i < 9; i++) st.wob[i] = Math.max(0, st.wob[i] - dt);
      st.pop = Math.min(1, st.pop + dt * 4);
      st.flying = st.flying.filter((f) => (f.t += dt / 0.55) < 1);
      if (st.failed) return;
      st.timer -= dt;
      if (st.phase === 'gap' && st.timer <= 0) {
        st.round++;
        if (st.round >= ROUNDS) { st.phase = 'done'; st.timer = 0.35; return; }
        let i; do { i = (Math.random() * 9) | 0; } while (i === st.cur);
        st.cur = i; st.fakes = [];
        if (cfg.decoys > 0 && Math.random() < cfg.decoyChance) { // Grabble's fakes peek out of other flowers
          const n = 1 + Math.floor(Math.random() * cfg.decoys);
          const others = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((k) => k !== i).sort(() => Math.random() - 0.5);
          st.fakes = others.slice(0, n);
        }
        st.phase = 'twinkle'; st.timer = WIN; st.pop = 0; api.snd('twinkle'); api.buzz(10);
      } else if (st.phase === 'twinkle' && st.timer <= 0) {
        const c = center(st.cur); api.fx.burst(c.x, c.y - c.r * 0.3, { n: 8, colors: ['#DCD5E2', '#FFFFFF'], kind: 'dot', speed: 70 }); api.snd('puff');
        st.phase = 'gap'; st.timer = GAP; st.fakes = [];
      } else if (st.phase === 'done' && st.timer <= 0) api.end();
    },
    down(x, y) {
      if (st.failed) return;
      const gd = grid(); const cx = Math.floor((x - gd.x0) / gd.cell); const cy = Math.floor((y - gd.y0) / gd.cell);
      if (cx < 0 || cx > 2 || cy < 0 || cy > 2) return;
      const i = cy * 3 + cx;
      if (st.phase === 'twinkle' && i === st.cur) {
        st.caught++; api.setPips(st.caught);
        const c = center(i);
        api.fx.burst(c.x, c.y - c.r * 0.5, { n: 18 }); api.fx.word(c.x, c.y - c.r * 1.2, 'TING!', '#FFE27A', 36);
        st.flying.push({ x: c.x, y: c.y - c.r * 0.6, t: 0 });
        api.snd('ring'); api.buzz(25);
        st.phase = 'gap'; st.timer = GAP; st.fakes = [];
      } else if (st.phase === 'twinkle' && st.fakes.includes(i)) { // Grabble's fake: the game ends at once
        st.failed = true; const c = center(i);
        api.snd('caught'); api.buzz([120, 60, 160]); api.shake(8, 0.35);
        api.fx.burst(c.x, c.y - c.r * 0.4, { n: 14, colors: ['#9A90A8', '#7FB069', '#5E5470'], kind: 'dot', speed: 160 });
        api.fx.word(c.x, c.y - c.r * 1.2, 'FAKE!', '#CDB4F0', 40);
        setTimeout(() => api.fail({ word: 'OH NO!', line: "That was Grabble's fake!" }), 500);
      } else { st.wob[i] = 0.35; api.snd('boop'); }
    },
    draw(g, t) {
      const bg = api.img('mini_bg_garden');
      if (bg) { drawCover(g, bg, api.W, api.H); wash(g, api.W, api.H, 'rgba(255,246,224,.55)'); }
      else paper(g, api.W, api.H, '#EAF6E4', '#FFF6E0', [[0.1, 0.2, 0.35, 'rgba(191,227,245,.7)'], [0.95, 0.9, 0.35, 'rgba(247,182,214,.45)']]);
      const gd = grid(); rrect(g, gd.x0 - 6, gd.y0 - 6, gd.size + 12, gd.size + 12, 28); g.fillStyle = 'rgba(255,255,255,.55)'; g.fill(); ink(g, 3);
      for (let i = 0; i < 9; i++) {
        const c = center(i); const live = st.phase === 'twinkle' && i === st.cur; const fake = st.phase === 'twinkle' && st.fakes.includes(i);
        const wob = st.wob[i] > 0 ? Math.sin(st.wob[i] * 45) * st.wob[i] * 14 : 0;
        g.beginPath(); g.ellipse(c.x, c.y + c.r * 0.95, c.r * 1.25, c.r * 0.38, 0, 0, TAU); fillInk(g, '#BFE6B0', 2.5);
        if (live || fake) {
          const k = st.timer / WIN; const pulse = 0.75 + 0.25 * Math.sin(t * 16 + i);
          const glowC = live ? '255,232,140' : '214,204,232';
          const rg = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r * 1.75); rg.addColorStop(0, `rgba(${glowC},${0.9 * pulse})`); rg.addColorStop(1, `rgba(${glowC},0)`);
          g.fillStyle = rg; g.fillRect(c.x - c.r * 1.8, c.y - c.r * 1.8, c.r * 3.6, c.r * 3.6);
          g.beginPath(); g.arc(c.x, c.y, c.r * 1.38, -Math.PI / 2, -Math.PI / 2 + TAU * k); g.lineWidth = 11; g.strokeStyle = INK; g.lineCap = 'round'; g.stroke(); g.lineWidth = 6; g.strokeStyle = '#F2C14E'; g.stroke();
          const lift = easeOutBack(st.pop);
          flower(g, c.x + wob + c.r * 0.45 * lift, c.y + c.r * 0.35 * lift, c.r * 0.8, i, { open: 1, rot: 1.6 * lift + Math.sin(t * 8) * 0.3 });
          drawShard(g, c.x - c.r * 0.2 * lift, c.y - c.r * 0.4 * lift, c.r * 0.72 * (0.6 + 0.4 * lift), Math.sin(t * 6 + i) * 0.15, live, fake);
          if (live) for (let s = 0; s < 3; s++) { const a = t * 3 + (s * TAU) / 3; sparklePath(g, c.x + Math.cos(a) * c.r * 1.05, c.y - c.r * 0.3 + Math.sin(a) * c.r * 0.7, 7 + 3 * Math.sin(t * 10 + s), t * 2); g.fillStyle = '#FFFFFF'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = INK; g.stroke(); }
        } else flower(g, c.x + wob, c.y, c.r, i);
      }
      for (const f of st.flying) { const e = easeInOut(f.t); drawShard(g, lerp(f.x, 40, e), lerp(f.y, 36, e) - Math.sin(e * Math.PI) * 60, lerp(22, 10, e), e * 4); }
    },
    score: () => (st.failed ? 0 : st.caught),
    progress: () => (st.round < 0 ? 0 : clamp((st.round + (st.phase === 'twinkle' ? 1 - st.timer / WIN : 1)) / ROUNDS, 0, 1)),
    result(s) {
      if (s >= Math.ceil(ROUNDS * 0.7)) return { word: 'TING!', line: `${s} of ${ROUNDS} shards found! Sharp eyes!`, good: true };
      if (s >= 1) return { word: 'TING!', line: `${s} shard${s > 1 ? 's' : ''} found under the flowers!`, good: true };
      return { word: 'OH NO!', line: 'It got away… next time!', good: false };
    },
  };
};

// ---- Charli catches: drag Charli left/right; cfg.shards shards (and cfg.buckets buckets that only shake you)
// fall over cfg.duration seconds, getting faster up to ×(1 + cfg.accel); cfg.catchWidth scales Charli's catch box.
GAMES.fetch = (api) => {
  const cfg = api.cfg; const DUR = cfg.duration; const FALL = 2.25; const ACC = cfg.accel || 0;
  const speedAt = (t) => 1 + ACC * clamp(t / DUR, 0, 1);
  // the drop plan: shards and buckets interleaved, the first one always a shard, all landing before the end
  const total = cfg.shards + cfg.buckets; const lastSpawn = Math.max(0.3, DUR - FALL / (1 + ACC) - 0.35);
  const kinds = new Array(total).fill('shard');
  for (let j = 0; j < cfg.buckets; j++) kinds[clamp(Math.round(((j + 0.6) * total) / cfg.buckets), 1, total - 1)] = 'bucket';
  let nb = kinds.filter((k) => k === 'bucket').length; for (let i = total - 1; nb < cfg.buckets && i > 0; i--) if (kinds[i] === 'shard') { kinds[i] = 'bucket'; nb++; }
  const plan = kinds.map((k, i) => ({ t: 0.3 + (total > 1 ? (i * (lastSpawn - 0.3)) / (total - 1) : 0), k }));
  const st = { items: [], next: 0, caught: 0, dog: null, squash: 0, moved: false, lastX: null, side: Math.random() < 0.5 ? -1 : 1, face: 1 };
  const L = () => {
    const groundY = api.H - clamp(api.H * 0.06, 30, 54); const cw = cfg.catchWidth || 1;
    if (api.img('mini_pup_run')) { const bw = clamp(api.W * 0.4, 130, 200); return { bw, groundY, catchY: groundY - bw * 0.52, half: bw * 0.4 * cw, sprite: true }; }
    const bw = clamp(api.W * 0.32, 100, 160); return { bw, groundY, catchY: groundY - bw * 0.36 - 6, half: bw * 0.56 * cw, sprite: false };
  };
  function init() { const l = L(); st.dog = { x: api.W / 2, tx: api.W / 2, w: l.bw }; }
  function spawn(k, t) {
    const W = api.W; const l = L(); let x;
    if (k === 'shard') {
      const from = st.lastX ?? st.dog.x; st.side = -st.side;
      x = from + st.side * rand(0.3, 0.5) * W;
      if (x < W * 0.14 || x > W * 0.86) x = from - st.side * rand(0.3, 0.5) * W;
      x = clamp(x, W * 0.14, W * 0.86); st.lastX = x;
    } else {
      const shards = st.items.filter((it) => it.k === 'shard' && it.state === 'fall').map((it) => it.x).concat(st.lastX ?? []);
      for (let tries = 0; tries < 12; tries++) { x = rand(W * 0.14, W * 0.86); if (shards.every((sx) => Math.abs(sx - x) > W * 0.24)) break; }
    }
    const y0 = api.top * 0.5; const r = clamp(W * 0.075, 24, 34);
    st.items.push({ k, x, y: y0, prevY: y0, vy: ((l.catchY - y0) / FALL) * speedAt(t), r, rot: rand(-0.3, 0.3), vr: k === 'bucket' ? rand(-2.5, 2.5) : rand(-0.8, 0.8), state: 'fall', t: 0, vx: 0 });
  }
  init();
  return {
    duration: DUR + 0.6, pips: cfg.shards, art: ['mini_bg_petwash', 'mini_pup_run', 'mini_bucket'], __st: () => st,
    resize() { if (!api.started) init(); },
    update(dt, t) {
      while (st.next < plan.length && t >= plan[st.next].t) spawn(plan[st.next++].k, t);
      const l = L(); const d = st.dog; d.w = l.bw;
      const maxV = api.W * 2.6; d.x += clamp((d.tx - d.x) * 14 * dt, -maxV * dt, maxV * dt);
      if (Math.abs(d.tx - d.x) > 4) st.face = d.tx > d.x ? 1 : -1;
      st.squash = Math.max(0, st.squash - dt * 3);
      for (const it of st.items) {
        if (it.state === 'fall') {
          it.prevY = it.y; it.y += it.vy * dt; it.rot += it.vr * dt;
          if (it.prevY < l.catchY && it.y >= l.catchY && Math.abs(it.x - d.x) < l.half + it.r * 0.45) {
            if (it.k === 'shard') {
              it.state = 'in'; it.t = 0; st.caught++; api.setPips(st.caught); st.squash = 1;
              api.fx.burst(it.x, l.catchY, { n: 16 }); api.fx.word(it.x, l.catchY - d.w * 0.9, 'TING!', '#FFE27A', 36); api.snd('ring'); api.buzz(30);
            } else {
              it.state = 'bounce'; it.vy = -430; it.vx = (it.x < d.x ? -1 : 1) * rand(120, 200);
              api.shake(12, 0.4); api.snd('bonk'); api.buzz([60, 30, 90]); api.fx.word(d.x, l.catchY - d.w * 0.95, 'BUMP!', '#BFE3F5', 38);
            }
          }
          if (it.y > api.H + 50) it.state = 'gone';
        } else if (it.state === 'bounce') {
          it.vy += 1000 * dt; it.x += it.vx * dt; it.y += it.vy * dt; it.rot += 9 * dt; if (it.y > api.H + 60) it.state = 'gone';
        } else if (it.state === 'in') { it.t += dt; it.x = lerp(it.x, d.x, 0.3); if (it.t > 0.3) it.state = 'gone'; }
      }
      if (st.next >= plan.length && st.items.every((it) => it.state === 'gone' || it.state === 'bounce')) api.end();
    },
    down(x) { st.dog.tx = clamp(x, st.dog.w / 2, api.W - st.dog.w / 2); st.moved = true; },
    move(x) { st.dog.tx = clamp(x, st.dog.w / 2, api.W - st.dog.w / 2); st.moved = true; },
    draw(g, t) {
      const W = api.W, H = api.H; const l = L();
      const bg = api.img('mini_bg_petwash');
      if (bg) { drawCover(g, bg, W, H, 0.5, 1); wash(g, W, H, 'rgba(255,246,224,.22)'); }
      else {
        paper(g, W, H, '#CFEAF8', '#FFF6E0', [[0.15, 0.3, 0.3, 'rgba(255,255,255,.7)'], [0.9, 0.55, 0.3, 'rgba(247,182,214,.35)']]);
        for (let i = 0; i < 3; i++) cloud(g, mod(i * 160 + 50 + t * 10, W + 200) - 100, api.top + 30 + i * 40, 26 + i * 6);
      }
      for (let i = 0; i < 6; i++) { const bx = mod(i * 83 + t * 18 * (i % 2 ? 1 : -1), W); const by = H * 0.35 + ((i * 97) % (H * 0.35)) - mod(t * 22 + i * 40, 60); circ(g, bx, by, 7 + (i % 3) * 3); g.fillStyle = 'rgba(255,255,255,.55)'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = 'rgba(110,143,224,.45)'; g.stroke(); }
      if (!bg) grassBand(g, W, l.groundY - 6, H);
      for (const it of st.items) {
        if (it.state === 'gone') continue;
        if (it.k === 'shard') {
          if (it.state === 'fall') for (let k = 1; k <= 3; k++) { sparklePath(g, it.x + Math.sin(t * 9 + k) * 6, it.y - k * 16, 5 - k, t * 3); g.fillStyle = '#FFE27A'; g.fill(); }
          const s = it.state === 'in' ? it.r * (1 - it.t / 0.3) : it.r;
          if (it.state === 'fall') { circ(g, it.x, it.y, s * 1.55); g.fillStyle = `rgba(255,255,255,${0.55 + 0.25 * Math.sin(t * 10)})`; g.fill(); g.lineWidth = 3; g.strokeStyle = 'rgba(242,193,78,.9)'; g.stroke(); }
          drawShard(g, it.x, it.y, s, it.rot, it.state === 'fall');
        } else {
          const bi = api.img('mini_bucket');
          if (bi) { const s = it.r * 3.3; g.save(); g.translate(it.x, it.y); g.rotate(it.rot); g.drawImage(bi, -s / 2, -s / 2, s, s); g.restore(); }
          else drawBucket(g, it.x, it.y, it.r * 1.6, it.rot);
        }
      }
      const d = st.dog; const pup = api.img('mini_pup_run');
      if (pup) {
        const s = l.bw; const hop = Math.abs(Math.sin(t * (Math.abs(d.tx - d.x) > 4 ? 14 : 4))) * (Math.abs(d.tx - d.x) > 4 ? 8 : 2);
        g.beginPath(); g.ellipse(d.x, l.groundY + 2, s * 0.36, s * 0.07, 0, 0, TAU); g.fillStyle = 'rgba(43,36,64,.22)'; g.fill();
        g.save(); g.translate(d.x, l.groundY + s * 0.06 - hop); g.scale(st.face * (1 + st.squash * 0.08), 1 - st.squash * 0.1);
        g.drawImage(pup, -s / 2, -s, s, s); g.restore();
      } else drawCharli(g, d.x, l.groundY, d.w, t, api.face('pup'), { lean: clamp((d.tx - d.x) / 120, -1, 1), squash: st.squash });
      if (!st.moved && api.started) {
        const a = 0.6 + 0.4 * Math.sin(t * 6); g.globalAlpha = a;
        for (const k of [-1, 1]) { const ax = d.x + k * (d.w * 0.75 + Math.sin(t * 6) * 6); const ay = l.groundY - d.w * 0.35; g.beginPath(); g.moveTo(ax + k * 16, ay); g.lineTo(ax, ay - 14); g.lineTo(ax, ay + 14); g.closePath(); fillInk(g, '#FFE27A', 3); }
        g.globalAlpha = 1;
      }
    },
    score: () => st.caught,
    progress: () => clamp(api.t / DUR, 0, 1),
    result(s) {
      const from = api.params.source === 'grabble' ? ' Charli took some back from Grabble!' : '';
      if (s >= cfg.shards) return { word: 'WOOF!', line: `All ${cfg.shards} shards!${from}`, good: true };
      if (s >= 1) return { word: 'WOOF!', line: `Charli caught ${s} of ${cfg.shards}!${from}`, good: true };
      return { word: 'OOPS!', line: 'No catches this time.', good: false };
    },
  };
};

// ---- Dodge the net: Grabble swoops down cfg.swoops times; tap while the net glows (cfg.window s) to hop over it.
// Feints (cfg.feints): before some swoops the net only twitches with a quick white flicker. Hopping on a feint
// costs a dodge ("TRICKED!"). Grabble is one sprite (mini_grabble_net_swoop); a swoop moves + rotates it so its
// net hoop follows a curve down to the hero and on past (dodge) or back up (caught).
GAMES.swish = (api) => {
  const cfg = api.cfg; const N = cfg.swoops; const GLOW = cfg.window; const ENTER = 0.55; const RES = 0.9; const TWITCH = 0.45;
  const NET = { x: 0.33, y: -0.23, aspect: 512 / 768 }; // net hoop centre relative to the sprite centre (× w, × h)
  const feintAt = new Set([...Array(Math.max(0, N - 1)).keys()].map((k) => k + 1).sort(() => Math.random() - 0.5).slice(0, cfg.feints || 0));
  const windTime = () => (N > 3 ? rand(0.7, 1.2) : rand(0.85, 1.4));
  const st = { k: 0, ph: 'enter', tm: 0, wind: windTime(), side: Math.random() < 0.5 ? -1 : 1, gx: null, fromX: null, dodges: 0, tricks: 0, feintDone: false, jump: null, res: null, hinted: false, netU: 0, done: false };
  const L = () => {
    const W = api.W, H = api.H; const hr = clamp(W * 0.115, 32, 52);
    const groundY = H - clamp(H * 0.12, 60, 100); const gh = clamp(H * 0.3, 170, 260);
    return { W, H, hr, groundY, heroX: W / 2, heroY: groundY - hr * 1.05, gh, gw: gh * NET.aspect };
  };
  const sideX = (side) => api.W / 2 + side * api.W * 0.2;
  const heroLift = () => { const j = st.jump; if (!j) return 0; const k = clamp(j.t / j.dur, 0, 1); return Math.sin(Math.PI * k) * j.h; };
  const rot2 = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
  const scoreNow = () => Math.max(0, st.dodges - st.tricks);
  function frameAt(u, twitch = 0) {
    const l = L(); const m = st.side > 0 ? -1 : 1;
    const n0 = { x: m * NET.x * l.gw, y: NET.y * l.gh };
    const S0 = { x: st.gx ?? sideX(st.side), y: api.top + 2 + l.gh / 2 };
    const p0 = { x: S0.x + n0.x, y: S0.y + n0.y };
    const p1 = { x: l.heroX + m * -api.W * 0.05, y: l.heroY - l.hr * 3.2 };
    const p2 = { x: l.heroX, y: l.heroY + l.hr * 0.1 };
    const p3 = { x: l.heroX + m * api.W * 0.75, y: l.heroY - l.hr * 0.6 };
    let hoop; let ang;
    if (u <= 1) { const a = 1 - u; hoop = { x: a * a * p0.x + 2 * a * u * p1.x + u * u * p2.x, y: a * a * p0.y + 2 * a * u * p1.y + u * u * p2.y }; ang = m * 1.4 * easeInOut(u); }
    else { const v = clamp(u - 1, 0, 1); hoop = { x: lerp(p2.x, p3.x, v), y: lerp(p2.y, p3.y, v) - Math.sin(v * Math.PI) * l.hr * 1.2 }; ang = m * (1.4 + v * 2.2); }
    ang += m * twitch; // a feint: the net only twitches
    const rn = rot2(n0, ang);
    return { cx: hoop.x - rn.x, cy: hoop.y - rn.y, ang, m, hoop, w: l.gw, h: l.gh };
  }
  function drawSwooper(g, f, t, glow, flicker) {
    const img = api.img('mini_grabble_net_swoop');
    if (glow) {
      const p = 0.6 + 0.4 * Math.sin(t * 18); const R = f.h * 0.3;
      const rg = g.createRadialGradient(f.hoop.x, f.hoop.y, R * 0.2, f.hoop.x, f.hoop.y, R * 1.6); rg.addColorStop(0, `rgba(255,226,122,${0.9 * p})`); rg.addColorStop(1, 'rgba(255,226,122,0)');
      g.fillStyle = rg; g.fillRect(f.hoop.x - R * 1.7, f.hoop.y - R * 1.7, R * 3.4, R * 3.4);
    }
    g.save(); g.translate(f.cx, f.cy); g.rotate(f.ang); g.scale(f.m, 1);
    if (img) g.drawImage(img, -f.w / 2, -f.h / 2, f.w, f.h);
    else {
      const hand = { x: f.w * 0.2, y: f.h * 0.02 }; const hp = { x: NET.x * f.w, y: NET.y * f.h };
      drawGrabble(g, -f.w * 0.08, f.h * 0.47, f.h * 0.85, t, api.face('grabble'), { dir: 1, hand, shadow: false });
      g.beginPath(); g.moveTo(hand.x, hand.y + f.h * 0.06); g.lineTo(hp.x, hp.y); ink(g, 9); g.beginPath(); g.moveTo(hand.x, hand.y + f.h * 0.06); g.lineTo(hp.x, hp.y); g.lineWidth = 5; g.strokeStyle = '#A0703F'; g.stroke();
      drawNetHoop(g, hp.x, hp.y, f.h * 0.13, 0, false, t);
    }
    g.restore();
    if (glow) { g.beginPath(); g.ellipse(f.hoop.x, f.hoop.y, f.h * 0.15, f.h * 0.15, 0, 0, TAU); g.lineWidth = 6; g.strokeStyle = `rgba(242,193,78,${0.6 + 0.4 * Math.sin(t * 18)})`; g.stroke(); }
    if (flicker) { g.beginPath(); g.ellipse(f.hoop.x, f.hoop.y, f.h * 0.14, f.h * 0.14, 0, 0, TAU); g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,.95)'; g.stroke(); }
  }
  function next() {
    st.k++;
    if (st.k >= N) { st.done = true; api.end(); return; }
    const wasDodge = st.res === 'dodge';
    st.side = -st.side; st.ph = 'enter'; st.tm = 0; st.wind = windTime(); st.res = null; st.hinted = false; st.netU = 0; st.feintDone = false;
    st.fromX = wasDodge ? sideX(st.side) + st.side * api.W * 0.5 : st.gx;
  }
  return {
    duration: N * (ENTER + 1.4 + GLOW + RES) + (cfg.feints || 0) * (TWITCH + 0.8) + 1, pips: N, art: ['mini_bg_petwash', 'mini_grabble_net_swoop'], __st: () => st,
    update(dt) {
      const l = L();
      if (st.jump) { st.jump.t += dt; if (st.jump.t >= st.jump.dur) st.jump = null; }
      st.tm += dt;
      const target = sideX(st.side);
      if (st.ph === 'enter') {
        const from = st.fromX ?? (target + st.side * api.W * 0.6);
        st.gx = lerp(from, target, easeOut(clamp(st.tm / ENTER, 0, 1))); st.netU = 0;
        if (st.tm >= ENTER) { st.ph = 'wind'; st.tm = 0; }
      } else if (st.ph === 'wind') {
        st.gx = target; st.netU = 0;
        if (st.tm >= st.wind) {
          if (feintAt.has(st.k) && !st.feintDone) { st.ph = 'twitch'; st.tm = 0; st.feintDone = true; api.snd('boop'); }
          else { st.ph = 'glow'; st.tm = 0; api.snd('alert'); api.snd('swoop'); api.buzz(25); }
        }
      } else if (st.ph === 'twitch') {
        if (st.tm >= TWITCH) { st.ph = 'wind'; st.tm = 0; st.wind = rand(0.45, 0.8); }
      } else if (st.ph === 'glow') {
        st.netU = easeInOut(clamp(st.tm / GLOW, 0, 1));
        if (st.tm >= GLOW) {
          st.ph = 'res'; st.tm = 0; st.res = 'caught';
          api.snd('caught'); api.buzz([120, 50, 120]); api.shake(8, 0.35);
          api.fx.word(l.heroX, l.heroY - l.hr * 2.4, 'SWISH!', '#CDB4F0', 46);
        }
      } else if (st.ph === 'res') {
        if (st.res === 'dodge') st.netU = Math.min(2, st.netU + dt * 2.4);
        else st.netU = st.tm < 0.5 ? 1 : Math.max(0, 1 - (st.tm - 0.5) * 2.2);
        if (st.tm >= RES) next();
      }
    },
    down() {
      if (st.done || st.jump) return;
      const l = L();
      if (st.ph === 'glow') {
        st.jump = { t: 0, dur: 0.8, h: l.hr * 3.3 }; st.ph = 'res'; st.tm = 0; st.res = 'dodge'; st.dodges++; api.setPips(scoreNow());
        api.snd('hop'); api.buzz(30); api.fx.word(l.heroX, l.heroY - l.hr * 4.6, 'HOP!', '#A8E0B8', 46);
        api.fx.burst(l.heroX, l.heroY + l.hr, { n: 10, colors: ['#FFFFFF', '#A8E0B8', '#FFE27A'], speed: 160 });
      } else if (st.ph === 'twitch') { // fooled by a feint: costs a dodge
        st.jump = { t: 0, dur: 0.42, h: l.hr * 1.1 }; st.tricks++; api.setPips(scoreNow());
        api.snd('meh'); api.buzz([60, 40, 60]); api.fx.word(l.heroX, l.heroY - l.hr * 2.8, 'TRICKED!', '#CDB4F0', 38);
      } else if (st.ph === 'enter' || st.ph === 'wind') {
        st.jump = { t: 0, dur: 0.42, h: l.hr * 1.1 }; api.snd('boop');
        if (!st.hinted) { st.hinted = true; api.fx.word(l.heroX, l.heroY - l.hr * 2.6, 'Wait for the glow!', '#FFFFFF', 26); }
      }
    },
    draw(g, t) {
      const l = L(); const W = api.W, H = api.H;
      const bg = api.img('mini_bg_petwash');
      if (bg) { drawCover(g, bg, W, H, 0.5, 1); wash(g, W, H, 'rgba(255,246,224,.15)'); }
      else {
        paper(g, W, H, '#DDEFFA', '#FFF6E0', [[0.5, 0.25, 0.4, 'rgba(255,255,255,.6)']]);
        const fronts = [['#DCEFF8', '#9DD8F2'], ['#F9DCEB', '#F29BC8'], ['#FFF6E0', '#B48BE0']];
        fronts.forEach(([wall, aw], i) => {
          const fw = W / 3; const fx = i * fw; const fy = l.groundY - H * 0.34;
          rrect(g, fx + 4, fy, fw - 8, H * 0.36, 8); fillInk(g, wall, 3);
          g.save(); rrect(g, fx + 4, fy, fw - 8, 26, 8); g.clip(); for (let s2 = 0; s2 < 6; s2++) { g.fillStyle = s2 % 2 ? '#FFFFFF' : aw; g.fillRect(fx + 4 + (s2 * (fw - 8)) / 6, fy, (fw - 8) / 6 + 1, 26); } g.restore();
          rrect(g, fx + 4, fy, fw - 8, 26, 8); ink(g, 3);
          rrect(g, fx + fw * 0.22, fy + 40, fw * 0.56, H * 0.12, 8); fillInk(g, '#FFE9A8', 2.5);
        });
        cobbles(g, W, l.groundY, H);
      }
      bunting(g, W, api.top - 6);
      const glow = st.ph === 'glow';
      const twitchK = st.ph === 'twitch' ? Math.sin((st.tm / TWITCH) * Math.PI * 4) * 0.12 : 0;
      const flicker = st.ph === 'twitch' && Math.floor(st.tm / 0.08) % 2 === 0;
      if (glow) { const p = 0.5 + 0.5 * Math.sin(t * 18); g.save(); g.lineWidth = 22; g.strokeStyle = `rgba(242,193,78,${0.35 + 0.35 * p})`; g.strokeRect(0, 0, W, H); g.restore(); }
      const f = frameAt(st.netU, twitchK);
      const caughtNow = st.res === 'caught' && st.tm < 0.55;
      const lift = heroLift(); const hx = l.heroX + (caughtNow ? Math.sin(t * 40) * 5 : 0); const hy = l.heroY - lift;
      g.beginPath(); g.ellipse(l.heroX, l.groundY + 6, l.hr * (0.9 - lift / (l.hr * 8)), l.hr * 0.22, 0, 0, TAU); g.fillStyle = 'rgba(43,36,64,.22)'; g.fill();
      if (!caughtNow) drawSwooper(g, f, t, glow, flicker);
      for (const k of [-1, 1]) { g.beginPath(); g.ellipse(hx + k * l.hr * 0.38, hy + l.hr * 0.98, l.hr * 0.26, l.hr * 0.15, 0, 0, TAU); fillInk(g, api.hero.color, 3); }
      drawFaceDisc(g, api.face(api.hero.id), hx, hy, l.hr, api.hero.color, (api.hero.name || '?')[0]);
      if (caughtNow) drawSwooper(g, f, t, false, false);
      if (st.res === 'caught' && st.tm >= 0.5) drawShard(g, f.hoop.x, f.hoop.y, 13, t * 3);
      if (glow) drawWord(g, l.heroX, l.heroY - l.hr * 2.2, 'TAP!', '#FFE27A', 46, 1, 1 + 0.08 * Math.sin(t * 18));
    },
    score: scoreNow,
    progress: () => clamp((st.k + (st.ph === 'res' ? 0.9 : st.ph === 'glow' ? 0.6 : st.ph === 'wind' || st.ph === 'twitch' ? 0.3 : 0.1)) / N, 0, 1),
    result(s) {
      if (s >= N) return { word: 'HOP!', line: `All ${N} dodges! Grabble tripped over his net!`, good: true };
      return { word: 'SWISH!', line: s ? `${s} of ${N} dodges. The net got you!` : 'The net got you!', good: false };
    },
  };
};

// ---- Strawberry catch: tap falling strawberries (cfg.berries over cfg.duration s, ×cfg.speed) to plop them onto the
// cake. Grabble's mouldy berries (cfg.rotten) take a point away when tapped (never below 0).
GAMES.cake = (api) => {
  const cfg = api.cfg; const DUR = cfg.duration; const N = cfg.berries; const R = cfg.rotten || 0; const SPD = cfg.speed || 1;
  const FALL = 2.3 / SPD;
  const lastSpawn = Math.max(0.6, DUR - FALL - 0.1);
  const kinds = new Array(N + R).fill('good');
  for (let j = 0; j < R; j++) kinds[clamp(Math.round(((j + 0.5) * (N + R)) / R), 1, N + R - 1)] = 'rotten';
  let nr = kinds.filter((k) => k === 'rotten').length; for (let i = N + R - 1; nr < R && i > 0; i--) if (kinds[i] === 'good') { kinds[i] = 'rotten'; nr++; }
  const times = kinds.map((_, i) => 0.2 + (kinds.length > 1 ? (i * (lastSpawn - 0.2)) / (kinds.length - 1) : 0));
  const st = { berries: [], next: 0, score: 0, prevX: null, bob: 0, on: [] };
  // cake geometry: with the art the cake is a square image whose top surface sits ~0.68 cw above its base
  const L = () => {
    const by = api.H - clamp(api.H * 0.05, 18, 40); const r = clamp(api.W * 0.088, 27, 40);
    if (api.img('mini_cake_base')) { const cw = Math.min(api.W * 0.7, 300); return { cw, ch: cw * 0.9, cx: api.W / 2, by, topY: by - cw * 0.68, r, art: true }; }
    const cw = Math.min(api.W * 0.66, 290); const ch = cw * 0.5;
    return { cw, ch, cx: api.W / 2, by, topY: by - ch * 1.42, r, art: false };
  };
  const ROWS = [5, 4, 4, 3, 3, 2]; // stacked on top of the cake, up to 21
  const slot = (i) => {
    const l = L(); let row = 0; let j = i; while (row < ROWS.length - 1 && j >= ROWS[row]) { j -= ROWS[row]; row++; }
    const n = ROWS[row]; const span = l.cw * Math.max(0.12, 0.48 - row * 0.08);
    return { x: l.cx - span / 2 + (n > 1 ? (j * span) / (n - 1) : span / 2), y: l.topY - l.r * 0.3 - row * l.r * 0.6 };
  };
  const berry = (g, x, y, r, rot, rotten) => {
    const img = api.img('mini_strawberry');
    if (rotten) { drawRottenBerry(g, x, y, r, rot); return; }
    if (!img) { drawBerry(g, x, y, r, rot); return; }
    const s = r * 2.75; g.save(); g.translate(x, y); g.rotate(rot); g.drawImage(img, -s / 2, -s / 2, s, s); g.restore();
  };
  return {
    duration: DUR, pips: N, art: ['mini_strawberry', 'mini_cake_base'], __st: () => st,
    update(dt, t) {
      const l = L();
      st.bob = Math.max(0, st.bob - dt * 3);
      while (st.next < kinds.length && t >= times[st.next]) {
        let x; for (let k = 0; k < 10; k++) { x = rand(api.W * 0.14, api.W * 0.86); if (st.prevX == null || Math.abs(x - st.prevX) > api.W * 0.2) break; }
        st.prevX = x;
        st.berries.push({ bx: x, x, y: -l.r, vy: (l.topY + l.r) / FALL, r: l.r, ph: rand(0, TAU), state: 'fall', t: 0, rot: rand(-0.3, 0.3), rotten: kinds[st.next] === 'rotten' });
        st.next++;
      }
      for (const b of st.berries) {
        if (b.state === 'fall') { b.y += b.vy * dt; b.x = b.bx + Math.sin(t * 2.2 + b.ph) * 10; if (b.y > api.H + b.r * 2) b.state = 'gone'; }
        else if (b.state === 'fly') {
          b.t += dt / 0.42;
          if (b.t >= 1) { b.state = 'on'; st.bob = 1; api.snd('plop'); api.fx.burst(b.to.x, b.to.y, { n: 6, colors: ['#FFFFFF', '#F7B6D6'], kind: 'dot', speed: 90, r: 5 }); }
        } else if (b.state === 'off') { b.t += dt; b.vy += 900 * dt; b.y += b.vy * dt; b.x += b.vx * dt; b.rot += 6 * dt; if (b.y > api.H + 60) b.state = 'gone'; }
      }
    },
    down(x, y) {
      let best = null; let bd = Infinity;
      for (const b of st.berries) { if (b.state !== 'fall') continue; const d = Math.hypot(b.x - x, b.y - y); if (d < b.r * 1.75 && d < bd) { bd = d; best = b; } }
      if (!best) return;
      if (best.rotten) { // Grabble's mouldy berry: −1, and the last berry on the cake hops off
        best.state = 'off'; best.vy = -260; best.vx = rand(-80, 80); best.t = 0;
        if (st.score > 0) {
          st.score--; api.setPips(st.score);
          const top = [...st.berries].reverse().find((b) => (b.state === 'on' || b.state === 'fly') && !b.rotten);
          if (top) { top.state = 'off'; top.vy = -320; top.vx = rand(-120, 120); top.x = top.to.x; top.y = top.to.y; top.t = 0; }
        }
        api.snd('meh'); api.buzz([80, 40, 80]); api.fx.word(best.x, best.y - best.r * 1.4, 'YUCK!', '#B8D89A', 38);
        api.fx.burst(best.x, best.y, { n: 10, colors: ['#9DB07A', '#7C8A66', '#C9D6A8'], kind: 'dot', speed: 140 });
        return;
      }
      best.state = 'fly'; best.t = 0; best.from = { x: best.x, y: best.y };
      best.to = slot(st.berries.filter((b) => (b.state === 'on' || b.state === 'fly') && !b.rotten).length);
      st.score = Math.min(N, st.score + 1); api.setPips(st.score);
      api.snd('pop'); api.buzz(15); api.fx.burst(best.x, best.y, { n: 8, colors: ['#FFE27A', '#FFFFFF', '#F7B6D6'], speed: 140 });
    },
    draw(g, t) {
      const W = api.W, H = api.H; const l = L();
      paper(g, W, H, '#FDE7F0', '#FFF6E0', [[0.1, 0.15, 0.3, 'rgba(255,255,255,.7)'], [0.9, 0.35, 0.3, 'rgba(191,227,245,.5)']]);
      bunting(g, W, api.top - 4);
      const ty = l.by - (l.art ? l.cw * 0.12 : l.ch * 0.18);
      g.fillStyle = '#FFFFFF'; g.fillRect(-10, ty, W + 20, H - ty + 10);
      for (let i = 0; i < W / 28 + 1; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) { g.fillStyle = 'rgba(242,155,200,.5)'; g.fillRect(i * 28, ty + j * 28, 28, 28); }
      g.beginPath(); g.moveTo(-10, ty); g.lineTo(W + 10, ty); ink(g, 3);
      for (const b of st.berries) if (b.state === 'fall') berry(g, b.x, b.y, b.r, b.rot + Math.sin(t * 3 + b.ph) * 0.15, b.rotten);
      const s = 1 + st.bob * 0.04;
      const ci = api.img('mini_cake_base');
      if (ci) { g.save(); g.translate(l.cx, l.by); g.scale(s, 2 - s); g.drawImage(ci, -l.cw / 2, -l.cw * 0.95, l.cw, l.cw); g.restore(); }
      else {
        g.save(); g.translate(l.cx, l.by); g.scale(s, 2 - s);
        g.beginPath(); g.ellipse(0, 0, l.cw * 0.62, l.ch * 0.14, 0, 0, TAU); fillInk(g, '#FFFFFF', 3);
        rrect(g, -l.cw / 2, -l.ch * 0.62, l.cw, l.ch * 0.56, 14); fillInk(g, '#F7B6D6', 3);
        rrect(g, -l.cw * 0.36, -l.ch * 1.05, l.cw * 0.72, l.ch * 0.46, 12); fillInk(g, '#FFF6E0', 3);
        g.beginPath(); g.moveTo(-l.cw / 2 + 4, -l.ch * 0.6);
        for (let i = 0; i <= 8; i++) { const x = -l.cw / 2 + 4 + (i * (l.cw - 8)) / 8; g.quadraticCurveTo(x - (l.cw - 8) / 16, -l.ch * (i % 2 ? 0.42 : 0.5), x, -l.ch * 0.6); }
        g.lineWidth = 3; g.strokeStyle = INK; g.fillStyle = '#FFFFFF'; g.fill(); g.stroke();
        g.restore();
      }
      for (const b of st.berries) {
        if (b.state === 'on') berry(g, b.to.x, b.to.y + (1 - s) * 20, b.r * 0.66, b.rot, false);
        else if (b.state === 'fly') { const e = easeInOut(b.t); berry(g, lerp(b.from.x, b.to.x, e), lerp(b.from.y, b.to.y, e) - Math.sin(e * Math.PI) * 80, b.r * lerp(1, 0.66, e), b.rot + e * 6, false); }
        else if (b.state === 'off') berry(g, b.x, b.y, b.r * 0.8, b.rot, b.rotten);
      }
    },
    score: () => st.score,
    progress: () => clamp(api.t / DUR, 0, 1),
    result(s) {
      if (s >= Math.ceil(N / 2)) return { word: 'CAKE!', line: `${s} strawberries! What a cake!`, good: true };
      return { word: 'CAKE!', line: `${s} strawberr${s === 1 ? 'y' : 'ies'}! Cake for everyone!`, good: s >= 1 };
    },
  };
};

// ---- Vine grab: hold to grow the vine toward Grabble; let go while the tip is in the glow around him.
// cfg.zone / cfg.perfect are the windows (server CHASE windows), cfg.speed the growth speed, cfg.wobble makes the
// glow (and Grabble) drift. The score sent is the tip measured in the zone's resting frame (tip − drift at release),
// so what the player saw is what the server judges.
GAMES.chase = (api) => {
  const cfg = api.cfg;
  const sweet = win2(cfg.zone || api.params.zone || api.params.sweet, SWEET); const perfect = win2(cfg.perfect || api.params.perfect, PERFECT);
  const GROW = 0.4 * (cfg.speed || 1); const WAIT = 7.5; const WOB = cfg.wobble || 0;
  const drift = (t) => (WOB ? WOB * 0.12 * Math.sin(t * 1.7) + WOB * 0.05 * Math.sin(t * 3.1 + 1) : 0);
  const st = { ph: 'wait', tip: 0, score: null, res: null, tEnd: 0, stop: null, downAt: 0, armed: false, inZone: false, hop: 0, dr: 0 };
  const P = () => { const y0 = api.H - clamp(api.H * 0.15, 84, 130); const y1 = api.top + 26; return { y0, y1 }; };
  const path = (u) => { const { y0, y1 } = P(); return { x: api.W / 2 + Math.sin(u * Math.PI * 1.5) * api.W * 0.12, y: y0 - u * (y0 - y1) }; };
  const uMid = (perfect[0] + perfect[1]) / 2;
  function release() {
    if (st.ph !== 'grow') return;
    st.ph = 'done'; st.tEnd = 0; st.score = round3(st.tip - st.dr); if (st.stop) st.stop();
    const p = path(uMid + st.dr);
    if (st.score >= perfect[0] && st.score <= perfect[1]) {
      st.res = 'perfect'; api.snd('bloom'); api.buzz([40, 30, 40, 30, 140]); api.fx.word(p.x, p.y - 90, 'PERFECT!', '#FFE27A', 46);
      api.fx.burst(p.x, p.y, { n: 26, colors: ['#5B8DEF', '#BFE3F5', '#FFE27A', '#FFFFFF'], kind: 'petal', speed: 260 });
    } else if (st.score >= sweet[0] && st.score <= sweet[1]) {
      st.res = 'sweet'; api.snd('bloom'); api.buzz([40, 30, 120]); api.fx.word(p.x, p.y - 90, 'GOT HIM!', '#A8E0B8', 44);
      api.fx.burst(p.x, p.y, { n: 18, colors: ['#5B8DEF', '#BFE3F5', '#FFFFFF'], kind: 'petal', speed: 220 });
    } else {
      st.res = st.score < sweet[0] ? 'short' : 'long'; api.snd('boing'); api.buzz(140);
      api.fx.word(p.x, p.y - 90, st.res === 'short' ? 'TOO SHORT!' : 'TOO FAR!', '#F7B6D6', 38);
    }
  }
  return {
    duration: 12, pips: 0, art: ['mini_bg_garden', 'mini_vine_tip', 'mini_grabble_net_swoop', 'grabble_caught'], __st: () => st,
    update(dt, t) {
      if (st.ph !== 'done') st.dr = drift(t);
      if (st.ph === 'wait' && t > WAIT) { st.ph = 'grow'; st.tip = 0; release(); }
      if (st.ph === 'grow') {
        st.tip = Math.min(1, st.tip + GROW * dt);
        const rel = st.tip - st.dr; const inZ = rel >= sweet[0] && rel <= sweet[1];
        if (inZ && !st.inZone) { api.snd('twinkle'); api.buzz(15); }
        st.inZone = inZ;
        if (st.tip >= 1) release();
      }
      if (st.ph === 'done') {
        st.tEnd += dt;
        if (st.res === 'short' || st.res === 'long') st.hop += dt;
        if (st.tEnd > 1.35) api.end();
      }
    },
    down() {
      if (st.ph === 'wait') {
        st.ph = 'grow'; st.downAt = api.t; st.armed = false;
        st.stop = api.sweep({ f: 240, to: 1100, d: 1 / GROW, g: 0.07 }); api.buzz(10);
      } else if (st.ph === 'grow' && st.armed) release(); // tap-tap players: second tap lets go
    },
    up() {
      if (st.ph !== 'grow') return;
      if (api.t - st.downAt < 0.28) st.armed = true; // a quick tap: keep growing until the next tap
      else release();
    },
    timeUp() { if (st.ph === 'grow') release(); },
    draw(g, t) {
      const W = api.W, H = api.H; const { y0 } = P(); const dr = st.dr;
      const bg = api.img('mini_bg_garden');
      if (bg) { drawCover(g, bg, W, H); wash(g, W, H, 'rgba(255,246,224,.6)'); }
      else paper(g, W, H, '#E6F4E0', '#FFF6E0', [[0.15, 0.2, 0.35, 'rgba(191,227,245,.6)'], [0.9, 0.7, 0.35, 'rgba(247,182,214,.4)']]);
      for (let i = 0; i < 7; i++) drawFlower(g, (i * W) / 6, y0 + 40 + (i % 2) * 18, 9, i % 2 ? '#F7B6D6' : '#9DB8F5', { lw: 1.5 });
      grassBand(g, W, y0 + 26, H);
      // the glow zones around Grabble (shifted by the drift)
      const a = path(sweet[0] + dr), b = path(sweet[1] + dr); const pa = path(perfect[0] + dr), pb = path(perfect[1] + dr);
      const pulse = 0.55 + 0.45 * Math.sin(t * 5); const hot = st.ph === 'grow' && st.inZone;
      const zry = (a.y - b.y) / 2; const zrx = Math.min(W * 0.4, Math.max(zry * 1.05, W * 0.3));
      g.save();
      g.beginPath(); g.ellipse(W / 2, (a.y + b.y) / 2, zrx, zry, 0, 0, TAU);
      g.fillStyle = hot ? `rgba(168,224,184,${0.55 + 0.25 * pulse})` : `rgba(168,224,184,${0.28 + 0.18 * pulse})`; g.fill();
      g.setLineDash([10, 8]); g.lineWidth = 3; g.strokeStyle = 'rgba(43,36,64,.45)'; g.stroke(); g.setLineDash([]);
      const pry = Math.max(10, (pa.y - pb.y) / 2);
      g.beginPath(); g.ellipse(W / 2, (pa.y + pb.y) / 2, zrx * 0.82, pry, 0, 0, TAU); g.fillStyle = `rgba(255,226,122,${0.45 + 0.3 * pulse})`; g.fill();
      g.lineWidth = 2.5; g.strokeStyle = 'rgba(43,36,64,.4)'; g.stroke();
      g.restore();
      // Grabble
      const gp = path(uMid + dr); const gh = clamp(Math.max(zry, 70) * 1.25, 110, 210);
      let gx = gp.x + W * 0.04; let gy = gp.y + gh * 0.48;
      if (st.res === 'short' || st.res === 'long') { const k = clamp(st.hop / 1.1, 0, 1); gx += k * W * 0.7; gy -= Math.sin(k * Math.PI * 2) * 40; }
      const stuck = st.res === 'sweet' || st.res === 'perfect';
      const spr = api.img('mini_grabble_net_swoop'); const caughtImg = api.img('grabble_caught');
      g.save(); if (stuck) { g.translate(Math.sin(t * 30) * 3, 0); }
      if (stuck && caughtImg && st.tEnd > 0.25) { const s = gh * 1.15; g.drawImage(caughtImg, gx - s / 2, gy - s * 0.95, s, s); }
      else if (spr) {
        const sh = gh * 1.05; const sw = sh * (spr.width / spr.height); const bob = st.ph === 'done' ? 0 : Math.abs(Math.sin(t * 9)) * 8;
        g.save(); g.translate(gx, gy - bob); g.scale(-1, 1); g.drawImage(spr, -sw / 2, -sh, sw, sh); g.restore();
      } else drawGrabble(g, gx, gy, gh, t, api.face('grabble'), { dir: -1, run: !stuck && st.ph !== 'done', hand: { x: gx - gh * 0.3, y: gy - gh * 0.75 + Math.sin(t * 8) * 6 } });
      g.restore();
      // the vine
      const tipU = st.ph === 'wait' ? 0 : st.tip;
      if (tipU > 0.005) {
        const pts = []; for (let u = 0; u <= tipU + 1e-6; u += 0.02) pts.push(path(Math.min(u, tipU)));
        pts.push(path(tipU));
        const stroke = (lw, col) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.lineWidth = lw; g.strokeStyle = col; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(); };
        stroke(18, INK); stroke(11, '#6DB65B');
        for (let u = 0.06; u < tipU - 0.03; u += 0.07) {
          const p = path(u); const k = Math.round(u / 0.07) % 2 ? 1 : -1;
          g.beginPath(); g.ellipse(p.x + k * 14, p.y, 12, 6, k * 0.5, 0, TAU); fillInk(g, '#8FD27C', 2);
          if (Math.round(u / 0.07) % 3 === 0) drawFlower(g, p.x - k * 12, p.y - 4, 8, '#7FA6F2', { lw: 1.5 });
        }
        const tp = path(tipU);
        if (hot || st.res === 'perfect' || st.res === 'sweet') { const rg = g.createRadialGradient(tp.x, tp.y, 0, tp.x, tp.y, 46); rg.addColorStop(0, 'rgba(255,226,122,.95)'); rg.addColorStop(1, 'rgba(255,226,122,0)'); g.fillStyle = rg; g.fillRect(tp.x - 46, tp.y - 46, 92, 92); }
        const tipImg = api.img('mini_vine_tip');
        if (tipImg) {
          const pb2 = path(Math.max(0, tipU - 0.02)); const ang = Math.atan2(tp.x - pb2.x, pb2.y - tp.y); const s = 74;
          g.save(); g.translate(tp.x, tp.y); g.rotate(ang); g.drawImage(tipImg, -s * 0.57, -s * 0.12, s, s); g.restore();
        } else drawFlower(g, tp.x, tp.y, 13, '#5B8DEF', { rot: t * 2 });
      }
      if (stuck && !(caughtImg && st.tEnd > 0.25)) {
        const k = clamp(st.tEnd / 0.5, 0, 1);
        for (let i = 0; i < 3; i++) {
          const yy = gy - gh * (0.25 + i * 0.2);
          g.beginPath(); g.ellipse(gx, yy, gh * 0.3, gh * 0.08, 0.15 * (i - 1), Math.PI * (1 - k), Math.PI * (1 - k) + TAU * k); g.lineWidth = 12; g.strokeStyle = INK; g.stroke(); g.lineWidth = 7; g.strokeStyle = '#6DB65B'; g.stroke();
        }
      }
      const root = path(0);
      drawFaceDisc(g, api.face(api.hero.id), root.x, root.y + 18, clamp(W * 0.1, 28, 44), api.hero.color, (api.hero.name || '?')[0]);
      if (st.ph === 'wait' && api.started) drawWord(g, W / 2, root.y - 52, 'HOLD!', '#FFE27A', 40, 0.65 + 0.35 * Math.sin(t * 6), 1);
    },
    score: () => (st.score != null ? st.score : round3(st.tip - st.dr)),
    progress: () => (st.ph === 'wait' ? clamp(0.1 * (api.t / WAIT), 0, 0.1) : st.ph === 'grow' ? 0.1 + 0.8 * st.tip : 1),
    result(s) {
      const empty = api.params.loot === 0;
      if (s >= perfect[0] && s <= perfect[1]) return { word: 'PERFECT!', line: empty ? 'Got him! Grabble tripped in the flowers!' : 'Got him! Grabble drops his shards!', good: true };
      if (s >= sweet[0] && s <= sweet[1]) return { word: 'BLOOM!', line: empty ? 'Got him! Grabble tripped in the flowers!' : 'Got him! Grabble drops some shards!', good: true };
      return { word: 'HOP!', line: s < sweet[0] ? 'Too short! Grabble hopped away.' : 'Too far! Grabble hopped away.', good: false };
    },
  };
};

// ---- Ring the bell: the star sweeps 0 -> 1 -> 0 (one sweep = cfg.period s); tap when it is in the glow (cfg.zone).
// cfg.speedJitter > 0: every 0.6–1.2 s the star eases to a new speed in [1 − j, 1 + j] × base.
// Catcher gates: params.gateIndex / gateCount / section — gates after the first start straight away (see the shell).
GAMES.bell = (api) => {
  const cfg = api.cfg;
  const sweet = win2(cfg.zone || api.params.sweet, SWEET); const perfect = win2(cfg.perfect || api.params.perfect, PERFECT);
  const PERIOD = cfg.period || (Number(api.params.sweepMs) || 1600) / 1000; const JIT = cfg.speedJitter || 0;
  const LAT = 0.06; const GUARD = api.params.gateIndex >= 1 ? 0.12 : 0.25;
  const st = { score: null, doneT: 0, swing: 0, phase: Math.random() * 0.5, spd: 1, target: 1, nextChange: rand(0.6, 1.2), hist: [] };
  const tri = (ph) => { const p = mod(ph, 1); return p < 0.5 ? p * 2 : 2 - p * 2; };
  // star position at a past play time, from the recorded (time, phase) samples (the speed changes, so no formula)
  const posAt = (ts) => {
    const h = st.hist; if (!h.length) return tri(st.phase);
    if (ts >= h[h.length - 1][0]) return tri(h[h.length - 1][1]);
    for (let i = h.length - 1; i > 0; i--) if (h[i - 1][0] <= ts) { const [t0, p0] = h[i - 1]; const [t1, p1] = h[i]; return tri(p0 + ((ts - t0) / Math.max(1e-6, t1 - t0)) * (p1 - p0)); }
    return tri(h[0][1]);
  };
  const bar = () => { const x0 = 30, x1 = api.W - 30; return { x0, x1, y: Math.max(api.top + 70, api.H * 0.34), h: 58, r0: x0 + 30, r1: x1 - 30 }; };
  function hit(sc) {
    st.score = sc; st.doneT = 0; st.swing = 1;
    const b = bar(); const sx = lerp(b.r0, b.r1, sc);
    const perf = sc >= perfect[0] && sc <= perfect[1]; const ok = sc >= sweet[0] && sc <= sweet[1];
    api.snd(ok ? 'bell' : 'meh'); api.buzz(perf ? [60, 40, 120] : ok ? 60 : [120]);
    api.fx.burst(sx, b.y, { n: perf ? 28 : ok ? 16 : 6, speed: perf ? 300 : 220 });
    api.fx.word(api.W / 2, b.y - 70, perf ? 'PERFECT!' : ok ? 'DING!' : 'MISS', perf ? '#FFE27A' : ok ? '#BFE3F5' : '#F7B6D6', 48);
  }
  return {
    duration: null, pips: 0, __st: () => st,
    update(dt, t) {
      st.swing = Math.max(0, st.swing - dt * 0.8);
      if (st.score == null) {
        if (JIT > 0) {
          st.nextChange -= dt;
          if (st.nextChange <= 0) { st.nextChange = rand(0.6, 1.2); st.target = 1 + rand(-JIT, JIT); }
          st.spd += (st.target - st.spd) * Math.min(1, dt * 4); // eased
        }
        st.phase += (dt / PERIOD) * st.spd;
        st.hist.push([t, st.phase]); if (st.hist.length > 90) st.hist.shift();
      } else { st.doneT += dt; if (st.doneT > 0.8) api.end(); }
    },
    down(x, y, e) {
      if (st.score != null) return;
      const te = api.eventTime(e); if (te < GUARD) return;
      hit(round3(posAt(te - LAT)));
    },
    timeUp() { if (st.score == null) hit(round3(tri(st.phase))); },
    draw(g, t, phase) {
      const W = api.W, H = api.H; const b = bar();
      paper(g, W, H, '#D7EBF8', '#FFF6E0', [[0.2, 0.15, 0.3, 'rgba(255,255,255,.7)'], [0.85, 0.75, 0.35, 'rgba(242,193,78,.25)']]);
      for (let i = 0; i < 4; i++) cloud(g, mod(i * 150 + 40 + t * 8, W + 200) - 100, api.top + 20 + (i % 2) * 34, 22 + i * 4);
      const sec = api.params.section && api.params.section.label;
      if (sec && api.params.gateCount > 1) drawWord(g, W / 2, b.y - b.h / 2 - 34, sec, '#FFFFFF', Math.min(30, Math.round((W - 40) / (sec.length * 0.6))), 1, 1);
      rrect(g, b.x0, b.y - b.h / 2, b.x1 - b.x0, b.h, b.h / 2);
      const gr = g.createLinearGradient(0, b.y - b.h / 2, 0, b.y + b.h / 2); gr.addColorStop(0, '#EAF6FC'); gr.addColorStop(1, '#BFE3F5'); g.fillStyle = gr; g.fill(); ink(g, 3);
      const sp = st.score != null ? st.score : (phase === 'play' ? tri(st.phase) : 0.12);
      const inSweet = sp >= sweet[0] && sp <= sweet[1];
      const pulse = 0.6 + 0.4 * Math.sin(t * 7);
      const sx0 = lerp(b.r0, b.r1, sweet[0]), sx1 = lerp(b.r0, b.r1, sweet[1]);
      g.save(); g.shadowColor = `rgba(120,224,160,${0.6 + 0.3 * pulse})`; g.shadowBlur = 22;
      rrect(g, sx0, b.y - b.h / 2 + 6, sx1 - sx0, b.h - 12, (b.h - 12) / 2);
      const zg = g.createLinearGradient(0, b.y - b.h / 2, 0, b.y + b.h / 2); zg.addColorStop(0, '#C8F6D8'); zg.addColorStop(1, inSweet ? '#5FD186' : '#6FD18F'); g.fillStyle = zg; g.fill(); g.restore();
      rrect(g, sx0, b.y - b.h / 2 + 6, sx1 - sx0, b.h - 12, (b.h - 12) / 2); g.lineWidth = 2.5; g.strokeStyle = 'rgba(43,36,64,.6)'; g.stroke();
      const px0 = lerp(b.r0, b.r1, perfect[0]), px1 = lerp(b.r0, b.r1, perfect[1]);
      g.save(); g.shadowColor = 'rgba(255,226,122,.95)'; g.shadowBlur = 20 + 8 * pulse;
      rrect(g, px0, b.y - b.h / 2 - 4, px1 - px0, b.h + 8, 6); g.fillStyle = '#FFE27A'; g.fill(); g.restore();
      rrect(g, px0, b.y - b.h / 2 - 4, px1 - px0, b.h + 8, 6); ink(g, 3);
      const sx = lerp(b.r0, b.r1, sp); const sr = 30 * (inSweet ? 1.12 : 1) * (st.score != null ? 1.15 : 1);
      star5(g, sx, b.y, sr); fillInk(g, '#FFE27A', 3);
      g.beginPath(); g.moveTo(sx - sr * 0.25, b.y - sr * 0.18); g.lineTo(sx - sr * 0.05, b.y - sr * 0.45); g.lineWidth = 3; g.strokeStyle = '#FFFFFF'; g.lineCap = 'round'; g.stroke();
      const bs = Math.min(W * 0.5, (H - b.y - 120) * 0.9, 230); const by = b.y + b.h / 2 + 40 + bs * 0.6;
      const swing = st.score != null ? Math.sin(t * 16) * 0.35 * st.swing : Math.sin(t * 5) * 0.12;
      drawBell(g, W / 2, by, bs, swing);
      if (st.score == null) drawWord(g, W / 2, by + bs * 0.62, 'TAP!', '#FFFFFF', Math.round(bs * 0.26), 1, 1 + 0.05 * Math.sin(t * 8));
    },
    score: () => (st.score != null ? st.score : 0),
    progress: () => (st.score != null ? 1 : clamp(api.t / 8, 0, 0.95)),
    result(s) {
      const perf = s >= perfect[0] && s <= perfect[1]; const ok = s >= sweet[0] && s <= sweet[1];
      const gate = api.params.gateCount > 1 ? `Gate ${api.params.gateIndex + 1} of ${api.params.gateCount}: ` : '';
      if (perf) return { word: 'PERFECT!', line: `${gate}Perfect ring!`, good: true };
      if (ok) return { word: 'DING!', line: `${gate}You rang the bell!`, good: true };
      return { word: 'MISS', line: `${gate}Oh no, the star missed the glow!`, good: false };
    },
  };
};

// ------------------------------------------------------------------ the shell
function makeRing(cls) {
  const wrap = el('div', 'mg-cd ' + (cls || ''));
  wrap.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="cd-track" cx="50" cy="50" r="42"/><circle class="cd-fill" cx="50" cy="50" r="42" pathLength="100"/></svg><b></b>';
  const fill = wrap.querySelector('.cd-fill'); const num = wrap.querySelector('b'); let lastSec = null;
  return {
    el: wrap,
    set(frac, sec) {
      fill.style.strokeDashoffset = String(100 - clamp(frac, 0, 1) * 100);
      if (sec !== lastSec) { num.textContent = String(sec); lastSec = sec; wrap.classList.toggle('low', sec <= 3); }
    },
  };
}
const WORD_COLORS = { WOW: '#FFE27A', WHOOSH: '#BFE3F5', BUMP: '#F2C9A0', TING: '#FFE27A', 'OH NO': '#CDB4F0', WOOF: '#F2C14E', OOPS: '#F7B6D6', HOP: '#A8E0B8', SWISH: '#CDB4F0', CAKE: '#F7B6D6', PERFECT: '#FFE27A', BLOOM: '#F7B6D6', DING: '#BFE3F5' };
function renderWordInto(node, word) {
  node.textContent = '';
  const text = String(word || '').trim(); if (!text) return;
  const words = text.split(/\s+/);
  node.style.setProperty('--wl', Math.max(4, Math.max(...words.map((w) => w.length))));
  node.style.setProperty('--word', WORD_COLORS[text.replace(/[^A-Za-z -]/g, '').trim().toUpperCase()] || '#F7B6D6');
  let i = 0;
  for (const w of words) { const gEl = el('div', 'wg'); for (const c of w) { const s = el('span', null, c); s.style.setProperty('--i', i++); gEl.appendChild(s); } node.appendChild(gEl); }
}

export function runMinigame(type, opts = {}) {
  return new Promise((resolve) => {
    if (!GAMES[type]) type = 'bell';
    const info = GAME_INFO[type];
    const container = opts.container || document.getElementById('mini-stage') || document.body;
    const audio = opts.audio || {}; const sfx = audio.sfx || {};
    const hero = { id: 'kyah', name: 'Kyah', color: '#5B8DEF', ...(opts.hero || {}) };
    const buzz = typeof opts.buzz === 'function' ? opts.buzz : defaultBuzz;
    const faceUrls = { ...((opts.art && opts.art.faces) || {}) };
    const artUrls = { ...((opts.art && opts.art.urls) || {}) };
    const params = opts.params || {};
    const tier = TIERS[params.tier] ? params.tier : null;
    // the game is built from params.cfg (MINI[type][tier]); anything missing falls back to the easy tuning
    const cfg = { ...((MINI[type] && MINI[type].easy) || {}), ...((params.cfg && typeof params.cfg === 'object') ? params.cfg : {}) };
    const maxS = Math.max(1, maxScore(type, cfg) || info.max);
    const gateIndex = Number(params.gateIndex) || 0; const gateCount = Number(params.gateCount) || 1;
    const fastGate = type === 'bell' && gateIndex >= 1; // later Catcher gates: no title card, no Start tap
    if (hero.face && !faceUrls[hero.id]) faceUrls[hero.id] = hero.face;

    // ---- DOM
    container.textContent = '';
    const root = el('div', `mg mg-${type}`); root.dataset.phase = 'title';
    const canvas = el('canvas', 'mg-canvas'); canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${info.title}: ${info.line}`);
    const hud = el('div', 'mg-hud'); const pipsEl = el('div', 'mg-pips'); pipsEl.setAttribute('aria-hidden', 'true');
    const ring = makeRing('mg-cd-play'); hud.append(pipsEl, ring.el);
    const go = el('div', 'mg-go'); go.hidden = true;
    const titleWrap = el('div', 'mg-titlewrap'); const card = el('div', 'mg-card');
    const ringT = makeRing('mg-cd-title');
    const face = el('div', 'avatar xl mg-face'); face.style.setProperty('--c', hero.color);
    if (hero.face) { face.style.backgroundImage = `url("${hero.face}")`; face.classList.add('has-img'); } else face.textContent = (hero.name || '?').charAt(0).toUpperCase();
    const startBtn = el('button', 'btn btn-go mg-start', 'Start!'); startBtn.type = 'button';
    card.append(ringT.el, face, el('h2', 'mg-title', info.title), el('p', 'mg-line', info.line), startBtn);
    if (tier) { // difficulty badge: "Starlight ★★★"
      const t = TIERS[tier]; const badge = el('div', `mg-tier tier-${tier}`, `${t.label} ${'★'.repeat(t.stars)}`);
      badge.setAttribute('aria-label', `${t.label} level, ${t.stars} star${t.stars > 1 ? 's' : ''}`); card.insertBefore(badge, face);
    }
    if (type === 'bell' && gateCount > 1 && params.section && params.section.label) card.querySelector('.mg-line').textContent = `Gate ${gateIndex + 1} of ${gateCount}: ${params.section.label}. ${info.line}`;
    titleWrap.appendChild(card);
    if (fastGate) titleWrap.hidden = true;
    const result = el('div', 'mg-result'); result.hidden = true; result.setAttribute('role', 'status');
    root.append(canvas, hud, go, titleWrap, result);
    container.appendChild(root);
    const g = canvas.getContext('2d');

    // ---- state
    let W = 360, H = 640, dpr = 1;
    let phase = 'title'; let raf = 0; let last = performance.now(); let playStart = 0; let readyStart = 0; let t = 0;
    let finished = false; let endAt = Infinity; let shakeMag = 0; let shakeT = 0; let shakeDur = 0.3;
    let lastTickAt = -1e9; let lastTickVal = -1; let lastSec = null; let pipsMax = 0; let started = false;
    const fx = makeFx();
    // live picture: one cached offscreen canvas, re-sized only when the stage changes size
    const stream = { on: typeof opts.onFrame === 'function', c: null, x: null, busy: false, last: -1e9, gap: FRAME_MS, ema: 0 };
    function streamFrame(now) {
      if (!stream.on || stream.busy || now - stream.last < stream.gap) return;
      if (!stream.c) { stream.c = document.createElement('canvas'); stream.x = stream.c.getContext('2d'); }
      const fh = Math.max(1, Math.round((FRAME_W * H) / W));
      if (stream.c.width !== FRAME_W || stream.c.height !== fh) { stream.c.width = FRAME_W; stream.c.height = fh; }
      if (!stream.c.toBlob) { stream.on = false; return; }
      stream.last = now; stream.busy = true;
      stream.x.drawImage(canvas, 0, 0, FRAME_W, fh);
      stream.c.toBlob((blob) => {
        stream.busy = false;
        if (blob) { stream.ema = stream.ema ? stream.ema * 0.8 + blob.size * 0.2 : blob.size; stream.gap = clamp((stream.ema / FRAME_BUDGET) * 1000, FRAME_MS, 400); }
        if (blob && (phase === 'ready' || phase === 'play')) { try { opts.onFrame(blob); } catch { /* ignore */ } }
      }, 'image/jpeg', FRAME_Q);
    }
    const api = {
      get W() { return W; }, get H() { return H; }, get t() { return t; }, get started() { return started; }, get live() { return phase === 'play'; },
      top: HUD_TOP, hero, params, cfg, tier, fx, buzz, info,
      snd(name) { try { if (sfx[name]) sfx[name](); } catch { /* ignore */ } },
      sweep(o) { try { return audio.sweep ? audio.sweep(o) : () => {}; } catch { return () => {}; } },
      shake(m, d = 0.35) { shakeMag = m; shakeT = d; shakeDur = d; },
      setPips(n) { const kids = pipsEl.children; for (let i = 0; i < kids.length; i++) { const on = i < n; if (on && !kids[i].classList.contains('on')) kids[i].classList.add('on'); else if (!on) kids[i].classList.remove('on'); } },
      face(id) { const rec = lazyImage(faceUrls[id]); return rec && rec.img; },
      img(key) { const rec = lazyImage(artUrls[key]); return rec && rec.img; },
      end() { if (phase === 'play') finish(); },
      fail(r) { if (phase === 'play') finish({ failed: true, result: r }); }, // e.g. Grabble's fake shard: score 0, failed
      eventTime(e) { const now = performance.now(); const ts = e && e.timeStamp > 0 && Math.abs(e.timeStamp - now) < 400 ? e.timeStamp : now; return (ts - playStart) / 1000; },
    };
    function measure() {
      W = Math.max(240, root.clientWidth || container.clientWidth || window.innerWidth);
      H = Math.max(320, root.clientHeight || container.clientHeight || window.innerHeight);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    measure();
    const game = GAMES[type](api);
    for (const k of game.art || []) lazyImage(artUrls[k]); // start downloading this game's art during the title card
    pipsMax = game.pips || 0;
    if (type === 'bell' && gateCount > 1) { // Catcher gates: ●●○○ (done, this one, still to come)
      pipsMax = gateCount;
      for (let i = 0; i < gateCount; i++) pipsEl.appendChild(el('i', i < gateIndex ? 'on' : i === gateIndex ? 'cur' : ''));
      pipsEl.classList.add('gates'); pipsEl.setAttribute('aria-label', `Gate ${gateIndex + 1} of ${gateCount}`);
    } else for (let i = 0; i < pipsMax; i++) pipsEl.appendChild(el('i'));
    if (pipsMax > 10) pipsEl.classList.add('many');
    let ro = null;
    const onResize = () => { measure(); if (game.resize) game.resize(); };
    if (window.ResizeObserver) { ro = new ResizeObserver(onResize); ro.observe(root); } else window.addEventListener('resize', onResize);

    // ---- deadline: auto-start in time, end before the server gives up
    const now0 = performance.now();
    let rem = Number(opts.deadline) ? Number(opts.deadline) - Date.now() : 25000;
    if (!(rem > -2000 && rem < 90000)) rem = 25000;
    const deadlineAt = now0 + rem;
    const playLen = (game.duration || 9) * 1000;
    const autoAt = fastGate ? now0 : Math.max(now0 + 4000, deadlineAt - playLen - 2600);
    const titleTotal = Math.max(1000, autoAt - now0);

    // ---- input
    const pt = (e) => { const r = canvas.getBoundingClientRect(); return { x: ((e.clientX - r.left) * W) / (r.width || W), y: ((e.clientY - r.top) * H) / (r.height || H) }; };
    const onDown = (e) => { if (phase !== 'play') return; e.preventDefault(); try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ } const p = pt(e); if (game.down) game.down(p.x, p.y, e); };
    const onMove = (e) => { if (phase !== 'play') return; if (e.pointerType === 'mouse' && !e.buttons) return; const p = pt(e); if (game.move) game.move(p.x, p.y, e); };
    const onUp = (e) => { if (phase !== 'play') return; const p = pt(e); if (game.up) game.up(p.x, p.y, e); };
    const noMenu = (e) => e.preventDefault();
    canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp); canvas.addEventListener('contextmenu', noMenu);
    startBtn.addEventListener('click', () => { if (phase === 'title') { api.snd('tap'); buzz(20); startReady(); } });

    function setGo(text) { go.textContent = ''; const s = el('span', null, text); go.appendChild(s); go.dataset.s = text; }
    let readyMs = 1150; let goAt = 600;
    function startReady() {
      if (phase !== 'title') return;
      phase = 'ready'; root.dataset.phase = 'ready'; titleWrap.hidden = true; go.hidden = false; readyStart = performance.now();
      if (fastGate) { // "Gate 2 of 4 — Flower Garden! Ring the bell!" for 0.6 s, then the bar
        readyMs = 600; goAt = 1e9; go.classList.add('banner');
        const label = params.section && params.section.label ? ` — ${params.section.label}!` : '!';
        setGo(`Gate ${gateIndex + 1} of ${gateCount}${label} Ring the bell!`); api.snd('alert'); buzz([40, 30, 40]);
      } else { setGo('Ready…'); api.snd('ready'); }
    }
    function beginPlay(now) {
      phase = 'play'; root.dataset.phase = 'play'; go.hidden = true; started = true;
      playStart = now; t = 0; last = now;
      endAt = Math.min(playStart + (game.duration || 12) * 1000, deadlineAt - 700);
      if (endAt < playStart + 1500) endAt = playStart + 1500;
      if (game.start) game.start();
      tick(true, 0);
    }
    function tick(force, val) {
      if (!opts.onTick) return;
      const now = performance.now();
      const p = val != null ? val : clamp(game.progress ? game.progress() : t / (game.duration || 10), 0, 1);
      const r = Math.round(p * 100) / 100;
      if (!force && (now - lastTickAt < 200 || r === lastTickVal)) return;
      if (now - lastTickAt < 200) { setTimeout(() => tick(true, r), 200 - (now - lastTickAt)); return; }
      lastTickAt = now; lastTickVal = r;
      try { opts.onTick(r); } catch { /* ignore */ }
    }
    function finish(extra = {}) {
      if (finished) return;
      finished = true; phase = 'result'; root.dataset.phase = 'result';
      let score = extra.failed ? 0 : game.score();
      score = (type === 'chase' || type === 'bell') ? round3(score) : clamp(Math.round(Number(score) || 0), 0, maxS);
      try { if (opts.onDone) opts.onDone(score, extra.failed ? { failed: true } : {}); } catch (err) { console.error(err); }
      const r = extra.result ? { good: false, ...extra.result } : (game.result(score) || { word: 'YAY!', line: '', good: true });
      result.textContent = '';
      const w = el('div', 'sound-word mg-word'); renderWordInto(w, r.word);
      result.append(w, el('p', 'mg-res-line', r.line), el('p', 'mg-res-sub', 'Watch the big screen!'));
      result.classList.toggle('good', !!r.good); result.hidden = false;
      setTimeout(() => { api.snd(r.good ? 'win' : 'meh'); buzz(r.good ? [50, 40, 50, 40, 140] : [150]); if (r.good) fx.confetti(W); }, 120);
      setTimeout(() => { phase = 'done'; root.dataset.phase = 'done'; resolve({ score }); setTimeout(stopLoop, 1500); }, RESULT_MS);
    }
    function stopLoop() {
      cancelAnimationFrame(raf); raf = 0;
      if (ro) ro.disconnect(); else window.removeEventListener('resize', onResize);
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp);
    }
    function draw() {
      let sx = 0; let sy = 0;
      if (shakeT > 0) { const k = shakeT / shakeDur; sx = (Math.random() * 2 - 1) * shakeMag * k; sy = (Math.random() * 2 - 1) * shakeMag * k; }
      g.setTransform(dpr, 0, 0, dpr, sx * dpr, sy * dpr);
      g.clearRect(-30, -30, W + 60, H + 60);
      try { game.draw(g, phase === 'title' || phase === 'ready' ? performance.now() / 1000 : t, phase); } catch (err) { console.error(err); }
      fx.draw(g);
    }
    let frozen = false; // test hook (window.__mg.freeze): hold the picture still for screenshots
    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (frozen) { const d = now - last; last = now; playStart += d; endAt += d; readyStart += d; draw(); return; }
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
      if (phase === 'title') {
        const left = autoAt - now; ringT.set(left / titleTotal, Math.max(0, Math.ceil(left / 1000)));
        if (left <= 0) startReady();
      } else if (phase === 'ready') {
        const e = now - readyStart;
        if (e > goAt && go.dataset.s !== 'GO!') { setGo('GO!'); api.snd('go'); buzz(30); }
        if (e >= readyMs) beginPlay(now);
      } else if (phase === 'play') {
        t = (now - playStart) / 1000;
        try { game.update(dt, t); } catch (err) { console.error(err); }
        if (phase === 'play') {
          const left = endAt - now; const sec = Math.max(0, Math.ceil(left / 1000));
          ring.set(left / (endAt - playStart), sec);
          if (sec !== lastSec) { if (lastSec !== null && sec <= 3 && sec > 0) { api.snd('tick'); buzz(12); } lastSec = sec; }
          tick(false);
          if (now >= endAt) { if (game.timeUp) game.timeUp(); finish(); }
        }
      }
      fx.update(dt);
      if (shakeT > 0) shakeT -= dt;
      draw();
      if (phase === 'ready' || phase === 'play') streamFrame(now); // after the Start tap, until the result
    }
    if (opts.signal) {
      const abort = () => { if (phase === 'done') return; finished = true; phase = 'done'; root.dataset.phase = 'done'; stopLoop(); resolve({ score: null, aborted: true }); };
      if (opts.signal.aborted) { abort(); return; }
      opts.signal.addEventListener('abort', abort, { once: true });
    }
    // test hooks: freeze the picture; pump(ms) runs frames by hand (for a hidden/background browser pane)
    window.__mg = {
      type, api, game, get phase() { return phase; }, start: startReady, freeze(on) { frozen = !!on; },
      pump(ms = 16) { for (let i = 0; i < Math.ceil(ms / 16); i++) { frame(last + 16); cancelAnimationFrame(raf); } raf = requestAnimationFrame(frame); },
    };
    raf = requestAnimationFrame(frame);
  });
}

// Test hook: the game factories, for headless difficulty simulation (tools / scratch scripts only).
export const __GAMES = GAMES;
