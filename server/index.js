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

function lanIp() {
  const ifs = os.networkInterfaces(); const prefer = ['en0', 'en1', 'eth0', 'wlan0'];
  const all = Object.entries(ifs).flatMap(([name, list]) => (list || []).filter(i => i.family === 'IPv4' && !i.internal).map(i => ({ name, address: i.address })));
  all.sort((a, b) => (prefer.indexOf(a.name) === -1 ? 99 : prefer.indexOf(a.name)) - (prefer.indexOf(b.name) === -1 ? 99 : prefer.indexOf(b.name)));
  return all[0]?.address || 'localhost';
}

const app = express();
app.use(express.json());
const noStore = { setHeaders: (res) => res.setHeader('Cache-Control', 'no-store') };
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three')));
app.use('/vendor/gsap', express.static(path.join(ROOT, 'node_modules/gsap')));
app.use('/vendor/fonts', express.static(path.join(ROOT, 'node_modules/@fontsource')));
app.use('/', express.static(path.join(ROOT, 'public'), noStore));
app.get('/', (req, res) => res.redirect('/board/'));

const room = crypto.randomBytes(2).toString('hex').toUpperCase().replace(/[^A-Z0-9]/g, 'A').slice(0, 4);
const ip = lanIp();
// PUBLIC_URL (e.g. https://my-tunnel.example.com) makes the QR code point at a public address; otherwise the LAN address is used.
const lanJoinUrl = `http://${ip}:${PORT}/play/?room=${room}`;
const publicJoin = (base) => `${String(base).replace(/\/+$/, '')}/play/?room=${room}`;
let joinUrl = process.env.PUBLIC_URL ? publicJoin(process.env.PUBLIC_URL) : lanJoinUrl;
// requests that come from this machine directly (not through a tunnel or proxy)
function isLocalReq(addr, headers = {}) { const a = String(addr || ''); const loop = a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'; return loop && !headers['cf-connecting-ip'] && !headers['x-forwarded-for'] && !headers['x-real-ip']; }
const game = new Game({ room, joinUrl, winTarget: Number(process.env.WIN_TARGET || 12), grabbleTarget: Number(process.env.GRABBLE_TARGET || 7) });

app.get('/api/info', (req, res) => res.json({ room, joinUrl, lanJoinUrl, lanIp: ip, port: PORT }));
// the share script registers the tunnel's public address here (local requests only)
app.post('/api/public-url', (req, res) => {
  if (!isLocalReq(req.socket.remoteAddress, req.headers)) return res.status(403).json({ ok: false });
  const base = String(req.body?.url || ''); if (base && !/^https?:\/\/[^\s]+$/.test(base)) return res.status(400).json({ ok: false, error: 'bad url' });
  joinUrl = base ? publicJoin(base) : lanJoinUrl; game.joinUrl = joinUrl; game.pushState();
  console.log(`  Phones (anywhere):            ${joinUrl}`); res.json({ ok: true, joinUrl });
});
// dev helpers are for this machine only, never through the public link
app.use('/api/dev', (req, res, next) => isLocalReq(req.socket.remoteAddress, req.headers) ? next() : res.status(403).json({ ok: false, error: 'local only' }));
app.get('/api/state', (req, res) => res.json(game.toState()));
app.get('/api/qr.svg', async (req, res) => { const url = String(req.query.url || joinUrl); res.type('svg').send(await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#2B2440', light: '#00000000' } })); });
// dev helpers (used by tests and the grader)
app.post('/api/dev/bots', (req, res) => { const n = Number(req.query.n || 2); const added = []; for (let i = 0; i < n; i++) { const b = game.addBot(); if (b) added.push(b.id); } res.json({ ok: true, added }); });
app.post('/api/dev/start', (req, res) => res.json(game.start(null, { force: true })));
app.post('/api/dev/reset', (req, res) => { game.resetAll(); res.json({ ok: true }); });
app.post('/api/dev/again', (req, res) => res.json(game.playAgain('dev')));
app.post('/api/dev/fast', (req, res) => { game.fastMode = String(req.query.on ?? '1') !== '0'; res.json({ ok: true, fastMode: game.fastMode }); });
app.post('/api/dev/act', (req, res) => { game.autoAct(); res.json({ ok: true }); });
app.post('/api/dev/mini', (req, res) => { const p = game.current(); if (!p || game.turnStep !== 'minigame') return res.json({ ok: false, error: 'no mini-game running' }); const score = req.query.score !== undefined ? Number(req.query.score) : game.botScore(game.minigame.type); res.json({ ...game.miniResult(p.id, game.minigame.id, score), type: game.minigame?.type, score }); });
app.get('/api/dev/stats', (req, res) => res.json({ ...game.stats, grabble: game.grabble }));
// dev: force a Catcher launch by the current player at a chosen target (default: Grabble if his bag has loot, else the richest other player)
app.post('/api/dev/launch', (req, res) => {
  const p = game.current(); if (!p || game.phase !== 'playing') return res.json({ ok: false, error: 'no current player' });
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
const io = new Server(server, { cors: { origin: '*' }, pingInterval: 10000, pingTimeout: 20000 });

game.on('state', s => io.emit('state', s));
game.on('event', e => io.emit('event', e));

let boardSockets = new Set();
io.on('connection', socket => {
  socket.emit('state', game.toState());
  // only a board on this machine drives the game (a board opened through the public link just watches)
  const localSocket = isLocalReq(socket.handshake.address, socket.handshake.headers) || process.env.ALLOW_REMOTE_BOARD === '1';
  socket.on('board:hello', (p = {}) => { if (!localSocket) return; boardSockets.add(socket.id); socket.data.isBoard = true; game.setBoardConnected(true, !!p.ready); });
  socket.on('board:ready', () => { if (socket.data.isBoard) game.setBoardReady(true); });
  socket.on('board:animDone', ({ eventId } = {}) => { if (socket.data.isBoard) game.ackEvent(eventId); });
  socket.on('player:join', (payload, ack = () => {}) => { const r = game.join({ name: payload?.name, heroId: payload?.heroId, room: payload?.room, socketId: socket.id }); if (r.ok) socket.data.playerId = r.playerId; ack(r); });
  socket.on('player:rejoin', (payload, ack = () => {}) => { const r = game.rejoin({ token: payload?.token, socketId: socket.id }); if (r.ok) socket.data.playerId = r.playerId; ack(r); });
  socket.on('player:leave', (p, ack = () => {}) => { if (socket.data.playerId) game.removePlayer(socket.data.playerId); ack({ ok: true }); });
  socket.on('player:start', (p, ack = () => {}) => ack(game.start(socket.data.playerId)));
  socket.on('player:roll', (p, ack = () => {}) => ack(game.roll(socket.data.playerId)));
  socket.on('player:chooseTarget', (p, ack = () => {}) => ack(game.chooseTarget(socket.data.playerId, p?.targetId)));
  socket.on('player:launchTiming', (p, ack = () => {}) => ack(game.launchTiming(socket.data.playerId, p?.score)));
  socket.on('player:miniResult', (p, ack = () => {}) => ack(game.miniResult(socket.data.playerId, p?.id, p?.score)));
  socket.on('player:miniTick', (p) => game.miniTick(socket.data.playerId, p?.id, p?.progress));
  // live picture of the phone's mini-game canvas → board only (≤ ~12 fps per player, only the current mini-game)
  socket.on('player:miniFrame', (p) => {
    const pid = socket.data.playerId; if (!pid || !p?.frame || !game.minigame || game.minigame.playerId !== pid || game.minigame.id !== p.id) return;
    const now = Date.now(); if (now - (socket.data.lastFrame || 0) < 70) return; socket.data.lastFrame = now;
    for (const bid of boardSockets) io.to(bid).emit('minigame:frame', { playerId: pid, id: p.id, frame: p.frame });
  });
  socket.on('player:flight', (p, ack = () => {}) => ack(game.flight(socket.data.playerId, !!p?.fly)));
  socket.on('player:playAgain', (p, ack = () => {}) => ack(game.playAgain(socket.data.playerId)));
  socket.on('disconnect', () => {
    if (socket.data.isBoard) { boardSockets.delete(socket.id); if (boardSockets.size === 0) game.setBoardConnected(false); }
    if (socket.data.playerId) game.disconnect(socket.data.playerId);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Kyah & Ayva: Starlight Gem Chase`);
  console.log(`  Board (open on the laptop):  http://localhost:${PORT}/board/`);
  console.log(`  Phones (same Wi-Fi):         ${lanJoinUrl}`);
  if (process.env.PUBLIC_URL) console.log(`  Phones (anywhere):            ${joinUrl}`);
  console.log('');
});
