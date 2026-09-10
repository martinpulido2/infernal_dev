// enemyData.js
//
// Replaces main.js's CIRCLE_COLORS / GUARDIANS_BY_CIRCLE / CIRCLE_ORDER
// trio with one table, keyed by RING NUMBER (1-8) so combat.js can be
// handed a ring number straight from mapRunState/mapConstants and never
// needs its own separate "circle name" bookkeeping. The circle's display
// name is just a field on the ring's entry now, not a second parallel key.
//
// This is the format b. (map code) needs to hand to c. (combat code) when
// a clash node resolves: just the ring number. Everything else, combat.js
// looks up from here.
//
// TO ADD A NEW CIRCLE: add one entry to CIRCLES_BY_RING below. Nothing
// else in combat.js needs to change -- declareEnemies() reads whatever
// ring number it's given. If a ring's guardian pool has fewer entries
// than your max player count (4), pickWithExclusion will run out of
// distinct guardians to hand out; keep each pool at >= 4 entries.

export const CIRCLES_BY_RING = {
  1: {
    name: 'Limbo',
    color: '#1a8f5c',
    // Rings at or beyond HARDER_FIEND_THRESHOLD's ring number face the
    // tougher fiend variant (same draw pool, harder stat block) -- see
    // note below on fiendVariant.
    guardians: [
      { name: 'Socrates', slot: 'F1', maxHp: 12, corruption: 3 },
      { name: 'Hector', slot: 'F3', maxHp: 13, corruption: 2 },
      { name: 'Arjuna', slot: 'SW1', maxHp: 13, corruption: 2 },
      { name: 'Julius Caesar', slot: 'SW3', maxHp: 13, corruption: 2 },
      { name: 'Eve', slot: 'N1', maxHp: 9, corruption: 3 },
      { name: 'Saladin', slot: 'N3', maxHp: 12, corruption: 3 },
      { name: 'Electra', slot: 'VF1', maxHp: 11, corruption: 3 },
      { name: 'Avicenna', slot: 'LS1', maxHp: 12, corruption: 3 },
      { name: 'Orpheus', slot: 'S1', maxHp: 13, corruption: 3 },
      { name: 'Penthesilea', slot: 'S3', maxHp: 13, corruption: 3 },
    ],
    // Ordeal encounters are NOT circle-bound (see ORDEAL_ENCOUNTERS below)
    // -- ring 1 used to carry the only 'ordeal' entry as a placeholder
    // "first working example," which meant any Ordeal node generated on
    // a DIFFERENT ring hit a missing-data error during combat setup and
    // produced a blank screen instead of a fight. Removed here; the
    // shared ORDEAL_ENCOUNTERS list now serves every ring.
  },

  2: {
    name: 'Lust',
    color: '#c2185b',
    // Clash-node guardians for Lust aren't defined yet -- combat.js's
    // drawGuardians() will throw a clear error (same "loudly, not
    // silently" philosophy as getCircleForRing below) if a Clash/Standard
    // node on this ring is resolved before entries are added here. The
    // Overseer below is independent of this list and works today.
    guardians: [
		{ name: 'Achilles', slot: 'F1', maxHp: 17, corruption: 3 },
		{ name: 'Helen of Troy', slot: 'SW1', maxHp: 14, corruption: 2 },
	],
    overseer: {
      name: 'Tristan and Isolde',
      // Shared pool, scaled by player count at declaration time:
      // combat.js multiplies these by the number of active players to
      // get the encounter's actual maxHp/corruption.
      hpPerPlayer: 21,
      corruptionPerPlayer: 3,
      // Speed slot assigned to each player's overseer dot, in priority
      // order -- for a P-player combat, combat.js uses the first P
      // entries here (index 0 -> player 1's dot, etc). A 3-player game
      // therefore never uses SW1 at all.
      slotsByPriority: ['N1', 'N3', 'LS3', 'SW1'],
    },
  },

3: {
    name: 'Gluttony',
    color: '#6b4a2f',
    guardians: [
      { name: 'Elagabalus', slot: 'LS1', maxHp: 4, corruption: 14 },
	  { name: 'Tantalus', slot: 'N3', maxHp: 61, corruption: 4 },
    ],
	overseer: {
      name: 'Orobas',
      hpPerPlayer: 26,
      corruptionPerPlayer: 5,
      slotsByPriority: ['N1', 'N3', 'LS3', 'SW1'],
    },
  },
  
4: {
    name: 'Greed',
    color: '#6b6b6b',
    guardians: [
      { name: 'King Midas', slot: 'N3', maxHp: 23, corruption: 3 },
	  { name: 'Benedict IX', slot: 'N1', maxHp: 24, corruption: 3 },
    ],
  },
  
5: {
    name: 'Wrath',
    color: '#2f5f8a',
    guardians: [
      { name: 'Recurring Nightmare', slot: 'N1', maxHp: 33, corruption: 4 },
	  { name: 'Tisiphone', slot: 'SW1', maxHp: 29, corruption: 3 },
    ],
  },
  
  6: {
    name: 'Heresy',
    color: '#b5651d',
    guardians: [
      { name: 'Gnostic Cultists', slot: 'SW1', maxHp: 1, corruption: 4 },
	  { name: 'Anastasius II', slot: 'N1', maxHp: 36, corruption: 4 },
    ],
  },
  
  7: {
    name: 'Violence',
    color: '#8a2b2b',
    guardians: [
      { name: 'Genghis Khan', slot: 'LS3', maxHp: 41, corruption: 4 },
	  { name: 'Alexander the Great', slot: 'S3', maxHp: 38, corruption: 4 },
    ],
  },
  
  8: {
    name: 'Fraud',
    color: '#5b3170',
    guardians: [
      { name: 'Potiphars Wife', slot: 'F1', maxHp: 42, corruption: 4 },
	  { name: 'Defiler', slot: 'N3', maxHp: 44, corruption: 4 },
    ],
  },
  // 3: { name: 'Gluttony', ... },
  // ... fill in as each circle's guardian roster is finalized. combat.js
  // treats a missing ring key as an error (loudly, not silently) rather
  // than falling back to Limbo -- see combat.js integration notes.
};

// Shared across all circles (per your existing FiendNumbers.xlsx roster).
// If later circles need their OWN fiend pools instead of one shared pool,
// this becomes CIRCLES_BY_RING[ring].fiends and drawFiend() takes a ring
// arg -- flagging that as a likely future ask, not building it preemptively.
export const FIEND_POOL = [
  { num: 1, name: 'Addrammelech' },
  { num: 2, name: 'Agares' },
  { num: 3, name: 'Callista' },
  { num: 4, name: 'Devourer' },
  { num: 5, name: 'Grendel' },
  { num: 6, name: 'Grin Repear' },
  { num: 7, name: 'Hellari' },
  { num: 8, name: 'Hell Goat' },
  { num: 9, name: 'Leraje' },
  { num: 10, name: 'Locust' },
  { num: 11, name: 'Lyssa' },
  { num: 12, name: 'Malphas' },
  { num: 13, name: 'Marchosias' },
  { num: 14, name: 'Sin Seeker' },
  { num: 15, name: 'Vassago' },
  { num: 16, name: 'Wraith' },
  { num: 17, name: 'Zagan' },
];

// Ring number at/beyond which the harder fiend variant is drawn instead
// (same number, tougher block -- LH icon). Was HARDER_FIEND_THRESHOLD
// against a circle-name-index; now directly a ring number since that's
// what combat.js will actually be holding.
export const HARDER_FIEND_RING_THRESHOLD = 6;

// Fiends are dealt only on rings 2 (Lust) through 8 (Fraud) -- Limbo
// (ring 1) never deals one. declareEnemies()/declareOverseerEncounter()
// in combat.js previously called drawFiend() unconditionally for every
// ring, including Limbo, which is what let a fiend show up in a preview
// where it shouldn't have been possible at all.
export const FIEND_MIN_RING = 2;
export const FIEND_MAX_RING = 8;

export function shouldDealFiend(ring) {
  return ring >= FIEND_MIN_RING && ring <= FIEND_MAX_RING;
}

// --- HELL LORD ---
// The final boss. Not tied to any ring (it's the special node beyond the
// last ring, not a normal CIRCLES_BY_RING entry), so this is a
// standalone pool rather than something looked up by ring number, same
// spirit as ORDEAL_ENCOUNTERS being ring-independent.
//
// A POOL now, not a single fixed record -- getHellLord() below draws one
// at random each time a Hell Lord fight is declared, same
// pick-one-at-random pattern ORDEAL_ENCOUNTERS/getOrdealEncounter() use
// just below. "Corrupted Cherubim" was the only entry before; kept here
// as the pool's first member. Add more entries in the same shape
// (name/hpPerPlayer/corruptionPerPlayer/slotsByPriority) as you have
// them -- nothing else needs to change, same "just add an entry" promise
// CIRCLES_BY_RING and FIEND_POOL already make elsewhere in this file.
export const HELL_LORD_POOL = [
  {
    name: 'Corrupted Cherubim',
    hpPerPlayer: 71,
    corruptionPerPlayer: 10,
    slotsByPriority: ['N1', 'N3', 'LS3', 'SW1'],
  },
];

export function getHellLord() {
  if (HELL_LORD_POOL.length === 0) {
    throw new Error('enemyData: HELL_LORD_POOL is empty. Add at least one Hell Lord entry.');
  }
  return HELL_LORD_POOL[Math.floor(Math.random() * HELL_LORD_POOL.length)];
}

// Fiends dealt DURING a Hell Lord fight (once/if any get introduced --
// per spec, none are dealt up front, unlike a normal Clash or Overseer
// fight) come from this SEPARATE pool, not the regular FIEND_POOL above.
//
// PLACEHOLDER / INCOMPLETE -- this is deliberately empty. Two things are
// still needed from you before this can do anything: (1) the actual
// roster of Hell-Lord-specific fiends (same {num, name} shape as
// FIEND_POOL), and (2) the trigger condition for WHEN during a Hell Lord
// fight they should start being introduced -- "initially" implies a
// later phase change, but nothing in what's been described so far pins
// down what causes that change (a turn count? the Hell Lord's own HP
// crossing a threshold? something else?). drawHellLordFiend() below is
// wired up and ready (same depleting-pool-with-reshuffle pattern as
// drawFiend()) for whenever both of those are filled in -- it just isn't
// CALLED from anywhere in combat.js yet, since calling it requires
// deciding that trigger first.
export const HELL_LORD_FIEND_POOL = [];

let hellLordFiendPoolRemaining = [];

export function drawHellLordFiend() {
  if (HELL_LORD_FIEND_POOL.length === 0) {
    throw new Error(
      'enemyData: HELL_LORD_FIEND_POOL is empty. Add the Hell Lord fiend roster before drawHellLordFiend() can be used.'
    );
  }
  if (hellLordFiendPoolRemaining.length === 0) {
    hellLordFiendPoolRemaining = [...HELL_LORD_FIEND_POOL];
  }
  const idx = Math.floor(Math.random() * hellLordFiendPoolRemaining.length);
  return hellLordFiendPoolRemaining.splice(idx, 1)[0];
}

// Inquisitors -- the Ordeal-node counterpart to a Clash guardian or an
// Overseer boss. Deliberately minimal: unlike guardians/overseers, every
// Inquisitor uses the SAME speed slots (per your instruction that the
// slot values are already settled), so each entry here only needs a
// name. Keyed by id (lowercase, no spaces) so CIRCLES_BY_RING[ring].ordeal
// can reference one flexibly as the roster grows.
export const INQUISITORS = {
  ziz: { name: 'Ziz' },
};

// Speed slots assigned to each player's Inquisitor dot, in priority
// order -- same convention and same values as the Overseer's
// slotsByPriority (see Tristan and Isolde above): for a P-player combat,
// the first P entries are used, so a 3-player game never uses SW1.
// Shared across ALL Inquisitors (not per-entry) since every Inquisitor
// uses the same values per your instruction.
export const INQUISITOR_SLOTS_BY_PRIORITY = ['N1', 'N3', 'LS3', 'SW1'];

// Ordeals -- the actual thing being fought/timed in an Ordeal node. An
// Inquisitor never has health/corruption that can be depleted (see
// getOrdealEncounter's caller in combat.js); the Ordeal itself is what
// players are racing to clear before it runs out of turns. Keyed by id
// so an ORDEAL_ENCOUNTERS entry's `ordealId` can reference one flexibly
// as the roster grows.
export const ORDEALS = {
  labyrinthOfRegrets: {
    name: 'Labyrinth of Regrets',
    // Initial corruption = baseCorruption + corruptionPerPlayer * numPlayers
    // (e.g. 2 players: 6 + 2*2 = 10).
    baseCorruption: 6,
    corruptionPerPlayer: 2,
    // Inquisitor turns allowed before failure -- the (turnsAllowed+1)th
    // Inquisitor turn triggers the loss. E.g. 3 allowed -> loss on turn 4.
    turnsAllowed: 3,
    // Added to the Ordeal's current corruption, times the number of
    // players, at the start of every real Inquisitor turn (i.e. every
    // time the shared per-player-dot threshold trips -- same mechanic as
    // an Overseer's cumulative threshold in combat.js).
    incrementalCorruptionPerPlayer: 1,
  },
};

// Ordeal encounters -- Inquisitor + Ordeal pairings. Deliberately NOT
// keyed by ring/circle: unlike guardians and Overseers, which genuinely
// differ per circle, an Inquisitor/Ordeal pairing can show up in an
// Ordeal node on ANY ring (the only thing that keeps Ordeals off a
// particular node at all is the map generator not placing an
// Ordeal-type node there in the first place -- e.g. never on the Hell
// Lord node -- which is a map-generation concern, not an enemyData one).
// This used to be modeled as a per-ring `circle.ordeal` field on
// CIRCLES_BY_RING (mirroring the Overseer's genuinely ring-bound data),
// with only ring 1 ever given one, tagged as "the first working example."
// Any Ordeal node generated on a different ring hit getOrdealForRing's
// missing-data error and crashed combat setup before anything had
// rendered -- a blank screen, not an obvious error dialog, since the
// throw happened mid-setup. This shared, ring-independent list replaces
// that: every ring's Ordeal node draws from the same roster.
export const ORDEAL_ENCOUNTERS = [{ inquisitorId: 'ziz', ordealId: 'labyrinthOfRegrets' }];

export function getCircleForRing(ringNumber) {
  const circle = CIRCLES_BY_RING[ringNumber];
  if (!circle) {
    throw new Error(
      `enemyData: no circle defined for ring ${ringNumber}. Add an entry to CIRCLES_BY_RING.`
    );
  }
  return circle;
}

// Same loud-error convention as getCircleForRing, for the Overseer-mode
// path specifically -- a ring can have guardians defined but no overseer
// yet (or vice versa), so this is checked separately rather than folded
// into getCircleForRing.
export function getOverseerForRing(ringNumber) {
  const circle = getCircleForRing(ringNumber);
  if (!circle.overseer) {
    throw new Error(
      `enemyData: ring ${ringNumber} (${circle.name}) has no overseer defined. Add an 'overseer' entry to its CIRCLES_BY_RING record.`
    );
  }
  return circle.overseer;
}

// Ordeal-mode counterpart to getOverseerForRing -- but unlike that
// function (and unlike this one's own predecessor, getOrdealForRing),
// this does NOT take a ring argument at all: it draws a random pairing
// from the shared, ring-independent ORDEAL_ENCOUNTERS roster (see its own
// comment above) and resolves it against the INQUISITORS/ORDEALS
// registries. A ring's own number still matters elsewhere in combat.js
// for picking a harder FIEND variant (HARDER_FIEND_RING_THRESHOLD) --
// fiend difficulty genuinely does scale with depth -- but never for which
// Inquisitor/Ordeal shows up.
export function getOrdealEncounter() {
  if (ORDEAL_ENCOUNTERS.length === 0) {
    throw new Error('enemyData: ORDEAL_ENCOUNTERS is empty. Add at least one {inquisitorId, ordealId} pairing.');
  }
  const pick = ORDEAL_ENCOUNTERS[Math.floor(Math.random() * ORDEAL_ENCOUNTERS.length)];
  const inquisitor = INQUISITORS[pick.inquisitorId];
  if (!inquisitor) {
    throw new Error(
      `enemyData: ORDEAL_ENCOUNTERS references unknown inquisitorId "${pick.inquisitorId}". Add it to INQUISITORS.`
    );
  }
  const ordeal = ORDEALS[pick.ordealId];
  if (!ordeal) {
    throw new Error(`enemyData: ORDEAL_ENCOUNTERS references unknown ordealId "${pick.ordealId}". Add it to ORDEALS.`);
  }
  return { inquisitor, ordeal };
}

// Soul shards awarded on WINNING a node of this type, per player.
// Confirmed: only Clash (STANDARD_COMBAT) and Overseer wins pay out —
// Timed Challenge and Ordeal are combat-classified (isCombatType() is
// true for both, so they still route into combat.js the same way) but do
// NOT award shards. Any node type absent from this table -> 0 shards; see
// combat.js's victory handler, which looks up `SOUL_SHARD_AWARDS[nodeType]
// || 0` rather than assuming every combat type has an entry.
export const SOUL_SHARD_AWARDS = {
  STANDARD_COMBAT: 1, // "Clash"
  OVERSEER: 2,
};
