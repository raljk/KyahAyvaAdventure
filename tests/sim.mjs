// Balance simulator: runs N fast bot games and reports pacing. Usage: node tests/sim.mjs [games] [players] [winTarget] [grabbleTarget] [grabbleDice]
import { Game } from '../server/game.js';
import { maxScore } from '../public/shared/difficulty.js';
const [games = 200, players = 4, winTarget = 10, grabbleTarget = 8, grabbleDice = 4] = process.argv.slice(2).map(Number);
const KID = process.env.KID === '1'; // score like an average kid (rates measured by the phone agent's model) instead of the 70 % bot
const r = Math.random;
// an average kid (rates measured by the phone agent's model at the easy tier); harder tiers succeed less often
const KID_HIT = { flight: 0.89, shard: 0.9, fetch: 0.95, swish: 0.84, cake: 0.93, chase: 0.72, bell: 0.77 };
const TIER_MULT = { easy: 1, medium: 0.85, hard: 0.72 };
const kidScore = (type, params) => { const cfg = params?.cfg || {}; const tier = params?.tier || 'easy'; const hit = r() < (KID_HIT[type] ?? 0.7) * (TIER_MULT[tier] ?? 1); const max = maxScore(type, cfg); const span = (a, b) => a + Math.floor(r() * (b - a + 1));
  switch (type) {
    case 'bell': case 'chase': { const [a, b] = cfg.zone || [0.3, 0.75]; return hit ? a + r() * (b - a) : (r() < 0.5 ? r() * a * 0.95 : b + (1 - b) * (0.05 + r() * 0.95)); }
    case 'swish': return hit ? max : span(0, max - 1);
    case 'shard': case 'fetch': case 'flight': case 'cake': return hit ? span(Math.ceil(max * 0.55), max) : span(0, Math.ceil(max * 0.3));
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
