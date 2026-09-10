// map/mapPhase.js
//
// Host for phase b. Structurally the same as the original standalone
// demo's inline <script> (generate map -> createRunState -> render loop
// on commitMove), but now:
//   - the map + run state are persisted into gameState so a defeat/return
//     from combat can restore exactly where the player was
//   - a clash/combat-type node CONFIRM doesn't call commitMove() itself —
//     it hands off to phase c. and defers the actual move-commit until
//     that combat resolves in victory (see onNodeConfirm below)
//   - re-entering this phase after a combat victory resumes the map
//     instead of generating a fresh one

import { generateMap } from './mapGenerator.js';
import { validateMap } from './mapValidator.js';
import { createRunState, applyMove, isRunComplete, getLegalMoves } from './mapRunState.js';
import { createMapRenderer } from './mapRenderer.js';
import { isCombatType, HELL_LORD_ID } from './mapConstants.js';
import { renderVictoryRecap } from './victoryRecap.js';
import { getState, patchState, subscribe } from '../gameState.js';

let map = null;
let runState = null;
let renderer = null;
let container = null;
let unsubscribe = null;

function findFullNodeById(id) {
  if (!map) return null;
  for (const ring of map.rings) {
    const found = ring.nodes.find((n) => n.id === id);
    if (found) return found;
  }
  return null;
}

function renderNow() {
  const complete = isRunComplete(runState);
  if (complete) {
    // Run complete (Hell Lord defeated) -- a dedicated recap screen
    // instead of the normal (now read-only, revealMode) map. Reads
    // whole-run stats gameState accumulated during combat -- see
    // victoryRecap.js and gameState.js's runStats comment.
    renderVictoryRecap(container);
    return;
  }
  renderer.render(map, runState, { revealMode: false });
}

function commitMove(id) {
  const result = applyMove(runState, id);
  if (!result.ok) return;
  runState = result.state;
  patchState({ mapRunState: runState }); // persisted so a mid-run refresh
                                          // or a combat round-trip doesn't
                                          // lose position
  renderNow();
}

function onNodeConfirm(id) {
  if (id === HELL_LORD_ID) {
    // Hell Lord isn't a normal ring node (findFullNodeById never finds
    // it -- it lives outside the ring structure entirely), so it needs
    // its own branch here rather than going through isCombatType(node.type)
    // like every other combat node. Same hand-off shape as any other
    // combat node otherwise: defer the actual move-commit until combat
    // reports back a victory (see the gameState subscription below).
    // `ring` is set to whichever ring the player is descending FROM
    // (their current ring right up until this move commits) -- Hell Lord
    // combat doesn't use it for fiend-difficulty scaling the way a normal
    // ring fight does (see enemyData.js's shouldDealFiend/
    // HARDER_FIEND_RING_THRESHOLD, neither of which apply here since Hell
    // Lord deals no fiends up front), but combat.js's declare functions
    // all take a ring argument for bookkeeping (e.g. building a unique
    // overseerId), so this keeps that shape consistent rather than
    // special-casing Hell Lord out of needing one at all.
    patchState({
      phase: 'COMBAT',
      pendingCombat: { nodeId: id, ring: runState.currentRing, nodeType: 'HELL_LORD' },
    });
    return;
  }
  const node = findFullNodeById(id);
  if (node && isCombatType(node.type)) {
    // Hand off to combat instead of moving yet. The move only actually
    // lands (commitMove) on VICTORY -- see the gameState subscription
    // below, which resumes this exact deferred move once combat reports
    // back. On DEFEAT the whole run resets via gameState.resetRun(), so
    // there's nothing to resume.
    patchState({
      phase: 'COMBAT',
      pendingCombat: { nodeId: id, ring: node.ring, nodeType: node.type },
    });
  } else {
    commitMove(id); // non-combat nodes (Rest Point, Reflection Chamber)
                     // resolve immediately on the map, same as before
  }
}

// Called once by the shell when this phase's container exists in the DOM.
// Safe to call more than once across a run (e.g. if the shell tears down
// and remounts phase containers) -- picks up wherever gameState left off.
export function mountMapPhase(containerEl) {
  container = containerEl;
  renderer = createMapRenderer(container, {
    onNodeTap: () => {}, // renderer draws its own preview cards; nothing
                         // extra needed here
    onNodeConfirm,
  });

  const state = getState();
  if (state.mapRunState && state.seed != null) {
    // Resuming: rebuild the SAME map from the persisted seed (map JSON
    // itself isn't stored in gameState -- only the run state + seed are,
    // to keep gameState small -- generateMap is deterministic per seed so
    // this reproduces byte-identical map data) and restore run position.
    map = generateMap(state.seed);
    runState = state.mapRunState;
  } else {
    // Fresh run: first entry into the map phase for this play-through.
    map = generateMap();
    const validation = validateMap(map);
    if (!validation.valid) {
      console.warn('Map validation violations:', validation.violations);
    }
    runState = createRunState(map);
    patchState({ seed: map.seed, mapRunState: runState });
  }

  renderNow();

  if (unsubscribe) unsubscribe();
  unsubscribe = subscribe((s) => {
    if (s.phase !== 'MAP') return; // only react while this phase is showing
    if (
      (s.lastCombatResult === 'VICTORY' || s.lastCombatResult === 'ORDEAL_FAILURE') &&
      s.pendingCombat
    ) {
      // Combat resolved -- either a real victory, or an Ordeal that ran
      // out of turns (which is NOT player defeat: the run continues, this
      // node is still marked complete, the player just gets no reward --
      // that distinction is entirely handled in combat.js's own tap
      // handlers before this ever fires; both paths land here identically
      // as far as map progression is concerned). The deferred move now
      // actually lands, and legal-move options recompute fresh from the
      // new position (getLegalMoves reads runState, which commitMove just
      // advanced) -- this is the "resuming where they left off, showing
      // available paths from the completed node" behavior from the brief.
      const nodeId = s.pendingCombat.nodeId;
      patchState({ pendingCombat: null, lastCombatResult: null });
      commitMove(nodeId);
    } else {
      // Any other MAP-phase state change (soul shards depleted, etc.) —
      // just re-render so the HUD reflects it.
      renderNow();
    }
  });
}

export function unmountMapPhase() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}
