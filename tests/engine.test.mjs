import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { SPACES, SPACE_COUNT, BRIDGE_INDEX, CASTLE_INDEX, FLIGHT_PAIRS, GRABBLE_START } from '../public/board/layout.js';

function fastGame(n = 3) { const g = new Game({ room: 'TEST', joinUrl: 'http://x' }); g.fastMode = true; for (let i = 0; i < n; i++) g.addBot('B' + i); return g; }
// player 0 is Ayva (easy tier: one bell per launch) unless heroes are given
function humanGame(n = 3, heroes = ['ayva', 'kyah', 'misssuds', 'baker', 'poodle', 'pup']) { const g = new Game({ room: 'TEST', joinUrl: 'http://x' }); g.fastMode = true; for (let i = 0; i < n; i++) g.join({ name: 'H' + i, heroId: heroes[i] }); return g; }
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
// waits for a condition; never blocks on the queue alone, because a launch waits there for the player's next bell
async function settle(g, pred, max = 4000) { const t0 = Date.now(); while (!pred() && Date.now() - t0 < max) { await Promise.race([g.queue, tick(20)]); await tick(); } }
async function started(g) { g.start(null, { force: true }); await settle(g, () => g.turnStep === 'roll'); g.clearTimers(); return g.current(); }
function parkGrabble(g, idx = 20) { g.grabble.space = idx; }

test('layout: 32 spaces, flights paired, bridge on the river, grabble starts in the garden', () => {
  assert.equal(SPACES.length, SPACE_COUNT); assert.equal(SPACES[BRIDGE_INDEX].type, 'bridge');
  for (const [a, b] of Object.entries(FLIGHT_PAIRS)) assert.equal(FLIGHT_PAIRS[b], Number(a));
  assert.notEqual(GRABBLE_START, CASTLE_INDEX); assert.ok(SPACES.filter(s => s.type === 'launch').length >= 3);
});

test('event payloads never let data overwrite id/type (round-1 regression)', async () => {
  const g = humanGame(2); const seen = []; g.on('event', e => seen.push(e));
  await g.sendEvent('space', { playerId: 'x', index: 3, spaceType: 'launch', type: 'HACK', id: 'HACK' });
  const ev = seen.pop(); assert.equal(ev.type, 'space'); assert.notEqual(ev.id, 'HACK'); assert.equal(ev.spaceType, 'launch');
});

test('join rules, host hand-off on disconnect', () => {
  const g = new Game({ room: 'T', joinUrl: 'u' });
  const a = g.join({ name: 'A', heroId: 'kyah' }); const b = g.join({ name: 'B', heroId: 'ayva' });
  assert.equal(g.hostId, a.playerId); assert.equal(g.join({ name: 'C', heroId: 'kyah' }).ok, false);
  g.hostGraceMs = 1; g.disconnect(a.playerId); assert.equal(g.hostId, a.playerId, 'host kept during the grace period');
  return new Promise(res => setTimeout(() => { assert.equal(g.hostId, b.playerId, 'host handed over after the grace period'); res(); }, 30));
});

test('a full bot game ends with a player or Grabble winning', async () => {
  const g = fastGame(4); g.start(null, { force: true });
  await settle(g, () => g.phase === 'ended', 30000);
  assert.equal(g.phase, 'ended');
  if (g.winnerId === 'grabble') assert.ok(g.grabble.loot >= g.grabbleTarget); else assert.ok(g.player(g.winnerId).shards >= g.winTarget);
  for (const p of g.players) assert.ok(p.shards >= 0 && p.space >= 0 && p.space < SPACE_COUNT);
});

test('landing on a shard space starts the shard mini-game and scores it', async () => {
  const g = humanGame(2); const a = await started(g); parkGrabble(g);
  const shardIdx = SPACES.find(s => s.type === 'shard' && s.index > 0).index; a.space = shardIdx - 1;
  const orig = Math.random; Math.random = () => 0; // roll 1
  try { g.roll(a.id); await settle(g, () => g.turnStep === 'minigame'); } finally { Math.random = orig; }
  assert.equal(g.minigame.type, 'shard'); assert.equal(g.minigame.playerId, a.id);
  assert.equal(g.minigame.params.tier, 'easy'); assert.equal(g.minigame.params.cfg.rounds, 7);
  assert.ok(g.miniResult(a.id, g.minigame.id, 6).ok); await settle(g, () => g.turnPlayerId !== a.id);
  assert.equal(a.shards, 2, 'six of seven = two shards at Ayva\'s level');
});

test('chase: passing Grabble pauses the move; a good vine grab takes loot back', async () => {
  const g = humanGame(2); const a = await started(g);
  a.space = 10; g.grabble.space = 12; g.grabble.loot = 3; a.shards = 0;
  const orig = Math.random; Math.random = () => 0.5; // roll 4 → lands on 14, passes 12
  try { g.roll(a.id); await settle(g, () => g.turnStep === 'minigame'); } finally { Math.random = orig; }
  assert.equal(g.minigame.type, 'chase'); assert.equal(a.space, 12, 'paused at Grabble');
  assert.ok(g.miniResult(a.id, g.minigame.id, 0.64).ok); // perfect
  await settle(g, () => g.turnStep !== 'minigame' && g.turnStep !== 'resolving' && g.turnStep !== 'moving', 6000);
  assert.equal(a.shards, 3); assert.equal(g.grabble.loot, 0); assert.equal(a.space === 14 || g.turnStep === 'minigame', true);
});

test('Grabble snatches when he passes a player and wins at his target', async () => {
  const g = humanGame(2); const [a, b] = g.players; g.start(null, { force: true }); await settle(g, () => g.turnStep === 'roll'); g.clearTimers();
  g.grabble.space = 20; a.space = 21; a.shards = 1; b.space = 22; b.shards = 1; g.grabbleTarget = 2;
  const orig = Math.random; Math.random = () => 0.99; // Grabble rolls 3 → passes 21, 22
  try { await g.grabbleTurn(); } finally { Math.random = orig; }
  assert.equal(a.shards, 0); assert.equal(b.shards, 0); assert.equal(g.grabble.loot, 2);
  await settle(g, () => g.phase === 'ended'); assert.equal(g.winnerId, 'grabble');
});

test('launch can target Grabble: catching him takes up to 3 loot and sends him home', async () => {
  const g = humanGame(2); const a = await started(g); parkGrabble(g, 5); g.grabble.loot = 5; a.shards = 0;
  g.turnStep = 'choose_launch'; assert.ok(g.chooseTarget(a.id, 'grabble').ok);
  await settle(g, () => g.turnStep === 'minigame'); assert.equal(g.minigame.type, 'bell'); assert.equal(g.grabble.space, BRIDGE_INDEX);
  assert.ok(g.miniResult(a.id, g.minigame.id, 0.4).ok); await settle(g, () => g.turnPlayerId !== a.id, 8000);
  assert.equal(a.shards, 3); assert.ok(g.grabble.loot <= 1, 'bag emptied (he may pocket one on his next scurry)'); assert.equal(g.grabble.lastMove.from, GRABBLE_START, 'Grabble was sent home before his next scurry');
});

test('launch at a friend: catch moves one shard, miss moves nothing', async () => {
  const g = humanGame(3); const a = await started(g); parkGrabble(g); const [, b, c] = g.players; b.shards = 2; c.shards = 0;
  g.turnStep = 'choose_launch'; assert.ok(g.chooseTarget(a.id, b.id).ok); await settle(g, () => g.turnStep === 'minigame');
  c.space = BRIDGE_INDEX; assert.ok(g.miniResult(a.id, g.minigame.id, 0.4).ok); await settle(g, () => g.turnPlayerId !== a.id, 8000);
  assert.equal(a.shards, 1); assert.equal(b.shards, 1); assert.equal(c.shards, 0);
});

test('fetch takes from Grabble first, otherwise asks for a friend', async () => {
  const g = humanGame(2); const a = await started(g); parkGrabble(g); const b = g.players[1]; b.shards = 2; g.grabble.loot = 1;
  await g.resolveSpace(a, SPACES.find(s => s.type === 'fetch').index); assert.equal(g.minigame.type, 'fetch'); assert.equal(g.minigame.params.source, 'grabble');
  g.miniResult(a.id, g.minigame.id, 3); await settle(g, () => g.turnPlayerId !== a.id, 6000); assert.ok(g.grabble.loot <= 1, 'bag emptied by the fetch (he may pocket one on his next scurry)'); assert.ok(a.shards >= 1);
  // now with an empty bag: choose a friend
  const g2 = humanGame(2); const a2 = await started(g2); parkGrabble(g2); g2.players[1].shards = 2;
  await g2.resolveSpace(a2, SPACES.find(s => s.type === 'fetch').index); assert.equal(g2.turnStep, 'choose_fetch');
});

test('win is decided at end of turn from live counts; lap bonus once; flight pairs', async () => {
  const g = humanGame(2); const a = await started(g); parkGrabble(g, 3);
  a.space = 29; a.shards = 0; const orig = Math.random; Math.random = () => 0.99; // roll 6 → passes the castle
  try { g.roll(a.id); await settle(g, () => g.turnStep === 'minigame' || g.turnPlayerId !== a.id, 6000); } finally { Math.random = orig; }
  if (g.turnStep === 'minigame') { g.miniResult(a.id, g.minigame.id, 0); await settle(g, () => g.turnPlayerId !== a.id, 6000); }
  assert.ok(a.lapDone); assert.ok(a.shards >= 2);
  const b = g.current(); b.shards = g.winTarget; g.turnPlayerId = b.id; g.turnStep = 'resolving'; await g.endTurn(); assert.equal(g.winnerId, b.id); assert.equal(g.phase, 'ended');
});

test('Benny is sweet on Miss Suds: greeting at start, compliment when crossing paths, biggest cake slice', async () => {
  const g = new Game({ room: 'T', joinUrl: 'u' }); g.fastMode = true; const seen = [];
  g.join({ name: 'Ben', heroId: 'baker' }); g.join({ name: 'Sue', heroId: 'misssuds' }); g.on('event', e => { if (e.type === 'flirt') seen.push(e.key); });
  g.start(null, { force: true }); await settle(g, () => g.turnStep === 'roll'); g.clearTimers();
  assert.ok(seen.includes('benny_hello'), 'greets her at the start');
  const [ben, sue] = g.players; parkGrabble(g, 20); sue.space = 3; ben.space = 1;
  const orig = Math.random; Math.random = () => 0.5; // roll 4: 1 → 5, passing her on 3
  try { g.roll(ben.id); await settle(g, () => g.turnStep === 'minigame' || g.turnPlayerId !== ben.id, 6000); } finally { Math.random = orig; }
  assert.ok(seen.some(k => k.startsWith('benny_c')), 'compliments her when passing');
  if (g.turnStep === 'minigame') g.miniResult(ben.id, g.minigame.id, 0);
  await settle(g, () => g.turnPlayerId === ben.id && g.turnStep === 'roll', 8000); g.clearTimers();
  sue.shards = 0; ben.shards = 0; await g.resolveSpace(ben, SPACES.find(s => s.type === 'cake').index);
  assert.equal(sue.shards, 2, 'cake +1 for everyone and the biggest slice for Miss Suds'); assert.equal(ben.shards, 1); assert.ok(seen.includes('benny_cake'));
  // no pair → no flirting
  const g2 = new Game({ room: 'T', joinUrl: 'u' }); g2.fastMode = true; const seen2 = []; g2.join({ name: 'Ben', heroId: 'baker' }); g2.join({ name: 'K', heroId: 'kyah' }); g2.on('event', e => { if (e.type === 'flirt') seen2.push(e.key); });
  g2.start(null, { force: true }); await settle(g2, () => g2.turnStep === 'roll'); g2.clearTimers(); assert.equal(seen2.length, 0);
});

test('difficulty by hero: grown-ups hard, Kyah medium, Ayva easy, dogs random', async () => {
  const { tierFor, MINI } = await import('../public/shared/difficulty.js');
  assert.equal(tierFor('misssuds'), 'hard'); assert.equal(tierFor('baker'), 'hard'); assert.equal(tierFor('kyah'), 'medium'); assert.equal(tierFor('ayva'), 'easy');
  const seen = new Set(); for (let i = 0; i < 60; i++) seen.add(tierFor('pup')); assert.equal(seen.size, 3, 'dogs roll every tier');
  assert.ok(MINI.bell.hard.zone[1] - MINI.bell.hard.zone[0] < MINI.bell.medium.zone[1] - MINI.bell.medium.zone[0]);
  assert.ok(MINI.flight.hard.rings > MINI.flight.easy.rings && MINI.shard.hard.decoys > 0);
  const g = humanGame(2, ['baker', 'kyah']); const a = await started(g); parkGrabble(g);
  await g.resolveSpace(a, SPACES.find(s => s.type === 'shard').index);
  assert.equal(g.minigame.params.tier, 'hard'); assert.equal(g.minigame.params.cfg.rounds, 10);
  g.miniResult(a.id, g.minigame.id, 9, { failed: true }); await settle(g, () => g.turnPlayerId !== a.id);
  assert.equal(a.shards, 0, 'tapping a decoy fails the game');
});

test('grown-up launch: four bells, one per section; a miss at any section fizzles; a perfect earns +1', async () => {
  const g = humanGame(2, ['misssuds', 'ayva']); const a = await started(g); parkGrabble(g); const b = g.players[1]; b.shards = 3; a.shards = 0;
  g.turnStep = 'choose_launch'; assert.ok(g.chooseTarget(a.id, b.id).ok); await settle(g, () => g.turnStep === 'minigame');
  assert.equal(g.minigame.params.gateCount, 4); assert.equal(g.minigame.params.tier, 'hard');
  const answer = async (score) => { await settle(g, () => g.turnStep === 'minigame'); const m = g.minigame; assert.ok(g.miniResult(a.id, m.id, score).ok); return m.params.gateIndex; };
  assert.equal(await answer(0.52), 0);  // perfect bell
  assert.equal(await answer(0.45), 1); assert.equal(await answer(0.45), 2); assert.equal(await answer(0.45), 3);
  await settle(g, () => g.turnPlayerId !== a.id, 8000);
  assert.equal(b.shards, 2, 'caught'); assert.equal(a.shards, 2, 'one from the catch, one for the perfect bell');
  // next launch: miss the third bell
  g.turnPlayerId = a.id; g.turnStep = 'choose_launch'; g.clearTimers(); b.space = 5; a.shards = 0; b.shards = 3;
  assert.ok(g.chooseTarget(a.id, b.id).ok);
  await answer(0.45); await answer(0.45); assert.equal(await answer(0.9), 2);
  await settle(g, () => g.turnPlayerId !== a.id, 8000);
  assert.equal(b.shards, 3, 'the machine fizzled: missed'); assert.equal(a.shards, 0);
});

test('host can end the game mid-turn without anything leaking into the next game', async () => {
  const g = humanGame(3); const a = await started(g); parkGrabble(g); const host = g.hostId;
  g.turnStep = 'choose_launch'; g.chooseTarget(a.id, g.players[1].id); await settle(g, () => g.turnStep === 'minigame');
  assert.equal(g.endToLobby(g.players[1].id).ok, false, 'only the host');
  assert.ok(g.endToLobby(host).ok); assert.equal(g.phase, 'lobby'); assert.equal(g.players.length, 3);
  await settle(g, () => false, 300);
  assert.equal(g.phase, 'lobby'); assert.equal(g.turnStep, null); assert.ok(g.players.every(p => p.shards === 0));
  assert.ok(g.start(host).ok); await settle(g, () => g.turnStep === 'roll'); assert.equal(g.phase, 'playing');
  g.clearTimers();
});

test('bots and timed-out phones can score every mini-game at every tier (regression: a crash here stopped the server)', async () => {
  const { MINI, maxScore } = await import('../public/shared/difficulty.js');
  const g = new Game({ room: 'T', joinUrl: 'u' });
  for (const skill of [null, 0, 1]) { g.botSkill = skill;
    for (const [type, tiers] of Object.entries(MINI)) for (const [tier, cfg] of Object.entries(tiers)) for (let i = 0; i < 40; i++) {
      const v = g.botScore(type, { tier, cfg }); assert.ok(Number.isFinite(v), `${type}/${tier}`);
      if (type !== 'bell' && type !== 'chase') assert.ok(v >= 0 && v <= maxScore(type, cfg), `${type}/${tier} in range`);
    } }
});
