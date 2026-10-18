import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import { Game } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const MAX_ROOMS = Number(process.env.MAX_ROOMS || 300);
const ROOM_IDLE_MS = Number(process.env.ROOM_IDLE_MINUTES || 120) * 60_000;
const GAME_OPTS = { winTarget: Number(process.env.WIN_TARGET || 12), grabbleTarget: Number(process.env.GRABBLE_TARGET || 7) };

function lanIp() {
  const ifs = os.networkInterfaces(); const prefer = ['en0', 'en1', 'eth0', 'wlan0'];
  const all = Object.entries(ifs).flatMap(([name, list]) => (list || []).filter(i => i.family === 'IPv4' && !i.internal).map(i => ({ name, address: i.address })));
  all.sort((a, b) => (prefer.indexOf(a.name) === -1 ? 99 : prefer.indexOf(a.name)) - (prefer.indexOf(b.name) === -1 ? 99 : prefer.indexOf(b.name)));
  return all[0]?.address || 'localhost';
}
const ip = lanIp();
const lanBase = `http://${ip}:${PORT}`;
// A fixed public address (PUBLIC_URL, or the one the share script registers) wins; otherwise the address the board was opened on.
let publicBase = process.env.PUBLIC_URL ? String(process.env.PUBLIC_URL).replace(/\/+$/, '') : null;
const isLoopbackHost = (h) => /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/i.test(String(h || ''));
function baseFor(headers = {}) {
  if (publicBase) return publicBase;
  const host = headers['x-forwarded-host'] || headers.host; if (!host || isLoopbackHost(host)) return lanBase;
  const proto = String(headers['x-forwarded-proto'] || '').split(',')[0].trim() || (headers['cf-visitor']?.includes('https') ? 'https' : 'http');
  return `${proto}://${host}`;
}
// requests that come from this machine directly (not through a tunnel or proxy)
function isLocalReq(addr, headers = {}) { const a = String(addr || ''); const loop = a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'; return loop && !headers['cf-connecting-ip'] && !headers['x-forwarded-for'] && !headers['x-real-ip']; }
const devAllowed = (req) => isLocalReq(req.socket.remoteAddress, req.headers) || (process.env.DEV_TOKEN && req.headers['x-dev-token'] === process.env.DEV_TOKEN);

// ---------------------------------------------------------------- rooms
const io = new Server({ cors: { origin: '*' }, pingInterval: 10000, pingTimeout: 20000, maxHttpBufferSize: 2e6 });
const rooms = new Map(); // code → { code, game, boardKey, boardSockets:Set, lastActive }
const tokens = new Map(); // player token → room code
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() { for (let i = 0; i < 200; i++) { const c = Array.from(crypto.randomBytes(4), b => ALPHABET[b % ALPHABET.length]).join(''); if (!rooms.has(c)) return c; } throw new Error('no free room code'); }
const joinUrlFor = (base, code) => `${base}/play/?room=${code}`;
function createRoom(base) {
  if (rooms.size >= MAX_ROOMS) gcRooms(true);
  if (rooms.size >= MAX_ROOMS) return null;
  const code = newCode(); const game = new Game({ room: code, joinUrl: joinUrlFor(base, code), ...GAME_OPTS });
  const r = { code, game, boardKey: crypto.randomBytes(12).toString('hex'), boardSockets: new Set(), lastActive: Date.now() };
  game.on('state', s => { r.lastActive = Date.now(); io.to(code).emit('state', s); });
  game.on('event', e => io.to(code).emit('event', e));
  rooms.set(code, r); console.log(`  room ${code} opened (${rooms.size} active)`); return r;
}
function roomBy(code) { return rooms.get(String(code || '').trim().toUpperCase()); }
function socketsIn(code) { return io.sockets.adapter.rooms.get(code)?.size || 0; }
function gcRooms(aggressive = false) {
  const now = Date.now();
  for (const [code, r] of rooms) {
    const idle = now - r.lastActive; const empty = socketsIn(code) === 0;
    if (empty && (idle > ROOM_IDLE_MS || (aggressive && idle > 10 * 60_000))) { r.game.clearTimers(); r.game.removeAllListeners(); rooms.delete(code); for (const [t, c] of tokens) if (c === code) tokens.delete(t); console.log(`  room ${code} closed (idle)`); }
  }
}
setInterval(gcRooms, 5 * 60_000).unref();
// the room a dev/test request means: ?room=CODE, else the most recently active room
function devRoom(req) { if (req.query.room) return roomBy(req.query.room); let best = null; for (const r of rooms.values()) if (!best || r.lastActive > best.lastActive) best = r; return best; }

// ---------------------------------------------------------------- http
const app = express();
app.set('trust proxy', true);
app.use(express.json());
const noStore = { setHeaders: (res) => res.setHeader('Cache-Control', 'no-store') };
const cacheLong = { maxAge: '7d', immutable: false };
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three'), cacheLong));
app.use('/vendor/gsap', express.static(path.join(ROOT, 'node_modules/gsap'), cacheLong));
app.use('/vendor/fonts', express.static(path.join(ROOT, 'node_modules/@fontsource'), cacheLong));
app.use('/assets', express.static(path.join(ROOT, 'public/assets'), { maxAge: '1d' }));
app.use('/', express.static(path.join(ROOT, 'public'), noStore));
app.get('/', (req, res) => res.redirect('/board/'));
app.get('/healthz', (req, res) => res.type('text').send('ok'));

app.get('/api/info', (req, res) => {
  const r = req.query.room ? roomBy(req.query.room) : (rooms.size === 1 && isLocalReq(req.socket.remoteAddress, req.headers) ? [...rooms.values()][0] : null);
  res.json({ room: r?.code || null, joinUrl: r?.game.joinUrl || null, lanIp: ip, port: PORT, rooms: rooms.size });
});
app.get('/api/qr.svg', async (req, res) => { const url = String(req.query.url || ''); if (!/^https?:\/\/[^\s]{3,300}$/.test(url)) return res.status(400).end(); res.type('svg').send(await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#2B2440', light: '#00000000' } })); });
// the share script registers the tunnel's public address here (local requests only)
app.post('/api/public-url', (req, res) => {
  if (!isLocalReq(req.socket.remoteAddress, req.headers)) return res.status(403).json({ ok: false });
  const base = String(req.body?.url || '').replace(/\/+$/, ''); if (base && !/^https?:\/\/[^\s]+$/.test(base)) return res.status(400).json({ ok: false, error: 'bad url' });
  publicBase = base || (process.env.PUBLIC_URL ? String(process.env.PUBLIC_URL).replace(/\/+$/, '') : null);
  for (const r of rooms.values()) { r.game.joinUrl = joinUrlFor(publicBase || lanBase, r.code); r.game.pushState(); }
  if (publicBase) console.log(`  Phones (anywhere):  ${publicBase}/play/`); res.json({ ok: true, joinUrl: publicBase ? `${publicBase}/play/` : null, rooms: rooms.size });
});
// dev helpers: this machine only (or with the DEV_TOKEN header), never through a public link
app.use('/api/dev', (req, res, next) => devAllowed(req) ? next() : res.status(403).json({ ok: false, error: 'local only' }));
app.use('/api/dev', (req, res, next) => { if (req.path === '/rooms') return next(); req.r = devRoom(req); if (!req.r) return res.status(404).json({ ok: false, error: 'no room yet: open the board first' }); req.game = req.r.game; next(); });
app.get('/api/state', (req, res) => { if (!devAllowed(req)) return res.status(403).json({ ok: false }); const r = devRoom(req); if (!r) return res.status(404).json({ ok: false }); res.json(r.game.toState()); });
app.get('/api/dev/rooms', (req, res) => res.json([...rooms.values()].map(r => ({ room: r.code, phase: r.game.phase, players: r.game.players.length, boards: r.boardSockets.size, sockets: socketsIn(r.code), idleSec: Math.round((Date.now() - r.lastActive) / 1000) }))));
app.post('/api/dev/bots', (req, res) => { const n = Number(req.query.n || 2); const added = []; for (let i = 0; i < n; i++) { const b = req.game.addBot(); if (b) added.push(b.id); } res.json({ ok: true, room: req.r.code, added }); });
app.post('/api/dev/start', (req, res) => res.json(req.game.start(null, { force: true })));
app.post('/api/dev/reset', (req, res) => { req.game.resetAll(); res.json({ ok: true }); });
app.post('/api/dev/again', (req, res) => res.json(req.game.playAgain('dev')));
app.post('/api/dev/fast', (req, res) => { req.game.fastMode = String(req.query.on ?? '1') !== '0'; res.json({ ok: true, fastMode: req.game.fastMode }); });
app.post('/api/dev/act', (req, res) => { req.game.autoAct(); res.json({ ok: true }); });
app.post('/api/dev/mini', (req, res) => { const game = req.game; const p = game.current(); if (!p || game.turnStep !== 'minigame') return res.json({ ok: false, error: 'no mini-game running' }); const score = req.query.score !== undefined ? Number(req.query.score) : game.botScore(game.minigame.type); res.json({ ...game.miniResult(p.id, game.minigame.id, score), type: game.minigame?.type, score }); });
app.get('/api/dev/stats', (req, res) => res.json({ ...req.game.stats, grabble: req.game.grabble }));
// dev: force a Catcher launch by the current player at a chosen target (default: Grabble if his bag has loot, else the richest other player)
app.post('/api/dev/launch', (req, res) => {
  const game = req.game; const p = game.current(); if (!p || game.phase !== 'playing') return res.json({ ok: false, error: 'no current player' });
  const others = game.others(p); const q = String(req.query.target || '');
  const t = q === 'grabble' ? 'grabble' : (others.find(o => o.id === q || o.name === q) || (!q && game.grabble.loot > 0 ? 'grabble' : null) || others.slice().sort((a, b) => b.shards - a.shards)[0]);
  if (!t) return res.json({ ok: false, error: 'no target' });
  const score = req.query.caught === '0' ? 0.1 : (req.query.perfect === '1' ? 0.53 : 0.4);
  game.clearTimers(); game.turnStep = 'choose_launch'; game.minigame = null; game.pushState();
  const r = game.chooseTarget(p.id, t === 'grabble' ? 'grabble' : t.id); if (!r.ok) return res.json(r);
  const wait = setInterval(() => { if (game.turnStep === 'minigame' && game.minigame?.type === 'bell' && game.minigame.playerId === p.id) { clearInterval(wait); if (!p.isBot) game.miniResult(p.id, game.minigame.id, score); } if (game.phase !== 'playing' || game.turnPlayerId !== p.id) clearInterval(wait); }, 100);
  wait.unref?.();
  res.json({ ok: true, by: p.name, target: t === 'grabble' ? 'Grabble' : t.name, score, note: p.isBot ? 'bot rings the bell itself' : 'bell scored for the human' });
});

const server = http.createServer(app);
io.attach(server);

// ---------------------------------------------------------------- sockets
io.on('connection', socket => {
  const headers = socket.handshake.headers;
  // phones pass ?room=CODE so they see taken heroes before joining
  const watch = roomBy(socket.handshake.query?.room);
  if (watch && socket.handshake.query?.role !== 'board') { socket.join(watch.code); socket.emit('state', watch.game.toState()); }
  const R = () => rooms.get(socket.data.room);
  const G = () => R()?.game;
  const noRoom = { ok: false, error: 'Wrong room code. Check the big screen.' };
  const call = (fn) => (p, ack = () => {}) => { const g = G(); if (!g) return ack(noRoom); R().lastActive = Date.now(); ack(fn(g, p || {})); };

  // a board either re-attaches to its room (same room code + key, e.g. after a reload) or opens a new room
  socket.on('board:hello', (p = {}, ack = () => {}) => {
    let r = roomBy(p.room); if (!r || r.boardKey !== p.key || p.fresh) r = createRoom(baseFor(headers));
    if (!r) return ack({ ok: false, error: 'The server is full right now. Try again in a few minutes.' });
    if (socket.data.room && socket.data.room !== r.code) socket.leave(socket.data.room);
    socket.join(r.code); socket.data.room = r.code; socket.data.isBoard = true; r.boardSockets.add(socket.id); r.lastActive = Date.now();
    if (!publicBase && r.game.players.length === 0) r.game.joinUrl = joinUrlFor(baseFor(headers), r.code); // follow the address the board is using
    r.game.setBoardConnected(true, !!p.ready);
    ack({ ok: true, room: r.code, key: r.boardKey, joinUrl: r.game.joinUrl }); socket.emit('state', r.game.toState());
  });
  socket.on('board:ready', () => { if (socket.data.isBoard) G()?.setBoardReady(true); });
  socket.on('board:animDone', ({ eventId } = {}) => { if (socket.data.isBoard) G()?.ackEvent(eventId); });

  socket.on('player:join', (payload = {}, ack = () => {}) => {
    const r = roomBy(payload.room); if (!r) return ack(noRoom);
    const res = r.game.join({ name: payload.name, heroId: payload.heroId, room: r.code, socketId: socket.id });
    if (res.ok) { socket.join(r.code); socket.data.room = r.code; socket.data.playerId = res.playerId; tokens.set(res.token, r.code); r.lastActive = Date.now(); }
    ack(res);
  });
  socket.on('player:rejoin', (payload = {}, ack = () => {}) => {
    const r = rooms.get(tokens.get(payload.token)); if (!r) return ack({ ok: false, error: 'unknown token' });
    const res = r.game.rejoin({ token: payload.token, socketId: socket.id });
    if (res.ok) { socket.join(r.code); socket.data.room = r.code; socket.data.playerId = res.playerId; r.lastActive = Date.now(); }
    ack(res);
  });
  socket.on('player:leave', call((g) => { if (socket.data.playerId) g.removePlayer(socket.data.playerId); return { ok: true }; }));
  socket.on('player:start', call((g) => g.start(socket.data.playerId)));
  socket.on('player:roll', call((g) => g.roll(socket.data.playerId)));
  socket.on('player:chooseTarget', call((g, p) => g.chooseTarget(socket.data.playerId, p.targetId)));
  socket.on('player:launchTiming', call((g, p) => g.launchTiming(socket.data.playerId, p.score)));
  socket.on('player:miniResult', call((g, p) => g.miniResult(socket.data.playerId, p.id, p.score)));
  socket.on('player:flight', call((g, p) => g.flight(socket.data.playerId, !!p.fly)));
  socket.on('player:playAgain', call((g) => g.playAgain(socket.data.playerId)));
  socket.on('player:miniTick', (p) => G()?.miniTick(socket.data.playerId, p?.id, p?.progress));
  // live picture of the phone's mini-game canvas → this room's boards only (≤ ~12 fps, only the current mini-game)
  socket.on('player:miniFrame', (p) => {
    const r = R(); const g = r?.game; const pid = socket.data.playerId;
    if (!g || !pid || !p?.frame || !g.minigame || g.minigame.playerId !== pid || g.minigame.id !== p.id) return;
    const now = Date.now(); if (now - (socket.data.lastFrame || 0) < 70) return; socket.data.lastFrame = now;
    for (const bid of r.boardSockets) io.to(bid).emit('minigame:frame', { playerId: pid, id: p.id, frame: p.frame });
  });
  socket.on('disconnect', () => {
    const r = R(); if (!r) return; r.lastActive = Date.now();
    if (socket.data.isBoard) { r.boardSockets.delete(socket.id); if (r.boardSockets.size === 0) r.game.setBoardConnected(false); }
    if (socket.data.playerId) r.game.disconnect(socket.data.playerId);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Kyah & Ayva: Starlight Gem Chase`);
  console.log(`  Board:   http://localhost:${PORT}/board/   (each board opens its own room)`);
  console.log(`  Phones:  scan the QR code on the board${publicBase ? `, or ${publicBase}/play/` : ` (same Wi-Fi: ${lanBase}/play/)`}\n`);
});
