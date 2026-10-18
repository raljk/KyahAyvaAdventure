# Grading rubric — "AAA kids' party game" bar

Each area is scored 1–10. The target is **every area ≥ 8 and overall ≥ 8.5**. Scores below 7 in any area block sign-off. The grader must list concrete, file-level fixes for every point lost.

## 1. Visuals (board, 3D scene, HUD) — weight 25%
- Reads as the book: pastel watercolor palette, ink outlines, flowers everywhere, blue-roofed castle, bakery, pet wash, bridge. (Compare against the book pages in tools/_raw/page-*.png.)
- Overview camera: every tile type recognizable by color/icon at a glance; pawns readable from 3 m; no z-fighting, floating objects, clipping, stretched textures, or grey untextured surfaces.
- The Catcher: every stage is visually distinct and legible; the basket outcome (caught vs missed) is unmistakable; it looks like a charming toy, not a wireframe.
- HUD: player cards, dice, turn banner, sound words, subtitles and lobby/QR card are legible, styled consistently, never overlap the action, and scale from 1280×720 to 4K.
- Motion: pawn hops, shard flights, camera moves are smooth and eased; nothing pops or snaps unintentionally; 60 fps on a 2020+ MacBook at 1080p (check with the perf counter / requestAnimationFrame timing).

## 2. Audio — weight 20%
- Narrator voice is warm, intelligible and timed to subtitles; character lines are distinct and fun.
- Every event has a sound; the Catcher stages are in sync with the visuals (bell → ding, splash → splash); no clipping, no harsh levels, loudness consistent.
- Music loops cleanly, ducks under voice, switches for lobby/play/catcher/victory.
- Nothing missing: every manifest key resolves; no 404s in the console.

## 3. Game mechanics & rules — weight 20%
- Rules match docs/game-design.md: bump rule, lap bonus once, fetch/launch targeting, timing zones, flight pairs, cake, win at winTarget, no joining mid-game, host-only start, play-again.
- Fairness/pacing: a 4-player game ends in 15–30 minutes with the real animation timings (estimate from event durations); launches happen often enough to matter (≥ 5 per game) and the catch rate for a human with average timing is 65–80%.
- Robustness: disconnects don't stall; reconnection restores the player; bots can finish a game; the server never throws; tests in tests/ pass.

## 4. Phone controller UX — weight 20%
- Join → lobby → turn → choose → bell → flight → win all work on a 375×812 viewport in Safari-like conditions; big tap targets; one action per screen; vibration/haptics; no dead ends; reconnect banner.
- A 6-year-old could play it: wording is short and friendly, the sound words and the shard ring make progress obvious, errors are kind.
- Latency: a tap on the phone is reflected on the board within 300 ms.

## 5. Polish & delight — weight 15%
- The "cage drop" moment: anticipation (camera glide, music build), payoff (basket drop, STUCK!, shard flight), reset charm.
- Win celebration: gem assembly, confetti, fanfare, the book's "Teamwork... and then cake!"
- Lobby: the QR card is inviting and the join flow feels like the start of an adventure.
- No placeholder text, console errors, or developer leftovers visible.

## Report format
`docs/grader-reports/round-N.md` with: scores table, overall, PASS/FAIL against the bar, then for each area a list of **specific defects** (file + what + how to fix, ordered by impact), plus a short "what already feels AAA" list. Screenshots saved under docs/grader-reports/round-N/.
