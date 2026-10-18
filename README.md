# Kyah & Ayva: Starlight Gem Chase

A Mouse Trap–style party board game for kids, themed on *Kyah and Ayva and the Starlight Gem*. The 3D board runs on a laptop; players scan a QR code and play from their phones on the same Wi-Fi. The centerpiece is the **Starlight Catcher**, a Rube Goldberg contraption built from the book's magic.

## Run it

```bash
npm install
npm start
```

Then open **http://localhost:3000/board/** on the laptop (full-screen it, sound on) and tap *Tap to begin*. Phones scan the QR code on the screen, or type the address shown. The first phone to join is the host and starts the game at 2+ players. Up to 6 players.

Environment (`.env`): `PORT` (default 3000), `WIN_TARGET` (default 10; use 6 for a short game), `GRABBLE_TARGET` (default 10). API keys are only needed to regenerate assets.

## How to play (short)

Roll and scurry along the winding path through the village, collecting **Starlight Shards**. Special spaces start a quick **mini-game on your phone**: flap through flower rings on a Fairy Flight, find the twinkling flower, slide Charli to catch shards, dodge Grabble's net, catch strawberries for the cake. **Grabble** the gem snatcher scurries around after every turn, snatching shards into his loot bag; catch up with him for a Vine Grab, or land on **Launch the Catcher** to send a friend (or Grabble!) to the Bridge, ring the bell, and watch the Starlight Catcher run its chain reaction around the whole village. **Ten shards** make the Gem whole and win. If Grabble fills his bag first, everyone loses. Full rules: `docs/game-design-v2.md` (v1 base in `docs/game-design.md`).

## Project map

- `server/` — Express + Socket.IO server and the rules engine (`game.js`).
- `public/board/` — laptop display: Three.js scene (`village.js`, `contraption.js`), pawns, HUD, audio, `main.js` orchestrator, `layout.js` (space positions, the shared source of truth).
- `public/play/` — phone controller.
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
