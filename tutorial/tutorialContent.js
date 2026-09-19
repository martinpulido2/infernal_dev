// tutorial/tutorialContent.js
//
// Pure data: chapter/step copy plus a diagram DESCRIPTOR (not a rendered
// diagram) for each step. Same "pure data, no rendering concerns"
// convention as narrative/narrativeContent.js, map/nodePreviewContent.js,
// map/hotSpringContent.js, and map/reflectionChamberContent.js -- editing
// tutorial copy or step order never touches tutorialOverlay.js or
// tutorialDiagrams.js.
//
// Each diagram descriptor is { builder: <name in tutorialDiagrams.js>,
// args: <args object, or undefined> } -- tutorialOverlay.js maps the name
// to the actual function at render time. A step with no `diagram` field
// just shows text.

import { HOT_SPRING_OPTIONS } from '../map/hotSpringContent.js';
import { REFLECTION_CHAMBER_OPTIONS } from '../map/reflectionChamberContent.js';

export const TUTORIAL_WELCOME = {
  title: 'Welcome to Infernal',
  text:
    "This is a quick tour of how the app works — not the rules on your cards, just what to tap, drag, and double-tap to run a game smoothly. Pick a chapter below, or go through them in order. You can reopen this any time.",
};

export const TUTORIAL_CHAPTERS = [
  {
    id: 'orientation',
    title: 'Player & Orientation',
    blurb: 'Claiming seats and telling the app where everyone is sitting.',
    steps: [
      {
        text: 'Double-tap the swirling abyss on the opening screen to begin.',
        diagram: { builder: 'doubleTapDiagram', args: ['2×  ABYSS'] },
      },
      {
        text: 'Each corner shows character portraits. Tap one to claim that seat — 1 to 4 players can join.',
        diagram: { builder: 'charTokenDiagram' },
      },
      {
        text: 'When everyone has picked a character, tap the glowing green Lock In button in the center to confirm the party.',
      },
      {
        text: "Next, each seated player taps the arrow that points toward them — this tells the app which physical edge of the tablet you're sitting at, so your HUD renders right-side-up for you.",
        diagram: { builder: 'orientationArrowsDiagram' },
      },
      {
        text: "Once locked in, your seat shows a \"Player N\" label. The run can't continue until every active seat has an orientation.",
      },
    ],
  },
  {
    id: 'mode',
    title: 'Game Mode',
    blurb: 'Choosing Standard or Rush once for the whole party.',
    steps: [
      {
        text: 'A mode panel appears alongside orientation selection. This is chosen once for the whole party, not per player.',
        diagram: { builder: 'modeSelectDiagram' },
      },
      {
        text: 'Standard requires a combat node on every ring. Rush only requires one every other ring, for a faster run.',
      },
      {
        text: "The map won't open until both a mode and every player's orientation are set.",
      },
    ],
  },
  {
    id: 'map',
    title: 'Map Mode',
    blurb: 'Reading node states, moving, and Hot Spring / Reflection choices.',
    steps: [
      {
        text: 'Tap a node to preview it. It tints red and a card with its name and description opens in your corner.',
        diagram: { builder: 'nodeStatesDiagram' },
      },
      {
        text: "Tap that same node again to confirm the move. Tapping a different node just moves the preview instead — nothing commits until the second tap on the same node.",
      },
      {
        text: 'Dim nodes are not currently reachable. Bright, glowing nodes are legal moves — that brightness is the only signal for "where can I go," so watch for it.',
      },
      {
        text: 'Each ring needs at least one combat node faced before the party can descend to the next ring — the map simply won\'t light up the descend option until that\'s true.',
      },
      {
        text: 'Seven node types to recognize, plus the Hell Lord at the center of the whole map.',
        diagram: {
          builder: 'nodeTypeGridDiagram',
          args: [['STANDARD_COMBAT', 'OVERSEER', 'REST_POINT', 'REFLECTION_CHAMBER', 'TIMED_CHALLENGE', 'ORDEAL', 'HELL_LORD']],
        },
      },
      {
        text: 'At an Obsidian Hot Spring, each player may take each option once.',
        diagram: { builder: 'optionCardsDiagram', args: [HOT_SPRING_OPTIONS] },
      },
      {
        text: 'At a Reflection Chamber, each player may likewise take each option once.',
        diagram: { builder: 'optionCardsDiagram', args: [REFLECTION_CHAMBER_OPTIONS] },
      },
      {
        text: 'Descending to a new ring opens a "Descending…" screen with that ring\'s effect text — these are physical, player-performed instructions the app is showing you, not something it does for you. Tap to proceed.',
      },
    ],
  },
  {
    id: 'preview',
    title: 'Combat Preview',
    blurb: 'Reading the declaration screen and pulling the right physical cards.',
    steps: [
      {
        text: "Before combat starts, each seat shows a Guardian card with its starting HP (red) and corruption (gold). Pull that enemy's physical card and place it at that seat.",
        diagram: { builder: 'guardianCardDiagram', args: [{ name: 'GUARDIAN', hp: 6, corruption: 3, color: '#e53935' }] },
      },
      {
        text: 'A numbered Fiend may also be listed below the Guardian — pull that card too. In an Ordeal encounter, this line shows the Ordeal\'s name instead, and no fiend is dealt.',
        diagram: { builder: 'guardianCardDiagram', args: [{ name: 'GUARDIAN', hp: 6, corruption: 3, color: '#e53935', isFiend: true, fiendNum: 2 }] },
      },
      {
        text: 'Once every card is pulled and placed, double-tap anywhere on the screen to begin combat.',
        diagram: { builder: 'doubleTapDiagram', args: ['2×  BEGIN'] },
      },
    ],
  },
  {
    id: 'combat',
    title: 'Combat',
    blurb: 'The speed ring, action line, control ring, corruption, undo, and consoles.',
    steps: [
      {
        text: 'The outer ring is players; the inner ring is enemies. Dots travel clockwise toward the action line at the top as time passes.',
        diagram: { builder: 'speedRingDiagram', args: [{ dots: [{ radius: 150, angle: -40, color: '#43a047' }, { radius: 130, angle: -100, color: '#e53935' }] }] },
      },
      {
        text: "A player's dot is their own character color. An enemy dot is colored to match whichever player it's currently facing — not a fixed enemy color.",
      },
      {
        text: "The orange arc marks the last stretch before the action line — it's a rules zone: any unit inside it that takes damage suffers Knockback Level 1.",
        diagram: { builder: 'speedRingDiagram', args: [{ showArc: true }] },
      },
      {
        text: 'Tap a dot to select it. If several dots are stacked together, the first tap only fans them apart — tap again to pick one.',
      },
      {
        text: 'Double-tap anywhere with nothing selected to pause or resume the ring — this is also how you advance past a unit waiting at the action line.',
        diagram: { builder: 'doubleTapDiagram', args: ['2×  RING'] },
      },
      {
        text: 'A curved speed queue previews upcoming turn order. It\'s a forecast, not a guarantee — tap a queue icon to freeze a closer look (a Simulation Snapshot), and tap elsewhere to clear it.',
      },
      {
        text: 'Drag a unit dot left or right (tangentially) to speed it up or slow it down. A full rotation of drag equals one full speed-tier step, with a live ghost preview of who it passes.',
        diagram: { builder: 'gestureArrowDiagram', args: ['tangential'] },
      },
      {
        text: 'Drag a unit dot toward or away from center (radially) for Knockback — pushing it back or forward along the ring, with a ghost arc previewing the range.',
        diagram: { builder: 'gestureArrowDiagram', args: ['radial'] },
      },
      {
        text: 'Three buttons sit on the center control ring: Anchor (blue) locks units in place; Rally (green) advances every unit of one type by a shared pool of motion; Obstacle (grey) places a boulder on either ring.',
        diagram: { builder: 'speedRingDiagram', args: [{ showControlRing: true, showArc: false }] },
      },
      {
        text: 'The center donut is the corruption ring. Press and drag it clockwise to add party corruption, or counterclockwise to remove it — nothing commits until you release.',
        diagram: { builder: 'corruptionRingDiagram' },
      },
      {
        text: "The pause button does double duty: with nothing else active it pauses/resumes, but with Anchor, Obstacle, or a Rally preview open, the same button cancels that mode instead. Remember this as your universal Back button.",
      },
      {
        text: 'The ↺ Undo button on every console steps back one full turn at a time — including any corruption change that turn caused.',
      },
      {
        text: "When a seat faces more than one enemy group, colored dots above its console switch which group's stats are shown. Drag left/right on the HP or corruption number to adjust it.",
        diagram: { builder: 'consoleDiagram' },
      },
      {
        text: 'The skull button marks the shown enemy defeated. Consume moves 1 corruption from that enemy to the party. Taint pushes 1 corruption from the party onto that enemy.',
      },
    ],
  },
  {
    id: 'shared',
    title: 'Shared Encounters',
    blurb: 'Overseer, Hell Lord, and the Ordeal / Inquisitor.',
    steps: [
      {
        text: 'Overseer and Hell Lord fights use one shared HP/corruption pool. Per-player dots must cumulatively reach a threshold before the boss activates against everyone at once.',
        diagram: { builder: 'sharedThresholdDiagram' },
      },
      {
        text: 'The "X / Y" ticker on every console tracks progress toward that shared activation — the same ticker is used for Overseer, Hell Lord, and Ordeal.',
      },
      {
        text: "An Ordeal adds a separate white toggle dot on the console for the Ordeal card itself. It shows rounds remaining (a countdown, not a resource to spend) instead of HP, plus a draggable corruption value.",
        diagram: { builder: 'ordealCardDiagram' },
      },
      {
        text: "The Inquisitor accompanying an Ordeal has infinite HP and corruption and no skull button — it can't be defeated. Winning the Ordeal itself uses the separate skull button on the Ordeal card.",
      },
      {
        text: "Play an Ordeal as a race against its round countdown, not a fight to reduce a stat to zero.",
      },
    ],
  },
];
