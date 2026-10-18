// Kyah & Ayva: Starlight Gem Chase — phone controller.
// Everything renders from the `state` snapshot the server emits.
import { HEROES, HERO_BY_ID } from '/shared/heroes.js';
import * as sound from '/play/audio.js';
import { runMinigame, GAME_INFO } from '/play/minigames.js';

const sfx = sound.sfx;
const qs = new URLSearchParams(location.search);
const MOCK = qs.has('mock');
const FRAMES = !MOCK || qs.get('frames') === '1'; // stream the mini-game picture (off in mock unless &frames=1)
if (qs.has('still')) document.documentElement.classList.add('still-root');
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- constants
const LOCK_MS = 7000;            // un-stick a locked action if the server never answers
const FLIGHT_FALLBACK_MS = 10000;
const MINI_HOLD_MS = 2600;       // keep a mini-game's result up a moment even if the server moves on at once
const MINI_HOLD_INPUT_MS = 1500; // ...but only this long when the next state needs a tap from us
const TICK_MS = 200;             // player:miniTick at <= 5 Hz
const GRABBLE_TARGET = 8;
const SESSION_KEY = MOCK ? 'kaa.mock.session' : 'kaa.session';
const NAME_KEY = 'kaa.name';
const MINI_SENT_KEY = 'kaa.miniSent';
const TOP_SCREENS = new Set(['lobby', 'wait', 'roll', 'pick', 'flight']);
const INPUT_STEPS = new Set(['roll', 'choose_fetch', 'choose_launch', 'flight_offer', 'launch_timing']);

// ---------------------------------------------------------------- state
const S = {
  socket: null, state: null, meId: null, session: null, room: '',
  connected: false, booting: true, joining: false,
  selectedHero: null, taken: new Set(), joinError: '',
  lock: null, screen: null, faces: {},
  motion: { active: false, asked: false, prev: null, hits: [] },
  prevShards: null, prevEventSig: null, prevPhase: null, lastBuzz: 0,
  flight: { key: '', endsAt: 0, total: FLIGHT_FALLBACK_MS, timer: 0, lastSec: -1, sentDefault: false },
  pickCd: { key: '', endsAt: 0, total: 0, timer: 0, lastSec: -1 },
  die: { timer: 0 },
  // our own mini-game run: key identifies it (minigame id, or the legacy launch_timing step)
  mini: { key: null, id: null, type: null, legacy: false, ctrl: null, sent: false, sentAt: 0, holdUntil: 0, lastTick: 0 },
  watch: { mgId: null, playerId: null, progress: 0, done: false }, // someone else's mini-game (minigame:progress)
  pending: null,   // a result we could not send while disconnected
  art: { urls: {} },
  sigs: {},
};

// ---------------------------------------------------------------- tiny helpers
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
function hexToRgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mixHex(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
function isLight(hex) { const [r, g, b] = hexToRgb(hex); return 0.299 * r + 0.587 * g + 0.114 * b > 165; }
let gestured = false; // vibrate() is ignored (and logs an error) until the page has had a tap
function buzz(p) {
  try {
    const active = navigator.userActivation ? navigator.userActivation.hasBeenActive : gestured;
    if (active && navigator.vibrate) navigator.vibrate(p);
  } catch { /* unsupported */ }
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function sameSig(key, sig) { if (S.sigs[key] === sig) return true; S.sigs[key] = sig; return false; }

const heroOf = (p) => HERO_BY_ID[p && p.heroId] || { id: p && p.heroId, name: (p && p.name) || 'Friend', color: (p && p.color) || '#6E8FE0' };
// The puppy hero is called Charli on screen (id stays 'pup'); never show "Pup" to players.
const fixText = (s) => String(s == null ? '' : s).replace(/\bPup\b/g, 'Charli').replace(/\bPUP\b/g, 'CHARLI');
const nameOf = (p) => (p ? (p.heroId === 'pup' && /^pup$/i.test(String(p.name || '').trim()) ? 'Charli' : fixText(p.name || heroOf(p).name)) : 'Friend');
const gameTitle = (type) => (GAME_INFO[type] && GAME_INFO[type].title) || 'a mini-game';
const colorOf = (p) => (p && p.color) || heroOf(p).color;
const winTarget = () => (S.state && S.state.winTarget) || 8;
const grabbleTarget = () => (S.state && (S.state.grabbleTarget || (S.state.grabble && S.state.grabble.target))) || GRABBLE_TARGET;
const meOf = (st) => (st && S.meId ? st.players.find((p) => p.id === S.meId) || null : null);
const stateKey = (st) => `${st.phase}|${st.turnPlayerId}|${st.turnStep}|${st.turnDeadline || ''}`;

let toastTimer = 0;
function showToast(msg, ms = 2600) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------------------------------------------------------------- avatars (portrait or colored initial)
function paintAvatar(a) {
  const id = a.dataset.hero; const url = S.faces[id];
  if (url) { a.style.backgroundImage = `url("${url}")`; a.classList.add('has-img'); a.textContent = ''; }
  else { a.style.backgroundImage = ''; a.classList.remove('has-img'); a.textContent = ((HERO_BY_ID[id] && HERO_BY_ID[id].name) || (id === 'grabble' ? 'Grabble' : '?')).charAt(0).toUpperCase(); }
}
function setAvatar(a, heroId, color) {
  const c = color || (HERO_BY_ID[heroId] && HERO_BY_ID[heroId].color) || '#6E8FE0';
  a.dataset.hero = heroId; a.style.setProperty('--c', c); a.classList.toggle('light', isLight(c)); paintAvatar(a);
}
function makeAvatar(heroId, color, cls = '') { const a = el('div', 'avatar ' + cls); setAvatar(a, heroId, color); return a; }
function repaintAvatars() { document.querySelectorAll('.avatar[data-hero]').forEach(paintAvatar); }

// Phone art comes from manifest-phone.json (256 px faces, a mid-size logo, mini-game art). Faces + logo load
// at boot (~1 MB); each mini-game's art loads lazily when that game is mounted (see minigames.js).
async function fetchJson(url) {
  try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; }
}
function loadFirst(urls, onok) {
  const list = [...new Set(urls.filter(Boolean))];
  const next = (i) => { if (i >= list.length) return; const img = new Image(); img.onload = () => onok(list[i]); img.onerror = () => next(i + 1); img.src = list[i]; };
  next(0);
}
async function loadArt() {
  const phone = await fetchJson('/assets/images/manifest-phone.json');
  const manifest = phone || {};
  const urlFor = (v) => (v ? '/assets/' + String(v).replace(/^\/+/, '') : null);
  // every hero, plus Grabble (the villain is not a pickable hero, but his face is on cards, strips and the ending)
  for (const id of [...HEROES.map((h) => h.id), 'grabble']) {
    // small faces first; the full-size face is only a fallback when no phone manifest / small file exists
    loadFirst([urlFor(manifest['hero_' + id + '_face']), `/assets/images/heroes/${id}_face_sm.png`, `/assets/images/heroes/${id}_face.png`],
      (url) => { S.faces[id] = url; repaintAvatars(); });
  }
  const urls = {};
  for (const [k, v] of Object.entries(manifest)) if (/^(mini_|grabble_caught|npc_|gem_|fly_)/.test(k)) urls[k] = urlFor(v);
  S.art.urls = urls;
  const logoUrl = urlFor(manifest.logo_title) || (phone ? null : '/assets/images/ui/logo_md.png');
  if (logoUrl) {
    const logo = $('logo-img'); const probe = new Image();
    probe.onload = () => { logo.src = logoUrl; logo.hidden = false; $('logo-text').hidden = true; };
    probe.src = logoUrl;
  }
}

// ---------------------------------------------------------------- sound words (chunky, bouncy)
const WORD_COLORS = {
  TING: '#FFE27A', SHIMMER: '#CFE3FF', BLOOM: '#F7B6D6', 'LA-LA': '#F7B6D6', SWISH: '#CDB4F0', BUMP: '#F2C9A0', FWOOP: '#BFE3F5',
  WOOF: '#F2C14E', HOP: '#A8E0B8', DING: '#BFE3F5', WHOOSH: '#BFE3F5', HUM: '#D8C5F0', SPLASH: '#9DD8F2', BOING: '#A8E0B8',
  STUCK: '#CDB4F0', CAKE: '#F7B6D6', PERFECT: '#FFE27A',
};
const PASTELS = ['#F7B6D6', '#BFE3F5', '#A8E0B8', '#FFE27A', '#CDB4F0'];
function wordColor(w) {
  const k = String(w).replace(/[^A-Za-z-]/g, '').toUpperCase();
  if (WORD_COLORS[k]) return WORD_COLORS[k];
  let h = 0; for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PASTELS[h % PASTELS.length];
}
function renderWord(node, word) {
  node.textContent = '';
  const text = String(word || '').trim();
  if (!text) return;
  const words = text.split(/\s+/);
  const longest = Math.max(...words.map((w) => w.length));
  const wl = words.length > 1 ? Math.max(longest, Math.ceil(text.length / 2) + 1) : text.length; // multi-word: wrap to two lines
  node.style.setProperty('--wl', Math.max(4, wl));
  node.style.setProperty('--word', wordColor(text));
  let i = 0;
  words.forEach((w) => {
    const g = el('div', 'wg');
    [...w].forEach((c) => { const s = el('span', null, c); s.style.setProperty('--i', i++); g.appendChild(s); });
    node.appendChild(g);
  });
}

// ---------------------------------------------------------------- shard ring + gem (SVG)
let ringUid = 0;
function sectorPath(cx, cy, r0, r1, a0, a1) {
  const p = (r, a) => [(cx + r * Math.cos(a)).toFixed(2), (cy + r * Math.sin(a)).toFixed(2)];
  const [x0, y0] = p(r1, a0), [x1, y1] = p(r1, a1), [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0} ${y0}A${r1} ${r1} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`;
}
function buildRing(svg, n) {
  const id = ++ringUid; svg.dataset.n = n; svg.dataset.count = '';
  svg.setAttribute('viewBox', '0 0 200 200');
  const step = (Math.PI * 2) / n; const gap = Math.min(0.14, step * 0.22);
  let segs = '';
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI / 2 + i * step + gap / 2; const a1 = -Math.PI / 2 + (i + 1) * step - gap / 2;
    segs += `<path class="seg" d="${sectorPath(100, 100, 66, 95, a0, a1)}" style="--segc:${mixHex('#6E8FE0', '#F29BC8', n > 1 ? i / (n - 1) : 1)}"/>`;
  }
  const gem = '76,64 124,64 144,90 100,138 56,90';
  const spark = 'M0 -9L2.6 -2.6 9 0 2.6 2.6 0 9-2.6 2.6-9 0-2.6-2.6Z';
  svg.innerHTML = `
    <defs>
      <linearGradient id="gg${id}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#5B8DEF"/><stop offset=".55" stop-color="#B48BE0"/><stop offset="1" stop-color="#F29BC8"/></linearGradient>
      <clipPath id="gc${id}"><polygon points="${gem}"/></clipPath>
    </defs>
    ${segs}
    <g class="gem-group">
      <polygon class="gem-empty" points="${gem}"/>
      <g clip-path="url(#gc${id})"><rect class="gem-fill" x="40" y="58" width="120" height="86" fill="url(#gg${id})" style="transform:translateY(90px)"/></g>
      <path class="gem-lines" d="M56 90H144M76 64L88 90 100 138 112 90 124 64M88 90L100 64 112 90"/>
      <polygon class="gem-edge" points="${gem}" fill="none" stroke="#2B2440" stroke-width="3.5" stroke-linejoin="round"/>
      <path class="gem-shine" d="M68 76L80 76"/>
      <text class="gem-num" x="100" y="114">0</text>
    </g>
    <g transform="translate(150 62)"><path class="twinkle" d="${spark}"/></g>
    <g transform="translate(52 112)"><path class="twinkle" d="${spark}"/></g>
    <g transform="translate(128 134)"><path class="twinkle" d="${spark}"/></g>`;
}
function setRing(svg, count, n = winTarget()) {
  if (Number(svg.dataset.n) !== n) buildRing(svg, n);
  const c = Math.max(0, Math.min(n, count | 0));
  const prev = svg.dataset.count === '' ? -1 : Number(svg.dataset.count);
  if (prev === c) return;
  svg.dataset.count = c;
  svg.querySelectorAll('.seg').forEach((s, i) => {
    const on = i < c; const was = s.classList.contains('on');
    s.classList.toggle('on', on);
    if (on && !was && prev >= 0) { s.classList.remove('new'); void s.getBoundingClientRect(); s.classList.add('new'); }
  });
  svg.querySelector('.gem-fill').style.transform = `translateY(${((1 - c / n) * 90).toFixed(1)}px)`;
  svg.querySelector('.gem-num').textContent = String(c);
  svg.classList.toggle('full', c >= n);
  svg.classList.toggle('has', c > 0);
  svg.setAttribute('aria-label', `${c} of ${n} shards`);
}

// ---------------------------------------------------------------- the die
const PIPS = { 1: [[50, 50]], 2: [[30, 30], [70, 70]], 3: [[30, 30], [50, 50], [70, 70]], 4: [[30, 30], [70, 30], [30, 70], [70, 70]], 5: [[30, 30], [70, 30], [50, 50], [30, 70], [70, 70]], 6: [[32, 28], [68, 28], [32, 50], [68, 50], [32, 72], [68, 72]] };
function drawDie(v) {
  $('die').innerHTML = `<rect x="8" y="8" width="84" height="84" rx="22" fill="#fff" stroke="#2B2440" stroke-width="5"/>` +
    PIPS[v].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="8.5" fill="#2B2440"/>`).join('');
}

// ---------------------------------------------------------------- actions (one tap = one emit; locked until next state)
function isLocked() {
  const L = S.lock; if (!L) return false;
  if (!L.sticky && Date.now() - L.at > LOCK_MS) { S.lock = null; return false; }
  if (S.state && stateKey(S.state) !== L.key) { S.lock = null; return false; }
  return true;
}
function act(ev, payload, info = {}) {
  if (!S.state || isLocked()) return false;
  if (!S.socket || !S.connected) { sfx.error(); showToast('Reconnecting… try again in a moment!'); return false; }
  const lock = { key: stateKey(S.state), at: Date.now(), ev, ...info };
  S.lock = lock;
  S.socket.emit(ev, payload, (res) => {
    if (!res || res.ok === false) {
      if (S.lock === lock) S.lock = null;
      if (info.onFail) info.onFail();
      sfx.error(); buzz(120);
      showToast(friendlyError(res && res.error));
      render();
    }
  });
  if (!info.sticky) setTimeout(() => { if (S.lock === lock) render(); }, LOCK_MS + 60);
  render();
  return true;
}
function friendlyError(e) {
  const s = String(e || '').toLowerCase();
  if (s.includes('not your turn')) return 'Hold on, it is not your turn yet!';
  if (s.includes('host')) return 'Only the host can do that.';
  if (s.includes('at least')) return 'Wait for a friend to join first!';
  return 'Oops, too late for that! Look at the big screen.';
}

function doRoll(via) {
  if (S.screen !== 'roll' || isLocked()) return;
  if (act('player:roll', {}, { kind: 'roll' })) { sfx.roll(); buzz(50); if (via === 'shake') showToast('Shake! Rolling…', 1200); }
}
function doJoin() {
  if (S.joining || !S.selectedHero || !S.connected) return;
  const roomVal = (S.roomEditable || !S.room) ? $('room-input').value.trim().toUpperCase() : S.room;
  if (!roomVal) return;
  const hero = HERO_BY_ID[S.selectedHero];
  const typed = $('name-input').value.trim();
  const name = (typed || hero.name).slice(0, 14);
  store.set(NAME_KEY, typed);
  S.room = roomVal; S.joining = true; S.joinError = ''; updateJoin();
  S.socket.emit('player:join', { room: roomVal, name, heroId: S.selectedHero }, (res) => {
    S.joining = false;
    if (res && res.ok) {
      S.meId = res.playerId; S.roomEditable = false;
      S.session = { room: roomVal, token: res.token, playerId: res.playerId };
      store.set(SESSION_KEY, JSON.stringify(S.session));
      S.booting = false;
      if (res.state) applyState(res.state, true); else render();
      sfx.join(); buzz([40, 40, 80]);
    } else {
      sfx.error(); buzz(120);
      const msg = String((res && res.error) || '').toLowerCase();
      if (res && res.state) applyState(res.state, true);
      if (msg.includes('taken')) { S.taken.add(S.selectedHero); S.selectedHero = null; S.joinError = 'Someone just picked that hero. Choose another one!'; }
      else if (msg.includes('room')) { // wrong room code: let the player fix it (pre-filled with what we tried)
        S.roomEditable = true; $('room-input').value = roomVal;
        S.joinError = 'That room code did not work. Check the big screen and type it here!';
        setTimeout(() => { try { $('room-input').focus(); $('room-input').select(); } catch { /* ignore */ } }, 50);
      } else S.joinError = (res && res.error) ? String(res.error).slice(0, 100) : 'Could not join. Try again!';
      updateJoin();
    }
  });
}

// ---------------------------------------------------------------- state intake + effects
function applyState(st, quiet) {
  if (!st || !Array.isArray(st.players)) return;
  S.state = st;
  if (st.room && !S.room) S.room = st.room;
  S.taken = new Set(st.players.map((p) => p.heroId));
  if (!quiet && S.booting && S.session) S.booting = false;
  render();
}

function runEffects(st, me) {
  if (!me) { S.prevShards = null; S.prevEventSig = null; S.prevPhase = null; return; }
  // shards
  if (S.prevShards != null && me.shards !== S.prevShards) {
    const chip = $('me-shards'); chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump');
    if (me.shards > S.prevShards) { sfx.shard(); buzz([40, 40, 90]); } else { sfx.lose(); buzz(160); }
  }
  S.prevShards = me.shards;
  // results (last event)
  const ev = st.lastEvent; const sig = ev ? `${ev.type}|${ev.text}|${ev.word}` : '';
  if (S.prevEventSig != null && sig && sig !== S.prevEventSig && Date.now() - S.lastBuzz > 400) { buzz(35); S.lastBuzz = Date.now(); }
  S.prevEventSig = sig;
  // game end
  if (S.prevPhase && S.prevPhase !== 'ended' && st.phase === 'ended') {
    if (st.winnerId === 'grabble') { sfx.sad(); buzz([200, 100, 300]); }
    else { sfx.fanfare(); buzz(st.winnerId === me.id ? [120, 60, 120, 60, 120, 60, 400] : [80, 50, 80]); }
  }
  S.prevPhase = st.phase;
}

// ---------------------------------------------------------------- screens
// The mini-game that is ours to play right now (server minigame step, or the legacy launch_timing step).
function currentMini(st, me) {
  if (!st || !me || st.phase !== 'playing') return null;
  const mg = st.minigame;
  if (st.turnStep === 'minigame' && mg && mg.playerId === me.id) {
    // keyed by room + id: a restarted server (new room code) may reuse ids, and a rejoin may move the deadline
    return { key: `mg:${st.room || S.room}:${mg.id}`, id: mg.id, type: mg.type, params: mg.params || {}, deadline: mg.deadline || st.turnDeadline, legacy: false };
  }
  if (st.turnStep === 'launch_timing' && st.turnPlayerId === me.id) {
    return { key: 'bell:' + (st.turnDeadline || st.turnPlayerId), id: null, type: 'bell', params: {}, deadline: st.turnDeadline, legacy: true };
  }
  return null;
}
function miniHolding(st, me) {
  const M = S.mini;
  if (!M.key || !M.sent || !st || !me || st.phase !== 'playing') return false;
  const needsMe = (st.turnPlayerId === me.id && INPUT_STEPS.has(st.turnStep)) || (st.turnStep === 'minigame' && st.minigame && st.minigame.playerId === me.id);
  return Date.now() < (needsMe ? Math.min(M.holdUntil, M.sentAt + MINI_HOLD_INPUT_MS) : M.holdUntil);
}
function pickScreen(st, me) {
  if (S.booting) return 'boot';
  if (!st || !me) return 'join';
  if (st.phase === 'lobby') return 'lobby';
  if (st.phase === 'ended') return 'win';
  if (currentMini(st, me)) return 'mini';
  if (miniHolding(st, me)) return 'mini';
  const mine = st.turnPlayerId === me.id;
  if (mine) {
    if (st.turnStep === 'roll') return 'roll';
    if (st.turnStep === 'choose_fetch' || st.turnStep === 'choose_launch') return 'pick';
    if (st.turnStep === 'flight_offer') return 'flight';
  }
  return 'wait';
}

function render() {
  const st = S.state; const me = meOf(st);
  if (S.meId && st && !me && !S.joining) { // the server forgot us (restart / removed)
    S.meId = null; S.session = null; store.del(SESSION_KEY);
    S.joinError = 'The game restarted. Pick your hero again!';
    if (st.room && st.room !== S.room) S.room = st.room;
  }
  const screen = pickScreen(st, me);
  const changed = screen !== S.screen;
  if (me) {
    const c = colorOf(me);
    const rs = document.documentElement.style;
    rs.setProperty('--hero', c); rs.setProperty('--hero-light', mixHex(c, '#FFFFFF', 0.82)); rs.setProperty('--hero-soft', mixHex(c, '#FFFFFF', 0.6));
    $('me-avatar').classList.toggle('light', isLight(c));
    setAvatar($('me-avatar'), me.heroId, c);
    $('me-name').textContent = nameOf(me);
    $('me-count').textContent = String(me.shards);
    $('me-target').textContent = String(winTarget());
  }
  document.body.classList.toggle('has-top', TOP_SCREENS.has(screen));
  document.body.classList.toggle('on-mini', screen === 'mini');
  $('me-shards').hidden = screen === 'lobby';
  $('topbar').hidden = !TOP_SCREENS.has(screen);

  if (changed) {
    leaveScreen(S.screen, screen);
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.dataset.screen === screen));
    S.screen = screen;
  }
  switch (screen) {
    case 'join': updateJoin(); break;
    case 'lobby': updateLobby(st, me); break;
    case 'wait': updateWait(st, me); break;
    case 'roll': updateRoll(st, me); break;
    case 'pick': updatePick(st, me); break;
    case 'mini': updateMini(st, me); break;
    case 'flight': updateFlight(st, me); break;
    case 'win': updateWin(st, me); break;
    default: break;
  }
  if (changed) enterScreen(screen, st, me);
  runEffects(st, me);
}

function leaveScreen(name) {
  if (name === 'mini') leaveMini();
  if (name === 'flight') stopFlight();
  if (name === 'pick') stopPickCd();
  if (name === 'win') stopConfetti();
  if (name === 'roll') stopDie();
  S.sigs = {};
}
function enterScreen(name, st) {
  switch (name) {
    case 'roll': sfx.myTurn(); buzz([90, 60, 90, 60, 220]); flash(); break;
    case 'pick': sfx.pick(); buzz(70); flash(); startPickCd(); break;
    case 'mini': if (!S.mini.sent) { sfx.myTurn(); buzz([70, 50, 70]); flash(); } break;
    case 'flight': startFlight(); sfx.whoosh(); buzz(70); break;
    case 'win': if (!st || st.winnerId !== 'grabble') startConfetti(); break;
    default: break;
  }
}
// A short full-screen colour flash: the "your turn" cue for phones without vibration (iOS Safari).
function flash() {
  const f = $('flash'); if (!f) return;
  f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
}

// ---- join
let heroGridBuilt = false;
function buildHeroGrid() {
  const grid = $('hero-grid'); grid.textContent = '';
  HEROES.forEach((h) => {
    const b = el('button', 'hero-tile'); b.type = 'button'; b.dataset.hero = h.id; b.setAttribute('role', 'radio');
    b.style.setProperty('--c', h.color); b.style.setProperty('--cl', mixHex(h.color, '#FFFFFF', 0.8));
    b.appendChild(makeAvatar(h.id, h.color));
    b.setAttribute('aria-label', h.name);
    b.appendChild(el('span', 'hero-name', h.name));
    b.appendChild(el('span', 'tag', ''));
    b.addEventListener('click', () => {
      if (S.taken.has(h.id)) { b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope'); sfx.error(); buzz(60); return; }
      S.selectedHero = h.id; S.joinError = ''; sfx.pick(); buzz(20); updateJoin();
    });
    grid.appendChild(b);
  });
  heroGridBuilt = true;
}
function updateJoin() {
  if (!heroGridBuilt) buildHeroGrid();
  const needRoom = !S.room || !!S.roomEditable;
  $('room-field').hidden = !needRoom;
  $('room-chip').hidden = needRoom;
  $('room-code').textContent = S.room || '----';
  if (S.selectedHero && S.taken.has(S.selectedHero)) S.selectedHero = null;
  document.querySelectorAll('#hero-grid .hero-tile').forEach((b) => {
    const id = b.dataset.hero; const taken = S.taken.has(id);
    b.classList.toggle('taken', taken); b.classList.toggle('selected', S.selectedHero === id);
    b.setAttribute('aria-checked', String(S.selectedHero === id)); b.setAttribute('aria-disabled', String(taken));
    b.querySelector('.tag').textContent = taken ? 'Taken' : '';
    b.querySelector('.tag').hidden = !taken;
  });
  const btn = $('join-btn');
  const roomOk = !needRoom || $('room-input').value.trim().length >= 3;
  let label = 'Join the adventure!'; let ok = true;
  if (S.joining) { label = 'Joining…'; ok = false; }
  else if (!S.connected) { label = 'Connecting…'; ok = false; }
  else if (!roomOk) { label = 'Type the room code'; ok = false; }
  else if (!S.selectedHero) { label = 'Pick a hero!'; ok = false; }
  btn.textContent = label; btn.disabled = !ok;
  const err = $('join-error'); err.hidden = !S.joinError; err.textContent = S.joinError;
  $('name-input').placeholder = S.selectedHero ? `Type your name (or skip!)` : 'Type your name';
}

// ---- lobby
function updateLobby(st, me) {
  setAvatar($('lobby-avatar'), me.heroId, colorOf(me));
  $('lobby-hello').textContent = `Hi ${nameOf(me)}! Look at the big screen.`;
  $('lobby-blurb').textContent = heroOf(me).blurb || '';
  const isHost = st.hostId === me.id;
  const sig = st.players.map((p) => `${p.id}:${p.heroId}:${p.name}:${p.connected}`).join(',') + '|' + st.hostId + '|' + me.id;
  if (!sameSig('lobbyPlayers', sig)) {
    const row = $('lobby-players'); row.textContent = '';
    st.players.forEach((p, i) => {
      const c = el('div', 'chip' + (p.id === me.id ? ' mine' : '')); c.style.animationDelay = `${i * 60}ms`;
      c.appendChild(makeAvatar(p.heroId, colorOf(p)));
      c.appendChild(el('span', null, nameOf(p)));
      if (p.id === st.hostId) { const cr = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); cr.setAttribute('viewBox', '0 0 24 24'); cr.setAttribute('aria-label', 'host'); cr.innerHTML = '<use href="#i-crown"/>'; c.appendChild(cr); }
      row.appendChild(c);
    });
  }
  const start = $('start-btn'); start.hidden = !isHost; $('lobby-wait').hidden = isHost;
  if (isHost) {
    const enough = st.players.length >= 2;
    start.disabled = !enough || isLocked();
    start.textContent = enough ? 'Start Game!' : 'Need a friend to play!';
    start.style.fontSize = enough ? '' : '24px';
  }
}

// ---- waiting
const STEP_TEXT = {
  roll: (n) => `${n} is about to roll`,
  moving: () => 'Hopping along the path…',
  choose_fetch: (n) => `${n} is choosing who Charli fetches from`,
  choose_launch: (n) => `${n} is choosing who goes to the bridge`,
  launch_timing: (n) => `${n} is ringing the bell!`,
  flight_offer: (n) => `${n} is thinking about flying`,
  minigame: () => 'Cheer them on!',
  resolving: () => 'Watch the big screen!',
};
function watchedMini(st, me) {
  const mg = st.minigame;
  if (st.phase !== 'playing' || st.turnStep !== 'minigame' || !mg || mg.playerId === me.id) return null;
  return mg;
}
function updateWait(st, me) {
  const tp = st.players.find((p) => p.id === st.turnPlayerId);
  const card = $('turn-card'); const mine = !!tp && tp.id === me.id;
  card.classList.toggle('mine', mine);
  if (tp) {
    setAvatar($('turn-avatar'), tp.heroId, colorOf(tp));
    $('turn-name').textContent = mine ? 'Your turn!' : `${nameOf(tp)}'s turn`;
    const f = STEP_TEXT[st.turnStep];
    $('turn-step').textContent = mine && st.turnStep !== 'resolving' && st.turnStep !== 'minigame' ? 'Watch the big screen!' : (f ? f(nameOf(tp), st) : 'Watch the big screen!');
  } else {
    setAvatar($('turn-avatar'), me.heroId, colorOf(me));
    $('turn-name').textContent = 'Get ready!'; $('turn-step').textContent = 'The next turn is starting…';
  }
  // someone else's mini-game: a live progress bar instead of the event card
  const mg = watchedMini(st, me);
  $('mini-watch').hidden = !mg; $('event-card').hidden = !!mg;
  if (mg) {
    const player = st.players.find((p) => p.id === mg.playerId) || tp;
    if (S.watch.mgId !== mg.id) S.watch = { mgId: mg.id, playerId: mg.playerId, progress: 0, done: false };
    if (!sameSig('watch', `${mg.id}|${mg.type}|${player && player.id}`)) {
      if (player) setAvatar($('mw-avatar'), player.heroId, colorOf(player));
      $('mw-text').textContent = `${player ? nameOf(player) : 'A friend'} is playing ${gameTitle(mg.type)}!`;
      $('mw-sub').textContent = (GAME_INFO[mg.type] && GAME_INFO[mg.type].line) || 'Cheer them on!';
    }
    paintWatch();
  } else {
    const ev = st.lastEvent;
    const word = ev && ev.word ? fixText(ev.word) : ''; const text = fixText((ev && ev.text) || 'Collect shards to make the Starlight Gem whole!');
    if (!sameSig('waitEvent', `${word}|${text}`)) {
      renderWord($('wait-word'), word); $('wait-text').textContent = text;
      const ec = $('event-card'); ec.classList.remove('fresh'); void ec.offsetWidth; ec.classList.add('fresh');
    }
  }
  updateGrabbleStrip(st);
  setRing($('wait-ring'), me.shards);
  $('wait-ring-label').textContent = `${me.shards} of ${winTarget()} shards`;
}
function paintWatch() {
  const pct = Math.round(Math.max(0, Math.min(1, S.watch.progress)) * 100);
  $('mw-fill').style.width = `${pct}%`;
  $('mini-watch').classList.toggle('done', !!S.watch.done);
}
function updateGrabbleStrip(st) {
  const gr = st.grabble; const strip = $('grabble-strip');
  strip.hidden = !gr;
  if (!gr) return;
  const loot = Math.max(0, gr.loot | 0); const target = grabbleTarget();
  if (sameSig('grabble', `${loot}|${target}|${!!S.faces.grabble}`)) return;
  setAvatar($('gs-avatar'), 'grabble', '#7B4FB5');
  let text = loot === 0 ? "Grabble's bag is empty!" : `Grabble has ${loot} shard${loot === 1 ? '' : 's'}!`;
  if (loot > 0 && target - loot <= 2) text += ' Stop him!';
  $('gs-text').textContent = text;
  const pips = $('gs-pips'); pips.textContent = '';
  for (let i = 0; i < target; i++) pips.appendChild(el('i', i < loot ? 'on' : ''));
  strip.classList.toggle('danger', loot > 0 && target - loot <= 2);
  strip.setAttribute('aria-label', `${text} He wins at ${target}.`);
}

// ---- your turn (roll)
function stopDie() { clearInterval(S.die.timer); S.die.timer = 0; }
function updateRoll(st, me) {
  $('roll-title').textContent = 'Your turn!';
  $('roll-sub').textContent = `Roll the dice, ${nameOf(me)}!`;
  const locked = isLocked();
  const b = $('roll-btn'); b.disabled = locked; b.classList.toggle('rolling', locked);
  $('roll-label').textContent = locked ? 'Rolling…' : 'ROLL!';
  if (locked && !S.die.timer) { S.die.timer = setInterval(() => drawDie(1 + Math.floor(Math.random() * 6)), 110); }
  if (!locked) { stopDie(); if (!sameSig('die', 'idle')) drawDie(6); }
  $('shake-hint').hidden = !(S.motion.active && !locked);
}

// ---- pick a friend (Charli Fetch / Launch). Grabble is a target card for launches (and for a fetch while
// his bag has loot). A small countdown ring shows state.turnDeadline.
function lootPips(n, target, cls) {
  const pips = el('div', 'pips ' + (cls || '')); pips.setAttribute('aria-hidden', 'true');
  for (let k = 0; k < target; k++) pips.appendChild(el('i', 'pip' + (k < n ? ' on' : '')));
  return pips;
}
function updatePick(st, me) {
  const fetch = st.turnStep === 'choose_fetch';
  const gr = st.grabble; const loot = gr ? Math.max(0, gr.loot | 0) : 0;
  const withGrabble = !!gr && (!fetch || loot > 0);
  $('pick-title').textContent = fetch ? 'Charli, fetch!' : 'Who goes to the bridge?';
  $('pick-sub').textContent = fetch
    ? (withGrabble ? 'Take a shard back from Grabble, or from a friend!' : 'Tap a friend to fetch a shard from.')
    : (withGrabble ? 'Send a friend… or catch Grabble!' : 'Tap a friend to send under the Catcher!');
  $('pick-icon').innerHTML = fetch ? '<svg viewBox="0 0 64 64"><use href="#i-paw"/></svg>' : '<svg viewBox="0 0 100 100"><use href="#i-bell"/></svg>';
  const friends = st.players.filter((p) => p.id !== me.id);
  const locked = isLocked(); const chosen = locked && S.lock.kind === 'pick' ? S.lock.target : null;
  const sig = [st.turnStep, locked, chosen, winTarget(), withGrabble, loot, !!S.faces.grabble, ...friends.map((p) => `${p.id}:${p.shards}:${p.connected}:${p.heroId}:${p.name}`)].join('|');
  if (sameSig('pick', sig)) return;
  const grid = $('friend-grid'); grid.textContent = '';
  const count = friends.length + (withGrabble ? 1 : 0);
  grid.className = 'friend-grid' + (count >= 3 ? ' cols2' : '') + (count >= 5 ? ' tight' : '');
  if (!count) { grid.appendChild(el('p', 'friend-none', 'No friends to pick yet!')); return; }
  const n = winTarget();
  const choose = (id) => { if (act('player:chooseTarget', { targetId: id }, { kind: 'pick', target: id })) { sfx.pick(); buzz(40); } };
  if (withGrabble) {
    const b = el('button', 'friend villain' + (chosen === 'grabble' ? ' chosen' : '') + (chosen && chosen !== 'grabble' ? ' dim' : '') + (fetch && loot === 0 ? ' empty' : ''));
    b.type = 'button'; b.style.setProperty('--i', 0); b.style.setProperty('--c', '#7B4FB5'); b.style.setProperty('--cs', '#E2D2F3');
    b.disabled = locked; b.dataset.id = 'grabble';
    b.setAttribute('aria-label', `Grabble, ${loot} shard${loot === 1 ? '' : 's'} in his bag`);
    b.appendChild(makeAvatar('grabble', '#7B4FB5'));
    const info = el('div', 'friend-info');
    info.appendChild(el('div', 'friend-name', 'Grabble'));
    info.appendChild(lootPips(loot, grabbleTarget(), 'loot'));
    info.appendChild(el('div', 'friend-count', loot === 0 ? 'Empty bag' : `${loot} in his bag`));
    b.appendChild(info);
    b.appendChild(el('span', 'villain-tag', fetch ? 'Take one back!' : 'Catch him!'));
    b.addEventListener('click', () => choose('grabble'));
    grid.appendChild(b);
  }
  friends.forEach((p, i) => {
    const b = el('button', 'friend' + (p.connected === false ? ' away' : '') + (fetch && p.shards === 0 ? ' empty' : '') + (chosen === p.id ? ' chosen' : '') + (chosen && chosen !== p.id ? ' dim' : ''));
    b.type = 'button'; b.style.setProperty('--i', i + (withGrabble ? 1 : 0)); b.style.setProperty('--c', colorOf(p)); b.style.setProperty('--cs', mixHex(colorOf(p), '#FFFFFF', 0.6));
    b.disabled = locked; b.dataset.id = p.id;
    b.setAttribute('aria-label', `${nameOf(p)}, ${p.shards} shard${p.shards === 1 ? '' : 's'}`);
    b.appendChild(makeAvatar(p.heroId, colorOf(p)));
    const info = el('div', 'friend-info');
    info.appendChild(el('div', 'friend-name', nameOf(p)));
    info.appendChild(lootPips(p.shards, n));
    info.appendChild(el('div', 'friend-count', p.shards === 0 ? 'No shards' : (p.shards === 1 ? '1 shard' : `${p.shards} shards`)));
    b.appendChild(info);
    b.addEventListener('click', () => choose(p.id));
    grid.appendChild(b);
  });
}
// countdown ring on the pick screen (display only: the server picks for us when it runs out)
function startPickCd() {
  const st = S.state; const key = stateKey(st);
  let rem = st && st.turnDeadline ? st.turnDeadline - Date.now() : null;
  const ring = $('pick-cd');
  if (rem == null || rem < -2000 || rem > 90000) { ring.hidden = true; return; }
  ring.hidden = false;
  if (S.pickCd.key !== key) S.pickCd = { key, total: Math.max(rem, 1000), endsAt: performance.now() + Math.max(rem, 0), timer: 0, lastSec: -1 };
  clearInterval(S.pickCd.timer); S.pickCd.timer = setInterval(tickPickCd, 200); tickPickCd();
}
function stopPickCd() { clearInterval(S.pickCd.timer); S.pickCd.timer = 0; }
function tickPickCd() {
  if (S.screen !== 'pick') return stopPickCd();
  if (S.state && stateKey(S.state) !== S.pickCd.key) return startPickCd();
  const rem = Math.max(0, S.pickCd.endsAt - performance.now()); const sec = Math.ceil(rem / 1000);
  $('pick-cd-fill').style.strokeDashoffset = String(100 - (rem / S.pickCd.total) * 100);
  $('pick-cd-num').textContent = String(sec);
  $('pick-cd').classList.toggle('low', sec <= 3);
  if (sec !== S.pickCd.lastSec) { S.pickCd.lastSec = sec; if (sec > 0 && sec <= 3 && !isLocked()) { sfx.tick(); buzz(15); } }
}

// ---- mini-games (and the bell): mounted full-screen from minigames.js
function sentKeys() { try { return JSON.parse(sessionStorage.getItem(MINI_SENT_KEY) || '[]'); } catch { return []; } }
function rememberSent(key) { try { const k = sentKeys().filter((x) => x !== key); k.push(key); sessionStorage.setItem(MINI_SENT_KEY, JSON.stringify(k.slice(-12))); } catch { /* ignore */ } }
function updateMini(st, me) {
  const mg = currentMini(st, me);
  if (mg && mg.key !== S.mini.key) startMini(mg, me);
}
function startMini(mg, me) {
  if (S.mini.ctrl) S.mini.ctrl.abort();
  const ctrl = new AbortController();
  S.mini = { key: mg.key, id: mg.id, type: mg.type, legacy: mg.legacy, ctrl, sent: false, sentAt: 0, holdUntil: 0, lastTick: 0 };
  const stage = $('mini-stage');
  if (sentKeys().includes(mg.key)) { // we already answered this one (page reloaded): just wait for the board
    S.mini.sent = true; S.mini.sentAt = Date.now();
    stage.innerHTML = '<div class="mg"><div class="mg-result"><p class="mg-res-line">You played it already!</p><p class="mg-res-sub">Watch the big screen!</p></div></div>';
    return;
  }
  const run = S.mini;
  runMinigame(mg.type, {
    container: stage, params: mg.params, deadline: mg.deadline, signal: ctrl.signal,
    audio: sound, buzz,
    hero: { id: me.heroId, name: nameOf(me), color: colorOf(me), face: S.faces[me.heroId] },
    art: { faces: S.faces, urls: S.art.urls },
    onTick: (p) => sendMiniTick(run, p),
    onDone: (score) => sendMiniResult(run, score),
    onFrame: FRAMES ? (blob) => sendMiniFrame(run, blob) : null,
  }).then(() => { if (S.mini === run && S.screen === 'mini') render(); });
}
function leaveMini() {
  const M = S.mini;
  if (M.key && !M.sent) { // the server moved on before we finished (timeout / reset)
    if (M.ctrl) M.ctrl.abort();
    if (S.state && S.state.phase === 'playing') showToast("Time's up! Watch the big screen.");
    S.mini = { key: null, id: null, type: null, legacy: false, ctrl: null, sent: false, sentAt: 0, holdUntil: 0, lastTick: 0 };
  }
}
function sendMiniTick(run, progress) {
  if (run.legacy || !run.id || run.sent || S.mini !== run) return;
  const now = Date.now(); if (now - run.lastTick < TICK_MS) return;
  run.lastTick = now;
  if (S.socket && S.connected) S.socket.emit('player:miniTick', { id: run.id, progress });
}
// live picture of the game for the board (binary Blob; the server relays it as minigame:frame). No ack.
function sendMiniFrame(run, blob) {
  if (run.legacy || !run.id || run.sent || S.mini !== run || !S.socket || !S.connected) return;
  S.socket.emit('player:miniFrame', { id: run.id, frame: blob });
}
function sendMiniResult(run, score) {
  if (run.sent) return;
  run.sent = true; run.sentAt = Date.now(); run.holdUntil = run.sentAt + MINI_HOLD_MS;
  rememberSent(run.key);
  const ev = run.legacy ? 'player:launchTiming' : 'player:miniResult';
  const payload = run.legacy ? { score } : { id: run.id, score };
  emitResult(ev, payload);
  setTimeout(() => { if (S.mini === run) render(); }, MINI_HOLD_INPUT_MS + 60);
  setTimeout(() => { if (S.mini === run) render(); }, MINI_HOLD_MS + 60);
}
function emitResult(ev, payload) {
  if (!S.socket || !S.connected) { S.pending = { ev, payload }; return; }
  S.socket.emit(ev, payload, (res) => {
    if (res && res.ok === false) { const e = String(res.error || '').toLowerCase(); if (!e.includes('already')) showToast(friendlyError(res.error)); }
  });
}
function flushPending() { const P = S.pending; if (!P) return; S.pending = null; emitResult(P.ev, P.payload); }

// ---- fairy flight (10 s, defaults to Stay)
function startFlight() {
  const st = S.state; const key = stateKey(st);
  if (S.flight.key !== key) {
    let rem = st.turnDeadline ? st.turnDeadline - Date.now() : null;
    if (rem == null || rem < -2000 || rem > 15000) rem = FLIGHT_FALLBACK_MS; // missing deadline or big clock skew
    S.flight = { key, total: Math.max(rem, 1000), endsAt: performance.now() + Math.max(rem, 0), timer: 0, lastSec: -1, sentDefault: false };
  }
  clearInterval(S.flight.timer); S.flight.timer = setInterval(tickFlight, 100); tickFlight();
}
function stopFlight() { clearInterval(S.flight.timer); S.flight.timer = 0; }
function tickFlight() {
  if (S.screen !== 'flight') return;
  const rem = Math.max(0, S.flight.endsAt - performance.now());
  const sec = Math.ceil(rem / 1000);
  const frac = Math.min(1, rem / Math.max(S.flight.total, FLIGHT_FALLBACK_MS));
  $('cd-fill').style.strokeDashoffset = String(100 - frac * 100);
  $('cd-num').textContent = String(sec);
  $('countdown').classList.toggle('low', sec <= 3 && sec > 0);
  if (sec !== S.flight.lastSec) { S.flight.lastSec = sec; if (sec > 0 && sec <= 3) { sfx.tick(); buzz(15); } }
  if (rem <= 0 && !S.flight.sentDefault && !isLocked()) {
    S.flight.sentDefault = true;
    act('player:flight', { fly: false }, { kind: 'flight', fly: false, auto: true });
  }
}
function updateFlight() {
  const locked = isLocked() && S.lock.kind === 'flight';
  $('fly-btn').disabled = locked; $('stay-btn').disabled = locked;
  $('fly-btn').style.animation = locked ? 'none' : '';
  $('flight-title').textContent = locked ? (S.lock.fly ? 'Whoosh!' : 'Staying put') : 'Fairy Flight!';
  if (locked) { stopFlight(); if (S.lock.auto) $('cd-num').textContent = '0'; }
  else if (!S.flight.timer) startFlight();
}

// ---- win
function updateWin(st, me) {
  const grabbleWon = st.winnerId === 'grabble';
  $('s-win').classList.toggle('sad', grabbleWon);
  $('win-ring').style.display = grabbleWon ? 'none' : '';
  if (grabbleWon) {
    $('win-title').textContent = 'Oh no!';
    $('win-sub').textContent = 'Grabble got away! Play again to stop him';
    setAvatar($('win-avatar'), 'grabble', '#7B4FB5');
    if (!sameSig('winWord', 'grabble')) renderWord($('win-word'), 'SWISH!');
    const npc = $('win-npc'); const url = S.art.urls.npc_grabble_net;
    if (url && npc.dataset.src !== url) { npc.dataset.src = url; npc.onload = () => { npc.hidden = false; $('win-avatar').hidden = true; }; npc.src = url; }
    else if (npc.complete && npc.naturalWidth) { npc.hidden = false; $('win-avatar').hidden = true; }
  } else {
    $('win-npc').hidden = true; $('win-avatar').hidden = false;
    const w = st.players.find((p) => p.id === st.winnerId);
    const iWon = !!w && w.id === me.id;
    $('win-title').textContent = iWon ? 'You did it!' : 'We did it!';
    $('win-sub').textContent = w ? (iWon ? 'You made the Starlight Gem whole!' : `${nameOf(w)} made the Starlight Gem whole!`) : 'The Starlight Gem is whole again!';
    setAvatar($('win-avatar'), (w || me).heroId, colorOf(w || me));
    if (!sameSig('winWord', 'gem')) renderWord($('win-word'), 'SHIMMER!');
    setRing($('win-ring'), winTarget());
  }
  const host = st.hostId === me.id;
  $('again-btn').hidden = !host; $('again-wait').hidden = host;
  $('again-btn').disabled = isLocked();
}

// ---------------------------------------------------------------- confetti
const conf = { raf: 0, parts: [], ctx: null, w: 0, h: 0, dpr: 1 };
const CONFETTI_COLORS = ['#F29BC8', '#6E8FE0', '#B48BE0', '#A8E0B8', '#F2C14E', '#BFE3F5', '#FFE27A'];
function spawnPiece(initial) {
  return {
    x: Math.random() * conf.w, y: initial ? -conf.h * 0.15 + Math.random() * conf.h * 0.85 : -20 - Math.random() * 60,
    vx: (Math.random() - 0.5) * 1.6, vy: 1.6 + Math.random() * 3.2, s: 7 + Math.random() * 9,
    r: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.25, sway: Math.random() * Math.PI * 2,
    c: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0], shape: (Math.random() * 3) | 0,
  };
}
function startConfetti() {
  const c = $('confetti'); conf.ctx = c.getContext('2d');
  conf.dpr = Math.min(2, window.devicePixelRatio || 1);
  conf.w = window.innerWidth; conf.h = window.innerHeight;
  c.width = conf.w * conf.dpr; c.height = conf.h * conf.dpr;
  conf.parts = Array.from({ length: 130 }, () => spawnPiece(true));
  const frame = () => {
    const { ctx, w, h, dpr } = conf;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    for (const p of conf.parts) {
      p.sway += 0.05; p.x += p.vx + Math.sin(p.sway) * 0.8; p.y += p.vy; p.r += p.vr;
      if (p.y > h + 20) Object.assign(p, spawnPiece(false));
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.strokeStyle = '#2B2440'; ctx.lineWidth = 1.5;
      if (p.shape === 0) { ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.strokeRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); }
      else if (p.shape === 1) { ctx.beginPath(); ctx.arc(0, 0, p.s / 2.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      else { ctx.beginPath(); for (let i = 0; i < 10; i++) { const rad = i % 2 ? p.s / 4 : p.s / 1.6; const a = (i * Math.PI) / 5; ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad); } ctx.closePath(); ctx.fill(); ctx.stroke(); }
      ctx.restore();
    }
    conf.raf = requestAnimationFrame(frame);
  };
  cancelAnimationFrame(conf.raf); conf.raf = requestAnimationFrame(frame);
}
function stopConfetti() {
  cancelAnimationFrame(conf.raf); conf.raf = 0;
  if (conf.ctx) conf.ctx.clearRect(0, 0, conf.w * conf.dpr, conf.h * conf.dpr);
}

// ---------------------------------------------------------------- device motion (shake to roll) + gestures
function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  const m = S.motion; m.active = true;
  if (m.prev) {
    const d = Math.abs(a.x - m.prev.x) + Math.abs(a.y - m.prev.y) + Math.abs(a.z - m.prev.z);
    const now = Date.now();
    if (d > 24) {
      m.hits = m.hits.filter((t) => now - t < 700); m.hits.push(now);
      if (m.hits.length >= 3 && S.screen === 'roll' && !isLocked()) { m.hits = []; doRoll('shake'); }
    }
  }
  m.prev = { x: a.x, y: a.y, z: a.z };
  if (S.screen === 'roll' && $('shake-hint').hidden && !isLocked()) $('shake-hint').hidden = false;
}
async function askMotion() {
  const M = S.motion; if (M.asked || !window.DeviceMotionEvent) return;
  if (typeof window.DeviceMotionEvent.requestPermission === 'function') {
    M.asked = true;
    try { await window.DeviceMotionEvent.requestPermission(); } catch { M.asked = false; }
  } else M.asked = true;
}
let wakeLock = null;
async function keepAwake() {
  try { if (navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { wakeLock = null; }
}
function onGesture() { gestured = true; sound.unlock(); askMotion(); keepAwake(); }

// ---------------------------------------------------------------- connection
function setBanner(show) { $('banner').hidden = !show; document.body.classList.toggle('has-banner', show); }
function rejoin() {
  const sess = S.session; if (!sess || !sess.token) { S.booting = false; render(); return; }
  S.socket.emit('player:rejoin', { token: sess.token }, (res) => {
    if (res && res.ok) {
      S.meId = res.playerId || sess.playerId; S.booting = false;
      if (res.state) applyState(res.state, true); else render();
      flushPending();
    } else {
      S.session = null; S.meId = null; store.del(SESSION_KEY); S.booting = false; render();
    }
  });
}
function wireSocket(socket) {
  S.socket = socket;
  socket.on('connect', () => { S.connected = true; setBanner(false); if (S.session) rejoin(); else { S.booting = false; render(); } });
  socket.on('disconnect', () => { S.connected = false; S.lock = null; setBanner(true); render(); });
  socket.on('connect_error', () => { S.connected = false; setBanner(true); if (S.booting && !S.session) { S.booting = false; } render(); });
  socket.on('state', (st) => applyState(st));
  socket.on('event', onServerEvent);
}
// Server animation events: phones only use the mini-game ones (someone else's live progress bar).
function onServerEvent(e) {
  if (!e || typeof e.type !== 'string') return;
  const W = S.watch; const st = S.state;
  const curId = st && st.minigame ? st.minigame.id : null;
  if (e.type === 'minigame:start') {
    S.watch = { mgId: curId, playerId: e.playerId, progress: 0, done: false };
  } else if (e.type === 'minigame:progress') {
    if (W.playerId && W.playerId !== e.playerId) S.watch = { mgId: curId, playerId: e.playerId, progress: 0, done: false };
    S.watch.playerId = e.playerId;
    S.watch.progress = Math.max(S.watch.progress, Math.max(0, Math.min(1, Number(e.progress) || 0)));
  } else if (e.type === 'minigame:end') {
    if (!W.playerId || W.playerId === e.playerId) { S.watch.progress = 1; S.watch.done = true; }
  } else return;
  if (S.screen === 'wait') paintWatch();
}

// ---------------------------------------------------------------- boot
async function boot() {
  // saved session (only for the same room)
  try { S.session = JSON.parse(store.get(SESSION_KEY) || 'null'); } catch { S.session = null; }
  const urlRoom = (qs.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (MOCK) {
    S.room = urlRoom || 'MOCK';
    S.session = qs.get('join') === '1' ? null : { room: S.room, token: 'mock-token', playerId: 'p1' };
    $('mock-chip').hidden = false;
  } else if (urlRoom) {
    S.room = urlRoom;
    if (S.session && S.session.room !== urlRoom) S.session = null;
  } else if (S.session) {
    S.room = S.session.room;
  }
  if (S.session) S.meId = S.session.playerId;
  $('name-input').value = store.get(NAME_KEY) || '';

  // wire UI
  $('name-input').addEventListener('input', () => updateJoin());
  $('room-input').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); updateJoin(); });
  $('join-btn').addEventListener('click', doJoin);
  $('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.target.blur(); } });
  $('start-btn').addEventListener('click', () => { if (act('player:start', {}, { kind: 'start' })) sfx.pick(); });
  $('again-btn').addEventListener('click', () => { if (act('player:playAgain', {}, { kind: 'again' })) sfx.pick(); });
  $('roll-btn').addEventListener('click', () => doRoll('tap'));
  $('fly-btn').addEventListener('click', () => { if (act('player:flight', { fly: true }, { kind: 'flight', fly: true })) { sfx.whoosh(); buzz(50); } });
  $('stay-btn').addEventListener('click', () => { if (act('player:flight', { fly: false }, { kind: 'flight', fly: false })) { sfx.tap(); buzz(30); } });
  const syncMute = () => $('mute-use').setAttribute('href', sound.isMuted() ? '#i-sound-off' : '#i-sound-on');
  $('mute').addEventListener('click', () => { sound.setMuted(!sound.isMuted()); syncMute(); if (!sound.isMuted()) sfx.tap(); });
  syncMute();
  ['pointerdown', 'touchend', 'click'].forEach((t) => document.addEventListener(t, onGesture, { capture: true, passive: true }));
  window.addEventListener('devicemotion', onMotion);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (S.socket && !S.socket.connected) S.socket.connect();
      keepAwake();
    }
  });
  drawDie(6);
  render();
  loadArt();

  if (MOCK) {
    const { createMockSocket } = await import('/play/mock.js');
    const hold = qs.get('hold') === '1';
    wireSocket(createMockSocket({ hold, start: Number(qs.get('step') || 0), ms: Number(qs.get('ms') || 4000), joined: qs.get('join') !== '1', players: Number(qs.get('players') || 4), game: qs.get('game') || '' }));
    $('mock-chip').addEventListener('click', () => window.__mock.next());
    document.addEventListener('keydown', (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight') window.__mock.next();
      if (e.key === 'ArrowLeft') window.__mock.prev();
      if (e.key === ' ') { e.preventDefault(); window.__mock.toggle(); }
    });
  } else {
    const { io } = await import('/socket.io/socket.io.esm.min.js');
    wireSocket(io({ reconnection: true, reconnectionDelayMax: 3000, timeout: 8000, query: { room: S.room || '' } }));
    if (!S.room) {
      fetch('/api/info').then((r) => (r.ok ? r.json() : null)).then((info) => {
        if (info && info.room && !S.room) { S.room = String(info.room).toUpperCase(); if (S.screen === 'join') updateJoin(); }
      }).catch(() => {});
    }
  }
  // never get stuck on the splash screen
  setTimeout(() => { if (S.booting) { S.booting = false; render(); } }, 5000);
  window.__kaa = { S, render, act, setRing, renderWord, onServerEvent };
}

boot();
