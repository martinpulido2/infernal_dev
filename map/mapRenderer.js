// mapRenderer.js
//
// Framework-free SVG renderer for the Inferno descent map.
//
// Usage:
//   const renderer = createMapRenderer(containerEl, {
//     onNodeTap(nodeId) { ... },       // fired on the FIRST tap of a legal
//                                       // node (preview, not a commit)
//     onNodeConfirm(nodeId) { ... },   // fired on the SECOND tap of the
//                                       // same already-previewed node
//   });
//   renderer.render(map, runState, { revealMode: false });
//   ...later, after the host app calls applyMove()...
//   renderer.render(map, newRunState, { revealMode: false });
//   ...at run end...
//   renderer.render(map, finalRunState, { revealMode: true });
//
// DESIGN QUESTION FLAGGED BACK (unchanged from before): icons are rotated
// so their base points toward the center. For a shared tablet with players
// on multiple sides, nodes on the far side of a ring render upside-down
// from some seats. Still flagging in case that matters — happy to switch
// to upright icons + a separate inward-pointing tick if preferred.

import { RING_COUNT, RING_SIZES, HELL_LORD_ID, NODE_TYPES, angleForRingIndex } from './mapConstants.js';
import { buildIconDefsMarkup, NODE_TYPE_TO_SYMBOL_ID, ICON_VIEWBOX, ICON_CONTENT_BBOX } from './icons.js';
import { getLegalMoves } from './mapRunState.js';
import { NODE_PREVIEW_CONTENT } from './nodePreviewContent.js';
import { DESCENT_PHASE_HEADER, DESCENT_PHASE_CONTENT } from './descentPhaseContent.js';
import { HOT_SPRING_HEADER, HOT_SPRING_SUBTEXT, HOT_SPRING_OPTIONS } from './hotSpringContent.js';
import {
  REFLECTION_CHAMBER_HEADER,
  REFLECTION_CHAMBER_SUBTEXT,
  REFLECTION_CHAMBER_OPTIONS,
} from './reflectionChamberContent.js';
import { getState, subscribe, setPlayerSoulShards, adjustPartyCorruption } from '../gameState.js';
import { CORNER_INDEX_TO_NAME, CORNER_CSS, EDGE_ROTATION } from '../layoutConstants.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

// Ring colors — exact assignment as specified: 1 Green, 2 Yellow,
// 3 Brown, 4 Grey, 5 Blue, 6 Orange, 7 Red, 8 Purple, center Blue.
// The center is given a distinguishably different (deeper, icier) blue
// than Ring 5 so the two "Blue" rings don't read as the same ring at a
// glance — flagging that judgment call since both were specified as
// just "Blue."
const RING_COLORS = {
  1: '#2f6b3a', // Green
  2: '#c9a227', // Yellow
  3: '#6b4a2f', // Brown
  4: '#6b6b6b', // Grey
  5: '#2f5f8a', // Blue
  6: '#b5651d', // Orange
  7: '#8a2b2b', // Red
  8: '#5b3170', // Purple
};
const HELL_LORD_COLOR = '#12233d'; // deep navy — distinct from Ring 5's blue
const NODE_BADGE_FILL = '#efe6d8';
// Same lightness family as NODE_BADGE_FILL (a warm cream) so the tint
// reads as "this cream badge, tinted" rather than a totally different
// material -- keeps the icon's own artwork legible on top of either.
const PREVIEW_TINT_FILL = '#e3a89c'; // red tint -- "this is what you're previewing"
const COMPLETED_TINT_FILL = '#a9d6ad'; // green tint -- "already completed"
const GOLD = '#f4c14a';
// The traveled path -- both the connecting line between nodes you've
// actually walked (drawLine's committed-segments call) and the border
// ring on each of those nodes' own badges -- is green, matching this
// codebase's own existing "green = already completed" convention
// (COMPLETED_TINT_FILL just above). Gold stays reserved for the DASHED
// guidance lines to your currently-legal next moves, so the two read as
// a clear pair: green behind you, gold ahead of you.
const PATH_COLOR = '#4caf50';
const FLAME_OUTER = '#ff7a1a';
const FLAME_INNER = '#ffd24a';
const PREVIEW_TEXT_COLOR = '#efe6d8';
const PREVIEW_FLAVOR_COLOR = '#c9b896';
const DESCENT_CIRCLE_FILL = '#160f0a';
const DESCENT_HINT_COLOR = '#8a7060';

// ---- Corner preview cards + player HUD ----
//
// Node preview cards and the player HUD (soul shards + corruption) now
// render as an HTML overlay flush to each active player's literal screen
// corner, rotated per their seated edge — the exact same convention as
// combat/combat.js's player consoles (shared via ../layoutConstants.js),
// rather than the old SVG-polar-coordinate placement, which used a
// different corner-angle table and did NOT visually match combat's seat
// positions. See renderCornerOverlay() below.

// ---- Brightness/saturation tiers (spec's 4-tier system) ----
const TIERS = {
  CURRENT: { opacity: 1, saturate: 1 },
  NEXT: { opacity: 0.72, saturate: 0.8 },
  PASSED: { opacity: 0.32, saturate: 0.3 },
  FUTURE: { opacity: 0.16, saturate: 0.22 },
  REVEAL: { opacity: 1, saturate: 1 },
};

function tierForRing(ringNumber, currentRing, revealMode) {
  if (revealMode) return 'REVEAL';
  if (ringNumber === currentRing) return 'CURRENT';
  if (ringNumber === currentRing + 1) return 'NEXT';
  if (ringNumber < currentRing) return 'PASSED';
  return 'FUTURE';
}

// ---- Radial layout ----
const VIEW_SIZE = 1000;
const CENTER = VIEW_SIZE / 2;
const OUTER_RADIUS = 470;
const HELL_LORD_RADIUS = 78; // large, focal — "much bigger" per feedback
const BAND_GAP = 6;

function computeBandRadii() {
  const span = OUTER_RADIUS - HELL_LORD_RADIUS;
  const bandEdges = [];
  for (let k = 0; k <= RING_COUNT; k++) {
    bandEdges.push(HELL_LORD_RADIUS + (span * k) / RING_COUNT);
  }
  const bands = {};
  for (let r = 1; r <= RING_COUNT; r++) {
    const k = RING_COUNT + 1 - r;
    const rawOuter = bandEdges[k];
    const rawInner = bandEdges[k - 1];
    bands[r] = {
      outer: rawOuter - BAND_GAP / 2,
      inner: rawInner + BAND_GAP / 2,
      trueOuter: rawOuter, // untrimmed boundary — nodes sit here (the seam)
      width: rawOuter - rawInner - BAND_GAP,
    };
  }
  return bands;
}
const BAND_RADII = computeBandRadii();
const NODE_BADGE_RADIUS = Math.max(26, Math.min(42, (BAND_RADII[8].width || 44) * 0.62));

// The three full-screen resolution overlays (Descent / Hot Spring /
// Reflection Chamber) draw a solid circle at the map's center to host
// their header/body text. A flat 300px radius left the ring whose nodes
// sit just inside that boundary (ring 5, trueOuter 274) with their
// ANIMATED GLOW halo (NODE_BADGE_RADIUS * 1.55, same formula drawNode()
// uses for a legal-move node's glow) poking a few pixels past the solid
// circle's edge -- dimmed only by the overlay backdrop's 0.72 opacity
// rather than fully hidden the way the solid circle hides everything
// else inside it, which is what read as "a little bit of the halo glows
// brighter" right at the circle's boundary.
//
// Computed from the actual ring/glow geometry (rather than a bigger
// hand-picked number) so it can't quietly fall out of sync if
// RING_COUNT, the band radii, or NODE_BADGE_RADIUS ever change -- it
// always covers whichever ring's nodes+glow reach furthest while still
// starting inside the base 300px circle. Rings that start OUTSIDE 300
// (ring 4 at 323, and beyond) are deliberately left alone -- they were
// never meant to be swallowed by this circle, only dimmed by the
// backdrop like the rest of the map.
const OVERLAY_BASE_RADIUS = 300;
const OVERLAY_RINGS_MEANT_INSIDE = Object.values(BAND_RADII).filter((band) => band.trueOuter < OVERLAY_BASE_RADIUS);
const OVERLAY_WORST_CASE_GLOW_REACH = Math.max(
  0,
  ...OVERLAY_RINGS_MEANT_INSIDE.map((band) => band.trueOuter + NODE_BADGE_RADIUS * 1.55)
);
const OVERLAY_CIRCLE_RADIUS = Math.max(OVERLAY_BASE_RADIUS, OVERLAY_WORST_CASE_GLOW_REACH + 6);

function polar(radius, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180; // -90 so 0deg = up
  return { x: CENTER + radius * Math.cos(rad), y: CENTER + radius * Math.sin(rad) };
}

// A node's visual radius is the *seam* it shares with the ring outside it
// — "centered along the edge," per the reference boards, rather than
// floating mid-band. Ring 1's seam is the map's outer boundary itself.
function nodeRadiusForRing(ringNumber) {
  return BAND_RADII[ringNumber].trueOuter;
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function describeAnnulus(cx, cy, outerR, innerR) {
  const outer = `M ${cx - outerR} ${cy} A ${outerR} ${outerR} 0 1 0 ${cx + outerR} ${cy} A ${outerR} ${outerR} 0 1 0 ${cx - outerR} ${cy} Z`;
  const inner = `M ${cx - innerR} ${cy} A ${innerR} ${innerR} 0 1 1 ${cx + innerR} ${cy} A ${innerR} ${innerR} 0 1 1 ${cx - innerR} ${cy} Z`;
  return `${outer} ${inner}`;
}

// Shortest-direction arc between two angles at a fixed radius, as an SVG
// path `d` string. Always the minor arc (<=180 degrees) -- always correct
// here since every guidance/committed arc is between angularly-close
// nodes.
function arcPathD(radius, angleStart, angleEnd) {
  const delta = ((((angleEnd - angleStart + 540) % 360) + 360) % 360) - 180; // (-180, 180]
  const sweep = delta >= 0 ? 1 : 0;
  const p1 = polar(radius, angleStart);
  const p2 = polar(radius, angleEnd);
  return `M ${p1.x} ${p1.y} A ${radius} ${radius} 0 0 ${sweep} ${p2.x} ${p2.y}`;
}

function linePathD(p1, p2) {
  return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
}

// Rough word-wrap for SVG text (no automatic reflow, unlike HTML). Not
// pixel-perfect — estimates each character as a fraction of font-size —
// but good enough for card copy at fixed font sizes, and cheap.
function wrapText(text, fontSize, maxWidth, avgCharWidthFactor = 0.56) {
  const maxChars = Math.max(6, Math.floor(maxWidth / (fontSize * avgCharWidthFactor)));
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function multilineText(x, startY, lines, lineHeight, attrs) {
  const el = svgEl('text', { x, y: startY, 'text-anchor': 'middle', ...attrs });
  lines.forEach((line, i) => {
    const tspan = svgEl('tspan', { x, dy: i === 0 ? 0 : lineHeight });
    tspan.textContent = line;
    el.appendChild(tspan);
  });
  return el;
}

// Shared by the Hot Spring and Reflection Chamber overlays (Descent's own
// header is a short fixed constant -- "Descending..." -- that was never
// at risk of this). A header rendered as one fixed-width <text> line
// (the old approach) overflows the circle's edge for anything longer
// than a couple of words -- "Reflection Chamber" specifically overran
// it. Wraps the same way the body text below it already does, and
// returns how many lines it actually took so the caller can push the
// body down by the extra line height rather than the two blocks
// colliding when a header wraps to 2 lines instead of the usual 1.
function renderCircleHeader(circleGroup, circleR, headerText) {
  const headerFontSize = 38;
  const headerLineHeight = 44;
  const headerMaxWidth = circleR * 1.62;
  // 0.72, not wrapText's generic 0.56/0.6 defaults -- this header renders
  // bold AND with letter-spacing:1.5 (an extra ~1.5px between every
  // character pair, on top of the bold glyphs already being wider than
  // regular weight), neither of which wrapText's plain per-character
  // estimate accounts for. At the body text's own 0.6 factor, "Reflection
  // Chamber" (19 chars) was estimated to fit on one line and DIDN'T wrap
  // -- while the ACTUAL rendered text, letter-spacing and bold weight
  // included, ran past the circle's edge. 0.72 is tuned so a
  // two-word title-length header like that one reliably wraps instead of
  // slipping through the estimate.
  const headerLines = wrapText(headerText, headerFontSize, headerMaxWidth, 0.72);
  const header = multilineText(0, -circleR + 76, headerLines, headerLineHeight, {
    fill: GOLD,
    'font-family': "'Georgia', 'Times New Roman', serif",
    'font-weight': 'bold',
    'font-size': headerFontSize,
    'letter-spacing': '1.5',
  });
  circleGroup.appendChild(header);
  return { lineCount: headerLines.length, lineHeight: headerLineHeight };
}

// ---------------------------------------------------------------------
// Node position/lookup helpers
// ---------------------------------------------------------------------
function buildNodeIndex(map) {
  const byId = new Map();
  for (const ring of map.rings) {
    const size = ring.size ?? RING_SIZES[ring.ring];
    ring.nodes.forEach((node, index) => {
      const angle = angleForRingIndex(ring.ring, index, size);
      const radius = nodeRadiusForRing(ring.ring);
      byId.set(node.id, { ...node, angle, radius, pos: polar(radius, angle) });
    });
  }
  byId.set(HELL_LORD_ID, {
    id: HELL_LORD_ID,
    ring: null,
    type: NODE_TYPES.HELL_LORD,
    angle: 0,
    radius: 0,
    pos: { x: CENTER, y: CENTER },
  });
  return byId;
}

// Two path elements (radial-in segment + arc segment) describing the
// "points to center until it hits the next ring, then traces that ring's
// edge to the target" guidance/commit line described in the reference
// boards. Returns an array of `d` strings (1 or 2 of them).
function connectorSegments(fromInfo, toInfo) {
  if (toInfo.id === HELL_LORD_ID) {
    // Straight line in to the center -- nothing to trace around once
    // you're descending onto a single point.
    return [linePathD(fromInfo.pos, { x: CENTER, y: CENTER })];
  }
  if (fromInfo.ring === toInfo.ring) {
    // Lateral move: single arc at the shared ring radius.
    return [arcPathD(fromInfo.radius, fromInfo.angle, toInfo.angle)];
  }
  // Descend: radial segment from the source node in to the target ring's
  // radius (at the source's own angle), then an arc at the target radius
  // over to the target node's actual angle.
  const midPoint = polar(toInfo.radius, fromInfo.angle);
  const radial = linePathD(fromInfo.pos, midPoint);
  const arc = arcPathD(toInfo.radius, fromInfo.angle, toInfo.angle);
  return [radial, arc];
}

export function createMapRenderer(container, handlers = {}) {
  const { onNodeTap = () => {}, onNodeConfirm = () => {} } = handlers;

  let svg = null;
  let previewNodeId = null;
  let currentMap = null;
  let currentPositionNodeId = null; // runState.currentNodeId, tracked for click handlers
  let pendingDescentNodeId = null; // set while the "Descending..." interstitial is up, awaiting a double-tap anywhere
  let descentOverlayGroup = null;
  let lastAnywhereTapTime = 0;
  // Same tier of state as the two above (transient, renderer-local, NOT
  // persisted to gameState) -- set while the Hot Spring node's resolution
  // screen is up. hotSpringSelections is keyed by player INDEX (matching
  // state.players' array order, not a player id) -> { choice: one of
  // HOT_SPRING_OPTIONS' ids or null, locked: bool }. Reset fresh every
  // time the overlay opens, same as combat's own per-combat state resets
  // fresh every declaration.
  let pendingHotSpringNodeId = null;
  let hotSpringSelections = {};
  let hotSpringOverlayGroup = null;
  // Same tier of state again, for the Reflection Chamber node -- same
  // per-player-index-keyed shape as hotSpringSelections above ({ choice:
  // one of REFLECTION_CHAMBER_OPTIONS' ids or null, locked: bool }), kept
  // as its own independent trio of variables rather than generalized
  // alongside Hot Spring's, matching this file's existing convention that
  // each non-combat node type's resolution screen is its own independent
  // pass (see updateHotSpringOverlay's own comment on this) even though
  // the interaction model is identical.
  let pendingReflectionNodeId = null;
  let reflectionSelections = {};
  let reflectionOverlayGroup = null;
  // hudBoxes / previewBoxes (playerIndex -> HTML element) are declared
  // down with renderHudBox/renderPreviewBox, right next to the functions
  // that own them -- kept as two independent maps, not one, since that's
  // the whole point of the split (see the comment there).

  function ensureSvg() {
    if (svg) return svg;
    container.innerHTML = '';
    svg = svgEl('svg', {
      viewBox: `0 0 ${VIEW_SIZE} ${VIEW_SIZE}`,
      width: '100%',
      height: '100%',
      style: 'display:block;background:#0c0a0d;',
    });
    const defsWrapper = document.createElementNS(SVG_NS, 'defs');
    defsWrapper.innerHTML =
      buildIconDefsMarkup().replace(/^<defs>|<\/defs>$/g, '') + buildSharedGradientsMarkup();
    svg.appendChild(defsWrapper);
    container.appendChild(svg);
    return svg;
  }

  function buildSharedGradientsMarkup() {
    // Fiery, shimmering, semi-transparent glow -- a radial gradient ring
    // (transparent center and outer edge, fire-colored band in between)
    // so the underlying node icon stays fully legible through it.
    return (
      '<radialGradient id="fiery-glow-gradient" cx="50%" cy="50%" r="50%">' +
      '<stop offset="0%" stop-color="' + FLAME_INNER + '" stop-opacity="0"/>' +
      '<stop offset="58%" stop-color="' + FLAME_INNER + '" stop-opacity="0"/>' +
      '<stop offset="78%" stop-color="' + FLAME_INNER + '" stop-opacity="0.85"/>' +
      '<stop offset="92%" stop-color="' + FLAME_OUTER + '" stop-opacity="0.65"/>' +
      '<stop offset="100%" stop-color="' + FLAME_OUTER + '" stop-opacity="0"/>' +
      '</radialGradient>'
    );
  }

  function render(map, runState, options = {}) {
    const revealMode = !!options.revealMode;
    const root = ensureSvg();
    Array.from(root.children).forEach((child) => {
      if (child.tagName.toLowerCase() !== 'defs') root.removeChild(child);
    });
    // Every full-canvas overlay group (descent / Hot Spring / Reflection
    // Chamber) just got detached by the wipe above, along with everything
    // else -- reset ALL THREE of their JS references here, not just
    // descentOverlayGroup.
    //
    // This was the root cause of "Hot Spring not marking, infinite
    // descend loop, Overseer refightable forever": render() can be
    // triggered by something totally unrelated to whichever overlay is
    // currently open -- e.g. a soul-shard drag on the HUD, which stays
    // interactive even while Hot Spring/Reflection Chamber is up, and
    // commits via patchPlayer -> patchState -> a synchronous notify() that
    // calls render() again. If that happens while, say, hotSpringOverlayGroup
    // still pointed at a live group, the wipe above detached that group
    // from the DOM WITHOUT clearing the variable. The next
    // updateHotSpringOverlay() call -- either later in this very render()
    // pass, or from the resolution screen's own confirm button -- would
    // then call svg.removeChild() on a node that's no longer actually a
    // child of svg, which throws. Because the throw happens on the line
    // BEFORE the variable gets reset to null, hotSpringOverlayGroup stayed
    // stuck at that same stale reference forever after -- meaning EVERY
    // future render() threw at that identical point, permanently, silently
    // aborting whatever triggered it. That's how a single stray render()
    // could take down the Hot Spring confirm button's own onNodeConfirm()
    // call (never marking the node visited), and later even an unrelated
    // Overseer combat-victory commit (same cascade: patchState's
    // synchronous notify() -> render() -> throw -> the rest of that
    // victory-handling callback, including its own commitMove(), never
    // ran) -- without a single visible crash, since browsers swallow
    // exceptions thrown inside event handlers rather than halting the
    // page.
    descentOverlayGroup = null;
    hotSpringOverlayGroup = null;
    reflectionOverlayGroup = null;
    currentMap = map;
    currentPositionNodeId = runState.currentNodeId;

    const nodeIndex = buildNodeIndex(map);
    const legalMoves = revealMode ? new Set() : new Set(getLegalMoves(runState));
    const pathSet = new Set(runState.path || []);
    const currentRing = runState.currentRing;

    // Pass 1: ring background annuli (bottom layer, never paints over a
    // node badge regardless of how far badges overlap the seam).
    for (let r = 1; r <= RING_COUNT; r++) {
      drawRingBackground(root, r, currentRing, revealMode);
    }

    // Pass 2: guidance + committed connector lines (dashed for legal-but-
    // not-yet-taken, solid gold for the path actually walked so far).
    drawConnectors(root, map, runState, nodeIndex, legalMoves, revealMode);

    // Pass 3: node badges + icons + glow + gold rings, always on top so
    // lines read as running "into" each node rather than over its icon.
    for (let r = 1; r <= RING_COUNT; r++) {
      drawRingNodes(root, map, r, runState, { revealMode, legalMoves, pathSet, currentRing });
    }

    drawHellLord(root, runState, revealMode, legalMoves, pathSet);

    // Pass 3.5 (HTML, not SVG): per-player corner overlay -- node preview
    // card (when a node is being previewed) stacked directly above the
    // always-visible HUD (soul shards + party corruption), one box per
    // active player, positioned/rotated exactly like combat's player
    // consoles. Handles both the "always visible" HUD and the "on demand"
    // preview in one call since they now share one DOM box per player and
    // have to be laid out together to avoid overlapping.
    renderCornerOverlay();

    // Pass 5: the "Descending..." interstitial, if a descend is pending
    // confirmation — this is the true top layer, blocking interaction
    // with everything else until resolved.
    updateDescentOverlay();

    // Pass 6: the Hot Spring resolution screen, if that node's overlay is
    // open — same "true top layer" role as Pass 5, just for a different
    // node type. Mutually exclusive with the descent overlay in practice
    // (resolveConfirmedNode only ever sets one or the other), but drawn
    // as its own independent pass rather than folded into Pass 5 since
    // its content and interaction model are unrelated.
    updateHotSpringOverlay();

    // Pass 7: the Reflection Chamber resolution screen, if that node's
    // overlay is open — same "true top layer" role as Passes 5 and 6.
    // Mutually exclusive with both in practice (resolveConfirmedNode only
    // ever sets one pending-node flag at a time), but drawn as its own
    // independent pass for the same reason Pass 6 is.
    updateReflectionOverlay();
  }

  function drawRingBackground(root, ringNumber, currentRing, revealMode) {
    const band = BAND_RADII[ringNumber];
    const tier = TIERS[tierForRing(ringNumber, currentRing, revealMode)];
    const g = svgEl('g', {
      style: `opacity:${tier.opacity};filter:saturate(${tier.saturate});transition:opacity 300ms ease,filter 300ms ease;`,
    });
    const annulus = svgEl('path', {
      d: describeAnnulus(CENTER, CENTER, band.outer, band.inner),
      fill: RING_COLORS[ringNumber],
      'fill-rule': 'evenodd',
    });
    g.appendChild(annulus);
    root.appendChild(g);
  }

  function drawConnectors(root, map, runState, nodeIndex, legalMoves, revealMode) {
    const path = runState.path || [];

    function drawLine(d, { dashed, stroke }) {
      // A dark casing stroke underneath the colored line keeps it legible
      // against every ring color -- Ring 2 (Yellow) in particular is
      // close enough to gold that an unlined stroke nearly disappears
      // against it, and this casing helps the green path line the same
      // way against Ring 1's own dark green.
      root.appendChild(
        svgEl('path', {
          d,
          fill: 'none',
          stroke: '#1a1208',
          'stroke-width': dashed ? 5.5 : 6.5,
          'stroke-linecap': 'round',
          opacity: 0.9,
        })
      );
      root.appendChild(
        svgEl('path', {
          d,
          fill: 'none',
          stroke,
          'stroke-width': dashed ? 3 : 4,
          'stroke-dasharray': dashed ? '10 8' : null,
          'stroke-linecap': 'round',
          opacity: dashed ? 0.9 : 0.98,
        })
      );
    }

    // Committed segments: every consecutive pair actually walked. Solid
    // green (PATH_COLOR), drawn in every mode (including reveal, where
    // this is the entire end-to-end retrospective trail) -- was gold
    // before, indistinguishable at a glance from the dashed gold guidance
    // lines just below.
    for (let i = 0; i < path.length - 1; i++) {
      const from = nodeIndex.get(path[i]);
      const to = nodeIndex.get(path[i + 1]);
      if (!from || !to) continue;
      for (const d of connectorSegments(from, to)) drawLine(d, { dashed: false, stroke: PATH_COLOR });
    }

    if (revealMode) return; // no "next options" guidance once the run is over

    // Dashed guidance to each currently-legal option, from wherever the
    // player currently stands. On the very first choice (Ring 1 entry)
    // there's nothing to draw from yet -- the glow alone is the cue, per
    // spec ("This is all that would be displayed for the first outer
    // circle").
    if (!runState.currentNodeId) return;
    const from = nodeIndex.get(runState.currentNodeId);
    if (!from) return;
    for (const targetId of legalMoves) {
      const to = nodeIndex.get(targetId);
      if (!to) continue;
      for (const d of connectorSegments(from, to)) drawLine(d, { dashed: true, stroke: GOLD });
    }
  }

  function drawRingNodes(root, map, ringNumber, runState, ctx) {
    const ringData = map.rings.find((rr) => rr.ring === ringNumber);
    if (!ringData) return;
    const tier = TIERS[tierForRing(ringNumber, ctx.currentRing, ctx.revealMode)];
    const size = ringData.size ?? RING_SIZES[ringNumber];

    ringData.nodes.forEach((node, index) => {
      const angle = angleForRingIndex(ringNumber, index, size);
      const radius = nodeRadiusForRing(ringNumber);
      const pos = polar(radius, angle);
      const isLegal = ctx.legalMoves.has(node.id);
      const isCommitted = ctx.pathSet.has(node.id);

      const g = drawNode({
        node,
        pos,
        angle,
        interactive: isLegal,
        committed: isCommitted,
        tier,
      });
      root.appendChild(g);
    });
  }

  // A node whose preview tint is being cleared was, by construction, not
  // committed a moment ago (only legal + not-yet-visited nodes are ever
  // previewable) and nothing else about the run state changes between
  // setting and clearing a preview -- so its non-preview fill is always
  // this fixed value; no need to re-consult pathSet.
  function normalBadgeFillFor(nodeId) {
    return nodeId === HELL_LORD_ID ? HELL_LORD_COLOR : NODE_BADGE_FILL;
  }

  // Directly patches an already-drawn node's badge fill in place, without
  // a full render(). This is the actual fix for "red preview tint never
  // shows up": drawNode()/drawHellLord() only ever set a badge's fill
  // from whatever previewNodeId was AT THE TIME OF THE LAST FULL RENDER.
  // Tapping a node to preview it only ever called updatePreviewOverlay()
  // (which just refreshes the HTML preview card in the corner) -- it
  // never touched the SVG badge itself, so previewNodeId changed in JS
  // but the already-rendered circle's fill attribute just sat there
  // showing whatever it was drawn with (typically NODE_BADGE_FILL, since
  // previewNodeId is usually null during a full render). The tint wasn't
  // being visually overpowered by the glow effect -- it just never got
  // applied to the DOM at all.
  function setNodeBadgeFill(nodeId, fill) {
    if (!svg || nodeId == null) return;
    const badge = svg.querySelector(`[data-node-id="${nodeId}"] [data-badge]`);
    if (badge) badge.setAttribute('fill', fill);
  }

  // Called every time previewNodeId is about to change (to a new node id,
  // or to null) -- clears the tint off whichever node was previously
  // previewed and applies it to the new one, so the two always stay in
  // sync with the variable itself instead of only being correct at the
  // moment of the next full render().
  function setPreviewNode(nodeId) {
    if (previewNodeId != null && previewNodeId !== nodeId) {
      setNodeBadgeFill(previewNodeId, normalBadgeFillFor(previewNodeId));
    }
    previewNodeId = nodeId;
    if (previewNodeId != null) {
      setNodeBadgeFill(previewNodeId, PREVIEW_TINT_FILL);
    }
  }

  function drawNode({ node, pos, angle, interactive, committed, tier }) {
    const g = svgEl('g', {
      transform: `translate(${pos.x} ${pos.y})`,
      'data-node-id': node.id,
      style: `cursor:${interactive ? 'pointer' : 'default'};opacity:${tier.opacity};filter:saturate(${tier.saturate});`,
    });

    if (interactive) {
      const glow = svgEl('circle', {
        r: NODE_BADGE_RADIUS * 1.55,
        fill: 'url(#fiery-glow-gradient)',
      });
      const anim = svgEl('animate', {
        attributeName: 'opacity',
        values: '0.55;1;0.55',
        dur: '1.8s',
        repeatCount: 'indefinite',
      });
      glow.appendChild(anim);
      g.appendChild(glow);
    }

    // Red tint = "this is what you're currently previewing" (spec).
    // Green tint = "already completed" -- runState.path is every node the
    // party has actually passed through, which is exactly "done". Preview
    // takes priority in the (currently impossible, since only legal/
    // not-yet-visited nodes are previewable -- but a defensive choice
    // rather than an assumption) case both were somehow true at once.
    const isPreviewing = previewNodeId === node.id;
    const badgeFill = isPreviewing ? PREVIEW_TINT_FILL : committed ? COMPLETED_TINT_FILL : NODE_BADGE_FILL;
    const badge = svgEl('circle', {
      r: NODE_BADGE_RADIUS,
      fill: badgeFill,
      stroke: committed ? PATH_COLOR : '#3a322c',
      'stroke-width': committed ? 5 : 2,
      'data-badge': 'true',
    });
    g.appendChild(badge);

    const symbolId = NODE_TYPE_TO_SYMBOL_ID[node.type];
    const use = svgEl('use', {
      width: 612,
      height: 792,
      transform: iconTransform(symbolId, angle, 0.74, NODE_BADGE_RADIUS),
    });
    use.setAttributeNS(XLINK_NS, 'href', `#${symbolId}`);
    use.setAttribute('href', `#${symbolId}`);
    g.appendChild(use);

    if (interactive) {
      g.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (previewNodeId === node.id) {
          handleMoveConfirmed(node.id);
        } else {
          setPreviewNode(node.id);
          onNodeTap(node.id);
          updatePreviewOverlay();
        }
      });
    }

    return g;
  }

  function drawHellLord(root, runState, revealMode, legalMoves, pathSet) {
    const isCurrent = runState.currentNodeId === HELL_LORD_ID;
    const isLegal = legalMoves.has(HELL_LORD_ID);
    const isCommitted = pathSet.has(HELL_LORD_ID);
    const tier = revealMode || isCurrent ? TIERS.CURRENT : TIERS.NEXT;

    const g = svgEl('g', {
      transform: `translate(${CENTER} ${CENTER})`,
      style: `opacity:${tier.opacity};filter:saturate(${tier.saturate});cursor:${isLegal ? 'pointer' : 'default'};`,
      'data-node-id': HELL_LORD_ID,
    });

    if (isLegal) {
      const glow = svgEl('circle', { r: HELL_LORD_RADIUS * 1.4, fill: 'url(#fiery-glow-gradient)' });
      const anim = svgEl('animate', {
        attributeName: 'opacity',
        values: '0.55;1;0.55',
        dur: '1.8s',
        repeatCount: 'indefinite',
      });
      glow.appendChild(anim);
      g.appendChild(glow);
    }

    const circle = svgEl('circle', {
      r: HELL_LORD_RADIUS,
      // Same red preview tint as every other node type (see drawNode's
      // own comment) -- previously always HELL_LORD_COLOR regardless of
      // previewNodeId, which was its own instance of the same "no preview
      // feedback" gap, just via a badge that never even had the
      // conditional in the first place rather than one that had it but
      // never got refreshed.
      fill: previewNodeId === HELL_LORD_ID ? PREVIEW_TINT_FILL : HELL_LORD_COLOR,
      stroke: isCommitted ? PATH_COLOR : '#3a2a30',
      'stroke-width': isCommitted ? 5 : 2,
      'data-badge': 'true',
    });
    g.appendChild(circle);

    // Icon rotates continuously -- wrapped in its own group so the
    // rotation animates around the Hell Lord's own center regardless of
    // the icon's internal content-centering transform.
    const symbolId = NODE_TYPE_TO_SYMBOL_ID[NODE_TYPES.HELL_LORD];
    const spinGroup = svgEl('g');
    const spin = svgEl('animateTransform', {
      attributeName: 'transform',
      type: 'rotate',
      from: '0 0 0',
      to: '360 0 0',
      dur: '40s',
      repeatCount: 'indefinite',
    });
    spinGroup.appendChild(spin);
    const use = svgEl('use', {
      width: 612,
      height: 792,
      transform: iconTransform(symbolId, 0, 0.86, HELL_LORD_RADIUS),
    });
    use.setAttributeNS(XLINK_NS, 'href', `#${symbolId}`);
    use.setAttribute('href', `#${symbolId}`);
    spinGroup.appendChild(use);
    g.appendChild(spinGroup);

    if (isLegal) {
      g.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (previewNodeId === HELL_LORD_ID) {
          handleMoveConfirmed(HELL_LORD_ID);
        } else {
          setPreviewNode(HELL_LORD_ID);
          onNodeTap(HELL_LORD_ID);
          updatePreviewOverlay();
        }
      });
    }

    root.appendChild(g);
  }

  // Player HUD (soul shards + party corruption) now renders via the HTML
  // corner overlay -- see renderCornerOverlay() below -- alongside the
  // preview cards, in the same shared-position box as combat's consoles.

  // Content-normalized icon transform: scales so each icon's actual
  // illustrated content (not the raw viewBox, which has inconsistent
  // padding baked in per icon -- see icons.js's ICON_CONTENT_BBOX) fills
  // the same fraction of the badge regardless of source artwork, then
  // centers that content on the node's local origin, then rotates so the
  // icon's base points toward the map center.
  function iconTransform(symbolId, angleDeg, targetDiameterFraction, badgeRadius) {
    const bbox = ICON_CONTENT_BBOX[symbolId] || [0, 0, 612, 792];
    const [x0, y0, x1, y1] = bbox;
    const contentW = x1 - x0;
    const contentH = y1 - y0;
    const scale = (targetDiameterFraction * 2 * badgeRadius) / Math.max(contentW, contentH);
    const contentCx = (x0 + x1) / 2;
    const contentCy = (y0 + y1) / 2;
    const tx = -contentCx * scale;
    const ty = -contentCy * scale;
    return `rotate(${angleDeg}) translate(${tx} ${ty}) scale(${scale})`;
  }

  function findNodeTypeById(map, id) {
    if (id === HELL_LORD_ID) return NODE_TYPES.HELL_LORD;
    for (const ring of map.rings) {
      const found = ring.nodes.find((n) => n.id === id);
      if (found) return found.type;
    }
    return null;
  }

  function findFullNodeById(map, id) {
    if (id === HELL_LORD_ID) return { id: HELL_LORD_ID, ring: null, type: NODE_TYPES.HELL_LORD };
    for (const ring of map.rings) {
      const found = ring.nodes.find((n) => n.id === id);
      if (found) return found;
    }
    return null;
  }

  // A move onto `targetId` is a descend (as opposed to a lateral move
  // within the same ring, or the very first Ring 1 entry) if it crosses
  // from the player's current ring into a new one — including the final
  // descent onto the Hell Lord, which isn't a "ring" but is still very
  // much a descent.
  function isDescendMove(targetId) {
    if (!currentPositionNodeId || !currentMap) return false; // initial Ring 1 entry
    if (targetId === HELL_LORD_ID) return true;
    const current = findFullNodeById(currentMap, currentPositionNodeId);
    const target = findFullNodeById(currentMap, targetId);
    if (!current || !target) return false;
    return current.ring !== target.ring;
  }

  // Routes a confirmed move: a lateral move commits immediately, same as
  // before. A descend instead opens the "Descending..." interstitial and
  // defers the actual commit (onNodeConfirm) until the player double-taps
  // anywhere to proceed — the move doesn't take effect, and the
  // destination ring doesn't become "current," until that happens.
  function handleMoveConfirmed(targetId) {
    setPreviewNode(null);
    if (isDescendMove(targetId)) {
      pendingDescentNodeId = targetId;
      updatePreviewOverlay();
      updateDescentOverlay();
    } else {
      resolveConfirmedNode(targetId);
    }
  }

  // The actual "commit or open an interstitial" decision, factored out so
  // it applies identically whether a node was reached directly (lateral
  // move, handled above) or by descending onto it (reached from the
  // "Descending..." backdrop's own tap handler below) — a Hot Spring
  // reached via a descend needs its resolution screen exactly as much as
  // one reached laterally within a ring.
  function resolveConfirmedNode(targetId) {
    const targetNode = findFullNodeById(currentMap, targetId);
    if (targetNode && targetNode.type === NODE_TYPES.REST_POINT) {
      pendingHotSpringNodeId = targetId;
      hotSpringSelections = {};
      updatePreviewOverlay();
      updateHotSpringOverlay();
    } else if (targetNode && targetNode.type === NODE_TYPES.REFLECTION_CHAMBER) {
      pendingReflectionNodeId = targetId;
      reflectionSelections = {};
      updatePreviewOverlay();
      updateReflectionOverlay();
    } else {
      onNodeConfirm(targetId);
      updatePreviewOverlay();
    }
  }

  // Rebuilds each active player's HTML corner box: the node preview card
  // (only populated while previewNodeId is set) stacked directly ABOVE
  // the always-visible HUD (player icon + soul shards + party
  // corruption) — per your spec, these must never overlap, so they're
  // laid out as two stacked flex children of the same box rather than
  // independently positioned. Called both from render()'s own pass and
  // directly from the node click handlers (same immediate-update pattern
  // updatePreviewOverlay used), so a first tap shows the preview without
  // needing a full re-render.
  //
  // Uses the exact same corner/edge convention as combat's player
  // consoles (../layoutConstants.js) -- literal position:fixed flush to
  // the screen corner, rotated by the player's seated edge -- instead of
  // the old SVG-polar placement, so a player's "home area" is in visibly
  // the same place on both the map and combat screens.
  function updatePreviewOverlay() {
    renderCornerOverlay();
  }

  function renderCornerOverlay() {
    if (!container) return;
    const state = getState();
    const previewContent = getPreviewContent();

    // Drop boxes for any corner that's no longer occupied (defensive --
    // player count doesn't actually change mid-run today, but costs
    // nothing to handle).
    Object.keys(hudBoxes).forEach((key) => {
      const idx = Number(key);
      if (idx >= state.players.length) {
        hudBoxes[idx].remove();
        delete hudBoxes[idx];
        if (previewBoxes[idx]) {
          previewBoxes[idx].remove();
          delete previewBoxes[idx];
        }
      }
    });

    state.players.forEach((player, index) => {
      renderHudBox(player, index, state.partyCorruption);
      if (pendingHotSpringNodeId) {
        // Reuses the SAME box/slot the node-preview card normally
        // occupies -- irrelevant while Hot Spring is being resolved (you
        // can't preview a different node without first resolving this
        // one), so there's no conflict in repurposing it rather than
        // building an entirely separate box+position system.
        renderHotSpringBox(player, index);
      } else if (pendingReflectionNodeId) {
        // Same repurposing as the Hot Spring branch above, for the same
        // reason -- only one of the two can ever be pending at once.
        renderReflectionBox(player, index);
      } else {
        renderPreviewBox(player, index, previewContent);
      }
    });
  }

  function getPreviewContent() {
    if (!previewNodeId || !currentMap) return null;
    const type = findNodeTypeById(currentMap, previewNodeId);
    const content = type && NODE_PREVIEW_CONTENT[type];
    if (!content) return null;
    return { type, content };
  }

  // Two INDEPENDENT boxes per player, not one stacked box. This is a
  // deliberate split, not just a refactor: keeping preview+HUD as two
  // flex children of the SAME rotating box meant the box's own size had
  // to accommodate both, and (for rotation safety -- see HUD_SIZE's own
  // comment below) that box had to be a big square, which visually
  // stranded the HUD far from the true screen corner it's supposed to
  // sit flush against -- "floating in the middle of nowhere." Splitting
  // them means the HUD box can stay small and PERMANENTLY FIXED (same
  // size, same position, always, never touched by preview state at all)
  // while the preview box is entirely separate and doesn't affect the
  // HUD's position even slightly when it appears or disappears.
  const hudBoxes = {};
  const previewBoxes = {};
  // playerIndex -> the icon-wrap DOM element inside that player's HUD box.
  // Populated by renderHudBox every render. Used to precisely position the
  // Hot Spring resolution box relative to the icon's ACTUAL rendered
  // position rather than a hand-computed guess -- the icon's real screen
  // position shifts slightly with corruption-text/shard-row content, and
  // a live measurement is the only fully reliable source for it.
  const hudIconEls = {};
  // playerIndex -> the actual <img> element showing that player's
  // portrait, persisted across renders (keyed alongside the src it's
  // currently showing, in hudIconSrcs below). renderHudBox rebuilds the
  // WHOLE hud element fresh on every render (needed for the corruption
  // text/shard row, which genuinely change), including tearing down and
  // recreating the icon wrapper -- but the portrait itself never changes
  // for a given player across a whole game, so recreating a brand new
  // <img> every single render was pure churn. That churn is exactly what
  // caused "player icons sometimes fail to load after combat": a full
  // render() pass fires 2-3 times back to back after combat resolves
  // (commitMove's own explicit renderNow() plus the synchronous one
  // patchState's notify() already triggers), and every one of those
  // destroyed the previous render's <img> before its network request had
  // necessarily finished -- a browser aborts an <img>'s in-flight request
  // the moment that element is removed from the DOM. If another render
  // landed before the image finished loading, which a tight burst of 2-3
  // renders made likely, the icon never got a chance to actually load. Now
  // the SAME <img> element is reused (reparented into the fresh wrapper,
  // not recreated) whenever the src hasn't changed, so an in-progress load
  // survives however many renders happen while it's still in flight.
  const hudIconImgEls = {};
  const hudIconSrcs = {};

  function ensureHudBox(index) {
    let box = hudBoxes[index];
    if (!box) {
      box = document.createElement('div');
      box.className = 'map-hud-box';
      container.appendChild(box);
      hudBoxes[index] = box;
    }
    return box;
  }

  function ensurePreviewBox(index) {
    let box = previewBoxes[index];
    if (!box) {
      box = document.createElement('div');
      box.className = 'map-preview-box';
      container.appendChild(box);
      previewBoxes[index] = box;
    }
    return box;
  }

  // Fixed, SQUARE (rotation-safety -- see combat/combat.js's own player
  // consoles, which use the identical principle). A box that's square
  // rotates into an IDENTICAL bounding footprint at every 0/90/180/270°
  // angle, so this is a structural "never off-screen, never clips its own
  // content" guarantee, not a sized guess.
  //
  // This used to be 378 (matching combat's own CORNER_BOX_SIZE, so a
  // player's "home area" wouldn't visibly resize switching between map
  // and combat) -- but the map's HUD content (icon + corruption text +
  // shard row, ~174px tall, ~180-200px wide at typical font metrics) only
  // actually needs a fraction of that, and centering it in a 378 square
  // anchored flush at the screen corner left a large, clearly-visible dead
  // margin between the true screen edge and the visible content -- not
  // matching the reference layout, where the player's whole HUD sits
  // close against the device edge, near where the outer ring itself ends.
  // 220 keeps the same "comfortably fits the content at any rotation"
  // guarantee (content maxes out around 200px in its wider orientation,
  // well under 220) while pulling that dead margin in by roughly 70%.
  // Combat's own CORNER_BOX_SIZE is untouched -- this is a map-only
  // constant, not the shared layoutConstants.js value, so combat's
  // consoles are unaffected.
  const HUD_SIZE = 220;
  // Small breathing room off the literal device edge -- the reference
  // layout isn't flush to zero, just close. Applied as a margin (which
  // DOES offset a position:fixed box from whichever edges CORNER_CSS
  // actually pins for that corner) rather than editing the shared
  // CORNER_CSS strings themselves, since those are also used by combat's
  // consoles and this adjustment is map-only.
  const HUD_EDGE_MARGIN = 10;

  function renderHudBox(player, index, partyCorruption) {
    const box = ensureHudBox(index);
    const cornerName = CORNER_INDEX_TO_NAME[player.corner];
    const rotation = EDGE_ROTATION[player.orientationEdge];
    // This is the ENTIRE style declaration, every render call, for every
    // player, regardless of preview state -- there is nothing here that
    // varies based on whether a preview is showing. That's what makes
    // "same position before and after preview" true by construction
    // rather than something to carefully preserve across two code paths.
    box.style.cssText = `
      position:fixed; width:${HUD_SIZE}px; height:${HUD_SIZE}px; overflow:hidden;
      margin:${HUD_EDGE_MARGIN}px;
      display:flex; align-items:center; justify-content:center;
      transform: rotate(${rotation}deg);
      z-index:45; text-align:center; pointer-events:none;
      ${CORNER_CSS[cornerName] || CORNER_CSS['top-left']}
    `;
    box.innerHTML = '';
    box.appendChild(buildHudEl(player, index, partyCorruption, rotation));
    hudIconEls[index] = box.querySelector('.hud-player-icon');
  }

  // Was 350 (much wider than PREVIEW_MAX_HEIGHT's 220), which caused two
  // compounding problems once this card moved to icon-relative positioning
  // (see renderIconAdjacentBox): its outer square has to be sized to
  // Math.max(width, height) so rotated content never clips -- with width
  // and height this different, that square (350x350) was FAR bigger than
  // the actual ~220-tall content, leaving ~65px of pure invisible padding
  // between the icon and the visible text on every side ("far too far
  // away from the player icon"). And centered on an icon sitting close to
  // a screen corner, a 350-wide box routinely extended past the edge of
  // the viewport entirely, clipping the card's own text ("flowing off the
  // screen"). Matching this to PREVIEW_MAX_HEIGHT makes the outer square
  // exactly as big as the content actually needs -- no wasted padding on
  // any side -- and keeps the whole card narrow enough to stay on screen
  // next to a corner-hugging icon. Text simply wraps to more, shorter
  // lines at this width, well within PREVIEW_MAX_HEIGHT's existing room.
  const PREVIEW_SIZE = 220;
  const PREVIEW_GAP = 6;
  // Generous cap for title (1-2 lines) + description (up to ~4-5 wrapped
  // lines at the smallest font tier) -- see buildPreviewCardEl's dynamic
  // font sizing. Longer than any real content needs, which is the point:
  // verticalOffsetFor's no-overlap guarantee is only as good as the
  // height it's given, so this errs upward rather than being tuned to
  // exactly fit today's copy and silently under-covering a longer
  // description added later.
  const PREVIEW_MAX_HEIGHT = 220;

  // Fallback-only now: every icon-adjacent box (preview card, Hot Spring,
  // Reflection Chamber) is normally positioned directly off the player's
  // MEASURED icon position (see renderIconAdjacentBox), not from this
  // viewport-relative offset. This still backs the rare case where the
  // icon element isn't measurable yet, so the box has some safe fallback
  // spot rather than rendering at (undefined, undefined) -- kept scaling
  // with the real viewport size (clamped to the screen's own midpoint)
  // for the same reason it always did: a fixed pixel offset doesn't scale
  // with viewport height, and two players sharing an edge (one in a top
  // corner, one in a bottom corner) could otherwise end up with
  // overlapping boxes on a taller iPad even though each looked fine on a
  // smaller one.
  function verticalOffsetFor(boxHeight) {
    const midpoint = window.innerHeight / 2;
    const desired = HUD_SIZE + PREVIEW_GAP;
    // Never let the box's far edge (offset + boxHeight) cross the
    // midpoint, with a small margin so two boxes from opposite corners
    // can't even touch. Parameterized by boxHeight so every box that
    // might fall back to this gets a guarantee sized to ITS OWN content.
    return Math.min(desired, Math.max(0, midpoint - boxHeight - 10));
  }

  function renderPreviewBox(player, index, previewContent) {
    const box = ensurePreviewBox(index);
    if (!previewContent) {
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }
    // Same icon-anchored positioning as the Hot Spring/Reflection boxes
    // (see renderIconAdjacentBox) -- the old version anchored this to the
    // viewport corner via stackedBoxCss/verticalOffsetFor, which is what
    // produced both symptoms reported: an oversized, viewport-size-
    // dependent gap to the icon (not a controlled 12px), and -- since that
    // offset was only clamped to the screen's own midpoint, not measured
    // against any specific icon -- two players on the same edge (e.g. top-
    // left and top-right) could still end up with overlapping text at
    // certain viewport sizes.
    const inner = renderIconAdjacentBox(box, player, index, PREVIEW_SIZE, PREVIEW_MAX_HEIGHT);
    inner.appendChild(buildPreviewCardEl(previewContent.content));
  }

  // Title + description only -- no icon, no flavor quote (removed per
  // spec: the icon duplicates what's already visible on the node itself,
  // and flavor text was the single biggest source of unpredictable
  // height, which is what was driving the overlap this box now avoids
  // structurally rather than by tuning around one description's length).
  function buildPreviewCardEl(content) {
    const card = document.createElement('div');
    card.style.cssText =
      'display:flex; flex-direction:column; align-items:center; gap:8px; width:100%; box-sizing:border-box; padding:0 6px;';

    const title = document.createElement('div');
    title.textContent = content.title.toUpperCase();
    title.style.cssText = `
      color:${PREVIEW_TEXT_COLOR}; font-family:'Georgia','Times New Roman',serif;
      font-weight:bold; font-size:26px; letter-spacing:1px; line-height:1.2;
      overflow-wrap:break-word; word-wrap:break-word; max-width:100%;
    `;
    card.appendChild(title);

    // Longer descriptions shrink rather than risk overflowing the box's
    // capped height -- same principle as combat.js's name-length-based
    // font sizing for Overseer names.
    const descFontSize = content.description.length > 140 ? 15 : content.description.length > 90 ? 16.5 : 17.5;
    const desc = document.createElement('div');
    desc.textContent = content.description;
    desc.style.cssText = `
      color:${PREVIEW_TEXT_COLOR}; font-family:'Georgia','Times New Roman',serif;
      font-size:${descFontSize}px; line-height:1.3;
      overflow-wrap:break-word; word-wrap:break-word; max-width:100%;
    `;
    card.appendChild(desc);

    return card;
  }

  // Deliberately taller than the node-preview card (3 option rows + a
  // confirm button don't fit in PREVIEW_SIZE's square footprint).
  const HOTSPRING_WIDTH = 260;
  const HOTSPRING_HEIGHT = 280;
  // Outer positioning square for the Hot Spring box -- same "make it
  // square so rotation can't change its footprint" reasoning as HUD_SIZE
  // (see that constant's own comment). Sized to HOTSPRING_HEIGHT (the
  // larger of the two content dimensions) so the actual content, at ANY
  // of the four 90-degree rotations, always fits inside this square with
  // room to spare -- unlike HUD_SIZE this box's outer footprint is no
  // longer corner-flush, so nothing else depends on its exact size, only
  // that it be big enough to rotate the content in without clipping.
  const HOTSPRING_OUTER_SIZE = HOTSPRING_HEIGHT;
  // Max on-screen gap (icon's edge to the nearest visible option/confirm
  // element) called for by spec. Measured against this outer square's
  // edge rather than the tighter true content edge -- the square has to
  // be bigger than the content to stay rotation-safe, so there's a little
  // slack baked in versus a pixel-exact 12px to the visible text itself,
  // but it keeps the box from ever clipping its own content on a
  // left/right-seated player's 90/270 rotation.
  const HOTSPRING_ICON_GAP = 12;

  // Shared by renderHotSpringBox and renderReflectionBox -- both need the
  // exact same "pin an outer square next to the player's actual icon,
  // rotate only the content inside it" treatment. Returns nothing; sets
  // up box/inner and leaves inner ready for the caller's own content.
  function renderIconAdjacentBox(box, player, index, contentWidth, contentHeight) {
    const cornerName = CORNER_INDEX_TO_NAME[player.corner];
    const rotation = EDGE_ROTATION[player.orientationEdge];
    // Outer positioning square, sized to whichever content dimension is
    // larger -- same "make it square so rotation can't change its
    // footprint" reasoning as HUD_SIZE (see that constant's own comment).
    // Big enough that the actual content, at ANY of the four 90-degree
    // rotations, always fits inside this square with room to spare.
    const outerSize = Math.max(contentWidth, contentHeight);

    // Positioned directly off the player's ACTUAL rendered icon (measured
    // live via getBoundingClientRect, not hand-computed from HUD_SIZE) --
    // the icon's real on-screen position shifts slightly with
    // corruption-text/shard-row content and isn't reliably derivable by
    // hand. This is exactly the "awkwardly placed, too far from the icon"
    // bug: the old version measured its gap from the whole 378px HUD_SIZE
    // square, not from where the icon actually sits inside it.
    //
    // The OUTER box below is positioned but deliberately left un-rotated
    // -- it has to stay pinned next to the icon regardless of which way
    // the player is seated. Rotation is applied to an INNER wrapper
    // instead, so content orientation and screen position are controlled
    // independently instead of the one hand-in-hand rotation the
    // HUD box uses (which only needs to stay "somewhere in the right
    // corner," not pinned to a specific point).
    const iconEl = hudIconEls[index];
    const iconRect = iconEl ? iconEl.getBoundingClientRect() : null;

    let left, top;
    if (iconRect) {
      const iconCx = iconRect.left + iconRect.width / 2;
      const iconCy = iconRect.top + iconRect.height / 2;
      const iconR = iconRect.width / 2;
      left = iconCx - outerSize / 2;
      if (cornerName === 'bottom-left' || cornerName === 'bottom-right') {
        // Bottom-corner players: content sits ABOVE the icon, same
        // "toward screen center" side the old stacked layout used --
        // box's bottom edge 12px above the icon's top edge.
        top = iconCy - iconR - HOTSPRING_ICON_GAP - outerSize;
      } else {
        // top-left / top-right (and stackedBoxCss's own default for
        // anything else): content sits BELOW the icon.
        top = iconCy + iconR + HOTSPRING_ICON_GAP;
      }
    } else {
      // Icon not measurable yet for some reason (shouldn't normally
      // happen -- renderHudBox always runs earlier in the same render
      // pass) -- fall back to the old corner-flush stacking rather than
      // rendering at (undefined, undefined).
      const fallbackOffset = verticalOffsetFor(outerSize);
      if (cornerName === 'top-right' || cornerName === 'bottom-right') {
        left = window.innerWidth - outerSize;
      } else {
        left = 0;
      }
      top = cornerName.startsWith('bottom') ? window.innerHeight - fallbackOffset - outerSize : fallbackOffset;
    }

    box.style.cssText = `
      position:fixed; left:${left}px; top:${top}px;
      width:${outerSize}px; height:${outerSize}px;
      overflow:hidden;
      display:flex; align-items:center; justify-content:center;
      z-index:44; text-align:center; pointer-events:none;
    `;
    box.innerHTML = '';
    const inner = document.createElement('div');
    inner.style.cssText = `
      width:${contentWidth}px; max-height:${contentHeight}px;
      display:flex; align-items:center; justify-content:center;
      transform: rotate(${rotation}deg); pointer-events:none;
    `;
    box.appendChild(inner);
    return inner;
  }

  function renderHotSpringBox(player, index) {
    const box = ensurePreviewBox(index);
    const inner = renderIconAdjacentBox(box, player, index, HOTSPRING_WIDTH, HOTSPRING_HEIGHT);
    inner.appendChild(buildHotSpringEl(index));
  }

  function buildHotSpringEl(index) {
    const wrap = document.createElement('div');
    wrap.style.cssText =
      'display:flex; flex-direction:column; align-items:center; gap:10px; width:100%; pointer-events:none;';

    const selection = hotSpringSelections[index] || { choice: null, locked: false };

    HOT_SPRING_OPTIONS.forEach((opt) => {
      const isSelected = selection.choice === opt.id;
      const optBox = document.createElement('div');
      optBox.style.cssText = `
        width:280px; padding:10px 14px; border-radius:10px; box-sizing:border-box;
        background:${isSelected ? 'rgba(244,193,74,0.28)' : 'rgba(0,0,0,0.45)'};
        border:2px solid ${isSelected ? GOLD : '#5a4a38'};
        box-shadow:${isSelected ? `0 0 14px ${GOLD}` : 'none'};
        cursor:${selection.locked ? 'default' : 'pointer'};
        pointer-events:${selection.locked ? 'none' : 'auto'};
        transition: background 150ms ease, box-shadow 150ms ease;
      `;

      const title = document.createElement('div');
      title.textContent = opt.title.toUpperCase();
      title.style.cssText = `
        color:${GOLD}; font-family:'Georgia','Times New Roman',serif;
        font-weight:bold; font-size:18px; letter-spacing:0.5px; pointer-events:none;
      `;
      optBox.appendChild(title);

      optBox.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (selection.locked) return;
        // Selecting doesn't lock anything in yet -- just updates which
        // box glows. A player can freely change their mind among the
        // three right up until they tap the confirm button below.
        hotSpringSelections[index] = { choice: opt.id, locked: false };
        renderCornerOverlay();
      });

      wrap.appendChild(optBox);
    });

    const canConfirm = selection.choice !== null && !selection.locked;
    const confirmBtn = document.createElement('div');
    confirmBtn.textContent = selection.locked ? '\u2713' : '\u2713';
    confirmBtn.style.cssText = `
      margin-top:4px; width:52px; height:52px; border-radius:50%;
      display:flex; align-items:center; justify-content:center;
      font-size:26px; font-weight:bold; line-height:1;
      background:${selection.locked ? '#2f6b3a' : canConfirm ? GOLD : '#3a3226'};
      color:${selection.locked ? '#dff5e3' : '#1a1208'};
      border:3px solid #000; box-sizing:border-box;
      cursor:${canConfirm ? 'pointer' : 'default'};
      pointer-events:${canConfirm ? 'auto' : 'none'};
      opacity:${selection.choice !== null ? '1' : '0.5'};
    `;
    confirmBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!canConfirm) return;
      hotSpringSelections[index] = { ...selection, locked: true };
      renderCornerOverlay();
      tryResolveHotSpring();
    });
    wrap.appendChild(confirmBtn);

    return wrap;
  }

  // Checked every time any player locks in a choice (see confirmBtn's
  // handler above) rather than via any separate "all done" button --
  // resolution fires automatically the instant the LAST player locks in,
  // per spec ("Once all players have confirmed, the app executes...").
  function tryResolveHotSpring() {
    const state = getState();
    const allLocked = state.players.every((_, idx) => hotSpringSelections[idx]?.locked);
    if (!allLocked) return;

    // corruptionDelta is applied PER PLAYER who locked that option in --
    // party corruption is shared, but each player's choice contributes
    // independently (two players choosing Long Soak adds 2, not 1). See
    // hotSpringContent.js's own comment on this. Summed into one total
    // and applied as a single adjustPartyCorruption call so the net
    // effect (not each individual step) determines any level rollover,
    // matching how a person tallying this by hand would do it.
    let totalDelta = 0;
    state.players.forEach((_, idx) => {
      const opt = HOT_SPRING_OPTIONS.find((o) => o.id === hotSpringSelections[idx]?.choice);
      if (opt) totalDelta += opt.corruptionDelta;
    });
    if (totalDelta !== 0) {
      // Healing and crypt/deck actions (Quick Dip, and the healing half of
      // Long Soak) are physical, player-performed actions -- there's no
      // per-player health or deck tracked anywhere in gameState for the
      // app to execute them against. Corruption is the one part of these
      // options that's app-tracked, so it's the only part applied here.
      adjustPartyCorruption(totalDelta, state.players.length);
    }

    const resolvedNodeId = pendingHotSpringNodeId;
    pendingHotSpringNodeId = null;
    hotSpringSelections = {};
    updateHotSpringOverlay();
    onNodeConfirm(resolvedNodeId); // marks the node visited/completed, same commitMove() path every other node type uses
    renderCornerOverlay(); // back to the normal HUD+preview boxes
  }

  // Reflection Chamber's per-player box + resolution logic — structurally
  // identical to Hot Spring's own trio just above (renderHotSpringBox /
  // buildHotSpringEl / tryResolveHotSpring), just pointed at
  // REFLECTION_CHAMBER_OPTIONS and its own pending/selection state. Kept
  // as a fully separate copy rather than a shared parametrized helper,
  // matching the rest of this file's per-node-type convention.
  function renderReflectionBox(player, index) {
    const box = ensurePreviewBox(index);
    const inner = renderIconAdjacentBox(box, player, index, HOTSPRING_WIDTH, HOTSPRING_HEIGHT);
    inner.appendChild(buildReflectionEl(index));
  }

  function buildReflectionEl(index) {
    const wrap = document.createElement('div');
    wrap.style.cssText =
      'display:flex; flex-direction:column; align-items:center; gap:10px; width:100%; pointer-events:none;';

    const selection = reflectionSelections[index] || { choice: null, locked: false };

    REFLECTION_CHAMBER_OPTIONS.forEach((opt) => {
      const isSelected = selection.choice === opt.id;
      const optBox = document.createElement('div');
      optBox.style.cssText = `
        width:280px; padding:10px 14px; border-radius:10px; box-sizing:border-box;
        background:${isSelected ? 'rgba(244,193,74,0.28)' : 'rgba(0,0,0,0.45)'};
        border:2px solid ${isSelected ? GOLD : '#5a4a38'};
        box-shadow:${isSelected ? `0 0 14px ${GOLD}` : 'none'};
        cursor:${selection.locked ? 'default' : 'pointer'};
        pointer-events:${selection.locked ? 'none' : 'auto'};
        transition: background 150ms ease, box-shadow 150ms ease;
      `;

      const title = document.createElement('div');
      title.textContent = opt.title.toUpperCase();
      title.style.cssText = `
        color:${GOLD}; font-family:'Georgia','Times New Roman',serif;
        font-weight:bold; font-size:18px; letter-spacing:0.5px; pointer-events:none;
      `;
      optBox.appendChild(title);

      optBox.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (selection.locked) return;
        // Selecting doesn't lock anything in yet -- just updates which
        // box glows. A player can freely change their mind between
        // Rethink and Repent right up until they tap the confirm button
        // below.
        reflectionSelections[index] = { choice: opt.id, locked: false };
        renderCornerOverlay();
      });

      wrap.appendChild(optBox);
    });

    const canConfirm = selection.choice !== null && !selection.locked;
    const confirmBtn = document.createElement('div');
    confirmBtn.textContent = selection.locked ? '\u2713' : '\u2713';
    confirmBtn.style.cssText = `
      margin-top:4px; width:52px; height:52px; border-radius:50%;
      display:flex; align-items:center; justify-content:center;
      font-size:26px; font-weight:bold; line-height:1;
      background:${selection.locked ? '#2f6b3a' : canConfirm ? GOLD : '#3a3226'};
      color:${selection.locked ? '#dff5e3' : '#1a1208'};
      border:3px solid #000; box-sizing:border-box;
      cursor:${canConfirm ? 'pointer' : 'default'};
      pointer-events:${canConfirm ? 'auto' : 'none'};
      opacity:${selection.choice !== null ? '1' : '0.5'};
    `;
    confirmBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!canConfirm) return;
      reflectionSelections[index] = { ...selection, locked: true };
      renderCornerOverlay();
      tryResolveReflectionChamber();
    });
    wrap.appendChild(confirmBtn);

    return wrap;
  }

  // Checked every time any player locks in a choice (see confirmBtn's
  // handler above) rather than via any separate "all done" button --
  // resolution fires automatically the instant the LAST player locks in,
  // same as tryResolveHotSpring.
  function tryResolveReflectionChamber() {
    const state = getState();
    const allLocked = state.players.every((_, idx) => reflectionSelections[idx]?.locked);
    if (!allLocked) return;

    // corruptionDelta is applied PER PLAYER who locked that option in --
    // party corruption is shared, but each player's choice contributes
    // independently (two players choosing Repent removes 4, not 2). See
    // reflectionChamberContent.js's own comment on this. Summed into one
    // total and applied as a single adjustPartyCorruption call so the net
    // effect (not each individual step) determines any level rollover,
    // matching how a person tallying this by hand would do it.
    let totalDelta = 0;
    state.players.forEach((_, idx) => {
      const opt = REFLECTION_CHAMBER_OPTIONS.find((o) => o.id === reflectionSelections[idx]?.choice);
      if (opt) totalDelta += opt.corruptionDelta;
    });
    if (totalDelta !== 0) {
      // Rethink (the virtue swap) is a physical, player-performed action
      // -- there's no per-player virtue collection or virtue row tracked
      // anywhere in gameState for the app to execute it against.
      // Corruption is the one part of these options that's app-tracked,
      // so it's the only part applied here.
      adjustPartyCorruption(totalDelta, state.players.length);
    }

    const resolvedNodeId = pendingReflectionNodeId;
    pendingReflectionNodeId = null;
    reflectionSelections = {};
    updateReflectionOverlay();
    onNodeConfirm(resolvedNodeId); // marks the node visited/completed, same commitMove() path every other node type uses
    renderCornerOverlay(); // back to the normal HUD+preview boxes
  }


  const SOUL_SHARD_DRAG_SENSITIVITY = 18; // screen px of local-axis
                                           // movement per 1 shard --
                                           // matches combat.js's
                                           // DRAG_SENSITIVITY for HP, so
                                           // the two feel identical.

  function buildHudEl(player, playerIndex, partyCorruption, rotationDeg) {
    const hud = document.createElement('div');
    hud.style.cssText = `display:flex; flex-direction:column; align-items:center; gap:4px;`;

    const iconR = 50;
    const iconWrap = document.createElement('div');
    iconWrap.className = 'hud-player-icon';
    iconWrap.style.cssText = `
      width:${iconR * 2}px; height:${iconR * 2}px; border-radius:50%;
      background:${NODE_BADGE_FILL}; border:5px solid ${player.color};
      display:flex; align-items:center; justify-content:center; overflow:hidden;
    `;
    if (player.icon) {
      let img = hudIconImgEls[playerIndex];
      // Reuse the cached element only if it's showing the same src AND
      // hasn't actually failed to load -- `complete && naturalWidth === 0`
      // is the standard way to detect a finished-but-failed <img> load
      // (a real image never reports 0 natural width once loaded). Without
      // this check, a load that failed once (a genuine 404, or an
      // aborted-mid-fetch race from before this caching existed) would
      // stay cached as "the" element for that player forever -- exactly
      // the reported "if it didn't load in combat, it doesn't load back
      // on the map either" symptom, since the broken element itself was
      // being faithfully preserved and reused rather than ever retried.
      const cachedLoadFailed = img && img.complete && img.naturalWidth === 0;
      if (img && hudIconSrcs[playerIndex] === player.icon && !cachedLoadFailed) {
        // Same portrait as last render, and it either loaded fine or is
        // still in flight -- reuse the exact element (and whatever load
        // progress it's already made) instead of starting a fresh network
        // request from scratch. Appending an element that's already
        // elsewhere in the document just MOVES it; it does not reset or
        // restart an in-flight or completed image load.
        iconWrap.appendChild(img);
      } else {
        img = document.createElement('img');
        img.src = player.icon;
        img.style.cssText = `width:100%; height:100%; object-fit:cover;`;
        iconWrap.appendChild(img);
        hudIconImgEls[playerIndex] = img;
        hudIconSrcs[playerIndex] = player.icon;
      }
    }
    hud.appendChild(iconWrap);

    const corruptionText = document.createElement('div');
    corruptionText.textContent = `Corruption Lv.${partyCorruption.level} — ${partyCorruption.filled}`;
    corruptionText.style.cssText = `
      color:#c9a8a0; font-family:'Georgia','Times New Roman',serif; font-size:21px;
    `;
    hud.appendChild(corruptionText);

    const shardRow = document.createElement('div');
    shardRow.style.cssText = `display:flex; align-items:center; gap:10px;`;

    const shardIcon = document.createElement('div');
    shardIcon.style.cssText = `
      width:30px; height:30px; border-radius:50%; background:#7fd1e6;
      border:3.5px solid #1a4a52;
    `;
    shardRow.appendChild(shardIcon);

    // Shows current/max, same convention as an HP readout -- makes the
    // ceiling visible instead of just discoverable by dragging into it.
    const shardValue = document.createElement('div');
    shardValue.textContent = `${player.soulShards}/${player.soulShardsMax}`;
    shardValue.style.cssText = `
      color:${GOLD}; font-family:'Georgia','Times New Roman',serif;
      font-weight:bold; font-size:35px; cursor:ew-resize;
      touch-action:none; pointer-events:auto;
    `;
    shardRow.appendChild(shardValue);
    hud.appendChild(shardRow);

    // Same mechanic as combat.js's makeDragStat for HP: current value can
    // be dragged freely in EITHER direction, clamped to [0, soulShardsMax]
    // -- it's never destroyed outright, just moved within what's actually
    // been earned (gameState.setPlayerSoulShards enforces the same clamp
    // server-side, so this can't be bypassed even if the local math here
    // ever drifts). Uses the box's own rotation to convert raw screen
    // drag deltas into a LOCAL axis, exactly like combat's drag stats, so
    // "drag right" always means the same thing to the seated player
    // regardless of which corner/edge they're in.
    let dragStartX = null;
    let dragStartY = null;
    let dragStartValue = player.soulShards;
    const rad = -rotationDeg * (Math.PI / 180);
    shardValue.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragStartValue = player.soulShards;
      shardValue.setPointerCapture(e.pointerId);
    });
    function proposedValue(e) {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
      const delta = Math.round(localX / SOUL_SHARD_DRAG_SENSITIVITY);
      return Math.max(0, Math.min(player.soulShardsMax, dragStartValue + delta));
    }
    shardValue.addEventListener('pointermove', (e) => {
      if (dragStartX === null) return;
      shardValue.textContent = `${proposedValue(e)}/${player.soulShardsMax}`;
    });
    function commitDrag(e) {
      if (dragStartX === null) return;
      setPlayerSoulShards(playerIndex, proposedValue(e));
      dragStartX = null;
    }
    shardValue.addEventListener('pointerup', commitDrag);
    shardValue.addEventListener('pointercancel', commitDrag);

    return hud;
  }

  // Redraws (or removes) the "Descending..." interstitial based on
  // pendingDescentNodeId. Same direct-call pattern as
  // updatePreviewOverlay — called from the click handler immediately so
  // it appears without the host needing to trigger a full render.
  function updateDescentOverlay() {
    if (!svg) return;
    // Defensive: only remove it if it's ACTUALLY still attached. See
    // render()'s own wipe-loop comment for why a stale (already-detached)
    // reference here could otherwise throw and permanently wedge this
    // overlay's state -- this check makes that class of bug structurally
    // impossible here, regardless of what desyncs the variable in the
    // future.
    if (descentOverlayGroup && descentOverlayGroup.parentNode === svg) {
      svg.removeChild(descentOverlayGroup);
    }
    descentOverlayGroup = null;
    if (!pendingDescentNodeId || !currentMap) return;

    const target = findFullNodeById(currentMap, pendingDescentNodeId);
    const contentKey = pendingDescentNodeId === HELL_LORD_ID ? HELL_LORD_ID : target?.ring;
    const bodyText = contentKey != null ? DESCENT_PHASE_CONTENT[contentKey] : null;
    if (!bodyText) return;

    const group = svgEl('g', { 'data-descent-overlay': 'true' });

    // Full-canvas backdrop, dimming the map underneath and catching the
    // "double-tap anywhere to proceed" gesture.
    const backdrop = svgEl('rect', {
      x: 0,
      y: 0,
      width: VIEW_SIZE,
      height: VIEW_SIZE,
      fill: '#000000',
      opacity: 0.72,
      style: 'cursor:pointer;',
    });
    backdrop.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const now = Date.now();
      if (now - lastAnywhereTapTime < 400) {
        const resolvedNodeId = pendingDescentNodeId;
        pendingDescentNodeId = null;
        lastAnywhereTapTime = 0;
        updateDescentOverlay();
        resolveConfirmedNode(resolvedNodeId);
      } else {
        lastAnywhereTapTime = now;
      }
    });
    group.appendChild(backdrop);

    // The fiery circle itself.
    const circleR = OVERLAY_CIRCLE_RADIUS;
    const circleGroup = svgEl('g', { transform: `translate(${CENTER} ${CENTER})`, style: 'pointer-events:none;' });

    const glow = svgEl('circle', { r: circleR * 1.18, fill: 'url(#fiery-glow-gradient)' });
    const glowAnim = svgEl('animate', {
      attributeName: 'opacity',
      values: '0.6;1;0.6',
      dur: '2.2s',
      repeatCount: 'indefinite',
    });
    glow.appendChild(glowAnim);
    circleGroup.appendChild(glow);

    const disc = svgEl('circle', { r: circleR, fill: DESCENT_CIRCLE_FILL, stroke: GOLD, 'stroke-width': 4 });
    circleGroup.appendChild(disc);

    // Nudged down ~15% of the circle's radius from its old position
    // (assuming "moved down, toward the body text" was the intent behind
    // "should be [moved] by about 15% from its current position" -- the
    // header sat right up against the circle's own curved top edge
    // before, noticeably more cramped than the equivalent Hot
    // Spring/Reflection Chamber headers once those got their own
    // wrapping fix).
    const header = svgEl('text', {
      x: 0,
      y: -circleR + 80 + circleR * 0.15,
      'text-anchor': 'middle',
      fill: GOLD,
      'font-family': "'Georgia', 'Times New Roman', serif",
      'font-weight': 'bold',
      'font-size': 40,
      'letter-spacing': '1.5',
    });
    header.textContent = DESCENT_PHASE_HEADER;
    circleGroup.appendChild(header);

    const bodyLines = wrapText(bodyText, 22, circleR * 1.5, 0.52);
    const bodyEl = multilineText(0, -20, bodyLines, 32, {
      fill: PREVIEW_TEXT_COLOR,
      'font-family': "'Georgia', 'Times New Roman', serif",
      'font-size': 22,
    });
    circleGroup.appendChild(bodyEl);

    const hintY = -20 + (bodyLines.length - 1) * 32 + 70;
    const hint = svgEl('text', {
      x: 0,
      y: Math.min(hintY, circleR - 40),
      'text-anchor': 'middle',
      fill: DESCENT_HINT_COLOR,
      'font-family': "'Georgia', 'Times New Roman', serif",
      'font-style': 'italic',
      'font-size': 15,
    });
    hint.textContent = 'Tap twice anywhere to continue';
    circleGroup.appendChild(hint);

    group.appendChild(circleGroup);
    svg.appendChild(group);
    descentOverlayGroup = group;
  }

  // Same structural role as updateDescentOverlay (full-canvas dimming
  // backdrop + a central fiery circle with header/body text, redrawn or
  // removed based on whether its pending-state flag is set), but simpler:
  // no "tap twice anywhere to continue" hint and no click handler on the
  // backdrop, since Hot Spring resolves via the per-player option boxes
  // and confirm buttons (see tryResolveHotSpring), not a screen-wide tap
  // gesture. The backdrop still exists purely to dim the map and absorb
  // taps that would otherwise land on nodes underneath it.
  function updateHotSpringOverlay() {
    if (!svg) return;
    // Defensive: see updateDescentOverlay's identical check for why this
    // guards against a stale (already-detached) reference throwing here.
    if (hotSpringOverlayGroup && hotSpringOverlayGroup.parentNode === svg) {
      svg.removeChild(hotSpringOverlayGroup);
    }
    hotSpringOverlayGroup = null;
    if (!pendingHotSpringNodeId) return;

    const group = svgEl('g', { 'data-hotspring-overlay': 'true' });

    const backdrop = svgEl('rect', {
      x: 0,
      y: 0,
      width: VIEW_SIZE,
      height: VIEW_SIZE,
      fill: '#000000',
      opacity: 0.72,
    });
    backdrop.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
    });
    group.appendChild(backdrop);

    const circleR = OVERLAY_CIRCLE_RADIUS;
    const circleGroup = svgEl('g', { transform: `translate(${CENTER} ${CENTER})`, style: 'pointer-events:none;' });

    const glow = svgEl('circle', { r: circleR * 1.18, fill: 'url(#fiery-glow-gradient)' });
    const glowAnim = svgEl('animate', {
      attributeName: 'opacity',
      values: '0.6;1;0.6',
      dur: '2.2s',
      repeatCount: 'indefinite',
    });
    glow.appendChild(glowAnim);
    circleGroup.appendChild(glow);

    const disc = svgEl('circle', { r: circleR, fill: DESCENT_CIRCLE_FILL, stroke: GOLD, 'stroke-width': 4 });
    circleGroup.appendChild(disc);

    const { lineCount: headerLineCount, lineHeight: headerLineHeight } = renderCircleHeader(
      circleGroup,
      circleR,
      HOT_SPRING_HEADER
    );

    // Full option descriptions live HERE now, not in the per-player boxes
    // (those show only the option's name -- see buildHotSpringEl) --
    // per spec, this is the one place the full text should appear.
    const bodyFontSize = 19;
    const bodyLineHeight = 25;
    const bodyMaxWidth = circleR * 1.62;
    let bodyLines = wrapText(HOT_SPRING_SUBTEXT, bodyFontSize, bodyMaxWidth);
    bodyLines.push(''); // spacer before the option list
    HOT_SPRING_OPTIONS.forEach((opt) => {
      const wrapped = wrapText(`${opt.title}: ${opt.description}`, bodyFontSize, bodyMaxWidth);
      bodyLines = bodyLines.concat(wrapped);
    });

    // Vertically center the whole block within the remaining circle space
    // (below the header) rather than a fixed start y, since the number of
    // lines now varies with how each description happens to wrap -- and
    // shift down by however many EXTRA lines the header itself took (see
    // renderCircleHeader), so a wrapped 2-line "Reflection Chamber"-style
    // header never runs into this block.
    const bodyStartY = -((bodyLines.length - 1) * bodyLineHeight) / 2 + 10 + (headerLineCount - 1) * headerLineHeight;
    const bodyEl = multilineText(0, bodyStartY, bodyLines, bodyLineHeight, {
      fill: PREVIEW_TEXT_COLOR,
      'font-family': "'Georgia', 'Times New Roman', serif",
      'font-size': bodyFontSize,
    });
    circleGroup.appendChild(bodyEl);

    group.appendChild(circleGroup);
    svg.appendChild(group);
    hotSpringOverlayGroup = group;
  }

  // Same structural role as updateHotSpringOverlay just above -- full-
  // canvas dimming backdrop + a central fiery circle with header/body
  // text, resolved via the per-player option boxes and confirm buttons
  // rather than a screen-wide tap gesture. Kept as its own copy rather
  // than parametrizing updateHotSpringOverlay, matching this file's
  // existing per-node-type convention.
  function updateReflectionOverlay() {
    if (!svg) return;
    // Defensive: see updateDescentOverlay's identical check for why this
    // guards against a stale (already-detached) reference throwing here.
    if (reflectionOverlayGroup && reflectionOverlayGroup.parentNode === svg) {
      svg.removeChild(reflectionOverlayGroup);
    }
    reflectionOverlayGroup = null;
    if (!pendingReflectionNodeId) return;

    const group = svgEl('g', { 'data-reflection-overlay': 'true' });

    const backdrop = svgEl('rect', {
      x: 0,
      y: 0,
      width: VIEW_SIZE,
      height: VIEW_SIZE,
      fill: '#000000',
      opacity: 0.72,
    });
    backdrop.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
    });
    group.appendChild(backdrop);

    const circleR = OVERLAY_CIRCLE_RADIUS;
    const circleGroup = svgEl('g', { transform: `translate(${CENTER} ${CENTER})`, style: 'pointer-events:none;' });

    const glow = svgEl('circle', { r: circleR * 1.18, fill: 'url(#fiery-glow-gradient)' });
    const glowAnim = svgEl('animate', {
      attributeName: 'opacity',
      values: '0.6;1;0.6',
      dur: '2.2s',
      repeatCount: 'indefinite',
    });
    glow.appendChild(glowAnim);
    circleGroup.appendChild(glow);

    const disc = svgEl('circle', { r: circleR, fill: DESCENT_CIRCLE_FILL, stroke: GOLD, 'stroke-width': 4 });
    circleGroup.appendChild(disc);

    const { lineCount: headerLineCount, lineHeight: headerLineHeight } = renderCircleHeader(
      circleGroup,
      circleR,
      REFLECTION_CHAMBER_HEADER
    );

    // Full option descriptions live HERE, not in the per-player boxes
    // (those show only the option's name -- see buildReflectionEl) --
    // same convention as Hot Spring's own overlay.
    const bodyFontSize = 19;
    const bodyLineHeight = 25;
    const bodyMaxWidth = circleR * 1.62;
    let bodyLines = wrapText(REFLECTION_CHAMBER_SUBTEXT, bodyFontSize, bodyMaxWidth);
    bodyLines.push(''); // spacer before the option list
    REFLECTION_CHAMBER_OPTIONS.forEach((opt) => {
      const wrapped = wrapText(`${opt.title}: ${opt.description}`, bodyFontSize, bodyMaxWidth);
      bodyLines = bodyLines.concat(wrapped);
    });

    // Vertically center the whole block within the remaining circle space
    // (below the header) rather than a fixed start y, since the number of
    // lines varies with how each description happens to wrap -- and shift
    // down by however many EXTRA lines the header itself took (see
    // renderCircleHeader) so a wrapped "Reflection" / "Chamber" header
    // never runs into this block.
    const bodyStartY = -((bodyLines.length - 1) * bodyLineHeight) / 2 + 10 + (headerLineCount - 1) * headerLineHeight;
    const bodyEl = multilineText(0, bodyStartY, bodyLines, bodyLineHeight, {
      fill: PREVIEW_TEXT_COLOR,
      'font-family': "'Georgia', 'Times New Roman', serif",
      'font-size': bodyFontSize,
    });
    circleGroup.appendChild(bodyEl);

    group.appendChild(circleGroup);
    svg.appendChild(group);
    reflectionOverlayGroup = group;
  }

  function clearPreview() {
    setPreviewNode(null);
    pendingDescentNodeId = null;
    pendingHotSpringNodeId = null;
    hotSpringSelections = {};
    pendingReflectionNodeId = null;
    reflectionSelections = {};
    updatePreviewOverlay();
    updateDescentOverlay();
    updateHotSpringOverlay();
    updateReflectionOverlay();
  }

  return { render, clearPreview };
}
