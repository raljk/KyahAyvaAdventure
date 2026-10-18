# Grader report — round 3

**Build under test:** the working tree from 17:41 to 18:10 AEDT, 2026-10-18.

| Part | Files and timestamps |
|---|---|
| Board | `main.js` 17:04, `contraption.js` / `hud.js` / `style.css` 17:06, `audio.js` / `pawns.js` 16:48, `layout.js` 16:55 |
| Server | `game.js` 16:55, `index.js` 16:49 |
| Shared | `heroes.js` 16:49 |
| Audio masters | 17:34–17:35 |
| Phone (`public/play/*`) | Unchanged since 15:25. Round 2 graded the same phone code. |

**Not covered.** From 18:10 the integrator started landing a new feature while I was finishing:
- Benny the baker as a 6th hero, with "flirt" lines.
- A mini-game mirror on the board panel.
- 12 new voice clips.
- Edits to `heroes.js`, `game.js`, `hud.js`, `index.html`, `main.js`, `style.css`, `index.js`, `tests/engine.test.mjs` and `protocol.md`.

None of that is graded here. My servers had loaded the 16:55 `game.js`.

**How I tested.** I ran my own server on `PORT=3200` in four configurations. The board ran at 1280×720 (and 1920×1080 once); the phone ran in a 375×812 tab.

| Game | Config | Setup | What I checked |
|---|---|---|---|
| 1 | `WIN_TARGET=6` | Phone "Leo" plus 3 bots, played to Poodle's win | Forced launches: a perfect catch at Leo, a catch at Grabble and a miss at Poodle. Also two natural launches. |
| 2 | `WIN_TARGET=2` | 4 bots | Win-celebration contact sheet |
| 3 | `GRABBLE_TARGET=3` | Phone plus 2 bots, played to the sad ending | Sad ending on board and phone |
| 4 | Defaults (10/8) | Phone plus 2 bots | Phone picks Grabble and rings the bell for real; reconnect banner; host reload |

**Instrumentation:**
- **Board audio:** a hook on `AudioBufferSourceNode.start` logged the real start time of every voice, sfx and music buffer.
- **Board HUD:** hooks on `hud.word`, `hud.subtitle` and `hud.showWin`.
- **Server events:** a Node socket.io observer logged every server event and state change with epoch ms.
- **Phone:** an emit hook.
- **Captures:** a rAF hook captured full-resolution canvas frames for the contact sheets.

**Real taps on the phone:** join, hero pick, Start, six rolls, two flights, one shard game, the Grabble pick, the bell, and Play Again. The tool's click latency (0.5–1.5 s) made my own mini-game scores poor (flight BUMP, shard 0, bell 0.93). That is the tool, not the game.

**Caution about hidden tabs:** fronting the phone tab hides the board, which then fast-forwards or stalls by design (M7 in round 2). I discarded every observation affected by that.

Screenshots are in `docs/grader-reports/round-3/`; the numbers below refer to those files.

## Scores

| Area | Weight | R1 | R2 | **R3** |
|---|---|---|---|---|
| Visuals (board, 3D, HUD) | 25% | 6.5 | 6.5 | **7.5** |
| Audio | 20% | 5.5 | 5.5 | **7.0** |
| Mechanics & rules | 20% | 5.5 | 7.0 | **7.5** |
| Phone controller UX | 20% | 7.5 | 8.0 | **7.5** |
| Polish & delight | 15% | 5.5 | 6.0 | **7.0** |
| **Weighted overall** | | 6.15 | 6.63 | **7.33** |

**Result: FAIL.** The bar is every area ≥ 8 and overall ≥ 8.5. No area is below 7, so nothing hard-blocks sign-off, but no area reaches 8.

**The round-2 blockers are fixed.** After every Catcher launch (5 of 5) the machine re-arms, the camera glides back to the overview, all five labels return to opacity 1.0, `music_play` resumes, and the next turn plays on camera. Narration no longer overlaps, nothing stale plays after the game ends, the loudness pass landed, and the win now assembles the gem.

**What keeps it below 8 now is a short list of new or remaining problems:**
1. **The voice queue runs late.** Lines start up to 10.8 s after they were triggered, while their subtitles show at once. "Ready… sing!" and Ayva's "Ding!" land during the vine stage, and "Your turn! Roll the dice!" plays mid-tour.
2. **The re-armed basket hangs at head height.** Any pawn standing on the Bridge looks caught, and the Grabble sad ending reads as if Grabble were caught.
3. **Pawn labels still bloom** into white smears in every close-up.
4. **Grabble shows as a "?" on the phone.** This regression came from removing him from `HEROES`. It appears on the "Catch him!" pick card, the status card and the sad ending.
5. **The Catcher music has a silent hole** in the middle of the tour.

---

## Round-2 defects: status

| # | Round-2 defect | Status | Evidence (round 3) |
|---|---|---|---|
| V1 | Catcher never reset | **FIXED** | `endLaunch()` (`main.js:146`) runs `catcher.reset()` after every caught or missed launch, and also on `game:start` and `game:reset`. The basket re-armed after all 5 launches (15, 50). The armed height is now a new problem (V-1 below). |
| V2 | Camera stuck at the bridge | **FIXED** | `camTo(CAMERA.overview, 1.8)` runs at about launch +31.3 s; the next roll is on camera (15). |
| V3 | Labels hidden after a launch | **FIXED** | Label opacity is 1.00 on all 5 sprites after each launch, read from `userData.label.material.opacity`. |
| V4 | Camera left at a lamppost after a flight | **FIXED** | The `flight` handler ends with `camTo(overview)` (07). |
| V5 | Catcher shot of the empty board edge | **PARTLY** | The splash shot is now framed (13). The seesaw-jump frame at about +20.4 s still faces the board edge and sky (10, row 5, column 1). |
| V6 | A miss is not unmistakable | **FIXED** (briefly) | The basket swings wide and high, clear of the pawns (11, frames +0.0/+0.8). It holds for about 2 s, then the reset swings it back over their heads. |
| V7 | Pawns and labels small | **PARTLY** | Pawns at the castle are 62–63 px tall at 1280×720 (was 50–51), Grabble 71 px, labels 74 px wide (was about 60). The active ring is added. Pawns on a shared tile still sit within ±8 px (`r=0.6`) and their labels overlap. |
| V8 | Subtitles collide | **PARTLY** | Moved under the banner and no longer over the cards. A 3-line box (46vw) now covers the castle gate, the start tile and the pawns standing there (04, 16). |
| V9 | Backdrop billboard | **FIXED** | No billboard: a sky gradient with clouds (50). |
| V10 | Win gem is placeholder geometry | **PARTLY** | 3D shards fly in, a flower wreath blooms and notes orbit (24). The gem itself is still a pale, un-outlined `OctahedronGeometry` (`main.js:64`). The winner's pawn and label can hide it (20). |
| V11 | HUD leftovers | **PARTLY** | Grabble's avatar is fixed and the dice show pips (05). Still "Almost full! Stop him!" after Grabble wins (26). The splash still has developer copy (01). |
| V12 | Labels blown out by bloom | **NOT FIXED** | White smears in every close-up (06, 19, 20, 26). |
| V13 | Grabble selectable as a hero | **FIXED** | 5 heroes (P01). This caused the phone "?" regression (P-1). |
| V14 | Performance headroom | **NOT FIXED** | `setPixelRatio(min(dpr,2))`: 3840×2160 back buffer at 1080p. `THREE.Clock` is still deprecated. 72 fps here (the display cap); see V-8. |
| A1 | Music dies after a launch | **FIXED** | `music_catcher` loops through the tour; `music_play` restarts at `endLaunch` on every launch. The catcher loop has a hole (A-2). |
| A2 | Overlapping narration | **FIXED** (overlap) | A single voice queue (`audio.js:31-49`); no two voices overlapped in 5 launches and 3 endings. It introduced lag (A-1). |
| A3 | Wrong character or line | **PARTLY** | `grabble_stuck` is no longer used for friends; `grabble_missed` only plays when Grabble is under the basket. Still wrong: `launch_caught` keeps "I'm stuck!"; `catcher_caught_grabble` "loot spills everywhere" plays with an empty bag (observed `taken:0, spilled:0`); Ayva chasing says `ayva_lift` ("Music, lift the gem!"); Charli's fetch from Grabble plays `grabble_tripped`. |
| A4 | Stale narration after Grabble wins | **FIXED** | `narrate()` is gated on `phase==='ended'`. After `grabble:win` only `grabble_mine` and the forced `grabble_win` played. |
| A5 | Catcher cue sounds silent | **FIXED** | `CUE_SFX` maps 16 cues; 6 `step_n` hops, gutter, jump, woof and latch all start on cue. The rest coincide with stage sfx. |
| A6 | Loudness inconsistent | **FIXED** | See the table under Audio. Two sfx are still about 3 LU low. |
| A7 | Mix plumbing | **PARTLY** | Duck counter added (`audio.js:51`). Lobby/play loops are cut to whole bars (48.000 / 66.000 s) with head/tail RMS within 0.2–0.8 dB. Character lines (`duck:false`) are still not ducked. `turn_roll` still plays every turn, bots included. |
| A8 | Unused clips | **PARTLY** | `launch_go` and `ayva_lift` are wired. Still unused: voice `rejoin`, `kyah_together`, `kyah_vine`, `grabble_moves`, `space_flight_offer`, `almost_win`, `grabble_stuck`; sfx `swish_net` plus 7 phone-only clips that the board still preloads. |
| M1 | Balance with real players | **PARTLY** | 4 players with kid scoring: 5.4 launches (44% of games have fewer than 5), about 16 min, Grabble 10%. See M-1. |
| M2 | Rejoin steals the turn | **PARTLY** | The disconnect auto-act is cancelled (a 2.6 s drop did not auto-roll). A reload mid-mini-game still truncates the replay to about 3 s (P05, M-2). |
| M3 | Room code not validated | **FIXED** (server) | "Wrong room code. The big screen shows 83A7." The phone side is a dead end (P-2). |
| M4 | Host hand-off has no grace | **PARTLY** | Reloading the host in the lobby kept the host (15 s grace). `addBot` still makes a bot host if bots join first. |
| M5 | Flights skip lap and checks | **NOT FIXED** | Pairs are still 5↔22 and 18↔27. 22→5 crosses the castle with no lap and no snatch or chase check. |
| M6 | Small rule bugs | **NOT FIXED** | The first `move` still always sends `bumped:false`. The empty-bag line and the double-catch narration are as before. |
| M7 | Missing tests | **NOT FIXED** | No tests for room validation, rejoin re-arm or "silent after end". Test 10 is now flaky (M-6). |
| P1 | Rejoin replays a dead game | **PARTLY** | The replay is accepted now, but cut short (P05). |
| P2 | Bell "TAP!" during Ready | **NOT FIXED** (code) | `public/play/*` unchanged since round 2. |
| P3 | Copy differs phone vs board | **NOT FIXED** | Phone "Flappy Flight" / "Charli Catches" vs board "Fairy Flight" / "Charli Fetch". |
| P4 | Small "GOT HIM!" | **NOT FIXED** | Code unchanged. |
| P5 | iOS motion prompt on the first tap anywhere | **NOT FIXED** | `main.js:833` unchanged. |
| P6 | Host reload loses host | **FIXED** | Host kept after a lobby reload. |
| P7 | Auto-start the bell after the pick | **NOT FIXED** | |
| D1 | Board looks broken after the launch | **FIXED** | See V1–V3 and A1. |
| D2 | Doubled words; cards over subtitles | **FIXED** | No `hud.word` on win or sad; the card sits in the lower third with the subtitle on top (21, 26). |
| D3 | Sad ending thin | **NOT FIXED** | Camera to Grabble, one jump, card, about 3 s; no music. It now also reads as "caught" (25, 26). |
| D4 | Win celebration | **PARTLY** | The flower lock, notes and `ayva_lift` landed, and bot names are clean ("Poodle made the Starlight Gem whole!"). No cake beat. |
| D5 | Developer leftovers | **PARTLY** | "(bot)" is gone from names. "· bot" tags, the splash copy, the `THREE.Clock` warning and the "Leo …" banner remain. |
| D6 | Plain lobby | **NOT FIXED** | Still a plain QR card (02, 23). |

---

## 1. Visuals (7.5)

**V-1. Critical: the armed basket hangs at head height.** Every pawn on the Bridge looks caught, and so does Grabble's escape.
- **Where:** `contraption.js:988, 1016-1017`. `ARM_Y = DECK + 6.7`, `ARMED_LEN = 0.45`, `HANDLE_TO_RIM = 2.75`, so the rim sits 3.5 units above the deck. Pawn sprites are 4.0 tall on a 0.2 base (`pawns.js:17,22`), so the head is inside the basket.
- **What I saw:**
  - Between turns, Leo and then Poodle stood on the bridge with only their legs showing (51, 16).
  - In the sad ending, Grabble is centred under the basket with his head in it, then jumps up into it (25, 26). The ending reads as "he got caught".
  - Every miss resets the basket back over the pawns' heads about 2 s after HOP (11, frame +1.7 s).
- **Fix:** raise the armed rim at least 1.2 units above the tallest pawn (`ARM_Y = DECK + 8.2`, or `ARMED_LEN = -1.0`), and keep `LAND_LEN` as it is. In the `grabble:win` handler, frame Grabble off the bridge.

**V-2. Pawn labels bloom into white smears in close-ups and are low-contrast in the overview.**
- **Where:** `pawns.js:5-11,25`. The cream fill `rgba(255,246,224,.96)` plus pastel text in the hero colour, on a `SpriteMaterial` that is tone-mapped and bloomed (threshold 0.88, `main.js:46`).
- **What I saw:** "Leo", "Ayva" and "Poodle" are unreadable white blobs in the mini-game, chase, win and sad close-ups (06, 19, 20, 26). In the overview, Poodle (mint) and Ayva (pink) text on cream nearly disappears (50).
- **Fix:**
  - `toneMapped:false` on the label material, with the fill darkened to about `#F3E6C8` (luminance below the bloom threshold).
  - Ink-coloured text with a hero-colour underline or pill border, instead of pastel text.
  - Alternatively render labels in a second pass after bloom (`renderOrder` plus a separate scene).

**V-3. The subtitle box now covers the castle, the start tile and the gem area.**
- **Where:** `style.css:41`. `#subtitle` sits at `top: 70u`, `max-width: 46vw`, and the game-start and win lines run to 3 lines.
- **What I saw:**
  - It covers the castle gate, where every pawn starts and where the gem stands (04).
  - It covers pawns standing at the castle during play (16).
  - It sits over the castle during the win narration (21).
- **Fix:**
  - Cap it at 2 lines: `max-width: 62vw`, `font-size: 19u`, `text-wrap: balance`.
  - Shorten the 3-line lines (`game_start`, `win`, `grabble_intro`) into two subtitle beats.
  - Or move it to the free top-right band beside the banner.

**V-4. At the win the gem is plain, and the winner can hide it.**
- **Where:** `main.js:62-66` (`OctahedronGeometry`, no outline) and `CAMERA.castle` (`layout.js`).
- **What I saw:** when the winner stands on the castle tile, their sprite and blown-out label sit right in front of the gem through the whole celebration (20). The gem is a pale untextured double pyramid (24).
- **Fix:**
  - Hop the winner aside to a slot beside the pedestal before `camTo(CAMERA.castle)`, or raise `GEM_POS` by 1.5.
  - Give the gem facets (an `IcosahedronGeometry` with flat shading), an ink outline and a slight emissive gradient, or use the `gem_full` sprite as a billboard core.

**V-5. HUD leftovers.**
- **Grabble card after he wins:** "Almost full! Stop him!" stays on after Grabble wins (`hud.js:35`; 26). Show "He got away!" when `state.winnerId === 'grabble'`.
- **Banner during resolving:** `STEP_TEXT.resolving = '…'` renders "Leo …" for most of every turn (03, 12, 14). Use "Leo's turn" or the `lastEvent.text`.
- **Bot tags:** "Ayva · bot" on every bot card (`hud.js:26`; 02). Drop the tag, or use a small robot glyph.
- **Splash:** still text-only developer copy, "Phones are the controllers, this screen is the board…" (`index.html:37-45`; 01). Use `logo_title` and a kid line ("Gather your friends, the Starlight Gem needs you!").

**V-6. The Catcher marble is a white bloom flare from the bucket to the castle gate.**
- **Where:** the marble emissive and the `travelLight` (intensity 1.6) in `contraption.js` `poseLight`.
- **What I saw:** a featureless white glare blob in every frame from +1.7 s to +13.6 s, hiding the marble and the pipe loop (10).
- **Fix:** cut the marble's emissive to about 0.4 or keep it under the bloom threshold, and drop the `travelLight` intensity to about 0.6.

**V-7. One tour key still frames the outer board edge.** At about +20.4 s (the apple jumps onto the seesaw) the shot looks outward over empty grass and sky with the seesaw tiny (10). Use a negative lateral offset for that `CAM_KEYS` entry (`contraption.js` around `tG1`).

**V-8. A 4K back buffer at 1080p.**
- **What I measured:**
  - 3840×2160 canvas at 1920×1080 (DPR 2); 72 fps (the display cap) here, p95 14.9 ms.
  - 309k triangles, 431 visible meshes.
  - Board textures 35.7 MB of 42.4 MB total, 219 requests, 0 errors.
  - The `THREE.Clock` deprecation warning remains (`main.js:104`).
- **Fix:** `setPixelRatio(innerWidth*innerHeight > 2e6 ? 1.25 : Math.min(devicePixelRatio, 2))`, and swap in `THREE.Timer`.

**V-9. Smaller items.**
- Pawns on a shared tile overlap and their labels stack (`pawns.js:42` `r = 0.6`; use 1.0 and lift labels in steps).
- The basket is still a brown beehive; the book's page 7 shows a flower-vine dome.
- After a server restart the board shows the new lobby but keeps the old camera, music state and gem decor, because nothing runs the `game:reset` path when `state.phase` jumps to `lobby` (seen when I restarted the server). Handle a `prev.phase !== 'lobby' && s.phase === 'lobby'` transition like `game:reset`.

## 2. Audio (7.0)

**A-1. Critical: the voice queue backs up and plays lines up to 11 s late, while subtitles show at once.**
- **Where:**
  - `audio.js:31-49` is a single FIFO with no expiry.
  - The `narrate` handler shows the subtitle at request time (`main.js:181-185`), not when the clip starts.
  - Stage character lines (`ayva_ding`, `kyah_bloom`, `ayva_lala`) go into the same queue.
- **Measured** (request → actual start, from the board's `AudioBufferSourceNode.start` hook):

| Line | Context | Delay |
|---|---|---|
| `turn_roll` "Your turn! Roll the dice!" | queued behind Grabble's snatch and pocket lines; plays during the tub stage of that player's Catcher | +6.3 s |
| `launch_sent` / `launch_ready` "Ring the bell…" | the bell had already rung | +6.3 / +7.6 s |
| `launch_go` "Ready… sing!" | vine stage | +9.9 s |
| `ayva_ding` at DING | plays during the vine | +10.8 s |
| Second launch (to Grabble) | `launch_ready`, `launch_go`, `ayva_ding` | +4.3 / +6.5 / +7.4 s |
| Dice "Six!" / "Two!" | after the SWISH landing word | +2.9 / +2.5 s |

- **Subtitle mismatch:** subtitles show at request time, so the text runs up to about 10 s ahead of the voice (12). Two subtitles requested in the same millisecond overwrite each other: `launch_perfect` was replaced by `launch_caught_empty` after 1 ms while its voice still played.
- **Fix:**
  1. Expire queued lines: drop a job older than about 1.5 s unless it is tagged `keep`.
  2. Show the subtitle from `pumpVoice` when the source actually starts (pass the text with the job).
  3. Put character stage lines on a separate "character" channel that interrupts or ducks the narrator, so `ayva_ding` is never late.
  4. On the server, don't send `launch_sent` + `launch_ready` + `catcher_target_grabble` back to back (merge them into one line). Skip `turn_roll` for bots, and skip `launch_go` when the bell is already rung (bots ring after 1.6 s).

**A-2. The Catcher music has a silent hole mid-tour.**
- **What I measured:** `music_catcher` is 18.66 s long and is a finished cue, not a loop. RMS falls from −17 dB to −48 dB at 17.0 s and −78 dB at 18.5 s.
- **Effect:** `launch` plays it with `loop:true` over a 31.3 s tour. At about +16.5–18.7 s (the apple/gutter stage) the music fades to silence for about 2 s, then restarts from its quiet intro (−27 dB).
- **Fix:** re-render a 32 s cue whose climax lands on the basket, or set `src.loopStart`/`loopEnd` to a bar-aligned 0–16 s section with a 50 ms crossfade.

**A-3. Wrong or mismatched lines.**
- `launch_caught` still says "Caught in the flower basket! I'm stuck! Hand over a shard!" in the narrator's voice. Re-record without "I'm stuck!".
- `catcher_caught_grabble` ("His shiny loot spills everywhere!") and the `loot_spill` sfx play with an empty bag (`taken:0, spilled:0` observed) and when nothing spilled (`taken:2, spilled:0`). Add an empty-bag variant; play `loot_spill` only if `spilled > 0` (`main.js:178`, `game.js` `resolveLaunch`).
- `grabble_mine` ("That gem will be mine!", the line from his win) plays on every `sendToBridge` at Grabble (`main.js:166`).
- Ayva's chase start plays `ayva_lift` ("Music, lift the gem!", `main.js:194`). It needs an Ayva chase line.
- Kyah's chase plays `kyah_catch` "Flowers, catch him!" and then the narrator's `chase_start` "…Flowers, catch him!", the same sentence twice. Drop the tail from `chase_start`.
- Charli fetching from Grabble plays `grabble_tripped` "Whoa! My net!", a swish line (`main.js:164`).

**A-4. Mix.**
- Character lines with `{duck:false}` (`ayva_ding`, `kyah_bloom`, `grabble_*`) still play over full-level music. Duck them to 0.35.
- `turn_roll` plays every turn with no variants (`game.js` `beginTurn`), about 30 times a game. Add 3–4 variants; skip it for bots after round 1.
- The sad ending has no music: `stopMusic` then `mini_lose_jingle` (`main.js:192`). Play `music_sting_grabble`, then a soft lobby loop.

**A-5. Loudness.** All 144 clips measured with `ebur128`. Targets: voice −16, sfx −18, music −20 LUFS.

| Group | Clips | Within ±1 LU | Out of range |
|---|---|---|---|
| Voice | 85 measurable | 85 | — |
| SFX | 47 measurable | 45 | `timer_tick` −20.8 (plays on every countdown); `grabble_scurry` −21.3 (plays every turn) |
| Music | 5 | 5 | — |

- Seven clips shorter than 0.4 s (six sfx and `dice_1`) cannot be gated. That leaves 135 of 137 measurable clips within ±1 LU, which matches the integrator's claim.
- Every clip peaks at or below −1.6 dBTP.
- **Fix:** raise those two sfx by about 3 dB in `tools/gen-audio.mjs`.

**A-6. Unused clips.**
- **Voice (7):** `rejoin` (wire it to `player:rejoin`), `kyah_together` (game start), `kyah_vine` (the vine stage), `grabble_moves`, `space_flight_offer`, `almost_win`, `grabble_stuck`.
- **SFX:** `swish_net`, plus `flap_wing`, `ring_pass`, `tumble`, `pup_catch`, `net_swoop`, `strawberry_plop` and `countdown_beep`. The board preloads them for nothing (`audio.js:12`).
- **Fix:** wire the voice lines, and filter the preload list.

What works:
- **Music:** play and lobby loops are seamless and switch lobby → play → catcher → play → victory.
- **Catcher sync:** every stage and cue fires in sync with the visuals. Bell DING lands 5 ms after the ring; SWISH, BUMP, SPLASH, BLOOM, BOING, the SPLASH cannonball, LA-LA, WHOOSH and STUCK/HOP each hit their stage.
- **Assets:** every manifest key resolves, and there are no 404s.

## 3. Mechanics & rules (7.5)

**M-1. Balance is still under the design targets.**

`KID=1 node tests/sim.mjs 100 N` (10/8):

| Players | Turns | Launches | Games with < 5 launches | Est. minutes | Grabble wins |
|---|---|---|---|---|---|
| 2 | 17.7 | 3.4 | 78% | 10.0 | 1% |
| 3 | 24.2 | 5.1 | 44% | 14.4 | 5% |
| 4 | 27.4 | 5.4 | 44% | 16.2 | 10% |
| 5 | 31.4 | 6.8 | 20% | 19.1 | 12% |

With bot scoring at 4 players: 7.2 launches, 19.9 min, Grabble 25%.

- **Against the design (§5, 4 players):** ≥6 launches is missed (5.4); 20–30 minutes is missed (about 16); Grabble's 10–20% win rate is met.
- **Against the rubric:** at least 5 launches is borderline, and 15–30 minutes is at the floor.
- **Measured real durations** (game 1, board visible):

| Turn type | Duration |
|---|---|
| Bot launch turn | 41–50 s (avg 48) |
| Bot mini-game turn | 11.5–14 s |
| Chase | 20 s |

  With 4 kids adding about 4 s per roll and 6–12 s of play per mini-game, I estimate 15–17 minutes.
- **The sim's cost model double-counts:** `minigames` already includes launches and chases, and each is added again at 42 s / 16 s. So the sim slightly over-estimates time.
- **Kid-level two-player games are too short and Grabble is harmless.**
- **Fix:**
  - Scale `winTarget` by player count (12 for 2–3 players).
  - Shard +2 only on 6/6; flight bonus at ≥ 6 rings.
  - Grabble also pockets on a Launch space when nobody is within 3.
  - Fix `COST` in `tests/sim.mjs` so launches and chases are counted once (measured: a launch turn is about 48 s in total, a chase turn about 20 s).

**M-2. A reload during a mini-game still costs the kid the game.**
- **Where:** `game.js` `rejoin()` re-arms with `Math.max(8000, deadline - now)`.
- **What I saw:**
  - I reloaded during the shard game with 8.7 s left. The reconnect took 35 ms, and the deadline was unchanged.
  - The phone replays the title card with a 4 s auto-start (`minigames.js:1207`), and `endAt = deadline - 700` cuts play to about 3 s of a 12 s game.
  - The result was score 0 at 428.32 (P04, P05).
- **Fix:** on rejoin during a mini-game, reset `minigame.deadline` to `now + TIMEOUTS.minigame` (or `playLen + 8 s`), push state, and re-arm. Alternatively, freeze the deadline while the player is disconnected.

**M-3. Flights still skip the lap and the checks.**
- 5↔22 and 18↔27 are unchanged.
- 22→5 crosses index 0 with no lap bonus, and no snatch or chase check along the way (`game.js` `afterMinigame` case `flight`).
- One ring is enough to fly.
- **Fix:** award the lap when `to < from`, or only pair flights forward within one lap. Decide whether passing Grabble mid-air counts.

**M-4. Event payload bugs.**
- The first `move` always sends `bumped:false` (`game.js` `roll()`), so the "Bumped forward" toast can never show.
- After a chase, the second `move` is sent after `p.space = ac.to`, so it reports `from == to`. Observed: `{"from":0,"to":0,"path":[31,0]}`.
- **Fix:** pass the real `bumped` (with `path1`), and capture `from` before reassigning.

**M-5. Small rule and edge cases.**
- **Bot host:** a bot added before any human becomes host (`addBot`: `if (!this.hostId) this.hostId = id`). Only humans should be host.
- **Double catch:** a friend and Grabble both on the bridge are caught together; only Grabble's line plays. Narrate both, and document it in §2.
- **Docs drift:** the README still says `GRABBLE_TARGET` "default 10" and "Up to 6 players"; the code uses 8 and had 5 heroes during grading. The design's §1 lists 8 shard spaces and its counts add up to 31; `layout.js` has 9 shard spaces (32 total).

**M-6. Tests.**
- `npm test`: 11/11 in 5 of 7 runs.
- Test 10 ("fetch takes from Grabble first", `engine.test.mjs:89`) failed 2 of 7 runs. `assert.equal(g.grabble.loot, 0)` races Grabble pocketing a shard on his post-turn scurry. Assert `<= 1`, as test 8 does.
- Still no tests for: room validation, rejoin re-arming the mini-game deadline, "no narration after `phase==='ended'`", or a flight crossing the castle.

**M-7. An unexplained flight score.** I watched one flight (game 4, Leo, phone tab in the background, no deliberate input) score 8/8: WOW and a bonus shard (P15).
- I could not reproduce it. A visible `runMinigame('flight')` with no input scored 0; one started hidden and shown after 7 s scored 0; 480 headless no-input runs scored 0.
- I don't score it. Worth a look: what drives `st.hero` when the page has been backgrounded?

What works:
- **Engine:** the server never threw across four servers and five games. Bots finish games, and Play Again resets cleanly (23).
- **Lobby rules:** the room code is validated, and the host keeps the role through a lobby reload.
- **Disconnects:** a 2.6 s drop did not auto-roll.
- **Endings:** narration is silent after the end except the closing line.
- **§2 rules:** Grabble's d4/d3/d2 dice by player count (`game.js` `grabbleTurn`), stopping on the bridge, chase, fetch-from-Grabble-first and Catcher-at-Grabble all behave as designed.

## 4. Phone controller UX (7.5)

**P-1. Regression: Grabble is a "?" on the phone.**
- **Where:** `public/play/main.js:104-112`. `loadArt()` loads faces only for `HEROES`, and Grabble was removed from `HEROES`. `paintAvatar()` (line 85) then falls back to `HERO_BY_ID[id]?.name || '?'`.
- **What I saw:**
  - The launch pick's "Catch him!" card (P11).
  - The Grabble status card on every wait screen (P06).
  - The sad-ending screen, a big purple "?" (P10).
- **Fix:** load `manifest['hero_grabble_face']` explicitly in `loadArt()` and repaint. Make the fallback for `'grabble'` a "G".

**P-2. A wrong room code is refused, but the phone has no way out.**
- **Where:** `main.js:255,437-440`.
- **What I saw:** with `?room=ZZZZ` the error reads "Wrong room code. The big screen shows 83A7." (P02). The room chip is not editable (`needRoom = !S.room`), so Join just fails again.
- **Fix:** on that error, clear `S.room` and show the room field pre-filled with the right code, or offer "Join 83A7" as a button. Kinder copy: "That's an old code! Scan the big screen again."

**P-3. A reload during a mini-game gives a truncated replay** (M-2, P04, P05). The phone shows the title card again and auto-starts after 4 s, then cuts the game about 3 s in. A kid sees "OH NO! It got away… next time!" for a game they barely played.

**P-4. Unchanged from round 2** (`public/play/*` untouched since 15:25):
- **Copy mismatch:** Flappy Flight vs Fairy Flight, Charli Catches vs Charli Fetch, and the dodge and bell hints (`minigames.js:32-38` vs `hud.js:4`). Use one table in `public/shared/`.
- **Bell:** the "Ready…" phase (R2 P2) is unchanged.
- **Vine grab:** the small, low-contrast "GOT HIM!" (R2 P4).
- **iOS:** `askMotion()` fires on the first pointerdown anywhere, including the name field (`main.js:833`).
- **Bell start:** the bell does not auto-start after the pick (R2 P7).

**P-5. Small items.**
- **Bell feedback:** the "DING!" confirmation on the bell is about 20 px of pale text (P13); use the 46 px word style.
- **Pick-screen pips:** 10 shard pips wrap to a second line on the half-width pick cards (P11); use a compact "0/10" chip.
- **Flight auto-start:** a flight auto-starts while the phone is pocketed and can still score (M-7). It's worth a "Tap to fly!" guard that pauses until the first input.

What works:
- **Join and lobby:** 3 taps to join; five portrait tiles with Miss Suds (P01); "You're in!" with a host crown; Start works; the host is kept through a reload.
- **Roll:** a huge ROLL button with pips; phone → board in 2 ms (roll emit 54 315 → `dice_roll` on the board 54 317).
- **Mini-games:** gorgeous title cards with the player's face and an auto-start ring (P03); real-tap flight, shard and bell all worked; clear results (P09, P13); a spectator view; the win screen with confetti (P07).
- **Launch pick:** the pick screen with the "Catch him!" card and a 22 s countdown (P11).
- **Reconnect:** the "Reconnecting…" banner greys the controls (P14).
- **Copy and payload:** no "Pup" anywhere; 1.07 MB / 28 requests on join.

## 5. Polish & delight (7.0)

**D-1. Between launches the Bridge looks like someone is always caught,** and the sad ending looks like a capture (V-1). This undercuts the best moment and the villain's escape.

**D-2. The Catcher's character beats land in the wrong place.** "Ding!", "Ready… sing!" and "Ring the bell…" play 7–11 s after the bell, while the vine is climbing (A-1). The machine itself is in sync, so this is the most noticeable audio flaw in the showpiece.

**D-3. The sad ending is still thin.** About 3 s: the camera goes to Grabble, he jumps once, then the card. There is no run-off with the starlight, the gem doesn't dim and there is no sting. The HUD still says "Almost full! Stop him!" (26).
- **Fix:** in `grabble:win`, have Grabble hop off the bridge and scurry to the board edge with the `gem_full` sprite, dim `gem.userData.halo`, play `music_sting_grabble`, and only then `showWin`.

**D-4. The win is much better but still short of the book's beat.**
- There is no cake moment for "Teamwork… and then cake!": tie in the cake-table landmark or a `cake_party` sfx with a slice pop.
- The gem is plain and can be hidden by the winner (V-4).

**D-5. The shard payoff is now tiny.** After a catch the shards fly from the re-armed basket in the overview (17), not out of the basket in close-up as in round 2. Fly the shards before `endLaunch()` (move the `addShards` before the `caught` ack), or keep the camera on the basket for 1.2 s.

**D-6. Developer leftovers:** the splash copy (01), "· bot" tags (02), the "Leo …" banner, the `THREE.Clock` warning and the plain QR lobby with a small room code (02, 23).

---

## What already feels AAA

- **The village diorama** reads like the book: the winding route, the castle on its hill with the stepped path, the bakery street, the fountain square, the arched bridge over the waterfall river, and the pet-wash yard. It is toon-shaded with ink outlines and holds 72 fps (50).
- **The touring Starlight Catcher** is a real "wow". Bell rope → net → bucket → tub → pipe → beanstalk up the hill → castle bucket → apple down the steps and gutter → seesaw cannonball → music staff → basket (10). Every stage and cue now has a sound, and the machine resets with a reverse flourish.
- **The post-launch flow:** the camera glides home, the music returns, the labels come back, and the next turn is on camera (15). Fixing this is the biggest single improvement this round.
- **The win celebration:** the camera goes to the castle, 3D shards fly into the gem, the flower wreath blooms, notes orbit, then confetti, the victory music, the lower-third card, and finally the narrator (24, 21). There is no doubled "WE DID IT!" and the bot names are clean.
- **Audio craft:** mastered to target (A-5), seamless whole-bar loops, a duck counter, and no overlapping voices.
- **HUD:** consistent at 1280×720 and 1920×1080 (22, 23), pip dice, the board's mini-game panel with a live progress bar and countdown (19), and Grabble's loot ring.
- **Phone:** book-quality mini-game art, one decision per screen, 2 ms latency, a 1.07 MB payload, a kind reconnect banner, and host continuity.

---

## Screenshot index (`docs/grader-reports/round-3/`)

| File | Shows |
|---|---|
| 01 | Splash, still developer copy |
| 02, 23 | Lobby: "· bot" tags; after Play Again at 1920×1080 |
| 03, 04 | Game start; subtitle under the banner covering the castle and the start pawns |
| 05 | Pip dice and subtitle |
| 06, 19 | Close-ups: label bloom smear; board mini-game panel with countdown |
| 07 | Camera back to the overview after a flight |
| 10 | Catcher tour contact sheet (catch at Grabble): marble glare; the +20.4 s edge shot |
| 11 | Missed ending: basket wide and high, then the reset swing |
| 12 | Net stage with the stale "Ring the bell…" subtitle |
| 13, 14 | SPLASH framed; PERFECT over the closed basket |
| 15 | After a launch: overview, labels, next turn |
| 16, 51 | The armed basket hides the head of the pawn on the bridge; subtitle over the castle |
| 17 | Shard flying from the re-armed basket in the overview |
| 18 | SWISH under a stale subtitle |
| 20, 21, 22, 24 | Win: the winner's pawn hides the gem; card with narration; 1920×1080; 3D celebration contact sheet |
| 25, 26 | Sad ending: Grabble's head in the basket; "Almost full!" after his win |
| 50 | Full-resolution overview canvas |
| P01–P02 | Join with five heroes; wrong room refused with no way to fix it |
| P03–P05 | Shard title card; reload → title card again → truncated replay scored 0 |
| P06, P10, P11 | Grabble as "?" on the wait screen, the sad ending and the "Catch him!" pick card |
| P07 | Phone win screen |
| P08, P09, P16 | Real-tap flight and shard grid; BUMP result |
| P12, P13 | Bell with a real tap; tiny "DING!" |
| P14 | Reconnect banner |
| P15 | A flight scored 8/8 with no deliberate input (unexplained) |
