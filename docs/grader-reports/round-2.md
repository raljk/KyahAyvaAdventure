# Grader report — round 2 (v2: village route, Grabble NPC, phone mini-games, touring Catcher)

**Build under test:** the working tree on 2026-10-18, 15:36–16:42 AEDT.

Only `server/index.js` changed while I was grading. It had a leftover duplicate `/api/dev/launch` block, a syntax error, at 15:36:50. The integrator fixed it about a minute later. Every other file is unchanged since 15:33, so every finding below applies to the current code.

**How I tested.** I ran my own server on `PORT=3200` in four configurations: `WIN_TARGET=6`, then the defaults (10/10), then `GRABBLE_TARGET=3`, then the defaults again. The board ran at 1280×720 and 1920×1080, and the phone ran in a 375×812 tab.

I played five games:
- **Game A** (board in front): a scripted human "Mia" (a Node socket.io client) plus three bots, played through to the win.
- **Game B**: a real phone (Leo) plus scripted Mia, with `WIN_TARGET=6`.
- **Game C**: the same setup with defaults (10/10), played through to Leo's win.
- **Game D**: four bots with `GRABBLE_TARGET=3`, played through to Grabble's sad ending.
- **Game E**: four bots, used to check a forced miss and a fairy flight.

**Measurements.** I captured canvas frames (2560×1440 back buffer) during three full Catcher launches (caught at a friend, caught at Grabble, and a miss). I logged every `audio.sfx`, `voice`, `playMusic` and `hud.word`/`subtitle` call on the board with epoch timestamps. I measured fps and triangles on the board and transfer bytes on the phone. I ran `npm test`, `tests/sim.mjs`, and a kid-performance simulation of my own (described under Mechanics).

**Phone input.** All Roll, Start, Pick and Play Again taps were real clicks. Fast in-game input was injected as `PointerEvent`s on the mini-game canvas from a helper with a human reaction time of 600 ± 150 ms, because the tool's click latency (1–2 s) cannot play 1-second windows. The bell was also tried with a real click.

Screenshots are in `docs/grader-reports/round-2/`; the numbers below refer to those files.

## Scores

| Area | Weight | Round 1 | **Round 2** |
|---|---|---|---|
| Visuals (board, 3D, HUD) | 25% | 6.5 | **6.5** |
| Audio | 20% | 5.5 | **5.5** |
| Mechanics & rules | 20% | 5.5 | **7.0** |
| Phone controller UX | 20% | 7.5 | **8.0** |
| Polish & delight | 15% | 5.5 | **6.0** |
| **Weighted overall** | | 6.15 | **6.63** |

**Result: FAIL.** The bar is every area ≥ 8 and overall ≥ 8.5. Only Phone UX reaches 8. Audio and Polish are still below 7, which blocks sign-off.

**The biggest problem is what happens after the first Catcher launch.** The launch itself is now a real wow moment. When it ends, though, the board is left in a broken state (V1–V3 and A1 below):

- **The machine is never reset.** The basket stays down over the bridge for the rest of the game and into the next game.
- **The camera stays at the bridge.** The next turns play off-camera.
- **Every pawn name label stays hidden** until the win screen.
- **The music stops for good.** `music_catcher` is a non-looping 18.7 s clip, and nothing restarts `music_play`.

Fairy flights have the same camera problem. Fixing these five things (the four above plus the flight camera) in `public/board/main.js` would move Visuals, Audio and Polish by about a point each.

---

## Round-1 defects: status

| # | Round-1 defect | Status | Evidence (round 2) |
|---|---|---|---|
| M1 / A1 / P1 / D1 | `space` event type collision (phantom Catcher) | **FIXED** | `game.js:61` builds `{ ...data, id, type }`. The space event carries `spaceType`, and there is a regression test. Landing words TING!, DING!, WOOF!, SWISH!, CAKE! and UH-OH! fire; the log shows one launch per launch turn. |
| M2 | Pacing and launch frequency | **PARTLY** | The default target is 10 (`index.js` and `layout.js`). Bot sim: 4 players, 36.6 turns, 6.7 launches, about 20 min. With kid-level mini-game play it is 27.5 turns, 5.0 launches (63% of games under 6) and about 15 min. See M1 below. |
| M3 | Win latched mid-turn | **FIXED** | `endTurn()` → `decideWinner()` uses live counts. Test 11 covers it. |
| M4 | Cake ties by join order | **FIXED** | `decideWinner` prefers the current player, then most shards, then turn order. |
| M5 | "Five shards!" voice line | **FIXED** | Uses `almost_win_generic`. |
| M6 | No host migration | **PARTLY** | It now migrates immediately in `disconnect()`, with no grace period. A host who reloads their phone loses host (P14). A bot added first becomes host (`game.js:119`). |
| M7 | Hidden board fast-forwards | **By design** (per brief) | Still acks instantly when `document.hidden`. |
| M8 | Disconnect auto-act not re-armed on rejoin | **NOT FIXED (worse)** | I reloaded the phone during the shard game. The phone rejoined and replayed the title card (countdown 2). The server's 3 s disconnect auto-act still fired at 409.1 and resolved the game with a bot score of 3. The kid's replayed game was then rejected. |
| M9 | Room code not validated | **NOT FIXED** | `player:join` with `room:'ZZZZ'` returned `ok:true` (`game.js:100` ignores `room`). |
| M10 | Flight crossing the castle (lap) | **NOT FIXED** | The pairs 5↔22 and 18↔27 jump 17 and 9 spaces forward. 22→5 crosses index 0 with no lap and no chase/snatch check. |
| M11 | Tests too narrow | **PARTLY** | 11/11 pass, now covering payload shape, host hand-off, Grabble, chase, fetch and win timing. Nothing tests rejoin timers, room validation or post-win narration. |
| A2 | Payoff narration out of sync / double "I'm stuck" | **PARTLY** | Narration now starts 2.8 s after STUCK (good). It still says "I'm… stuck!" (`grabble_stuck`) and then "…I'm stuck! Hand over a shard!" (`launch_caught`), shown in 16. |
| A3 | Wrong character says the line | **NOT FIXED** | `STAGE_FX.missed.voice='grabble_missed'` and `caught` → `grabble_stuck` play Grabble's voice for a friend. `kyah_catch` plays whoever chases. |
| A4 | `pup_woof` as voice | **FIXED** | It is now `sfx3`. |
| A5 | 14 unused clips | **PARTLY** | The clips required by §6.3 are wired. Still never played: voice `rejoin`, `launch_go`, `kyah_together`, `ayva_lift`, `kyah_vine`, `grabble_moves`, `space_flight_offer`, `almost_win`; sfx `swish_net` and 11 generated mini-game sfx (`flap_wing` … `countdown_beep`), which the board preloads for nothing. |
| A6 | "Ready… sing!" after the tap | **PARTLY** | No dead air (DING 10 ms after the result), but `launch_go` is now never played at all. |
| A7 | Repetitive "Your turn! Roll the dice!" | **NOT FIXED** | Plays every turn, bots included, with no variants. |
| A8 | Loudness outliers | **NOT FIXED** | All nine round-1 outliers are unchanged. Overall, 25 of 144 clips are more than 1.5 LU off target (list under Audio). |
| A9 | Lobby music loop seam | **NOT FIXED** | `music_lobby`: head −22.0 dB, tail −32.9 dB. File unchanged since 11:19. |
| A10 | Ducking restores early | **NOT FIXED** | `audio.js:33-34`, no duck count. |
| V1 | Win overlay hides the gem | **PARTLY** | The card now comes after the celebration, in the lower third (21–23). "WE DID IT!" still appears twice (word, then card), and the card sits on top of a live subtitle. |
| V2 | Gem "assembly" is a scaled octahedron | **PARTLY** | The camera goes to the castle and shards fly from the card to the gem (20, 24). The gem is still an untextured octahedron with an elastic scale-up, with no flower lock and no musical key. |
| V3 | Backdrop panorama edge | **NOT FIXED** | It is still a flat plane (`main.js:56`). Its hard bottom edge floats above the board's horizon with a light-blue band beneath it (50). |
| V4 | Pawns and labels too small | **NOT FIXED (on screen)** | World size went up 28%, but the board and camera grew too. At 1280×720 the pawns measure 50–51 px and the labels about 60 px wide, the same as round 1. There is no ring under the active pawn. |
| V5 | Labels draw through everything | **FIXED, with a regression** | Labels are now depth-tested and hidden during the launch, but never shown again until the win (11, 32). |
| V6 | Subtitle covers the action | **NOT FIXED** | Still bottom-centre. It covers the front row of tiles (04), overlaps the lobby card (02) and the win/sad cards (22, 26), and wraps single words ("around!"). |
| V7 | Lobby chips overlap the QR | **FIXED** | 03. |
| V8 | HUD in px | **FIXED** | Uses `--u` units. At 1920×1080 the layout is identical (05); cards are 404 px wide with a 27 px name. |
| V9 | Cards cover the board's left edge | **PARTLY** | The route now clears the cards. The left houses and garden edge are still under them. |
| V10 | Stale dice / QR | **FIXED** | Dice hide after 6 s; the QR is keyed on `joinUrl` (new room FA41 refreshed). |
| V11 | Banner grammar | **PARTLY** | "Mia, roll the dice!" and "… is on the move…" are fixed. `resolving` still renders as "Mia …" for long stretches (most screenshots). |
| V12 | CSS die shows numerals | **NOT FIXED** | `index.html` faces are still the text 1–6. |
| V13 | Splash is developer copy | **NOT FIXED** | Still text-only, and still reads "Phones are the controllers, this screen is the board…" (01). |
| V14 | Bridge not arched | **FIXED** | Arch ring stones, parapets and vines (51). |
| V15 | Catcher framing / basket style | **PARTLY** | The tour camera works. One shot faces the empty board edge (see V5 below). The basket is still a brown beehive with a few flowers, while the book's is a flower-vine dome (page 7). |
| V16 | 4K back buffer | **NOT FIXED** | Still `setPixelRatio(min(dpr,2))`: 3840×2160 at 1080p. 72 fps here (display cap); risky on a 2020 Intel MacBook. |
| V17 | Huge images | **FIXED vs target** | The board loads 33.8 MB of files (≤ 40 MB target), about 108 MB GPU. `gem_shard` is still 1024² (2 MB) for a 44 px sprite. |
| V18 | Console warnings | **PARTLY** | The PCFSoft warning is gone. `THREE.Clock` is still deprecated (`main.js:86`). |
| P2 | Taps queued behind narration | **FIXED** | Roll → board `dice_roll` sfx took 2 ms (game A); `turn_roll` is `wait:false`. |
| P3 | No countdown on pick/bell | **FIXED** | Ring on pick (P07), bell and mini-games. |
| P4 | Pick screen when not needed | **NOT FIXED** | Still a grid for a single candidate. A kid at 10/10 is still asked to pick. |
| P5 | Restart → silent Join | **FIXED** | "The game restarted. Pick your hero again!" and the new room code. |
| P6 | 15 MB phone art | **FIXED** | 1.16 MB transferred on join (26 requests): 82–123 KB faces, 402 KB logo. |
| P7 | Controls live while disconnected | **FIXED** | Greyed out under the banner (P06). |
| P8 | Bell latency | **FIXED** | `LAT = 0.06` in `GAMES.bell`. |
| P9 | iOS haptics / motion prompt | **PARTLY** | A colour `flash()` was added. `askMotion()` still fires on the first pointerdown anywhere, i.e. on the name field (`main.js:833,905`). |
| P10 | Hero tiles unlabeled | **FIXED** | `aria-label` set. |
| D2 | Weak payoff, snap reset, no hop | **PARTLY** | The shard now flies out of the basket (15) and missed pawns hop. There is still no rewind; worse, there is now no reset at all. |
| D3 | Win celebration | **PARTLY** | See V1/V2. "Teamwork… and then cake!" is on the card, but there is no cake moment. |
| D4 | Lobby not adventure-like | **NOT FIXED** | No hero portraits, a small room code, and no pop-in for bots. |
| D5 | Developer leftovers | **PARTLY** | "(Pup)" duplication is gone. "Kyah (bot)" plus "Kyah · bot" remains, and the win card says "Poodle (bot) made the Starlight Gem whole!" (23). |
| D6 | No build before the tap | **PARTLY** | `timer_tick` plays in the last 3 s of the countdown only. There is no music build. |

**§6 of `game-design-v2.md` ("must land"):**
- **Done:** 1, 2, 5 (labels hidden, depth-tested), 6 (viewport units, chips, QR/dice) and 7 (inputs, countdowns, budgets).
- **Not done:**
  - **3:** a double "I'm stuck" remains.
  - **4:** there is no flower lock, no key, and the gem is plain.
  - **5:** the 30% size gain did not reach the screen.
  - **6:** the subtitle still covers the front row, and the backdrop seam remains.

---

## 1. Visuals (6.5)

**V1. Critical: the Catcher is never reset, and the basket stays down for the rest of the game.**
- **Where:** `public/board/main.js:145-156` (`launch`/`caught`/`missed`) never calls `catcher.reset()`. It only runs in the hidden-tab branch of `pump()` (line 109). `game:reset`/`game:start` (129-130) don't call it either.
- **What I saw:** after each caught launch the basket sits closed on an empty bridge while turns continue (18, 19 frames 15-30). The apple stays on the seesaw and Charli in the washtub (56). The state carries into the next game's lobby (51) and game start (50). After a miss it stays hovering at head height.
- **Fix:** in `caught`/`missed`, after the shard flight and narration, call `catcher.reset()`; its 1.35 s reverse flourish already exists (`contraption.js:1441`). Also call it in `game:start` and `game:reset`.

**V2. Critical: the camera is left at the bridge after every launch.**
- **Where:** `caught`/`missed` never `camTo(CAMERA.overview)` and never set `idleDrift = true`.
- **What I saw:** the next player's dice, move and Grabble's scurry happen off-camera. In game A this lasted 8 s after the friend launch and 24 s after the Grabble launch (17 frames 21-28, 19 frames 15-30, 18). The camera only comes back when someone starts a mini-game.
- **Fix:** end both handlers with `idleDrift = true; await camTo(CAMERA.overview, 1.6)` (or a sideways pull-back).

**V3. Critical: every pawn label is hidden after the first launch.**
- **Where:** `pawns.setLabelsVisible(false)` (line 146) is only undone in `win` and `grabble:win`.
- **Fix:** restore it at the end of `caught`/`missed`.

**V4. The camera is left on an empty lamppost after a fairy flight.**
- **Where:** `minigame:end` skips the overview return for `flight` (line 179), and the `flight` handler (143) never moves the camera. The flier arcs out of frame.
- **What I saw:** the next turn's move happens off-screen (31, 31b). The same happens on "stay".
- **Fix:** follow the arc with the camera, then `camTo(overview)` in `flight`. Add an overview return on a failed flight.

**V5. One Catcher shot frames the empty board edge.**
- **Where:** `contraption.js` `CAM_KEYS` around `[tG1+0.35 …]`/`[tLaunch+0.6 …]`.
- **What I saw:** at about launch +18–23 s (apple jump → Charli cannonball) the camera points outward at empty grass, the board edge and the sky. The seesaw is tiny. Reproduced in all three launches (10 frame 9, 17 frame 16, 19 frame 11).
- **Fix:** use a negative lateral offset (inside the loop) for those two keys, or aim at the seesaw from the fountain side.

**V6. A miss is not unmistakable.**
- **What I saw:** after "missed" the basket ends at head height over the victim, covering half the sprite (29b, 30 rows 3-4). From across the room it reads as half-caught.
- **Fix:** in `contraption.js` missed pose, finish with the basket swung well clear (offset ≥ 1.5 units sideways and above the head), plus a puff where the pawn was.

**V7. Pawns are still small from the overview.**
- **What I measured:** 50–51 px tall at 1280×720 at the castle and 57 px for Grabble. Labels are about 60 px wide with roughly 10 px text. Pawns stacked on the castle overlap and their labels overlap (50).
- **Fix:** in `pawns.js` build: scale 3.2 → 4.2 and label 3.6×0.9 → 5×1.25. Fan the slot offsets wider (r 0.6 → 1.0). Add the pulsing ground ring under the active player. Optionally lower `CAMERA.overview.pos` y from 31 to 27.

**V8. Subtitles collide with everything.**
- **Where:** `style.css:40`, `#subtitle` bottom-centre.
- **What I saw:** it covers the front row (indices 12–17) during play (04), the lobby card (02), and sits under the win and sad cards with its text showing through (22, 26). It wraps single words.
- **Fix:** move it under the turn banner (top) with `text-wrap:balance`. Hide it while `#lobby` or `#winOverlay` is visible.

**V9. The backdrop is a floating billboard.**
- **Where:** `main.js:56`, a 130-unit plane at z −120.
- **What I saw:** its bottom edge cuts straight across the sky above the board, with sky-blue void below. Behind the castle it reads as a flat painted wall (50, 52).
- **Fix:** curve it onto an open cylinder strip with alpha-faded bottom and side edges, and lower it so it meets the board's horizon. Or drop it and paint a sky-dome gradient.

**V10. The win gem is still placeholder geometry.**
- **Where:** `main.js:62`, `OctahedronGeometry`.
- **What I saw:** no outline, no facets, no flower lock or musical key (24). The book's page 9 shows a pedestal with a flower lock and a key.
- **Fix:** use a faceted, ink-outlined gem (or the `gem_full` sprite as a billboard), ring it with blue flower sprites and note sprites that bloom at the vine/music cues, then a sparkle burst.

**V11. HUD leftovers.**
- **Grabble's HUD card shows a plain "G" placeholder** (`index.html` `#grabbleCard .avatar`; `hud.js` never sets a face). Use `images.hero_grabble_face`.
- **The Grabble card says "Almost full! Stop him!" after he has won** (26). Show "He got away!" when `winnerId === 'grabble'`.
- **The dice uses numerals.** Draw pips, as on the phone.
- **The splash is text-only developer copy** (01). Use `logo_title` and a kid line.

**V12. The Grabble label is blown out by bloom on the sad ending.**
- **What I saw:** in the close-up it is a white smear (25, 28).
- **Fix:** set `toneMapped:false` on the label material and keep it out of bloom (luminance below the 0.88 threshold): a darker cream fill, or render labels after the bloom pass.

**V13. Grabble is both a selectable hero and the villain.**
- **Where:** `public/shared/heroes.js`.
- **What I saw:** a kid can be "Grabble" (P01). With 5–6 players a bot takes him, so the HUD shows two Grabble cards and lines read "Grabble snatched a shard from Grabble".
- **Fix:** remove `grabble` from `HEROES` (and add another hero, e.g. Miss Suds' friend), or rename the NPC.

**V14. Performance headroom.**
- **What I measured:** 72 fps (display cap) during overview and launch at 1280×720. During a launch p95 was 18 ms and max 24.7 ms. Scene: 331–336k triangles, 490–499 visible meshes. At 1920×1080 the back buffer is 3840×2160 with bloom.
- **Fix:** cap the pixel ratio at 1.5 when `innerWidth*innerHeight > 2e6` (`main.js:34`), and swap `THREE.Clock` for `THREE.Timer`.

## 2. Audio (5.5)

**A1. Critical: music dies after the first Catcher launch and never returns.**
- **What happens:** `launch` plays `music_catcher` with `loop:false`. It is 18.66 s long, against a 30.8 s tour and about 33 s to the narration, so the last 12 s of the machine (seesaw, music stand, basket, payoff) play with no music. When the clip ends, `audio.js` `onended` sets `musicKey=null`, and no handler restarts `music_play`. Only `game:start`, `game:reset` and `win` call `playMusic`.
- **Evidence:** after launch 1 in game A, `audio.musicKey === null` for the rest of the game.
- **Fix:**
  - Loop `music_catcher`, or re-render it to about 32 s with an ending timed to the basket.
  - In `caught`/`missed`, `playMusic('music_play', {fade:1.2})`.
  - In `AudioManager.playMusic` `onended`, fall back to the last looping track.

**A2. Overlapping narration.** Every `narrate(..., {wait:false})` starts a new voice immediately, with no queue. Examples:

| What overlaps | Where | Effect |
|---|---|---|
| `launch_sent` (1.26 s) + `launch_ready` (2.27 s) | `game.js` `chooseTarget` | Start in the same millisecond on every launch; the first subtitle is replaced instantly |
| `catcher_target_grabble` + `launch_ready` | `game.js` `chooseTarget` | Same, when the target is Grabble |
| `grabble_pocket` (3.17 s) + `turn_roll` | game D | Same millisecond |
| `grabble_snatch` + `grabble_shiny` | snatch handler | Two voices |
| `kyah_catch` "Flowers, catch him!" + `chase_start` "…Flowers, catch him!" | chase start | The same sentence twice, about 1 s apart |

- **Fix:** in `audio.js`, give voices one channel with a queue: wait:false still acks at once but plays after the current line, and lines tagged `interrupt` cut it. Merge `launch_sent` into `launch_ready`. Drop `chase_start` when `kyah_catch` plays.

**A3. Wrong character, wrong line.**
- **Where:** `main.js:123` and the `onStage` caught branch.
  - `grabble_stuck` ("I'm… stuck!") plays when a friend is caught, followed by `launch_caught` "…I'm stuck! Hand over a shard!" — two "stuck" lines from two voices (16).
  - `grabble_missed` ("Missed me!") plays in Grabble's voice when a friend escapes.
  - `kyah_catch` plays even when Charli or Poodle chases.
  - `catcher_caught_grabble` says "His shiny loot spills everywhere!" with an empty bag.
- **Fix:**
  - Use Grabble's lines only when `grabble` is under the basket.
  - Re-record `launch_caught` without "I'm stuck!".
  - Add narrator and hero-specific chase lines, and an empty-bag variant.

**A4. Stale narration after Grabble wins.**
- **Where:** `game.js:225,229`. `addLoot()` can finish the game, but `grabbleTurn` then still narrates `grabble_snatch`/`grabble_pocket`; `afterMinigame` does the same for `swish` (line 318).
- **What I saw:** game D played "Grabble pocketed a shard. Especially shiny things!" over the sad card, 9 s after `grabble:win`.
- **Fix:** add `if (this.phase !== 'playing') return;` after every `addLoot`/`addShards`.

**A5. 24 of 26 Catcher cue sounds are silent.**
- **What happens:** `onCue` calls `audio.sfx(name)` for `contraption.js` CUES. Only `rope_tug` and `dog_splash` exist in the manifest. These names have no clip and fail silently: `net_release`, `bump`, `marble_spill`, `tub_splash`, `drain`, `loop`, `pop`, `bloom`, `vine_arrive`, `pour`, `clunk`, `apple_pop`, `step_1…6`, `gutter`, `jump`, `boing`, `woof`, `duck_slide`, `bonk`, `notes_top`, `latch`, `lift`.
- **Effect:** there are dead stretches with only the music bed, e.g. launch +5.5–9.4 s (the pipe loop) and +18.0–21.9 s (the gutter).
- **Fix:** map the cues to existing clips in `main.js` `onCue`:

| Cue | Clip |
|---|---|
| `step_n` | `pawn_hop` with a rising rate |
| `gutter` | `marble_roll` at rate 0.7 |
| `bump` | `bucket_clank` |
| `drain` | `tub_splash_bubbles` at low volume |
| `latch` | `ui_tap` |

  Or generate the missing clips.

**A6. Loudness is still inconsistent.** Targets are voice −16 and sfx −18 LUFS; I measured all 144 clips with `ebur128`. No clipping: peaks are ≤ −1.8 dBTP everywhere.

| Group | Integrated loudness |
|---|---|
| **Voices** (15) | `grabble_shiny` −21.4, `grabble_stuck` −20.2, `space_cobble_alt` −19.1, `chase_start` −18.9, `space_fetch_choose` −18.9, `mini_shard` −18.5, `win_cake` −18.5, `space_flight_stay` −18.5, `grabble_pride` −18.4, `kind_1` −18.1, `space_fetch` −18.1, `grabble_mine` −17.8, `mini_swish` −17.8, `space_cobble` −17.8, `mini_cake_bonus` −17.7 |
| **SFX** (10) | `dice_land` −23.6, `vine_grab` −23.6, `timer_tick` −23.3, `grabble_scurry` −23.1 (plays every turn), `bucket_tip` −21.7, `apple_roll_stairs` −20.9, `bridge_land` −20.6, `marble_roll` −20.6, `confetti` −19.8, `seesaw_boing` −19.6 |

- **Fix:** add a normalize pass in `tools/gen-audio.mjs` (`loudnorm=I=-16/-18:TP=-1.5`).

**A7. Mix plumbing.**
- **No duck counter** (`audio.js:33-34`): the music swells back between overlapping lines.
- **Character lines skip ducking.** All `{duck:false}` lines (`ayva_ding`, `kyah_bloom`, `grabble_*`) play over full music.
- **Lobby loop seam:** `music_lobby` head −22 dB, tail −33 dB.
- **The turn line repeats** about 36 times per game, for bots too.
- **Fix:** add a duck counter, duck character lines to 0.35, crossfade loops by 1 s in `playMusic`, and add 3–4 `turn_roll` variants (skip it for bots after round 1).

**A8. Clips that are generated but never played.**
- **Voice:** `launch_go` ("Ready… sing!", the book's line), `ayva_lift` ("Music, lift the gem!", for the gem assembly), `kyah_vine` (for the vine stage or chase), `kyah_together` (game start), `rejoin` (on `player:rejoin`), `grabble_moves`.
- **SFX:** the 11 mini-game clips, which the board preloads.
- **Fix:** wire the voice lines as noted, and remove the unused sfx from the board preload list.

What works:
- **Assets:** all manifest keys resolve, and there are no 404s.
- **Catcher sync:** the stage SFX and sound words fire in design order, on the visuals.

| Stage | Bell | Net | Bucket | Tub | Pipe | Vine | Drop | Apple | Pup (BOING) | Splash | Music | Basket | STUCK | Narration |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Time after launch | +0.01 | +1.70 | +2.85 | +4.32 | +5.52 | +9.37 | +15.48 | +15.99 | +22.67 | +23.97 | +25.59 | +27.62 | +28.48 | +31.3 |

- **Wiring:** `camera_whoosh`, `shard_fly`, `timer_tick`, `ui_tap`/`ui_join`, `kind_2` and `pup_woof` (sfx) are wired.

## 3. Mechanics & rules (7.0)

**M1. Balance does not hold with real players.**
- **Simulation:** `tests/sim.mjs` defaults to `winTarget=8, grabbleTarget=8`, not the shipping 10/10. Its cost model counts chases and launches twice: `minigames` already includes them. I wrote a 150-game simulation with the shipping defaults (`scratchpad/grader2/sim2.mjs`), costing turns with my measured durations (below).

| Run (4 players, 10/10) | Turns | Launches | Games with fewer than 6 launches | Est. minutes | Grabble wins |
|---|---|---|---|---|---|
| Bot scores | 36.6 | 6.7 | 36% | 20.1 | 7% (target 10–20%) |
| Kid-level scores (measured below) | 27.5 | 5.0 | 63% (target ≥ 6 launches) | 15.3 (p10 10.8) | 1% |

- **Why kids score so well:** the kid-level scores come from my 600 ms-reaction kid helper: shard 6/6 three times, cake 8/8, dodge 3/3. Real players hit the bonus almost every time, because shard ≥5 → +2 is nearly guaranteed and the cake bonus is easy. That inflates shards and leaves Grabble harmless.
- **Fix:**
  - shard +2 only on 6/6, or shorter `WIN` windows in later rounds;
  - flight bonus at ≥6;
  - Grabble 1d3+1, or he also pockets on Launch/Fetch spaces when no one is near;
  - give `botScore` a kid-level distribution, and fix `sim.mjs` defaults and costs.
- **Pacing estimate** (4 kids): 15–20 min. That is inside 15–30, but at the bottom of the range.

**M2. A disconnect still steals the turn after a quick rejoin.**
- **Where:** `disconnect()` arms a 3 s auto-act (`game.js:126`); `rejoin()` (121) neither cancels nor re-arms it.
- **What I saw:** see M8 above. The kid's replayed mini-game was rejected, and a phone that reloads in 2–3 s loses its roll or mini-game. If every human drops, the game auto-plays at 3 s per decision.
- **Fix:** in `rejoin`, `clearTimeout(this.timers.auto)` and re-arm with the remaining deadline (for a mini-game, `minigame.deadline - now`). Pause when no human is connected.

**M3. Room code not validated.**
- **Where:** `join({ name, heroId, socketId })` drops `room`.
- **Fix:** return `{ok:false, error:'This game has a new code — scan the screen again!'}` when `room` doesn't match.

**M4. Host hand-off has no grace period, and bots can be host.**
- **What I saw:** a two-second reload handed host to Mia permanently (P14). `addBot` sets `hostId` when no one has joined yet, so humans joining after bots can't press Start.
- **Fix:** delay the hand-off by about 10 s and give host back on rejoin if no one else acted. Only humans can be host.

**M5. Flights.**
- **The jumps are huge:** 5→22 (+17 spaces) and 18→27 (+9) forward.
- **The checks are skipped:** 22→5 crosses the castle with no lap bonus, and flights skip chase and snatch checks.
- **"Fly" is very easy:** one ring is enough. Kids will fly almost every time, which shortens games further (M1).
- **Fix:** award the lap when a flight crosses index 0 going forward, or make flights only go to the next pair forward, and decide whether passing Grabble mid-air counts.

**M6. Small rule and edge-case bugs.**
- **The bump toast can never show:** the first `move` always sends `bumped:false` (`game.js` `roll`).
- **Grabble's catch line ignores an empty bag:** `catcher_caught_grabble` is used when the bag is empty.
- **Grabble and friends on the bridge together:** if a launcher targets a friend while Grabble already stands on the bridge, both are caught. The friend pays 1, the launcher takes up to 3 of the loot, and the narration only mentions Grabble.
- **Charli's fetch from Grabble** plays `grabble_tripped` "Whoa! My net!", a swish line.
- **Fix:** document the double catch in `game-design-v2.md` §2 and narrate both outcomes.

**M7. Missing tests.** There are no tests for rejoin during a turn or mini-game, room validation, "no events after `phase==='ended'`" (A4), or flight laps.

**Measured board durations** (game A, board visible, including Grabble's move): bot turn without a mini-game 6.9–10.1 s; with a bot mini-game 10.5–14 s; chase 16–21 s; launch turn 47–48 s; tour 30.8 s.
- Humans add about 4 s per roll, 3 s to tap Start plus 6.6–13 s of play per mini-game, and about 5 s to pick plus 3–8 s to ring on launches.
- The game start intro is 17 s, the win sequence about 15 s, and the Grabble ending about 10 s.

What works:
- All 11 engine tests pass, and the server never threw across five games.
- §2 rules match: Grabble moves 1d3, snatches on land and pass, pockets on shard spaces, stops on the bridge, and wins at the target; chase; fetch from Grabble first; Catcher can target Grabble.
- The mini-game timeout falls back to a 70% bot score, and the phone auto-starts in time.
- Play Again resets Grabble.

## 4. Phone controller UX (8.0)

**P1. Rejoin during a mini-game replays a dead game.** After a reload the phone shows the same mini-game title card again (countdown 2). The server has already auto-resolved it (M2), so the kid plays for nothing and the result is rejected. Fix it server-side (M2). On the phone, compare `state.minigame.id` before showing the card again; if the step moved on, show "Grabble didn't wait! Watch the big screen".

**P2. The bell's "Ready…" phase ignores taps while the bell already says "TAP!".** My real tap 1 s after Start was ignored. The bell then auto-rang at the 12 s timeout with score 1 (a miss).
- **Fix:** in `minigames.js` bell, hide "TAP!" until `phase==='play'` and show "Get ready…" on the bar. Then the first tap after GO counts.
- **Also:** an untouched bell at timeout uses `pos(t)`, which is random. Prefer the kid-friendly fallback (`botScore`).

**P3. Copy differs between the phone and the board.**

| Mini-game | Phone | Board |
|---|---|---|
| Flight | "Flappy Flight" | "Fairy Flight" |
| Fetch | "Charli Catches" | "Charli Fetch" |
| Dodge | "Tap to hop when the net glows!" | "Hop when Grabble's net glows!" |
| Bell | "Tap when the star is in the glow!" | "glows brightest!" (also the narration) |

- **Fix:** use one table in `public/shared/` and import it in `hud.js` and `minigames.js`.

**P4. "GOT HIM!" on the vine grab is small and low-contrast.** It is about 22 px, pale green on yellow (P13). Use the 46 px word style the other games use.

**P5. iOS motion prompt on the first tap anywhere** (the name field). See P9 in the round-1 table.

**P6. A host reload loses host** (M4). The kid sees "Waiting for the host to play again…" on their own win screen (P14).

**P7. Two extra taps before every mini-game** (Start, then a ready beat) are fine for kids. For the bell, though, a kid has already chosen a target on the previous screen. Consider auto-starting the bell after the pick (`autoAt = now+1.5 s`).

**P8. Mini-game difficulty.** With a 600 ms reaction I scored shard 6/6 (three times), cake 8/8 and dodge 3/3, and won the vine grab in the zone. "Succeed most of the time" is met. The +2 and "bonus" tiers, though, are near-certain (see M1). Mashing on Dodge the Net is correctly not rewarded: 1/3 with random taps, and "Wait for the glow!" helps.

What works:
- **Join and restart:** join in 3 taps; the restart notice gives the new room code; the reconnect banner greys the controls (P06).
- **Latency:** roll → board dice in 2 ms; bell → DING in 10 ms; the live progress bar on the board follows the ticks.
- **Turn screens:** the launch pick screen shows a Grabble "Catch him!" card and a countdown (P07). ROLL is a huge round button.
- **Mini-games:** gorgeous, one decision each, with title cards using the hero's face, synthesized sounds, haptics and result cards (P03, P08–P13).
- **Spectating:** others' mini-games appear with a progress bar (P04).
- **Win screen:** with confetti (P05).
- **Payload:** 1.16 MB.
- **Copy:** no "Pup" text anywhere in the player UI (it remains only in `mock.js`).

## 5. Polish & delight (6.0)

**D1. The game looks broken after its best moment.** The basket stays down, the camera is frozen at the bridge, labels are gone and the music is silent (V1–V3, A1). The Catcher's reset flourish exists in code and is never used.

**D2. Doubled words and cards over subtitles at both endings.**
- "WE DID IT!" plays as a word and then as the card title.
- "OH NO!" does the same.
- Both cards sit over a live subtitle (21–23, 25–26).
- **Fix:** drop the `hud.word` calls in `win`/`grabble:win` and hide the subtitle when the card shows.

**D3. The sad ending is thin.** The camera glides to Grabble, he jumps once, and the card appears. He doesn't run off with the starlight and the gem doesn't dim. The stale "pocketed" line plays over it (A4). The HUD card says "Almost full!" (28, 26).
- **Fix:** Grabble scurries off the board edge with the gem sprite, the castle gem dims, and `music_sting_grabble` plays, then the card.

**D4. Win celebration.** The camera to the castle, shards and confetti are good. Still missing:
- the flower lock and musical key (V10), and `ayva_lift`;
- a cake beat for "Teamwork… and then cake!";
- the bot name: the card reads "Poodle (bot) made the Starlight Gem whole!".

**D5. Developer leftovers.** "Kyah (bot)" plus "Kyah · bot" on every card, the splash copy, the "G" placeholder avatar, the numeral dice and the `THREE.Clock` warning.

**D6. Lobby.** It works, but it's still a plain QR card: no hero portraits, a small room code, and no 3D pop-in for joins. The narration subtitle covers its lower edge (02).

---

## What already feels AAA
- **The village diorama** (50, 52–56):
  - The winding route reads at a glance: castle and stepped hill path, the bakery street, the fountain square, the arched bridge over the waterfall-fed river, and the pet-wash yard.
  - Tile colours and icons are distinct, and lampposts with heart banners mark the flights.
  - Everything is toon-shaded with ink outlines in the book's palette.
- **The touring Starlight Catcher.** Its conduits visibly connect around the whole loop: bell rope → net → bucket → tub → blue pipe → beanstalk up the hill → castle-gate bucket → apple down the steps and gutter → seesaw and Charli's cannonball → music staff → basket. The stages fire in order with sound words, and the shard pops out of the basket (10, 15, 17, 19). Kids will love it.
- **Grabble as a roaming villain.** He scurries, snatches (SWISH!), pockets (MINE!), has a hideout and a HUD loot ring, and the phone shows his bag. The team-vs-villain framing works.
- **The phone mini-games.** Book-quality art, clear one-line rules, generous timing, title cards with the player's face, countdowns, results, and a spectator view.
- **The engine.** The round-1 critical bug is gone with a regression test. Win timing, ties and host hand-off work, and 11/11 tests pass.
- **Responsiveness and budgets.** 2 ms input → board, 72 fps, phone payload 1.16 MB, board textures 33.8 MB, no 404s and no runtime errors.

---

## Screenshot index (`docs/grader-reports/round-2/`)

| Files | What they show |
|---|---|
| 01 | Splash (text-only) |
| 02–05 | Lobby: subtitle over the card, chips fixed, game-start overview with the subtitle over the front row, 1920×1080 scaling |
| 10, 17, 19 | Catcher tour contact sheets (friend caught, 2 s and 1.5 s steps; Grabble caught). The empty-edge pup shot and the frozen post-launch camera |
| 11, 13 | Board mini-game panels (live progress); labels gone after the launch |
| 12, 14 | Snatches shown only on the overview |
| 15, 16 | Shard flies out of the basket; narration with "I'm stuck!" |
| 18 | Next turn, still at the bridge with the basket down |
| 20–24 | Win: shards to the gem, doubled word, card over the subtitle, bot name, plain gem |
| 25, 26, 28 | Grabble's sad ending |
| 27 | Send-to-bridge arc |
| 29, 29b, 30 | Miss: basket ends over the head |
| 31, 31b | Camera left on an empty lamppost after a fairy flight |
| 32 | Board chase close-up and lap |
| 50 | Full-res overview canvas: basket still down at game start, backdrop edge |
| 51–56 | Close-ups: bridge, castle steps and gem, garden hideout, bakery gutter, pet-wash machine, square and seesaw |
| P01–P14 | Phone: Grabble selectable as a hero, wait screen, dodge result, spectator view, win, reconnect banner, Grabble pick card, cake, dodge play, vine grab (title, zone, small "GOT HIM!"), "You did it!" with host lost after reload |
