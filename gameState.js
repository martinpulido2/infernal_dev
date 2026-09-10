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
//     icon: '/ryadnaeicon.png',       // combat token icon
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
    },
  };
}

let state = load() || defaultState();
// A session persisted before runStats existed won't have it (or won't have
// every field in it, if it's from a version with a partial shape) --
// backfill defensively so nothing downstream has to null-check every read.
if (!state.runStats) {
  state.runStats = defaultState().runStats;
} else {
  state.runStats = {
    turnsByPlayerIndex: state.runStats.turnsByPlayerIndex || {},
    guardianDefeatsByPlayerIndex: state.runStats.guardianDefeatsByPlayerIndex || {},
    defeatLog: state.runStats.defeatLog || [],
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
