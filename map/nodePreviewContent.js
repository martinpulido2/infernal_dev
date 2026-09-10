// nodePreviewContent.js
//
// Display copy for the node preview cards: title, flavor text (an
// in-world quote), and a plain description of what the node means.
// Pure data — no rendering concerns here.

import { NODE_TYPES } from './mapConstants.js';

export const NODE_PREVIEW_CONTENT = {
  [NODE_TYPES.STANDARD_COMBAT]: {
    title: 'Clash',
    flavor:
      "The fiends keep coming, screeching about damnation and brimstone like you haven't heard it all before.",
    description: 'Your party faces guardians from this Circle of Hell. Defeat them to continue.',
  },
  [NODE_TYPES.OVERSEER]: {
    title: 'Overseer',
    flavor: 'Then comes the one holding the leash. Big fellow. Bad temper.',
    description:
      'Your party faces an Overseer from this Circle of Hell. A more challenging encounter with a greater reward. Defeat the Overseer to continue.',
  },
  [NODE_TYPES.REST_POINT]: {
    title: 'Obsidian Hot Spring',
    flavor:
      "Who says Hell lacks all hospitality? Fine. Everyone. But with a little renovation... less fire, fewer screaming souls, maybe a nice cafe... imagine the possibilities.",
    description: 'Heal your characters, for a cost.',
  },
  [NODE_TYPES.REFLECTION_CHAMBER]: {
    title: 'Reflection Chamber',
    flavor: "I've turned over a new leaf! Granted, it looks a lot like the old one, but it feels different.",
    description: 'Repurpose your virtues and vices, and reduce corruption for a cost.',
  },
  [NODE_TYPES.TIMED_CHALLENGE]: {
    title: 'Time Trial',
    flavor: 'This challenge is fair. In the same way that a tornado is fair to a paper glider.',
    description: "You'll face a timed challenge. Win or lose, remove it from the game.",
  },
  [NODE_TYPES.ORDEAL]: {
    title: 'Ordeal',
    flavor: 'Ah, personal growth. The thrilling process of discovering past you was an idiot.',
    description:
      'You will face an invulnerable inquisitor of Hell and a taxing ordeal. Overcome the ordeal before time runs out to earn a reward.',
  },
  [NODE_TYPES.HELL_LORD]: {
    title: 'Hell Lord',
    flavor:
      "The Tree of Life, they called it once. Now it's just a gnarled spire of black timber, drinking deep from the wretched soil of the pit.",
    description: 'Before you can destroy this cursed Tree of Life, you must defeat the Hell Lord defending it.',
  },
};
