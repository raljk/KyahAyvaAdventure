import * as THREE from 'three';
import gsap from 'gsap';
import { SPACES, CASTLE_INDEX, BRIDGE_INDEX, GRABBLE_START } from './layout.js';

function mixHex(a, b, t) { const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16); const ch = (s) => Math.round(((A >> s) & 255) + (((B >> s) & 255) - ((A >> s) & 255)) * t); return `rgb(${ch(16)},${ch(8)},${ch(0)})`; }
function labelTexture(text, color, { sub = '' } = {}) {
  const c = document.createElement('canvas'); c.width = 640; c.height = 160; const g = c.getContext('2d');
  g.font = '600 76px Fredoka, "Baloo 2", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(600, g.measureText(text).width + 70); const x = 320 - w / 2;
  // mid-tone fill (below the bloom threshold) with ink text, so labels stay crisp in close-ups
  g.fillStyle = mixHex(color, '#FFF6E0', 0.55); g.strokeStyle = '#2B2440'; g.lineWidth = 9; g.beginPath(); g.roundRect(x, 18, w, 124, 50); g.fill(); g.stroke();
  g.fillStyle = '#2B2440'; g.fillText(text, 320, 82);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Pawns {
  constructor({ scene, textures, getBridgeSlots, heightAt }) { this.scene = scene; this.textures = textures || {}; this.getBridgeSlots = getBridgeSlots; this.heightAt = heightAt || (() => 0); this.pawns = new Map(); this.animating = new Set(); this.t = 0; this.grabble = null; this.labelsVisible = true; }
  // ---------- building ----------
  build({ id, name, color, heroId, texKey, scale = 4.0, isGrabble = false }) {
    const g = new THREE.Group(); g.name = 'pawn:' + id; const col = new THREE.Color(color);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.24, 32), new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 })); base.position.y = 0.12; base.castShadow = true; base.receiveShadow = true; g.add(base);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.08, 10, 40), new THREE.MeshStandardMaterial({ color: 0x2B2440, roughness: 0.8 })); rim.rotation.x = Math.PI / 2; rim.position.y = 0.24; g.add(rim);
    const tex = this.textures[texKey]; let body;
    if (tex) { const aspect = tex.image ? tex.image.width / tex.image.height : 2 / 3; body = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.05 })); body.scale.set(scale * aspect, scale, 1); body.position.y = 0.2 + scale / 2; body.renderOrder = 2; }
    else { body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.1, 6, 16), new THREE.MeshToonMaterial({ color: col })); body.position.y = 0.24 + 1.05; body.castShadow = true; const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 16), new THREE.MeshToonMaterial({ color: isGrabble ? 0x7FB069 : 0xFFE7C2 })); head.position.y = 1.1; body.add(head); }
    g.add(body);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(name, color), transparent: true, depthTest: true, depthWrite: false, toneMapped: false })); label.scale.set(4.4, 1.1, 1); label.position.y = (tex ? 0.2 + scale : 2.9) + 0.55; label.renderOrder = 3; g.add(label);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.85, 24), new THREE.MeshBasicMaterial({ color: 0x2B2440, transparent: true, opacity: 0.18 })); shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; g.add(shadow);
    g.userData = { id, name, color, body, label, baseSy: body.scale.y, bob: Math.random() * Math.PI * 2, isGrabble, space: 0 };
    this.scene.add(g); return g;
  }
  create(player) { const g = this.build({ id: player.id, name: player.name, color: player.color, heroId: player.heroId, texKey: `hero_${player.heroId}` }); this.pawns.set(player.id, g); return g; }
  ensureGrabble() { if (this.grabble) return this.grabble; this.grabble = this.build({ id: 'grabble', name: 'Grabble', color: '#5E3A8C', texKey: 'npc_grabble_net', scale: 4.2, isGrabble: true }); this.grabble.userData.space = GRABBLE_START; this.grabble.position.copy(this.posFor(GRABBLE_START, 'grabble', [])); return this.grabble; }
  setGrabbleLoot(n) { if (!this.grabble) return; const l = this.grabble.userData.label; l.material.map = labelTexture(n ? `Grabble  ✦${n}` : 'Grabble', '#5E3A8C'); l.material.needsUpdate = true; }
  remove(id) { const g = this.pawns.get(id); if (g) { this.scene.remove(g); this.pawns.delete(id); } }
  sync(players) { const ids = new Set(players.map(p => p.id)); for (const id of [...this.pawns.keys()]) if (!ids.has(id)) this.remove(id); for (const p of players) if (!this.pawns.has(p.id)) { this.create(p); this.place(p.id, p.space, players); } }
  setActive(id) { if (!this.ring) { this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.12, 12, 48), new THREE.MeshBasicMaterial({ color: 0xFFF1A8, transparent: true, opacity: 0.9 })); this.ring.rotation.x = Math.PI / 2; this.scene.add(this.ring); } this.activeId = id; this.ring.visible = !!id; }
  // shrink everyone a little during a launch so the big sprites do not hide the machine's stages
  setLaunchScale(k) { for (const g of [...this.pawns.values(), this.grabble].filter(Boolean)) { const b = g.userData.body; if (!b.isSprite) continue; const target = (g.userData.fullScale || (g.userData.fullScale = b.scale.clone())).clone().multiplyScalar(k); gsap.to(b.scale, { x: target.x, y: target.y, duration: 0.6 }); g.userData.baseSy = target.y; } }
  setLabelsVisible(v) { this.labelsVisible = v; for (const g of [...this.pawns.values(), this.grabble].filter(Boolean)) gsap.to(g.userData.label.material, { opacity: v ? 1 : 0, duration: 0.4 }); }
  // ---------- placement ----------
  posFor(index, id, players) {
    const here = players.filter(p => p.space === index); const isG = id === 'grabble'; const n = here.length + (isG ? 1 : 0); const k = isG ? here.length : Math.max(0, here.findIndex(p => p.id === id));
    if (index === BRIDGE_INDEX && this.getBridgeSlots) { const slots = this.getBridgeSlots(); if (slots && slots.length) return slots[k % slots.length].clone(); }
    const [x, y, z] = SPACES[index].pos; const base = new THREE.Vector3(x, y, z);
    if (n <= 1) return base; const r = 0.6; const a = (k / n) * Math.PI * 2 + 0.6; const off = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r); base.add(off); base.y = this.heightAt(base.x, base.z); return base;
  }
  place(id, index, players) { const g = id === 'grabble' ? this.grabble : this.pawns.get(id); if (!g) return; g.userData.space = index; g.position.copy(this.posFor(index, id, players)); }
  placeAll(players) { for (const p of players) if (!this.animating.has(p.id)) this.place(p.id, p.space, players); }
  worldPos(id) { const g = id === 'grabble' ? this.grabble : this.pawns.get(id); return g ? g.position.clone().add(new THREE.Vector3(0, 1.6, 0)) : new THREE.Vector3(); }
  // ---------- motion ----------
  async hop(id, path, players, onStep, { stepDur } = {}) {
    const g = id === 'grabble' ? this.grabble : this.pawns.get(id); if (!g) return; this.animating.add(id);
    for (let i = 0; i < path.length; i++) {
      const idx = path[i]; const last = i === path.length - 1; const target = last ? this.posFor(idx, id, players) : new THREE.Vector3(...SPACES[idx].pos);
      const from = g.position.clone(); const dur = stepDur || Math.max(0.2, 0.4 - path.length * 0.012); const self = this;
      await new Promise(res => gsap.to({ t: 0 }, { t: 1, duration: dur, ease: 'power1.inOut', onUpdate() { const t = this.targets()[0].t; g.position.lerpVectors(from, target, t); g.position.y += Math.sin(t * Math.PI) * 1.1; g.userData.body.scale.y = g.userData.baseSy * (1 + Math.sin(t * Math.PI) * 0.12); }, onComplete: res }));
      g.position.copy(target); g.userData.body.scale.y = g.userData.baseSy; g.userData.space = idx;
      onStep && onStep(idx, last);
    }
    this.animating.delete(id);
  }
  async arc(id, toIndex, players, { height = 5, duration = 1.3, to } = {}) {
    const g = id === 'grabble' ? this.grabble : this.pawns.get(id); if (!g) return; this.animating.add(id);
    const from = g.position.clone(); const target = to ? to.clone() : this.posFor(toIndex, id, players);
    await new Promise(res => gsap.to({ t: 0 }, { t: 1, duration, ease: 'power2.inOut', onUpdate() { const t = this.targets()[0].t; g.position.lerpVectors(from, target, t); g.position.y += Math.sin(t * Math.PI) * height; g.rotation.y = t * Math.PI * 2; }, onComplete: res }));
    g.position.copy(target); g.rotation.y = 0; g.userData.space = toIndex; this.animating.delete(id);
  }
  async jump(id, { height = 1.6, duration = 0.5 } = {}) { const g = id === 'grabble' ? this.grabble : this.pawns.get(id); if (!g) return; const y0 = g.position.y; await new Promise(res => gsap.to({ t: 0 }, { t: 1, duration, onUpdate() { const t = this.targets()[0].t; g.position.y = y0 + Math.sin(t * Math.PI) * height; }, onComplete: res })); g.position.y = y0; }
  async shake(id, { duration = 0.6 } = {}) { const g = id === 'grabble' ? this.grabble : this.pawns.get(id); if (!g) return; const x0 = g.position.x; await new Promise(res => gsap.to({ t: 0 }, { t: 1, duration, onUpdate() { const t = this.targets()[0].t; g.position.x = x0 + Math.sin(t * Math.PI * 8) * 0.18 * (1 - t); }, onComplete: res })); g.position.x = x0; }
  update(dt) { this.t += dt;
    if (this.ring && this.activeId) { const g = this.pawns.get(this.activeId); if (g) { this.ring.position.set(g.position.x, g.position.y + 0.06, g.position.z); const s = 1 + Math.sin(this.t * 4) * 0.08; this.ring.scale.set(s, s, 1); this.ring.material.opacity = 0.65 + Math.sin(this.t * 4) * 0.25; } else this.ring.visible = false; }
    for (const g of [...this.pawns.values(), this.grabble].filter(Boolean)) { if (this.animating.has(g.userData.id)) continue; const b = g.userData.body; const s = 1 + Math.sin(this.t * 2.2 + g.userData.bob) * 0.02; b.scale.y = g.userData.baseSy * s; if (g.userData.isGrabble) g.rotation.y = Math.sin(this.t * 1.7) * 0.12; } }
}
