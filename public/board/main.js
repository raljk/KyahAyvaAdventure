import * as THREE from 'three';
import gsap from 'gsap';
import { io } from 'socket.io-client';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Timer } from 'three/addons/misc/Timer.js';
import * as layout from './layout.js';
import { SPACES, BRIDGE_INDEX, CASTLE_INDEX, CAMERA, CATCHER_STAGES, LANDMARKS, heightAt, GRABBLE_START } from './layout.js';
import { HERO_BY_ID } from '/shared/heroes.js';
import { AudioManager } from './audio.js';
import { HUD } from './hud.js';
import { Pawns } from './pawns.js';
import { fallbackVillage, fallbackCatcher } from './fallbacks.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- asset manifests ----------
async function loadJSON(url) { try { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) return null; return await r.json(); } catch { return null; } }
const imageManifest = (await loadJSON('/assets/images/manifest.json')) || {};
const audioManifest = (await loadJSON('/assets/audio/manifest.json')) || { voice: {}, sfx: {}, music: {} };
const images = Object.fromEntries(Object.entries(imageManifest).map(([k, p]) => [k, p.startsWith('/') ? p : '/assets/' + p]));
const texLoader = new THREE.TextureLoader(); const textures = {};
async function loadTextures() {
  const keys = Object.keys(images).filter(k => /^(tex_|icon_|hero_(?!.*_face)|gem_|backdrop_|board_|npc_)/.test(k));
  await Promise.all(keys.map(k => new Promise(res => texLoader.load(images[k], t => { t.colorSpace = THREE.SRGBColorSpace; if (k.startsWith('tex_')) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; textures[k] = t; res(); }, undefined, () => res()))));
}

// ---------- renderer / scene ----------
const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xBFE3F5);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 500);
const camState = { pos: new THREE.Vector3(...CAMERA.overview.pos), target: new THREE.Vector3(...CAMERA.overview.target) };
camera.position.copy(camState.pos);
scene.add(new THREE.HemisphereLight(0xBFE3F5, 0xA8E0B8, 0.85));
const sun = new THREE.DirectionalLight(0xFFF1D6, 1.7); sun.position.set(18, 36, 16); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 120 }); sun.shadow.bias = -0.0005; scene.add(sun);
scene.add(new THREE.AmbientLight(0xffffff, 0.22));
const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.42, 0.55, 0.88); composer.addPass(bloom); composer.addPass(new OutputPass());
function fitRenderer() { const w = innerWidth, h = innerHeight; const cur = renderer.getSize(new THREE.Vector2()); if (cur.x === w && cur.y === h) return; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); composer.setSize(w, h); bloom.resolution.set(w, h); }
addEventListener('resize', fitRenderer);

// ---------- world ----------
let village, catcher, pawns, gem, backdrop;
const audio = new AudioManager(); const hud = new HUD({ images });
const GEM_POS = new THREE.Vector3(LANDMARKS.gemPedestal.pos[0], LANDMARKS.gemPedestal.pos[1] + 2.2, LANDMARKS.gemPedestal.pos[2]);
async function buildWorld() {
  $('#splashStatus').textContent = 'loading pictures…'; await loadTextures();
  $('#splashStatus').textContent = 'building the village…';
  try { const mod = await import('./village.js'); village = await mod.createVillage({ scene, layout, textures, images, sky: true }); } catch (e) { console.warn('[board] village.js unavailable, using fallback', e); village = await fallbackVillage({ scene }); }
  const anchor = village.bridgeAnchor || new THREE.Vector3(...SPACES[BRIDGE_INDEX].pos);
  $('#splashStatus').textContent = 'building the Catcher…';
  try { const mod = await import('./contraption.js'); catcher = await mod.createCatcher({ scene, anchor, stages: CATCHER_STAGES, layout, textures, images, deckHeight: village.deckHeight ?? 0.1 }); } catch (e) { console.warn('[board] contraption.js unavailable, using fallback', e); catcher = await fallbackCatcher({ scene, anchor }); }
  pawns = new Pawns({ scene, textures, getBridgeSlots: () => catcher.bridgeSlots, heightAt: village.heightAt || heightAt });
  // the Starlight Gem on the pedestal in front of the castle
  gem = new THREE.Group(); gem.position.copy(GEM_POS);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 1), new THREE.MeshStandardMaterial({ color: 0xBEE3FF, emissive: 0x3E6FD6, emissiveIntensity: 0.55, roughness: 0.12, metalness: 0.25, flatShading: true, transparent: true, opacity: 0.92 })); core.scale.y = 1.45; gem.add(core);
  const inner = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), new THREE.MeshBasicMaterial({ color: 0xFFF8E7 })); inner.scale.y = 1.6; gem.add(inner); gem.userData.inner = inner;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(core.geometry, 12), new THREE.LineBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.55 })); edges.scale.copy(core.scale).multiplyScalar(1.002); gem.add(edges);
  const sparkMat = new THREE.SpriteMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.9, map: (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; const r = i % 2 ? 10 : 30; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); } g.closePath(); g.fill(); const t = new THREE.CanvasTexture(c); return t; })() });
  gem.userData.sparks = []; for (let i = 0; i < 3; i++) { const s = new THREE.Sprite(sparkMat); s.scale.setScalar(0.5); s.userData.phase = i * 2.1; gem.add(s); gem.userData.sparks.push(s); }
  const halo = new THREE.PointLight(0x9ED4FF, 1.2, 12); gem.add(halo); gem.userData = { core, halo }; scene.add(gem);
  buildGemDecor();
}
// the flower lock (Kyah) and the musical key (Ayva) that appear when the gem is made whole
let gemDecor;
function buildGemDecor() {
  gemDecor = new THREE.Group(); gem.add(gemDecor);
  const ring = new THREE.Group(); const petal = new THREE.SphereGeometry(0.17, 10, 8); const leaf = new THREE.SphereGeometry(0.1, 8, 6);
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; const f = new THREE.Mesh(petal, new THREE.MeshToonMaterial({ color: i % 2 ? 0x5B8DEF : 0xF29BC8, emissive: i % 2 ? 0x1b2f70 : 0x6b2a4a, emissiveIntensity: 0.4 })); f.position.set(Math.cos(a) * 1.9, Math.sin(a * 2) * 0.25, Math.sin(a) * 1.9); ring.add(f); const l = new THREE.Mesh(leaf, new THREE.MeshToonMaterial({ color: 0x7FB069 })); l.position.set(Math.cos(a + 0.2) * 2.15, 0, Math.sin(a + 0.2) * 2.15); ring.add(l); }
  const vine = new THREE.Mesh(new THREE.TorusGeometry(1.95, 0.06, 8, 64), new THREE.MeshToonMaterial({ color: 0x5C9A4A })); vine.rotation.x = Math.PI / 2; ring.add(vine);
  ring.scale.setScalar(0.001); gemDecor.add(ring);
  const notes = new THREE.Group();
  for (let i = 0; i < 6; i++) { const n = new THREE.Group(); const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshToonMaterial({ color: i % 3 === 0 ? 0xE86BB5 : i % 3 === 1 ? 0xB48BE0 : 0xF2C14E, emissive: 0x442244, emissiveIntensity: 0.5 })); head.scale.set(1.2, 0.8, 1); const stem = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.05), head.material); stem.position.set(0.14, 0.3, 0); n.add(head, stem); n.userData.phase = (i / 6) * Math.PI * 2; notes.add(n); }
  notes.visible = false; gemDecor.add(notes); gemDecor.userData = { ring, notes };
}
function resetGemDecor() { if (!gemDecor) return; gemDecor.userData.ring.scale.setScalar(0.001); gemDecor.userData.notes.visible = false; }
async function assembleGem(fromWorld, n) {
  const geo = new THREE.OctahedronGeometry(0.28, 0); const mat = new THREE.MeshStandardMaterial({ color: 0x9ED4FF, emissive: 0x3E6FD6, emissiveIntensity: 1.4 });
  const shards = []; for (let i = 0; i < n; i++) { const m = new THREE.Mesh(geo, mat); m.scale.y = 1.5; m.position.copy(fromWorld).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 1.5, (Math.random() - 0.5) * 1.5)); scene.add(m); shards.push(m); }
  await Promise.all(shards.map((m, i) => new Promise(res => { const from = m.position.clone(); const mid = from.clone().lerp(GEM_POS, 0.5).add(new THREE.Vector3(0, 6 + i * 0.4, 0)); gsap.to({ t: 0 }, { t: 1, duration: 1.3, delay: i * 0.12, ease: 'power2.inOut', onUpdate() { const t = this.targets()[0].t; const u = 1 - t; m.position.set(u * u * from.x + 2 * u * t * mid.x + t * t * GEM_POS.x, u * u * from.y + 2 * u * t * mid.y + t * t * GEM_POS.y, u * u * from.z + 2 * u * t * mid.z + t * t * GEM_POS.z); m.rotation.y += 0.2; }, onComplete: () => { scene.remove(m); audio.sfx('shard_ting', { rate: 1 + i * 0.05, volume: 0.6 }); gsap.fromTo(gem.scale, { x: 1.15, y: 1.15, z: 1.15 }, { x: 1, y: 1, z: 1, duration: 0.3 }); res(); } }); })));
}

// ---------- camera helpers ----------
let camTween = null; let idleDrift = true; let followCatcher = false;
function camTo(preset, duration = 1.4, ease = 'power2.inOut', { whoosh = true } = {}) {
  const pos = Array.isArray(preset.pos) ? new THREE.Vector3(...preset.pos) : preset.pos.clone(); const target = Array.isArray(preset.target) ? new THREE.Vector3(...preset.target) : preset.target.clone();
  camTween && camTween.kill(); if (whoosh && duration >= 1 && camState.pos.distanceTo(pos) > 12) audio.sfx('camera_whoosh', { volume: 0.5 });
  return new Promise(res => { camTween = gsap.to(camState.pos, { x: pos.x, y: pos.y, z: pos.z, duration, ease, onComplete: res }); gsap.to(camState.target, { x: target.x, y: target.y, z: target.z, duration, ease }); });
}
function camFollowPath(path, duration) {
  if (!path || !path.pos?.length) return Promise.resolve(); camTween && camTween.kill();
  if (path.times && path.times.length === path.pos.length) { const tl = gsap.timeline(); camTween = tl; path.pos.forEach((p, i) => { const prev = i ? path.times[i - 1] : 0; const d = Math.max(0.05, path.times[i] - prev); const t = path.target[i]; tl.to(camState.pos, { x: p.x, y: p.y, z: p.z, duration: d, ease: 'power1.inOut' }, prev); tl.to(camState.target, { x: t.x, y: t.y, z: t.z, duration: d, ease: 'power1.inOut' }, prev); }); return new Promise(res => tl.eventCallback('onComplete', res)); }
  const pc = new THREE.CatmullRomCurve3([camState.pos.clone(), ...path.pos]); const tc = new THREE.CatmullRomCurve3([camState.target.clone(), ...path.target]);
  return new Promise(res => { camTween = gsap.to({ t: 0 }, { t: 1, duration, ease: 'none', onUpdate() { const t = this.targets()[0].t; camState.pos.copy(pc.getPoint(t)); camState.target.copy(tc.getPoint(t)); }, onComplete: res }); });
}
function camToPawn(id, { dist = 11, height = 7, duration = 1.1 } = {}) { const p = pawns.worldPos(id); const dir = new THREE.Vector3(p.x, 0, p.z).normalize(); if (!dir.lengthSq()) dir.set(0, 0, 1); const pos = p.clone().add(new THREE.Vector3(dir.x * dist * 0.4 + 2, height, dir.z * dist * 0.4 + dist * 0.8)); return camTo({ pos, target: p.clone().add(new THREE.Vector3(0, 0.6, 0)) }, duration); }
function screenPos(v3) { const v = v3.clone().project(camera); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight }; }

// ---------- render loop ----------
const timer = new Timer(); let elapsed = 0; let lastTick = -1;
function frame() {
  fitRenderer(); timer.update(); const dt = Math.min(0.05, timer.getDelta()); elapsed += dt;
  village?.update?.(dt, elapsed); catcher?.update?.(dt, elapsed); pawns?.update?.(dt);
  if (gem) { gem.rotation.y += dt * 0.6; gem.position.y = GEM_POS.y + Math.sin(elapsed * 1.3) * 0.15; gem.userData.halo.intensity = 1 + Math.sin(elapsed * 2.1) * 0.3; if (gem.userData.inner) gem.userData.inner.rotation.y -= dt * 1.1;
    gem.userData.sparks?.forEach((s, i) => { const a = elapsed * 1.9 + s.userData.phase; s.position.set(Math.cos(a) * 1.1, Math.sin(a * 1.7) * 0.9, Math.sin(a) * 1.1); s.scale.setScalar(0.25 + 0.3 * Math.abs(Math.sin(elapsed * 3 + i))); });
    if (gemDecor?.userData.notes.visible) gemDecor.userData.notes.children.forEach((nn, i) => { const a = elapsed * 1.4 + nn.userData.phase; nn.position.set(Math.cos(a) * 2.6, 1.2 + Math.sin(elapsed * 2 + i) * 0.5, Math.sin(a) * 2.6); nn.rotation.y = -a; }); }
  if (state?.minigame && state.turnStep === 'minigame') { const left = (state.minigame.deadline - Date.now()) / 1000; hud.miniCountdown(left); const s = Math.ceil(left); if (s <= 3 && s >= 1 && s !== lastTick) { lastTick = s; audio.sfx('timer_tick', { volume: 0.6 }); } } else lastTick = -1;
  if (followCatcher && catcher?.cameraPath?.sample && typeof catcher.time === 'number') { const smp = catcher.cameraPath.sample(catcher.time); if (smp?.pos && smp?.target) { camState.pos.copy(smp.pos); camState.target.copy(smp.target); } }
  const drift = idleDrift ? new THREE.Vector3(Math.sin(elapsed * 0.11) * 1.2, Math.sin(elapsed * 0.07) * 0.5, 0) : new THREE.Vector3();
  camera.position.copy(camState.pos).add(drift); camera.lookAt(camState.target);
  composer.render(); requestAnimationFrame(frame);
}

// ---------- socket + event queue ----------
const socket = io({ transports: ['websocket', 'polling'] });
let state = null; let ready = false; const queue = []; let processing = false;
socket.on('connect', () => { socket.emit('board:hello', { ready }); const el = $('#splashStatus'); if (el) el.textContent = 'connected'; if (ready) hud.toast('Connected to the game'); });
socket.on('disconnect', () => hud.toast('Connection lost… reconnecting'));
socket.on('state', s => { const prev = state; state = s; if (!ready) return; hud.update(s); pawns.sync(s.players); pawns.setActive(s.phase === 'playing' ? s.turnPlayerId : null); if (s.phase !== 'lobby') { pawns.ensureGrabble(); pawns.setGrabbleLoot(s.grabble?.loot || 0); } if (s.phase === 'lobby') { pawns.placeAll(s.players); if (prev?.phase !== 'lobby' && pawns.grabble) pawns.place('grabble', GRABBLE_START, s.players); } });
socket.on('event', ev => { queue.push(ev); pump(); });
socket.on('minigame:frame', ({ id, frame }) => { if (ready && state?.minigame?.id === id && frame) hud.miniFrame(frame); });
async function pump() {
  if (processing) return; processing = true;
  while (queue.length) {
    const ev = queue.shift();
    if (!ready || document.hidden) { if (ready && state) { hud.update(state); pawns.sync(state.players); pawns.placeAll(state.players); if (pawns.grabble) pawns.place('grabble', state.grabble.space, state.players); if (ev.type === 'launch') catcher.reset(); if (document.hidden) console.warn('[board] tab hidden, skipped animation for', ev.type); } socket.emit('board:animDone', { eventId: ev.id }); continue; }
    try { await (handlers[ev.type] || (async () => {}))(ev); } catch (e) { console.error('[board] handler failed', ev.type, e); }
    socket.emit('board:animDone', { eventId: ev.id });
  }
  processing = false;
}
const P = (id) => state?.players.find(p => p.id === id);
const nameOf = (id) => id === 'grabble' ? 'Grabble' : (P(id)?.name || 'Someone');

const STAGE_FX = {
  bell: { sfx: 'bell_ding', voice: 'ayva_ding', word: 'DING!' }, net: { sfx: 'net_swing', word: 'SWISH!' }, bucket: { sfx: 'bucket_bump', word: 'BUMP!' },
  tub: { sfx: 'tub_splash_bubbles', word: 'SPLASH!' }, pipe: { sfx: 'pipe_rattle', sfx2: 'marble_roll' }, vine: { sfx: 'vine_bloom', voice: 'kyah_bloom', word: 'BLOOM!' },
  drop: { sfx: 'bucket_tip' }, apple: { sfx: 'apple_roll_stairs' }, pup: { sfx: 'seesaw_boing', word: 'BOING!' },
  music: { sfx: 'music_rise', voice: 'ayva_lala', word: 'LA-LA!' }, basket: { sfx: 'basket_whoosh_drop', word: 'WHOOSH!' },
  caught: { sfx: 'caught_stuck', word: 'STUCK!' }, missed: { sfx: 'missed_hop', word: 'HOP!' },
};
// Catcher cue → sound (cues the contraption fires between stages)
const CUE_SFX = { rope_tug: ['rope_tug'], marble_spill: ['marble_roll', { volume: 0.7 }], loop: ['marble_roll', { rate: 1.3, volume: 0.6 }], pop: ['bucket_clank', { rate: 1.2, volume: 0.6 }], vine_arrive: ['vine_grow'], clunk: ['bucket_clank'], apple_pop: ['flower_tap', { rate: 0.8 }], gutter: ['marble_roll', { rate: 0.8 }], jump: ['flight_whoosh', { volume: 0.5 }], woof: ['pup_woof'], dog_splash: ['dog_splash'], duck_slide: ['hop_dodge', { volume: 0.5 }], bonk: ['bucket_bump', { rate: 1.3 }], notes_top: ['twinkle'], latch: ['bucket_clank', { rate: 1.4, volume: 0.7 }], lift: ['vine_grab'] };
async function endLaunch() { followCatcher = false; catcher.reset(); pawns.setLabelsVisible(true); pawns.setLaunchScale(1); idleDrift = true; audio.playMusic('music_play'); await camTo(CAMERA.overview, 1.8); }
const MINI_WORDS = { great: 'PERFECT!', good: 'GOT IT!', bad: 'HOP!' };

const handlers = {
  async 'lobby:joined'({ playerId }) { audio.sfx('ui_join'); hud.update(state); pawns.sync(state.players); pawns.placeAll(state.players); if (P(playerId)) { hud.word('HELLO!', { ms: 900 }); pawns.jump(playerId); } audio.voice('player_joined'); },
  async 'game:start'() { $('#lobby').classList.add('hidden'); audio.stopVoices(); audio.playMusic('music_play'); catcher.reset(); pawns.setLabelsVisible(true); pawns.sync(state.players); pawns.placeAll(state.players); pawns.ensureGrabble(); pawns.place('grabble', GRABBLE_START, state.players); pawns.setGrabbleLoot(0); hud.word('GO!', { ms: 1200 }); followCatcher = false; idleDrift = true; await camTo(CAMERA.overview, 1.6); },
  async 'game:reset'() { audio.stopVoices(); audio.playMusic('music_lobby'); catcher.reset(); pawns.setLabelsVisible(true); pawns.placeAll(state.players); if (pawns.grabble) pawns.place('grabble', GRABBLE_START, state.players); gem.scale.set(1, 1, 1); gem.position.copy(GEM_POS); resetGemDecor(); $('#winOverlay').classList.add('hidden'); followCatcher = false; idleDrift = true; await camTo(CAMERA.overview, 1.2); },
  async dice({ value }) { audio.sfx('dice_roll'); await hud.dice(value); audio.sfx('dice_land'); },
  async move({ playerId, path, to, bumped }) {
    await pawns.hop(playerId, path, state.players, (idx, last) => { audio.sfx('pawn_hop', { rate: 0.95 + Math.random() * 0.15, volume: 0.6 }); if (last) village.setTileHighlight(idx, true); });
    if (bumped) hud.toast('Bumped forward to a free space'); setTimeout(() => village.setTileHighlight(to, false), 2500);
  },
  async space({ index, spaceType }) { const w = SPACES[index].word; if (w) hud.word(w); if (spaceType === 'cake') audio.sfx('cake_party'); if (spaceType === 'bridge') audio.sfx('bridge_land'); if (spaceType === 'swish') audio.sfx('music_sting_grabble', { volume: 0.7 }); await sleep(w ? 600 : 200); },
  async shard({ playerId, delta, total, reason, fromPlayerId }) {
    const to = hud.cardCenter(playerId);
    if (delta > 0) { audio.sfx('shard_ting', { rate: 1 + Math.min(0.3, total * 0.04) }); audio.sfx('shard_fly', { volume: 0.5 }); const from = reason === 'catch' && catcher.basketWorldPos ? screenPos(catcher.basketWorldPos) : fromPlayerId ? hud.cardCenter(fromPlayerId) : screenPos(pawns.worldPos(playerId)); const n = Math.min(delta, 3); for (let i = 0; i < n; i++) { hud.flyShard(from, to, { ms: 800 + i * 120, color: P(playerId)?.color }); await sleep(120); } await sleep(700); hud.pulseCard(playerId); }
    else { const from = hud.cardCenter(playerId); const dest = fromPlayerId ? hud.cardCenter(fromPlayerId) : (reason === 'grabble' || reason === 'swish') ? hud.cardCenter('grabble') : screenPos(pawns.worldPos(playerId)); await hud.flyShard(from, dest, { ms: 700 }); }
  },
  async fetch({ playerId, targetId }) { audio.sfx('pup_woof'); hud.word('WOOF!'); if (targetId === 'grabble') { audio.voice('grabble_tripped', { duck: false, channel: 'character', maxWait: 1500 }); await pawns.shake('grabble'); } else await pawns.jump(targetId, { height: 1 }); await sleep(250); },
  async flight({ playerId, to }) { audio.sfx('flight_whoosh'); hud.word('WHOOSH!'); if (P(playerId)?.heroId === 'ayva') audio.voice('ayva_fly', { duck: false }); await pawns.arc(playerId, to, state.players, { height: 8, duration: 1.7 }); idleDrift = true; await camTo(CAMERA.overview, 1.5); },
  async sendToBridge({ targetId, to }) { hud.word('UH-OH!'); audio.sfx('flight_whoosh', { rate: 0.8 }); if (targetId === 'grabble') audio.voice('grabble_mine', { duck: false }); const first = catcher.cameraPath?.pos?.length ? { pos: catcher.cameraPath.pos[0], target: catcher.cameraPath.target[0] } : CAMERA.catcher; await Promise.all([pawns.arc(targetId, to, state.players, { height: 5, duration: 1.4 }), camTo(CAMERA.catcher, 1.4)]); idleDrift = false; },
  async launch({ byPlayerId, targets, grabble, caught, perfect }) {
    idleDrift = false; audio.playMusic(audioManifest.music?.music_catcher_long ? 'music_catcher_long' : 'music_catcher', { fade: 0.4, loop: !audioManifest.music?.music_catcher_long, then: 'music_play' }); pawns.setLabelsVisible(false); pawns.setLaunchScale(0.6);
    const onStage = (id) => { const fx = STAGE_FX[id]; if (!fx) return; fx.sfx && audio.sfx(fx.sfx); fx.voice && audio.voice(fx.voice, { duck: false, channel: 'character', maxWait: 1200 }); fx.word && hud.word(fx.word, { ms: 900 });
      if (id === 'caught') { if (grabble) audio.voice('grabble_pride', { duck: false, channel: 'character', maxWait: 1500 }); if (perfect) setTimeout(() => hud.word('PERFECT!', { ms: 1000 }), 950); }
      if (id === 'missed' && grabble) audio.voice('grabble_missed', { duck: false, channel: 'character', maxWait: 1500 });
      if (id === 'missed') { [...targets, ...(grabble ? ['grabble'] : [])].forEach((t, i) => setTimeout(() => pawns.jump(t, { height: 1.8 }), 120 + i * 90)); } };
    const duration = catcher.duration || catcher.cameraPath?.duration || 30;
    if (catcher.cameraPath?.sample) { camTween && camTween.kill(); followCatcher = true; } else camFollowPath(catcher.cameraPath, duration);
    const onCue = (name) => { const m = CUE_SFX[name]; if (m) audio.sfx(m[0], m[1] || {}); else if (/^step_\d+$/.test(name)) audio.sfx('pawn_hop', { rate: 1.2 + Math.random() * 0.2, volume: 0.45 }); if (name === 'dog_splash') hud.word('SPLASH!', { ms: 800 }); };
    try { await catcher.play({ caught, perfect, onStage, onCue }); } finally { followCatcher = false; }
  },
  async caught({ grabble, taken, spilled }) { if (grabble) { audio.sfx('loot_spill'); const from = catcher.basketWorldPos ? screenPos(catcher.basketWorldPos) : screenPos(pawns.worldPos('grabble')); for (let i = 0; i < Math.min(spilled, 5); i++) { hud.flyShard(from, { x: from.x + (Math.random() - 0.5) * 500, y: -60 }, { ms: 900 + i * 80 }); await sleep(90); } } await sleep(500); await endLaunch(); },
  async missed() { await sleep(350); await endLaunch(); },
  async 'grabble:reset'() { audio.sfx('grabble_scurry'); await pawns.arc('grabble', GRABBLE_START, state.players, { height: 9, duration: 1.6 }); pawns.setGrabbleLoot(0); },
  async narrate({ key, wait }) {
    const line = NARRATION[key] || ''; const show = (dur) => hud.subtitle(line, Math.max(1800, (dur || audio.voiceDuration(key)) * 1000 + 600));
    if (wait === false) { audio.voice(key, { maxWait: 4000, onStart: show }).then(ok => { if (!ok && !audio.ctx) show(); }); return; }
    const played = await audio.voice(key, { maxWait: 6000, onStart: show }); if (!played) { show(); await sleep(Math.min(2600, 700 + line.length * 28)); }
  },
  async lap({ playerId }) { audio.sfx('lap_fanfare'); hud.word('HOME!'); await pawns.jump(playerId); },
  async almostWin({ playerId }) { audio.sfx('almost_win_sparkle'); hud.pulseCard(playerId); gsap.to(gem.userData.core.material, { emissiveIntensity: 2.2, yoyo: true, repeat: 3, duration: 0.3 }); await sleep(300); },
  // ----- Grabble -----
  async 'grabble:move'({ path, hop }) { pawns.ensureGrabble(); audio.sfx('grabble_scurry', { volume: 0.7 }); if (hop) { hud.word('HOP!', { ms: 800 }); audio.voice('grabble_hop', { duck: false, channel: 'character', maxWait: 1500 }); } await pawns.hop('grabble', path, state.players, null, { stepDur: 0.3 }); },
  async 'grabble:snatch'({ playerId, fromSpace }) { audio.sfx('grabble_snatch'); hud.word('SWISH!'); if (!fromSpace) audio.voice('grabble_shiny', { duck: false, channel: 'character', maxWait: 1500 }); await Promise.all([pawns.shake(playerId), pawns.jump('grabble', { height: 0.9 })]); },
  async 'grabble:loot'({ delta, total, reason }) { pawns.setGrabbleLoot(total); if (delta > 0) { if (reason === 'pocket') { hud.word('MINE!', { ms: 900 }); audio.voice('grabble_bag', { duck: false, channel: 'character', maxWait: 1500 }); const from = screenPos(pawns.worldPos('grabble')); await hud.flyShard(from, hud.cardCenter('grabble'), { ms: 700 }); } hud.pulseCard('grabble'); } await sleep(150); },
  async 'grabble:win'() { idleDrift = false; audio.stopVoices(); audio.stopMusic(0.4); pawns.setLabelsVisible(true); catcher.reset();
    audio.sfx('music_sting_grabble'); audio.voice('grabble_mine', { duck: false, priority: true, channel: 'character', maxWait: 5000 }); audio.voice('grabble_bag', { duck: false, channel: 'character', maxWait: 6000 });
    await camToPawn('grabble', { dist: 9, height: 5.5, duration: 1.6 }); hud.word('MINE!', { ms: 1400 }); audio.sfx('loot_spill');
    const from = screenPos(pawns.worldPos('grabble')); for (let i = 0; i < 6; i++) { hud.flyShard(from, hud.cardCenter('grabble'), { ms: 700 + i * 90, size: 36 }); await sleep(100); }
    await pawns.jump('grabble', { height: 2 }); await pawns.jump('grabble', { height: 1.4 }); await sleep(600); hud.showWin(state, { grabble: true });
    setTimeout(() => audio.playMusic('music_lobby', { fade: 2.5 }), 1800); await sleep(1200); },
  // ----- Benny & Miss Suds -----
  async flirt({ key, text, bennyId, missId, reply }) {
    hud.subtitle(`Benny: “${text}”`, Math.max(2200, audio.voiceDuration(key) * 1000 + 800)); hud.word('AWW!', { ms: 1100 }); audio.sfx('twinkle', { volume: 0.6 });
    hud.hearts(screenPos(pawns.worldPos(bennyId)), 8); pawns.jump(bennyId, { height: 1.2 });
    const played = await audio.voice(key); if (!played) await sleep(Math.min(2600, 700 + text.length * 28));
    if (reply) { hud.subtitle(`Miss Suds: “${NARRATION[reply] || ''}”`, 2600); hud.hearts(screenPos(pawns.worldPos(missId)), 5); pawns.jump(missId, { height: 0.9 }); const ok = await audio.voice(reply); if (!ok) await sleep(1600); }
  },
  // ----- chase -----
  async 'chase:start'({ playerId }) { audio.sfx('vine_grow'); const hero = P(playerId)?.heroId; if (hero === 'kyah') audio.voice('kyah_catch', { duck: false }); else if (hero === 'ayva') audio.voice('ayva_lift', { duck: false }); hud.word('BLOOM!'); idleDrift = false; await camToPawn(playerId, { dist: 12, height: 7 }); },
  async 'chase:end'({ playerId, won, taken }) { if (won) { audio.sfx('vine_grab'); audio.sfx('mini_win_jingle'); hud.word('GOT IT!'); if (P(playerId)?.heroId === 'kyah') audio.voice('kyah_gotit', { duck: false }); await Promise.all([pawns.jump(playerId), pawns.shake('grabble')]); } else { audio.sfx('mini_lose_jingle', { volume: 0.6 }); } await sleep(300); idleDrift = true; camTo(CAMERA.overview, 1.6); },
  // ----- mini-games -----
  async 'minigame:start'({ playerId, miniType }) { hud.update(state); audio.sfx('ui_tap'); if (miniType === 'bell') { audio.voice('launch_go', { duck: false, channel: 'character', maxWait: 2500 }); return; } idleDrift = false; await camToPawn(playerId, { dist: 13, height: 8, duration: 1.0 }); },
  async 'minigame:progress'({ progress }) { hud.miniProgress(progress); },
  async 'minigame:end'({ playerId, miniType, score, outcome }) {
    const good = outcome.gain > 0 || outcome.fly || outcome.safe || outcome.bonus || outcome.won || outcome.caught; const great = outcome.gain >= 2 || outcome.perfect || (outcome.fly && outcome.bonus);
    hud.miniProgress(1); hud.miniResult(great ? 'Wonderful!' : good ? 'Nice!' : 'Nice try!', good); audio.sfx(good ? 'mini_win_jingle' : 'mini_lose_jingle');
    if (miniType !== 'bell') { if (great) hud.word('PERFECT!', { ms: 900 }); await sleep(700); if (miniType !== 'chase' && !(miniType === 'flight' && outcome.fly)) { idleDrift = true; camTo(CAMERA.overview, 1.4); } }
  },
  async win({ playerId }) {
    idleDrift = false; audio.stopVoices(); audio.stopMusic(0.5); pawns.setLabelsVisible(true); audio.sfx('win_fanfare');
    await camTo(CAMERA.castle, 2.0);
    // assemble the gem: 3D shards fly in from the winner's pawn, the flower lock blooms, the musical key rises
    audio.sfx('gem_assemble');
    await assembleGem(pawns.worldPos(playerId), Math.min(state.winTarget || 8, 10));
    gsap.to(gem.scale, { x: 1.8, y: 1.8, z: 1.8, duration: 1.4, ease: 'elastic.out(1,0.5)' }); gsap.to(gem.userData.core.material, { emissiveIntensity: 2.6, duration: 1 }); gsap.to(gem.userData.halo, { intensity: 7, distance: 40, duration: 1 });
    audio.sfx('vine_bloom'); audio.voice('kyah_bloom', { duck: false }); hud.word('BLOOM!', { ms: 900 }); gsap.to(gemDecor.userData.ring.scale, { x: 1, y: 1, z: 1, duration: 1.2, ease: 'elastic.out(1,0.5)' }); await sleep(1000);
    audio.sfx('music_rise'); audio.voice('ayva_lift', { duck: false }); audio.voice('ayva_wedidit', { duck: false }); hud.word('LA-LA!', { ms: 900 }); gemDecor.userData.notes.visible = true; await sleep(600);
    hud.confetti(); audio.sfx('confetti'); audio.playMusic('music_victory', { fade: 0.8, loop: false });
    await sleep(2200); hud.showWin(state); await sleep(800);
  },
};

// subtitles (mirrors the audio script; v1 + v2)
const NARRATION = {
  intro_lobby: 'Welcome to the village! Scan the code with your phone to join the adventure.', player_joined: 'A new friend has arrived!',
  game_start: 'Grabble has scattered the Starlight Gem into shards all over the village! Collect enough shards to make it whole again, before Grabble fills his bag. Ready... go!',
  grabble_intro: "Watch out! Grabble is sneaking around the village, snatching shards for himself. Don't let him fill his bag!",
  turn_roll: 'Your turn! Roll the dice!', turn_nudge: "Hello? It's your turn! Give the dice a roll.", dice_1: 'One!', dice_2: 'Two!', dice_3: 'Three!', dice_4: 'Four!', dice_5: 'Five!', dice_6: 'Six!',
  space_shard: 'Ting! A starlight shard, glowing under the flowers!', space_shard_alt: 'Look under the flowers! A shard!', space_swish: "Swish! Grabble snatched a shard! Hey, that isn't yours!", space_swish_empty: "Swish! Grabble's net came up empty. Nothing to snatch!",
  space_fetch_choose: 'Charli wants to fetch! Pick a friend.', space_fetch: 'Woof! Charli fetched a shard from a friend!', space_fetch_sky: 'Woof! Nobody had a shard, so Charli found one in the sky!', space_cake: 'Teatime! Cake for everyone! Everybody gets a shard.',
  space_cobble: 'Flying takes practice. So does landing!', space_cobble_alt: 'A quiet cobblestone. Nothing here but flowers.', space_cobble_alt2: 'Small kindness, brighter days.',
  space_flight_offer: 'A fairy flight! Would you like to fly across the village?', space_flight_go: 'Whoosh! Up and over the rooftops!', space_flight_stay: 'Staying put. Maybe next time!', space_bridge_land: 'You landed on the bridge. Careful, the Catcher is right above you!',
  launch_choose: 'Time to launch the Catcher! Who will you send to the bridge?', launch_sent: 'Off to the bridge they go!', launch_ready: 'Ring the bell when the star glows brightest!', launch_go: 'Ready... sing!',
  launch_caught: "Caught in the flower basket! I'm stuck! Hand over a shard!", launch_caught_many: 'Everyone on the bridge is caught! A shard from each of them!', launch_caught_empty: 'Caught! But their pockets are empty. No shards to give.', launch_perfect: 'Perfect ring! The whole village heard that bell!', launch_missed: 'Hop! Missed me! The basket swung wide.',
  lap_bonus: 'Home to the castle! Two bonus shards for making it all the way around!', almost_win: 'Five shards! Just one more to make the Starlight Gem whole!', almost_win_generic: 'Just one more shard to make the Starlight Gem whole!',
  win: 'The Starlight Gem is whole again! A flower lock, with a musical key. We did it... together!', win_cake: 'Teamwork... and then cake!', rejoin: 'Welcome back!', kind_1: 'Kind hearts, brighter tomorrows!', kind_2: 'Dream brighter together!',
  grabble_moves: 'Grabble scurries ahead…', grabble_snatch: 'Swish! Grabble snatched a shard!', grabble_pocket: 'Grabble pocketed a shard. Especially shiny things!', grabble_bridge: 'Grabble stopped on the bridge. Quick, someone launch the Catcher!', grabble_win: 'Oh no! Grabble filled his bag and ran off with the starlight. Play again to stop him!',
  chase_start: 'You caught up with Grabble! Flowers, catch him!', chase_win: 'Got it! You took shards back from Grabble!', chase_win_empty: 'Got him! But his bag was empty.', chase_miss: 'Hop! Missed me! Grabble skipped away.',
  catcher_target_grabble: 'Grabble is on the bridge. Ring the bell!', catcher_caught_grabble: 'Grabble is stuck in the basket! His shiny loot spills everywhere!',
  mini_flight: 'Tap to flap through the flower rings!', mini_shard: 'Tap the flower that twinkles!', mini_fetch: 'Slide Charli to catch the falling shards!', mini_swish: "Hop when Grabble's net glows!", mini_cake: 'Tap the strawberries onto the cake!', mini_chase: 'Hold to grow the vine, let go when it reaches Grabble!',
  benny_hello: 'Good morning, Miss Suds! You look as bright as a sunbeam today!', benny_c1: 'Miss Suds, your bubbles are the sparkliest in the whole village!', benny_c2: 'A fresh bun for the loveliest pet washer in town!', benny_c3: 'After you, Miss Suds! Kindness first!', benny_c4: 'Miss Suds, you make every puppy smile. And me too!', benny_c5: 'Is it warm in here, or is it just your smile, Miss Suds?', benny_shy: 'Oh! Hi, Miss Suds… I mean, um, hello!', benny_cake: 'The biggest slice of cake for Miss Suds!', benny_sorry: 'Sorry, Miss Suds, nothing personal! You look lovely even in a flower basket!', benny_gift: "That one's for you, Miss Suds!", benny_cheer: "Go, Miss Suds! You've got this!", misssuds_thanks: 'Why, thank you, Benny!',
  mini_great: 'Wonderful!', mini_okay: 'Nice try!', mini_fly_bonus: 'What a flight! A bonus shard!', mini_shard_two: 'Two shards under the flowers!', mini_fetch_grabble: 'Charli took a shard back from Grabble!', mini_swish_safe: 'You hopped away! Grabble tripped over his net!', mini_cake_bonus: 'Perfect cake! An extra slice for you!',
};

// ---------- boot ----------
const startBtn = $('#startBtn'); startBtn.disabled = true; let worldBuilt = false;
startBtn.addEventListener('click', async () => {
  if (!worldBuilt) return; startBtn.disabled = true; $('#splashStatus').textContent = 'loading sounds…';
  await audio.init(audioManifest); await audio.unlock();
  $('#splash').remove(); ready = true; socket.emit('board:ready', {});
  if (state) { hud.update(state); pawns.sync(state.players); pawns.placeAll(state.players); if (state.phase !== 'lobby') { pawns.ensureGrabble(); pawns.place('grabble', state.grabble.space, state.players); pawns.setGrabbleLoot(state.grabble.loot); } }
  audio.playMusic(state?.phase === 'playing' ? 'music_play' : 'music_lobby');
  if (!state || state.phase === 'lobby') { await sleep(600); hud.subtitle(NARRATION.intro_lobby, 5000); audio.voice('intro_lobby'); }
  pump();
});
await buildWorld(); worldBuilt = true; startBtn.disabled = false; startBtn.textContent = 'Tap to begin';
$('#splashStatus').textContent = socket.connected ? 'connected' : 'connecting…';
frame();
if (params.get('auto') === '1') setTimeout(() => startBtn.click(), 300);
window.__board = { scene, camera, camTo, camToPawn, get state() { return state; }, get village() { return village; }, get catcher() { return catcher; }, get pawns() { return pawns; }, audio, hud, CAMERA, layout };
