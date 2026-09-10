// layoutConstants.js
//
// Single source of truth for "which literal screen corner does this
// player's UI live in, and what rotation makes it read right-side-up
// from their seat." Used identically by combat/combat.js's player
// consoles AND map/mapRenderer.js's node-preview cards + player HUD.
//
// This used to be defined independently in each file (map even had its
// own SVG-polar-coordinate version, unrelated to combat's plain CSS
// version) and the two definitions disagreed on corner ordering at one
// point — see INTEGRATION_NOTES.md. Pulling both into one shared module
// makes that class of bug structurally impossible: there's only one
// table to get right, and every consumer imports the same one.

// gameState corner indices (0=TL,1=TR,2=BL,3=BR, per orientation/select.js's
// cornerNames) -> the string keys CORNER_CSS below uses.
export const CORNER_INDEX_TO_NAME = {
  0: 'top-left',
  1: 'top-right',
  2: 'bottom-left',
  3: 'bottom-right',
};

// Raw CSS placement, flush to the literal screen corner. Deliberately
// plain position:fixed + top/left/right/bottom -- NOT SVG viewBox
// coordinates -- so it's pixel-identical regardless of any SVG's
// internal scaling/letterboxing. Both combat's consoles and the map's
// corner overlay use this same table.
export const CORNER_CSS = {
  'top-left': 'top:0; left:0;',
  'top-right': 'top:0; right:0;',
  'bottom-left': 'bottom:0; left:0;',
  'bottom-right': 'bottom:0; right:0;',
};

// Which edge of the table a player is actually seated at -> rotation
// applied to their whole corner box (around its own center) so its
// content reads right-side-up from that seat, regardless of which
// physical corner of the device the box itself sits flush against.
export const EDGE_ROTATION = { top: 180, right: 270, bottom: 0, left: 90 };

// Shared box size -- both combat's consoles and the map's corner overlay
// use the same footprint so a player's on-screen "home area" doesn't
// visibly resize/relocate when the game transitions between map and
// combat.
export const CORNER_BOX_SIZE = 378;
