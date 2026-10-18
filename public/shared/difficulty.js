// Difficulty by hero (play-test feedback, 2026-10-18). Shared by the server (scoring) and the phone (building each game).
// Grown-ups (Miss Suds, Benny) = hard · Kyah = medium · Ayva = easy (the original tuning) · dogs (Charli, Poodle) = random per mini-game.
export const TIERS = {
  easy:   { id: 'easy',   label: 'Sprout',    stars: 1 },
  medium: { id: 'medium', label: 'Bloom',     stars: 2 },
  hard:   { id: 'hard',   label: 'Starlight', stars: 3 },
};
const HERO_TIER = { misssuds: 'hard', baker: 'hard', kyah: 'medium', ayva: 'easy' };
export const RANDOM_TIER_HEROES = ['pup', 'poodle'];
export function tierFor(heroId, rand = Math.random) {
  if (HERO_TIER[heroId]) return HERO_TIER[heroId];
  const ids = Object.keys(TIERS); return ids[Math.floor(rand() * ids.length)];
}

// Per mini-game, per tier. `max` is the best possible score; the server's outcome rules below use it.
export const MINI = {
  flight: { // tap to flap through flower hoops; longer flights and bigger height changes as it gets harder
    easy:   { duration: 12, rings: 8,  heightVar: 0.15, gap: 1.00, speed: 1.00 },
    medium: { duration: 16, rings: 11, heightVar: 0.35, gap: 0.92, speed: 1.05 },
    hard:   { duration: 20, rings: 14, heightVar: 0.60, gap: 0.82, speed: 1.12 },
  },
  shard: { // tap the flower hiding the real shard; decoys are Grabble's fake shards — tapping one fails the game
    easy:   { rounds: 7,  window: 1.60, decoyChance: 0,    decoys: 0 },
    medium: { rounds: 8,  window: 1.15, decoyChance: 0.35, decoys: 1 },
    hard:   { rounds: 10, window: 0.85, decoyChance: 0.6,  decoys: 2 },
  },
  fetch: { // slide Charli to catch falling shards; longer and speeding up for Kyah and the grown-ups
    easy:   { duration: 8,  shards: 3, buckets: 2, accel: 0,   catchWidth: 1.00 },
    medium: { duration: 16, shards: 7, buckets: 5, accel: 0.7, catchWidth: 0.75 },
    hard:   { duration: 16, shards: 7, buckets: 5, accel: 0.7, catchWidth: 0.75 },
  },
  swish: { // hop when the net glows; feints are glints that are not real swoops (hopping on one costs the dodge)
    easy:   { swoops: 3, window: 0.90, feints: 0 },
    medium: { swoops: 4, window: 0.70, feints: 1 },
    hard:   { swoops: 5, window: 0.55, feints: 2 },
  },
  cake: { // tap strawberries onto the cake; Grabble's mouldy berries take a point away
    easy:   { duration: 6.6, berries: 10, speed: 1.00, rotten: 0 },
    medium: { duration: 8,   berries: 13, speed: 1.25, rotten: 2 },
    hard:   { duration: 10,  berries: 16, speed: 1.50, rotten: 4 },
  },
  chase: { // hold to grow the vine, release in the glow
    easy:   { zone: [0.45, 0.80], perfect: [0.60, 0.68],  speed: 1.00, wobble: 0 },
    medium: { zone: [0.52, 0.74], perfect: [0.61, 0.66],  speed: 1.15, wobble: 0.15 },
    hard:   { zone: [0.56, 0.70], perfect: [0.62, 0.655], speed: 1.30, wobble: 0.30 },
  },
  bell: { // ring the bell in the green zone; harder tiers have a smaller zone and a star whose speed changes, and more gates
    easy:   { zone: [0.30, 0.75], perfect: [0.48, 0.58],  period: 1.60, speedJitter: 0,    gates: [1, 1] },
    medium: { zone: [0.38, 0.66], perfect: [0.49, 0.565], period: 1.45, speedJitter: 0.18, gates: [2, 3] },
    hard:   { zone: [0.42, 0.60], perfect: [0.495, 0.545], period: 1.30, speedJitter: 0.35, gates: [4, 4] },
  },
};
export function maxScore(type, cfg) {
  switch (type) { case 'flight': return cfg.rings; case 'shard': return cfg.rounds; case 'fetch': return cfg.shards; case 'swish': return cfg.swoops; case 'cake': return cfg.berries; default: return 1; }
}

// The Catcher runs through four sections of the village; a gated launch pauses at each chosen section for another bell.
// Gate 0 is always the bell before the machine starts. Section `at` is the stage id the machine pauses just before.
export const CATCHER_SECTIONS = [
  { id: 'petwash', at: 'bell',  label: 'Puddle Paws Pet Wash' },
  { id: 'garden',  at: 'vine',  label: 'Flower Garden' },
  { id: 'castle',  at: 'drop',  label: 'Castle Gate' },
  { id: 'square',  at: 'pup',   label: 'Village Square' },
];
export function gatesFor(heroId, tier, rand = Math.random) {
  const n = RANDOM_TIER_HEROES.includes(heroId) ? 1 + Math.floor(rand() * 4) : (() => { const [a, b] = MINI.bell[tier].gates; return a + Math.floor(rand() * (b - a + 1)); })();
  const extra = CATCHER_SECTIONS.slice(1).map(s => s.id).sort(() => rand() - 0.5).slice(0, n - 1);
  return CATCHER_SECTIONS.filter(s => s.id === 'petwash' || extra.includes(s.id)); // in route order
}
