// Integration test: real server process, real websockets (socket.io v4 wire protocol), several rooms at once.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
const base = `http://localhost:${PORT}`;
let srv;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function client(query = {}) {
  const qs = new URLSearchParams({ EIO: '4', transport: 'websocket', ...query }).toString();
  const ws = new WebSocket(`ws://localhost:${PORT}/socket.io/?${qs}`);
  let ackId = 0; const acks = new Map(); const states = []; let ready;
  const opened = new Promise(r => { ready = r; });
  ws.onmessage = (e) => { const m = String(e.data);
    if (m.startsWith('0')) ws.send('40'); else if (m === '2') ws.send('3');
    else if (m.startsWith('40')) ready();
    else if (m.startsWith('43')) { const i = m.indexOf('['); const id = Number(m.slice(2, i)); acks.get(id)?.(JSON.parse(m.slice(i))[0]); acks.delete(id); }
    else if (m.startsWith('42')) { const [ev, data] = JSON.parse(m.slice(2)); if (ev === 'state') states.push(data); } };
  return { opened, states, close: () => ws.close(),
    emit: (ev, data) => new Promise(res => { const id = ackId++; acks.set(id, res); ws.send(`42${id}` + JSON.stringify([ev, data])); setTimeout(() => res({ timeout: true }), 4000); }) };
}

before(async () => {
  srv = spawn(process.execPath, [path.join(root, 'server/index.js')], { env: { ...process.env, PORT: String(PORT), PUBLIC_URL: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${base}/healthz`)).ok) return; } catch {} await sleep(100); }
  throw new Error('server did not start');
});
after(() => srv?.kill());

test('each board gets its own room; players join the right one; wrong codes are refused', async () => {
  const b1 = client(); const b2 = client(); await Promise.all([b1.opened, b2.opened]);
  const r1 = await b1.emit('board:hello', { ready: true }); const r2 = await b2.emit('board:hello', { ready: true });
  assert.ok(r1.ok && r2.ok); assert.notEqual(r1.room, r2.room); assert.match(r1.joinUrl, new RegExp(`/play/\\?room=${r1.room}$`));
  // a phone watching room 1 sees its state before joining
  const p1 = client({ room: r1.room }); await p1.opened; await sleep(100); assert.equal(p1.states.at(-1)?.room, r1.room);
  const j1 = await p1.emit('player:join', { room: r1.room, name: 'Ann', heroId: 'kyah' }); assert.ok(j1.ok);
  const p2 = client(); await p2.opened;
  const j2 = await p2.emit('player:join', { room: r2.room, name: 'Bo', heroId: 'kyah' }); assert.ok(j2.ok, 'the same hero is free in the other room');
  const bad = await p2.emit('player:join', { room: 'ZZZZ', name: 'X' }); assert.equal(bad.ok, false); assert.match(bad.error, /room/i);
  // a reloaded board re-attaches to its room with its key; a wrong key opens a new room
  const b1b = client(); await b1b.opened; const again = await b1b.emit('board:hello', { room: r1.room, key: r1.key }); assert.equal(again.room, r1.room);
  const b3 = client(); await b3.opened; const other = await b3.emit('board:hello', { room: r1.room, key: 'nope' }); assert.notEqual(other.room, r1.room);
  // a phone reload rejoins by token
  const p1b = client(); await p1b.opened; const rj = await p1b.emit('player:rejoin', { token: j1.token }); assert.ok(rj.ok); assert.equal(rj.state.room, r1.room);
  const rooms = await (await fetch(`${base}/api/dev/rooms`)).json(); assert.ok(rooms.length >= 3);
  for (const c of [b1, b2, p1, p2, b1b, b3, p1b]) c.close();
});
