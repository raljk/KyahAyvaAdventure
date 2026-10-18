// Balance simulator: runs N fast bot games and reports pacing. Usage: node tests/sim.mjs [games] [players] [winTarget] [grabbleTarget] [grabbleDice]
import { Game } from '../server/game.js';
const [games = 200, players = 4, winTarget = 10, grabbleTarget = 8, grabbleDice = 4] = process.argv.slice(2).map(Number);
const KID = process.env.KID === '1'; // score like an average kid (rates measured by the phone agent's model) instead of the 70 % bot
const r = Math.random;
const kidScore = (type) => { switch (type) {
  case 'flight': return r() < 0.89 ? (r() < 0.45 / 0.89 ? 4 + Math.floor(r() * 5) : 1 + Math.floor(r() * 3)) : 0;
  case 'shard': return r() < 0.68 ? 5 + Math.floor(r() * 2) : 1 + Math.floor(r() * 4);
  case 'fetch': return r() < 0.97 ? 1 + Math.floor(r() * 3) : 0;
  case 'swish': return r() < 0.84 ? 3 : Math.floor(r() * 3);
  case 'cake': return r() < 0.93 ? 5 + Math.floor(r() * 4) : Math.floor(r() * 5);
  case 'chase': return r() < 0.72 ? 0.45 + r() * 0.35 : r() * 0.4;
  case 'bell': return r() < 0.77 ? 0.30 + r() * 0.45 : r() * 0.28;
  default: return 0; } };
// estimated real-time cost per thing on a visible board (seconds)
const COST = { turn: 9, minigame: 14, launch: 42, chase: 16, grabbleMove: 3 };
const tick = (ms = 2) => new Promise(r => setTimeout(r, ms));
const res = [];
for (let i = 0; i < games; i++) {
  const g = new Game({ room: 'SIM', joinUrl: 'x', winTarget, grabbleTarget, grabbleDice }); g.fastMode = true; if (KID) g.botScore = kidScore;
  let launchEvents = 0; g.on('event', e => { if (e.type === 'launch') launchEvents++; });
  for (let k = 0; k < players; k++) g.addBot('B' + k);
  g.start(null, { force: true }); const t0 = Date.now();
  while (g.phase !== 'ended' && Date.now() - t0 < 60000) { await g.queue; await tick(); }
  const s = g.stats; const minutes = (s.turns * COST.turn + s.minigames * COST.minigame + s.launches * COST.launch + s.chases * COST.chase + s.turns * COST.grabbleMove) / 60;
  res.push({ ...s, launches: launchEvents, minutes, grabbleWon: g.winnerId === 'grabble', loot: g.grabble.loot, maxShards: Math.max(...g.players.map(p => p.shards)) });
}
const avg = (k) => (res.reduce((a, r) => a + r[k], 0) / res.length).toFixed(1);
console.log(`games=${games} players=${players} winTarget=${winTarget} grabbleTarget=${grabbleTarget} grabbleDice=${grabbleDice} scoring=${KID ? 'kid' : 'bot'}`);
console.log(`turns/game ${avg('turns')} | minigames ${avg('minigames')} | launches ${avg('launches')} | chases ${avg('chases')} | est. minutes ${avg('minutes')}`);
console.log(`Grabble wins ${(100 * res.filter(r => r.grabbleWon).length / res.length).toFixed(0)}% | games with <5 launches ${(100 * res.filter(r => r.launches < 5).length / res.length).toFixed(0)}% | avg final loot ${avg('loot')}`);
