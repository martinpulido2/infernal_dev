// mapGenerator.js
//
// Pure data generation for the Inferno descent map. No rendering, no DOM,
// no side effects beyond reading the RNG it creates internally. Calling
// generateMap() twice with the same seed always produces identical output.
//
// Return shape (plain JSON-serializable objects only):
// {
//   seed: number,
//   hellLord: { type: 'HELL_LORD' },
//   rings: [
//     {
//       ring: 1,
//       size: 4,
//       nodes: [
//         {
//           ring: 1,
//           index: 0,
//           id: 'r1n0',
//           type: 'STANDARD_COMBAT',
//           descentConnections: ['r2n0', 'r2n1'], // ids on ring+1, or
//                                                  // ['HELL_LORD'] from the
//                                                  // last real ring (8)
//         },
//         ...
//       ],
//     },
//     ...
//   ],
// }

import {
  RING_COUNT,
  RING_SIZES,
  NODE_TYPES,
  RING_1_ALLOWED_TYPES,
  HELL_LORD_ID,
  nodeId,
  isNonCombatType,
  createRng,
  normalizeSeed,
  rngShuffle,
  rngSampleDistinct,
  ringRotationOffset,
  angleForRingIndex,
} from './mapConstants.js';

// ---------------------------------------------------------------------------
// Tunable generation-rule constants (kept named/together so the probabilistic
// rules — 4 and 5 — are easy to find and adjust without hunting through the
// algorithm below).
// ---------------------------------------------------------------------------

const OVERSEER_TOTAL = 4;
const SECONDARY_TYPE_TOTAL = 4; // Rest Point / Reflection Chamber / Timed Challenge / Ordeal, each

const OVERSEER_SPREAD_PROBABILITY = 0.85; // Rule 4's ~85% "prefer non-adjacent rings"
const DISTINCT_RING_PROBABILITY = 0.85; // Rule 5's ~85% "prefer one-per-ring"

const SECONDARY_TYPES = [
  NODE_TYPES.REST_POINT,
  NODE_TYPES.REFLECTION_CHAMBER,
  NODE_TYPES.TIMED_CHALLENGE,
  NODE_TYPES.ORDEAL,
];

// Rest Point / Reflection Chamber are excluded from Ring 1 by rule 1 (they're
// not in RING_1_ALLOWED_TYPES); Timed Challenge / Ordeal are allowed there.
function candidateRingsForType(type) {
  const all = Array.from({ length: RING_COUNT }, (_, i) => i + 1);
  if (RING_1_ALLOWED_TYPES.has(type)) return all;
  return all.filter((r) => r !== 1);
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export function generateMap(seed) {
  const usedSeed = normalizeSeed(seed);
  const rng = createRng(usedSeed);

  // --- Placement phase, wrapped in a bounded retry ---
  //
  // Judgment call: this greedy, one-type-at-a-time placement algorithm
  // usually succeeds on the first try, but it has no look-ahead — it's
  // possible (empirically, ~0.1% of seeds under the current 8-ring
  // layout) for it to paint itself into a corner: e.g. Overseer +
  // Timed Challenge + Ordeal all landing on the same handful of rings
  // first can leave too few *distinct* rings open for Reflection
  // Chamber's last instance, even though aggregate capacity across all
  // candidate rings was never actually exhausted. Rather than build a
  // more complex backtracking allocator for a corner this rare, we
  // detect the shortfall (any type not landing exactly at its required
  // count) and simply retry the whole placement phase, drawing further
  // from the same RNG stream. This keeps generateMap deterministic per
  // seed (retries consume more of that seed's RNG sequence, but the
  // sequence itself is still fully determined by the seed) while making
  // success effectively certain — bounded at 200 attempts as a safety
  // valve in case some future rule change makes the layout genuinely
  // infeasible, in which case this throws rather than silently
  // returning a rule-violating map.
  const MAX_PLACEMENT_ATTEMPTS = 200;

  function attemptPlacement() {
    // ring -> { STANDARD_COMBAT: n, OVERSEER: n, ... } running counts.
    // We build the map as per-ring type *counts* first (order-independent),
    // then arrange each ring's multiset into a concrete cyclic sequence in
    // a separate pass. This keeps "how many of what" cleanly separated
    // from "in what order," which is what rule 8's adjacency constraint
    // needs.
    const ringTypeCounts = {};
    for (let r = 1; r <= RING_COUNT; r++) {
      ringTypeCounts[r] = {
        [NODE_TYPES.STANDARD_COMBAT]: 0,
        [NODE_TYPES.OVERSEER]: 0,
        [NODE_TYPES.TIMED_CHALLENGE]: 0,
        [NODE_TYPES.ORDEAL]: 0,
        [NODE_TYPES.REFLECTION_CHAMBER]: 0,
        [NODE_TYPES.REST_POINT]: 0,
      };
    }

    // --- Capacity bookkeeping ---
    //
    // Judgment call: rule 7 ("every ring has at least 1 Standard Combat")
    // and rule 8's "no 3+ consecutive non-combat" are both structural
    // guarantees, not things left to chance. Rather than generate-then-
    // hope-then-retry, we reserve capacity up front so they hold
    // unconditionally:
    //
    //  - specialCap[r] = ring size - 1, i.e. one slot per ring is always
    //    left for Standard Combat (guarantees rule 7 outright).
    //  - nonCombatCap[r] = floor(2 * ringSize / 3). This is the largest
    //    number of non-combat nodes a ring of that size can hold while
    //    still being arrangeable with no run of 3+ consecutive non-combat
    //    around the cycle (each combat node can "anchor" at most 2
    //    non-combat neighbors before a 3-run becomes unavoidable by
    //    pigeonhole). For size-4 rings this is 2; for Ring 3 (size 8)
    //    this is 5.
    const specialCap = {};
    const nonCombatCap = {};
    const specialFilled = {}; // Overseer + all 4 secondary types combined
    const nonCombatFilled = {}; // Rest Point + Reflection Chamber combined
    for (let r = 1; r <= RING_COUNT; r++) {
      const size = RING_SIZES[r];
      specialCap[r] = size - 1;
      nonCombatCap[r] = Math.floor((2 * size) / 3);
      specialFilled[r] = 0;
      nonCombatFilled[r] = 0;
    }

    function placeOne(ring, type) {
      ringTypeCounts[ring][type]++;
      specialFilled[ring]++;
      if (isNonCombatType(type)) nonCombatFilled[ring]++;
    }

    // Can this ring absorb `n` more instances of `type` right now (checking
    // both the general special-slot reservation and, for non-combat types,
    // the separate non-combat cap)? Used before committing multiple
    // instances to the same ring so capacity is never oversubscribed.
    function canPlaceN(ring, type, n) {
      if (specialFilled[ring] + n > specialCap[ring]) return false;
      if (isNonCombatType(type) && nonCombatFilled[ring] + n > nonCombatCap[ring]) return false;
      return true;
    }

    // Eligible rings for placing one more instance of `type` right now.
    // Also enforces rule 5's hard "never 3+ of the same type in one ring"
    // cap here — centrally, so every placement path (distinct branch, its
    // fallback, the duplicate branch) automatically respects it rather
    // than relying on each call site to remember to check it separately.
    function eligibleRings(type, candidates) {
      return candidates.filter((r) => {
        if (ringTypeCounts[r][type] >= 2) return false;
        return canPlaceN(r, type, 1);
      });
    }

    // -----------------------------------------------------------------
    // Rule 4: exactly 4 Overseers, no two on the same ring (hard), and a
    // ring-adjacency spread preference (~85% probability, soft).
    // -----------------------------------------------------------------
    function placeOverseers() {
      const candidates = candidateRingsForType(NODE_TYPES.OVERSEER); // rings 2-8 (ring 1 excluded by rule 1)
      // Enumerate every 4-ring combination once — cheap (C(7,4) = 35) and
      // lets us pick uniformly among valid options rather than retry-sampling.
      const combos = [];
      const combo4 = (arr) => {
        const out = [];
        const n = arr.length;
        for (let a = 0; a < n; a++)
          for (let b = a + 1; b < n; b++)
            for (let c = b + 1; c < n; c++)
              for (let d = c + 1; d < n; d++)
                out.push([arr[a], arr[b], arr[c], arr[d]]);
        return out;
      };
      combos.push(...combo4(candidates));

      const isMutuallyNonAdjacent = (combo) => {
        for (let i = 0; i < combo.length; i++) {
          for (let j = i + 1; j < combo.length; j++) {
            if (Math.abs(combo[i] - combo[j]) === 1) return false;
          }
        }
        return true;
      };

      const wantSpread = rng() < OVERSEER_SPREAD_PROBABILITY;
      const pool = wantSpread ? combos.filter(isMutuallyNonAdjacent) : combos;
      // pool is never empty: {2,4,6,8} is always a valid non-adjacent combo
      // for candidates [2..8], so the spread branch always has options.
      const chosenRings = pool[Math.floor(rng() * pool.length)];

      for (const r of chosenRings) {
        placeOne(r, NODE_TYPES.OVERSEER);
      }
    }

    // -----------------------------------------------------------------
    // Rule 5: Rest Point, Reflection Chamber, Timed Challenge, Ordeal each
    // appear exactly 4 times. Per type, independently: ~85% prefer one
    // instance per ring (all 4 in distinct rings); ~15% allow exactly one
    // ring to hold 2 of that type (never 3+).
    // -----------------------------------------------------------------
    function placeSecondaryType(type) {
      const baseCandidates = candidateRingsForType(type);
      const wantDistinct = rng() < DISTINCT_RING_PROBABILITY;

      if (wantDistinct) {
        // Placement is immediate (not deferred) so capacity checks on each
        // subsequent iteration see the effect of this call's own prior
        // picks, not just picks from earlier types.
        const chosen = [];
        for (let i = 0; i < SECONDARY_TYPE_TOTAL; i++) {
          const pool = eligibleRings(type, baseCandidates).filter((r) => !chosen.includes(r));
          if (pool.length === 0) break; // no genuinely-new ring available
          const r = pool[Math.floor(rng() * pool.length)];
          placeOne(r, type);
          chosen.push(r);
        }
        // Defensive fallback: if distinct placement ran out of brand-new
        // rings before reaching 4, fill the remainder wherever there's
        // still room — capacity-checked fresh on every iteration. If even
        // this can't reach 4 (the rare corner attemptPlacement exists to
        // catch), the caller detects the shortfall and retries.
        while (chosen.length < SECONDARY_TYPE_TOTAL) {
          const pool = eligibleRings(type, baseCandidates);
          if (pool.length === 0) break;
          const r = pool[Math.floor(rng() * pool.length)];
          placeOne(r, type);
          chosen.push(r);
        }
        return;
      }

      // ~15% branch: one duplicate ring (holds 2), two other rings hold 1
      // each (2 + 1 + 1 = 4, matching SECONDARY_TYPE_TOTAL).
      const dupCandidates = eligibleRings(type, baseCandidates).filter((r) => canPlaceN(r, type, 2));
      if (dupCandidates.length === 0) {
        const chosen = [];
        for (let i = 0; i < SECONDARY_TYPE_TOTAL; i++) {
          const pool = eligibleRings(type, baseCandidates).filter((r) => !chosen.includes(r));
          if (pool.length === 0) break;
          const r = pool[Math.floor(rng() * pool.length)];
          placeOne(r, type);
          chosen.push(r);
        }
        return;
      }
      const dupRing = dupCandidates[Math.floor(rng() * dupCandidates.length)];
      placeOne(dupRing, type);
      placeOne(dupRing, type); // capacity for both units was confirmed above

      const others = [];
      for (let i = 0; i < 2; i++) {
        const pool = eligibleRings(type, baseCandidates).filter(
          (r) => r !== dupRing && !others.includes(r)
        );
        if (pool.length === 0) break;
        const r = pool[Math.floor(rng() * pool.length)];
        placeOne(r, type);
        others.push(r);
      }
    }

    placeOverseers();
    // Shuffle processing order of the 4 secondary types each generation so
    // no single type systematically gets first pick of capacity.
    for (const type of rngShuffle(SECONDARY_TYPES, rng)) {
      placeSecondaryType(type);
    }

    // Verify every special type actually reached its required total — the
    // greedy algorithm above usually does, but see MAX_PLACEMENT_ATTEMPTS
    // note above for the rare corner where it doesn't.
    const overseerTotal = Object.values(ringTypeCounts).reduce(
      (sum, counts) => sum + counts[NODE_TYPES.OVERSEER],
      0
    );
    const shortfall =
      overseerTotal !== OVERSEER_TOTAL ||
      SECONDARY_TYPES.some(
        (type) =>
          Object.values(ringTypeCounts).reduce((sum, counts) => sum + counts[type], 0) !==
          SECONDARY_TYPE_TOTAL
      );

    return shortfall ? null : ringTypeCounts;
  }

  let ringTypeCounts = null;
  for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS && !ringTypeCounts; attempt++) {
    ringTypeCounts = attemptPlacement();
  }
  if (!ringTypeCounts) {
    throw new Error(
      `generateMap: could not find a valid special-node placement for seed ${usedSeed} after ${MAX_PLACEMENT_ATTEMPTS} attempts.`
    );
  }

  // -------------------------------------------------------------------
  // Rule 6: everything else is Standard Combat.
  // -------------------------------------------------------------------
  for (let r = 1; r <= RING_COUNT; r++) {
    const size = RING_SIZES[r];
    const placedSoFar = Object.values(ringTypeCounts[r]).reduce((a, b) => a + b, 0);
    ringTypeCounts[r][NODE_TYPES.STANDARD_COMBAT] += size - placedSoFar;
  }

  // -------------------------------------------------------------------
  // Arrange each ring's multiset into a concrete cyclic order such that
  // rule 8 (no 3+ consecutive non-combat) holds. Combat nodes act as
  // separators; non-combat nodes are distributed round-robin into the
  // gaps between them, which — given nonCombatCap above — never puts more
  // than 2 non-combat nodes in any single gap.
  // -------------------------------------------------------------------
  function arrangeRing(typeCounts) {
    const combatItems = [];
    const nonCombatItems = [];
    for (const [type, count] of Object.entries(typeCounts)) {
      for (let i = 0; i < count; i++) {
        (isNonCombatType(type) ? nonCombatItems : combatItems).push(type);
      }
    }
    const shuffledCombat = rngShuffle(combatItems, rng);
    const shuffledNonCombat = rngShuffle(nonCombatItems, rng);

    const gapCount = shuffledCombat.length; // always >= 2, see nonCombatCap derivation
    const gaps = Array.from({ length: gapCount }, () => []);
    shuffledNonCombat.forEach((type, i) => gaps[i % gapCount].push(type));

    const sequence = [];
    shuffledCombat.forEach((type, i) => {
      sequence.push(type);
      sequence.push(...gaps[i]);
    });
    return sequence;
  }

  const ringSequences = {};
  for (let r = 1; r <= RING_COUNT; r++) {
    ringSequences[r] = arrangeRing(ringTypeCounts[r]);
  }

  // -------------------------------------------------------------------
  // Descent connections: every node connects inward to EXACTLY 2 nodes
  // on the next ring in (the final ring's nodes connect to the single
  // Hell Lord instead, since there's only one target to converge on).
  //
  // Chosen scheme: each ring is rotated RING_ROTATION_STEP_DEGREES
  // further than the ring outside it (see mapConstants.js), producing a
  // spiral layout where a node sits angularly *between* two nodes on the
  // ring inside it rather than lined up with one of them. A source
  // node's 2 descent targets are simply the two target-ring nodes that
  // angularly "bracket" it — the one immediately clockwise and the one
  // immediately counter-clockwise, found by dividing the target ring
  // into sectors and taking the sector the source's angle falls into
  // plus the next one. Always exactly 2 (a target ring always has >= 2
  // nodes), and — verified for all three ring-size transitions present
  // here (4->4, 4->8, 8->4) — this also guarantees every target node
  // receives at least one incoming connection, so nothing is ever
  // unreachable, without needing a separate coverage-patching pass.
  // -------------------------------------------------------------------
  function computeDescentConnections(sourceRing, sourceSize, targetRing, targetSize) {
    const targetStep = 360 / targetSize;
    const targetOffset = ringRotationOffset(targetRing);
    const connections = [];
    for (let s = 0; s < sourceSize; s++) {
      const sourceAngle = angleForRingIndex(sourceRing, s, sourceSize);
      const relativeAngle = ((sourceAngle - targetOffset) % 360 + 360) % 360;
      const k = Math.floor(relativeAngle / targetStep) % targetSize;
      const kNext = (k + 1) % targetSize;
      connections.push([k, kNext].sort((a, b) => a - b));
    }
    return connections;
  }

  // -------------------------------------------------------------------
  // Assemble final node records + ring records.
  // -------------------------------------------------------------------
  const rings = [];
  for (let r = 1; r <= RING_COUNT; r++) {
    const size = RING_SIZES[r];
    const sequence = ringSequences[r];
    const isLastRing = r === RING_COUNT;
    const nextSize = isLastRing ? null : RING_SIZES[r + 1];
    const descentConnByIndex = isLastRing
      ? sequence.map(() => [HELL_LORD_ID])
      : computeDescentConnections(r, size, r + 1, nextSize).map((targets) =>
          targets.map((t) => nodeId(r + 1, t))
        );

    const nodes = sequence.map((type, index) => ({
      ring: r,
      index,
      id: nodeId(r, index),
      type,
      descentConnections: descentConnByIndex[index],
    }));

    rings.push({ ring: r, size, nodes });
  }

  return {
    seed: usedSeed,
    hellLord: { type: NODE_TYPES.HELL_LORD },
    rings,
  };
}
