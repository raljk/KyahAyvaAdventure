# Kyah & Ayva: Starlight Gem Chase — Game Design Document

A Mouse Trap–style party board game for ages 5+, themed on the graphic novel *Kyah and Ayva and the Starlight Gem*. The board lives on a laptop screen (3D, Three.js). Players join by scanning a QR code with their phone and play from the phone. The centerpiece is a 3D Rube Goldberg contraption, **the Starlight Catcher**, built from the book's own magic.

Design basis: `research/mouse-trap-notes.md` (the 2016 Hasbro edition rules plus the takeaways section).

---

## 1. The book in one page (source of truth for theme)

**Characters**
- **Kyah** — fairy, long straight black hair, a blue forget-me-not flower tucked above her ear, cream dress covered in small blue flowers, translucent pale-blue wings. Power: **flower magic**. Vines and blue flowers grow anywhere ("BLOOM!"). Her vines catch things.
- **Ayva** — fairy, black hair with white/silver streaks, white headband with a pink bow/feather, cream dress printed with colorful music notes, a sash, translucent pink-lavender wings. Power: **music magic**. Her songs lift things ("LA-LA!", "DING!").
- **Charli** (the puppy) — small fluffy golden puppy (doodle), blue collar with a bone tag. Brave, bouncy, says "WOOF!"
- **Poodle** — fluffy white poodle with a pink collar, lives at the pet wash.
- **Grabble** — green goblin, big nose, black mustache, pointy ears, purple top hat with a red feather, long purple coat with brass buttons, yellow-and-brown striped scarf, brown boots, carries a butterfly net. "He loved taking things. Especially shiny things!" He steals the gem, gets caught in a flower basket ("I'm... stuck!"), then reforms and mops the pet wash ("Power can help people, too").
- **Miss Suds** (our name; unnamed in the book) — the kind pet-wash owner, brown curly hair, teal apron.

**Places** (one village, all on a hill below a blue-roofed castle)
- **The Castle** — white stone, many blue conical roofs, on a hill with a waterfall. The gem's home. A pedestal with a flower lock and musical key.
- **Sunbeam Bakery** — pink-and-white striped awning, warm wood front, bread and cakes in the window, chalkboard "Fresh Buns, Brighter Days!"
- **Puddle Paws Pet Wash** — pale blue shopfront, bubbles everywhere, paw prints, chalkboard "Clean Pets, Happier Hearts". Inside: tubs, a tipped bucket, a rubber duck, shelves of bottles.
- **The Stone Bridge** — arched cobblestone bridge over a sparkling river, flower vines growing along it. Where Grabble gets caught.
- **Cobblestone streets**, lampposts with heart banners, pink bunting, flower boxes of blue forget-me-nots and pink blossoms, chalkboard signs with kind slogans.

**Sound words** (the book's lettering style: chunky rounded letters, pastel fills, dark outline): TING! SHIMMER! BLOOM! LA-LA! SWISH! BUMP! FWOOP! WOOF! HOP! DING! WHOOSH! HUM...

**Slogans**: "Small kindness, brighter days", "Kind hearts, brighter tomorrows", "Dream brighter together", "Teamwork... and then cake!"

**Palette** (watercolor, pastel, ink outlines):
periwinkle `#6E8FE0`, lavender `#B48BE0`, blossom pink `#F29BC8`, cream `#FFF6E0`, mint `#A8E0B8`, golden `#F2C14E`, sky `#BFE3F5`, warm stone `#C9B9A3`, wood `#8B5E3C`, castle-roof blue `#3E6FD6`, forget-me-not `#5B8DEF`, goblin green `#7FB069`, Grabble purple `#5E3A8C`, ink `#2B2440`.

---

## 2. Core loop (one sentence)

Roll, scurry around the village collecting **Starlight Shards**, send friends under the **Starlight Catcher** to shake a shard loose, and be the first to collect **six shards** to make the Starlight Gem whole and bring it home to the castle.

---

## 3. Players and heroes

2–6 players. Each picks a hero (one per player):

| id | Hero | Token color | Flavor |
|---|---|---|---|
| `kyah` | Kyah | `#5B8DEF` blue | Flower fairy |
| `ayva` | Ayva | `#E86BB5` pink | Music fairy |
| `pup` | Charli | `#F2B544` golden | Brave puppy |
| `poodle` | Poodle | `#A8E0B8` mint | Fluffy pet-wash poodle |
| `grabble` | Grabble (reformed, holding a mop) | `#7B4FB5` purple | "Power can help people, too" |
| `misssuds` | Miss Suds | `#4FB5A3` teal | Pet-wash owner |

Turn order is join order. The first phone to join is the **host** and gets the Start button.

---

## 4. The board

A single loop of **28 spaces** around the village. Positions are defined in `public/board/layout.js` (the one shared source of truth). Space index 0 is the Castle at the back of the scene; the Bridge (index 10) is front-right where the camera can see the Catcher.

| idx | type | name |
|---|---|---|
| 0 | `castle` | The Castle (Start). Lap bonus. |
| 1 | `shard` | Starlight Shard |
| 2 | `cobble` | Cobblestones |
| 3 | `fetch` | Charli Fetch |
| 4 | `shard` | Starlight Shard |
| 5 | `flight_a` | Fairy Flight (blue lamppost) ↔ 22 |
| 6 | `swish` | Grabble Swish |
| 7 | `launch` | Launch the Catcher |
| 8 | `cobble` | Cobblestones |
| 9 | `shard` | Starlight Shard |
| 10 | `bridge` | The Bridge (under the Catcher) |
| 11 | `shard` | Starlight Shard |
| 12 | `cake` | Teatime Cake |
| 13 | `cobble` | Cobblestones |
| 14 | `swish` | Grabble Swish |
| 15 | `fetch` | Charli Fetch |
| 16 | `shard` | Starlight Shard |
| 17 | `launch` | Launch the Catcher |
| 18 | `flight_b` | Fairy Flight (pink lamppost) ↔ 27 |
| 19 | `cobble` | Cobblestones |
| 20 | `shard` | Starlight Shard |
| 21 | `swish` | Grabble Swish |
| 22 | `flight_a` | Fairy Flight (blue lamppost) ↔ 5 |
| 23 | `launch` | Launch the Catcher |
| 24 | `shard` | Starlight Shard |
| 25 | `fetch` | Charli Fetch |
| 26 | `cobble` | Cobblestones |
| 27 | `flight_b` | Fairy Flight (pink lamppost) ↔ 18 |

Counts: 7 shard, 3 launch, 3 swish, 3 fetch, 4 flight (2 pairs), 5 cobble, 1 cake, 1 bridge, 1 castle.

### Space effects
- **Starlight Shard** (`shard`, yellow star): +1 shard. "TING!"
- **Grabble Swish** (`swish`, purple net): −1 shard (returns to the sky). If you have none, nothing happens. "SWISH!"
- **Charli Fetch** (`fetch`, golden paw): choose another player; Charli fetches 1 shard from them to you. If nobody has shards, take 1 from the sky instead. "WOOF!"
- **Launch the Catcher** (`launch`, blue bell): choose **any other player** and send them to the Bridge, then play the timing mini-game and launch the Catcher. See §6.
- **The Bridge** (`bridge`): landing here by exact count: you stop. The Catcher does not fire. You stay exposed until your next move. Several players may stand on the Bridge at once.
- **Fairy Flight** (`flight_a` / `flight_b`): optional. Fly to the matching lamppost on the other side of the village. The landing spot's effect does not trigger. "WHOOSH!"
- **Teatime Cake** (`cake`): everyone gets +1 shard. "Teamwork... and then cake!"
- **Cobblestones** (`cobble`): nothing. The narrator says something kind.
- **The Castle** (`castle`): start space. The **first time each player completes a lap** (passes or lands on the Castle), they get **+2 shards**. "Home to the castle!"

### Movement rules
- Roll one d6, move clockwise (index increasing, wrapping at 28).
- **Bump rule**: if the landing space is already occupied by another player, move forward to the next unoccupied space and resolve *that* space. The Castle and the Bridge may hold any number of players.
- Shards come from an unlimited "sky" pile. No scarcity.

### Win
The moment a player has **6 shards**, the Starlight Gem assembles on the castle pedestal (flower lock + musical key animation) and they win. Configurable `winTarget` (4 for a short game, 6 default).

### Pacing math (4 players)
~2 shards per lap from shard spaces, +0.9 from fetch, +0.6 from launches, −0.9 from swish, −~0.5 from being launched at ⇒ roughly +2 net per lap ⇒ a win around lap 3 ⇒ ~20 turns per player ⇒ about 20–25 minutes including ~8 Catcher launches at ~20 s each.

---

## 5. Phone controller (what each player sees)

1. **Join** — enter name, pick a hero (taken heroes greyed out), Join.
2. **Lobby** — "You're in! Look at the big screen." Host sees **Start Game** (enabled at 2+ players).
3. **Waiting** — current player's name and hero, your shard ring (0–6), the last event in big friendly text with the sound word.
4. **Your turn** — a huge **ROLL** button. Shake-to-roll also works (DeviceMotion). The phone vibrates when your turn starts.
5. **Pick a friend** — big hero cards to tap (for Charli Fetch and Launch). Shows each friend's shard count.
6. **Ring the bell!** — timing mini-game for the Catcher: a star slides back and forth across a bar; tap when it's in the glowing zone. Sweet zone is 45% of the bar, perfect zone 10%. Then "Watch the big screen!"
7. **Fairy Flight?** — "Fly across the village?" Yes / No, 10 s timeout defaults to No.
8. **Win** — confetti, "We did it!", Play Again (host).

Phones never show the 3D scene; they are controllers plus a tiny status card. Must work in Safari iOS and Chrome Android on the same Wi-Fi, no internet needed.

---

## 6. The Starlight Catcher (the Rube Goldberg contraption)

Sits over the Bridge (space 10). Built from scenes in the book. Procedural Three.js geometry, scripted (deterministic) animation with GSAP, ~16 seconds, every stage emits an event so sound effects fire in sync. Caught or missed is decided by the server before the animation starts; the animation shows the result at the last stage.

| # | stage id | what happens | sound word | SFX key |
|---|---|---|---|---|
| 1 | `bell` | The launcher "rings the bell": Ayva's little golden bell on the lamppost swings and chimes. | DING! | `bell_ding` |
| 2 | `net` | The bell's rope tugs Grabble's butterfly net off its hook; it swings down like a pendulum… | SWISH! | `net_swing` |
| 3 | `bucket` | …and bumps the Puddle Paws bucket at the top of the bakery stairs. It tips. | BUMP! | `bucket_bump` |
| 4 | `apple` | A big red apple (from the bakery basket) rolls out and bounces down the crooked stairs. | — | `apple_roll_stairs` |
| 5 | `vine` | It lands in a curling vine gutter; Kyah's flower magic BLOOMS, the vine curls up and lifts the apple high… | BLOOM! | `vine_bloom` |
| 6 | `tub` | …and drops it into the pet-wash tub. Splash, bubbles everywhere. | SPLASH! | `tub_splash_bubbles` |
| 7 | `pipe` | The apple rattles down the drain pipe and out onto a seesaw. | — | `pipe_rattle` |
| 8 | `pup` | The seesaw flips: Charli, waiting on the other end, cannonballs into the washtub. | BOING! FWOOP! | `seesaw_boing`, `dog_splash` |
| 9 | `music` | The splash knocks the music stand; Ayva's music notes swirl up the staff pole… | LA-LA! | `music_rise` |
| 10 | `basket` | …and the big flower-vine basket hanging from the bridge lamppost swings down over the Bridge. | WHOOSH! | `basket_whoosh_drop` |
| 11a | `caught` | Basket closes over the pawn(s), vines wrap, lifts a little. "I'm... stuck!" Shard pops out with sparkle and flies to the launcher. | STUCK! | `caught_stuck` |
| 11b | `missed` | Basket wobbles wide, pawn hops aside. "HOP! Missed me!" | HOP! | `missed_hop` |

**Reset**: after every launch the Catcher resets itself with a quick reverse animation (the bucket rights itself, the apple floats back up, Charli shakes off and trots back onto the seesaw). The reset is a tiny bit of charm, not a chore.

**Launch timing mini-game** (on the launcher's phone): star sweeps 0→1→0 over 1.6 s continuously; tap. `score` in [0,1]. Sweet zone [0.30, 0.75] = caught. Perfect [0.48, 0.58] = caught + "Perfect!" sparkle burst. Outside = missed. Bots and timeouts: server samples a score that catches ~75% of the time. Expected human catch rate ~70–80%, which keeps the "will it work?" tension without the real toy's frustration.

**Camera**: on launch, the board camera glides from the overview to the Catcher close-up, follows the action (apple, Charli, basket), then returns.

---

## 7. Visual style guide (board + phone)

- Everything looks like the book: soft watercolor fills, clean dark-ink outlines, pastel palette (§1), rounded shapes, tons of flowers.
- 3D scene is a **storybook diorama**: toy-like proportions, chunky buildings, flat-shaded pastel materials with subtle gradients, soft shadows, warm late-afternoon light, gentle bloom on the gem and shards, floating sparkles, drifting bubbles near the pet wash, petals in the air.
- Pawns: 3D disc base in the hero's color with the hero's painted portrait as a billboard sprite above it (always faces camera), slight idle bob. Clear from 3 m away on a laptop.
- Space tiles: rounded cobblestone discs; each special space has an icon decal and a soft colored glow matching its type (shard yellow, launch blue, swish purple, fetch gold, flight blue/pink, cake pink, bridge stone).
- HUD: watercolor paper panels, Fredoka/Baloo 2 rounded fonts (vendored locally), comic sound-word pop-ups that scale in with a bounce, narrator subtitles at the bottom, player cards on the left with shard rings, dice in the corner, QR card during the lobby.
- Phone: same palette; everything is a big tappable card; one action per screen; haptics.

---

## 8. Audio design

### Narrator (ElevenLabs TTS, one warm storyteller voice, gentle, a little playful)
Key → line. The board shows the player's name on screen; lines avoid names.

```
intro_lobby        | Welcome to the village! Scan the code with your phone to join the adventure.
player_joined      | A new friend has arrived!
game_start         | Grabble has scattered the Starlight Gem into shards all over the village! Collect six shards to make it whole again. Ready... go!
turn_roll          | Your turn! Roll the dice!
turn_nudge         | Hello? It's your turn! Give the dice a roll.
dice_1             | One!
dice_2             | Two!
dice_3             | Three!
dice_4             | Four!
dice_5             | Five!
dice_6             | Six!
space_shard        | Ting! A starlight shard, glowing under the flowers!
space_shard_alt    | Look under the flowers! A shard!
space_swish        | Swish! Grabble snatched a shard! Hey, that isn't yours!
space_swish_empty  | Swish! Grabble's net came up empty. Nothing to snatch!
space_fetch_choose | Charli wants to fetch! Pick a friend.
space_fetch        | Woof! Charli fetched a shard from a friend!
space_fetch_sky    | Woof! Nobody had a shard, so Charli found one in the sky!
space_cake         | Teatime! Cake for everyone! Everybody gets a shard.
space_cobble       | Flying takes practice. So does landing!
space_cobble_alt   | A quiet cobblestone. Nothing here but flowers.
space_cobble_alt2  | Small kindness, brighter days.
space_flight_offer | A fairy flight! Would you like to fly across the village?
space_flight_go    | Whoosh! Up and over the rooftops!
space_flight_stay  | Staying put. Maybe next time!
space_bridge_land  | You landed on the bridge. Careful, the Catcher is right above you!
launch_choose      | Time to launch the Catcher! Who will you send to the bridge?
launch_sent        | Off to the bridge they go!
launch_ready       | Ring the bell when the star glows brightest!
launch_go          | Ready... sing!
launch_caught      | Caught in the flower basket! I'm stuck! Hand over a shard!
launch_caught_many | Everyone on the bridge is caught! A shard from each of them!
launch_caught_empty| Caught! But their pockets are empty. No shards to give.
launch_perfect     | Perfect ring! The whole village heard that bell!
launch_missed      | Hop! Missed me! The basket swung wide.
lap_bonus          | Home to the castle! Two bonus shards for making it all the way around!
almost_win         | Five shards! Just one more to make the Starlight Gem whole!
win                | The Starlight Gem is whole again! A flower lock, with a musical key. We did it... together!
win_cake           | Teamwork... and then cake!
rejoin             | Welcome back!
kind_1             | Kind hearts, brighter tomorrows!
kind_2             | Dream brighter together!
```

### Character lines (ElevenLabs TTS, distinct voices)
```
kyah_bloom         | Kyah    | Bloom!
kyah_catch         | Kyah    | Flowers, catch him!
kyah_gotit         | Kyah    | Got it!
kyah_together      | Kyah    | We'll protect it. Together!
ayva_lala          | Ayva    | La-la-la!
ayva_ding          | Ayva    | Ding!
ayva_lift          | Ayva    | Music, lift the gem!
ayva_wedidit       | Ayva    | We did it!
grabble_mine       | Grabble | That gem will be mine!
grabble_shiny      | Grabble | Especially shiny things!
grabble_missed     | Grabble | Missed me!
grabble_stuck      | Grabble | I'm... stuck!
grabble_pride      | Grabble | Only my pride is a bit squashed.
```
Voices: Kyah gentle and warm (young), Ayva bright and bubbly (young), Grabble gravelly comic baritone, narrator warm storyteller. Pick from ElevenLabs premade voices; do not clone anyone.

### Sound effects (ElevenLabs sound generation, short, cartoon-friendly)
```
ui_tap, ui_join, dice_roll, dice_land, pawn_hop, shard_ting, swish_net, pup_woof,
cake_party, flight_whoosh, bridge_land, bell_ding, net_swing, bucket_bump,
apple_roll_stairs, vine_bloom, tub_splash_bubbles, pipe_rattle, seesaw_boing,
dog_splash, music_rise, basket_whoosh_drop, caught_stuck, missed_hop,
lap_fanfare, almost_win_sparkle, win_fanfare, gem_assemble, timer_tick, confetti,
shard_fly, camera_whoosh
```

### Music
```
music_lobby    | 45–60 s loop | gentle music box + soft strings, dreamy, storybook
music_play     | 60–90 s loop | bright whimsical village, pizzicato, flute, glockenspiel, light percussion
music_catcher  | 16–20 s      | playful rising tension, ticking, builds to a big sparkly hit
music_victory  | 20–30 s      | joyful celebration, bells, choir "ah", cake-party feel
music_sting_grabble | 3 s     | mischievous sneaky sting
```
Budget note: the ElevenLabs account has limited characters this cycle. Priority: narrator → character lines → the 12 Catcher SFX → music_play & music_catcher → the rest. Anything that can't be generated gets a procedural fallback (see `tools/synth-fallback.mjs`) so the manifest is always complete.

---

## 9. Image assets (OpenAI gpt-image-1, book style)

All saved under `public/assets/images/` and indexed in `public/assets/images/manifest.json`.

| key | file | size | notes |
|---|---|---|---|
| `hero_kyah` … `hero_misssuds` | `heroes/<id>.png` | 1024×1536, transparent | full-body, front, smiling, book style |
| `hero_<id>_face` | `heroes/<id>_face.png` | 1024×1024, transparent | round portrait for phone cards and HUD |
| `npc_grabble_net` | `npc/grabble_net.png` | 1024×1536, transparent | Grabble mid-run with net (for Swish pop-up) |
| `gem_full`, `gem_shard` | `gem/*.png` | 1024, transparent | crystal, blue→pink glow |
| `icon_shard`, `icon_swish`, `icon_fetch`, `icon_launch`, `icon_bridge`, `icon_flight_a`, `icon_flight_b`, `icon_cake`, `icon_castle`, `icon_cobble` | `icons/*.png` | 1024, transparent | flat sticker icons, thick outline |
| `logo_title` | `ui/logo.png` | 1536×1024, transparent | "Kyah & Ayva — Starlight Gem Chase" lettering like the book cover |
| `backdrop_panorama` | `scene/backdrop.png` | 1536×1024 | castle on the hill, waterfall, sky, for the scene background |
| `board_ground` | `scene/ground.png` | 2048×2048 (1024 ok) | top-down painted village ground: grass, flower beds, cobble path hint, river |
| `tex_cobble`, `tex_grass`, `tex_wood`, `tex_stone`, `tex_roof_blue`, `tex_vine`, `tex_paper` | `textures/*.png` | 1024, tileable | seamless material textures |
| `ui_paper_panel`, `ui_button`, `phone_bg` | `ui/*.png` | varies | watercolor UI chrome |
| `sfx_word_<WORD>` | `words/<word>.png` | 1024×512, transparent | comic lettering: TING, BLOOM, DING, SWISH, BUMP, WOOF, HOP, WHOOSH, SPLASH, BOING, LA-LA, STUCK, CAKE |

Style prompt base (reuse for every image): *"Children's picture-book watercolor illustration with clean dark ink outlines, soft pastel palette (periwinkle blue, lavender, blossom pink, cream, mint), rounded friendly shapes, gentle paper texture, no text unless specified."* Use page crops from the PDF as reference images via the edits endpoint for character consistency.

---

## 10. Non-goals for v1
- No accounts, no internet, no persistence beyond the running session.
- No physics simulation in the contraption (scripted for reliability — the real game's biggest flaw).
- No player-vs-player trading or negotiation.
