// Shared constants for the Inferno map system.
// Kept dependency-free and framework-free so both mapGenerator.js and
// mapValidator.js (and any renderer) can import from a single source of truth.

export const RING_COUNT = 8;

// Rule 3: every ring holds 4 nodes, except Ring 3, which holds 8.
// The Hell Lord occupies the center directly beyond Ring 8 — there is no
// separate 9th ring; the Hell Lord IS the final position a player faces,
// not a 10th thing beyond it. (Historical note, not load-bearing: this
// actually lines up with Dante's own text better than a separate 9th ring
// would have — Circle 9/Cocytus, where Satan is frozen at the absolute
// center, is where the final confrontation happens in the source material
// too.)
export const RING_SIZES = {
  1: 4,
  2: 4,
  3: 8,
  4: 4,
  5: 4,
  6: 4,
  7: 4,
  8: 4,
};

export const NODE_TYPES = Object.freeze({
  STANDARD_COMBAT: 'STANDARD_COMBAT',
  OVERSEER: 'OVERSEER',
  TIMED_CHALLENGE: 'TIMED_CHALLENGE',
  ORDEAL: 'ORDEAL',
  REFLECTION_CHAMBER: 'REFLECTION_CHAMBER',
  REST_POINT: 'REST_POINT',
  HELL_LORD: 'HELL_LORD', // center only, never inside a ring
});

// Combat classification (see spec's node type table).
export const COMBAT_TYPES = new Set([
  NODE_TYPES.STANDARD_COMBAT,
  NODE_TYPES.OVERSEER,
  NODE_TYPES.TIMED_CHALLENGE,
  NODE_TYPES.ORDEAL,
]);

export const NON_COMBAT_TYPES = new Set([
  NODE_TYPES.REFLECTION_CHAMBER,
  NODE_TYPES.REST_POINT,
]);

export function isCombatType(type) {
  return COMBAT_TYPES.has(type);
}

export function isNonCombatType(type) {
  return NON_COMBAT_TYPES.has(type);
}

// Rule 1: Ring 1 may only contain these three types.
export const RING_1_ALLOWED_TYPES = new Set([
  NODE_TYPES.STANDARD_COMBAT,
  NODE_TYPES.TIMED_CHALLENGE,
  NODE_TYPES.ORDEAL,
]);

export const HELL_LORD_ID = 'HELL_LORD';

export function nodeId(ring, index) {
  return `r${ring}n${index}`;
}

// ---- Shared ring geometry (used by BOTH the generator, for descent-
// connection topology, and the renderer, for visual node placement) ----
//
// Each ring is rotated a bit further than the ring outside it, so nodes
// spiral rather than lining up radially — this is what produces the
// "always exactly 2 descent options, positioned between the node above"
// layout: because ring r+1 is rotated relative to ring r, a node on ring
// r sits angularly *between* two nodes on ring r+1 rather than directly
// above one of them.
export const RING_ROTATION_STEP_DEGREES = 30;

export function ringRotationOffset(ringNumber) {
  return (ringNumber - 1) * RING_ROTATION_STEP_DEGREES;
}

// angle 0 = straight up (12 o'clock), increasing clockwise.
export function angleForRingIndex(ringNumber, index, ringSize) {
  return (index / ringSize) * 360 + ringRotationOffset(ringNumber);
}

// ---- Deterministic seeded PRNG (mulberry32) ----
// Chosen for its small footprint and decent statistical quality for a game
// board generator — not cryptographic, just reproducible. A numeric seed
// in, a numeric seed out (so the generator can report exactly what seed
// was used, even when one wasn't supplied).

export function createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalizeSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return seed >>> 0;
  }
  // No seed supplied: derive one from time + a little extra entropy, but
  // always return it so the caller can persist/replay this exact map.
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

// rng-driven helpers shared by the generator (kept here so the validator
// never needs them — validator only reads data, never randomizes).

export function rngPick(array, rng) {
  return array[Math.floor(rng() * array.length)];
}

export function rngShuffle(array, rng) {
  const copy = array.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Choose `count` distinct elements from `array` without replacement.
export function rngSampleDistinct(array, count, rng) {
  return rngShuffle(array, rng).slice(0, count);
}
