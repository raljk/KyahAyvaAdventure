# Starlight Gem Chase — Design v2 (village route, Grabble the villain, mini-games, machine tour)

Supersedes the board, villain and launch sections of `docs/game-design.md`; everything not mentioned here (heroes, palette, audio keys, image keys, phone style) stays as in v1. Source of truth for geometry: `public/board/layout.js`.

## 1. The board is the village

The route is a **winding closed path through the village**, not a ring. 32 spaces follow a spline that visits, in order: the **Castle gate** on the hill (Start, index 0) → down the **castle steps** → the **Sunbeam Bakery street** (east) → the **village square** with the fountain → the **Stone Bridge** over the river (index `BRIDGE_INDEX`, currently 15) → the **riverside** → the **Puddle Paws Pet Wash** yard (south-west) → the **flower garden** on its knoll (west) → the **hill path** back up to the castle. Heights come from `heightAt(x,z)`: the castle hill rises ~3.2 units, the garden knoll ~1.3. Buildings sit *on* the board next to the path (anchors in `LANDMARKS`), the river is a polyline that crosses the route exactly at the bridge, and lampposts with heart banners mark the four Fairy Flight spaces (`FLIGHT_PAIRS`).

Space types (32): 8 shard, 8 launch, 3 swish, 3 fetch, 4 flight (2 blue + 2 pink), 2 cobble, 1 cake, 1 bridge, 1 castle. Rules for each are as v1 **plus the mini-games in §4**.

## 2. Grabble, the gem snatcher (NPC villain)

- Grabble is a **non-player pawn** (the running-with-net sprite) who starts in the flower garden (`GRABBLE_START`) with an empty **loot bag**.
- **He moves after every player's turn**: 1d3 spaces clockwise (bots and humans alike). Along the way:
  - every player he **lands on or passes** loses 1 shard to his loot ("SWISH!", `grabble_shiny` voice) if they have one;
  - if he **lands on a Shard space** he pockets +1 loot ("Especially shiny things!");
  - if he lands on the **Bridge** he stops there (exposed to the Catcher).
- **Grabble wins** the moment his loot reaches `grabbleTarget` (default 8): the board plays the sad ending ("That gem will be mine!"), `winnerId = 'grabble'`, Play Again is offered. This is the shared threat that makes the players a team.
- **Chasing him**: when a player's move **lands on or passes Grabble**, the move pauses at Grabble's space for the **Vine Grab chase mini-game** (§4). Win: take up to 2 loot shards back ("Got it!"); if his bag is empty he just trips. Lose: "Hop! Missed me!" and Grabble skips 2 spaces ahead.
- **The Catcher can target Grabble**: on a Launch space the launcher may send *any player or Grabble* to the bridge. Catching Grabble shakes out his whole bag: the launcher takes up to 3 loot shards, the rest scatter back to the sky, and Grabble is sent back to the garden.
- **Charli Fetch** takes from Grabble's loot first (if he has any) instead of from a friend. Only when his bag is empty does the player pick a friend.
- **Grabble Swish spaces** now trigger the **Dodge mini-game**: dodge all three net swipes to keep your shard.

## 3. The Starlight Catcher tours the whole village

One launch is a ~30 s chain reaction that travels the entire loop. Stage anchors are in `CATCHER_STAGES` (id, nearest space, side of the path, world anchor); conduits (ropes, gutters, pipes, vines) run beside the path between anchors. Stage ids and order (sound keys unchanged from v1 where the id is the same):

| # | id | where | what | SFX |
|---|---|---|---|---|
| 1 | `bell` | riverside lamppost just past the bridge | launcher rings Ayva's bell; the rope runs along the river | bell_ding (+ayva_ding) |
| 2 | `net` | pet-wash yard | rope tugs Grabble's net off its hook; pendulum swing | net_swing |
| 3 | `bucket` | pet-wash corner | net bumps the Puddle Paws bucket; a marble spills | bucket_bump |
| 4 | `tub` | pet-wash tub | marble splashes in, bubbles, down the drain | tub_splash_bubbles |
| 5 | `pipe` | along the west lane | marble rattles through a long periwinkle pipe past the garden gate | pipe_rattle |
| 6 | `vine` | garden knoll → hill path | Kyah's vine BLOOMS like a beanstalk and carries the marble up the hill to the castle gate (long, the big "wow") | vine_bloom (+kyah_bloom) |
| 7 | `drop` | castle gate | marble drops into the castle-gate bucket, which tips | bucket_bump (pitch down) |
| 8 | `apple` | castle steps → bakery street | the big red apple bounces down the steps and rolls the whole street in a gutter rail | apple_roll_stairs |
| 9 | `pup` | village square, fountain | apple flips the seesaw; Charli cannonballs into the washtub | seesaw_boing, dog_splash (+pup_woof sfx) |
| 10 | `music` | bridge lamppost | splash knocks the music stand; notes spiral up the pole | music_rise (+ayva_lala) |
| 11 | `basket` | the bridge | flower-vine basket drops | basket_whoosh_drop |
| 12 | `caught` / `missed` | | as v1; caught pawns inside; a shard flies **out of the basket** to the launcher | caught_stuck / missed_hop |

The camera follows the action around the village (`cameraPath` with `times`). Reset is a quick reverse flourish (marble floats back, apple hops back up the steps, basket rises) rather than a snap.

## 4. Mini-games (on the phone, 8–15 s, one decision)

All mini-games share: a title card with the hero and one-line instructions, a big start tap, a countdown ring, synthesized phone sounds, haptics, and a result screen. The phone sends `player:miniResult { id, score }`; the server maps `score` to the outcome; the board shows a live panel ("Kyah is flying through the flower rings!") with a progress bar driven by `player:miniTick { id, progress }` (throttled to 5 Hz). Timeout 25 s → the server scores it as a miss-ish random result. Bots sample a score that succeeds ~70 %.

| type | trigger | the game | score | outcome |
|---|---|---|---|---|
| `flight` | Fairy Flight space | **Flappy flight**: tap to flap through flower-ring gates over the rooftops for 12 s; hit a ring edge → tumble (game ends early) | gates passed 0–8 | ≥1: fly to the paired lamppost · ≥4: also +1 shard · 0: stay |
| `shard` | Starlight Shard space | **Look under the flowers**: 9 flower tiles; the one that twinkles must be tapped before it stops (6 rounds, 6 s) | twinkles caught 0–6 | ≥1: +1 shard · ≥5: +2 · 0: +0 ("it got away… next time!") |
| `fetch` | Charli Fetch space | **Charli catches**: drag Charli left/right to catch 3 falling shards (8 s), dodge the falling buckets | catches 0–3 | 0: nothing · 1–2: +1 (from Grabble's loot if any, else from the chosen friend) · 3: +2 |
| `swish` | Grabble Swish space | **Dodge the net**: Grabble's net swoops 3 times; tap when the net flashes to hop away | dodges 0–3 | 3: keep your shard, Grabble trips · <3: −1 shard to his loot |
| `cake` | Teatime Cake space | **Strawberry catch**: tap falling strawberries onto the cake, 6 s | strawberries 0–8 | everyone +1 always · ≥5: the player gets +1 more |
| `chase` | landing on / passing Grabble | **Vine grab** ("Flowers, catch him!"): hold to grow the vine, release when its tip is inside the glowing zone around Grabble | timing 0–1 | in zone: take 2 of his loot · perfect: 3 · miss: he hops 2 ahead |
| `bell` | Launch the Catcher | the v1 timing bar (ring the bell when the star glows brightest) | timing 0–1 | sweet [0.30, 0.75] caught · perfect [0.48, 0.58] |

Cobblestone, Bridge and Castle have no mini-game.

## 4b. Benny the baker, and the live mini-game window

- **Benny** (hero id `baker`, warm orange-brown) is the Sunbeam Bakery's baker, a friendly adult. Six heroes: Kyah, Ayva, Charli, Poodle, Miss Suds, Benny (2–6 players). Grabble is the villain only, never a hero.
- **Benny is sweet on Miss Suds.** Only when both are in the game: he greets her after the intro ("Good morning, Miss Suds! You look as bright as a sunbeam today!"), pays her a compliment whenever he lands on or passes her space (she gets a shy "Oh! Hi, Miss Suds…" and a "Why, thank you, Benny!" when she passes him), cheers her on every third turn of hers, gives her the biggest slice when HE lands on Teatime Cake (+1 extra shard for her), apologises if he has to send her to the bridge, and when he catches Grabble with 2+ loot he hands her one shard ("That one's for you, Miss Suds!"). Bot-Benny never picks her for a launch or a fetch when there is another choice. On the board: subtitle in his voice, an "AWW!" sound word, floating hearts over his pawn. Event: `flirt { key, text, bennyId, missId, reply? }`.
- **Live mini-game window.** While a phone plays a mini-game, it streams ~8 JPEG frames per second of its game canvas (`player:miniFrame`); the server relays them to the board only, and the board shows them in the mini-game window (hero, title, live picture, progress bar, countdown). Bots have no phone, so the window shows a placeholder while they "play".
- **Flight rings are 3D hoops**: each ring is drawn as a back half behind the bird and a front half in front, with a pass-through pop and sparkle, so the bird visibly flies through.

## 5. Pacing and balance targets

`winTarget` 12 (was 6), `grabbleTarget` 7, 8 Launch spaces, Grabble moves 1d4 (2–3 players), 1d3 (4–5) or 1d2 (6) per player turn. Targets for a 4-player game (bot simulation with real durations estimated): 20–30 minutes, ≥6 Catcher launches, Grabble wins 10–20 % of games, every player sees ≥4 mini-games. `tests/sim.mjs` reports these; tune `GRABBLE_TARGET_DEFAULT`, his dice, and loot rules until the targets hold.

## 6. Round-1 grader fixes folded into v2 (all must land)

1. Event payload collision (`space.type` overwrote the event type) → events are built as `{ ...data, id, type }` and the space field is `spaceType`. Regression test.
2. Win: decided at end of turn from live shard counts (ties: current player, then most shards); "almost win" voice line generic ("Just one more shard…"); host hand-off when the host disconnects.
3. Catcher payoff: no dead air after the bell tap; caught/missed narration right after the basket; no double "I'm stuck"; shard flies out of the basket; missed pawns hop; `pup_woof` is an sfx; unused clips wired (kyah_catch on chase start, kyah_gotit on chase win, ayva_wedidit on win, grabble_mine on Grabble win, grabble_pride when caught, kind_2 on cobble, shard_fly, camera_whoosh on camera glides, timer_tick on the last 3 s of a mini-game, ui_tap/ui_join).
4. Win celebration: camera to the castle pedestal, shards fly in and assemble the gem, flower lock + musical key, THEN the card (lower third), one "WE DID IT!".
5. Pawns 30 % bigger, labels readable and depth-tested, labels hidden during launches.
6. HUD in viewport units; subtitles never cover the front row; lobby chips don't shift; backdrop seam fixed; dice/QR refresh; banner grammar.
7. Phone: inputs never wait behind narration (turn_roll narrate is fire-and-forget); countdowns on pick/bell/mini-game; phone assets ≤ 2 MB (256 px faces), board textures ≤ 40 MB (512 px icons/words, 1024 heroes).
