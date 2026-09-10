// mapValidator.js
//
// Checks a map data structure (as returned by mapGenerator.generateMap)
// against every generation rule. Deliberately has no dependency on
// mapGenerator.js — it only knows the shared constants and the data shape,
// so it will catch generator bugs rather than assume the generator's own
// logic is correct.
//
// validateMap(map) -> { valid: boolean, violations: Violation[] }
// Violation: { rule: string, ring: number|null, nodeId: string|null, message: string }
//
// IMPORTANT — probabilistic rules (4's ring-adjacency spread, 5's
// distinct-ring preference): these are stated as "~85% of generations,"
// which is a property of many maps generated over time, not something a
// single map can be judged pass/fail on. A single map landing in the 15%
// exception case is not a bug. This validator therefore only checks the
// HARD parts of rules 4 and 5 (exact counts, no-same-ring-Overseers, no
// 3+-of-a-type-in-one-ring) and exposes a separate statistical helper
// (checkProbabilisticRatesAcrossRuns, below) for verifying the ~85/15 split
// holds up over many generations in testing.

import {
  RING_COUNT,
  RING_SIZES,
  NODE_TYPES,
  RING_1_ALLOWED_TYPES,
  HELL_LORD_ID,
  isCombatType,
  isNonCombatType,
} from './mapConstants.js';

const OVERSEER_TOTAL = 4;
const SECONDARY_TYPE_TOTAL = 4;
const SECONDARY_TYPES = [
  NODE_TYPES.REST_POINT,
  NODE_TYPES.REFLECTION_CHAMBER,
  NODE_TYPES.TIMED_CHALLENGE,
  NODE_TYPES.ORDEAL,
];

function violation(rule, ring, nodeIdVal, message) {
  return { rule, ring: ring ?? null, nodeId: nodeIdVal ?? null, message };
}

export function validateMap(map) {
  const violations = [];

  // --- Structural sanity before rule-checking (not numbered rules, but
  // without these the rule checks below can't run meaningfully) ---
  if (!map || typeof map !== 'object') {
    return { valid: false, violations: [violation('structure', null, null, 'Map is not an object.')] };
  }
  if (!map.hellLord || map.hellLord.type !== NODE_TYPES.HELL_LORD) {
    violations.push(violation('rule2', null, null, 'hellLord entry missing or has the wrong type.'));
  }
  if (!Array.isArray(map.rings) || map.rings.length !== RING_COUNT) {
    violations.push(
      violation('structure', null, null, `Expected ${RING_COUNT} rings, found ${map.rings?.length ?? 'none'}.`)
    );
    // Can't safely continue rule checks without a valid rings array.
    return { valid: violations.length === 0, violations };
  }

  // JSON-serializability check (plain data, no circular refs / class instances).
  try {
    JSON.stringify(map);
  } catch (e) {
    violations.push(violation('structure', null, null, `Map is not JSON-serializable: ${e.message}`));
  }

  const allNodesById = new Map();
  const ringByNumber = new Map();

  // --- Rule 3: ring sizes; also collect nodes for later checks ---
  for (const ringEntry of map.rings) {
    const r = ringEntry.ring;
    ringByNumber.set(r, ringEntry);
    const expectedSize = RING_SIZES[r];
    if (expectedSize === undefined) {
      violations.push(violation('structure', r, null, `Unexpected ring number ${r}.`));
      continue;
    }
    if (!Array.isArray(ringEntry.nodes) || ringEntry.nodes.length !== expectedSize) {
      violations.push(
        violation(
          'rule3',
          r,
          null,
          `Ring ${r} should have ${expectedSize} nodes, found ${ringEntry.nodes?.length ?? 'none'}.`
        )
      );
    }
    (ringEntry.nodes || []).forEach((node, i) => {
      if (node.ring !== r) {
        violations.push(violation('structure', r, node.id, `Node claims ring ${node.ring} but is stored under ring ${r}.`));
      }
      if (node.index !== i) {
        violations.push(violation('structure', r, node.id, `Node index ${node.index} does not match its position ${i} in the ring array.`));
      }
      if (allNodesById.has(node.id)) {
        violations.push(violation('structure', r, node.id, `Duplicate node id ${node.id}.`));
      }
      allNodesById.set(node.id, node);
    });
  }

  // Ensure every ring 1-9 is present exactly once.
  for (let r = 1; r <= RING_COUNT; r++) {
    if (!ringByNumber.has(r)) {
      violations.push(violation('rule3', r, null, `Ring ${r} is missing.`));
    }
  }

  // --- Rule 1: Ring 1 type restriction ---
  const ring1 = ringByNumber.get(1);
  if (ring1) {
    for (const node of ring1.nodes) {
      if (!RING_1_ALLOWED_TYPES.has(node.type)) {
        violations.push(
          violation('rule1', 1, node.id, `Ring 1 node has disallowed type ${node.type}.`)
        );
      }
    }
  }

  // --- Rule 2: Hell Lord is center-only, never inside a ring ---
  for (const [, node] of allNodesById) {
    if (node.type === NODE_TYPES.HELL_LORD) {
      violations.push(violation('rule2', node.ring, node.id, 'Hell Lord type found inside a ring; it must only be the center node.'));
    }
  }

  // --- Rule 4: exactly 4 Overseers total, no two share a ring (hard part) ---
  const overseersByRing = new Map();
  let overseerTotal = 0;
  for (const [, node] of allNodesById) {
    if (node.type === NODE_TYPES.OVERSEER) {
      overseerTotal++;
      overseersByRing.set(node.ring, (overseersByRing.get(node.ring) || 0) + 1);
    }
  }
  if (overseerTotal !== OVERSEER_TOTAL) {
    violations.push(violation('rule4', null, null, `Expected exactly ${OVERSEER_TOTAL} Overseers, found ${overseerTotal}.`));
  }
  for (const [r, count] of overseersByRing) {
    if (count > 1) {
      violations.push(violation('rule4', r, null, `Ring ${r} has ${count} Overseers; no two may share a ring.`));
    }
  }
  // Ring-adjacency spread (~85%) is intentionally NOT hard-validated here —
  // see file header. Use checkProbabilisticRatesAcrossRuns for that.

  // --- Rule 5: each secondary type appears exactly 4 times; no ring holds
  // 3+ of the same secondary type (2 is the documented max exception) ---
  for (const type of SECONDARY_TYPES) {
    let total = 0;
    const byRing = new Map();
    for (const [, node] of allNodesById) {
      if (node.type === type) {
        total++;
        byRing.set(node.ring, (byRing.get(node.ring) || 0) + 1);
      }
    }
    if (total !== SECONDARY_TYPE_TOTAL) {
      violations.push(violation('rule5', null, null, `Expected exactly ${SECONDARY_TYPE_TOTAL} ${type} nodes, found ${total}.`));
    }
    for (const [r, count] of byRing) {
      if (count > 2) {
        violations.push(
          violation('rule5', r, null, `Ring ${r} has ${count} ${type} nodes; the documented exception allows at most 2.`)
        );
      }
    }
  }
  // Distinct-ring preference (~85%) is intentionally NOT hard-validated —
  // see file header.

  // --- Rule 6: everything else is Standard Combat (checked implicitly via
  // the total count reconciliation below) ---
  let standardCombatTotal = 0;
  for (const [, node] of allNodesById) {
    if (node.type === NODE_TYPES.STANDARD_COMBAT) standardCombatTotal++;
  }
  const expectedTotalNodes = Object.values(RING_SIZES).reduce((a, b) => a + b, 0);
  const expectedStandardCombat =
    expectedTotalNodes - OVERSEER_TOTAL - SECONDARY_TYPE_TOTAL * SECONDARY_TYPES.length;
  if (allNodesById.size === expectedTotalNodes && standardCombatTotal !== expectedStandardCombat) {
    violations.push(
      violation(
        'rule6',
        null,
        null,
        `Expected ${expectedStandardCombat} Standard Combat nodes (everything not otherwise assigned), found ${standardCombatTotal}.`
      )
    );
  }

  // --- Rule 7 & Rule 8: per-ring combat composition and adjacency ---
  for (const [r, ringEntry] of ringByNumber) {
    const nodes = ringEntry.nodes || [];
    const n = nodes.length;
    if (n === 0) continue;

    const standardCount = nodes.filter((nd) => nd.type === NODE_TYPES.STANDARD_COMBAT).length;
    if (standardCount < 1) {
      violations.push(violation('rule7', r, null, `Ring ${r} has no Standard Combat node.`));
    }

    const combatCount = nodes.filter((nd) => isCombatType(nd.type)).length;
    if (combatCount < 2) {
      violations.push(violation('rule8', r, null, `Ring ${r} has only ${combatCount} combat-classified node(s); needs at least 2.`));
    }

    // No 3+ consecutive non-combat nodes around the cycle. To measure a
    // circular run correctly (including runs that wrap past the last index
    // back to the first), rotate the sequence to start right after a
    // combat node — that guarantees no true run is split across the
    // array's start/end seam — then do a single linear scan. If there's no
    // combat node at all, the whole ring is one giant wrapping run of
    // length n.
    const firstCombatIdx = nodes.findIndex((nd) => isCombatType(nd.type));
    let maxRun;
    if (firstCombatIdx === -1) {
      maxRun = n;
    } else {
      const rotated = [
        ...nodes.slice(firstCombatIdx + 1),
        ...nodes.slice(0, firstCombatIdx + 1),
      ];
      let runLength = 0;
      maxRun = 0;
      for (const nd of rotated) {
        if (isNonCombatType(nd.type)) {
          runLength++;
          maxRun = Math.max(maxRun, runLength);
        } else {
          runLength = 0;
        }
      }
    }
    if (maxRun >= 3) {
      violations.push(
        violation('rule8', r, null, `Ring ${r} has a run of ${maxRun} consecutive non-combat nodes (max allowed is 2).`)
      );
    }
  }

  // --- Structural integrity (not numbered, but required for the map to be
  // playable under the stated movement rules) ---
  for (const [r, ringEntry] of ringByNumber) {
    const isLastRing = r === RING_COUNT;
    const nextRing = ringByNumber.get(r + 1);
    for (const node of ringEntry.nodes || []) {
      if (!Array.isArray(node.descentConnections) || node.descentConnections.length < 1) {
        violations.push(violation('reachability', r, node.id, 'Node has no outgoing descent connections.'));
        continue;
      }
      // Every non-final ring must offer exactly 2 descent choices per
      // node — this is the actual layout requirement (spiral placement,
      // nodes positioned "between" the ring above), not just a minimum.
      // The final ring is the one exception: it converges on the single
      // Hell Lord, so exactly 1 is correct there instead.
      if (isLastRing) {
        if (node.descentConnections.length !== 1 || node.descentConnections[0] !== HELL_LORD_ID) {
          violations.push(
            violation('reachability', r, node.id, `Ring ${r} node should have exactly one descent connection, to the Hell Lord; found ${JSON.stringify(node.descentConnections)}.`)
          );
        }
      } else if (node.descentConnections.length !== 2) {
        violations.push(
          violation('reachability', r, node.id, `Node should have exactly 2 descent connections, found ${node.descentConnections.length}.`)
        );
      }
      for (const targetId of node.descentConnections) {
        if (isLastRing) {
          if (targetId !== HELL_LORD_ID) {
            violations.push(violation('reachability', r, node.id, `Ring ${r} node connects to ${targetId} instead of the Hell Lord.`));
          }
        } else if (!nextRing || !nextRing.nodes.some((nd) => nd.id === targetId)) {
          violations.push(violation('reachability', r, node.id, `Descent connection ${targetId} does not exist on ring ${r + 1}.`));
        }
      }
    }
  }
  // Every node beyond Ring 1 must be reachable via at least one incoming
  // descent connection from the previous ring (otherwise it's a dead node
  // no player could ever land on).
  for (let r = 2; r <= RING_COUNT; r++) {
    const ringEntry = ringByNumber.get(r);
    const prevRing = ringByNumber.get(r - 1);
    if (!ringEntry || !prevRing) continue;
    const incoming = new Set();
    for (const node of prevRing.nodes) {
      for (const targetId of node.descentConnections || []) incoming.add(targetId);
    }
    for (const node of ringEntry.nodes) {
      if (!incoming.has(node.id)) {
        violations.push(violation('reachability', r, node.id, `Node ${node.id} has no incoming descent connection from ring ${r - 1}; it is unreachable.`));
      }
    }
  }

  return { valid: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Statistical helper for testing the probabilistic parts of rules 4 & 5.
// Not used by validateMap itself — call this separately in a test suite,
// passing your own generateMap function, to confirm the ~85/15 split is
// landing near the intended rate across many runs.
// ---------------------------------------------------------------------------
export function checkProbabilisticRatesAcrossRuns(generateMapFn, runCount = 500) {
  let spreadCount = 0; // rule 4: Overseer rings mutually non-adjacent
  const distinctCountByType = Object.fromEntries(SECONDARY_TYPES.map((t) => [t, 0])); // rule 5

  for (let i = 0; i < runCount; i++) {
    const map = generateMapFn(i * 7919 + 1); // arbitrary distinct seeds
    const overseerRings = [];
    const ringsByType = Object.fromEntries(SECONDARY_TYPES.map((t) => [t, []]));

    for (const ringEntry of map.rings) {
      for (const node of ringEntry.nodes) {
        if (node.type === NODE_TYPES.OVERSEER) overseerRings.push(node.ring);
        if (ringsByType[node.type]) ringsByType[node.type].push(node.ring);
      }
    }

    let mutuallyNonAdjacent = true;
    for (let a = 0; a < overseerRings.length; a++) {
      for (let b = a + 1; b < overseerRings.length; b++) {
        if (Math.abs(overseerRings[a] - overseerRings[b]) === 1) mutuallyNonAdjacent = false;
      }
    }
    if (mutuallyNonAdjacent) spreadCount++;

    for (const type of SECONDARY_TYPES) {
      const rings = ringsByType[type];
      if (new Set(rings).size === rings.length) distinctCountByType[type]++;
    }
  }

  return {
    runCount,
    overseerSpreadRate: spreadCount / runCount,
    distinctRingRateByType: Object.fromEntries(
      SECONDARY_TYPES.map((t) => [t, distinctCountByType[t] / runCount])
    ),
  };
}
