import { HERO_BY_ID } from '/shared/heroes.js';
import { TIERS } from '/shared/difficulty.js';
const $ = (s) => document.querySelector(s);
const WORD_COLORS = { 'TING!': '#F2C14E', 'SWISH!': '#B48BE0', 'WOOF!': '#F2B544', 'DING!': '#6E8FE0', 'UH-OH!': '#F29BC8', 'CAKE!': '#F29BC8', 'WHOOSH!': '#5B8DEF', 'HOME!': '#A8E0B8', 'BLOOM!': '#5B8DEF', 'BUMP!': '#F2B544', 'SPLASH!': '#BFE3F5', 'BOING!': '#F2C14E', 'LA-LA!': '#E86BB5', 'STUCK!': '#7B4FB5', 'HOP!': '#A8E0B8', 'GO!': '#F2C14E', 'WE DID IT!': '#F29BC8', 'PERFECT!': '#F2C14E', 'HELLO!': '#A8E0B8', 'FWOOP!': '#BFE3F5', 'GOT IT!': '#A8E0B8', 'OH NO!': '#7B4FB5', 'MINE!': '#7B4FB5', 'AWW!': '#F29BC8', 'FIZZLE!': '#B48BE0', 'RING!': '#F2C14E' };
const MINI = { flight: { title: 'Fairy Flight', hint: 'Tap to flap through the flower rings!' }, shard: { title: 'Look Under the Flowers', hint: 'Tap the flower that twinkles!' }, fetch: { title: 'Charli Fetch', hint: 'Slide Charli to catch the falling shards!' }, swish: { title: 'Dodge the Net', hint: "Hop when Grabble's net glows!" }, cake: { title: 'Strawberry Catch', hint: 'Tap the strawberries onto the cake!' }, chase: { title: 'Vine Grab', hint: 'Hold to grow the vine, let go at Grabble!' }, bell: { title: 'Ring the Bell', hint: 'Tap when the star glows brightest!' } };
const STEP_TEXT = { roll: 'roll the dice!', moving: 'is on the move…', choose_fetch: 'is picking a friend for Charli…', choose_launch: 'is choosing who goes to the bridge…', minigame: 'is playing a mini-game!', resolving: 'is on the move…' };

export class HUD {
  constructor({ images }) { this.images = images || {}; this.state = null; this.cards = new Map(); this.wordTimer = null; this.lastJoinUrl = null;
    // dice faces as pips (kids read pips faster than digits)
    const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
    document.querySelectorAll('#dice .face').forEach((f, i) => { const n = i + 1; f.textContent = ''; for (let k = 1; k <= 9; k++) { const pip = document.createElement('i'); pip.className = 'pip' + (PIPS[n].includes(k) ? ' on' : ''); f.appendChild(pip); } }); if (this.images.logo_title) { const img = $('#logoImg'); img.src = this.images.logo_title; img.hidden = false; $('#logoText').hidden = true; } }
  faceUrl(heroId) { return this.images[`hero_${heroId}_face`] || this.images[`hero_${heroId}`] || null; }
  ring(shards, target, color) {
    const r = 22, c = 2 * Math.PI * r; const segs = []; const gap = target > 8 ? 3 : 5;
    for (let i = 0; i < target; i++) { const len = c / target - gap; const off = -(i * c / target) + c / 4; segs.push(`<circle r="${r}" cx="27" cy="27" fill="none" stroke="${i < shards ? color : 'rgba(43,36,64,.15)'}" stroke-width="6" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${off}" stroke-linecap="round"/>`); }
    return `<svg class="ring" viewBox="0 0 54 54">${segs.join('')}<text x="27" y="33" text-anchor="middle">${shards}</text></svg>`;
  }
  update(state) {
    this.state = state; const target = state.winTarget || 8;
    const wrap = $('#players'); const seen = new Set();
    for (const p of state.players) {
      seen.add(p.id); let el = this.cards.get(p.id);
      if (!el) { el = document.createElement('div'); el.className = 'pcard'; el.innerHTML = `<div class="avatar"></div><div class="meta"><div class="name"></div><div class="hero"></div></div><div class="ringWrap"></div>`; wrap.insertBefore(el, $('#grabbleCard')); this.cards.set(p.id, el); }
      el.style.setProperty('--c', p.color);
      const av = el.querySelector('.avatar'); const face = this.faceUrl(p.heroId); av.style.backgroundImage = face ? `url("${face}")` : ''; av.textContent = face ? '' : p.name[0].toUpperCase();
      el.querySelector('.name').textContent = p.name; el.querySelector('.hero').textContent = HERO_BY_ID[p.heroId]?.name + (p.connected || p.isBot ? '' : ' · away');
      const rw = el.querySelector('.ringWrap'); const html = this.ring(p.shards, target, p.color); if (rw.dataset.v !== html) { rw.innerHTML = html; rw.dataset.v = html; }
      el.classList.toggle('active', state.turnPlayerId === p.id); el.classList.toggle('gone', !p.connected && !p.isBot);
    }
    for (const [id, el] of this.cards) if (!seen.has(id)) { el.remove(); this.cards.delete(id); }
    // Grabble's loot bag
    const gc = $('#grabbleCard'); gc.classList.toggle('hidden', state.phase === 'lobby');
    const gface = this.images.hero_grabble_face || this.images.npc_grabble_net; const gav = gc.querySelector('.avatar'); if (gface && !gav.style.backgroundImage) { gav.style.backgroundImage = `url("${gface}")`; gav.textContent = ''; }
    const gl = state.grabble?.loot || 0; const gt = state.grabbleTarget || 8; const ghtml = this.ring(gl, gt, '#7B4FB5'); const grw = gc.querySelector('.ringWrap'); if (grw.dataset.v !== ghtml) { grw.innerHTML = ghtml; grw.dataset.v = ghtml; }
    gc.querySelector('.hero').textContent = state.winnerId === 'grabble' ? 'He got away!' : gl >= gt - 2 ? 'Almost full! Stop him!' : `Loot bag ${gl} of ${gt}`; gc.classList.toggle('danger', gl >= gt - 2 && state.phase === 'playing');
    // lobby
    const lobby = $('#lobby'); lobby.classList.toggle('hidden', state.phase !== 'lobby');
    if (state.phase === 'lobby') {
      $('#joinUrl').textContent = state.joinUrl.replace('http://', ''); $('#roomCode').textContent = state.room;
      if (this.lastJoinUrl !== state.joinUrl) { this.lastJoinUrl = state.joinUrl; fetch('/api/qr.svg?url=' + encodeURIComponent(state.joinUrl)).then(r => r.text()).then(svg => { $('#qr').innerHTML = svg; }); }
      const lp = $('#lobbyPlayers'); const html = state.players.map(p => `<div class="chip" style="--c:${p.color}"><div class="avatar" style="${this.faceUrl(p.heroId) ? `background-image:url('${this.faceUrl(p.heroId)}')` : ''}"></div>${p.name}${p.id === state.hostId ? ' ★' : ''}</div>`).join('') || '<span class="hint">No one yet… be the first!</span>';
      if (lp.dataset.v !== html) { lp.innerHTML = html; lp.dataset.v = html; }
    }
    // turn banner
    const tb = $('#turnBanner'); const cur = state.players.find(p => p.id === state.turnPlayerId);
    tb.classList.toggle('hidden', state.phase !== 'playing' || !cur);
    if (cur) { tb.style.setProperty('--c', cur.color); const face = this.faceUrl(cur.heroId); const th = $('#turnHero'); th.style.backgroundImage = face ? `url("${face}")` : ''; const st = STEP_TEXT[state.turnStep] || ''; $('#turnText').textContent = state.turnStep === 'roll' ? `${cur.name}, ${st}` : `${cur.name} ${st}`; }
    // mini-game panel
    const mp = $('#miniPanel'); const m = state.minigame;
    if (state.turnStep === 'minigame' && m) {
      const who = state.players.find(p => p.id === m.playerId); const info = MINI[m.type] || { title: m.type, hint: '' };
      if (mp.dataset.id !== m.id) { mp.dataset.id = m.id; mp.classList.remove('hidden'); mp.style.setProperty('--c', who?.color || '#F2C14E'); const face = who ? this.faceUrl(who.heroId) : null; $('#miniFace').style.backgroundImage = face ? `url("${face}")` : ''; $('#miniTitle').textContent = `${who?.name || 'Someone'} · ${info.title}`;
        const tier = TIERS[m.params?.tier]; $('#miniTier').textContent = tier ? `${tier.label} ${'★'.repeat(tier.stars)}` : ''; $('#miniTier').hidden = !tier;
        const gp = m.params || {}; $('#miniHint').textContent = m.type === 'bell' && gp.gateCount > 1 ? `Bell ${gp.gateIndex + 1} of ${gp.gateCount} · ${gp.section?.label || ''}` : info.hint; this.miniProgress(0); this.miniDeadline = m.deadline;
        const view = $('#miniView'); view.hidden = true; if (this.frameUrl) { URL.revokeObjectURL(this.frameUrl); this.frameUrl = null; } $('#miniPlaceholder').textContent = who?.isBot ? `${who.name} is playing on their own…` : 'Look at the phone… starting!'; $('#miniPlaceholder').hidden = false; }
    } else if (!mp.classList.contains('hidden') && !this.miniHold) { mp.classList.add('hidden'); mp.dataset.id = ''; }
    // win card is shown by main.js (after the celebration), hidden here when not ended
    if (state.phase !== 'ended') $('#winOverlay').classList.add('hidden');
  }
  miniProgress(v) { $('#miniBar').style.width = Math.round(Math.max(0, Math.min(1, v)) * 100) + '%'; }
  miniFrame(frame) { // a JPEG of the phone's canvas (ArrayBuffer or Blob)
    const blob = frame instanceof Blob ? frame : new Blob([frame], { type: 'image/jpeg' }); const url = URL.createObjectURL(blob); const view = $('#miniView'); const old = this.frameUrl; this.frameUrl = url;
    view.onload = () => { if (old) URL.revokeObjectURL(old); view.hidden = false; $('#miniPlaceholder').hidden = true; }; view.src = url;
  }
  miniCountdown(secondsLeft) { const el = $('#miniTimer'); el.textContent = secondsLeft > 0 ? Math.ceil(secondsLeft) : ''; el.classList.toggle('urgent', secondsLeft <= 3 && secondsLeft > 0); }
  miniResult(text, good) { const mp = $('#miniPanel'); this.miniHold = true; $('#miniHint').textContent = text; mp.classList.toggle('good', !!good); setTimeout(() => { this.miniHold = false; mp.classList.add('hidden'); mp.classList.remove('good'); mp.dataset.id = ''; }, 1400); }
  showWin(state, { grabble = false } = {}) {
    const ov = $('#winOverlay'); ov.classList.remove('hidden'); ov.classList.toggle('sad', grabble);
    if (grabble) { $('#winWord').textContent = 'OH NO!'; $('#winName').textContent = 'Grabble got away with the starlight!'; $('#winSub').textContent = 'Play again to stop him. Teamwork!'; }
    else { const w = state.players.find(p => p.id === state.winnerId); $('#winWord').textContent = 'WE DID IT!'; $('#winName').textContent = w ? `${w.name} made the Starlight Gem whole!` : ''; $('#winSub').textContent = 'Teamwork… and then cake!'; }
  }
  dice(value) {
    const d = $('#dice'); d.classList.remove('hidden'); const cube = d.querySelector('.cube'); clearTimeout(this.diceTimer);
    const rot = { 1: [0, 0], 2: [0, -90], 3: [0, 180], 4: [0, 90], 5: [-90, 0], 6: [90, 0] }[value];
    cube.style.transition = 'none'; cube.style.transform = `rotateX(${720 + Math.random() * 360}deg) rotateY(${720 + Math.random() * 360}deg)`;
    requestAnimationFrame(() => { cube.style.transition = ''; cube.style.transform = `rotateX(${rot[0] + 1080}deg) rotateY(${rot[1] + 1440}deg)`; });
    this.diceTimer = setTimeout(() => d.classList.add('hidden'), 6000);
    return new Promise(res => setTimeout(res, 1250));
  }
  word(text, { ms = 1100 } = {}) {
    if (!text) return; const el = $('#word'); clearTimeout(this.wordTimer);
    const key = 'sfx_word_' + text.replace(/[^A-Za-z-]/g, '').toUpperCase(); const img = this.images[key];
    el.innerHTML = img ? `<img src="${img}" alt="${text}">` : text; el.style.setProperty('--wc', WORD_COLORS[text] || '#F2C14E');
    el.classList.remove('hidden'); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    this.wordTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }
  subtitle(text, ms) { const el = $('#subtitle'); clearTimeout(this.subTimer); if (!text) { el.classList.add('hidden'); return; } el.textContent = text; el.classList.remove('hidden'); this.subTimer = setTimeout(() => el.classList.add('hidden'), ms || 3500); }
  toast(text, ms = 2500) { const el = $('#toast'); el.textContent = text; el.classList.remove('hidden'); clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => el.classList.add('hidden'), ms); }
  cardCenter(playerId) { const el = playerId === 'grabble' ? $('#grabbleCard') : this.cards.get(playerId); if (!el) return { x: 120, y: 160 }; const r = el.querySelector('.ringWrap').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  flyShard(from, to, { ms = 900, color = '#F2C14E', size = 44 } = {}) {
    const el = document.createElement('div'); el.className = 'shardFly'; const img = this.images.gem_shard; el.style.width = el.style.height = size + 'px';
    el.innerHTML = img ? `<img src="${img}" style="width:100%;height:100%">` : `<svg viewBox="0 0 40 40"><polygon points="20,2 30,20 20,38 10,20" fill="${color}" stroke="#2B2440" stroke-width="3"/></svg>`;
    el.style.left = from.x - size / 2 + 'px'; el.style.top = from.y - size / 2 + 'px'; document.getElementById('hud').appendChild(el);
    const mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 140 }; const start = performance.now();
    return new Promise(res => { const step = (now) => { const t = Math.min(1, (now - start) / ms); const u = 1 - t; const x = u * u * from.x + 2 * u * t * mid.x + t * t * to.x; const y = u * u * from.y + 2 * u * t * mid.y + t * t * to.y; el.style.left = x - size / 2 + 'px'; el.style.top = y - size / 2 + 'px'; el.style.transform = `scale(${1 + Math.sin(t * Math.PI) * 0.8}) rotate(${t * 360}deg)`; if (t < 1) requestAnimationFrame(step); else { el.remove(); res(); } }; requestAnimationFrame(step); });
  }
  pulseCard(playerId) { const el = playerId === 'grabble' ? $('#grabbleCard') : this.cards.get(playerId); if (!el) return; el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 500, easing: 'ease-out' }); }
  hearts(at, n = 6) { const hud = document.getElementById('hud'); for (let i = 0; i < n; i++) { const h = document.createElement('div'); h.className = 'heart'; h.textContent = '♥'; h.style.left = at.x + (Math.random() - 0.5) * 80 + 'px'; h.style.top = at.y - 20 + 'px'; h.style.animationDelay = i * 0.12 + 's'; h.style.fontSize = 22 + Math.random() * 18 + 'px'; hud.appendChild(h); setTimeout(() => h.remove(), 2600); } }
  confetti(n = 160) { const hud = document.getElementById('hud'); const colors = ['#6E8FE0', '#B48BE0', '#F29BC8', '#F2C14E', '#A8E0B8', '#fff']; for (let i = 0; i < n; i++) { const c = document.createElement('div'); c.className = 'confetti'; c.style.left = Math.random() * 100 + 'vw'; c.style.background = colors[i % colors.length]; c.style.animationDuration = 2.5 + Math.random() * 2.5 + 's'; c.style.animationDelay = Math.random() * 1.5 + 's'; hud.appendChild(c); setTimeout(() => c.remove(), 6500); } }
}
