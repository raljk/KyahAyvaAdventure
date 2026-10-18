# Protocol and module contracts

## Runtime topology
- `server/index.js` — Express + Socket.IO on `PORT` (default 3000). Serves `public/`. Prints and exposes the LAN join URL. One room is created at boot with a 4-letter code.
- `public/board/` — the laptop display. Connects as the **board** socket. Renders 3D + HUD, plays audio, animates events, and acks each animated event back to the server.
- `public/play/` — the phone controller. Connects as a **player** socket.
- `GET /api/info` → `{ room, joinUrl, lanIp, port }`
- `GET /api/qr.svg?url=...` → QR as SVG.
- `POST /api/dev/bots?n=3` → adds n bot players (dev + grader use). `POST /api/dev/start`, `POST /api/dev/reset`.

## v2 additions (see docs/game-design-v2.md)
- Events are built as `{ ...data, id, type }`; the space event carries `spaceType` (never `type`).
- `grabble` in State: `{ space, loot, lastMove }`. `winnerId` may be `'grabble'`.
- Mini-games: `turnStep: 'minigame'`, `minigame: { id, type, playerId, deadline, params }` in State. Phone → server: `player:miniTick { id, progress }` (≤5 Hz, no ack) and `player:miniResult { id, score }`. Server → clients events: `minigame:start { playerId, type, id }`, `minigame:progress { playerId, progress }` (no wait), `minigame:end { playerId, type, score, outcome }`.
- Grabble events: `grabble:move { from, to, path }`, `grabble:snatch { playerId }`, `grabble:loot { delta, total, reason }`, `grabble:win {}`, `grabble:reset {}`; the chase: `chase:start { playerId }`, `chase:end { playerId, won, taken }`.
- Launch targets may include `'grabble'` (`chooseTarget { targetId: 'grabble' }`).
- `narrate` events may carry `wait: false` (board acks at once and plays the clip in the background).
- Live mini-game window: the phone sends `player:miniFrame { id, frame }` (a JPEG of its game canvas as a Blob/ArrayBuffer, ≤ 12 fps, ~240 px wide) while its mini-game runs; the server relays it to board sockets only as `minigame:frame { playerId, id, frame }` (not an animation event; the board shows it in its mini-game window at once).
- Layout v2 exports: `LOOP_LENGTH`, `pointAt(d)`, `heightAt(x,z)`, `LANDMARKS`, `CATCHER_STAGES` (ids bell, net, bucket, tub, pipe, vine, drop, apple, pup, music, basket), `GRABBLE_START`, `GRABBLE_TARGET_DEFAULT`.
- Contraption contract v2: `createCatcher({ scene, anchor, stages: CATCHER_STAGES, layout, textures, images, deckHeight })`; `play()` ≈ 30 s touring the loop; `cameraPath.times` required; `reset()` may animate briefly but must resolve `play()` promptly.
- Village contract v2: `createVillage({ scene, layout, textures, images })` builds terrain from `heightAt`, the path from `pointAt`, buildings at `LANDMARKS`, the river polyline, and returns `{ group, update, tiles, setTileHighlight, bridgeAnchor, heightAt }`.

## Socket events

### Client → server (phones)
| event | payload | ack |
|---|---|---|
| `player:join` | `{ room, name, heroId }` | `{ ok, playerId, token, state }` or `{ ok:false, error }` |
| `player:rejoin` | `{ token }` | `{ ok, playerId, state }` |
| `player:start` | `{}` (host only) | `{ ok }` |
| `player:roll` | `{}` | `{ ok }` |
| `player:chooseTarget` | `{ targetId }` | `{ ok }` |
| `player:launchTiming` | `{ score }` 0..1 | `{ ok }` |
| `player:flight` | `{ fly: boolean }` | `{ ok }` |
| `player:playAgain` | `{}` (host) | `{ ok }` |

### Client → server (board)
| event | payload |
|---|---|
| `board:hello` | `{ room }` |
| `board:animDone` | `{ eventId }` — board finished animating that event |

### Server → clients
- `state` `{ ...State }` — full snapshot after any change. Phones render purely from this.
- `event` `{ id, type, ...data }` — animation events for the board (phones may show toasts). The server **waits** for `board:animDone` (or a timeout) before continuing the turn.

Event types and data:
```
lobby:joined     { playerId }
game:start       {}
dice             { playerId, value }
move             { playerId, from, to, path:[idx...], bumped:boolean }
space            { playerId, index, type }
shard            { playerId, delta, total, reason, fromPlayerId? }   // reason: shard|swish|fetch|cake|lap|catch
fetch            { playerId, targetId }
flight           { playerId, from, to }
sendToBridge     { playerId, targetId, from, to:10 }
launch           { byPlayerId, targets:[ids], caught, perfect, score }   // board plays the Catcher (16 s)
caught           { byPlayerId, victims:[{playerId, gave}] }
missed           { byPlayerId, targets:[ids] }
lap              { playerId }
almostWin        { playerId }
win              { playerId }
narrate          { key, text }     // the board plays the narrator clip for `key` and shows subtitle
```

### State shape
```js
{
  room: 'ABCD', phase: 'lobby'|'playing'|'ended', joinUrl, winTarget: 6,
  hostId, turnPlayerId, turnStep: 'roll'|'moving'|'choose_fetch'|'choose_launch'|'launch_timing'|'flight_offer'|'resolving'|null,
  turnDeadline: epochMs|null,
  players: [{ id, name, heroId, color, space, shards, connected, isBot, lapDone, order }],
  winnerId: null|id,
  lastEvent: { type, text, word }   // friendly text + sound word for phones
}
```

## Hero table (shared)
See `public/shared/heroes.js` — `{ id, name, color, blurb }` for the six heroes.

## Module contract: `public/board/layout.js` (shared, written by the integrator)
```js
export const SPACES = [ { index, type, name, pos:[x,y,z], angle } ... ];   // 28 entries
export const BRIDGE_INDEX = 10; export const CASTLE_INDEX = 0;
export const FLIGHT_PAIRS = { 5:22, 22:5, 18:27, 27:18 };
export const SCALE = { spaceRadius: 1.25, pawnHeight: 1.6 };
export const CAMERA = { overview:{pos:[0,24,30],target:[0,0,0]}, catcher:{pos:[...],target:[...]}, castle:{...} };
```

## Module contract: `public/board/village.js` (3D village agent)
```js
import * as THREE from 'three';
export async function createVillage({ scene, textures, images }) 
// builds ground, river, bridge, castle, bakery, pet wash, lampposts, flowers, trees, bunting, space tiles with icons & glows,
// ambient particles (petals, bubbles, sparkles)
// returns { group, update(dt, t), tiles: Map<index, THREE.Object3D>, setTileHighlight(index, on), bridgeAnchor: THREE.Vector3 }
```
Must not add lights that blow out the scene; main.js owns the lights (one hemisphere, one directional with shadows, ambient). May add small point lights for lampposts (≤ 6).

## Module contract: `public/board/contraption.js` (Catcher agent)
```js
import * as THREE from 'three';
import gsap from 'gsap';
export async function createCatcher({ scene, anchor /* Vector3 of the Bridge tile center */, textures, images })
// returns {
//   group,                                  // THREE.Group placed at anchor
//   update(dt, t),                          // idle motion: bell sway, bubbles, sparkles
//   reset(),                                // instant reset to armed state
//   play({ caught, perfect, onStage }),     // Promise<void>; onStage(id) fires at the START of each stage id (see design §6)
//   bridgeSlots: THREE.Vector3[],           // up to 6 world positions on the bridge deck for pawns
//   cameraPath: { pos: THREE.Vector3[], target: THREE.Vector3[] }  // keyframes main.js tweens through during play
// }
```
Stage ids in order: `bell, net, bucket, apple, vine, tub, pipe, pup, music, basket, caught|missed`. Target total 14–18 s. Zero dependencies beyond `three`, `three/addons/*`, `gsap`. No external model files; procedural geometry only. Textures/images may be undefined (fallback to colored materials).

## Asset manifests
- `public/assets/images/manifest.json` → `{ "<key>": "images/relative/path.png", ... }` (keys from design §9)
- `public/assets/audio/manifest.json` → `{ "voice": {key: path}, "sfx": {key: path}, "music": {key: {"src": path, "loop": true|false}} }`
Paths are relative to `/assets/`. Formats: PNG for images, MP3 (44.1 kHz) for audio.

## Import map (board + play pages)
```html
<script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/","gsap":"/vendor/gsap/index.js","socket.io-client":"/socket.io/socket.io.esm.min.js"}}</script>
```
`/vendor/three` → `node_modules/three`, `/vendor/gsap` → `node_modules/gsap`. Fonts at `/vendor/fonts/`.
