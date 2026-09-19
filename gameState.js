// gameState.js
//
// The single shared source of truth that survives across all three phases
// (orientation select -> descent map -> combat -> back to map, or back to
// orientation select on defeat). Nothing here renders anything; it's pure
// data + a tiny pub/sub so each phase's UI can re-render when something it
// cares about changes without polling.
//
// Lives at module scope (one instance for the whole page — this is a
// single-page app now, not three separate pages) and is persisted to
// sessionStorage on every write, so a hard refresh mid-run doesn't lose
// progress. Swap sessionStorage for localStorage if you want a run to
// survive closing the tab entirely.

const STORAGE_KEY = 'inferno_run_state_v1';

// ---------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------
// players: array, one entry per ACTIVE player only (length 1-4), in a
//   stable order established at orientation-select time. This order is
//   what combat.js iterates for turn setup, console layout, etc.
//   {
//     charId: 'ryadnae',              // from charData in orientation/select.js
//     name: 'Ryadnae',
//     color: '#1e88e5',
//     icon: '/public/ryadnaeicon.png', // combat token icon
//     slot: 'SW2',                    // speed-tier slot, one of the 7 "*2" slots
//     corner: 0,                      // 0=TL,1=TR,2=BL,3=BR — the SCREEN corner
//                                     // their console/card renders in
//     orientationEdge: 'left',        // 'top'|'right'|'bottom'|'left' — which
//                                     // edge of the table they're actually
//                                     // seated at (drives label/arrow rotation
//                                     // in both map and combat UIs)
//     soulShards: 0,       // current SPENDABLE count (draggable, like an
//                          // enemy's HP in combat)
//     soulShardsMax: 0,    // total ever earned this run — only grows, via
//                          // awardSoulShards(). soulShards can be dragged
//                          // anywhere in [0, soulShardsMax] but never past
//                          // it, same principle as HP capped at maxHp.
//   }
//
// Corruption is confirmed party-wide (not per-player) — combat.js's
// existing corruptionLevel/corruptionFilled globals stay exactly as they
// are, unchanged. partyCorruption below is just where that pair lives now
// that it needs to survive a phase switch (was module-scoped in main.js,
// which is fine when there's only one phase, not fine once the map phase
// also needs to read it). Every player's map-corner HUD reads the SAME
// partyCorruption — there's no per-player corruption to distinguish.

function defaultState() {
  return {
    players: [],               // populated at orientation-select confirm
    phase: 'ORIENTATION',      // 'ORIENTATION' | 'MAP' | 'COMBAT'
    mode: 'STANDARD',          // 'STANDARD' | 'RUSH' — see map/mapConstants.js's
                                // GAME_MODES. Chosen at orientation-select
                                // (orientation/select.js's mode panel) before
                                // finishOrientationSelect() can advance to MAP;
                                // this default only matters for the brief
                                // window before that choice is made.
    seed: null,                // map seed, so a defeated run's map can be
                                // regenerated identically if you ever want
                                // "same map, new attempt" instead of fresh
    mapRunState: null,         // serialized mapRunState.js state (JSON-safe:
                                // it's already plain objects/arrays)
    partyCorruption: { level: 1, filled: 0 },
    pendingCombat: null,       // { nodeId, ring, circleName } while combat.js
                                // is resolving a clash; cleared on return to map
    lastCombatResult: null,    // 'VICTORY' | 'DEFEAT' | null — read once by
                                // the map phase on hand-back, then cleared
    // Run-wide stats, accumulated across every combat this run (not reset
    // between fights the way combat.js's own module state is) — feeds the
    // Hell-Lord-victory recap screen (map/victoryRecap.js). Indices below
    // are PLAYER ARRAY INDEX (matching `players` above), the same 0-based
    // indexing used everywhere else in gameState — combat.js's own pNum
    // convention is 1-based (pNum = index + 1) and converts at the call
    // site, same as it already does when reading PLAYER_CHARACTERS.
    runStats: {
      turnsByPlayerIndex: {},           // playerIndex -> count of times
                                         // that player's OWN dot reached
                                         // the action line (a real,
                                         // stopping turn — not a pass-
                                         // through), across every combat
                                         // this run.
      guardianDefeatsByPlayerIndex: {}, // playerIndex -> count of enemy
                                         // GROUPS removed while that
                                         // player's own dot was on the
                                         // action line at the moment of
                                         // the defeat. A defeat that
                                         // happens while it's nobody's
                                         // own player-turn (e.g. an
                                         // enemy's turn) isn't credited
                                         // to anyone.
      defeatLog: [],                    // [{ ring, ringName, nodeType,
                                         //    names: [...] }], one entry
                                         // per WON guardian/Overseer/Hell
                                         // Lord combat, in the order
                                         // fought. `names` is every
                                         // distinct enemy name dealt to
                                         // the party in that fight (a
                                         // Clash can hand different
                                         // players different guardians
                                         // simultaneously). Ordeal wins
                                         // aren't logged here — an Ordeal
                                         // has no guardianAssignment
                                         // entry to name, and isn't
                                         // really "an enemy defeated" in
                                         // the same sense.

      // --- Added for corruption-scaling data collection (Rush/Dynamic
      // mode design work) — see /areas/inferno-card-game.md. Run-wide
      // totals, not per-player; the point is feeding the Rush/Dynamic
      // scaling math, not a leaderboard. Every field here is something
      // the app can observe itself EXCEPT optionalCorruption, which
      // requires the player to say why a manual corruption increase
      // happened (the app has no way to read a physical enemy/curse
      // card's text) — see recordOptionalCorruption()'s own comment.
      enemyTurnsFaced: 0,               // count of real enemy turns (see
                                         // recordEnemyTurn() below) — for
                                         // a shared boss (Overseer/Hell
                                         // Lord) or an Inquisitor, this is
                                         // the cumulative-threshold trip
                                         // itself, NOT each individual
                                         // dot's pass-through, matching
                                         // "number of threshold trips for
                                         // their real turns" as specified.
      corruptionManualUp: { events: 0, total: 0 },   // corruption RING
      corruptionManualDown: { events: 0, total: 0 }, // DRAG only (see
                                         // corruptionHitArea's pointerup
                                         // handler) — i.e. corruption
                                         // gained from enemy behaviors/
                                         // curses, or removed via a
                                         // soul's innate ability. Explicitly
                                         // NOT the per-turn auto-increment
                                         // (that's deterministic — one per
                                         // player turn — and NOT Consume/
                                         // Taint (tracked separately below,
                                         // since those are their own
                                         // distinct coded actions, not a
                                         // free-form drag).
      consumeCount: 0,
      taintCount: 0,
      optionalCorruption: {             // See recordOptionalCorruption().
        corruptedCard: 0,               // a. played a corrupted card
        acceptedInsteadOfPenalty: 0,    // b. accepted corruption instead
                                         //    of a different penalty
        triggeredOnEnemy: 0,            // c. chose to trigger a
                                         //    corruption penalty on an
                                         //    enemy
      },
    },
  };
}

let state = load() || defaultState();
// A session persisted before runStats/mode existed won't have them (or won't
// have every field, if from a version with a partial shape) -- backfill
// defensively so nothing downstream has to null-check every read.
if (!state.mode) state.mode = 'STANDARD';
if (!state.runStats) {
  state.runStats = defaultState().runStats;
} else {
  state.runStats = {
    turnsByPlayerIndex: state.runStats.turnsByPlayerIndex || {},
    guardianDefeatsByPlayerIndex: state.runStats.guardianDefeatsByPlayerIndex || {},
    defeatLog: state.runStats.defeatLog || [],
    enemyTurnsFaced: state.runStats.enemyTurnsFaced || 0,
    corruptionManualUp: state.runStats.corruptionManualUp || { events: 0, total: 0 },
    corruptionManualDown: state.runStats.corruptionManualDown || { events: 0, total: 0 },
    consumeCount: state.runStats.consumeCount || 0,
    taintCount: state.runStats.taintCount || 0,
    optionalCorruption: state.runStats.optionalCorruption || {
      corruptedCard: 0,
      acceptedInsteadOfPenalty: 0,
      triggeredOnEnemy: 0,
    },
  };
}
const listeners = new Set();

function load() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persist() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // sessionStorage can throw in some embedded/StackBlitz preview contexts
    // (quota, privacy mode) -- non-fatal, the in-memory copy still works
    // for the rest of this session.
  }
}

function notify() {
  listeners.forEach((fn) => fn(state));
}

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Shallow-merge patch into state, persist, notify. This is the only write
// path -- every phase mutates through this so nothing silently forgets to
// persist or notify.
export function patchState(patch) {
  state = { ...state, ...patch };
  persist();
  notify();
}

// Convenience for the common "update one player by index" case.
export function patchPlayer(index, patch) {
  const players = state.players.slice();
  players[index] = { ...players[index], ...patch };
  patchState({ players });
}

// Full reset -- called when a defeated run cycles back to the beginning
// screen (double-tap on the defeat screen, per your spec). Wipes
// everything including sessionStorage, so a. starts from a truly blank
// orientation-select state.
export function resetRun() {
  state = defaultState();
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* non-fatal */
  }
  notify();
}

// --- Soul shards -------------------------------------------------------
// Players earn these at combat resolution (1 per clash, 2 per Overseer).
// Treated like an enemy's HP in combat: soulShards is the current
// spendable count, draggable anywhere in [0, soulShardsMax] but never
// past that ceiling — dragging never destroys shards outright, it just
// moves the displayed count within the range of what's actually been
// earned. soulShardsMax only ever grows, via awardSoulShards() below.
export function awardSoulShards(amount) {
  const players = state.players.map((p) => ({
    ...p,
    soulShards: p.soulShards + amount,
    soulShardsMax: p.soulShardsMax + amount,
  }));
  patchState({ players });
}

export function setPlayerSoulShards(index, value) {
  const max = state.players[index]?.soulShardsMax ?? 0;
  patchPlayer(index, { soulShards: Math.max(0, Math.min(max, value)) });
}

// --- Party corruption (shared helper for non-combat callers) ----------
// combat/combat.js has its own applyCorruptionDelta with this exact same
// level/filled rollover math, kept as its own separate, untouched
// function deliberately — it's tested, defeat-critical code, and this
// file's version exists for callers OUTSIDE combat (currently: the Hot
// Spring map node) rather than as a replacement for combat's copy. If
// this formula ever changes, combat.js's CORRUPTION_TIER_MULT/
// corruptionMaxSegments must be updated to match by hand — there's no
// shared import between them by design, to avoid combat.js depending on
// map-phase-only code paths.
const CORRUPTION_TIER_MULT = { 1: 3, 2: 4, 3: 6, 4: 6 };

function corruptionMaxSegments(level, numPlayers) {
  return (CORRUPTION_TIER_MULT[level] ?? CORRUPTION_TIER_MULT[4]) * numPlayers;
}

// Applies delta to the CURRENT partyCorruption using the same level-up/
// floor-at-zero rules as combat's applyCorruptionDelta, persists it, and
// returns whether this pushed corruption past the level-4 ceiling (what
// combat.js treats as player defeat). Callers outside combat don't have a
// defeat screen to show today, so this never lets the stored level exceed
// 4 itself — it just reports the breach and leaves the reaction (if any)
// up to the caller, rather than silently doing nothing OR silently
// triggering something the caller isn't built to handle.
export function adjustPartyCorruption(delta, numPlayers) {
  let { level, filled } = state.partyCorruption;
  filled += delta;
  let hitDefeatThreshold = false;
  while (filled > corruptionMaxSegments(level, numPlayers)) {
    filled = 0;
    level++;
    if (level > 4) {
      level = 4;
      hitDefeatThreshold = true;
      break;
    }
  }
  if (filled < 0) filled = 0;
  patchState({ partyCorruption: { level, filled } });
  return hitDefeatThreshold;
}

// --- Run stats (Hell-Lord-victory recap) --------------------------------
// See runStats' own comment in defaultState() for what each field means
// and its indexing convention. All three are simple read-increment-write
// helpers on top of the same patchState path everything else uses, so
// they persist and notify subscribers exactly like any other state change
// — the map phase's recap screen just reads getState().runStats fresh.

export function recordPlayerTurn(playerIndex) {
  const runStats = state.runStats;
  const turnsByPlayerIndex = { ...runStats.turnsByPlayerIndex };
  turnsByPlayerIndex[playerIndex] = (turnsByPlayerIndex[playerIndex] || 0) + 1;
  patchState({ runStats: { ...runStats, turnsByPlayerIndex } });
}

export function recordGuardianDefeat(playerIndex) {
  const runStats = state.runStats;
  const guardianDefeatsByPlayerIndex = { ...runStats.guardianDefeatsByPlayerIndex };
  guardianDefeatsByPlayerIndex[playerIndex] = (guardianDefeatsByPlayerIndex[playerIndex] || 0) + 1;
  patchState({ runStats: { ...runStats, guardianDefeatsByPlayerIndex } });
}

// entry: { ring, ringName, nodeType, names }. Appended in fight order —
// the recap screen groups these by ring itself rather than assuming this
// array arrives pre-sorted.
export function recordCombatVictory(entry) {
  const runStats = state.runStats;
  patchState({ runStats: { ...runStats, defeatLog: [...runStats.defeatLog, entry] } });
}

// --- Corruption-scaling data collection -----------------------------
// See runStats' own comment in defaultState() for what each field is for.
// Called from combat.js at the actual mechanical moment each event
// happens, so the person playing doesn't have to separately tally any of
// this by hand — except recordOptionalCorruption(), which genuinely can't
// be inferred from app state (see its own comment).

export function recordEnemyTurn() {
  const runStats = state.runStats;
  patchState({ runStats: { ...runStats, enemyTurnsFaced: runStats.enemyTurnsFaced + 1 } });
}

// delta is whatever the corruption ring drag committed (see combat.js's
// corruptionHitArea pointerup handler) — positive or negative, never 0
// (the caller already guards that). Bucketed by sign into events+total so
// the recap can show both "how many times" and "how much" without a
// second field ever going out of sync with the first.
export function recordManualCorruptionAdjustment(delta) {
  const runStats = state.runStats;
  const key = delta > 0 ? 'corruptionManualUp' : 'corruptionManualDown';
  const prev = runStats[key];
  patchState({
    runStats: {
      ...runStats,
      [key]: { events: prev.events + 1, total: prev.total + delta },
    },
  });
}

export function recordConsume() {
  const runStats = state.runStats;
  patchState({ runStats: { ...runStats, consumeCount: runStats.consumeCount + 1 } });
}

export function recordTaint() {
  const runStats = state.runStats;
  patchState({ runStats: { ...runStats, taintCount: runStats.taintCount + 1 } });
}

// The one thing the app genuinely can't observe on its own: WHY a manual
// corruption increase happened. Enemy and curse cards are physical —
// the app has no way to read "this behavior offers corruption instead of
// a penalty" off a card. category must be one of the three the person
// asked for: 'corruptedCard' | 'acceptedInsteadOfPenalty' | 'triggeredOnEnemy'.
export function recordOptionalCorruption(category) {
  const runStats = state.runStats;
  const optionalCorruption = { ...runStats.optionalCorruption };
  optionalCorruption[category] = (optionalCorruption[category] || 0) + 1;
  patchState({ runStats: { ...runStats, optionalCorruption } });
}
