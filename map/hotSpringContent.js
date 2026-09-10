// hotSpringContent.js
//
// Display copy + effect data for the Hot Spring (REST_POINT) node's
// interactive resolution screen. Pure data — no rendering concerns here,
// same convention as descentPhaseContent.js and nodePreviewContent.js.
//
// corruptionDelta is the ONLY part of each option the app actually
// executes numerically — per spec, healing and deck/crypt actions are
// physical, player-performed actions with no digital equivalent (there's
// no per-player health or deck tracked anywhere in gameState; only party
// corruption and soul shards are app-tracked). corruptionDelta is applied
// PER PLAYER who locks in that option — e.g. two players choosing Long
// Soak adds 2 total party corruption, not 1 — see mapRenderer.js's
// tryResolveHotSpring().

export const HOT_SPRING_HEADER = 'Hot Spring';
export const HOT_SPRING_SUBTEXT = 'Each player may perform each action once.';

export const HOT_SPRING_OPTIONS = [
  {
    id: 'quickDip',
    title: 'Quick Dip',
    description: 'Heal 1. Shuffle 2 cards from your crypt back into your deck.',
    corruptionDelta: 0,
  },
  {
    id: 'longSoak',
    title: 'Long Soak',
    description: 'Heal 3, but players gain 1 corruption.',
    corruptionDelta: 1,
  },
  {
    id: 'resist',
    title: 'Resist',
    description: 'Players lose 2 corruption.',
    corruptionDelta: -2,
  },
];
