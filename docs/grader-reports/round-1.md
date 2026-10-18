# Grader report — round 1

Build under test: working tree on 2026-10-18, 11:20–12:03 AEDT. I ran my own server (`PORT=3200`, `WIN_TARGET` 6, 3 and 6) with the board at 1280×720 and 1920×1080 in the built-in browser and a 375×812 phone tab. I played 5 games: 4 bots; 1 human + 3 bots; and 1 human + 1 bot ×3. I watched dice, moves, shard pickups, a swish, a cake, a flight offer, 5 real Catcher launches (caught, perfect and missed), the lap bonus, two wins and Play Again. I also checked reconnect, rejoin on reload and a disconnect on the player's turn.

Some files changed on disk while I was reviewing. `public/board/contraption.js` went from the placeholder to the full machine at 11:43 and 11:52, and `server/game.js` and `public/board/main.js` changed at 11:59. Every defect below was checked again against the on-disk files at 12:02. The Catcher visuals are graded **provisionally**, as instructed. I saw both the placeholder and the new machine running.

Screenshots are in `docs/grader-reports/round-1/`. The `NN-…` numbers below refer to those files.

## Scores

| Area | Weight | Score |
|---|---|---|
| Visuals (board, 3D, HUD) | 25% | **6.5** |
| Audio | 20% | **5.5** |
| Mechanics & rules | 20% | **5.5** |
| Phone controller UX | 20% | **7.5** |
| Polish & delight | 15% | **5.5** |
| **Weighted overall** | | **6.15** |

**Result: FAIL.** The bar is every area ≥ 8 and overall ≥ 8.5. Four areas are below 7, which blocks sign-off.

One bug costs points in four areas. It is defect M1 / A1 below: the `space` event's `type` field overwrites the event type. Every time a pawn lands on a Launch space, the whole Catcher plays for nobody before anyone is chosen. It also silences the swish, cake and bridge effects and knocks the board 14 s out of sync with the phones. Fix it first.

---

## 1. Mechanics & rules (5.5)

**M1. Critical: the `space` event type is overwritten by the space type.**
- **Where:** `server/game.js:59` builds `const ev = { id, type, ...data }`. `server/game.js:200` sends `sendEvent('space', { playerId, index, type: space.type })`. `docs/protocol.md` specifies `space { playerId, index, type }`, so the collision is in the protocol itself.
- **What happens:** the board gets `ev.type === 'launch' | 'shard' | 'swish' | 'cake' | 'fetch' | …` and runs the wrong handler (`public/board/main.js` `handlers[ev.type]`). Confirmed with `node -e` (`{"type":"launch","playerId":"p1","index":7}`) and in play.
  - Landing on Launch runs `handlers.launch` with `caught: undefined`. The whole 16.5 s Catcher plays while the phone still says "Who goes to the bridge?" (31, 36). The server's 2.5 s `space` timeout expires, so the board falls 14 s behind the phones and plays the Catcher a second time for the real launch.
  - Landing on a shard runs `handlers.shard` with `delta: undefined`. A shard flies out of the player's card, as if they lost one, before the real +1.
  - Landing on swish, cake, bridge, flight or cobble: no handler runs. The `space` handler (tile word, `swish_net`, `music_sting_grabble`, `cake_party`, `bridge_land`) never runs at all.
  - Landing on fetch plays a stray WOOF.
- **How to fix:** in `sendEvent` use `{ ...data, id, type }`, rename the field to `spaceType` (in `game.js:200`, `main.js` `space({ spaceType })` and `protocol.md`), and add a test asserting `ev.type === 'space'`.

**M2. Pacing is far below the 15–30 min target, and launches are too rare.**
- **Evidence:** I ran a 300-game Monte-Carlo of the real engine (4 bots, target 6): 30.8 turns per game (p10 20, p90 43), 3.2 launches, 3.1 fetches, 3.5 swishes, 1.3 cakes and 2.2 laps. 80% of games have fewer than 5 launches.
- **Measured board durations:** a simple bot turn takes 7.5–9.3 s. A launch turn takes 46 s, about 33 s without M1. A fetch takes about 13 s and a flight offer 10–14 s. Start takes 9 s and the win about 15 s.
- **Estimated game length:** about 6.6 min with 4 bots, and **9–12 min with 4 kids** (I added 4–8 s per roll and 5–10 s per decision).
- **Cause:** the +2 lap bonus and the cake decide the game at around the first lap.
- **How to fix:** raise the default target to 10 in `public/board/layout.js` (`WIN_TARGET_DEFAULT`) and `server/index.js:35` (`process.env.WIN_TARGET || 6`, which ignores the layout constant). My simulation gives 70.7 turns and 7.3 launches per game, and 12% of games under 5 launches. Make the lap bonus +1 per lap, or keep +2 once and set the target to 8. Optionally turn 2 cobbles (8, 19) into `launch`.

**M3. A win is latched before the turn finishes.**
- **Where:** `server/game.js:322` sets `winnerId` when shards reach the target, but the turn keeps resolving and the win is only applied in `endTurn`.
- **Seen in play:** the lap bonus took Mia to 6/6 and she still had to pick a Pup Fetch target (24). She finished on 7.
- **Edge case:** a lap bonus followed by a bump onto the swish at 6 would let a player win holding 5.
- **Design says:** "the moment a player has 6 shards … they win".
- **How to fix:** after every `addShards`, check `p.shards >= winTarget` and jump straight to `endTurn()`. In `endTurn`, re-validate with `players.find(p => p.shards >= winTarget)`.

**M4. Cake ties are broken by join order.**
- `addShards` for `cake` loops over `this.players`, so the first player in the array to reach the target wins, not the player who landed on the cake.
- My simulation produced 7 such ties in 300 games.
- **How to fix:** prefer the current player, or announce a shared win ("We did it… together!"), which fits the book.

**M5. `almost_win` always says "Five shards!".**
- **Where:** voice clip and `public/board/main.js` NARRATION. `addShards` triggers it at `winTarget - 1`, so with the README's `WIN_TARGET=4` it is wrong.
- **How to fix:** skip the voice line when `winTarget !== 6`, or record "One more shard!".

**M6. No host migration.**
- `disconnect()` only flags the player as disconnected. If the host's phone sleeps in the lobby or on the win screen, nobody can press Start or Play Again (only `/api/dev/start` works).
- **How to fix:** in `server/game.js` `disconnect()`/`removePlayer`, after about 10 s hand `hostId` to the first connected human, and push state.

**M7. A tab the board can't see fast-forwards the game.**
- **Where:** `public/board/main.js` `pump()` acks every event instantly when `document.hidden`.
- **Seen:** when another tab covered mine, a whole launch resolved in 2.5 s (game 1, t=154.9 → 157.3) while the phones moved on.
- **How to fix:** emit `board:visibility` and have the server hold the turn queue while the board is hidden. The new board-ready gate in `sendEvent` is the right place for this.

**M8. Disconnect auto-act fires even if the player came back.**
- `armAutoAct(TIMEOUTS.disconnected)` (3 s) is not re-armed by `rejoin()`, so a player who returns within 3 s still gets auto-played.
- If every human drops (for example the Wi-Fi blips), the game auto-plays to the end at 3 s per decision.
- **How to fix:** in `rejoin()`, call `armAutoAct(delayFor(p, remainingDeadline))`. Pause the game when no human is connected.

**M9. Room code is not validated on join.**
- `join()` ignores `room`. After a server restart, phones with the old QR or URL (room 82CC) joined a game whose board said 3206 (see V10).
- **How to fix:** return `{ ok:false, error:'This game has a new code — scan the screen again!' }` when the room doesn't match.

**M10. Flight edge cases (the design is silent).**
- 22→5 jumps forward across the Castle without the lap bonus. 5→22 is a backwards jump that sets up an easy lap bonus.
- **How to fix:** decide this in the rules, and award the lap if the flight crosses index 0 going forward.

**M11. Tests are too narrow.**
- `npm test`: 7/7 pass. None of them cover the event payload shape (M1), win-at-the-moment (M3), cake ties (M4), host migration (M6) or rejoin timers (M8).
- **How to fix:** add these to `tests/engine.test.mjs`.

**Catch-rate math (§6 zones):**
- The star sweeps 0→1→0 in 1.6 s. The sweet zone (0.45) gives a 0.36 s window twice per cycle; the perfect zone (0.10) gives an 80 ms window. A random tap catches 45% of the time.
- An aimed tap with Gaussian timing error, uncompensated touch/display latency of about 90 ms, and σ of 80 / 120 / 150 ms (adult / 8 y / 6 y) catches **87% / 76% / 69%**. Perfect hits are about 15–20% for kids.
- That is inside the 65–80% band for kids and a little generous for adults. Bots catch 75%. The zones are fine; see P8 for the latency offset.

---

## 2. Audio (5.5)

**A1. Critical: landing sounds are silent and the Catcher audio plays twice (caused by M1).**
- These were never heard in play: `swish_net` + `music_sting_grabble`, `cake_party`, `bridge_land`, and the tile words TING!, SWISH!, CAKE!, UH-OH!, WHOOSH! and HOME!. I logged every clip by wrapping `audio.sfx/voice/playMusic`.
- Landing on Launch plays the whole bell→stuck sequence once, plus a phantom `grabble_stuck`.
- It also swaps the music to non-looping `music_catcher` (18.7 s). That leaves **about 20 s of silence** until the real launch's `caught` handler calls `playMusic('music_play')`.
- **How to fix:** fixing M1 fixes this.

**A2. The payoff narration is out of sync.**
- Real-launch log: STUCK and `grabble_stuck` at +14.2 s. The camera returns at +16.5 s. `launch_perfect` plays at +20.2 s and `launch_caught` at +22.8 s.
- So "Caught in the flower basket!" comes about 8.6 s after the basket closes, with the camera back on the overview.
- "I'm stuck!" is also said twice: `grabble_stuck` at the stage, then again inside `launch_caught`.
- **How to fix:** in `server/game.js` `launchTiming()`, send the caught/missed narration as part of the `caught`/`missed` event (or before `sendEvent('caught')`). In `main.js` `caught`, play it before `camTo(CAMERA.overview)`. Re-record `launch_caught` without "I'm stuck!".

**A3. The wrong character says the line.**
- `STAGE_FX.caught.voice = 'grabble_stuck'` and `missed.voice = 'grabble_missed'` (`public/board/main.js:137-142`) play Grabble's voice whoever is under the basket.
- **How to fix:** use the narrator for victims who aren't Grabble, and add `kyah_gotit` + `ayva_wedidit` for the launcher on a catch.

**A4. Pup's stage voice is silent.**
- `STAGE_FX.pup.voice = 'pup_woof'` is not a voice key, so `audio.voice()` silently returns false.
- **How to fix:** change it to `sfx3: 'pup_woof'` (at +0.2 s) in `STAGE_FX.pup`.

**A5. 14 generated clips are never played.**
- Voice: `rejoin`, `kind_2`, `kyah_catch`, `kyah_gotit`, `kyah_together`, `ayva_lift`, `ayva_wedidit`, `grabble_mine`, `grabble_shiny`, `grabble_pride`.
- SFX: `ui_tap`, `timer_tick`, `shard_fly`, `camera_whoosh`.
- **How to wire them:**
  - `camera_whoosh` in `camTo`/`sendToBridge`.
  - `shard_fly` in `hud.flyShard`.
  - `timer_tick` on the board while the turn step is `launch_timing`.
  - `grabble_mine` after `game_start`.
  - `grabble_shiny` on a swish.
  - `rejoin` from a new `player:rejoined` event.
  - `kind_2` alternating with `kind_1` on the castle.
  - `ayva_lift` at the `music` stage and `kyah_catch` at the `vine` stage.

**A6. "Ready… sing!" plays after the bell tap.**
- `server/game.js:280` (`launch_go`) runs after the tap, so there is 0.95 s of dead air before DING. In the book, "Ready… sing!" comes before the magic.
- **How to fix:** play `launch_go` right after `launch_ready` (before the tap), and send `launch` immediately on tap.

**A7. Repetitive turn line.**
- "Your turn! Roll the dice!" plays at the start of every turn, about 31 times per game and for bots too, with no variants.
- **How to fix:** add 3 or 4 variants, and skip the line for bots after the first round.

**A8. Loudness outliers.** Targets are voice −16, sfx −18, music −20 LUFS. Normalize these:

| Clip | Integrated loudness |
|---|---|
| `grabble_shiny` | −21.4 LUFS |
| `grabble_stuck` | −20.2 LUFS |
| `space_cobble_alt` | −19.1 LUFS |
| `win_cake` | −18.5 LUFS |
| `space_flight_stay` | −18.5 LUFS |
| `dice_land` | −23.6 LUFS |
| `timer_tick` | −23.3 LUFS |
| `apple_roll_stairs` | −20.9 LUFS |
| `bridge_land` | −20.6 LUFS |

- Everything else is within ±0.6 LU of target and music is at −20.1 to −20.4 LUFS.
- Peaks reach −1.6 dBTP. Use a −1.5 dBTP limiter in `tools/gen-audio.mjs`.

**A9. Lobby music has a loop seam.**
- `music_lobby` is −22 dB RMS for the first 300 ms and −32 dB for the last 300 ms. The 10 dB jump is audible at the loop point.
- **How to fix:** re-render with a crossfaded tail, or loop with a 1 s overlap in `AudioManager.playMusic`. (`music_play` loops cleanly: −30.8 / −31.7 dB.)

**A10. Ducking restores music too early.**
- `AudioManager.voice()` (`public/board/audio.js:33-34`) raises the music back to 0.55 when *any* clip ends, even while another voice is still playing.
- **How to fix:** keep a `duckCount` and restore only when it reaches 0.

What already works: all 92 manifest keys resolve and there are no 404s. The stage→sfx map matches design §6 exactly. Stages fire in order and on the timeline: bell 0, net +1.25, bucket +2.04, apple +2.45, vine +5.31, tub +7.45, pipe +8.45, pup +9.95 (dog_splash +10.4), music +11.1, basket +13.2, caught +14.16.

---

## 3. Visuals (6.5)

**V1. The win overlay hides the gem moment.**
- **Where:** `public/board/hud.js:38` shows `#winOverlay` as soon as `phase === 'ended'` arrives. That is *before* the `win` event animates. The 560 px card sits exactly over the gem close-up (`main.js` `win`: `camTo({pos:[0,9,14]})`).
- The HUD "WE DID IT!" word also draws behind the card, so it appears twice (11, 12).
- **How to fix:** in `hud.update` keep the overlay hidden until `main.js` `win` calls `hud.showWin()` after the gem animation (about 4 s). Put it in the lower third (`#winOverlay{place-items:end center;padding-bottom:6vh}`) and remove `hud.word('WE DID IT!')`.

**V2. The gem "assembly" is a plain shape getting bigger.**
- **Where:** `public/board/main.js` `buildWorld`/`win`. The gem is an untextured pale-blue `OctahedronGeometry` scaled 2.2 with elastic easing (13). The `gem_full` sprite is at opacity 0.
- There are no shards flying in, no flower lock or musical key, and no outline.
- **How to fix:** make 6 shard sprites (`gem_shard`) spiral in from the HUD cards to the fountain. Swap in a faceted, ink-outlined gem with a blue→pink gradient. Ring it with blue flowers (lock) and music-note sprites (key). Finish with a sparkle burst and set `gem_full` sprite opacity to 1.

**V3. The edge of the backdrop is visible.**
- **Where:** `public/board/main.js:65` puts a flat 165×110 `backdrop_panorama` plane at z = −95. From the Catcher camera its left edge shows as a hard vertical seam against the sky colour (09). It also adds a second, painted castle and giant flowers floating in the sky behind the 3D castle.
- **How to fix:** map the panorama onto a 160° `CylinderGeometry` strip (open-ended, BackSide) inside the village sky dome, with alpha-faded left and right edges. Or drop it and keep the procedural sky.

**V4. Pawns and name labels are too small to read from 3 m.**
- **Where:** `public/board/pawns.js`. Measured at 1280×720: pawns are 51–57 px tall, and labels are about 60 px wide with about 8 px text.
- **How to fix:**
  - Sprite height `h = 2.5` → 3.4.
  - Label `scale.set(2.6, 0.65)` → `(4.2, 1.05)`, with `labelTexture` font `600 84px`.
  - Add a pulsing hero-coloured ground ring (radius 0.9) under the active player's pawn.

**V5. Name labels draw through everything.**
- **Where:** `pawns.js:28` uses `depthTest:false`. In Catcher shots the victim's sprite and the huge "Mia" / "Ayva (bot)" label fill the frame and hide the vine stage (33, 32 frame "vine +5.8s").
- **How to fix:** set `depthTest:true` with `renderOrder` 10. In `main.js` `launch`, tween all label opacities to 0 and restore them in `caught`/`missed`. Use bridge slots on the far side of the camera path (`contraption.js` `bridgeSlots` z offset).

**V6. The subtitle covers the action.**
- **Where:** `public/board/style.css` `#subtitle`: bottom 32 px, 26 px font, up to 3 lines at 70vw. It covers the front row of track tiles (14–17) during play, the lobby card's player list (02), and wraps "shard!" onto its own line (10).
- **How to fix:** move it under the turn banner (`top:84px; bottom:auto`), use `max-width:min(900px,60vw)` with `text-wrap:balance`, and hide it while the lobby card shows (or put the line inside the card).

**V7. Lobby chips overlap the QR and spill off the card.**
- **Where:** `style.css:40` `#lobbyPlayers .chip { animation: pop … both }` reuses `@keyframes pop` (line 32), which ends at `translate(-50%,-50%)`. Every chip stays shifted up and left (06).
- **How to fix:** add `@keyframes chipPop { 0%{transform:scale(.2);opacity:0} 60%{transform:scale(1.15)} 100%{transform:none} }` and use it for `.chip`.

**V8. The HUD doesn't scale with screen size.** Every size is a fixed px value: cards 260 px, name 18 px, hero 13 px, hints 13 px, dice 110 px. At 1080p the HUD is proportionally small; at 4K/dpr 1 it would be tiny. How to fix:
- `#players{width:clamp(260px,19vw,420px)}`
- `.pcard .name{font-size:clamp(18px,2.4vh,34px)}`
- `.pcard .hero{font-size:clamp(13px,1.7vh,24px)}`
- `#dice{width:clamp(110px,14vh,200px)}`
- the same pattern for the banner, subtitle and lobby

**V9. Player cards cover the left edge of the board.**
- At 1280×720 the 4–6 cards cover the pet wash and the tiles near indices 21–24.
- **How to fix:** shift the overview target right (`layout.js` `CAMERA.overview.target` x +2.5, pos x +2.5), or collapse the cards to avatar + ring below 1400 px width.

**V10. Stale HUD state.**
- The CSS dice is never hidden: it shows the last roll in the lobby and on the win screen (05, 06).
- The QR is fetched only once (`hud.js:30 qrLoaded`), so after a server restart it still encodes the old room while the text shows the new one.
- **How to fix:** in `hud.dice`, hide `#dice` 2.5 s after it lands and on `game:reset`. Key the QR fetch on `state.joinUrl` instead of a boolean.

**V11. Turn banner grammar.**
- **Where:** `hud.js:37` builds `${name}, ${stepText}`, which gives "Mia, …" and "Mia, is on the move…".
- **How to fix:** write a full sentence per step:

| Step | Banner text |
|---|---|
| roll | "Mia, roll the dice!" |
| moving | "Mia is on the move…" |
| resolving | "Mia's turn" |

**V12. The CSS die shows numerals.**
- The phone die uses pips, so the two don't match. Draw pips on the six `.face` divs.

**V13. Splash page.**
- **Where:** `public/board/index.html:36-44`. Text-only splash with "A Mouse Trap–style adventure. Phones are the controllers, this screen is the board." (01). That is developer copy, and the logo image isn't used.
- **How to fix:** show `logo_title` and a line such as "Gather your friends — tap to wake the village!".

**V14. The bridge doesn't look like the book's bridge.**
- From the Catcher camera it reads as a flat stone platform with low walls (17). The book's bridge is a high arched cobblestone bridge.
- **How to fix:** raise the deck's middle 0.4 and show the arch under it (`village.js` `buildBridge`).

**V15. Catcher (provisional).**
- The new machine looks like a charming toy (30, 32, 34): woven basket, glowing bell lamppost, Pup on the seesaw, tub with bubbles. Caught (basket down over the pawn) and missed (basket wobbles overhead, 35) are easy to tell apart.
- The camera path frames the net, bucket and apple stages *behind* the big basket, so those three beats are hard to read (32: "net +1.7s", "bucket +2.5s", "apple +2.9s").
- The basket is woven brown, but the book's is a vine basket with blue and pink flowers.
- **How to fix:** add camera keys aimed at the bucket and stairs for 1.2–4.5 s in `contraption.js` `CAM`, and wrap the basket in 20–30 flower sprites.

**V16. Performance is fine but has a risk margin.**
- 72 fps (display cap) at 1280×720 and 1920×1080, both dpr 2. That means 2560×1440 and 3840×2160 back buffers with bloom.
- 240k triangles and 728 meshes; the Catcher adds about 480 meshes and 64k triangles.
- On a 2020 Intel MacBook the 4K back buffer is a risk. **How to fix:** `renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth*innerHeight > 2e6 ? 1.25 : 2))` and merge the Catcher's static parts.

**V17. Images are huge.**
- `public/assets/images` is 118 MB: 1–3 MB PNGs, with 40+ textures at 1024–1536 px uploaded to the GPU.
- **How to fix:** export WebP or KTX2 at 512 px for icons and words and 1024 px for heroes in `tools/gen-images.mjs`.

**V18. Console warnings.**
- `THREE.Clock` is deprecated and `PCFSoftShadowMap` has been removed (shadows fall back to hard PCF).
- **How to fix:** use `THREE.Timer`, and `shadowMap.type = THREE.VSMShadowMap` (or PCF with `shadow.radius = 3`).

---

## 4. Phone controller UX (7.5)

**P1. The board lags 14 s on every launch turn (caused by M1).**
- The phone asked "Who goes to the bridge?" while the board was still playing the phantom Catcher. The board showed the choice 14 s later, but the pick→bridge reaction was 1.4 s.
- **How to fix:** fixing M1 fixes this.

**P2. Taps that land during narration are slow to show on the board.**
- The `dice` event is queued behind the `turn_roll` narration, both on the server (`enqueue`) and on the board (`pump`).
- Measured: tapping ROLL 250 ms after the button appears gives **1.24 s** before the dice spins. When the board is idle it is 1 ms. Bell tap → first Catcher motion is 0.95 s (see A6).
- **How to fix:** in `server/game.js` `beginTurn`, send `narrate('turn_roll')` with `{ wait:false }`. In `main.js`, let a `dice` event cut the subtitle and voice off.

**P3. Pick and bell screens have no countdown.**
- Only the flight screen shows a timer. The pick screen has a 30 s default and the bell has 20 s, and the server then picks the richest friend or samples a timing for the kid without warning.
- **How to fix:** reuse the `#countdown` ring (small, top-right) on `s-pick` and `s-bell`, driven by `turnDeadline`.

**P4. Pick screen when it isn't needed.**
- A kid who already has 6/6 is still asked to pick (24, see M3). With one friend, the kid must still pick from a single card.
- **How to fix:** for one candidate, show a single big "Fetch from Ayva!" or "Send Ayva!" button.

**P5. Server restart sends the kid back to Join with the old room code.**
- After my restart the phone dropped to Join, showing the old room code and no explanation. Joining then succeeded only because the room isn't validated (M9).
- **How to fix:** in `public/play/main.js` `render()`, when "the server forgot us", show "The game restarted — pick your hero again!" and clear `S.room` if it differs from the new `state.room`.

**P6. The phone downloads 15.3 MB of art.**
- Six hero faces at about 2 MB each are shown at 52–130 px, plus a 3 MB logo. On party Wi-Fi with 6 phones the join screen shows initials for seconds.
- **How to fix:** 256 px WebP faces (about 25 KB) and a 600 px logo.

**P7. Controls look usable while disconnected.**
- While "Reconnecting…" shows, Start, Roll and Pick stay enabled (27) and only toast on tap.
- **How to fix:** add `body.has-banner .btn, body.has-banner .roll-btn { filter:grayscale(.6); pointer-events:none }`.

**P8. Bell timing isn't corrected for latency.**
- `onBellTap` scores at `e.timeStamp`, but kids react to a frame drawn 50–120 ms earlier. The effective zone shifts toward the direction of travel, and the 80 ms perfect window is rarely hit when it looks right.
- **How to fix:** subtract a 70 ms `LATENCY_MS` in `starPosAt(when - 70)`.

**P9. Platform gaps.**
- iOS Safari has no `navigator.vibrate`, so iPhones get no haptics. Add a 150 ms full-screen colour flash on "your turn".
- `askMotion()` triggers the iOS motion-permission prompt on the very first tap (the name field). Ask from a "Shake to roll? Allow" chip on the roll screen instead.

**P10. Accessibility nit.**
- The hero tiles have `role="radio"` but no accessible name in the accessibility tree. Add `aria-label=h.name` in `buildHeroGrid`.

Verified working:
- Join, lobby, Start (host), roll, pick (fetch and launch), bell (perfect 0.481 → PERFECT!, deliberate miss 0.115 → missed), flight (10 s countdown, defaults to Stay), win, and Play Again.
- Reconnect banner, and rejoin on reload in mid-game.
- Disconnect on my turn → auto-roll after 4.6 s, and the game continues.
- Tap targets: ROLL 330 px, friend cards ≥ 88 px, Fly 112 px, bell 300 px. The wording is short and kind.

---

## 5. Polish & delight (5.5)

**D1. The Catcher fires before anyone is chosen (M1).** In front of kids this reads as broken: the machine runs, then they watch the same 16 s machine again (31, 36).

**D2. Weak cage-drop payoff and reset.**
- The shard does not "pop out with sparkle and fly to the launcher". The `caught` handler resets the machine and flies the camera home first, then the shard flies between HUD cards (`main.js` `caught`, 10b).
- `catcher.reset()` snaps instantly. The design calls for a reverse animation: the bucket rights itself and Pup trots back.
- On a miss the victim doesn't "hop aside".
- **How to fix:**
  - In `main.js` `caught`: project the basket position, fire `hud.flyShard(basketScreen → launcherCard)` with `shard_fly`, hold 1.2 s, then `camTo`.
  - Add `catcher.rewind()` (a 2 s tween back to armed) in `contraption.js` and call it during the camera return.
  - In `missed`: call `pawns.jump(targetId, { height: 1.4 })` with a sideways nudge.

**D3. The win celebration is hidden and lacks the book's ending.**
- V1 and V2 apply. There's also no visual "Teamwork… and then cake!" (subtitle only).
- **How to fix:** for the last 4 s, cut to the cake stand (`CAKE` at x 7.6, z 14.3) with all pawns hopping around it.

**D4. Lobby could feel more like the start of an adventure.**
- The QR card works but is plain: no hero art, 13 px room-code hint, and the chip bug (V7). Bots and other phones joining get no pop-in on the 3D board.
- **How to fix:** add the six hero portraits around the card (greyed until taken), a 22 px room code, and play `lobby:joined` for bots too.

**D5. Developer leftovers on screen.**
- "Kyah (bot)" plus "Kyah · bot" on the cards.
- "Pup (bot) (Pup)" in the win overlay: `hud.js:39` appends the hero name even when the name already contains it.
- The splash copy (V13) and the console warnings (V18).
- **How to fix:** name bots after their hero without "(bot)" and show a small robot badge instead. Show only `w.name` in `#winName` when it already contains the hero name.

**D6. Anticipation is good, but there's no music build before the tap.**
- `music_catcher` starts only after the tap and the narration.
- **How to fix:** start a low ticking bed with `timer_tick` when `launch_timing` begins.

---

## What already feels AAA
- **The village diorama.** Toon shading with ink back-face outlines, pastel palette, Sunbeam Bakery with its striped awning and "Fresh Buns, Brighter Days" chalkboard, and the Puddle Paws pet wash with its paw emblem, bubbles and "Clean Pets, Happier Hearts". The white castle has blue cones, heart banners and a waterfall, and there are lampposts with heart flags and bunting everywhere (14, 15, 16). It reads as the book.
- **Tile icons from the overview.** Star, paw, net, bell, lamppost and cake are all recognisable at a glance, with colour-coded glows and index numbers.
- **The phone controller.** Gorgeous, book-styled, one action per screen, huge targets, a shard ring with a gem that fills up, bouncy sound words, kind copy, confetti win, reconnect banner and seamless rejoin (20–29).
- **The new Starlight Catcher (provisional).** It already looks like a charming toy. The stage SFX are perfectly ordered and on time, and caught vs missed is unmistakable (32, 34, 35).
- **Audio production.** All 92 assets resolve, loudness is mostly normalized, the voices are warm, and `music_play` loops seamlessly.
- **Engine robustness.** No exceptions in 5 games, bots finish games, disconnects auto-resolve, Play Again works, 7/7 tests pass, and a steady 72 fps.

---

## Screenshot index (`docs/grader-reports/round-1/`)

| Files | What they show |
|---|---|
| 01 | Splash |
| 02 | Lobby: subtitle overlaps the card |
| 03 | Lobby with players |
| 04–05 | Overview, stale dice |
| 06 | Lobby chips overlapping the QR, stale dice |
| 07–09 | Launch camera, placeholder close-up, BUMP word and backdrop seam |
| 10, 10b | Caught subtitle wrap; shard flying HUD to HUD |
| 11–13 | Win: doubled WE DID IT, overlay hiding the gem, plain gem |
| 14–17 | Bakery, pet wash, castle, bridge |
| 20–29 | Phone: join, lobby, wait, roll, pick (fetch at 6/6), flight, win, reconnect, pick (launch), bell |
| 30 | New Catcher, armed |
| 31, 36 | **Phantom Catcher bug** |
| 32–35 | Catcher stage contact sheets (caught and missed) and the vine stage blocked by the victim's label |
