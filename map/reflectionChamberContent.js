// reflectionChamberContent.js
//
// Display copy + effect data for the Reflection Chamber (REFLECTION_CHAMBER)
// node's interactive resolution screen. Pure data — no rendering concerns
// here, same convention as hotSpringContent.js, descentPhaseContent.js, and
// nodePreviewContent.js.
//
// corruptionDelta is the ONLY part of each option the app actually
// executes numerically — per spec, Rethink (swapping a possessed virtue
// for one of equal or lesser value in the virtue row) is a physical,
// player-performed action with no digital equivalent (there's no per-
// player virtue collection or virtue row tracked anywhere in gameState;
// only party corruption and soul shards are app-tracked). corruptionDelta
// is applied PER PLAYER who locks in that option — e.g. two players
// choosing Repent removes 4 total party corruption, not 2 — see
// mapRenderer.js's tryResolveReflectionChamber().

export const REFLECTION_CHAMBER_HEADER = 'Reflection Chamber';
export const REFLECTION_CHAMBER_SUBTEXT = 'Each player may perform each action once.';

export const REFLECTION_CHAMBER_OPTIONS = [
  {
    id: 'rethink',
    title: 'Rethink',
    description: 'Banish a virtue you possess and gain a virtue of equal or lesser value in the virtue row.',
    corruptionDelta: 0,
  },
  {
    id: 'repent',
    title: 'Repent',
    description: 'Remove 2 corruption.',
    corruptionDelta: -2,
  },
];
