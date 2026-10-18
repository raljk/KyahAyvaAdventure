// Rules engine v2 for Kyah & Ayva: Starlight Gem Chase. See docs/game-design-v2.md and docs/protocol.md.
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { SPACES, SPACE_COUNT, BRIDGE_INDEX, CASTLE_INDEX, FLIGHT_PAIRS, WIN_TARGET_DEFAULT, GRABBLE_TARGET_DEFAULT, GRABBLE_START, nextIndex, pathBetween } from '../public/board/layout.js';
import { HEROES, HERO_BY_ID } from '../public/shared/heroes.js';

const SWEET = [0.30, 0.75];
const PERFECT = [0.48, 0.58];
const CHASE_ZONE = [0.45, 0.80]; const CHASE_PERFECT = [0.60, 0.68];
const TIMEOUTS = { roll: 90_000, rollNudge: 40_000, choose: 30_000, minigame: 25_000, disconnected: 3_000, bot: 1_200, botMini: 1_600 };
const MINI_TYPES = ['flight', 'shard', 'fetch', 'swish', 'cake', 'chase', 'bell'];

const FRIENDLY = {
  shard: (p, n) => ({ text: `${p.name} found ${n === 2 ? 'two shards' : 'a Starlight Shard'}!`, word: 'TING!' }),
  shard_none: (p) => ({ text: `The shard slipped away from ${p.name}. Next time!`, word: '' }),
  swish: (p) => ({ text: `Grabble snatched a shard from ${p.name}!`, word: 'SWISH!' }),
  swish_safe: (p) => ({ text: `${p.name} hopped away! Grabble tripped over his net!`, word: 'HOP!' }),
  swish_empty: (p) => ({ text: `Grabble's net came up empty for ${p.name}.`, word: 'SWISH!' }),
  fetch: (p, src, n) => ({ text: `Charli fetched ${n === 2 ? 'two shards' : 'a shard'} from ${src} for ${p.name}!`, word: 'WOOF!' }),
  fetch_none: (p) => ({ text: `Charli came back with nothing. Good try, ${p.name}!`, word: 'WOOF!' }),
  cake: () => ({ text: 'Teatime! Cake for everyone! +1 shard each.', word: 'CAKE!' }),
  cake_bonus: (p) => ({ text: `Perfect cake! An extra slice for ${p.name}!`, word: 'CAKE!' }),
  cobble: (p) => ({ text: `${p.name} rests on the cobblestones.`, word: '' }),
  bridge: (p) => ({ text: `${p.name} is on the bridge, right under the Catcher!`, word: 'UH-OH!' }),
  flight_go: (p, bonus) => ({ text: `${p.name} flew across the village${bonus ? ' and found a bonus shard' : ''}!`, word: 'WHOOSH!' }),
  flight_stay: (p) => ({ text: `${p.name} tumbled and stayed put.`, word: '' }),
  lap: (p) => ({ text: `${p.name} made it home to the castle! +2 shards!`, word: 'HOME!' }),
  launch_choose: (p) => ({ text: `${p.name} is launching the Catcher!`, word: 'DING!' }),
  sent: (p, t) => ({ text: `${p.name} sent ${t} to the bridge!`, word: 'UH-OH!' }),
  caught: (p, names) => ({ text: `Caught! ${names} got stuck in the flower basket!`, word: 'STUCK!' }),
  caught_grabble: (p, n) => ({ text: `Grabble is stuck! ${p.name} took ${n} of his shards and the rest scattered!`, word: 'STUCK!' }),
  missed: () => ({ text: 'The basket swung wide. Missed!', word: 'HOP!' }),
  win: (p) => ({ text: `${p.name} made the Starlight Gem whole!`, word: 'WE DID IT!' }),
  grabble_win: () => ({ text: 'Grabble filled his bag and ran off with the starlight!', word: 'OH NO!' }),
  grabble_snatch: (p) => ({ text: `Grabble scurried past and snatched a shard from ${p.name}!`, word: 'SWISH!' }),
  grabble_pocket: () => ({ text: 'Grabble pocketed a shard. Especially shiny things!', word: 'SWISH!' }),
  chase_start: (p) => ({ text: `${p.name} caught up with Grabble! Flowers, catch him!`, word: 'BLOOM!' }),
  chase_win: (p, n) => ({ text: `Got it! ${p.name} took ${n} shard${n === 1 ? '' : 's'} back from Grabble!`, word: 'GOT IT!' }),
  chase_empty: (p) => ({ text: `${p.name} caught Grabble, but his bag was empty!`, word: 'HOP!' }),
  chase_miss: (p) => ({ text: `Hop! Grabble skipped away from ${p.name}!`, word: 'HOP!' }),
  mini: (p, label) => ({ text: `${p.name} is playing ${label}!`, word: '' }),
};
// Benny the baker is sweet on Miss Suds. These only play when both are in the game.
const FLIRT = {
  benny_hello: 'Good morning, Miss Suds! You look as bright as a sunbeam today!',
  benny_c1: 'Miss Suds, your bubbles are the sparkliest in the whole village!',
  benny_c2: 'A fresh bun for the loveliest pet washer in town!',
  benny_c3: 'After you, Miss Suds! Kindness first!',
  benny_c4: 'Miss Suds, you make every puppy smile. And me too!',
  benny_c5: 'Is it warm in here, or is it just your smile, Miss Suds?',
  benny_shy: 'Oh! Hi, Miss Suds… I mean, um, hello!',
  benny_cake: 'The biggest slice of cake for Miss Suds!',
  benny_sorry: 'Sorry, Miss Suds, nothing personal! You look lovely even in a flower basket!',
  benny_gift: "That one's for you, Miss Suds!",
  benny_cheer: "Go, Miss Suds! You've got this!",
  misssuds_thanks: 'Why, thank you, Benny!',
};
const COMPLIMENTS = ['benny_c1', 'benny_c2', 'benny_c3', 'benny_c4', 'benny_c5'];
const MINI_LABELS = { flight: 'Fairy Flight', shard: 'Look Under the Flowers', fetch: 'Charli Fetch', swish: 'Dodge the Net', cake: 'Strawberry Catch', chase: 'Vine Grab', bell: 'Ring the Bell' };

export class Game extends EventEmitter {
  constructor({ room, joinUrl, winTarget = WIN_TARGET_DEFAULT, grabbleTarget = GRABBLE_TARGET_DEFAULT, grabbleDice = 4 } = {}) {
    super();
    this.room = room; this.joinUrl = joinUrl; this.winTarget = winTarget; this.grabbleTarget = grabbleTarget; this.grabbleDice = grabbleDice;
    this.players = []; this.tokens = new Map();
    this.phase = 'lobby'; this.hostId = null; this.turnPlayerId = null; this.turnStep = null; this.turnDeadline = null;
    this.winnerId = null; this.lastEvent = { type: 'lobby', text: 'Waiting for friends to join…', word: '' };
    this.lastDice = null; this.cobbleAlt = 0; this.shardAlt = 0; this.minigame = null; this.pending = {};
    this.grabble = { space: GRABBLE_START, loot: 0, lastMove: null };
    this.boardConnected = false; this.boardReady = false; this.readyWaiters = []; this.pendingAcks = new Map(); this.queue = Promise.resolve();
    this.timers = {}; this.fastMode = false; this.eventSeq = 0; this.stats = { turns: 0, launches: 0, minigames: 0, chases: 0 }; this.hostGraceMs = 15_000; this.grabbleDiceOverride = grabbleDice !== 4 ? grabbleDice : null;
  }

  // ---------- snapshot ----------
  toState() {
    return {
      room: this.room, phase: this.phase, joinUrl: this.joinUrl, winTarget: this.winTarget, grabbleTarget: this.grabbleTarget,
      hostId: this.hostId, turnPlayerId: this.turnPlayerId, turnStep: this.turnStep, turnDeadline: this.turnDeadline,
      players: this.players.map(p => ({ id: p.id, name: p.name, heroId: p.heroId, color: p.color, space: p.space, shards: p.shards, connected: p.connected, isBot: p.isBot, lapDone: p.lapDone, order: p.order })),
      grabble: { ...this.grabble }, minigame: this.minigame ? { ...this.minigame } : null,
      winnerId: this.winnerId, lastEvent: this.lastEvent, lastDice: this.lastDice, boardConnected: this.boardConnected, boardReady: this.boardReady,
    };
  }
  pushState() { this.emit('state', this.toState()); }
  setLast(type, friendly) { this.lastEvent = { type, ...(friendly || {}) }; }

  // ---------- events + board acks ----------
  async sendEvent(type, data = {}, { wait = true, timeout = 8000 } = {}) {
    if (wait && this.boardConnected && !this.boardReady && !this.fastMode) await new Promise(r => { const t = setTimeout(r, 600_000); t.unref?.(); this.readyWaiters.push(() => { clearTimeout(t); r(); }); });
    const id = `${Date.now().toString(36)}-${++this.eventSeq}`;
    const ev = { ...data, id, type };               // id/type always win over payload fields
    this.emit('event', ev);
    if (!wait) return;
    if (!this.boardConnected || this.fastMode) return new Promise(r => setTimeout(r, this.fastMode ? 5 : 150));
    return new Promise(resolve => { const t = setTimeout(() => { this.pendingAcks.delete(id); resolve(); }, timeout); t.unref?.(); this.pendingAcks.set(id, () => { clearTimeout(t); resolve(); }); });
  }
  ackEvent(id) { const r = this.pendingAcks.get(id); if (r) { this.pendingAcks.delete(id); r(); } }
  setBoardConnected(v, ready = false) { this.boardConnected = v; if (!v) { this.boardReady = false; for (const r of this.pendingAcks.values()) r(); this.pendingAcks.clear(); this.releaseReady(); } else if (ready) this.setBoardReady(true); this.pushState(); }
  setBoardReady(v) { this.boardReady = v; if (v) this.releaseReady(); this.pushState(); }
  releaseReady() { const w = this.readyWaiters; this.readyWaiters = []; w.forEach(r => r()); }
  narrate(key, { wait = true, force = false } = {}) { if (this.phase === 'ended' && !force) return Promise.resolve(); return this.sendEvent('narrate', { key, wait }, { wait, timeout: 9000 }); }

  // ---------- helpers ----------
  player(id) { return this.players.find(p => p.id === id); }
  current() { return this.player(this.turnPlayerId); }
  others(p) { return this.players.filter(o => o.id !== p.id); }
  occupied(index, except) { return this.players.some(p => p.space === index && p.id !== except); }
  enqueue(fn) { this.queue = this.queue.then(fn).catch(err => console.error('[game]', err)); return this.queue; }
  clearTimers() { for (const k of Object.keys(this.timers)) { clearTimeout(this.timers[k]); delete this.timers[k]; } }
  setDeadline(ms) { this.turnDeadline = Date.now() + ms; }
  delayFor(p, humanMs) { if (p.isBot) return this.fastMode ? 5 : TIMEOUTS.bot; if (!p.connected) return this.fastMode ? 5 : TIMEOUTS.disconnected; return humanMs; }
  armAutoAct(ms) { clearTimeout(this.timers.auto); this.timers.auto = setTimeout(() => this.autoAct(), ms); this.timers.auto.unref?.(); }
  d(n) { return 1 + Math.floor(Math.random() * n); }
  // ---------- Benny & Miss Suds ----------
  flirtPair() { const b = this.players.find(p => p.heroId === 'baker'); const m = this.players.find(p => p.heroId === 'misssuds'); return b && m ? { b, m } : null; }
  async flirt(key, { wait = true } = {}) {
    const pair = this.flirtPair(); if (!pair || this.phase !== 'playing' || !FLIRT[key]) return;
    this.setLast('flirt', { text: `Benny: “${FLIRT[key]}”`, word: 'AWW!' }); this.pushState();
    await this.sendEvent('flirt', { key, text: FLIRT[key], bennyId: pair.b.id, missId: pair.m.id, reply: key === 'benny_shy' ? 'misssuds_thanks' : null }, { wait, timeout: 7000 });
  }
  pickCompliment() { this.flirtIdx = ((this.flirtIdx || 0) + 1) % COMPLIMENTS.length; return COMPLIMENTS[this.flirtIdx]; }

  // ---------- lobby ----------
  join({ name, heroId, socketId, room }) {
    if (room && String(room).trim().toUpperCase() !== String(this.room).toUpperCase()) return { ok: false, error: `Wrong room code. The big screen shows ${this.room}.` };
    if (this.phase !== 'lobby') return { ok: false, error: 'The game has already started. Wait for the next one!' };
    if (this.players.length >= HEROES.length) return { ok: false, error: `The village is full (${HEROES.length} players).` };
    name = String(name || '').trim().slice(0, 16) || 'Friend';
    if (!HERO_BY_ID[heroId]) heroId = HEROES.find(h => !this.players.some(p => p.heroId === h.id))?.id;
    if (!heroId) return { ok: false, error: 'No heroes left!' };
    if (this.players.some(p => p.heroId === heroId)) return { ok: false, error: 'That hero is already taken.' };
    const id = crypto.randomBytes(4).toString('hex'); const token = crypto.randomBytes(12).toString('hex');
    const p = { id, token, name, heroId, color: HERO_BY_ID[heroId].color, space: CASTLE_INDEX, shards: 0, connected: true, isBot: false, lapDone: false, order: this.players.length, socketId };
    this.players.push(p); this.tokens.set(token, id);
    if (!this.hostId) this.hostId = id;
    this.setLast('joined', { text: `${name} joined as ${HERO_BY_ID[heroId].name}!`, word: 'HELLO!' });
    this.sendEvent('lobby:joined', { playerId: id }, { wait: false }); this.pushState();
    return { ok: true, playerId: id, token, state: this.toState() };
  }
  addBot(name) {
    const hero = HEROES.find(h => !this.players.some(p => p.heroId === h.id)); if (!hero || this.players.length >= 6) return null;
    const id = crypto.randomBytes(4).toString('hex');
    const p = { id, token: null, name: name || hero.name, heroId: hero.id, color: hero.color, space: CASTLE_INDEX, shards: 0, connected: true, isBot: true, lapDone: false, order: this.players.length, socketId: null };
    this.players.push(p); if (!this.hostId) this.hostId = id; this.pushState(); return p;
  }
  rejoin({ token, socketId }) {
    const id = this.tokens.get(token); const p = id && this.player(id); if (!p) return { ok: false, error: 'unknown token' };
    p.connected = true; p.socketId = socketId; clearTimeout(this.timers['host:' + p.id]); delete this.timers['host:' + p.id];
    if (!this.player(this.hostId)?.connected) this.hostId = p.id;
    // a reloaded phone takes over again: cancel the disconnect auto-play and give the human the normal time for the current step
    if (this.phase === 'playing' && this.turnPlayerId === p.id) { clearTimeout(this.timers.auto); const ms = { roll: TIMEOUTS.roll, choose_fetch: TIMEOUTS.choose, choose_launch: TIMEOUTS.choose, minigame: TIMEOUTS.minigame }[this.turnStep]; if (ms) { if (this.turnStep === 'minigame' && this.minigame) { this.minigame.deadline = Date.now() + ms; this.setDeadline(ms); } this.armAutoAct(ms); } }
    this.pushState(); return { ok: true, playerId: p.id, state: this.toState() };
  }
  disconnect(playerId) {
    const p = this.player(playerId); if (!p) return; p.connected = false; p.socketId = null;
    if (this.hostId === playerId) { // grace period: a quick reload keeps the host
      this.timers['host:' + playerId] = setTimeout(() => { delete this.timers['host:' + playerId]; if (this.hostId !== playerId || p.connected) return; const next = this.players.find(o => o.connected && !o.isBot) || this.players.find(o => o.connected); if (next) { this.hostId = next.id; this.pushState(); } }, this.hostGraceMs); this.timers['host:' + playerId].unref?.();
    }
    this.pushState();
    if (this.phase === 'playing' && this.turnPlayerId === playerId) this.armAutoAct(TIMEOUTS.disconnected);
  }
  removePlayer(playerId) { if (this.phase !== 'lobby') return; this.players = this.players.filter(p => p.id !== playerId); this.players.forEach((p, i) => p.order = i); if (this.hostId === playerId) this.hostId = this.players[0]?.id || null; this.pushState(); }

  start(byPlayerId, { force = false } = {}) {
    if (this.phase !== 'lobby') return { ok: false, error: 'already started' };
    if (!force && byPlayerId !== this.hostId) return { ok: false, error: 'Only the host can start.' };
    if (this.players.length < 2) return { ok: false, error: 'Need at least 2 players.' };
    this.phase = 'playing'; this.winnerId = null; this.turnPlayerId = this.players[0].id; this.turnStep = 'resolving'; this.stats = { turns: 0, launches: 0, minigames: 0, chases: 0 };
    this.grabble = { space: GRABBLE_START, loot: 0, lastMove: null };
    this.setLast('start', { text: 'The chase begins! Collect shards and stop Grabble!', word: 'GO!' }); this.pushState();
    this.enqueue(async () => { await this.sendEvent('game:start', {}); await this.narrate('game_start'); await this.narrate('grabble_intro'); await this.flirt('benny_hello'); await this.beginTurn(this.players[0].id); });
    return { ok: true };
  }
  playAgain(byPlayerId) {
    if (byPlayerId !== this.hostId && byPlayerId !== 'dev') return { ok: false, error: 'host only' };
    this.clearTimers(); this.phase = 'lobby'; this.winnerId = null; this.turnPlayerId = null; this.turnStep = null; this.turnDeadline = null; this.minigame = null; this.pending = {};
    for (const p of this.players) { p.space = CASTLE_INDEX; p.shards = 0; p.lapDone = false; }
    this.grabble = { space: GRABBLE_START, loot: 0, lastMove: null };
    this.setLast('lobby', { text: 'Ready for another chase?', word: '' }); this.sendEvent('game:reset', {}, { wait: false }); this.pushState();
    return { ok: true };
  }
  resetAll() { this.clearTimers(); this.players = []; this.tokens.clear(); this.hostId = null; this.phase = 'lobby'; this.winnerId = null; this.turnPlayerId = null; this.turnStep = null; this.minigame = null; this.pending = {}; this.grabble = { space: GRABBLE_START, loot: 0, lastMove: null }; this.setLast('lobby', { text: 'Waiting for friends to join…', word: '' }); this.sendEvent('game:reset', {}, { wait: false }); this.pushState(); }

  // ---------- turn flow ----------
  async beginTurn(playerId) {
    const p = this.player(playerId); if (!p || this.phase !== 'playing') return;
    this.turnPlayerId = playerId; this.turnStep = 'roll'; this.setDeadline(TIMEOUTS.roll); this.stats.turns++; this.pushState();
    if (p.heroId === 'misssuds' && this.flirtPair()) { p.turnsTaken = (p.turnsTaken || 0) + 1; if (p.turnsTaken % 3 === 1) await this.flirt('benny_cheer', { wait: false }); }
    await this.narrate('turn_roll', { wait: false });
    this.armAutoAct(this.delayFor(p, TIMEOUTS.roll));
    if (!p.isBot && p.connected) { this.timers.nudge = setTimeout(() => { if (this.turnStep === 'roll' && this.turnPlayerId === playerId) this.narrate('turn_nudge', { wait: false }); }, TIMEOUTS.rollNudge); this.timers.nudge.unref?.(); }
  }
  autoAct() {
    const p = this.current(); if (!p || this.phase !== 'playing') return;
    const richest = (c) => c.slice().sort((a, b) => b.shards - a.shards)[0];
    switch (this.turnStep) {
      case 'roll': return this.roll(p.id);
      case 'choose_fetch': { let c = this.fetchCandidates(p); if (p.heroId === 'baker' && c.length > 1) c = c.filter(o => o.heroId !== 'misssuds'); return this.chooseTarget(p.id, richest(c)?.id); }
      case 'choose_launch': { const g = this.grabble.loot >= 2 ? 'grabble' : null; let c = this.others(p); if (p.heroId === 'baker' && c.length > 1) c = c.filter(o => o.heroId !== 'misssuds'); return this.chooseTarget(p.id, g || richest(c)?.id); }
      case 'minigame': return this.miniResult(p.id, this.minigame?.id, this.botScore(this.minigame?.type));
    }
  }
  botScore(type) { // ~70 % success for bots and for timed-out humans
    const hit = Math.random() < 0.7;
    switch (type) {
      case 'bell': return hit ? SWEET[0] + Math.random() * (SWEET[1] - SWEET[0]) : (Math.random() < 0.5 ? Math.random() * 0.28 : 0.77 + Math.random() * 0.23);
      case 'chase': return hit ? CHASE_ZONE[0] + Math.random() * (CHASE_ZONE[1] - CHASE_ZONE[0]) : Math.random() * 0.4;
      case 'flight': return hit ? 1 + Math.floor(Math.random() * 7) : 0;
      case 'shard': return hit ? 1 + Math.floor(Math.random() * 5) : 0;
      case 'fetch': return hit ? 1 + Math.floor(Math.random() * 3) : 0;
      case 'swish': return hit ? 3 : Math.floor(Math.random() * 3);
      case 'cake': return hit ? 3 + Math.floor(Math.random() * 6) : Math.floor(Math.random() * 3);
      default: return 0;
    }
  }

  roll(playerId) {
    const p = this.player(playerId);
    if (!p || this.phase !== 'playing' || this.turnPlayerId !== playerId || this.turnStep !== 'roll') return { ok: false, error: 'not your turn' };
    this.clearTimers(); this.turnStep = 'moving'; this.turnDeadline = null;
    const value = this.d(6); this.lastDice = { playerId, value };
    this.setLast('dice', { text: `${p.name} rolled a ${value}!`, word: `${value}!` }); this.pushState();
    this.enqueue(async () => {
      await this.sendEvent('dice', { playerId, value }, { timeout: 4000 });
      await this.narrate(`dice_${value}`, { wait: false });
      const from = p.space; let to = nextIndex(from, value); let bumped = false;
      while (this.occupied(to, p.id) && ![CASTLE_INDEX, BRIDGE_INDEX].includes(to)) { to = nextIndex(to); bumped = true; }
      const fullPath = pathBetween(from, to); this.pending.moveFrom = from;
      const crossedCastle = fullPath.includes(CASTLE_INDEX);
      // the chase: the move pauses at Grabble's space if the player lands on or passes him
      const g = this.grabble.space; const chaseAt = fullPath.includes(g) ? g : null;
      const path1 = chaseAt !== null ? pathBetween(from, chaseAt) : fullPath; const path2 = chaseAt !== null ? pathBetween(chaseAt, to) : [];
      p.space = chaseAt !== null ? chaseAt : to; this.pushState();
      await this.sendEvent('move', { playerId, from, to: p.space, path: path1, bumped: chaseAt === null && bumped }, { timeout: 2500 + path1.length * 450 });
      if (chaseAt !== null) {
        this.pending.afterChase = { to, path2, bumped, crossedCastle, playerId };
        return this.startChase(p);
      }
      await this.afterMove(p, to, bumped, crossedCastle);
    });
    return { ok: true };
  }
  async afterMove(p, to, bumped, crossedCastle) {
    const pair = this.flirtPair();
    if (pair && (p.id === pair.b.id || p.id === pair.m.id)) { const other = p.id === pair.b.id ? pair.m : pair.b; const from = this.pending.moveFrom ?? to; const crossed = other.space === to || pathBetween(from, to).includes(other.space); if (crossed) await this.flirt(p.id === pair.b.id ? this.pickCompliment() : 'benny_shy'); }
    if (crossedCastle && !p.lapDone) { p.lapDone = true; this.setLast('lap', FRIENDLY.lap(p)); this.pushState(); await this.sendEvent('lap', { playerId: p.id }); await this.addShards(p, 2, 'lap'); await this.narrate('lap_bonus'); }
    await this.resolveSpace(p, to);
  }

  // ---------- Grabble the villain ----------
  async grabbleTurn() {
    if (this.phase !== 'playing') return;
    const g = this.grabble; const dice = this.grabbleDiceOverride || ({ 2: 4, 3: 4, 4: 3, 5: 3, 6: 2 }[this.players.length] || 3); const steps = this.d(dice); const from = g.space; const path = pathBetween(from, nextIndex(from, steps));
    const stopAtBridge = path.indexOf(BRIDGE_INDEX); const finalPath = stopAtBridge >= 0 ? path.slice(0, stopAtBridge + 1) : path;
    const to = finalPath[finalPath.length - 1]; g.space = to; g.lastMove = { from, to, path: finalPath }; this.pushState();
    await this.sendEvent('grabble:move', { from, to, path: finalPath }, { timeout: 2500 + finalPath.length * 350 });
    for (const idx of finalPath) {
      for (const v of this.players.filter(o => o.space === idx && o.shards > 0)) {
        this.setLast('grabble', FRIENDLY.grabble_snatch(v)); this.pushState();
        await this.sendEvent('grabble:snatch', { playerId: v.id }, { timeout: 2500 });
        await this.addShards(v, -1, 'grabble'); await this.addLoot(1, 'snatch');
        await this.narrate('grabble_snatch', { wait: false });
        if (this.phase !== 'playing') return;
      }
    }
    if (SPACES[to].type === 'shard') { this.setLast('grabble', FRIENDLY.grabble_pocket()); this.pushState(); await this.addLoot(1, 'pocket'); if (this.phase !== 'playing') return; await this.narrate('grabble_pocket', { wait: false }); }
    if (to === BRIDGE_INDEX && this.phase === 'playing') await this.narrate('grabble_bridge', { wait: false });
  }
  async addLoot(delta, reason) {
    this.grabble.loot = Math.max(0, this.grabble.loot + delta); this.pushState();
    await this.sendEvent('grabble:loot', { delta, total: this.grabble.loot, reason }, { timeout: 2500 });
    if (this.grabble.loot >= this.grabbleTarget && !this.winnerId) { this.winnerId = 'grabble'; await this.finishGame(); }
  }
  async startChase(p) {
    this.stats.chases++; this.setLast('chase', FRIENDLY.chase_start(p)); this.pushState();
    await this.sendEvent('chase:start', { playerId: p.id }, { timeout: 3000 });
    await this.narrate('chase_start', { wait: false });
    return this.startMinigame(p, 'chase', { zone: CHASE_ZONE, perfect: CHASE_PERFECT, loot: this.grabble.loot });
  }
  async resolveChase(p, score) {
    const inZone = score >= CHASE_ZONE[0] && score <= CHASE_ZONE[1]; const perfect = inZone && score >= CHASE_PERFECT[0] && score <= CHASE_PERFECT[1];
    let taken = 0;
    if (inZone) {
      taken = Math.min(this.grabble.loot, perfect ? 3 : 2);
      if (taken > 0) { this.setLast('chase', FRIENDLY.chase_win(p, taken)); this.pushState(); await this.sendEvent('chase:end', { playerId: p.id, won: true, taken }, { timeout: 4000 }); await this.addLoot(-taken, 'chase'); await this.addShards(p, taken, 'chase'); await this.narrate('chase_win'); }
      else { this.setLast('chase', FRIENDLY.chase_empty(p)); this.pushState(); await this.sendEvent('chase:end', { playerId: p.id, won: true, taken: 0 }, { timeout: 3000 }); await this.narrate('chase_win_empty'); }
    } else {
      this.setLast('chase', FRIENDLY.chase_miss(p)); this.pushState();
      await this.sendEvent('chase:end', { playerId: p.id, won: false, taken: 0 }, { timeout: 3000 });
      const from = this.grabble.space; const to = nextIndex(from, 2); const path = pathBetween(from, to); this.grabble.space = to; this.grabble.lastMove = { from, to, path }; this.pushState();
      await this.sendEvent('grabble:move', { from, to, path, hop: true }, { timeout: 2500 });
      await this.narrate('chase_miss');
    }
    if (this.phase !== 'playing') return;
    const ac = this.pending.afterChase; this.pending.afterChase = null;
    if (ac && ac.path2.length) { p.space = ac.to; this.pushState(); await this.sendEvent('move', { playerId: p.id, from: p.space, to: ac.to, path: ac.path2, bumped: ac.bumped }, { timeout: 2500 + ac.path2.length * 450 }); }
    await this.afterMove(p, ac ? ac.to : p.space, ac?.bumped, ac?.crossedCastle);
  }

  // ---------- mini-games ----------
  async startMinigame(p, type, params = {}) {
    this.stats.minigames++;
    const id = `${type}-${++this.eventSeq}`; const ms = TIMEOUTS.minigame;
    this.minigame = { id, type, playerId: p.id, deadline: Date.now() + ms, params }; this.turnStep = 'minigame'; this.setDeadline(ms);
    this.setLast('minigame', FRIENDLY.mini(p, MINI_LABELS[type])); this.pushState();
    await this.sendEvent('minigame:start', { playerId: p.id, miniType: type, id }, { timeout: 2500 });
    if (type !== 'bell') await this.narrate(`mini_${type}`, { wait: false });
    this.armAutoAct(p.isBot ? (this.fastMode ? 5 : TIMEOUTS.botMini) : (!p.connected ? TIMEOUTS.disconnected : ms));
  }
  miniTick(playerId, id, progress) { if (!this.minigame || this.minigame.id !== id || this.minigame.playerId !== playerId) return; this.sendEvent('minigame:progress', { playerId, progress: Math.max(0, Math.min(1, Number(progress) || 0)) }, { wait: false }); }
  miniResult(playerId, id, score) {
    const p = this.player(playerId); const m = this.minigame;
    if (!p || !m || this.turnStep !== 'minigame' || m.playerId !== playerId || (id && id !== m.id)) return { ok: false, error: 'no mini-game running for you' };
    score = Number(score); if (!Number.isFinite(score)) score = 0;
    this.clearTimers(); this.turnStep = 'resolving'; this.turnDeadline = null; this.minigame = null; this.pushState();
    this.enqueue(async () => {
      const outcome = await this.resolveMinigame(p, m.type, score, m.params);
      await this.sendEvent('minigame:end', { playerId: p.id, miniType: m.type, score, outcome }, { timeout: 3000 });
      await this.afterMinigame(p, m.type, score, outcome);
    });
    return { ok: true };
  }
  // decides the outcome (no side effects) so the board can show it as the game ends
  async resolveMinigame(p, type, score, params) {
    switch (type) {
      case 'shard': return { gain: score >= 5 ? 2 : score >= 1 ? 1 : 0 };
      case 'flight': return { fly: score >= 1, bonus: score >= 5 };
      case 'fetch': return { gain: score >= 3 ? 2 : score >= 1 ? 1 : 0, source: params.source, targetId: params.targetId };
      case 'swish': return { safe: score >= 3 };
      case 'cake': return { bonus: score >= 5 };
      case 'chase': { const inZone = score >= CHASE_ZONE[0] && score <= CHASE_ZONE[1]; return { won: inZone, perfect: inZone && score >= CHASE_PERFECT[0] && score <= CHASE_PERFECT[1] }; }
      case 'bell': { const caught = score >= SWEET[0] && score <= SWEET[1]; return { caught, perfect: caught && score >= PERFECT[0] && score <= PERFECT[1] }; }
      default: return {};
    }
  }
  async afterMinigame(p, type, score, o) {
    switch (type) {
      case 'shard':
        if (o.gain) { this.setLast('shard', FRIENDLY.shard(p, o.gain)); this.pushState(); await this.addShards(p, o.gain, 'shard'); await this.narrate(o.gain === 2 ? 'mini_shard_two' : (this.shardAlt++ % 2 ? 'space_shard_alt' : 'space_shard')); }
        else { this.setLast('shard', FRIENDLY.shard_none(p)); this.pushState(); await this.narrate('mini_okay'); }
        return this.endTurn();
      case 'flight':
        if (o.fly && FLIGHT_PAIRS[p.space] !== undefined) { const from = p.space; const to = FLIGHT_PAIRS[from]; p.space = to; this.setLast('flight', FRIENDLY.flight_go(p, o.bonus)); this.pushState(); await this.sendEvent('flight', { playerId: p.id, from, to }, { timeout: 5000 }); if (o.bonus) { await this.addShards(p, 1, 'flight'); await this.narrate('mini_fly_bonus'); } else await this.narrate('space_flight_go');
          if (!p.lapDone && pathBetween(from, to).includes(CASTLE_INDEX)) { p.lapDone = true; this.setLast('lap', FRIENDLY.lap(p)); this.pushState(); await this.sendEvent('lap', { playerId: p.id }); await this.addShards(p, 2, 'lap'); await this.narrate('lap_bonus'); } }
        else { this.setLast('flight', FRIENDLY.flight_stay(p)); this.pushState(); await this.narrate('space_flight_stay'); }
        return this.endTurn();
      case 'fetch': {
        if (!o.gain) { this.setLast('fetch', FRIENDLY.fetch_none(p)); this.pushState(); await this.narrate('mini_okay'); return this.endTurn(); }
        if (o.source === 'grabble') { const n = Math.min(o.gain, this.grabble.loot) || 1; this.setLast('fetch', FRIENDLY.fetch(p, 'Grabble', n)); this.pushState(); await this.sendEvent('fetch', { playerId: p.id, targetId: 'grabble', n }, { timeout: 3000 }); await this.addLoot(-Math.min(n, this.grabble.loot), 'fetch'); await this.addShards(p, n, 'fetch', 'grabble'); await this.narrate('mini_fetch_grabble'); }
        else if (o.source === 'player') { const t = this.player(o.targetId); const n = Math.min(o.gain, t?.shards || 0); if (t && n > 0) { this.setLast('fetch', FRIENDLY.fetch(p, t.name, n)); this.pushState(); await this.sendEvent('fetch', { playerId: p.id, targetId: t.id, n }, { timeout: 3000 }); await this.addShards(t, -n, 'fetch', p.id); await this.addShards(p, n, 'fetch', t.id); await this.narrate('space_fetch'); } else { await this.addShards(p, 1, 'fetch'); this.setLast('fetch', FRIENDLY.fetch(p, 'the sky', 1)); await this.narrate('space_fetch_sky'); } }
        else { this.setLast('fetch', FRIENDLY.fetch(p, 'the sky', o.gain)); this.pushState(); await this.addShards(p, o.gain, 'fetch'); await this.narrate('space_fetch_sky'); }
        return this.endTurn();
      }
      case 'swish':
        if (o.safe) { this.setLast('swish', FRIENDLY.swish_safe(p)); this.pushState(); await this.narrate('mini_swish_safe'); }
        else { this.setLast('swish', FRIENDLY.swish(p)); this.pushState(); await this.sendEvent('grabble:snatch', { playerId: p.id, fromSpace: true }, { timeout: 2500 }); await this.addShards(p, -1, 'swish'); await this.addLoot(1, 'swish'); await this.narrate('space_swish'); }
        return this.endTurn();
      case 'cake':
        if (o.bonus) { this.setLast('cake', FRIENDLY.cake_bonus(p)); this.pushState(); await this.addShards(p, 1, 'cake'); await this.narrate('mini_cake_bonus'); } else await this.narrate('mini_great', { wait: false });
        return this.endTurn();
      case 'chase': return this.resolveChase(p, score);
      case 'bell': return this.resolveLaunch(p, score, o);
    }
  }

  fetchCandidates(p) { return this.others(p).filter(o => o.shards > 0); }

  async resolveSpace(p, index) {
    const space = SPACES[index];
    this.turnStep = 'resolving'; this.pushState();
    await this.sendEvent('space', { playerId: p.id, index, spaceType: space.type }, { timeout: 2500 });
    switch (space.type) {
      case 'shard': return this.startMinigame(p, 'shard', {});
      case 'swish':
        if (p.shards > 0) return this.startMinigame(p, 'swish', {});
        this.setLast('swish', FRIENDLY.swish_empty(p)); this.pushState(); await this.narrate('space_swish_empty'); return this.endTurn();
      case 'fetch': {
        if (this.grabble.loot > 0) return this.startMinigame(p, 'fetch', { source: 'grabble' });
        const cands = this.fetchCandidates(p);
        if (cands.length === 0) return this.startMinigame(p, 'fetch', { source: 'sky' });
        this.turnStep = 'choose_fetch'; this.setDeadline(TIMEOUTS.choose); this.pushState();
        await this.narrate('space_fetch_choose', { wait: false });
        this.armAutoAct(this.delayFor(p, TIMEOUTS.choose)); return;
      }
      case 'launch': {
        this.turnStep = 'choose_launch'; this.setDeadline(TIMEOUTS.choose); this.setLast('launch', FRIENDLY.launch_choose(p)); this.pushState();
        await this.narrate('launch_choose', { wait: false });
        this.armAutoAct(this.delayFor(p, TIMEOUTS.choose)); return;
      }
      case 'bridge': this.setLast('bridge', FRIENDLY.bridge(p)); this.pushState(); await this.narrate('space_bridge_land'); return this.endTurn();
      case 'flight_a': case 'flight_b': return this.startMinigame(p, 'flight', { pair: FLIGHT_PAIRS[index] });
      case 'cake':
        this.setLast('cake', FRIENDLY.cake()); this.pushState();
        for (const o of this.players) await this.addShards(o, 1, 'cake');
        await this.narrate('space_cake', { wait: false });
        if (p.heroId === 'baker' && this.flirtPair()) { await this.addShards(this.flirtPair().m, 1, 'cake', p.id); await this.flirt('benny_cake'); }
        return this.startMinigame(p, 'cake', {});
      case 'castle': this.setLast('castle', { text: `${p.name} is home at the castle.`, word: 'HOME!' }); this.pushState(); await this.narrate('kind_1'); return this.endTurn();
      default: this.setLast('cobble', FRIENDLY.cobble(p)); this.pushState(); await this.narrate(['space_cobble', 'space_cobble_alt', 'space_cobble_alt2', 'kind_2'][this.cobbleAlt++ % 4]); return this.endTurn();
    }
  }

  chooseTarget(playerId, targetId) {
    const p = this.player(playerId);
    if (!p || this.turnPlayerId !== playerId || !['choose_fetch', 'choose_launch'].includes(this.turnStep)) return { ok: false, error: 'not choosing now' };
    const isGrabble = targetId === 'grabble'; const t = isGrabble ? null : this.player(targetId);
    if (!isGrabble && (!t || t.id === p.id)) return { ok: false, error: 'pick another player' };
    const step = this.turnStep; this.clearTimers(); this.turnStep = 'resolving'; this.turnDeadline = null; this.pushState();
    this.enqueue(async () => {
      if (step === 'choose_fetch') { if (isGrabble) return this.startMinigame(p, 'fetch', { source: 'grabble' }); return this.startMinigame(p, 'fetch', { source: 'player', targetId: t.id }); }
      // launch: send the target to the bridge, then ring the bell
      if (isGrabble) { const from = this.grabble.space; const path = pathBetween(from, BRIDGE_INDEX); this.grabble.space = BRIDGE_INDEX; this.grabble.lastMove = { from, to: BRIDGE_INDEX, path }; this.setLast('sent', FRIENDLY.sent(p, 'Grabble')); this.pushState(); await this.sendEvent('sendToBridge', { playerId: p.id, targetId: 'grabble', from, to: BRIDGE_INDEX }, { timeout: 4000 }); await this.narrate('catcher_target_grabble', { wait: false }); }
      else { const from = t.space; t.space = BRIDGE_INDEX; this.setLast('sent', FRIENDLY.sent(p, t.name)); this.pushState(); await this.sendEvent('sendToBridge', { playerId: p.id, targetId: t.id, from, to: BRIDGE_INDEX }, { timeout: 4000 }); if (p.heroId === 'baker' && t.heroId === 'misssuds') await this.flirt('benny_sorry'); else await this.narrate('launch_sent', { wait: false }); }
      await this.narrate('launch_ready', { wait: false });
      return this.startMinigame(p, 'bell', { sweet: SWEET, perfect: PERFECT });
    });
    return { ok: true };
  }
  // legacy name kept for the phone's bell screen
  launchTiming(playerId, score) { return this.miniResult(playerId, this.minigame?.id, score); }

  async resolveLaunch(p, score, { caught, perfect }) {
    this.stats.launches++;
    const targets = this.players.filter(o => o.space === BRIDGE_INDEX && o.id !== p.id).map(o => o.id); const grabbleOnBridge = this.grabble.space === BRIDGE_INDEX;
    await this.sendEvent('launch', { byPlayerId: p.id, targets, grabble: grabbleOnBridge, caught, perfect, score }, { timeout: 45000 });
    if (caught) {
      const victims = targets.map(id => ({ playerId: id, gave: this.player(id).shards > 0 ? 1 : 0 }));
      let taken = 0, spilled = 0; if (grabbleOnBridge) { taken = Math.min(3, this.grabble.loot); spilled = this.grabble.loot - taken; }
      const names = victims.map(v => this.player(v.playerId).name).join(' and ');
      this.setLast('caught', grabbleOnBridge ? FRIENDLY.caught_grabble(p, taken) : FRIENDLY.caught(p, names)); this.pushState();
      await this.sendEvent('caught', { byPlayerId: p.id, victims, grabble: grabbleOnBridge, taken, spilled }, { timeout: 5000 });
      let gained = 0;
      for (const v of victims) if (v.gave) { await this.addShards(this.player(v.playerId), -1, 'catch', p.id); gained++; }
      if (grabbleOnBridge) { if (this.grabble.loot) await this.addLoot(-this.grabble.loot, 'caught'); this.grabble.space = GRABBLE_START; this.pushState(); await this.sendEvent('grabble:reset', {}, { timeout: 2500 }); gained += taken; }
      if (gained) await this.addShards(p, gained, 'catch');
      if (grabbleOnBridge && taken >= 2 && p.heroId === 'baker' && this.flirtPair()) { const m = this.flirtPair().m; await this.addShards(p, -1, 'gift', m.id); await this.addShards(m, 1, 'gift', p.id); await this.flirt('benny_gift'); }
      if (perfect) await this.narrate('launch_perfect', { wait: false });
      await this.narrate(grabbleOnBridge ? (taken + spilled > 0 ? 'catcher_caught_grabble' : 'launch_caught_empty') : (gained === 0 ? 'launch_caught_empty' : (victims.length > 1 ? 'launch_caught_many' : 'launch_caught')));
    } else {
      this.setLast('missed', FRIENDLY.missed()); this.pushState();
      await this.sendEvent('missed', { byPlayerId: p.id, targets, grabble: grabbleOnBridge }, { timeout: 3000 });
      await this.narrate('launch_missed');
    }
    return this.endTurn();
  }

  async addShards(p, delta, reason, fromPlayerId) {
    p.shards = Math.max(0, p.shards + delta); this.pushState();
    await this.sendEvent('shard', { playerId: p.id, delta, total: p.shards, reason, fromPlayerId }, { timeout: 2500 });
    if (delta > 0 && p.shards === this.winTarget - 1) { await this.sendEvent('almostWin', { playerId: p.id }, { timeout: 2000 }); await this.narrate('almost_win_generic', { wait: false }); }
  }

  decideWinner() {
    const cands = this.players.filter(p => p.shards >= this.winTarget); if (!cands.length) return null;
    const cur = this.current(); if (cur && cands.includes(cur)) return cur.id;
    const max = Math.max(...cands.map(c => c.shards)); const top = cands.filter(c => c.shards === max);
    const start = cur ? cur.order : 0; for (let k = 0; k < this.players.length; k++) { const p = this.players[(start + k) % this.players.length]; if (top.includes(p)) return p.id; }
    return top[0].id;
  }
  async finishGame() {
    this.clearTimers(); this.phase = 'ended'; this.turnStep = null; this.turnPlayerId = null; this.turnDeadline = null; this.minigame = null;
    if (this.winnerId === 'grabble') { this.setLast('win', FRIENDLY.grabble_win()); this.pushState(); await this.sendEvent('grabble:win', {}, { timeout: 12000 }); await this.narrate('grabble_win', { force: true }); return; }
    const w = this.player(this.winnerId); this.setLast('win', FRIENDLY.win(w)); this.pushState();
    await this.sendEvent('win', { playerId: w.id }, { timeout: 15000 });
    await this.narrate('win', { force: true }); await this.narrate('win_cake', { force: true });
  }
  async endTurn() {
    this.clearTimers(); if (this.phase !== 'playing') return;
    const winner = this.decideWinner(); if (winner) { this.winnerId = winner; return this.finishGame(); }
    const cur = this.current();
    await this.grabbleTurn(); if (this.phase !== 'playing') return;
    const next = this.players[(cur.order + 1) % this.players.length];
    await this.beginTurn(next.id);
  }
}
