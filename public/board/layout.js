// Shared board layout v2: a winding path through the village (not a plain ellipse), with terrain heights,
// building anchors and the stage anchors of the Starlight Catcher machine that tours the whole loop.
// Single source of truth for server, board and phone.

export const SPACE_COUNT = 32;
export const WIN_TARGET_DEFAULT = 12;
export const GRABBLE_TARGET_DEFAULT = 7;
export const SCALE = { spaceRadius: 1.2, pawnHeight: 1.6 };

// ---------- terrain ----------
function bump(x, z, cx, cz, r, h) { const d = Math.hypot(x - cx, z - cz); if (d >= r) return 0; const t = 1 - d / r; return h * t * t * (3 - 2 * t); }
export function heightAt(x, z) {
  return bump(x, z, 0, -24, 17, 3.2)        // castle hill (back)
       + bump(x, z, -17, -7, 9, 1.3)         // garden knoll (left)
       + bump(x, z, 20, -2, 7, 0.5);         // bakery rise (right)
}

// ---------- the route (closed loop through the village) ----------
// Order of landmarks: Castle gate (start) → castle steps → Sunbeam Bakery street → village square (fountain)
// → Stone Bridge over the river (the basket) → riverside → Puddle Paws Pet Wash → flower garden → hill path home.
const WAYPOINTS = [
  [0, -17],     // castle gate (start)
  [4.5, -13.5], // castle steps
  [9, -11],     // top of bakery street
  [14.5, -9.5], // in front of the bakery
  [19, -6],     // bakery corner
  [20, 0],      // east lane
  [17.5, 5],    // into the square
  [12.5, 7.5],  // square, by the fountain
  [7, 9.5],     // bridge approach
  [2, 11],      // THE BRIDGE (river crossing)
  [-4, 12],     // riverside
  [-10, 12],    // pet wash yard
  [-15.5, 9.5], // pet wash corner
  [-19, 4.5],   // west lane
  [-19.5, -2],  // garden gate
  [-17.5, -8],  // flower garden (knoll)
  [-13.5, -12.5],// hill path
  [-8, -15.5],  // hill path up
  [-3.5, -17],  // castle gate approach
];

function catmull(p0, p1, p2, p3, t) { const t2 = t * t, t3 = t2 * t; return [
  0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
  0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]; }

// dense sampling of the closed spline, then equal arc-length spacing
const DENSE = []; const N = WAYPOINTS.length; const SUB = 60;
for (let i = 0; i < N; i++) { const p0 = WAYPOINTS[(i - 1 + N) % N], p1 = WAYPOINTS[i], p2 = WAYPOINTS[(i + 1) % N], p3 = WAYPOINTS[(i + 2) % N]; for (let s = 0; s < SUB; s++) DENSE.push(catmull(p0, p1, p2, p3, s / SUB)); }
const CUM = [0]; for (let i = 1; i <= DENSE.length; i++) { const a = DENSE[i - 1], b = DENSE[i % DENSE.length]; CUM.push(CUM[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
export const LOOP_LENGTH = CUM[DENSE.length];
export function pointAt(dist) { // world point on the route at arc distance d (wraps)
  let d = ((dist % LOOP_LENGTH) + LOOP_LENGTH) % LOOP_LENGTH; let i = 0; while (CUM[i + 1] < d) i++;
  const a = DENSE[i], b = DENSE[(i + 1) % DENSE.length]; const t = (d - CUM[i]) / Math.max(1e-6, CUM[i + 1] - CUM[i]);
  const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t; const nx = b[0] - a[0], nz = b[1] - a[1]; const l = Math.hypot(nx, nz) || 1;
  return { x, z, y: heightAt(x, z), dir: [nx / l, nz / l] };
}
export function routePoints(n) { const out = []; for (let i = 0; i < n; i++) out.push(pointAt((i / n) * LOOP_LENGTH)); return out; }

// ---------- spaces ----------
// Types laid along the loop; the bridge is wherever the route crosses the river (index computed below).
const TYPES = [
  'castle','shard','launch','fetch','shard','flight_a','swish','launch','launch','shard',
  'bridge','shard','cake','launch','swish','fetch','shard','launch','flight_b','launch',
  'shard','swish','flight_a','launch','shard','fetch','cobble','flight_b','shard','cobble','launch','shard',
];
const NAMES = { castle: 'The Castle', shard: 'Starlight Shard', cobble: 'Cobblestones', fetch: 'Charli Fetch', flight_a: 'Fairy Flight', flight_b: 'Fairy Flight', swish: 'Grabble Swish', launch: 'Launch the Catcher', bridge: 'The Bridge', cake: 'Teatime Cake' };
export const TYPE_COLORS = { castle: '#3E6FD6', shard: '#F2C14E', cobble: '#C9B9A3', fetch: '#E8923A', flight_a: '#5B8DEF', flight_b: '#F29BC8', swish: '#7B4FB5', launch: '#4FA3E8', bridge: '#A89F91', cake: '#FF8FB6' };
export const WORDS = { shard: 'TING!', swish: 'SWISH!', fetch: 'WOOF!', launch: 'DING!', bridge: 'UH-OH!', cake: 'CAKE!', flight_a: 'WHOOSH!', flight_b: 'WHOOSH!', cobble: '', castle: 'HOME!' };

const pts = routePoints(SPACE_COUNT);
const BRIDGE_WP = WAYPOINTS[9];
let bridgeIdx = 0, best = 1e9; pts.forEach((p, i) => { const d = Math.hypot(p.x - BRIDGE_WP[0], p.z - BRIDGE_WP[1]); if (d < best) { best = d; bridgeIdx = i; } });
const types = TYPES.slice(); const oldBridge = types.indexOf('bridge'); if (oldBridge !== bridgeIdx) { types[oldBridge] = types[bridgeIdx]; types[bridgeIdx] = 'bridge'; }

export const SPACES = types.map((type, index) => { const p = pts[index]; return { index, type, name: NAMES[type], pos: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)], dir: [+p.dir[0].toFixed(4), +p.dir[1].toFixed(4)], dist: +((index / SPACE_COUNT) * LOOP_LENGTH).toFixed(3), color: TYPE_COLORS[type], word: WORDS[type] }; });
export const CASTLE_INDEX = 0;
export const BRIDGE_INDEX = bridgeIdx;
export const BRIDGE_POS = SPACES[BRIDGE_INDEX].pos;
const flightsA = SPACES.filter(s => s.type === 'flight_a').map(s => s.index), flightsB = SPACES.filter(s => s.type === 'flight_b').map(s => s.index);
export const FLIGHT_PAIRS = { [flightsA[0]]: flightsA[1], [flightsA[1]]: flightsA[0], [flightsB[0]]: flightsB[1], [flightsB[1]]: flightsB[0] };
export const GRABBLE_START = SPACES.reduce((b, s) => (Math.hypot(s.pos[0] + 17.5, s.pos[2] + 8) < Math.hypot(SPACES[b].pos[0] + 17.5, SPACES[b].pos[2] + 8) ? s.index : b), 0); // the flower garden, opposite the bridge

// ---------- landmarks for the village module ----------
export const LANDMARKS = {
  castle:   { pos: [0, heightAt(0, -24), -25], facing: 0 },
  bakery:   { pos: [17.86, heightAt(17.86, -13.66), -13.66], facing: Math.PI }, // faces the street (toward +z)
  petwash:  { pos: [-8.6, 0, 3.1], facing: -0.36 },                            // inside the loop; the net/bucket/tub stages form its front yard
  fountain: { pos: [10.26, 0, 2.45], facing: 0 },
  bridge:   { pos: BRIDGE_POS, dir: SPACES[BRIDGE_INDEX].dir },
  river:    [[0, -12], [1.2, -4], [1.7, 4], [1.88, 11.03], [0.5, 15]],         // the stream: waterfall below the castle, under the bridge, then it splits into two arms to the board edge
  riverArms:[[[0.5, 15], [-5, 19], [-9, 26]], [[0.5, 15], [6, 19], [10, 26]]],
  garden:   { pos: [-17.5, heightAt(-17.5, -8), -8] },
  caketable:{ pos: [11.45, 0, 12.52] },                                         // outer side between tiles 12 and 13
  gemPedestal: { pos: [0, heightAt(0, -21), -21] },                           // in front of the castle gate
  lampposts: SPACES.filter(s => s.type.startsWith('flight')).map(s => ({ index: s.index, pos: s.pos, color: s.color })),
};

// ---------- the Starlight Catcher: a machine that tours the whole loop ----------
// Each stage has an anchor near a space; conduits between stages follow the route.
export const CATCHER_STAGES = [
  { id: 'bell',   near: BRIDGE_INDEX + 1,  side: 1,  desc: 'the launcher rings Ayva\'s bell on the riverside lamppost' },
  { id: 'net',    near: BRIDGE_INDEX + 4,  side: 1,  desc: 'the bell rope tugs Grabble\'s net off its hook at the pet wash; it swings' },
  { id: 'bucket', near: BRIDGE_INDEX + 5,  side: 1,  desc: 'the net bumps the Puddle Paws bucket; a marble spills' },
  { id: 'tub',    near: BRIDGE_INDEX + 6,  side: 1,  desc: 'the marble splashes into the pet-wash tub and bubbles down the drain' },
  { id: 'pipe',   near: BRIDGE_INDEX + 9,  side: 1,  desc: 'the marble rattles along the drain pipe that runs beside the west lane' },
  { id: 'vine',   near: BRIDGE_INDEX + 12, side: 1,  desc: 'Kyah\'s vine BLOOMS up the hill like a beanstalk and lifts the marble to the castle gate' },
  { id: 'drop',   near: 0,                 side: 1,  desc: 'the marble drops into the castle-gate bucket, which tips' },
  { id: 'apple',  near: 2,                 side: 1,  desc: 'the big red apple bounces down the castle steps and all along the bakery street' },
  { id: 'pup',    near: BRIDGE_INDEX - 4,  side: -1, desc: 'the apple lands on the seesaw by the fountain; Pup cannonballs into the washtub' },
  { id: 'music',  near: BRIDGE_INDEX - 1,  side: 1,  desc: 'the splash knocks the music stand; notes spiral up the bridge lamppost' },
  { id: 'basket', near: BRIDGE_INDEX,      side: 0,  desc: 'the flower-vine basket drops over the bridge' },
].map(s => { const idx = ((s.near % SPACE_COUNT) + SPACE_COUNT) % SPACE_COUNT; const sp = SPACES[idx]; const off = 2.6 * s.side; const ax = sp.pos[0] + (-sp.dir[1]) * off, az = sp.pos[2] + (sp.dir[0]) * off; return { ...s, near: idx, anchor: [+ax.toFixed(3), +heightAt(ax, az).toFixed(3), +az.toFixed(3)] }; });

export const CAMERA = {
  overview: { pos: [0, 31, 38], target: [0, 0.5, -4] },
  catcher:  { pos: [BRIDGE_POS[0] + 7, 9, BRIDGE_POS[2] + 12], target: [BRIDGE_POS[0], 2.5, BRIDGE_POS[2]] },
  castle:   { pos: [11, 9, -9], target: [0, 4.2, -21] },   // from the side, so pawns on the Start tile never hide the gem
};

export function nextIndex(i, steps = 1) { return (i + steps) % SPACE_COUNT; }
export function pathBetween(from, to) { const p = []; let i = from; while (i !== to) { i = nextIndex(i); p.push(i); } return p; }
export function passesThrough(from, to, index) { return pathBetween(from, to).includes(index); }
