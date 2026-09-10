// mapRunState.js
//
// A small state machine implementing the movement rules from the spec:
//   - A player enters a ring at one node.
//   - After that node resolves, the player must face at least one combat
//     node before descending. If the node they're on is already
//     combat-classified, that's satisfied — they may optionally make ONE
//     lateral move to EITHER adjacent node (combat or not), or descend
//     immediately. If the node they're on is NOT combat-classified, they
//     cannot descend yet, and their one lateral move is forced toward a
//     combat-classified neighbor (rule 8 guarantees at least one exists).
//   - After the lateral move (forced or freely chosen) — or immediately,
//     if a combat node skipped it — the player must descend to a
//     connected node on the next ring in.
//   - This repeats until the innermost ring is cleared, then the player
//     faces the Hell Lord directly (no separate 9th ring — the Hell Lord
//     occupies that final position itself).
//
// This module does NOT implement what happens when a player lands on a
// node (combat, corruption effects, etc.) — that's explicitly out of
// scope. It only tracks position and computes which nodes are currently
// legal to move to, which the renderer needs in order to know what's
// interactive vs. inert.
//
// Judgment call: the spec doesn't say how a player picks their very first
// Ring 1 node. Treated as an open choice — any of Ring 1's nodes is a
// legal starting point. If your design wants a fixed/forced start instead,
// change PHASES.AWAITING_ENTRY's legal-move computation below.

import { RING_COUNT, HELL_LORD_ID, isCombatType } from './mapConstants.js';

export const PHASES = Object.freeze({
  AWAITING_ENTRY: 'AWAITING_ENTRY', // no node chosen yet on ring 1
  CAN_MOVE_LATERAL_OR_DESCEND: 'CAN_MOVE_LATERAL_OR_DESCEND', // just landed on a node this ring
  MUST_DESCEND: 'MUST_DESCEND', // lateral move already used this ring
  AT_HELL_LORD: 'AT_HELL_LORD', // innermost ring cleared
});

function findNode(map, ringNumber, id) {
  const ring = map.rings.find((r) => r.ring === ringNumber);
  return ring ? ring.nodes.find((n) => n.id === id) : undefined;
}

function ringNodes(map, ringNumber) {
  const ring = map.rings.find((r) => r.ring === ringNumber);
  return ring ? ring.nodes : [];
}

function inRingNeighbors(map, ringNumber, id) {
  const nodes = ringNodes(map, ringNumber);
  const i = nodes.findIndex((n) => n.id === id);
  if (i === -1) return [];
  const n = nodes.length;
  const prev = nodes[(i - 1 + n) % n];
  const next = nodes[(i + 1) % n];
  return prev.id === next.id ? [prev.id] : [prev.id, next.id];
}

export function createRunState(map) {
  return {
    map,
    currentRing: 1,
    currentNodeId: null,
    phase: PHASES.AWAITING_ENTRY,
    path: [], // every node actually visited, in order (includes lateral moves)
    ringExitNodeId: {}, // ring number -> the node the player descended FROM
    ended: false,
  };
}

// Returns the set of node ids the player may legally move to right now.
//
// Mandatory combat-facing rule: a player must face at least one combat
// node per ring before descending.
//   - If the current node IS combat-classified, that's already satisfied
//     — both lateral neighbors (whatever their type) and every descent
//     target are freely available; descending immediately is a valid
//     choice.
//   - If the current node is NOT combat-classified, the player can't
//     descend yet, and can't take a "free" lateral either — the lateral
//     move is forced toward a combat-classified neighbor specifically.
//     Rule 8 guarantees at least one of the two in-ring neighbors is
//     combat-classified (a non-combat node can never have both neighbors
//     non-combat too, or that would be a run of 3 — which rule 8
//     forbids), so this is always resolvable; it just may remove one of
//     the two neighbor choices, or occasionally force a single option.
export function getLegalMoves(state) {
  const { map, phase, currentRing, currentNodeId } = state;
  if (phase === PHASES.AWAITING_ENTRY) {
    return ringNodes(map, 1).map((n) => n.id);
  }
  if (phase === PHASES.AT_HELL_LORD) {
    return [];
  }
  const node = findNode(map, currentRing, currentNodeId);
  if (!node) return [];

  const descendTargets = node.descentConnections.slice();
  if (phase === PHASES.MUST_DESCEND) {
    return descendTargets;
  }

  // CAN_MOVE_LATERAL_OR_DESCEND
  const lateralIds = inRingNeighbors(map, currentRing, currentNodeId);
  if (isCombatType(node.type)) {
    // Combat already faced this ring — lateral (either neighbor) and
    // descent are both freely available.
    return [...lateralIds, ...descendTargets];
  }
  // Non-combat: descending is not yet legal, and only the combat
  // neighbor(s) are legal lateral targets.
  const combatLateralIds = lateralIds.filter((id) => {
    const neighbor = findNode(map, currentRing, id);
    return neighbor && isCombatType(neighbor.type);
  });
  return combatLateralIds;
}

// Attempts to move to `targetId`. Returns a NEW state object (does not
// mutate the input) plus { ok: boolean, error?: string }. Rejects any
// target not currently in getLegalMoves().
export function applyMove(state, targetId) {
  const legal = getLegalMoves(state);
  if (!legal.includes(targetId)) {
    return { state, ok: false, error: `${targetId} is not a legal move from the current state.` };
  }

  // Entry onto Ring 1.
  if (state.phase === PHASES.AWAITING_ENTRY) {
    const next = {
      ...state,
      currentNodeId: targetId,
      phase: PHASES.CAN_MOVE_LATERAL_OR_DESCEND,
      path: [...state.path, targetId],
    };
    return { state: next, ok: true };
  }

  const node = findNode(state.map, state.currentRing, state.currentNodeId);
  const isDescent = node.descentConnections.includes(targetId);

  if (isDescent) {
    const nextRing = state.currentRing + 1;
    const exitFrom = state.currentNodeId;
    const isHellLord = targetId === HELL_LORD_ID;
    const next = {
      ...state,
      currentRing: isHellLord ? state.currentRing : nextRing,
      currentNodeId: targetId,
      phase: isHellLord ? PHASES.AT_HELL_LORD : PHASES.CAN_MOVE_LATERAL_OR_DESCEND,
      path: [...state.path, targetId],
      ringExitNodeId: { ...state.ringExitNodeId, [state.currentRing]: exitFrom },
      ended: isHellLord ? state.ended : state.ended,
    };
    return { state: next, ok: true };
  }

  // Otherwise it's the one-time lateral move within the current ring.
  if (state.phase !== PHASES.CAN_MOVE_LATERAL_OR_DESCEND) {
    // Should be unreachable since MUST_DESCEND's legal moves exclude
    // lateral targets, but guard explicitly for safety.
    return { state, ok: false, error: 'Lateral move already used on this ring.' };
  }
  const next = {
    ...state,
    currentNodeId: targetId,
    phase: PHASES.MUST_DESCEND,
    path: [...state.path, targetId],
  };
  return { state: next, ok: true };
}

// Convenience: is the run finished (standing at the Hell Lord)?
export function isRunComplete(state) {
  return state.phase === PHASES.AT_HELL_LORD;
}
