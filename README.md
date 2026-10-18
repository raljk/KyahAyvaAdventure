# Kyah & Ayva: Starlight Gem Chase

A Mouse Trap–style party board game for kids, themed on *Kyah and Ayva and the Starlight Gem*. The 3D board runs on a laptop; players scan a QR code and play from their phones on the same Wi-Fi. The centerpiece is the **Starlight Catcher**, a Rube Goldberg contraption built from the book's magic.

## Run it

```bash
npm install
npm start
```

Then open **http://localhost:3000/board/** on the laptop (full-screen it, sound on) and tap *Tap to begin*. Phones scan the QR code on the screen, or type the address shown. The first phone to join is the host and starts the game at 2+ players. Up to 6 players.

Environment (`.env`): `PORT` (default 3000), `WIN_TARGET` (default 10; use 6 for a short game), `GRABBLE_TARGET` (default 10). API keys are only needed to regenerate assets.

## Host it online (a permanent public link)

The server handles many games at once: every board that opens gets its own 4-letter room, and its QR code points phones at that room. Nothing runs on your laptop; the board is just a browser tab on any computer or TV.

**Render (free, one click):** [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/raljk/KyahAyvaAdventure)
Sign in with GitHub, confirm, and Render builds the `Dockerfile` and gives you `https://<name>.onrender.com`. Open `/board/` on the big screen. The free plan sleeps after about 15 minutes with no visitors, so the first load after a break takes about a minute.

Live now: **https://kyah-ayva-starlight-gem-chase.onrender.com/board/**. A service created from the repo link does not redeploy on push: after pushing to `main`, open the service in Render and choose **Manual Deploy → Deploy latest commit** (or connect the GitHub repo under Settings → Build & Deploy to make it automatic). A redeploy ends games in progress.

**Google Cloud Run (or any Docker host):**

```bash
gcloud run deploy kyah-ayva --source . --region australia-southeast1 --allow-unauthenticated --max-instances 1 --session-affinity --timeout 3600
```

Keep it at one instance: game state lives in memory. Restarts or redeploys end games in progress.

Settings (environment variables): `WIN_TARGET` (default 12), `GRABBLE_TARGET` (7, plus 2 per player above four), `AUTO_CLOSE_MINUTES` (3), `PUBLIC_URL` (only if the site is reached through another domain), `DEV_TOKEN` (enables the `/api/dev/*` test helpers remotely with an `x-dev-token` header; otherwise they only work on the machine itself), `MAX_ROOMS` (300), `ROOM_IDLE_MINUTES` (120).

A board reload keeps its room; add `?new=1` to the board address to start a fresh room.

## Play over the internet from this laptop (temporary link)

```bash
npm run share
```

This starts the game and a free Cloudflare quick tunnel (no account needed; install once with `brew install cloudflared`). It prints a public `https://….trycloudflare.com/play/?room=XXXX` link and the QR code on the board switches to it, so players can join from any network, including mobile data. Open the board on the laptop at the `localhost` address it prints. Notes:

- The link changes every time you run it; share the new one (or let people scan the board).
- A brand-new link can take up to a minute before some networks can resolve it.
- Only the laptop drives the game: dev endpoints and the board role are refused through the public link, and a board opened through it only watches.
- For a permanent address, run the server anywhere with a fixed URL and set `PUBLIC_URL=https://your.domain npm start` so the QR code uses it.

## How to play (short)

Roll and scurry along the winding path through the village, collecting **Starlight Shards**. Special spaces start a quick **mini-game on your phone**: flap through flower rings on a Fairy Flight, find the twinkling flower, slide Charli to catch shards, dodge Grabble's net, catch strawberries for the cake. **Grabble** the gem snatcher scurries around after every turn, snatching shards into his loot bag; catch up with him for a Vine Grab, or land on **Launch the Catcher** to send a friend (or Grabble!) to the Bridge, ring the bell, and watch the Starlight Catcher run its chain reaction around the whole village. **Twelve shards** make the Gem whole and win. If Grabble fills his bag first, everyone loses.

Difficulty follows the hero: Miss Suds and Benny get the hardest mini-games, Kyah the middle, Ayva the gentlest, and Charli or Poodle a surprise each time. Launching the Catcher as a grown-up means ringing the bell at every section of the machine as it runs; miss one and it fizzles. A perfect ring earns a bonus shard. The host phone can end the game or close the room; finished rooms close themselves after a few minutes. Full rules: `docs/game-design-v2.md` (v1 base in `docs/game-design.md`).

## Play-test checklist

1. Laptop and phones on the same Wi-Fi. `npm start`, open the board, full-screen it, tap *Tap to begin* (sound on).
2. Each player scans the QR code (or types the address), enters a name, picks a hero. Up to 6: Kyah, Ayva, Charli, Poodle, Miss Suds, Benny. The first phone is the host and starts at 2+ players.
3. Things to watch: the mini-games on the phone and their live window on the big screen; Grabble scurrying after every turn; the Starlight Catcher's tour when someone launches it; Benny and Miss Suds in the same game.
4. If a phone reloads or drops, it rejoins automatically. If the board is reloaded mid-game, tap *Tap to begin* again and play resumes.
5. Short game for testing: `WIN_TARGET=6 npm start`.

## Project map

- `server/` — Express + Socket.IO server and the rules engine (`game.js`).
- `public/board/` — laptop display: Three.js scene (`village.js`, `contraption.js`), pawns, HUD, audio, `main.js` orchestrator, `layout.js` (space positions, the shared source of truth).
- `public/play/` — phone controller and the seven mini-games (`minigames.js`).
- `public/assets/` — generated images and audio plus their manifests.
- `tools/` — asset generation scripts (OpenAI images, ElevenLabs voice/SFX/music, procedural fallbacks) and a static preview server.
- `docs/` — design doc, protocol, grader reports.
- `research/` — the Mouse Trap study the design is based on.

## Dev helpers

- `POST /api/dev/bots?n=3` add bots · `POST /api/dev/start` start · `POST /api/dev/fast` run with no animation waits · `POST /api/dev/reset`
- Board URL flags: `?auto=1` skips the splash (no audio until a click).
- `node tools/static-server.mjs 8101` serves `public/` plus vendor paths for the standalone test pages `board/test-village.html`, `board/test-contraption.html`, `play/?mock=1`.
- `npm test` runs the rules engine tests; `node tests/sim.mjs 100 4` simulates 100 four-player bot games and reports pacing.
- `POST /api/dev/launch?caught=1&target=grabble` forces a Catcher launch; `POST /api/dev/mini?score=5` resolves the running mini-game.

## Regenerating assets

`node tools/gen-images.mjs` and `node tools/gen-audio.mjs` are idempotent: they only create files that are missing. Keys live in `.env` (never commit it).
