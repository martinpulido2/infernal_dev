// descentPhaseContent.js
//
// Text shown during the "descending" interstitial — the phase that plays
// before a player actually arrives at a node on a lower circle. Keyed by
// the ring number being entered (2-8), plus a special entry for the
// final descent onto the Hell Lord (Circle 9 / Betrayal — there's no
// separate 9th ring in this map; the Hell Lord occupies that position
// directly, per the map's own structure).
//
// Pure data — no rendering concerns here.

import { HELL_LORD_ID } from './mapConstants.js';

export const DESCENT_PHASE_HEADER = 'Descending...';

export const DESCENT_PHASE_CONTENT = {
  2: "Corrupt 1 of your deck's top 3 cards, and put them back atop your deck.",
  3: "Corrupt 1 of your deck's top 3 cards, and put them back atop your deck. Awaken 1 potential.",
  4: "Corrupt 1 of your deck's top 3 cards, and put them back atop your deck.",
  5: "Corrupt 1 of your deck's top 3 cards, and put them back atop your deck. Awaken 1 potential.",
  6: "Corrupt 1 of your deck's top 3 cards, and put them back atop your deck. Fiends grow stronger.",
  7: "Corrupt 1 of your deck's top 3 cards, and put them back atop your deck. Awaken 1 potential.",
  8: "Corrupt 1 of your deck's top 3 cards, and put them back atop your deck.",
  [HELL_LORD_ID]:
    "Corrupt 1 of your deck's top 3 cards, and put them back atop your deck. Awaken 1 potential. Heal 5 health. Move Corruption back 1 level and set that corruption's level to 0.",
};
