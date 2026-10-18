// Mock socket for standalone testing: /play/?mock=1
//   &hold=1       stay on one step (use &step=N or window.__mock.goto(N))
//   &step=N       start at step N (0-based)
//   &ms=4000      time per (non mini-game) step
//   &join=1       start on the Join screen (no session); joining then starts the cycle
//                 (&room=XYZ with &join=1 tries a wrong room code first: only MOCK is accepted)
//   &tier=hard    difficulty for the mini-games (easy | medium | hard); default: the tier of the player's hero
//   &game=gate    jump to a Catcher bell gate (gate 2 of 4, Flower Garden: no title card, banner, gate pips)
//   &frames=1     also stream the live mini-game picture (player:miniFrame); stats in window.__mock.frames
//   &game=flight  jump straight into one mini-game and replay it after every result
//                 (flight | shard | fetch | swish | cake | chase | bell | legacybell)
// Mini-game steps wait for the phone's player:miniResult, then show the result for a moment and move on.
import { HERO_BY_ID } from '/shared/heroes.js';
import { MINI, tierFor } from '/shared/difficulty.js';

const mk = (id, heroId, name, shards, extra = {}) => ({
  id, name, heroId, color: (HERO_BY_ID[heroId] || { color: '#6E8FE0' }).color, space: 0, shards,
  connected: true, isBot: false, lapDone: false, order: 0, ...extra,
});
// the same params the v2 server sends (server/game.js startMinigame)
const PARAMS = { chase: { zone: [0.45, 0.80], perfect: [0.60, 0.68], loot: 3 }, fetch: { source: 'grabble' }, bell: { sweet: [0.30, 0.75], perfect: [0.48, 0.58] }, flight: { pair: 22 } };
const TITLES = { flight: 'Flappy Flight', shard: 'Look Under the Flowers', fetch: 'Charli Catches', swish: 'Dodge the Net', cake: 'Strawberry Catch', chase: 'Vine Grab', bell: 'Ring the Bell' };

export function createMockSocket({ hold = false, start = 0, ms = 4000, joined = true, players = 4, game = '', tier = '' } = {}) {
  const handlers = {};
  const fire = (ev, ...args) => (handlers[ev] || []).forEach((fn) => fn(...args));
  const log = [];
  let timer = null; let watchTimer = null;
  let idx = Math.max(0, start);
  let paused = hold;
  let isJoined = joined;
  const tag = Math.random().toString(36).slice(2, 6); // ids differ per page load (answered games are remembered per tab)
  let visit = 0; let visitDeadline = 0; let visitStart = Date.now(); let resultIn = null; let eventId = 0;
  const me = mk('p1', 'kyah', 'Kyah', 3);
  const grabble = (loot = 3) => ({ space: 20, loot, lastMove: null });

  const others = () => [
    mk('p2', 'ayva', 'Ayva', 2, { isBot: true, order: 1 }),
    mk('p3', 'pup', 'Charli', 5, { isBot: true, order: 2 }),
    mk('p4', 'poodle', 'Poodle', 0, { isBot: true, order: 3 }),
    mk('p5', 'baker', 'Benny', 1, { order: 4, connected: false }),
    mk('p6', 'misssuds', 'Miss Suds', 4, { order: 5 }),
  ].slice(0, Math.max(1, players - 1));
  const base = (over) => ({
    room: 'MOCK', phase: 'playing', joinUrl: 'http://localhost/play/?room=MOCK', winTarget: 8, grabbleTarget: 8,
    hostId: 'p1', turnPlayerId: null, turnStep: null, turnDeadline: null, minigame: null,
    players: [me, ...others()], winnerId: null, grabble: grabble(3),
    lastEvent: { type: 'shard', text: 'Kyah found a shining shard!', word: 'TING!' },
    ...over,
  });
  const tierOf = () => (MINI.flight[tier] ? tier : tierFor(me.heroId));
  const paramsFor = (type) => ({ ...(PARAMS[type] || {}), tier: tierOf(), cfg: { ...MINI[type][tierOf()] } });
  const gate = () => {
    const id = `mock-gate-${visit}-${tag}`;
    if (resultIn && resultIn.id === id) return base({ turnPlayerId: 'p1', turnStep: 'resolving', minigame: null, lastEvent: { type: 'catcher:gateResult', text: 'The Catcher rolls on…', word: 'DING!' } });
    return base({
      turnPlayerId: 'p1', turnStep: 'minigame', turnDeadline: visitDeadline,
      minigame: { id, type: 'bell', playerId: 'p1', deadline: visitDeadline, params: { ...paramsFor('bell'), gateIndex: 1, gateCount: 4, section: { id: 'garden', label: 'Flower Garden' } } },
    });
  };
  const mini = (type, playerId = 'p1') => {
    const id = `mock-${type}-${visit}-${tag}`;
    if (resultIn && resultIn.id === id) {
      return base({ turnPlayerId: playerId, turnStep: 'resolving', minigame: null, lastEvent: { type: 'minigame:end', text: `${TITLES[type]}: score ${resultIn.score}!`, word: 'TING!' } });
    }
    return base({
      turnPlayerId: playerId, turnStep: 'minigame', turnDeadline: visitDeadline,
      minigame: { id, type, playerId, deadline: visitDeadline, params: paramsFor(type) },
      lastEvent: { type: 'minigame:start', text: `Time for ${TITLES[type]}!`, word: 'WHOOSH!' },
    });
  };
  const legacyBell = () => (resultIn && resultIn.id === `legacy-${visit}`
    ? base({ turnPlayerId: 'p1', turnStep: 'resolving', lastEvent: { type: 'launch', text: 'Here comes the Catcher!', word: 'DING!' } })
    : base({ turnPlayerId: 'p1', turnStep: 'launch_timing', turnDeadline: visitDeadline, lastEvent: { type: 'sendToBridge', text: 'Off to the bridge they go!', word: 'WHOOSH!' } }));

  const steps = [
    { name: 'lobby (host)', build: () => base({ phase: 'lobby', players: [me, ...others().slice(0, 2)], lastEvent: null, grabble: null }) },
    { name: 'lobby (guest)', build: () => base({ phase: 'lobby', hostId: 'p2', players: [me, ...others().slice(0, 2)], lastEvent: null, grabble: null }) },
    { name: 'your turn: roll', build: () => base({ turnPlayerId: 'p1', turnStep: 'roll', lastEvent: { type: 'cake', text: 'Teatime! Cake for everyone!', word: 'CAKE!' } }) },
    { name: 'pick: fetch (Grabble empty)', build: () => base({ turnPlayerId: 'p1', turnStep: 'choose_fetch', turnDeadline: visitDeadline, grabble: grabble(0), lastEvent: { type: 'space', text: 'Pup Fetch! Pick a friend.', word: 'WOOF!' } }) },
    { name: 'pick: fetch (Grabble has loot)', build: () => base({ turnPlayerId: 'p1', turnStep: 'choose_fetch', turnDeadline: visitDeadline, grabble: grabble(4), lastEvent: { type: 'space', text: 'Charli Fetch! Pick who to fetch from.', word: 'WOOF!' } }) },
    { name: 'pick: launch (+ Grabble card)', build: () => base({ turnPlayerId: 'p1', turnStep: 'choose_launch', turnDeadline: visitDeadline, grabble: grabble(3), lastEvent: { type: 'space', text: 'Launch the Catcher!', word: 'DING!' } }) },
    { name: 'mini: flight', mini: 'flight', build: () => mini('flight') },
    { name: 'mini: shard', mini: 'shard', build: () => mini('shard') },
    { name: 'mini: fetch', mini: 'fetch', build: () => mini('fetch') },
    { name: 'mini: swish', mini: 'swish', build: () => mini('swish') },
    { name: 'mini: cake', mini: 'cake', build: () => mini('cake') },
    { name: 'mini: chase', mini: 'chase', build: () => mini('chase') },
    { name: 'mini: bell', mini: 'bell', build: () => mini('bell') },
    { name: 'bell gate 2 of 4 (Flower Garden)', mini: 'gate', build: gate },
    { name: 'ring the bell (legacy launch_timing)', mini: 'legacybell', build: legacyBell },
    { name: 'fairy flight offer (legacy)', build: () => base({ turnPlayerId: 'p1', turnStep: 'flight_offer', turnDeadline: visitDeadline, lastEvent: { type: 'space', text: 'A fairy flight! Fly across the village?', word: 'WHOOSH!' } }) },
    { name: 'waiting: Ayva plays Dodge the Net', watch: 'p2', build: () => base({ turnPlayerId: 'p2', turnStep: 'minigame', turnDeadline: visitDeadline, minigame: { id: `mock-watch-${visit}-${tag}`, type: 'swish', playerId: 'p2', deadline: visitDeadline, params: {} } }) },
    { name: 'waiting: Ayva moving (Grabble 6)', build: () => base({ turnPlayerId: 'p2', turnStep: 'moving', grabble: grabble(6), lastEvent: { type: 'swish', text: 'Swish! Grabble snatched a shard! Hey, that is not yours!', word: 'SWISH!' } }) },
    { name: 'waiting: me resolving', build: () => base({ turnPlayerId: 'p1', turnStep: 'resolving', lastEvent: { type: 'caught', text: 'Caught in the flower basket!', word: 'STUCK!' } }) },
    { name: 'win (me) + closing countdown', build: () => base({ phase: 'ended', winnerId: 'p1', turnPlayerId: null, closesAt: visitStart + 180000, players: [{ ...me, shards: 8 }, ...others()], lastEvent: { type: 'win', text: 'The Starlight Gem is whole again!', word: 'TING!' } }) },
    { name: 'win (Charli)', build: () => base({ phase: 'ended', winnerId: 'p3', hostId: 'p2', turnPlayerId: null, players: [me, ...others().map((p) => (p.id === 'p3' ? { ...p, shards: 8 } : p))] }) },
    { name: 'win (Grabble), guest view', build: () => base({ phase: 'ended', winnerId: 'grabble', hostId: 'p2', turnPlayerId: null, closesAt: visitStart + 45000, grabble: grabble(8), lastEvent: { type: 'grabble:win', text: 'That gem will be mine!', word: 'SWISH!' } }) },
    { name: 'room closed (finished)', closed: 'finished', build: () => base({ phase: 'lobby', room: 'NEW1', players: others().slice(0, 1), hostId: 'p2', lastEvent: null }) },
  ];
  const gameStep = game ? steps.findIndex((s) => s.mini === game) : -1;
  if (gameStep >= 0) { idx = gameStep; paused = true; }

  const step = () => steps[idx % steps.length];
  const current = () => step().build();
  const emitEvent = (data) => fire('event', { ...data, id: ++eventId });
  const chip = () => {
    const c = document.getElementById('mock-chip');
    if (c) c.textContent = `mock ${idx % steps.length}/${steps.length - 1}: ${step().name}${paused ? ' (paused)' : ''}`;
  };
  const emitState = () => { if (!isJoined) return; fire('state', current()); chip(); };
  const startWatch = () => {
    clearInterval(watchTimer);
    const s = step(); if (!s.watch) return;
    let p = 0;
    emitEvent({ type: 'minigame:start', playerId: s.watch, gameType: 'swish' });
    watchTimer = setInterval(() => {
      p = Math.min(1, p + 0.02 + Math.random() * 0.03);
      emitEvent({ type: 'minigame:progress', playerId: s.watch, progress: Math.round(p * 100) / 100 });
      if (p >= 1) { clearInterval(watchTimer); emitEvent({ type: 'minigame:end', playerId: s.watch, gameType: 'swish', score: 3, outcome: 'dodged' }); }
    }, 200);
  };
  const closeRoom = (reason) => { // like the server: room:closed, then the phone is no longer in the game
    isJoined = false; clearTimeout(timer);
    fire('room:closed', { reason });
    setTimeout(() => fire('state', base({ phase: 'lobby', room: 'MOCK', players: others().slice(0, 2), hostId: 'p2', lastEvent: null, grabble: null })), 300);
    chip();
  };
  const enter = () => {
    visit++; visitStart = Date.now(); visitDeadline = Date.now() + (step().mini === 'gate' ? 9000 : step().mini ? 25000 : 20000); resultIn = null;
    if (step().closed) { closeRoom(step().closed); return; }
    emitState(); startWatch();
  };
  const schedule = () => {
    clearTimeout(timer);
    if (paused || !isJoined || step().mini) return;
    timer = setTimeout(() => { idx = (idx + 1) % steps.length; enter(); schedule(); }, ms);
  };
  const afterResult = (id, score) => {
    resultIn = { id, score };
    emitEvent({ type: 'minigame:end', playerId: 'p1', gameType: step().mini, score, outcome: 'mock' });
    emitState();
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (gameStep >= 0) enter(); // replay the same game
      else if (!paused) { idx = (idx + 1) % steps.length; enter(); schedule(); }
    }, gameStep >= 0 ? 8000 : 3600);
  };

  const api = {
    steps, log,
    goto(i) { idx = ((i % steps.length) + steps.length) % steps.length; enter(); schedule(); },
    next() { api.goto(idx + 1); },
    prev() { api.goto(idx - 1); },
    pause() { paused = true; clearTimeout(timer); chip(); },
    play() { paused = false; schedule(); chip(); },
    toggle() { paused ? api.play() : api.pause(); },
    get index() { return idx; },
    get paused() { return paused; },
    me,
    state: current,
  };

  const taken = new Set(['ayva', 'pup']);
  const sock = {
    connected: false,
    id: 'mock',
    on(ev, fn) { (handlers[ev] ||= []).push(fn); return sock; },
    off() { return sock; },
    connect() { setTimeout(() => { sock.connected = true; fire('connect'); }, 60); return sock; },
    disconnect() { sock.connected = false; fire('disconnect', 'io client disconnect'); return sock; },
    emit(ev, payload, ack) {
      log.push({ ev, payload, at: Date.now() });
      if (ev === 'player:miniFrame') { // measure the live-picture stream (bytes per second)
        const f = (api.frames ||= { n: 0, bytes: 0, first: Date.now(), last: Date.now(), max: 0 });
        f.n++; f.bytes += (payload.frame && payload.frame.size) || 0; f.last = Date.now(); f.max = Math.max(f.max, (payload.frame && payload.frame.size) || 0);
        f.bps = Math.round(f.bytes / Math.max(0.001, (f.last - f.first) / 1000)); f.fps = +(f.n / Math.max(0.001, (f.last - f.first) / 1000)).toFixed(1);
        return undefined;
      }
      if (ev !== 'player:miniTick') console.log('[mock emit]', ev, payload);
      const ok = (extra = {}) => setTimeout(() => ack && ack({ ok: true, ...extra }), 80);
      switch (ev) {
        case 'player:join':
          if (payload.room && payload.room !== 'MOCK') { // like the v2 server: a wrong room code is refused
            return setTimeout(() => ack && ack({ ok: false, error: 'Wrong room code. Check the big screen!' }), 80);
          }
          if (taken.has(payload.heroId)) {
            return setTimeout(() => ack && ack({ ok: false, error: 'That hero is already taken.', state: base({ phase: 'lobby' }) }), 80);
          }
          me.heroId = payload.heroId; me.name = payload.name; me.color = HERO_BY_ID[payload.heroId].color;
          isJoined = true; idx = gameStep >= 0 ? gameStep : Math.max(0, start); paused = hold || gameStep >= 0;
          visit++; visitStart = Date.now(); visitDeadline = Date.now() + (step().mini === 'gate' ? 9000 : 25000);
          setTimeout(() => {
            ack && ack({ ok: true, playerId: 'p1', token: 'mock-token', state: current() });
            emitState(); startWatch(); schedule();
          }, 120);
          return undefined;
        case 'player:rejoin':
          if (!visitDeadline) { visit++; visitStart = Date.now(); visitDeadline = Date.now() + (step().mini === 'gate' ? 9000 : 25000); }
          return setTimeout(() => { ack && ack({ ok: true, playerId: 'p1', state: current() }); chip(); startWatch(); schedule(); }, 80);
        case 'player:miniTick':
          emitEvent({ type: 'minigame:progress', playerId: 'p1', progress: payload.progress });
          return undefined;
        case 'player:miniResult': {
          const cur = current();
          if (!cur.minigame || cur.minigame.id !== payload.id) return setTimeout(() => ack && ack({ ok: false, error: 'No mini-game right now.' }), 80);
          ok(); afterResult(payload.id, payload.failed ? 0 : payload.score); return undefined;
        }
        case 'player:endGame': // host: back to the lobby, everyone stays
          ok(); setTimeout(() => api.goto(0), 150); return undefined;
        case 'player:closeRoom': // host: the room closes for everyone
          ok(); setTimeout(() => closeRoom('host'), 150); return undefined;
        case 'player:launchTiming':
          if (step().mini !== 'legacybell') return ok();
          ok(); afterResult(`legacy-${visit}`, payload.score); return undefined;
        default:
          return ok();
      }
    },
  };
  window.__mock = api;
  // Startup
  setTimeout(() => {
    sock.connected = true; fire('connect');
    // an unjoined phone sees the lobby snapshot so taken heroes can be greyed out
    if (!isJoined) fire('state', base({ phase: 'lobby', players: others().slice(0, 2), hostId: 'p2', lastEvent: null, grabble: null }));
  }, 80);
  return sock;
}
