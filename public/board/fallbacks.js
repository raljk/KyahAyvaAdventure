// Minimal stand-ins used when village.js or contraption.js are missing or throw.
import * as THREE from 'three';
import gsap from 'gsap';
import { SPACES, BRIDGE_INDEX, SCALE, heightAt } from './layout.js';

export async function fallbackVillage({ scene }) {
  const group = new THREE.Group(); scene.add(group);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0xA8E0B8, roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; group.add(ground);
  const tiles = new Map();
  for (const s of SPACES) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(SCALE.spaceRadius, SCALE.spaceRadius, 0.15, 32), new THREE.MeshStandardMaterial({ color: new THREE.Color(s.color), roughness: 0.8 }));
    m.position.set(s.pos[0], s.pos[1] + 0.075, s.pos[2]); m.receiveShadow = true; group.add(m); tiles.set(s.index, m);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(SCALE.spaceRadius + 0.12, 0.08, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.16; m.add(ring); m.userData.ring = ring;
  }
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 1, 24), new THREE.MeshStandardMaterial({ color: 0xC9B9A3 })); pedestal.position.y = 0.5; group.add(pedestal);
  const b = SPACES[BRIDGE_INDEX].pos; const deck = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.3, 6), new THREE.MeshStandardMaterial({ color: 0xA89F91 })); deck.position.set(b[0], 0.15, b[2]); deck.rotation.y = -SPACES[BRIDGE_INDEX].angle; group.add(deck);
  return { group, update() {}, tiles, heightAt, deckHeight: 0.1, setTileHighlight(i, on) { const t = tiles.get(i); if (t) gsap.to(t.userData.ring.material, { opacity: on ? 0.9 : 0, duration: 0.3 }); }, bridgeAnchor: new THREE.Vector3(b[0], b[1], b[2]) };
}

export async function fallbackCatcher({ scene, anchor }) {
  const group = new THREE.Group(); group.position.copy(anchor); scene.add(group);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 6, 12), new THREE.MeshStandardMaterial({ color: 0x2B2440 })); post.position.set(2.5, 3, 0); group.add(post);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.2, 0.2), new THREE.MeshStandardMaterial({ color: 0x2B2440 })); arm.position.set(1.2, 5.9, 0); group.add(arm);
  const cage = new THREE.Group(); const cageMat = new THREE.MeshStandardMaterial({ color: 0x5B8DEF, emissive: 0x223366 });
  for (let i = 0; i < 8; i++) { const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), cageMat); const a = (i / 8) * Math.PI * 2; bar.position.set(Math.cos(a) * 1.1, 1.2, Math.sin(a) * 1.1); cage.add(bar); }
  const top = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.08, 8, 32), cageMat); top.rotation.x = Math.PI / 2; top.position.y = 2.4; cage.add(top);
  cage.position.set(0, 4.5, 0); group.add(cage);
  const bell = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.45, 16), new THREE.MeshStandardMaterial({ color: 0xF2C14E, emissive: 0x443300 })); bell.position.set(2.5, 5.5, 0.4); group.add(bell);
  const slots = []; for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; slots.push(new THREE.Vector3(anchor.x + (i ? Math.cos(a) * 0.7 : 0), 0, anchor.z + (i ? Math.sin(a) * 0.7 : 0))); }
  const stages = ['bell', 'net', 'bucket', 'tub', 'pipe', 'vine', 'drop', 'apple', 'pup', 'music', 'basket'];
  return {
    group, bridgeSlots: slots, duration: 12, basketWorldPos: new THREE.Vector3(anchor.x, anchor.y + 1, anchor.z), update(dt, t) { bell.rotation.z = Math.sin(t * 3) * 0.15; },
    reset() { gsap.killTweensOf(cage.position); gsap.killTweensOf(cage.rotation); cage.position.set(0, 4.5, 0); cage.rotation.set(0, 0, 0); },
    cameraPath: { pos: [new THREE.Vector3(anchor.x + 6, 8, anchor.z + 10), new THREE.Vector3(anchor.x + 4, 6, anchor.z + 8)], target: [new THREE.Vector3(anchor.x, 3, anchor.z), new THREE.Vector3(anchor.x, 1.5, anchor.z)] },
    async play({ caught, onStage }) {
      for (let i = 0; i < stages.length; i++) { onStage && onStage(stages[i]); await new Promise(r => setTimeout(r, i < 9 ? 900 : 100)); if (i === 0) gsap.to(bell.rotation, { z: 0.6, yoyo: true, repeat: 5, duration: 0.15 }); }
      if (caught) { onStage && onStage('caught'); await new Promise(res => gsap.to(cage.position, { y: 0.1, duration: 0.55, ease: 'bounce.out', onComplete: res })); }
      else { onStage && onStage('missed'); await new Promise(res => gsap.to(cage.position, { y: 0.1, x: 2.2, duration: 0.55, ease: 'bounce.out', onComplete: res })); }
      await new Promise(r => setTimeout(r, 900));
    },
  };
}
