import {
  getState,
  patchState,
  awardSoulShards,
  resetRun,
  recordPlayerTurn,
  recordGuardianDefeat,
  recordCombatVictory,
} from '../gameState.js';
import { getCircleForRing, getOverseerForRing, getOrdealEncounter, getHellLord, INQUISITOR_SLOTS_BY_PRIORITY, FIEND_POOL, HARDER_FIEND_RING_THRESHOLD, shouldDealFiend, SOUL_SHARD_AWARDS } from '../enemyData.js';
import { CORNER_INDEX_TO_NAME, CORNER_CSS, EDGE_ROTATION, CORNER_BOX_SIZE } from '../layoutConstants.js';
import {
  computeQueueForecast,
  renderSpeedQueue,
  showQueueSnapshot,
  clearQueueSnapshot,
  getEnemyQueueLabel,
  renderQueuePreviewOverlay,
  clearQueuePreviewOverlay,
  resetQueuePool,
} from './speedQueue.js';

const app = document.getElementById('app');
const DEG_TO_RAD = Math.PI / 180;

// Knockback arc/bolt-count color -- was #f2c94c (same gold/yellow as the
// corruption ring), which read as visually ambiguous with corruption at a
// glance. Distinct orange so the two are never confusable.
const KNOCKBACK_COLOR = '#f2994a';

// --- UTILITY FUNCTIONS ---
function polar(radius, angle) {
  const rad = (angle - 90) * DEG_TO_RAD;
  return { x: Math.cos(rad) * radius, y: Math.sin(rad) * radius };
}

function arcPath(radius, startAngle, endAngle) {
  const s = polar(radius, endAngle);
  const e = polar(radius, startAngle);
  const diff = (endAngle - startAngle + 360) % 360;
  const largeArc = diff > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${largeArc} 0 ${e.x} ${e.y}`;
}

function donutPath(innerR, outerR, startAngle, endAngle) {
  const p1 = polar(outerR, endAngle);
  const p2 = polar(outerR, startAngle);
  const p3 = polar(innerR, startAngle);
  const p4 = polar(innerR, endAngle);
  const diff = (endAngle - startAngle + 360) % 360;
  const largeArc = diff > 180 ? 1 : 0;

  return `M ${p1.x} ${p1.y} A ${outerR} ${outerR} 0 ${largeArc} 0 ${p2.x} ${p2.y} 
          L ${p3.x} ${p3.y} A ${innerR} ${innerR} 0 ${largeArc} 1 ${p4.x} ${p4.y} Z`;
}

function polygonPath(cx, cy, radius, sides, rotate = 0) {
  if (sides === 0)
    return `M ${cx + radius} ${cy} A ${radius} ${radius} 0 1 0 ${
      cx - radius
    } ${cy} A ${radius} ${radius} 0 1 0 ${cx + radius} ${cy}`;
  let d = '';
  for (let i = 0; i < sides; i++) {
    const ang = (i * 360) / sides - 90 + rotate;
    const rad = ang * DEG_TO_RAD;
    const x = cx + Math.cos(rad) * radius;
    const y = cy + Math.sin(rad) * radius;
    d += (i === 0 ? 'M ' : 'L ') + x + ' ' + y + ' ';
  }
  return d + 'Z';
}

// --- CONFIG DATA ---
const COLORS = [
  '#ff5555',
  '#f2c94c',
  '#4da3ff',
  '#27ae60',
  '#f2994a',
  '#9b51e0',
  '#ffffff',
  '#8d6e63',
  '#ff69b4',
];

// --- SPEED TIER TABLE ---
// 7 tiers x 3 slots each. All 21 values are prime numerators over 5000,
// guaranteeing every pair is coprime (no two units can ever share a lap
// cycle at these base speeds). Slot 2 in every tier is reserved for player
// characters; slots 1 and 3 are the only ones assignable to guardians.
const SPEED_SLOT_VALUES = {
  VS1: 877 / 5000, VS2: 881 / 5000, VS3: 883 / 5000,
  S1: 911 / 5000, S2: 919 / 5000, S3: 929 / 5000,
  LS1: 953 / 5000, LS2: 967 / 5000, LS3: 971 / 5000,
  N1: 991 / 5000, N2: 997 / 5000, N3: 1009 / 5000,
  SW1: 1031 / 5000, SW2: 1033 / 5000, SW3: 1039 / 5000,
  F1: 1069 / 5000, F2: 1087 / 5000, F3: 1091 / 5000,
  VF1: 1117 / 5000, VF2: 1123 / 5000, VF3: 1129 / 5000,
};

// --- CIRCLE DATA ---
// Was CIRCLE_COLORS / GUARDIANS_BY_CIRCLE / CIRCLE_ORDER / FIEND_POOL /
// HARDER_FIEND_THRESHOLD, all hardcoded to Limbo only. Now sourced from
// enemyData.js, keyed by ring number instead of circle name (see that
// file's header comment) — nothing here needs to change again as more
// circles are added to CIRCLES_BY_RING.

// Depleting draw pool: once every fiend has been declared, the pool
// refills. Persists across combats within a run (not reset per-circle).
let fiendPoolRemaining = [...FIEND_POOL];
function drawFiend() {
  if (fiendPoolRemaining.length === 0) {
    fiendPoolRemaining = [...FIEND_POOL];
  }
  const idx = Math.floor(Math.random() * fiendPoolRemaining.length);
  return fiendPoolRemaining.splice(idx, 1)[0];
}

// Guardian pools deplete PER RING across the whole run, same principle as
// the fiend pool above — previously guardians were only excluded from
// repeating WITHIN a single combat's simultaneous draw (chosenGuardians,
// reset every declareEnemies() call), so a second clash on the same ring
// could hand a player the exact same guardian they'd just faced. Lazily
// initialized per ring on first use (a shuffled copy of that ring's full
// guardian list), consumed as combats happen on that ring, and refilled
// once exhausted — mirroring drawFiend()'s pattern. Persists for the
// whole run (module-level, never reset by startCombat()) since "deplete
// until exhausted, then reshuffle" is meant to span the whole time a
// party spends on one ring, not just one fight.
const guardianPoolByRing = {};
function drawGuardians(ring, count) {
  if (!guardianPoolByRing[ring]) {
    guardianPoolByRing[ring] = shuffle([...getCircleForRing(ring).guardians]);
  }
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (guardianPoolByRing[ring].length === 0) {
      // Ran out mid-draw (e.g. a 4-player party on a ring with only 4
      // guardians defined) — refill, excluding whichever guardians THIS
      // draw has already picked so a single combat still can't repeat a
      // guardian across its own players.
      const fullPool = getCircleForRing(ring).guardians;
      const remaining = fullPool.filter((g) => !drawn.some((d) => d.name === g.name));
      guardianPoolByRing[ring] = shuffle(remaining.length ? remaining : [...fullPool]);
    }
    drawn.push(guardianPoolByRing[ring].pop());
  }
  return drawn;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// --- IMAGE PRELOADING WITH RETRY ---
// Every icon this file shows (character portraits, the taint/consume
// buttons, the corruption-level badges) is applied via CSS
// background-image on a <div> that gets destroyed and rebuilt on EVERY
// console render (renderPlayerConsoleImmediate does `container.innerHTML
// = ''` and rebuilds from scratch, every single call, and refreshAllConsoles()
// fires that repeatedly and in bursts during normal play). Re-applying an
// already-browser-cached URL as a background-image is effectively free,
// but for a URL that HASN'T finished its first fetch yet, an element being
// torn down and immediately replaced by a new one referencing the same
// URL is exactly the kind of churn that can leave an image stuck
// mid-fetch indefinitely -- the same root cause already found and fixed
// for the map's own player icon (see mapRenderer.js's hudIconImgEls
// comment).
//
// Fix: decouple "when the network fetch happens" from "when the element
// asking for it happens to render" by preloading every icon URL combat
// will need as early as possible (see startCombatPhase below) using a
// real Image() object outside the DOM churn entirely, with retries for
// transient failures. Once an Image() has successfully loaded a URL, the
// browser's own HTTP cache serves every LATER reference to that same URL
// (background-image or otherwise, in this file or map/mapRenderer.js)
// instantly, regardless of how many times the referencing element gets
// destroyed and recreated afterward.
//
// This can only help with TRANSIENT failures (timing/network hiccups) --
// it cannot make a genuinely missing file appear. As of this writing,
// /obsidiumicon.png, /ryadnaeicon.png, /siriaicon.png, /marekicon.png,
// /tainticon.png, and /consumeicon.png do not exist anywhere in this
// project; no amount of retrying will load a URL that 404s. Those files
// need to actually be added for their icons to ever display -- this
// preloader just guarantees that once they DO exist, loading them is as
// reliable as possible.
const imagePreloadCache = new Map(); // url -> Promise<boolean> (resolves true on success, false if all attempts failed)

function preloadImage(url, maxAttempts = 3) {
  if (!url) return Promise.resolve(false);
  const cached = imagePreloadCache.get(url);
  if (cached) return cached;

  const promise = new Promise((resolve) => {
    let attempt = 0;
    const tryLoad = () => {
      attempt++;
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => {
        if (attempt < maxAttempts) {
          // Short, increasing backoff -- gives a flaky connection a beat
          // to recover rather than hammering it three times instantly.
          setTimeout(tryLoad, attempt * 300);
        } else {
          resolve(false);
        }
      };
      img.src = url;
    };
    tryLoad();
  });
  imagePreloadCache.set(url, promise);
  return promise;
}

function preloadImages(urls) {
  return Promise.all(urls.filter(Boolean).map((url) => preloadImage(url)));
}

// Player characters — now built fresh from gameState at the start of each
// combat (buildPlayerCharacters(), called from startCombatPhase below)
// instead of hardcoded to exactly 2 players. Kept as a mutable `let` (not
// `const`) at module scope, same shape as before ({1: {...}, 2: {...}}),
// so every other reference in this file — there are ~10 — needs no
// change: they all just read PLAYER_CHARACTERS via Object.keys/[n], which
// works identically whether it has 1, 2, 3, or 4 entries.
let PLAYER_CHARACTERS = {};

function buildPlayerCharacters() {
  const out = {};
  getState().players.forEach((p, i) => {
    out[i + 1] = { name: p.name, color: p.color, slot: p.slot, icon: p.icon, charId: p.charId };
  });
  return out;
}

// --- CORRUPTION TRACKING ---
// Shared, party-wide pool — not per-player. Segment count per level scales
// with player count. Crossing past level 4's max ends the run in defeat.
const CORRUPTION_TIER_MULT = { 1: 3, 2: 4, 3: 6, 4: 6 };
function corruptionMaxSegments() {
  const numPlayers = Object.keys(PLAYER_CHARACTERS).length;
  return CORRUPTION_TIER_MULT[corruptionLevel] * numPlayers;
}

// --- APP HTML ---
// Fullscreen, orientation-lock fallback, and zoom prevention now live in
// ../platformHardening.js, installed ONCE from the shell (index.html) for
// all three phases -- see INTEGRATION_NOTES.md. Icon preloading also moved
// there, with c.'s icons added to the shell's preloadImages list.

app.innerHTML = `
<style>
  #pause-btn { transition: opacity 0.2s, filter 0.2s; z-index: 10; cursor: pointer; }
  #pause-icon-group, #play-icon-group { transition: opacity 0.15s ease; }
  .flash-on { animation: buttonFlash 0.3s ease-out; }
  @keyframes buttonFlash { 0% { fill: #444; } 100% { fill: #1a1a1f; } }
  
  #ring { background: transparent; touch-action: none; user-select: none; }

  html, body, #app { background: #0b0b0f; margin:0; }
  #game-world { transition: opacity 0.3s ease; }
  .menu-group { opacity: 0; pointer-events: none; transition: opacity 0.2s; }
  .menu-group.active { opacity: 1; pointer-events: all; }
  
  #control-ring { transition: opacity 0.3s ease; }
  
  /* Dimming Logic */
  .dim-state .ctrl-btn, 
  .dim-state .ctrl-icon,
  .dim-state #pause-btn { 
      opacity: 0.3; 
      filter: grayscale(1); 
      transition: opacity 0.2s, filter 0.2s;
  }

  /* Keep Anchor bright and BLUE when active */
  .dim-anchor-active #group-anchor .ctrl-btn,
  .dim-anchor-active #group-anchor .ctrl-icon {
      opacity: 1 !important;
      filter: none !important;
  }

  /* Keep Hex/Rock bright when active */
  .dim-rock-active #group-hex .ctrl-btn,
  .dim-rock-active #group-hex .ctrl-icon {
      opacity: 1 !important;
      filter: none !important;
  }

  .ctrl-btn { cursor: pointer; transition: fill 0.2s, filter 0.2s; }
  .ctrl-btn:hover { filter: brightness(1.2); }
  .ctrl-icon { pointer-events: none; fill: #fff; }
  
  /* Knockback Bolt Black Border */
  .bolt-text {
      paint-order: stroke;
      stroke: #000;
      stroke-width: 6px;
      stroke-linecap: round;
      stroke-linejoin: round;
  }
  /* Orientation-screen CSS removed -- combat no longer runs its own
     orientation-select flow. Orientation is now fixed at hand-off time
     from phase a. (see getPlayerPosition below), before combat ever
     mounts. */
</style>
<div id="combat-screen" style="display:none;">
<svg id="ring" viewBox="-200 -200 400 400" width="100vw" height="100vh" style="background:transparent; touch-action:none; user-select:none;">
  <defs>
    <path id="chevron-path" d="" />
  </defs>

  <g id="game-world">
    <circle id="bg-inner" r="170" fill="#0b0b0f" pointer-events="none" />
    <circle r="150" fill="none" stroke="#444" stroke-width="12" pointer-events="stroke"/>
    <path d="${arcPath(
      150,
      270,
      360
    )}" fill="none" stroke="${KNOCKBACK_COLOR}" stroke-width="12" pointer-events="none"/>
    <circle r="130" fill="none" stroke="#777" stroke-width="12" pointer-events="stroke"/>
    <path d="${arcPath(
      130,
      270,
      360
    )}" fill="none" stroke="${KNOCKBACK_COLOR}" stroke-width="12" pointer-events="none"/>

    <text font-family="monospace" font-weight="900" font-size="27" dy="0.35em" stroke="#000" stroke-width="4" paint-order="stroke" style="pointer-events:none;">
      <textPath id="chevron-display" href="#chevron-path" startOffset="50%" text-anchor="middle"></textPath>
    </text>

    <g id="unit-layer"></g>
    <g id="rock-layer"></g>
    <g id="queue-snapshot-layer"></g>
    <g id="speed-queue-layer"></g>

    <line x1="0" y1="-160" x2="0" y2="-120" stroke="#ff5555" stroke-width="2" pointer-events="none"/>
  </g>

  <g id="control-ring">
    <g id="corruption-ring"></g>
    <circle id="corruption-hit-area" r="93" fill="none" stroke="transparent" stroke-width="30" style="touch-action:none; cursor:ew-resize;" pointer-events="stroke" />

    <g id="pause-btn" style="opacity: 0.6;">
        <circle id="pause-bg" r="18" fill="#1a1a1f" stroke="#444" stroke-width="2" />
        <g id="pause-icon-group" fill="#aaa">
            <rect x="-7" y="-8" width="4.5" height="16" rx="1" />
            <rect x="2.5" y="-8" width="4.5" height="16" rx="1" />
        </g>
        <g id="play-icon-group" fill="#aaa" style="opacity: 0; display: none;">
            <path d="M -6,-9 L -6,9 L 9,0 Z" />
        </g>
    </g>

    <g id="group-anchor">
        <path id="btn-anchor" class="ctrl-btn" d="${donutPath(
          25,
          65,
          0,
          120
        )}" fill="#2d9cdb" stroke="#111" stroke-width="2" />
        <g id="icon-anchor" class="ctrl-icon" transform="translate(36, -21) scale(0.9)"> <path d="M0 -10 L0 8 M-7 4 C-7 10 7 10 7 4" stroke="white" stroke-width="3.5" fill="none"/>
          <circle cx="0" cy="-12" r="3.5" stroke="white" stroke-width="2.5" fill="none"/>
          <line x1="-5" y1="-4" x2="5" y2="-4" stroke="white" stroke-width="3" />
        </g>
    </g>

    <g id="group-star">
        <path class="ctrl-btn" d="${donutPath(
          25,
          65,
          120,
          240
        )}" fill="#27ae60" stroke="#111" stroke-width="2" />
        <g class="ctrl-icon" transform="translate(0, 42) scale(0.9)">
          <!-- Rally (flag) icon -- temporarily replaces the star/cast
               icon here; see RALLY_TOTAL_DEGREES's own comment. Pole +
               a solid triangular flag, in white to match every other
               control-ring icon's fill. Segment itself is green
               (#27ae60, same green already used elsewhere in this file
               for a speed-up/positive indicator) rather than the star's
               old gold, so it doesn't get confused with the corruption
               ring's own gold/amber tones at a glance. -->
          <rect x="-1.5" y="-10" width="3" height="20" fill="white"/>
          <path d="M1.5 -9 L11 -5 L1.5 -1 Z" fill="white"/>
        </g>
    </g>

    <g id="group-hex">
        <path id="btn-hex" class="ctrl-btn" d="${donutPath(
          25,
          65,
          240,
          360
        )}" fill="#4f4f4f" stroke="#111" stroke-width="2" />
        <g class="ctrl-icon" transform="translate(-36, -21) scale(0.9)"> <path d="M-6 -6 L4 -8 L8 -2 L6 6 L-2 8 L-8 2 Z" fill="white"/>
        </g>
    </g>
  </g>

  <g id="drag-preview-layer">
    <circle id="ghost" r="7" fill="#4da3ff" style="opacity: 0;" pointer-events="none"/>
    <path id="ghost-arc" fill="none" stroke="#7fc1ff" stroke-width="3" style="opacity: 0;" pointer-events="none"/>
    <path id="remove-x" d="" fill="none" stroke="#ff5555" stroke-width="4" stroke-linecap="round" style="opacity: 0;" pointer-events="none"/>
    <line id="active-radius" x1="0" y1="0" x2="0" y2="0" stroke-width="2" stroke-dasharray="2 4" style="opacity: 0; pointer-events: none;"/>
    <text id="bolt-display" class="bolt-text" font-family="monospace" font-weight="900" font-size="24" text-anchor="middle" style="pointer-events:none; fill: ${KNOCKBACK_COLOR};"></text>
  </g>
</svg>
</div>
`;

// --- DOM ELEMENTS ---
const ring = document.getElementById('ring');
const gameWorld = document.getElementById('game-world');

// Full-viewport turn-indicator background. Anything drawn INSIDE the SVG is
// bounded by its letterboxed square (viewBox scaled via xMidYMid meet) and
// can never reach the actual screen edges on a non-square viewport. This
// lives at the plain HTML level instead, sized to the true browser
// viewport, and sits behind the ring (z-index below it) so ring lines/units
// still render on top.
const turnBgOverlay = document.createElement('div');
turnBgOverlay.id = 'turn-bg-overlay';
turnBgOverlay.style.cssText =
  'position:fixed; inset:0; z-index:0; background:#0b0b0f;';
const turnBgPattern = document.createElement('div');
turnBgPattern.style.cssText =
  'position:absolute; inset:0; opacity:0.3; background-repeat:repeat; display:none;';
turnBgOverlay.appendChild(turnBgPattern);
document.getElementById('app').insertBefore(turnBgOverlay, document.getElementById('app').firstChild);
ring.style.position = 'relative';
ring.style.zIndex = '1';

// Keyed by CHARACTER id (charId, from orientation/select.js's charData --
// 'ryadnae', 'obsidium', 'siria', 'marek'), not by pNum/seat position.
// pNum is just "whichever player is in roster slot N" (see
// buildPlayerCharacters -- it's built from getState().players in
// whatever order they finished orientation select in), so a fixed
// pNum-keyed map like {1: RyadnaeBG, 2: ObsidiumBG} only "worked" by
// coincidence when the first two players in the roster happened to be
// playing exactly those two characters -- for any other seating, or for
// a 3rd/4th player at all, it fell through to the flat-color branch
// below, the SAME branch guardians/enemies use. Since a guardian's own
// dot color is deliberately set to its engaged PLAYER's color (see
// createUnit calls in startCombat -- "colored by its engaged player"),
// that flat-color fallback for an unmapped player used the exact same
// color as that player's own guardian's turn indicator: a player's own
// turn and their opponent's turn became visually identical. Keying by
// character identity instead of seat number fixes this correctly for
// any seating arrangement, not just the 2-player case that happened to
// line up before.
//
// SiriaBG.svg and MarekBG.svg do not exist in this project yet and need
// to be supplied (matching RyadnaeBG.svg/ObsidiumBG.svg's format) --
// until then, those two characters' own turns still safely fall back to
// the flat neutral grey base (#4a4a4a) below rather than silently
// reverting to sharing a color with their guardian again, so this is
// correct-but-plain immediately and gets the intended pattern the moment
// those two files are added, with no further code changes needed.
const PLAYER_BG_PATTERN = {
  ryadnae: '/RyadnaeBG.svg',
  obsidium: '/ObsidiumBG.svg',
  siria: '/SiriaBG.svg',
  marek: '/MarekBG.svg',
};

// Turn indicator: a player's own turn fills the FULL screen with a neutral
// grey + their unique repeating pattern at 30% opacity; a guardian's turn
// keeps a flat color fill. This disambiguates player-turn from
// guardian-turn without needing on-screen text.
function setTurnIndicator(unit) {
  const parts = unit.id.split('_');
  const kind = parts[0]; // 'player' or 'guardian'
  const pNum = Number(parts[1]);
  const charId = PLAYER_CHARACTERS[pNum] && PLAYER_CHARACTERS[pNum].charId;

  if (kind === 'player') {
    // Neutral grey base regardless of whether a pattern image is
    // available for this character -- see PLAYER_BG_PATTERN's own
    // comment. This alone is enough to guarantee a player's own turn is
    // never the same fill as any guardian's (guardians always use the
    // flat unit.color branch below), even before every character's
    // pattern SVG has been supplied.
    turnBgOverlay.style.background = '#4a4a4a';
    const pattern = charId && PLAYER_BG_PATTERN[charId];
    if (pattern) {
      turnBgPattern.style.backgroundImage = `url('${pattern}')`;
      turnBgPattern.style.display = '';
    } else {
      turnBgPattern.style.display = 'none';
    }
  } else {
    turnBgOverlay.style.background = unit.color;
    turnBgPattern.style.display = 'none';
  }
}

function clearTurnIndicator() {
  turnBgOverlay.style.background = '#0b0b0f';
  turnBgPattern.style.display = 'none';
}
const unitLayer = document.getElementById('unit-layer');
const rockLayer = document.getElementById('rock-layer');
const speedQueueLayer = document.getElementById('speed-queue-layer');
const queueSnapshotLayer = document.getElementById('queue-snapshot-layer');
// Curved queue sits OUTSIDE the bg-inner black boundary circle (radius
// 170 -- see the <circle id="bg-inner" r="170"> in the SVG template
// above), out in the plain background alongside the ring rather than
// overlapping it, per user correction: icons were overlapping ring
// tokens as they moved past the action line at the original tighter
// radius. 185 leaves headroom on both sides before the viewBox's own
// r=200 edge, given each icon's own ~9-10 unit radius.
const QUEUE_RADIUS = 185;
// Which queue slot (if any) is frozen in Simulation Snapshot mode (TRD
// 3.1), and the projected angles that snapshot is showing.
let selectedQueueIndex = null;
let selectedQueueSnapshot = null;

// Phase 2/3 (TRD 2.1-2.5): while a knockback/speed-change drag, a
// pending boulder placement, a rally, or an anchor selection is live,
// this holds what's being tentatively changed --
//   { unitOverrides: { [unitId]: { angle? , speedMult? } },
//     extraRocks: [ { radius, angle, remainingMs } ],
//     trackedUnitIds: [ unitId, ... ] }
// -- so the queue can render a candidate forecast instead of the
// committed one. `unitOverrides` covers knockback/speed-change (one
// unit) and rally (several at once, moved by the same share); extraRocks
// covers a pending boulder placement (which doesn't override any unit
// directly -- it changes the forecast by blocking whoever runs into it).
// trackedUnitIds is who gets the ghost+arrow overlay treatment -- for a
// boulder placement this is whichever units the candidate rock would
// actually end up blocking, not a fixed unit. Set from the ring's
// pointermove handler (knockback/speed) or the relevant button's flow
// (boulder/rally/anchor) once a preview is showing, cleared on
// commit or cancel either way.
let queuePreviewOverride = null;

function handleQueueIconTap(entry, index) {
  if (selectedQueueIndex === index) {
    selectedQueueIndex = null;
    selectedQueueSnapshot = null;
    clearQueueSnapshot();
    return;
  }
  selectedQueueIndex = index;
  selectedQueueSnapshot = entry.snapshot;
  showQueueSnapshot(queueSnapshotLayer, entry.snapshot, unitsById());
}

function clearQueueSnapshotSelection() {
  if (selectedQueueIndex === null) return;
  selectedQueueIndex = null;
  selectedQueueSnapshot = null;
  clearQueueSnapshot();
}

function unitsById() {
  const map = new Map();
  units.forEach((u) => map.set(u.id, u));
  return map;
}

// Plain-object rock snapshot computeQueueForecast expects -- the real
// `rocks` array holds live DOM-carrying objects (`.el`), which
// computeQueueForecast doesn't need and shouldn't be handed a reference
// to (it never mutates its rocks input, but there's no reason to pass
// live objects into a pure function either).
function rocksSnapshot() {
  return rocks.map((r) => ({ radius: r.radius, angle: r.angle, remainingMs: r.remainingMs }));
}

// Recomputes and redraws the curved chronological queue from the CURRENT
// live ring state. Cheap enough (small unit counts, <=~150 forecast
// steps worst case) to call every animation frame -- see tick()'s call
// site below -- so the queue never needs its own separate dirty-tracking
// alongside every place that can change a unit's angle/speed/anchored
// state (gestures, undo, rock blocking, overseer pass-throughs...).
// Rally's deferred-move marker (pendingRallyMoves, see performRally's own
// comment on why the AT-TURN unit's real `.angle` doesn't update until
// its turn actually ends) and a live knockback's 300ms ease (see that
// ease's own code -- `u.angle` stays at its PRE-knockback value the
// entire time, only snapping to `knockback.to` once the ease completes)
// are both genuinely COMMITTED facts the instant they're set -- where
// that unit ends up is already fully determined -- they just haven't
// landed in `.angle` yet. Reading `units` directly for the forecast
// (committed OR preview) would show a stale angle until one of these
// catches up, which is exactly the mismatch a user caught for rally (see
// INTEGRATION_NOTES.md): the queue preview correctly showed a unit
// overtaking another post-rally, but the COMMITTED queue right after
// confirming reverted to the pre-rally order. Knockback has the
// identical structural gap, just a much shorter-lived one (300ms) --
// folded in here for the same reason before it could cause the same
// class of report.
function unitsWithDeferredMovesApplied() {
  const rallyTarget =
    turnPendingUnit && pendingRallyMoves[turnPendingUnit.id]
      ? pendingRallyMoves[turnPendingUnit.id].targetAngle
      : null;

  if (rallyTarget === null && !knockback) return units;

  return units.map((u) => {
    if (rallyTarget !== null && u === turnPendingUnit) return { ...u, angle: rallyTarget };
    if (knockback && knockback.unit === u) return { ...u, angle: knockback.to };
    return u;
  });
}

function updateSpeedQueueDisplay() {
  // Per user correction: the queue shows only SUBSEQUENT turns -- the
  // unit currently paused on the action line (turnPendingUnit) is not
  // repeated as its own queue entry, since the action line already shows
  // whose turn it is.
  //
  // Real rocks are now folded in too (previously this ignored them
  // entirely, which was silently wrong any time one was in play).
  const baseUnits = unitsWithDeferredMovesApplied();
  const committedRocks = rocksSnapshot();
  // The real overseerThresholdCount deliberately stays PINNED AT target
  // (showing e.g. "4/4") for as long as the resulting activation turn is
  // being displayed -- see overseerThresholdCount's own module-level
  // comment and overseerThresholdAwaitingReset. Feeding that raw,
  // still-at-target count into the forecast makes it think just ONE more
  // dot crossing will trigger the NEXT activation, when in reality the
  // counter resets to 0 the moment this turn is dismissed and a FULL
  // fresh cycle is needed -- exactly the bug a user caught: the queue
  // showed the very next overseer dot as the upcoming shared turn, when
  // actually four fresh crossings were still needed. The reset is
  // already a guaranteed, pending fact the instant
  // overseerThresholdAwaitingReset flips true, so it's folded in here
  // immediately, same reasoning as the deferred-move helper above.
  const effectiveOverseerThresholdCount = overseerThresholdAwaitingReset ? 0 : overseerThresholdCount;
  const committedForecast = computeQueueForecast(baseUnits, {
    overseerThresholdCount: effectiveOverseerThresholdCount,
    overseerThresholdTarget,
    rocks: committedRocks,
  });

  // Phase 2/3: during a live preview (knockback/speed-change drag, a
  // pending boulder placement, rally, or anchor selection), the CANDIDATE
  // forecast still gets computed (needed for the overlay's old/new slot
  // diffing below) but is no longer what gets RENDERED as the queue
  // itself -- see renderSpeedQueue's own call just below. State
  // Isolation (TRD 4.1): both the candidate unit array and the candidate
  // rocks array are fresh clones built fresh every frame, never written
  // back into `units`/`rocks`, so a cancel just stops overriding and the
  // very next frame's committedForecast (already computed above,
  // untouched) takes back over with zero cleanup needed.
  let previewForecast = null;
  if (queuePreviewOverride) {
    const candidateUnits = baseUnits.map((u) =>
      queuePreviewOverride.unitOverrides[u.id] ? { ...u, ...queuePreviewOverride.unitOverrides[u.id] } : u
    );
    const candidateRocks = [...committedRocks, ...queuePreviewOverride.extraRocks];
    previewForecast = computeQueueForecast(candidateUnits, {
      overseerThresholdCount: effectiveOverseerThresholdCount,
      overseerThresholdTarget,
      rocks: candidateRocks,
    });
  }

  // Per explicit user feedback + a mockup (round 2 of the queue's visual
  // design): freezing bystanders during a preview (the PREVIOUS attempt
  // at fixing the ghost/replacement-icon collision) traded one problem
  // for another -- a unit's floating "new position" marker still landed
  // on top of whichever bystander's UNCHANGED slot happened to share
  // that same angleForSlot() index, AND the queue no longer showed
  // where anything else in the order actually ended up during a preview.
  // Rendering the REAL pooled queue from the CANDIDATE forecast (letting
  // the whole row reflow, same as before either fix) solves both: every
  // unit's resulting position is visible at a glance, and the tracked
  // unit's old slot is genuinely VACATED by the reflow (everyone between
  // old and new slides by exactly one), so the ghost overlay below no
  // longer has anything real to collide with.
  const forecast = queuePreviewOverride ? previewForecast : committedForecast;
  renderSpeedQueue({
    layer: speedQueueLayer,
    forecast,
    liveUnitsById: unitsById(),
    guardianAssignment,
    radius: QUEUE_RADIUS,
    onTapIcon: handleQueueIconTap,
    selectedIndex: selectedQueueIndex,
  });

  if (queuePreviewOverride) {
    renderQueuePreviewOverlay({
      layer: speedQueueLayer,
      committedForecast,
      previewForecast,
      unitIds: queuePreviewOverride.trackedUnitIds,
      radius: QUEUE_RADIUS,
      liveUnitsById: unitsById(),
      guardianAssignment,
    });
  } else {
    clearQueuePreviewOverlay();
  }

  // Live-refresh an active snapshot so it stays correct if the player
  // re-opens the same slot after something upstream changed (e.g. an
  // undo) -- cheap redundancy, not a hot path.
  if (selectedQueueIndex !== null && forecast[selectedQueueIndex]) {
    selectedQueueSnapshot = forecast[selectedQueueIndex].snapshot;
    showQueueSnapshot(queueSnapshotLayer, selectedQueueSnapshot, unitsById());
  }
}
const dragPreviewLayer = document.getElementById('drag-preview-layer');
const controlRing = document.getElementById('control-ring');
const ghost = document.getElementById('ghost');
const ghostArc = document.getElementById('ghost-arc');
const removeX = document.getElementById('remove-x');
const chevronPath = document.getElementById('chevron-path');
const chevronDisplay = document.getElementById('chevron-display');
const activeRadiusLine = document.getElementById('active-radius');
const boltDisplay = document.getElementById('bolt-display');
const pauseBtn = document.getElementById('pause-btn');
const pauseBg = document.getElementById('pause-bg');
const pauseIconGroup = document.getElementById('pause-icon-group');
const playIconGroup = document.getElementById('play-icon-group');

const btnAnchor = document.getElementById('btn-anchor');
const btnHex = document.getElementById('btn-hex');
const groupAnchor = document.getElementById('group-anchor');

// --- PLAYER POSITIONING ---
// Orientation is no longer selected here — it's fixed at hand-off time
// from phase a. (gameState.players[i].corner / .orientationEdge). This
// section is now just a read-only lookup that returns the same
// {corner, edge} shape ORIENT_POSITIONS entries used to have, so
// everything downstream (CORNER_CSS lookups, EDGE_LABEL_ROTATION) is
// unchanged.
const combatScreen = document.getElementById('combat-screen');

const EDGE_LABEL_ROTATION = EDGE_ROTATION; // local alias -- kept so the
                                            // rest of this file's many
                                            // existing EDGE_LABEL_ROTATION
                                            // references don't all need
                                            // renaming; the values now
                                            // come from the shared module.

// gameState corner indices (0=TL,1=TR,2=BL,3=BR, per orientation/select.js's
// cornerNames) -> the string keys CORNER_CSS (below, in
// renderPlayerConsoleImmediate) already uses.
// (CORNER_INDEX_TO_NAME itself now comes from ../layoutConstants.js)

// Approximate screen-percentage anchor per corner (used only by
// renderDeclarationScreen, via resolvePos below, to place that player's
// guardian/fiend card near their seat). Was 8 fine-grained edge positions
// under the old orientation-select flow; collapsed to one point per
// corner since declaration-card placement never needed edge-level
// precision — just "near this player's corner."
const CORNER_TO_PCT = {
  'top-left': { left: '10%', top: '10%' },
  'top-right': { left: '90%', top: '10%' },
  'bottom-left': { left: '10%', top: '90%' },
  'bottom-right': { left: '90%', top: '90%' },
};

// Converts a position's percentage-based left/top into pixels, clamped so
// nothing ever renders closer than a given margin to the actual screen
// edge — regardless of viewport size or aspect ratio.
function resolvePos(pos, margin = 60) {
  const pctX = parseFloat(pos.left) / 100;
  const pctY = parseFloat(pos.top) / 100;
  let px = pctX * window.innerWidth;
  let py = pctY * window.innerHeight;
  px = Math.min(Math.max(px, margin), window.innerWidth - margin);
  py = Math.min(Math.max(py, margin), window.innerHeight - margin);
  return { left: px + 'px', top: py + 'px' };
}

function getPlayerPosition(playerNum) {
  const player = getState().players[playerNum - 1];
  if (!player) return undefined;
  const corner = CORNER_INDEX_TO_NAME[player.corner];
  return { corner, edge: player.orientationEdge, ...CORNER_TO_PCT[corner] };
}

// --- ENEMY DECLARATION ---
let guardianAssignment = {}; // playerNum -> live guardian state
let fiendAssignment = {}; // playerNum -> { num, name }
let currentRing = null; // set by beginDeclaration -- the ring number this
                         // combat is happening on, threaded through from
                         // map/mapPhase.js via pendingCombat.ring. Needed
                         // again later for the harder-fiend check and for
                         // renderDeclarationScreen's header/color.

// --- OVERSEER MODE STATE ---
// isOverseerCombat: true for the whole combat when pendingCombat.nodeType
// is 'OVERSEER'. overseerThresholdCount/Target implement the
// cumulative-threshold rule: overseer dots pass through the action line
// without stopping the clock until `overseerThresholdTarget` (= number of
// active players) of them have crossed, at which point the crossing that
// trips it behaves like a normal stopping turn. The counter resets to 0
// only once THAT turn concludes (see overseerThresholdAwaitingReset
// below), not the instant it's reached -- see the pass-through branch in
// tickInner() below.
let isOverseerCombat = false;
let overseerThresholdCount = 0;
let overseerThresholdTarget = 0;
// True from the moment overseerThresholdCount reaches
// overseerThresholdTarget until the resulting turn is dismissed (the next
// double-tap-to-resume). Ticker reads "N/N" for that whole span instead
// of the reset happening before the player's even seen the trigger --
// then the resume handler zeroes the count and clears this flag together.
let overseerThresholdAwaitingReset = false;

// --- HELL LORD MODE STATE ---
// Hell Lord reuses the EXACT same cumulative-threshold dot mechanic and
// shared-hp/corruption-pool group behavior as Overseer (see
// syncOverseerGroup/defeatOverseerGroup and isSharedBossGroup below) --
// per spec, "the combat float experience is the same with the threshold
// and tickers." It is deliberately NOT flagged as isOverseerCombat,
// though, and its guardianAssignment entries use isHellLord rather than
// isOverseer -- the Hell Lord is not an Overseer, it just happens to play
// out identically at the mechanical level. Two things ARE different: no
// fiend is dealt up front (see declareHellLordEncounter), and if/when
// fiends do get introduced later in a Hell Lord fight, they come from
// HELL_LORD_FIEND_POOL, a separate pool from the regular FIEND_POOL --
// see that pool's own comment for what's still unresolved there.
let isHellLordCombat = false;

// True for ANY shared-boss-group guardian entry -- currently Overseer
// (isOverseer) or Hell Lord (isHellLord). Everywhere this file needs to
// know "does defeating/syncing this one entry affect every OTHER player's
// copy of the same shared boss" should check this, not g.isOverseer
// directly, so Hell Lord automatically gets the identical group behavior
// without needing every call site touched again if a third shared-boss
// type is ever added.
function isSharedBossGroup(g) {
  return !!(g && (g.isOverseer || g.isHellLord));
}

// --- ORDEAL MODE STATE ---
// Ordeal nodes reuse the exact same cumulative-threshold dot mechanic as
// Overseer (overseerThresholdCount/Target above) for gating when an
// Inquisitor's shared turn actually happens -- an Inquisitor's dots are
// tagged isOverseerDot too (see startCombat()) so tickInner()'s
// pass-through logic doesn't need to know or care which mode it's in.
// What's specific to Ordeal is tracked here instead: isOrdealCombat is
// the mode flag (mutually exclusive with isOverseerCombat -- beginDeclaration
// resets both every combat), and ordealState holds the Ordeal's own live,
// real, depletable corruption pool plus its turn clock. This is
// deliberately a plain object rather than routed through
// guardianAssignment, because an Ordeal isn't a guardian at all -- it has
// no HP, isn't tied to any one player's dot, and is selected via its own
// dedicated white toggle-dot rather than one of the colored per-player
// ones. See the white-dot toggle and its card-rendering branch in
// renderPlayerConsoleImmediate below.
let isOrdealCombat = false;
let ordealState = null; // { name, corruption, turnsAllowed, turnsElapsed, incrementalCorruptionPerPlayer, numPlayers }
const ORDEAL_SENTINEL = 'ORDEAL'; // consoleActiveGroup[pNum] value meaning "showing the Ordeal card, not a guardian"

// guardianAssignment entries never literally SHARE an object reference
// across players -- buildSnapshot()'s JSON.stringify/parse round-trip
// (used for both saveState() and markTurnBoundary()) would silently break
// that sharing on the very next undo, since JSON has no concept of object
// identity. Instead, every mutation site for an Overseer's hp/corruption/
// defeated fields calls this immediately afterward, which copies the
// mutated object's values onto every OTHER guardianAssignment entry in the
// same overseer group (matched by overseerId). As long as this is called
// synchronously after every mutation and before any saveState()/
// markTurnBoundary() snapshot, every entry is already value-identical at
// the moment it gets cloned, so the "shared pool" behavior survives undo/
// redo for free without needing real reference sharing anywhere.
function syncOverseerGroup(g) {
  if (!isSharedBossGroup(g)) return;
  Object.values(guardianAssignment).forEach((other) => {
    if (other === g) return;
    if (isSharedBossGroup(other) && other.overseerId === g.overseerId) {
      other.hp = g.hp;
      other.corruption = g.corruption;
      other.defeated = g.defeated;
    }
  });
}

// Called whenever a player's own unit is removed from combat -- currently
// only reachable via dragging their dot off the ring (see the radial
// drag-release handler), but any future automated cause of player death
// (a status effect dealing lethal damage on its own turn, say) should
// route through this same function after removing the unit.
//
// In a plain Clash, each player's guardian is entirely independent of
// every other player's -- nothing here needs to change when one player
// leaves. In a JOINT-enemy fight (Overseer/Hell Lord/etc, where every
// player's guardian_N dot is really one shared boss split across N dots
// -- see isSharedBossGroup), that player's own guardian_N dot represents
// a seat in the shared turn cycle that no longer has a living player
// behind it: it comes out too, and the shared threshold that seat
// contributed to drops to match.
//
// guardianAssignment[pNum] is DELETED here, not marked defeated -- marking
// it defeated would make checkVictory()'s "every entry defeated" check
// count a player's death as having WON that portion of the fight, which
// could falsely trigger victory. Deleting the entry removes that seat
// from consideration entirely instead, same as it never having existed,
// so victory still correctly depends only on the seats still in play.
//
// Deliberately NOT forcing an immediate threshold check/turn here even if
// the reduced target now sits at or below the current count -- e.g. count
// 3/4 dropping to 3/3 the instant a player dies mid-turn, with no enemy
// unit actually sitting on the action line at that moment. A "turn"
// should only ever begin because a real unit is genuinely AT the line;
// forcing one here would show a turn for nothing. This is left to
// resolve naturally instead: tickInner's own threshold check already
// uses >= (not ===), so the very NEXT real enemy crossing -- whichever
// one happens to come next -- both increments the count past the new
// target AND correctly recognizes that as reaching threshold in the same
// step (reading as e.g. "4/3" for just that one turn), then behaves
// normally (0/3 up through 3/3) after that turn resolves and resets.
function handlePlayerRemovedFromCombat(playerUnit) {
  if (!isOverseerCombat && !isHellLordCombat) return;

  const pNum = Number(playerUnit.id.split('_')[1]);
  const guardianUnit = units.find((u) => u.id === 'guardian_' + pNum);
  if (guardianUnit) {
    removeCastsForUnit(guardianUnit);
    if (pendingRallyMoves[guardianUnit.id]) {
      const m = pendingRallyMoves[guardianUnit.id];
      if (m.group) m.group.remove();
      delete pendingRallyMoves[guardianUnit.id];
    }
    if (turnPendingUnit === guardianUnit) turnPendingUnit = null;
    guardianUnit.el.remove();
    units = units.filter((u) => u !== guardianUnit);
  }

  delete guardianAssignment[pNum];

  // Floor at 1 -- a target of 0 would make every single future crossing
  // simultaneously satisfy ">= target" from the very first dot, which
  // isn't a meaningful "shared threshold" anymore. (If every player has
  // died, the run has almost certainly ended some other way by this
  // point; this floor just keeps the number itself sane rather than
  // asserting anything about that scenario.)
  overseerThresholdTarget = Math.max(1, overseerThresholdTarget - 1);

  refreshAllConsoles();
  checkVictory(); // removing this seat may leave every remaining one already defeated
}

// Run-wide stat: "which player defeated the most guardians," defined as
// enemy GROUPS removed while that player's own dot was on the action
// line at the moment of the defeat. Called from every place a guardian
// entry actually gets defeated (the skull button, and dragging a
// guardian dot off the ring) -- centralized here rather than duplicated
// at each call site so every defeat path credits the same way. If it
// isn't currently some player's own turn (turnPendingUnit is an enemy
// dot, or nobody's turn at all), the defeat simply isn't credited to
// anyone, per spec.
function creditGuardianDefeatToCurrentTurnPlayer() {
  if (turnPendingUnit && turnPendingUnit.id && turnPendingUnit.id.startsWith('player_')) {
    const pNum = Number(turnPendingUnit.id.split('_')[1]);
    recordGuardianDefeat(pNum - 1); // gameState's players array is 0-indexed; pNum is 1-indexed
  }
}

function declareEnemies(ring) {
  const playerNums = Object.keys(PLAYER_CHARACTERS).map(Number);
  // drawGuardians pulls from the RING's persistent depleting pool (see
  // guardianPoolByRing above) instead of a pool that resets every combat
  // — this is what actually prevents a second clash on the same ring
  // from handing a player the same guardian they already faced.
  const guardians = drawGuardians(ring, playerNums.length);

  playerNums.forEach((pNum, i) => {
    const g = guardians[i];
    guardianAssignment[pNum] = {
      name: g.name,
      slot: g.slot,
      maxHp: g.maxHp,
      hp: g.maxHp,
      corruption: g.corruption,
      defeated: false,
      color: PLAYER_CHARACTERS[pNum].color, // engaged-with player's color
    };

    // Fiends are only dealt on rings 2 (Lust) through 8 (Fraud) -- see
    // shouldDealFiend's own comment. Limbo (ring 1) never gets one; a
    // missing fiendAssignment entry is already the established "no fiend"
    // signal elsewhere in this file (see the Ordeal path just below,
    // which also never sets one).
    if (shouldDealFiend(ring)) {
      fiendAssignment[pNum] = drawFiend();
    }
  });
}
// the SAME boss (same name, same shared hp/corruption pool, scaled by
// player count) instead of a distinct drawn guardian, but each still gets
// their own individually-drawn fiend, same as Clash -- per spec item (a).
// Each player still gets their own guardianAssignment entry (so all the
// existing per-player console/toggle/unit machinery below works
// unchanged) but every entry in the group is kept value-identical via
// syncOverseerGroup() rather than literally being the same object -- see
// that function's comment for why.
function declareOverseerEncounter(ring) {
  const playerNums = Object.keys(PLAYER_CHARACTERS).map(Number);
  const overseer = getOverseerForRing(ring);
  const numPlayers = playerNums.length;

  const slots = overseer.slotsByPriority.slice(0, numPlayers);
  if (slots.length < numPlayers) {
    throw new Error(
      `enemyData: overseer "${overseer.name}" for ring ${ring} only defines ${slots.length} speed slot(s), but this combat has ${numPlayers} players. Add more entries to slotsByPriority.`
    );
  }

  const sharedHp = overseer.hpPerPlayer * numPlayers;
  const sharedCorruption = overseer.corruptionPerPlayer * numPlayers;
  // Unique per encounter (not just per ring) so a stale overseerId can
  // never accidentally match across two different Overseer fights on the
  // same ring within one run.
  const overseerId = 'overseer_' + ring + '_' + Date.now();

  playerNums.forEach((pNum, i) => {
    guardianAssignment[pNum] = {
      name: overseer.name,
      slot: slots[i],
      maxHp: sharedHp,
      hp: sharedHp,
      corruption: sharedCorruption,
      defeated: false,
      color: PLAYER_CHARACTERS[pNum].color, // own-player color, same convention as Clash
      isOverseer: true,
      overseerId,
    };

    // Same "Limbo never deals a fiend" rule as declareEnemies() -- see
    // shouldDealFiend's own comment. An Overseer fight is very unlikely
    // to ever occur on ring 1 in practice, but this keeps the rule
    // correct by construction rather than by which rings happen to host
    // an Overseer node today.
    if (shouldDealFiend(ring)) {
      fiendAssignment[pNum] = drawFiend();
    }
  });

  overseerThresholdTarget = numPlayers;
}

// Hell Lord counterpart to declareOverseerEncounter() -- structurally
// identical (shared hp/corruption pool split across every player's own
// dot, synced via syncOverseerGroup/isSharedBossGroup, same
// overseerThresholdTarget wiring for the shared ticker), but:
//   - entries are tagged isHellLord instead of isOverseer, since per spec
//     "they are not overseers" even though the mechanic is the same --
//     see isSharedBossGroup's own comment for everywhere that distinction
//     is (deliberately) erased again for shared behavior.
//   - getHellLord() takes no ring argument (Hell Lord isn't ring-bound --
//     see its own comment in enemyData.js); `ring` is still accepted here
//     purely for the overseerId's uniqueness suffix, matching
//     declareOverseerEncounter's shape.
//   - NO fiend is dealt to anyone here, unlike declareOverseerEncounter --
//     per spec, Hell Lord fights start with none. See
//     HELL_LORD_FIEND_POOL's own comment in enemyData.js for what's still
//     unresolved about introducing them later in the fight.
function declareHellLordEncounter(ring) {
  const playerNums = Object.keys(PLAYER_CHARACTERS).map(Number);
  const hellLord = getHellLord();
  const numPlayers = playerNums.length;

  const slots = hellLord.slotsByPriority.slice(0, numPlayers);
  if (slots.length < numPlayers) {
    throw new Error(
      `enemyData: Hell Lord "${hellLord.name}" only defines ${slots.length} speed slot(s), but this combat has ${numPlayers} players. Add more entries to its slotsByPriority in HELL_LORD_POOL.`
    );
  }

  const sharedHp = hellLord.hpPerPlayer * numPlayers;
  const sharedCorruption = hellLord.corruptionPerPlayer * numPlayers;
  const overseerId = 'hell_lord_' + ring + '_' + Date.now();

  playerNums.forEach((pNum, i) => {
    guardianAssignment[pNum] = {
      name: hellLord.name,
      slot: slots[i],
      maxHp: sharedHp,
      hp: sharedHp,
      corruption: sharedCorruption,
      defeated: false,
      color: PLAYER_CHARACTERS[pNum].color,
      isHellLord: true,
      overseerId,
    };
    // Deliberately no fiendAssignment[pNum] here -- see this function's
    // own comment above.
  });

  overseerThresholdTarget = numPlayers;
}

// Ordeal-mode counterpart to declareOverseerEncounter(): every player gets
// their own Inquisitor dot (same shared-turn cumulative-threshold timing
// as an Overseer, via the isOverseerDot tag applied in startCombat()), but
// NO fiend is dealt to anyone -- per spec, fiends are excluded entirely
// from an Ordeal's combat prep. The Ordeal itself (its name/corruption/
// turn clock) is tracked separately in ordealState, not as a
// guardianAssignment entry, since it isn't tied to any one player's dot.
function declareOrdealEncounter(ring) {
  const playerNums = Object.keys(PLAYER_CHARACTERS).map(Number);
  const { inquisitor, ordeal } = getOrdealEncounter();
  const numPlayers = playerNums.length;

  const slots = INQUISITOR_SLOTS_BY_PRIORITY.slice(0, numPlayers);
  if (slots.length < numPlayers) {
    throw new Error(
      `enemyData: INQUISITOR_SLOTS_BY_PRIORITY only defines ${slots.length} speed slot(s), but this combat has ${numPlayers} players. Add more entries.`
    );
  }

  const inquisitorId = 'inquisitor_' + ring + '_' + Date.now();

  playerNums.forEach((pNum, i) => {
    guardianAssignment[pNum] = {
      name: inquisitor.name,
      slot: slots[i],
      // No hp/corruption fields at all -- isInquisitor is checked
      // wherever a card would normally read/drag those, and the infinity
      // glyph is rendered instead. defeated stays permanently false: an
      // Inquisitor has no skull button and can never actually be marked
      // defeated (see renderPlayerConsoleImmediate), so alivePlayers/
      // checkVictory's "every guardianAssignment entry defeated" check
      // can never accidentally fire for an Ordeal combat -- checkVictory
      // also has an explicit isOrdealCombat guard as a second backstop.
      defeated: false,
      color: PLAYER_CHARACTERS[pNum].color,
      isInquisitor: true,
      overseerId: inquisitorId, // reuses syncOverseerGroup's field name/shape even though Inquisitors don't need value-syncing (no mutable stat exists to sync) -- kept for shape consistency, harmless.
    };
    // Deliberately no fiendAssignment[pNum] here -- Inquisitors have no
    // paired fiends, and renderDeclarationScreen skips the fiend card
    // entirely when isOrdealCombat (see below).
  });

  ordealState = {
    name: ordeal.name,
    corruption: ordeal.baseCorruption + ordeal.corruptionPerPlayer * numPlayers,
    turnsAllowed: ordeal.turnsAllowed,
    turnsElapsed: 0,
    incrementalCorruptionPerPlayer: ordeal.incrementalCorruptionPerPlayer,
    numPlayers,
  };

  overseerThresholdTarget = numPlayers; // same shared dot-threshold machinery as Overseer
}

// --- DECLARATION SCREEN ---
const declarationScreen = document.createElement('div');
declarationScreen.id = 'declaration-screen';
declarationScreen.style.cssText =
  'position:fixed; inset:0; background:#0b0b0f; z-index:40; display:none;';
document.getElementById('app').appendChild(declarationScreen);

function buildGuardianCard(gState, color) {
  const card = document.createElement('div');
  card.style.cssText = `
    width:220px; height:220px; border-radius:50%;
    border:8px solid ${color}; background:#1a1a1f;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    position:relative; margin:0 auto;
  `;

  const name = document.createElement('div');
  name.textContent = gState.name.toUpperCase();
  name.style.cssText =
    'color:#fff; font-weight:700; font-size:20px; text-align:center; padding:0 12px;';
  card.appendChild(name);

  const stats = document.createElement('div');
  stats.style.cssText =
    'display:flex; gap:24px; margin-top:14px; font-size:26px; font-weight:700;';
  // Inquisitors have no hp/corruption fields at all (see
  // declareOrdealEncounter) -- infinite and unbeatable, shown as such
  // even at declaration time rather than "undefined".
  const hpDisplay = gState.isInquisitor ? '&#8734;' : gState.hp;
  const corruptionDisplay = gState.isInquisitor ? '&#8734;' : gState.corruption;
  stats.innerHTML = `
    <span style="color:#ff5555;">${hpDisplay}</span>
    <span style="color:#f2c94c;">${corruptionDisplay}</span>
  `;
  card.appendChild(stats);

  return card;
}

function renderDeclarationScreen() {
  declarationScreen.innerHTML = '';
  const circle = getCircleForRing(currentRing);
  const circleColor = circle.color;
  const isHarderFiend = currentRing >= HARDER_FIEND_RING_THRESHOLD;

  Object.keys(PLAYER_CHARACTERS).forEach((key) => {
    const pNum = Number(key);
    const pos = getPlayerPosition(pNum);
    if (!pos) return;

    const g = guardianAssignment[pNum];
    const f = fiendAssignment[pNum]; // undefined in Ordeal mode -- see below
    const rotation = EDGE_LABEL_ROTATION[pos.edge];
    const rp = resolvePos(pos, 170);

    const wrap = document.createElement('div');
    wrap.style.cssText = `
      position:absolute; left:${rp.left}; top:${rp.top};
      transform: translate(-50%, -50%) rotate(${rotation}deg);
      text-align:center;
    `;

    const circleHeader = document.createElement('div');
    circleHeader.textContent = `CIRCLE ${currentRing}: ${circle.name.toUpperCase()}`;
    circleHeader.style.cssText = `color:${circleColor}; font-weight:700; font-size:20px; margin-bottom:8px;`;
    wrap.appendChild(circleHeader);

    if (isOrdealCombat) {
      // No fiend is dealt in Ordeal mode (declareOrdealEncounter never
      // sets fiendAssignment) -- call out the Ordeal itself instead of
      // the usual fiend line, per spec item C.
      const ordealLine = document.createElement('div');
      ordealLine.textContent = `ORDEAL: ${ordealState.name.toUpperCase()}`;
      ordealLine.style.cssText =
        'color:#fff; font-weight:700; font-size:18px; margin-bottom:14px;';
      wrap.appendChild(ordealLine);
    } else if (f) {
      const fiendLine = document.createElement('div');
      fiendLine.style.cssText =
        'display:flex; align-items:center; justify-content:center; gap:6px; color:#fff; font-weight:700; font-size:18px; margin-bottom:14px;';

      if (isHarderFiend) {
        const marker = document.createElement('div');
        marker.style.cssText = `
          width:18px; height:18px; background-color:#fff;
          -webkit-mask-image:url('/LH.png'); mask-image:url('/LH.png');
          -webkit-mask-size:contain; mask-size:contain;
          -webkit-mask-repeat:no-repeat; mask-repeat:no-repeat;
          -webkit-mask-position:center; mask-position:center;
          flex-shrink:0;
        `;
        fiendLine.appendChild(marker);
      }

      const fiendText = document.createElement('span');
      fiendText.textContent = `${f.num}: ${f.name.toUpperCase()}`;
      fiendLine.appendChild(fiendText);
      wrap.appendChild(fiendLine);
    }
    // else: not an Ordeal, and no fiend was dealt -- e.g. a Limbo Clash
    // (shouldDealFiend(1) is false) or a Hell Lord fight (never deals one
    // up front). Nothing to show for this line; `f` used to be assumed
    // always-defined here (true before fiends became conditional), and
    // reading f.num/f.name when f was actually undefined threw --
    // silently, mid-render, since nothing here was ever wrapped in a
    // try/catch -- which aborted renderDeclarationScreen() partway
    // through EVERY time it ran for one of these encounters. That's the
    // root cause of the "black screen after selecting a Clash node in
    // Limbo" bug: the crash happened after declarationScreen.innerHTML
    // had already been cleared but before beginDeclaration ever reached
    // its own declarationScreen.style.display = '' a few lines later,
    // and before combatScreen (the ring itself) was ever told to hide --
    // it never has been anywhere in this file, only ever shown, once,
    // inside startCombat(). Whatever ring UI was left over from the
    // PREVIOUS encounter (frozen, its units hidden if that previous
    // fight had just ended) simply stayed on screen, uncovered, looking
    // exactly like "the old encounter's prep phase and a blank ring" --
    // which is exactly what was reported after finishing an Ordeal and
    // then hitting this same crash on the very next Clash selected.

    wrap.appendChild(buildGuardianCard(g, g.color));
    declarationScreen.appendChild(wrap);
  });
}

let declareLastTap = 0;
declarationScreen.addEventListener('pointerdown', () => {
  const now = performance.now();
  if (now - declareLastTap < 300) {
    declarationScreen.style.display = 'none';
    startCombat();
  }
  declareLastTap = now;
});

// --- INTERACTIVE PLAYER CONSOLES ---
let consoleActiveGroup = {}; // playerNum -> which guardian this console is showing

let statDrag = null; // { pNum, field, guardian, startX, startY, rotationDeg, textEl }
const DRAG_SENSITIVITY = 18; // screen px of local-axis movement per 1 point of change

function makeSmallButton(bg, label) {
  const btn = document.createElement('div');
  btn.textContent = label;
  btn.style.cssText = `
    width:32px; height:32px; border-radius:50%; background:${bg};
    border:2px solid #111; display:flex; align-items:center; justify-content:center;
    font-size:15px; cursor:pointer; user-select:none; touch-action:none;
  `;
  return btn;
}

function makeImageButton(iconUrl) {
  const btn = document.createElement('div');
  btn.style.cssText = `
    width:43px; height:43px; border-radius:50%;
    background-image:url('${iconUrl}'); background-size:cover; background-position:center;
    border:2px solid #111; cursor:pointer; touch-action:none;
  `;
  return btn;
}

// Non-interactive counterpart to makeDragStat -- for values that are
// never player-adjustable by dragging (an Inquisitor's infinity glyphs,
// an Ordeal's rounds-remaining readout). pointer-events:none so it can
// never be mistaken for (or accidentally block taps meant for) a real
// drag-stat.
function makeStaticStat(color, value) {
  const el = document.createElement('div');
  el.textContent = value;
  el.style.cssText = `color:${color}; font-weight:700; font-size:65px; user-select:none; pointer-events:none;`;
  return el;
}

function makeDragStat(color, rotationDeg, getValue, pNum, field, guardian) {
  const el = document.createElement('div');
  el.textContent = getValue();
  el.style.cssText = `color:${color}; font-weight:700; font-size:65px; cursor:ew-resize; user-select:none; touch-action:none;`;

  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    statDrag = {
      pNum,
      field,
      guardian,
      startX: e.clientX,
      startY: e.clientY,
      baseValue: getValue(),
      rotationDeg,
      textEl: el,
    };
  });

  return el;
}

// Single global pointermove/pointerup pair for all drag-stats, rather than
// re-attaching document listeners on every console re-render.
document.addEventListener('pointermove', (e) => {
  if (!statDrag) return;
  e.preventDefault();
  const dx = e.clientX - statDrag.startX;
  const dy = e.clientY - statDrag.startY;
  const rad = -statDrag.rotationDeg * (Math.PI / 180);
  const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
  const delta = Math.round(localX / DRAG_SENSITIVITY);
  let preview = statDrag.baseValue + delta;
  preview = Math.max(0, preview);
  // HP (unlike corruption) cannot be dragged above the guardian's own max.
  if (statDrag.field === 'hp') {
    preview = Math.min(statDrag.guardian.maxHp, preview);
  }
  statDrag.textEl.textContent = preview;
  statDrag.pendingDelta = preview - statDrag.baseValue;
}, { passive: false });

document.addEventListener('pointerup', () => {
  if (!statDrag) return;
  const { pNum, field, guardian, pendingDelta } = statDrag;
  if (pendingDelta) {
    let newVal = guardian[field] + pendingDelta;
    newVal = Math.max(0, newVal);
    if (field === 'hp') newVal = Math.min(guardian.maxHp, newVal);
    guardian[field] = newVal;
    syncOverseerGroup(guardian);
    pushConsoleUndo(() => {
      guardian[field] = Math.max(0, guardian[field] - pendingDelta);
      syncOverseerGroup(guardian);
    });
  }
  statDrag = null;
  refreshAllConsoles();
});

function refreshAllConsoles() {
  Object.keys(PLAYER_CHARACTERS).forEach((key) =>
    renderPlayerConsole(Number(key))
  );
}

const victoryScreen = document.createElement('div');
victoryScreen.id = 'victory-screen';
// Full-screen (not just a box around the image), so the double-tap-to-
// proceed gesture works anywhere on screen -- previously this box was
// only as big as the centered image, so a tap even slightly outside the
// artwork did nothing, which read as the screen being stuck.
victoryScreen.style.cssText = `
  position:fixed; inset:0; display:none; align-items:center; justify-content:center;
  z-index:60; pointer-events:auto; touch-action:none;
`;
victoryScreen.innerHTML = `<img src="/public/victory.png" style="width:260px; height:260px; pointer-events:none;" />`;
document.getElementById('app').appendChild(victoryScreen);

// No defeat art has been supplied yet — placeholder text treatment,
// styled to clearly read as "loss" (dark red) rather than reusing victory's
// visual language. Swap innerHTML for an <img> once art exists, same as
// victory above.
const defeatScreen = document.createElement('div');
defeatScreen.id = 'defeat-screen';
// Same full-screen tap-anywhere treatment as victoryScreen above.
defeatScreen.style.cssText = `
  position:fixed; inset:0; display:none; align-items:center; justify-content:center;
  flex-direction:column; z-index:60; pointer-events:auto; touch-action:none; text-align:center;
`;
defeatScreen.innerHTML = `
  <div style="color:#c0392b; font-size:56px; font-weight:700; letter-spacing:4px; pointer-events:none;">DEFEAT</div>
  <div style="color:#7a2020; font-size:20px; margin-top:10px; pointer-events:none;">Corruption has consumed the party</div>
  <div style="color:#5a3030; font-size:14px; margin-top:18px; pointer-events:none;">Double-tap anywhere to return to the beginning</div>
`;
document.getElementById('app').appendChild(defeatScreen);

// Ordeal failure -- distinct from both victory and (corruption) defeat.
// Per spec: running out of Inquisitor turns is NOT player defeat -- the
// run continues, the node is still marked complete, players simply get no
// reward. Styled closer to a neutral/somber tone than defeat's alarm-red,
// since it isn't a run-ending loss.
const ordealFailScreen = document.createElement('div');
ordealFailScreen.id = 'ordeal-fail-screen';
ordealFailScreen.style.cssText = `
  position:fixed; inset:0; display:none; align-items:center; justify-content:center;
  flex-direction:column; z-index:60; pointer-events:auto; touch-action:none; text-align:center;
`;
ordealFailScreen.innerHTML = `
  <div style="color:#9a8c6a; font-size:48px; font-weight:700; letter-spacing:3px; pointer-events:none;">ORDEAL NOT OVERCOME</div>
  <div style="color:#6b6250; font-size:20px; margin-top:10px; pointer-events:none;">The Inquisitor's time has run out</div>
  <div style="color:#4a4438; font-size:14px; margin-top:18px; pointer-events:none;">Double-tap anywhere to continue</div>
`;
document.getElementById('app').appendChild(ordealFailScreen);

let resultLastTap = 0; // shared double-tap timer for victory/defeat/ordeal-fail screens

ordealFailScreen.addEventListener('pointerdown', () => {
  const now = performance.now();
  if (now - resultLastTap < 300) {
    ordealFailScreen.style.display = 'none';
    // Unlike defeatScreen, this does NOT reset the run -- an Ordeal not
    // being overcome ends this ONE node, not the whole playthrough. No
    // soul shards to award (SOUL_SHARD_AWARDS has no ORDEAL entry, win or
    // lose -- see enemyData.js), but the map still needs to advance and
    // mark this node complete, same mechanism victory uses: mapPhase.js's
    // subscriber commits the move on either result value.
    patchState({ phase: 'MAP', lastCombatResult: 'ORDEAL_FAILURE' });
  }
  resultLastTap = now;
});

// Double-tap on the victory screen: award soul shards (Clash=1,
// Overseer=2, anything else=0 — see SOUL_SHARD_AWARDS in enemyData.js)
// and hand control back to the map phase, resuming at the node just won.
// Double-tap on the defeat screen: reset the entire run and cycle back to
// phase a. (orientation/character select), per the original spec —
// "if you double-clicked the defeated area, it can take you back to a."
victoryScreen.addEventListener('pointerdown', () => {
  const now = performance.now();
  if (now - resultLastTap < 300) {
    const nodeType = getState().pendingCombat?.nodeType;
    const amount = SOUL_SHARD_AWARDS[nodeType] || 0;
    if (amount > 0) awardSoulShards(amount);

    // Run-wide recap log: one entry per WON guardian/Overseer/Hell Lord
    // fight, in fight order. Skipped for Ordeal (guardianAssignment is
    // never populated for one -- see declareOrdealEncounter -- so there's
    // no enemy name to log; an Ordeal isn't "an enemy defeated" in the
    // same sense anyway). Hell Lord isn't a normal CIRCLES_BY_RING entry
    // (currentRing here is whichever ring the player was ascending FROM,
    // not a ring Hell Lord itself belongs to -- see the HELL_LORD branch
    // in mapPhase.js's onNodeConfirm), so it gets its own ringName rather
    // than misattributing the kill to that last ring's circle.
    const enemyNames = [...new Set(Object.values(guardianAssignment).map((g) => g.name))];
    if (enemyNames.length > 0) {
      const ringName = isHellLordCombat ? 'The Hell Lord' : getCircleForRing(currentRing).name;
      recordCombatVictory({ ring: currentRing, ringName, nodeType, names: enemyNames });
    }

    victoryScreen.style.display = 'none';
    // pendingCombat is deliberately left intact here -- map/mapPhase.js's
    // subscriber needs pendingCombat.nodeId to know which node to
    // actually commit as completed, and clears pendingCombat itself once
    // it's consumed that. Nulling it here (the previous bug) meant the
    // subscriber's `s.pendingCombat` check failed before it ever read the
    // nodeId, so the move never landed -- the node was never marked
    // complete and the player got stuck reselecting the same clash node
    // forever, since map's currentNodeId never advanced.
    patchState({ phase: 'MAP', lastCombatResult: 'VICTORY' });
  }
  resultLastTap = now;
});
defeatScreen.addEventListener('pointerdown', () => {
  const now = performance.now();
  if (now - resultLastTap < 300) {
    defeatScreen.style.display = 'none';
    // Full reload (not just resetRun() + patchState) is deliberate: this
    // guarantees a truly clean slate for phase a. — no risk of the vortex
    // canvas animation loop, event listeners, or any other module-level
    // closure state from THIS run leaking into the next one. resetRun()
    // already cleared sessionStorage, so the reload lands back on a
    // genuinely empty gameState.
    resetRun();
    window.location.reload();
  }
  resultLastTap = now;
});

function checkVictory() {
  // Once the run has already ended (win or loss), nothing further should
  // be able to re-trigger a result — most importantly, this stops a
  // post-defeat skull tap (normally no longer possible once consoles are
  // removed — see removePlayerConsoles below — but this guard is the
  // backstop) from flipping a loss into a victory screen.
  if (victoryLocked) return;

  // An Ordeal is never won by defeating guardianAssignment entries --
  // Inquisitors can't be defeated at all (no skull button, defeated stays
  // permanently false), so victory only ever comes from defeatOrdeal()
  // below, triggered by the white dot's own button. Without this guard,
  // `.every(...)` on an all-false set would correctly return false anyway
  // (so this isn't strictly load-bearing today), but it documents the
  // real rule and protects against a future change to how Inquisitor
  // entries are shaped.
  if (isOrdealCombat) return;

  const remainingKeys = Object.keys(guardianAssignment);
  // Guards the vacuous-truth case: Array.every() on an EMPTY array is
  // true, so with every seat gone (e.g. every player died mid-fight and
  // each one's own guardian_N seat was removed via
  // handlePlayerRemovedFromCombat), the check below would otherwise
  // "succeed" with nothing left to actually check -- reading as a
  // victory for what is, in every meaningful sense, the opposite. This
  // function doesn't decide what SHOULD happen when every player is gone
  // (that's a whole-party-loss condition this codebase doesn't define
  // yet -- see the corruption-max case, which is the only whole-party
  // loss that currently exists) -- it just refuses to call that victory.
  if (remainingKeys.length === 0) return;

  const allDefeated = remainingKeys.map(Number).every((n) => guardianAssignment[n].defeated);
  if (!allDefeated) return;

  victoryLocked = true;
  setPaused(true);
  controlRing.style.display = 'none';
  units.forEach((u) => (u.el.style.display = 'none'));
  victoryScreen.style.display = 'flex';
}

// Player consoles are removed entirely (not just hidden) on defeat. Left
// in place, their skull buttons remain tappable and defeatGuardian() would
// keep marking guardians defeated — eventually satisfying checkVictory()'s
// "all defeated" condition and popping the victory screen after the loss
// already happened, which reads as a very confusing result.
function removePlayerConsoles() {
  Object.keys(PLAYER_CHARACTERS).forEach((key) => {
    const el = document.getElementById('console-' + key);
    if (el) el.remove();
  });
}

function triggerDefeat() {
  if (victoryLocked) return;
  victoryLocked = true;
  setPaused(true);
  controlRing.style.display = 'none';
  units.forEach((u) => (u.el.style.display = 'none'));
  removePlayerConsoles();
  defeatScreen.style.display = 'flex';
}

// Called directly from tickInner() the moment an Inquisitor turn would
// exceed ordealState.turnsAllowed -- NOT routed through checkVictory (this
// is a loss, not a win) and NOT the same as triggerDefeat (this isn't
// player/corruption defeat -- the run continues, only this node's reward
// is forfeited). Same shutdown shape as the other two (pause, hide ring
// and consoles) but its own screen and its own distinct
// lastCombatResult value, handled in ordealFailScreen's tap listener
// above.
function triggerOrdealFailure() {
  if (victoryLocked) return;
  victoryLocked = true;
  setPaused(true);
  controlRing.style.display = 'none';
  units.forEach((u) => (u.el.style.display = 'none'));
  removePlayerConsoles();
  ordealFailScreen.style.display = 'flex';
}

// Called from the white Ordeal dot's own defeat button -- clearing the
// Ordeal is an immediate, direct win (spec item E-a), not something that
// flows through checkVictory's "every guardianAssignment entry defeated"
// check (which can never be true in Ordeal mode -- see that function's
// isOrdealCombat guard above).
function defeatOrdeal() {
  if (victoryLocked) return;
  victoryLocked = true;
  setPaused(true);
  controlRing.style.display = 'none';
  units.forEach((u) => (u.el.style.display = 'none'));
  victoryScreen.style.display = 'flex';
}

// The single authoritative way corruption ever changes — auto-increment on
// a player's turn, Consume/Taint, and the ring's own drag gesture (on
// release) all funnel through this. Handles crossing level boundaries in
// either direction, and triggers defeat if level 4's max is exceeded.
function applyCorruptionDelta(delta) {
  if (victoryLocked) return;
  corruptionFilled += delta;

  // Each level's max is a threshold to trip, not a value to carry past.
  // Once filled exceeds it, the level advances and filled resets to zero
  // — whatever amount it went over by is discarded, not carried forward
  // as a head start into the new level.
  while (corruptionFilled > corruptionMaxSegments()) {
    corruptionFilled = 0;
    corruptionLevel++;
    if (corruptionLevel > 4) {
      triggerDefeat();
      return;
    }
  }

  // A corruption level, once reached, can never be reverted — reducing
  // corruption simply floors at zero on the current level rather than
  // dropping back to a prior level.
  if (corruptionFilled < 0) corruptionFilled = 0;

  // Corruption is party-wide and now also needs to survive the trip back
  // to the map phase (for the per-corner HUD in map/mapRenderer.js) —
  // gameState.partyCorruption is kept in sync on every change here rather
  // than only being read/written at combat start/end.
  patchState({ partyCorruption: { level: corruptionLevel, filled: corruptionFilled } });

  renderCorruptionRing();
}

const CORRUPTION_INNER_R = 78;
const CORRUPTION_OUTER_R = 108;

// previewFilled, if given, overrides the committed corruptionFilled for
// live drag feedback without actually committing anything. Values beyond
// the current level's max render as a red "second lap" overflow warning.
function renderCorruptionRing(previewFilled) {
  const group = document.getElementById('corruption-ring');
  if (!group) return;
  group.innerHTML = '';

  const max = corruptionMaxSegments();
  const filled = previewFilled !== undefined ? previewFilled : corruptionFilled;
  const overflow = filled > max ? filled - max : 0;
  const effectiveFilled = Math.max(0, Math.min(filled, max));
  const anglePer = 360 / max;

  for (let i = 0; i < max; i++) {
    const startA = i * anglePer;
    const endA = (i + 1) * anglePer;
    const isOverflowRed = i < overflow;
    const isFilled = i < effectiveFilled;

    const seg = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    seg.setAttribute(
      'd',
      donutPath(CORRUPTION_INNER_R, CORRUPTION_OUTER_R, startA, endA)
    );
    if (isOverflowRed) {
      seg.setAttribute('fill', '#e74c3c');
      seg.setAttribute('stroke', '#e74c3c');
    } else if (isFilled) {
      seg.setAttribute('fill', '#f2c94c');
      seg.setAttribute('stroke', '#f2c94c');
    } else {
      seg.setAttribute('fill', 'none');
      seg.setAttribute('stroke', '#f2c94c');
    }
    seg.setAttribute('stroke-width', '2');
    seg.style.pointerEvents = 'none';
    group.appendChild(seg);

    // Number label on every other segment, starting at the 2nd (2,4,6...).
    const segNum = i + 1;
    if (segNum % 2 === 0) {
      const midA = (startA + endA) / 2;
      const midR = (CORRUPTION_INNER_R + CORRUPTION_OUTER_R) / 2;
      const p = polar(midR, midA);
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', p.x);
      label.setAttribute('y', p.y);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dy', '0.35em');
      label.setAttribute('font-family', 'system-ui, sans-serif');
      label.setAttribute('font-size', '11');
      label.setAttribute('font-weight', '700');
      label.setAttribute(
        'fill',
        isOverflowRed ? '#fff' : isFilled ? '#000' : '#f2c94c'
      );
      label.style.pointerEvents = 'none';
      label.textContent = segNum;
      group.appendChild(label);
    }
  }
}

// --- CORRUPTION RING DRAG ---
// Press and drag the ring itself: clockwise adds corruption (previewing
// even past the current level's max, shown in red), counterclockwise
// removes it. Nothing commits until release.
let corruptionDrag = null;

function pointerAngleOnRing(e) {
  const rect = ring.getBoundingClientRect();
  const scale = 400 / Math.min(rect.width, rect.height);
  const localX = (e.clientX - (rect.left + rect.width / 2)) * scale;
  const localY = (e.clientY - (rect.top + rect.height / 2)) * scale;
  return Math.atan2(localY, localX) * (180 / Math.PI) + 90;
}

const corruptionHitArea = document.getElementById('corruption-hit-area');
corruptionHitArea.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  e.preventDefault();
  const startAngle = pointerAngleOnRing(e);
  corruptionDrag = {
    lastPointerAngle: startAngle,
    accumulatedAngle: 0, // unwrapped total rotation since pointerdown
    startMax: corruptionMaxSegments(),
    startFilled: corruptionFilled,
    previewDelta: 0,
  };
});

document.addEventListener(
  'pointermove',
  (e) => {
    if (!corruptionDrag) return;
    e.preventDefault();
    const currentAngle = pointerAngleOnRing(e);
    // Accumulate the *step* since the last move event (wrapped to the
    // nearest -180..180 short way round), rather than the distance from
    // the drag's start angle. Comparing against a fixed start angle caps
    // a drag at half a turn — go further and it wraps back around,
    // making progress collapse or reverse. Summing small per-frame steps
    // lets the drag travel any number of full rotations in either
    // direction, so a finger can sweep all the way clockwise to trip the
    // next level or all the way counterclockwise to zero it out.
    let step = currentAngle - corruptionDrag.lastPointerAngle;
    while (step > 180) step -= 360;
    while (step < -180) step += 360;
    corruptionDrag.accumulatedAngle += step;
    corruptionDrag.lastPointerAngle = currentAngle;

    const anglePerSegment = 360 / corruptionDrag.startMax;
    corruptionDrag.previewDelta = Math.round(corruptionDrag.accumulatedAngle / anglePerSegment);
    renderCorruptionRing(corruptionDrag.startFilled + corruptionDrag.previewDelta);
  },
  { passive: false }
);

document.addEventListener('pointerup', () => {
  if (!corruptionDrag) return;
  const delta = corruptionDrag.previewDelta;
  corruptionDrag = null;
  if (delta !== 0) {
    saveState();
    applyCorruptionDelta(delta);
    // Was missing here specifically -- every OTHER path that changes
    // corruption (the per-turn auto-increment, taint) already calls this
    // right after. Without it, dragging the corruption stat directly up
    // to level 3/4 updated the underlying value correctly but never told
    // the player consoles to redraw, so they'd keep showing whatever
    // level was current before the drag -- indefinitely, until some
    // unrelated action happened to trigger a refresh for a different
    // reason. This looked exactly like "the badges never appear," because
    // depending on how corruption was actually raised in a given session,
    // they genuinely might not have, even once level 3 was reached.
    refreshAllConsoles();
  } else {
    renderCorruptionRing();
  }
});



// Marks a guardian's enemy group as defeated — distinct from hp reaching 0.
// A guardian at 0 HP may still have fiends active alongside it, so removal
// from the ring/consoles only happens on this explicit, player-driven call.
// Removes any active cast (star) tied to this unit — the condition to
// fulfill it (that unit reaching its target angle) can never happen once
// the unit itself is gone.
function removeCastsForUnit(unit) {
  const remaining = [];
  activeCasts.forEach((c) => {
    if (c.unit === unit) {
      c.group.remove();
    } else {
      remaining.push(c);
    }
  });
  activeCasts = remaining;
}

function defeatGuardian(pNum) {
  const g = guardianAssignment[pNum];
  const unit = units.find((u) => u.id === 'guardian_' + pNum);
  const lastAngle = unit ? unit.angle : 3;
  const lastCast = unit
    ? activeCasts.find((c) => c.unit === unit)
    : null;
  const lastCastEndAngle = lastCast ? lastCast.endAngle : null;

  if (unit) {
    removeCastsForUnit(unit);
    unit.el.remove();
    units = units.filter((u) => u !== unit);
  }
  g.defeated = true;

  pushConsoleUndo(() => {
    g.defeated = false;
    const restored = createUnit(
      'guardian_' + pNum,
      130,
      lastAngle,
      SPEED_SLOT_VALUES[g.slot],
      g.color
    );
    units.push(restored);
    if (lastCastEndAngle !== null) {
      createCastLine(restored, lastCastEndAngle, true);
    }
  });

  refreshAllConsoles();
  checkVictory();
}

// Overseer counterpart to defeatGuardian(): since every player's entry in
// the group shares one hp/corruption pool, defeat isn't something one
// player's dot can suffer alone -- tapping the skull on ANY toggled view
// of the shared boss removes every player's dot at once, in a single
// combined undo step (a single tap should also undo as a single tap).
function defeatOverseerGroup(sourcePNum) {
  const src = guardianAssignment[sourcePNum];
  const groupPNums = Object.keys(guardianAssignment)
    .map(Number)
    .filter(
      (pn) =>
        isSharedBossGroup(guardianAssignment[pn]) &&
        guardianAssignment[pn].overseerId === src.overseerId
    );

  const removed = [];
  groupPNums.forEach((pn) => {
    const g = guardianAssignment[pn];
    const unit = units.find((u) => u.id === 'guardian_' + pn);
    const lastAngle = unit ? unit.angle : 3;
    const lastCast = unit ? activeCasts.find((c) => c.unit === unit) : null;
    const lastCastEndAngle = lastCast ? lastCast.endAngle : null;

    if (unit) {
      removeCastsForUnit(unit);
      unit.el.remove();
      units = units.filter((u) => u !== unit);
    }
    g.defeated = true;
    removed.push({ pn, lastAngle, lastCastEndAngle, slot: g.slot, color: g.color });
  });

  pushConsoleUndo(() => {
    removed.forEach(({ pn, lastAngle, lastCastEndAngle, slot, color }) => {
      guardianAssignment[pn].defeated = false;
      const restored = createUnit(
        'guardian_' + pn,
        130,
        lastAngle,
        SPEED_SLOT_VALUES[slot],
        color
      );
      restored.isOverseerDot = true;
      units.push(restored);
      if (lastCastEndAngle !== null) {
        createCastLine(restored, lastCastEndAngle, true);
      }
    });
  });

  refreshAllConsoles();
  checkVictory();
}

function buildPlayerConsoles() {
  Object.keys(PLAYER_CHARACTERS).forEach((key) => {
    const pNum = Number(key);
    consoleActiveGroup[pNum] = pNum; // default to own engaged guardian
    renderPlayerConsole(pNum);
  });
}

window.addEventListener('resize', () => {
  if (combatScreen.style.display !== 'none') refreshAllConsoles();
});

// CORNER_CSS now comes from ../layoutConstants.js (was a locally
// duplicated copy — see that file's header comment for why).

// Every console update used to rebuild the DOM synchronously inside the
// same pointerdown handler that triggered it (consume/taint/toggle/skull
// etc). Mutating the DOM mid-touch-gesture is a known way to confuse iOS
// Safari's own gesture-recognition state machine — likely why double-taps
// on these buttons could still trigger a zoom despite preventDefault/
// touch-action already being set correctly. Deferring the actual rebuild to
// the next frame lets the current touch event finish settling first.
function renderPlayerConsole(pNum) {
  requestAnimationFrame(() => renderPlayerConsoleImmediate(pNum));
}

function renderPlayerConsoleImmediate(pNum) {
  const pos = getPlayerPosition(pNum);
  if (!pos) return;
  const rotation = EDGE_LABEL_ROTATION[pos.edge];
  const cornerStyle = CORNER_CSS[pos.corner] || CORNER_CSS['top-left'];

  let container = document.getElementById('console-' + pNum);
  if (!container) {
    container = document.createElement('div');
    container.id = 'console-' + pNum;
    document.getElementById('app').appendChild(container);
  }
  // Fixed square (CORNER_BOX_SIZE, shared with the map's corner overlay —
  // see ../layoutConstants.js) so a 0/90/180/270° rotation around its own
  // center never shifts its bounding box — it stays flush to the same
  // screen corner regardless of which orientation this player chose.
  // pointer-events:none on the container itself means the large empty
  // margin around the visible card doesn't swallow taps/drags meant for
  // the ring underneath it — only the card and its buttons/dots (which
  // explicitly opt back in below) actually capture input.
  container.style.cssText = `
    position:fixed; width:${CORNER_BOX_SIZE}px; height:${CORNER_BOX_SIZE}px;
    display:flex; align-items:center; justify-content:center;
    transform: rotate(${rotation}deg);
    z-index:30; text-align:center; pointer-events:none;
    ${cornerStyle}
  `;
  container.innerHTML = '';

  const alivePlayers = Object.keys(guardianAssignment)
    .map(Number)
    .filter((n) => !guardianAssignment[n].defeated);

  if (
    consoleActiveGroup[pNum] !== ORDEAL_SENTINEL &&
    (!guardianAssignment[consoleActiveGroup[pNum]] ||
      guardianAssignment[consoleActiveGroup[pNum]].defeated)
  ) {
    consoleActiveGroup[pNum] = alivePlayers[0];
  }
  const activeNum = consoleActiveGroup[pNum];
  if (activeNum === undefined) return; // no living guardians left
  // The white toggle-dot's selection isn't a real player number -- it
  // means "show the Ordeal card" (see declareOrdealEncounter/ordealState)
  // rather than any guardianAssignment entry. Every downstream read of
  // `g` below is guarded by showingOrdeal first.
  const showingOrdeal = activeNum === ORDEAL_SENTINEL;
  const g = showingOrdeal ? null : guardianAssignment[activeNum];
  const isInquisitor = !showingOrdeal && g.isInquisitor === true;

  const CARD_R = 144; // card radius in px — every arc/flank position below is derived from this

  // Card — the main circle. Colored border + a black stroke ring outside it
  // so it never melds into a same-colored turn background. The Ordeal
  // card has no owning player color (it isn't any one player's dot), so
  // it gets a neutral off-white border matching the white toggle dot.
  const cardBorderColor = showingOrdeal ? '#e8e8e8' : g.color;
  const card = document.createElement('div');
  card.style.cssText = `
    width:${CARD_R * 2}px; height:${CARD_R * 2}px; border-radius:50%;
    border:6px solid ${cardBorderColor}; box-shadow:0 0 0 3px #000;
    background:#1a1a1f; position:relative; touch-action:none;
    pointer-events:auto;
  `;
  card.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
  });

  // Skull — inside the circle, top-center, floating above the name. Three
  // distinct behaviors: on the Ordeal card it's a direct win (spec E-a);
  // on a normal guardian/Overseer it defeats as before; an Inquisitor gets
  // NO skull button at all -- it can't be beaten (spec A), so a button
  // that visually promised defeat but silently did nothing would just be
  // confusing.
  if (showingOrdeal) {
    const skullBtn = makeSmallButton('#333', '💀');
    skullBtn.style.cssText += `position:absolute; left:50%; top:34px; transform:translate(-50%,0);`;
    skullBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      defeatOrdeal();
    });
    card.appendChild(skullBtn);
  } else if (!isInquisitor) {
    const skullBtn = makeSmallButton('#333', '💀');
    skullBtn.style.cssText += `position:absolute; left:50%; top:34px; transform:translate(-50%,0);`;
    skullBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      creditGuardianDefeatToCurrentTurnPlayer();
      if (isSharedBossGroup(g)) {
        defeatOverseerGroup(activeNum);
      } else {
        defeatGuardian(activeNum);
      }
    });
    card.appendChild(skullBtn);
  }

  // Name + stats, vertically centered as a block.
  const centerBlock = document.createElement('div');
  centerBlock.style.cssText =
    'position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); text-align:center;';

  const name = document.createElement('div');
  const displayName = showingOrdeal ? ordealState.name : g.name;
  name.textContent = displayName.toUpperCase();
  // Multi-word names (Overseers especially -- "TRISTAN AND ISOLDE" wraps
  // to 3 lines) need a smaller size so the block doesn't grow tall enough
  // to reach the fixed-position skull button above or undo button below.
  // pointer-events:none is a second, independent line of defense for the
  // same problem: this div has no interaction of its own, so even if some
  // future long name still visually overlaps a button, taps pass through
  // to whatever's actually underneath instead of landing on this dead
  // text and going nowhere.
  const nameWordCount = displayName.trim().split(/\s+/).length;
  const nameFontSize = nameWordCount >= 3 ? 20 : nameWordCount === 2 ? 24 : 29;
  name.style.cssText = `color:#fff; font-weight:700; font-size:${nameFontSize}px; line-height:1.05; padding:0 22px; text-align:center; pointer-events:none;`;
  centerBlock.appendChild(name);

  const statsRow = document.createElement('div');
  statsRow.style.cssText = 'display:flex; gap:36px; margin-top:14px; justify-content:center;';
  if (showingOrdeal) {
    // HP slot repurposed as rounds-remaining, green, static -- not a
    // resource players spend, just a readout of the turn clock (spec
    // item c). Corruption slot stays a normal draggable yellow stat, same
    // as any enemy's, just targeting ordealState instead of a
    // guardianAssignment entry (spec item f). There's only ever ONE
    // ordealState object (not one per player like Overseer's guardianAssignment
    // entries), so every console reads/writes the same object directly --
    // no syncOverseerGroup-style propagation needed for it to stay
    // consistent across players.
    const roundsRemaining = Math.max(0, ordealState.turnsAllowed - ordealState.turnsElapsed);
    statsRow.appendChild(makeStaticStat('#3ddc73', roundsRemaining));
    statsRow.appendChild(
      makeDragStat('#f2c94c', rotation, () => ordealState.corruption, pNum, 'corruption', ordealState)
    );
  } else if (isInquisitor) {
    // Infinite and unbeatable -- static glyphs, not draggable (spec item
    // A). Consume/taint below still function (they move PARTY
    // corruption), they just never touch these.
    statsRow.appendChild(makeStaticStat('#ff5555', '\u221e'));
    statsRow.appendChild(makeStaticStat('#f2c94c', '\u221e'));
  } else {
    statsRow.appendChild(
      makeDragStat('#ff5555', rotation, () => g.hp, pNum, 'hp', g)
    );
    statsRow.appendChild(
      makeDragStat('#f2c94c', rotation, () => g.corruption, pNum, 'corruption', g)
    );
  }
  centerBlock.appendChild(statsRow);
  card.appendChild(centerBlock);

  // Undo — inside the circle, bottom-center, opposite the skull.
  const undoBtnEl = makeSmallButton('#555', '↺');
  undoBtnEl.style.cssText += `position:absolute; left:50%; bottom:34px; transform:translate(-50%,0);`;
  undoBtnEl.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    performGlobalUndo();
  });
  card.appendChild(undoBtnEl);

  // Consume / Taint — outside the circle, straddling the bottom-left and
  // bottom-right flanks, with a clear gap from the card's own boundary.
  const flankAngle = 65; // degrees from horizontal; 0=right(3 o'clock), clockwise
  const flankR = CARD_R + 27;
  function placeOnFlank(el, angleDeg) {
    const rad = (angleDeg * Math.PI) / 180;
    const dx = flankR * Math.cos(rad);
    const dy = flankR * Math.sin(rad);
    el.style.cssText += `position:absolute; left:calc(50% + ${dx}px); top:calc(50% + ${dy}px); transform:translate(-50%,-50%);`;
  }

  const consumeBtn = makeImageButton('/consumeicon.png');
  placeOnFlank(consumeBtn, 180 - flankAngle); // bottom-left
  consumeBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (showingOrdeal) {
      if (ordealState.corruption > 0) {
        saveState();
        ordealState.corruption -= 1;
        applyCorruptionDelta(1);
        refreshAllConsoles();
      }
    } else if (isInquisitor) {
      // Infinite -- there's no stat to gate on or deplete (spec item A:
      // "corruption can be consumed from... but their stat remains
      // infinite"). The party-side effect still happens every time.
      saveState();
      applyCorruptionDelta(1);
      refreshAllConsoles();
    } else if (g.corruption > 0) {
      saveState();
      g.corruption -= 1;
      syncOverseerGroup(g);
      applyCorruptionDelta(1);
      refreshAllConsoles();
    }
  });
  card.appendChild(consumeBtn);

  const taintBtn = makeImageButton('/tainticon.png');
  placeOnFlank(taintBtn, flankAngle); // bottom-right
  taintBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    // Taint pushes a point of player corruption onto the enemy — with
    // nothing currently filled at the party's corruption level, there's
    // nothing to push. (Not gated to level 1: applyCorruptionDelta floors
    // at zero within the current level rather than borrowing from a prior
    // one, so filled === 0 at ANY level is still an empty pool to draw
    // from — the old level-1-only check let taint award a free point of
    // enemy corruption whenever a level had just been crossed.) This gate
    // applies identically regardless of target -- it's about what the
    // PARTY has available to push, not the target's own stat.
    if (corruptionFilled === 0) return;
    saveState();
    if (showingOrdeal) {
      ordealState.corruption += 1;
    } else if (!isInquisitor) {
      g.corruption += 1;
      syncOverseerGroup(g);
    }
    // Inquisitor: no stat to increment -- infinite already (spec item A).
    applyCorruptionDelta(-1);
    refreshAllConsoles();
  });
  card.appendChild(taintBtn);

  // Overseer threshold ticker ("X/Y" -- dots banked toward the next
  // shared activation, out of how many are needed). Sits centered below
  // the ring, between consume and taint (angle 90 = straight down, same
  // placeOnFlank helper those two use, just at a slightly larger radius
  // so it clears their 43px circles instead of sitting flush with them).
  // Placed on every console rather than as a single ring-center
  // indicator: everything already drawn near the ring's true center
  // (corruption donut, the anchor/star/hex control buttons) is radially
  // symmetric and never needs to be READ at a specific angle, but text
  // does -- and every console already solves that problem for free,
  // since the whole card is rotated to match its own player's seat (see
  // `rotation` above), so text laid out in local coordinates always ends
  // up upright for that specific player regardless of where they're
  // physically sitting. pointer-events:none since it's read-only and
  // shouldn't be able to steal taps from anything near it.
  // Same shared-threshold ticker for Overseer, Ordeal, AND Hell Lord
  // combat -- all three use the identical cumulative-threshold dot
  // mechanic (see overseerThresholdCount/Target's own comment; both
  // Ordeal and Hell Lord set overseerThresholdTarget too).
  if (isOverseerCombat || isOrdealCombat || isHellLordCombat) {
    const thresholdLine = document.createElement('div');
    thresholdLine.textContent = `${overseerThresholdCount}/${overseerThresholdTarget}`;
    thresholdLine.style.cssText = `color:${KNOCKBACK_COLOR}; font-weight:700; font-size:19px; letter-spacing:1px; pointer-events:none; -webkit-text-stroke: 0.6px #000; text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;`;
    placeOnFlank(thresholdLine, 90); // same radius as consume/taint -- safe
    // because it's centered (dx=0) while they're offset left/right, so
    // there's no horizontal overlap regardless of matching radius. My
    // first attempt used a hand-rolled `top: calc(50% + Npx)` with too
    // large an N, which placed it outside the console's fixed-size
    // container (378px, with the 288px card centered inside it -- only
    // 45px of margin past the card edge before the console box itself
    // runs out and content is clipped by the viewport). placeOnFlank's
    // existing radius (171px out from center) sits well inside that
    // margin, same as consume/taint already do.
    card.appendChild(thresholdLine);
  }

  // Corruption-level milestone badges — positioned to the side of the
  // console that's away from the screen edge it's flush against, flush
  // with the bottom of the circle, per your reference image. Reusing
  // taint's flank angle (local-right, same side as taint) for LEFT-corner
  // consoles (top-left/bottom-left) and consume's flank angle (local-left)
  // for RIGHT-corner consoles, stacked outward past the existing flank
  // button rather than centered between them. This is a best-effort rule
  // based on which corner the console occupies -- getting this exactly
  // right for BOTH edge choices within a corner (e.g. top-left with
  // edge='top' vs edge='left', which rotate differently) would need a
  // full per-(corner,edge) lookup verified visually, which I can't do
  // without seeing it rendered. If a specific orientation still ends up
  // on the wrong side, tell me which corner/edge and I'll correct that
  // exact case rather than guess further.
  //
  // Built with makeImageButton() -- a <div> with a CSS background-image
  // -- instead of a raw <img> with .src, which is what every other icon
  // in this file already uses (consume/taint/etc, all confirmed working
  // on your iPad). The badges were the ONE place using a different
  // element type for no real reason; matching the proven-working pattern
  // exactly removes that as a variable rather than continuing to guess
  // at what specifically iPad Safari might be doing differently with a
  // bare <img>. Assets also moved from /assets/corruption-level-N.png to
  // project ROOT (corruption-level-N.png, same level as tainticon.png
  // etc.) -- same reasoning: matching the working precedent exactly
  // instead of leaving a subdirectory path as another difference.
  const isLeftCorner = pos.corner === 'top-left' || pos.corner === 'bottom-left';
  const badgeAngle = isLeftCorner ? flankAngle : 180 - flankAngle; // taint-side vs consume-side
  const BADGE_R_1 = flankR + 60; // just past the flank button on that side
  const BADGE_R_2 = BADGE_R_1 + 66; // stacked further out along the same ray
  const BADGE_SIZE = 52;
  function placeBadge(el, radius) {
    const rad = (badgeAngle * Math.PI) / 180;
    const dx = radius * Math.cos(rad);
    const dy = radius * Math.sin(rad);
    const left = dx >= 0 ? `calc(50% + ${dx}px)` : `calc(50% - ${Math.abs(dx)}px)`;
    const top = dy >= 0 ? `calc(50% + ${dy}px)` : `calc(50% - ${Math.abs(dy)}px)`;
    el.style.position = 'absolute';
    el.style.left = left;
    el.style.top = top;
    el.style.transform = 'translate(-50%,-50%)';
    el.style.zIndex = '5';
  }
  function makeBadge(iconUrl) {
    const el = document.createElement('div');
    el.style.cssText = `
      width:${BADGE_SIZE}px; height:${BADGE_SIZE}px;
      background-image:url('${iconUrl}'); background-size:contain;
      background-repeat:no-repeat; background-position:center;
      pointer-events:none;
    `;
    return el;
  }
  if (corruptionLevel >= 3) {
    const cl3Badge = makeBadge('/corruption-level-3.png');
    placeBadge(cl3Badge, BADGE_R_1);
    card.appendChild(cl3Badge);
  }
  if (corruptionLevel >= 4) {
    const cl4Badge = makeBadge('/corruption-level-4.png');
    placeBadge(cl4Badge, BADGE_R_2);
    card.appendChild(cl4Badge);
  }

  container.appendChild(card);

  // Toggle dots — arced across the top, following the circle's curvature,
  // centered and flexing with however many enemy groups are still alive
  // (plus one more, white, for the Ordeal itself when applicable).
  // Sit straddling the boundary (radius = card radius + half dot size).
  // The `|| isOrdealCombat` half of this gate matters even at 1 player:
  // alivePlayers.length is 1 in a solo Ordeal (Inquisitors are never
  // "defeated" so there's always exactly one per player), but the white
  // dot still needs to render so that lone player can reach the Ordeal
  // card at all.
  if (isOrdealCombat || alivePlayers.length > 1) {
    const dotSize = 44; // 100% bigger than the original 22px — easier to hit
    const dotR = dotSize / 2;
    const arcR = CARD_R + dotR;
    const angleStep = 30; // degrees between dots — generous spacing
    // Total dot count includes the extra white Ordeal dot when
    // applicable, so the arc centers across ALL of them together rather
    // than the colored ones alone with the white one squeezed on after.
    const n = alivePlayers.length + (isOrdealCombat ? 1 : 0);
    alivePlayers.forEach((pn, i) => {
      const theta = -90 + (i - (n - 1) / 2) * angleStep; // -90° = straight up
      const rad = (theta * Math.PI) / 180;
      const dx = arcR * Math.cos(rad);
      const dy = arcR * Math.sin(rad);

      const dot = document.createElement('div');
      const c = guardianAssignment[pn].color;
      const activeOutline = pn === activeNum ? '0 0 0 2px #fff' : 'none';
      dot.style.cssText = `
        position:absolute; left:calc(50% + ${dx}px); top:calc(50% + ${dy}px);
        transform:translate(-50%,-50%);
        width:${dotSize}px; height:${dotSize}px; border-radius:50%; background:${c};
        cursor:pointer; border:2px solid #000; box-shadow:${activeOutline};
        touch-action:none;
      `;
      dot.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        consoleActiveGroup[pNum] = pn;
        renderPlayerConsole(pNum);
      });
      card.appendChild(dot);
    });

    if (isOrdealCombat) {
      // Extra white toggle dot for the Ordeal itself (spec item E) --
      // there is deliberately NO matching dot on the speed ring; only the
      // Inquisitor dots move/activate. This is a console-only selector,
      // placed last in the same arc (after all the colored Inquisitor
      // dots) so the whole row still reads as one continuous curve.
      const i = alivePlayers.length;
      const theta = -90 + (i - (n - 1) / 2) * angleStep;
      const rad = (theta * Math.PI) / 180;
      const dx = arcR * Math.cos(rad);
      const dy = arcR * Math.sin(rad);

      const ordealDot = document.createElement('div');
      const activeOutline = showingOrdeal ? '0 0 0 2px #fff' : 'none';
      ordealDot.textContent = '\u26F0'; // mountain glyph
      ordealDot.style.cssText = `
        position:absolute; left:calc(50% + ${dx}px); top:calc(50% + ${dy}px);
        transform:translate(-50%,-50%);
        width:${dotSize}px; height:${dotSize}px; border-radius:50%; background:#e8e8e8;
        display:flex; align-items:center; justify-content:center; font-size:20px; line-height:1;
        cursor:pointer; border:2px solid #000; box-shadow:${activeOutline};
        touch-action:none;
      `;
      ordealDot.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        consoleActiveGroup[pNum] = ORDEAL_SENTINEL;
        renderPlayerConsole(pNum);
      });
      card.appendChild(ordealDot);
    }
  }
}

function beginDeclaration(ring, nodeType) {
  currentRing = ring;
  // Defensively hide the ring/console UI the moment a new encounter
  // starts declaring, before anything else below has a chance to run
  // (including anything that could throw). combatScreen is normally only
  // ever shown (never hidden again) inside startCombat() -- there was no
  // corresponding hide anywhere, which was harmless as long as
  // declarationScreen always ended up covering it a few lines down. If
  // that ever failed partway through (see renderDeclarationScreen's own
  // comment on the fiend-assignment crash that used to do exactly this),
  // whatever ring was left over from the PREVIOUS encounter -- frozen,
  // its units already hidden if that fight had just ended -- stayed
  // visible and uncovered instead. Hiding it unconditionally up front
  // means a future crash in this function can leave the screen looking
  // broken, but never leaves it looking like a DIFFERENT, stale fight.
  combatScreen.style.display = 'none';
  // Reset every time, not just on whichever path matches -- otherwise a
  // Standard/Clash combat fought right after an Overseer, Ordeal, or Hell
  // Lord one would inherit stale mode/threshold state from the previous
  // fight.
  isOverseerCombat = nodeType === 'OVERSEER';
  isOrdealCombat = nodeType === 'ORDEAL';
  isHellLordCombat = nodeType === 'HELL_LORD';
  overseerThresholdCount = 0;
  overseerThresholdTarget = 0;
  overseerThresholdAwaitingReset = false;
  ordealState = null;
  if (isOverseerCombat) {
    declareOverseerEncounter(ring); // sets overseerThresholdTarget itself
  } else if (isOrdealCombat) {
    declareOrdealEncounter(ring); // sets overseerThresholdTarget + ordealState itself
  } else if (isHellLordCombat) {
    declareHellLordEncounter(ring); // sets overseerThresholdTarget itself, same shape as declareOverseerEncounter
  } else {
    declareEnemies(ring);
  }
  renderDeclarationScreen();
  declarationScreen.style.display = '';
}

function startCombat() {
  // Full reset of every piece of per-combat state. This was previously
  // missing entirely -- units/rocks/casts from a PREVIOUS combat were
  // never cleared, and historyStack carried snapshots across combats too.
  // That was the root cause of several bugs: duplicate player/enemy icons
  // appearing when starting a second combat (new units pushed onto an
  // array that still held the first combat's), undo reaching back into a
  // previous fight's history and restoring mismatched units/guardian data,
  // and player consoles going blank when undo restored a guardianAssignment
  // where every guardian was already marked defeated (from the PREVIOUS
  // combat's victory) -- renderPlayerConsoleImmediate finds no living
  // guardian to show and bails out after already clearing the console's
  // content. See INTEGRATION_NOTES.md.
  units.forEach((u) => u.el && u.el.remove());
  rocks.forEach((r) => r.el && r.el.remove());
  activeCasts.forEach((c) => c.group && c.group.remove());
  Object.values(pendingRallyMoves).forEach((m) => m.group && m.group.remove());
  units = [];
  rocks = [];
  activeCasts = [];
  pendingRallyMoves = {};
  historyStack = [];
  pendingTurnSnapshot = null; // no turn-boundary checkpoint carries over
                              // to a new combat -- otherwise the first
                              // undo of a brand new fight could restore a
                              // stale snapshot from the PREVIOUS combat's
                              // final turn.
  lastSaveStateTime = 0;
  consoleActiveGroup = {};
  turnPendingUnit = null;
  knockback = null;
  dragging = null;
  appState = 'IDLE';
  clearTurnIndicator();
  clearQueueSnapshotSelection();
  queuePreviewOverride = null;
  resetQueuePool();
  resetToIdle();

  combatScreen.style.display = '';
  victoryLocked = false;
  victoryScreen.style.display = 'none';
  defeatScreen.style.display = 'none';
  controlRing.style.display = '';
  renderCorruptionRing(); // corruption itself persists across combats — only re-render
  const startAngle = 3; // everyone begins just after the action line

  Object.keys(PLAYER_CHARACTERS).forEach((key) => {
    const pNum = Number(key);
    const character = PLAYER_CHARACTERS[pNum];
    const guardian = guardianAssignment[pNum];

    // Player token — outer ring (150), own color, own icon. Icon rotates
    // dynamically to face outward (head) / inward (neck) as it moves.
    const playerUnit = createUnit(
      'player_' + pNum,
      150,
      startAngle,
      SPEED_SLOT_VALUES[character.slot],
      character.color,
      0,
      0,
      character.icon
    );
    units.push(playerUnit);

    // Guardian token — inner ring (130), colored by its engaged player.
    const guardianUnit = createUnit(
      'guardian_' + pNum,
      130,
      startAngle,
      SPEED_SLOT_VALUES[guardian.slot],
      character.color
    );
    // Tags this dot for tickInner()'s cumulative-threshold pass-through
    // logic -- shared by Overseer AND Ordeal/Inquisitor modes, since both
    // need the identical "N per-player dots, threshold gates the real
    // turn" timing. Harmless (always false) for a normal Clash guardian.
    guardianUnit.isOverseerDot =
      guardian.isOverseer === true || guardian.isInquisitor === true || guardian.isHellLord === true;
    // The speed queue's forecast groups every dot sharing an overseerId
    // under ONE required turn instead of demanding each dot log its own
    // (see computeQueueForecast's own candidateKey) -- guardian.overseerId
    // was never actually copied onto the ring unit itself anywhere in
    // this file before now, so every dot fell back to being treated as
    // its own fully independent unit, each needing its own real turn to
    // satisfy the forecast. For an N-dot shared boss that meant the
    // simulation had to keep cycling until EVERY dot individually got a
    // real turn -- worth many times more forecast entries than the
    // single shared turn actually needed -- which is exactly the
    // runaway/duplicated queue a user reported seeing for Ordeal
    // Inquisitor and Hell Lord fights.
    guardianUnit.overseerId = guardian.overseerId || null;
    units.push(guardianUnit);
    guardian.unitId = guardianUnit.id;
    // Same 2-letter code the curved queue uses for this dot (TRD 1.2 --
    // "on both the speed rings and the speed queue"), so a token reads
    // the same way whether it's on the ring or in the queue. Appended
    // directly to the unit's own <g> (translate-only, never rotated --
    // see updateUnitTransform), so the label always stays upright as the
    // dot travels around the ring.
    addRingLabel(guardianUnit, getEnemyQueueLabel(guardianUnit.id, guardianAssignment));
  });

  buildPlayerConsoles();
  setPaused(false);
}

// --- STATE ---
let historyStack = [];
let victoryLocked = false; // once a combat is won OR lost, nothing may
// resume/undo the ring until the next combat's startCombat() resets this.
let units = [];
let rocks = [];
let corruptionLevel = getState().partyCorruption.level;
let corruptionFilled = getState().partyCorruption.filled;
let paused = true;
// The unit whose turn just ended (reached the action line) and is now
// waiting on the player to double-tap forward. Player corruption
// auto-increments when that double-tap arrives — see the tap handler
// below — not the moment the unit reaches the line.
let turnPendingUnit = null;

function setPaused(val) {
  paused = val;
  if (paused) {
    pauseIconGroup.style.display = 'none';
    pauseIconGroup.style.opacity = '0';
    playIconGroup.style.display = '';
    requestAnimationFrame(() => (playIconGroup.style.opacity = '1'));
  } else {
    playIconGroup.style.display = 'none';
    playIconGroup.style.opacity = '0';
    pauseIconGroup.style.display = '';
    requestAnimationFrame(() => (pauseIconGroup.style.opacity = '1'));
  }
}
let lastTime = performance.now();
let dragging = null;
let dragData = {
  startAngle: 0,
  currentPos: { x: 0, y: 0 },
  lock: null,
  originX: 0,
  originY: 0,
};
let knockback = null;
let lastTap = 0;
let activeCasts = [];
let castingUnit = null; // Tracks the unit currently choosing a spoke
let castDrag = null; // Tracks if we are currently dragging a star to destroy it

// --- RALLY ---
// Temporarily replaces the star/cast feature on the same control-ring
// button (group-star) and the same "unit currently at the action line"
// trigger the cast flow used -- the cast code itself (renderSpokes,
// createCastLine, activeCasts, castingUnit, castDrag, and its
// save/restore snapshot handling) is left completely intact and unused
// rather than removed, so it's a straightforward swap back once the star
// cast feature is ready for another pass.
//
// Degrees of forward motion Rally distributes across all units of
// whichever type (player or enemy) is currently at the action line, split
// evenly across every one of THAT type's units currently in the fight --
// including every individual dot of a shared multi-dot enemy (Overseer,
// Hell Lord), per spec ("each enemy dot would move forward motion divided
// by the number of dots").
const RALLY_TOTAL_DEGREES = 90;
// When Rally would push a unit AT OR PAST the action line, it's clamped
// to just before the line instead -- see performRally's own comment for
// why (a direct angle assignment bypasses the normal tick-based crossing
// detection entirely, so a unit that "arrives" via straight teleport
// rather than a detected crossing silently skips its actual turn). This
// is the fixed angular gap between multiple units that all overshoot in
// the same Rally and would otherwise collide at an identical clamped
// spot.
const RALLY_LINE_CLAMP_STEP = 0.5;

// unitId -> { targetAngle, group } for a unit whose Rally-granted motion
// hasn't landed yet -- specifically, whichever unit was AT the action
// line (mid-turn) when Rally was used. Per spec, that one unit's motion
// is deferred and only shown as a marker on its ring until its turn
// actually ends (see the double-tap-to-resume handler, where this
// resolves), while every OTHER unit of its type moves immediately.
let pendingRallyMoves = {};

// --- SPEED PREVIEW ("ghost dots") ---
// Extends the knockback drag's own single-ghost-dot forecast (see `ghost`
// / `ghostArc` and the radial-lock branch of the pointermove listener
// below) to the tangential (speed-change) drag: while a dot is being
// dragged left/right but not yet released, this projects where every
// OTHER dot on the ring would be at the moment the DRAGGED dot next
// reaches the action line, under the candidate speedMult the current
// drag position would commit if released right now.
//
// Like the knockback ghost, this is a forecast, not a guarantee — it
// assumes every other unit's speedMult stays exactly as it is right now
// for the whole projected interval, with no rocks, casts, or new speed
// actions changing anything in between. Good enough to reason about "if I
// do this, who do I leapfrog," which is the whole point.
//
// Keyed by unit.id and reused across pointermove calls rather than
// recreated every frame, same pooling reason unit elements themselves
// aren't recreated per frame.
const SVG_NS = 'http://www.w3.org/2000/svg';

// --- SHARED "GHOST DOT" RENDERING (ring-side previews) --------------------
//
// A translucent, otherwise ordinary-looking copy of a unit's own ring
// token -- same circle fill, same portrait or 2-letter guardian label --
// used for every ring-side forecast preview (speed-change drag, Rally).
// Originally these were plain dashed outline circles, with the
// speed-change ones additionally carrying a "turns ahead" number. A user
// found both choices hurt legibility: the dashed circle read as a
// SEPARATE marker sitting near a unit rather than a preview OF that
// specific unit, and a real unit landing at/near that same spot during
// the drag would visually overlap and collide with it in a confusing
// way. A 50%-opacity copy of the actual token reads unambiguously as
// "this exact unit, projected forward" instead. The turn-count numbers
// are dropped entirely per that same feedback -- the curved queue is
// the intended source of truth for turn ORDER; the ring's own ghosts are
// purely a spatial preview of where things will physically sit.
function ensureRingGhost(pool, id, layer) {
  let ghost = pool[id];
  if (ghost) return ghost;

  const group = document.createElementNS(SVG_NS, 'g');
  group.style.pointerEvents = 'none';

  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('r', '11');
  circle.setAttribute('stroke', '#000');
  circle.setAttribute('stroke-width', '1.5');
  group.appendChild(circle);

  const clipId = 'ring-ghost-clip-' + Math.random().toString(36).slice(2);
  const clipPath = document.createElementNS(SVG_NS, 'clipPath');
  clipPath.id = clipId;
  const clipCircle = document.createElementNS(SVG_NS, 'circle');
  clipCircle.setAttribute('r', '11');
  clipPath.appendChild(clipCircle);
  group.appendChild(clipPath);

  const img = document.createElementNS(SVG_NS, 'image');
  img.setAttribute('x', '-11');
  img.setAttribute('y', '-11');
  img.setAttribute('width', '22');
  img.setAttribute('height', '22');
  img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  img.setAttribute('clip-path', `url(#${clipId})`);
  img.style.display = 'none';
  group.appendChild(img);

  const label = document.createElementNS(SVG_NS, 'text');
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('dy', '0.35em');
  label.setAttribute('font-family', 'monospace');
  label.setAttribute('font-weight', '900');
  label.setAttribute('font-size', '10');
  label.setAttribute('fill', '#fff');
  label.style.pointerEvents = 'none';
  group.appendChild(label);

  layer.appendChild(group);
  ghost = { group, circle, img, label };
  pool[id] = ghost;
  return ghost;
}

// `angle` is the projected/candidate angle to render the ghost at;
// `unit.radius` supplies which ring. Opacity fixed at 0.5 -- "a faded
// copy of the real thing," per the redesign above.
function renderRingGhost(ghost, unit, angle) {
  const pos = polar(unit.radius, angle);
  ghost.group.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
  ghost.circle.setAttribute('fill', unit.color);
  if (unit.iconUrl) {
    ghost.img.setAttribute('href', unit.iconUrl);
    ghost.img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', unit.iconUrl);
    ghost.img.style.display = '';
    ghost.label.textContent = '';
  } else {
    ghost.img.style.display = 'none';
    ghost.label.textContent = getEnemyQueueLabel(unit.id, guardianAssignment) || '';
  }
  ghost.group.style.opacity = '0.5';
}

let speedGhostDots = {};

function updateSpeedGhosts(dragUnit, candidateSpeedMult) {
  const currentSpeed = dragUnit.speed * candidateSpeedMult;
  if (currentSpeed <= 0) {
    // A slow-down all the way to a stall has no "next time it reaches the
    // action line" to forecast toward.
    clearSpeedGhosts();
    return;
  }

  // Same distance-to-action-line math tickInner() uses for its own
  // distToFinish, using dragUnit's actual (undragged) angle -- a
  // tangential drag never moves the dot's real position, only its future
  // speedMult (see the tangential branch of the pointerup listener), so
  // the live drag-follow position under the player's finger is irrelevant
  // here.
  let distToLine = 360 - dragUnit.angle;
  if (distToLine <= 0) distToLine += 360;
  const timeToLine = distToLine / currentSpeed;

  const stillNeeded = new Set();
  units.forEach((u2) => {
    if (u2 === dragUnit) return;
    const u2Speed = u2.speed * u2.speedMult;
    if (u2Speed <= 0) return; // a stalled dot doesn't move, so it has no future position to preview

    stillNeeded.add(u2.id);
    const distTraveled = u2Speed * timeToLine;
    const projectedAngle = (u2.angle + distTraveled) % 360;

    const ghost = ensureRingGhost(speedGhostDots, u2.id, dragPreviewLayer);
    renderRingGhost(ghost, u2, projectedAngle);
  });

  // Any pooled ghost that no longer corresponds to a moving unit (it
  // died, or its own speedMult dropped to 0, mid-drag) just hides rather
  // than getting destroyed -- it'll be reused next time that id qualifies
  // again.
  Object.keys(speedGhostDots).forEach((id) => {
    if (!stillNeeded.has(id)) {
      speedGhostDots[id].group.style.opacity = '0';
    }
  });
}

function clearSpeedGhosts() {
  Object.values(speedGhostDots).forEach((ghost) => {
    ghost.group.style.opacity = '0';
  });
}

// Menu State
let appState = 'IDLE';

// Initialize Units
// 2-letter guardian-name label on a ring token (TRD 1.2 correction: these
// belong on the ring dots too, not just the queue). Appended straight to
// the unit's own <g>, which updateUnitTransform() only ever translates
// (never rotates) -- so the text stays upright at every ring position
// without needing its own counter-rotation the way faceIcon/
// anchorIndicator do.
function addRingLabel(u, text) {
  if (!text) return;
  const label = document.createElementNS(SVG_NS, 'text');
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('dy', '0.35em');
  label.setAttribute('font-family', 'monospace');
  label.setAttribute('font-weight', '900');
  label.setAttribute('font-size', '8');
  label.setAttribute('fill', '#fff');
  label.style.pointerEvents = 'none';
  label.textContent = text;
  u.el.appendChild(label);
}

function createUnit(id, radius, angle, speed, color, sides = 0, rot = 0, iconUrl = null) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  el.id = id;
  el.style.pointerEvents = 'none';

  const statusRing = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'circle'
  );
  statusRing.setAttribute('r', '11');
  statusRing.setAttribute('fill', 'none');
  statusRing.setAttribute('stroke', 'none');
  statusRing.setAttribute('stroke-width', '2');
  statusRing.classList.add('status-ring');

  const circle = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'circle'
  );
  circle.setAttribute('r', '9');
  circle.setAttribute('fill', color);
  circle.setAttribute('stroke', '#000');
  circle.setAttribute('stroke-width', '2');

  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', polygonPath(0, 0, 5, sides, rot));
  shape.setAttribute('fill', color);
  shape.style.filter = 'brightness(0.6)';
  shape.style.pointerEvents = 'none';

  // Player-character icon: a clipped circular portrait, outlined in the
  // color of the enemy group this player is engaged with (= their own
  // color, since each player is always paired with their own colored
  // guardian). Rotation is applied dynamically every frame (see
  // updateUnitTransform) rather than fixed here. Renders on top of (and
  // hides) the plain polygon/circle shape, without disturbing the existing
  // child index order other code relies on (circle stays at children[1],
  // shape stays at children[2]).
  let faceIcon = null;
  if (iconUrl) {
    circle.style.display = 'none';
    shape.style.display = 'none';

    faceIcon = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    faceIcon.classList.add('face-icon');

    const clipId = 'clip-' + id;
    const clipPath = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'clipPath'
    );
    clipPath.id = clipId;
    const clipCircle = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'circle'
    );
    clipCircle.setAttribute('r', '10');
    clipPath.appendChild(clipCircle);
    faceIcon.appendChild(clipPath);

    const img = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'image'
    );
    img.setAttributeNS(
      'http://www.w3.org/1999/xlink',
      'href',
      iconUrl
    );
    img.setAttribute('href', iconUrl);
    img.setAttribute('x', '-10');
    img.setAttribute('y', '-10');
    img.setAttribute('width', '20');
    img.setAttribute('height', '20');
    img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    img.setAttribute('clip-path', `url(#${clipId})`);
    faceIcon.appendChild(img);

    const outline = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'circle'
    );
    outline.setAttribute('r', '10');
    outline.setAttribute('fill', 'none');
    outline.setAttribute('stroke', color);
    outline.setAttribute('stroke-width', '2');
    faceIcon.appendChild(outline);
  }

  // NEW ANCHOR ICON: Smaller, black version of main menu icon
  const anchorGroup = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'g'
  );
  anchorGroup.style.opacity = '0';
  anchorGroup.setAttribute('transform', 'scale(0.7)');

  const anchorIcon = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'g'
  );
  anchorIcon.innerHTML = `
    <path d="M0 -10 L0 8 M-7 4 C-7 10 7 10 7 4" stroke="black" stroke-width="3.5" fill="none"/>
    <circle cx="0" cy="-12" r="3.5" stroke="black" stroke-width="2.5" fill="none"/>
    <line x1="-5" y1="-4" x2="5" y2="-4" stroke="black" stroke-width="3" />
  `;

  anchorGroup.appendChild(anchorIcon);

  el.appendChild(statusRing);
  el.appendChild(circle);
  el.appendChild(shape);
  if (faceIcon) el.appendChild(faceIcon);
  el.appendChild(anchorGroup);
  unitLayer.appendChild(el);

  return {
    id,
    el,
    radius,
    angle,
    speed,
    color,
    sides,
    rot,
    iconUrl,
    faceIcon,
    speedMult: 1, // derived/cached from speedModifiers -- see recomputeSpeedMult()
    speedModifiers: [], // [{ tier, remaining }] -- each active speed-up/slow-down tier, independently expiring; see recomputeSpeedMult/advanceSpeedModifiers
    anchored: false,
    anchorDist: 0,
    anchorIndicator: anchorGroup,
    statusRing: statusRing,
  };
}

// Positions a unit. Face icons rotate dynamically every frame to match the
// ring's own geometry: at rotation=0 (top of ring) the icon's native
// "up"/head already points outward, so rotation = faceAngle directly keeps
// the head pointing away from center and the neck toward it at every
// position around the ring. The anchor indicator uses the exact same
// per-frame rotation (no offset) — its native "up" (the ring/loop end of
// the icon, drawn at the top of its path data) points outward just like
// the face icon's, which means its "down" end (the shank/flukes) already
// points toward the ring's center at every position. (A +180° offset was
// tried first to make it point inward, but that rotated the icon so its
// LOOP end faced center instead of its flukes end — visually "the wrong
// side pointing toward center." Using the same rotation as faceIcon, with
// no offset, is what actually achieves "flukes toward center.")
function updateUnitTransform(u, x, y, faceAngle) {
  u.el.setAttribute('transform', `translate(${x}, ${y})`);
  if (u.faceIcon && faceAngle !== undefined) {
    u.faceIcon.setAttribute('transform', `rotate(${faceAngle})`);
  }
  if (u.anchorIndicator && faceAngle !== undefined) {
    u.anchorIndicator.setAttribute('transform', `scale(0.7) rotate(${faceAngle})`);
  }
}

// --- BOULDER (ROCK) CONFIG ---
// How long a placed boulder blocks its speed ring before disappearing on
// its own, in milliseconds. Was previously a health pool (100, -2 per
// blocking tick) that units had to "break down" over repeated hits;
// that's gone entirely now -- a boulder is a timed obstacle only, no
// health, no destruction. THIS is the one place to change its duration.
const ROCK_DURATION_MS = 1000;

function createRock(radius, angle) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  el.style.pointerEvents = 'none';

  const rockShape = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'path'
  );
  rockShape.setAttribute('d', 'M-6 -6 L4 -8 L8 -2 L6 6 L-2 8 L-8 2 Z');
  rockShape.setAttribute('fill', '#888');
  rockShape.setAttribute('stroke', '#000');
  rockShape.setAttribute('stroke-width', '2');

  el.appendChild(rockShape);
  rockLayer.appendChild(el);

  const p = polar(radius, angle);
  el.setAttribute('transform', `translate(${p.x}, ${p.y})`);

  return {
    el,
    radius,
    angle,
    // Counted down by dt each unpaused tick (see tickInner's rock-cleanup
    // block), NOT wall-clock time -- this used to be a
    // performance.now()-based expiry timestamp, which kept advancing in
    // real time even while the game was PAUSED (waiting at a turn for a
    // double-tap to resume). Since a boulder is meant to block ring
    // movement for a span of actual game time, not real-world time, a
    // pause of even a couple of seconds while deciding a move could burn
    // through most or all of a 1-second boulder's lifetime before any
    // blocking ever had a chance to happen -- which is exactly why it
    // looked like it was "expiring much quicker" than its configured
    // duration. Tracking remaining game-time directly instead means a
    // paused game can never eat into it.
    remainingMs: ROCK_DURATION_MS,
  };
}

// Fraction of a candidate's raw impact score a first-half-of-the-circle
// placement needs to BEAT a second-half candidate by before it's chosen
// over it. Second-half wins any closer contest, per spec ("even if it is
// 15% less impactful"). Configurable here alongside ROCK_DURATION_MS.
const ROCK_SECOND_HALF_PREFERENCE = 0.15;

// The enemy's own hostile action, triggered by a player pressing the
// boulder/rock button (btnHex) while an enemy unit is paused at the
// action line -- NOT automatically the instant that unit reaches the
// line (see btnHex's own pointerdown handler for the gating). Places a
// boulder on the PLAYER ring (radius 150 -- the only ring a "most brutal
// to player movement" placement could mean, since enemy/guardian dots
// live on the separate 130 ring and blocking them wouldn't touch player
// movement at all) at whichever angle impedes the most cumulative player
// movement over the boulder's ROCK_DURATION_MS lifetime.
//
// Scoring, per candidate angle: for every player unit currently moving,
// estimate how long from right now it would take to reach that angle
// (measuring the same circular distance/speed math tickInner's own
// finisher search uses). If that unit would reach the candidate before
// the boulder expires, it gets frozen there for the REMAINDER of the
// boulder's lifetime (see the blocking check in tickInner -- a blocked
// unit doesn't move at all on a tick where it would cross the rock, and
// since its angle doesn't change, the same block re-fires every
// subsequent tick until the rock itself expires). The "impact" credited
// is that remaining-frozen duration converted into the degrees of
// forward progress the unit would otherwise have covered -- i.e. how
// much of its movement this boulder actually denies. Candidates are
// summed across every player unit and the highest-scoring angle wins,
// with the "prefer the second half of the circle" rule applied after
// scoring (see below) rather than folded into the score itself, so that
// rule stays a simple, auditable tie-break instead of a fudge factor
// baked into the numbers.
//
// "Increasing chance of knockback" from the original spec isn't a
// separately scored term here -- there's no existing mechanical link
// between a rock and knockback odds in this file to weight against.
// What DOES fall out of this naturally: a frozen unit is a stationary,
// predictable target for the rest of the boulder's lifetime, which is
// exactly the situation a player would want to line up a knockback
// drag against. If a concrete knockback-probability rule gets added
// later, this scoring function is the place to fold it in.
function autoPlaceBoulderForEnemyTurn() {
  const PLAYER_RING_RADIUS = 150;

  const movingPlayers = units.filter(
    (u) => u.id.startsWith('player_') && u.radius === PLAYER_RING_RADIUS && u.speed * u.speedMult > 0
  );
  if (movingPlayers.length === 0) return; // nobody to impede -- nothing to place

  function scoreAngle(candidateAngle) {
    let total = 0;
    movingPlayers.forEach((u) => {
      const currentSpeed = u.speed * u.speedMult;
      let distToCandidate = (candidateAngle - u.angle + 360) % 360;
      // Treat "already essentially there" as no real head start to steal
      // -- avoids a degenerate near-zero-distance candidate dominating
      // the score just because a unit happens to be sitting right on top
      // of it this instant.
      if (distToCandidate < 0.5) return;
      const timeToReachMs = distToCandidate / currentSpeed;
      if (timeToReachMs >= ROCK_DURATION_MS) return; // boulder would already be gone
      const frozenDurationMs = ROCK_DURATION_MS - timeToReachMs;
      total += frozenDurationMs * currentSpeed; // degrees of progress denied
    });
    return total;
  }

  let bestFirstHalf = null; // candidate angle in [0, 180) -- just past the action line
  let bestSecondHalf = null; // candidate angle in [180, 360) -- closing in on the action line
  for (let angle = 0; angle < 360; angle += 5) {
    const score = scoreAngle(angle);
    if (angle < 180) {
      if (!bestFirstHalf || score > bestFirstHalf.score) bestFirstHalf = { angle, score };
    } else {
      if (!bestSecondHalf || score > bestSecondHalf.score) bestSecondHalf = { angle, score };
    }
  }

  // Prefer the second half unless the first half's best candidate beats
  // it by MORE than ROCK_SECOND_HALF_PREFERENCE -- i.e. the second half
  // wins any contest where it's within that margin, and wins outright
  // whenever it's simply the stronger candidate.
  let chosen = bestSecondHalf;
  if (
    bestFirstHalf &&
    (!bestSecondHalf || bestFirstHalf.score > bestSecondHalf.score * (1 + ROCK_SECOND_HALF_PREFERENCE))
  ) {
    chosen = bestFirstHalf;
  }
  if (!chosen || chosen.score <= 0) return; // no placement would actually impede anyone right now

  saveState(); // same undo-history treatment a manual placement gets
  rocks.push(createRock(PLAYER_RING_RADIUS, chosen.angle));
  refreshPendingTurnSnapshot();
}

// --- CUMULATIVE SPEED MODIFIERS ------------------------------------------
//
// A unit's net speed modifier is the SUM of every currently-active tier
// it's carrying, not just its most recent one -- a 1-tier boost and a
// LATER 2-tier boost stack into a 3-tier boost, each expiring
// independently after 360 degrees of that unit's own actual travel from
// the moment IT was applied (tickInner()'s existing per-tier decay rule,
// generalized from a single scalar to a list). `speedMult` is kept as a
// derived/cached field (existing code reads `u.speed * u.speedMult`
// directly in a dozen places) that recomputeSpeedMult() keeps in sync
// with `speedModifiers` -- it should never be assigned directly outside
// this function.
// tier > 0 for a speed-up chevron count, tier < 0 for a slow-down count
// -- matches the existing `count` variable's sign convention at the drag
// commit site. Shared by recomputeSpeedMult (the REAL cached value) and
// the drag preview below (a CANDIDATE value that includes a tier that
// hasn't been committed yet), so the two formulas can never drift apart.
function speedMultForTotalTier(total) {
  return total >= 0 ? 1 + total * 0.5 : 1 / (1 + Math.abs(total) * 0.5);
}

function recomputeSpeedMult(u) {
  const total = u.speedModifiers.reduce((sum, m) => sum + m.tier, 0);
  u.speedMult = speedMultForTotalTier(total);
}

// tier > 0 for a speed-up chevron count, tier < 0 for a slow-down count
// -- matches the existing `count` variable's sign convention at the drag
// commit site.
function addSpeedModifier(u, tier) {
  u.speedModifiers.push({ tier, remaining: 360 });
  recomputeSpeedMult(u);
}

// Anchor cancels active SLOW effects outright, leaving any active speed-
// UP tiers untouched -- generalized from the old single-modifier rule
// (`if (speedMult < 1) reset`) to per-tier removal so a unit carrying
// BOTH a boost and a slow at once only loses the slow.
function stripSlowModifiers(u) {
  u.speedModifiers = u.speedModifiers.filter((m) => m.tier >= 0);
  recomputeSpeedMult(u);
}

// Called from tickInner's own per-tick movement code (both the normal
// and the near-line "big jump" branches -- see their own call sites)
// with the actual degrees just travelled. Every active modifier ticks
// down by the same amount (they're all measuring the SAME unit's actual
// travel, just against independent budgets) -- mirrors tickInner()'s
// pre-existing single-timer decrement, just applied per-tier now.
function advanceSpeedModifiers(u, distanceMoved) {
  if (u.speedModifiers.length === 0) return;
  u.speedModifiers.forEach((m) => {
    m.remaining -= distanceMoved;
  });
  u.speedModifiers = u.speedModifiers.filter((m) => m.remaining > 0);
  recomputeSpeedMult(u);
}

function resetToIdle() {
  appState = 'IDLE';
  gameWorld.style.opacity = '1';
  controlRing.classList.remove('dim-state', 'dim-anchor-active', 'dim-rock-active');
  const sg = document.getElementById('spoke-group');
  if (sg) sg.innerHTML = '';
  appState = 'IDLE';
  cancelAllActionPreviews();
}

// --- SPLIT COMMIT/CANCEL BUTTON (TRD 2.3/2.4/2.5) -----------------------
//
// "that button splits into 2 buttons/half sizes of the original. One
// with a green check, and another with a red x" -- each control-ring
// wedge is itself a donut-arc path (see donutPath's own definition and
// the group-anchor/group-star/group-hex template markup), so a literal
// half-size split is just the same donut geometry cut at the wedge's
// own midpoint angle, one half green with a check glyph, the other red
// with an X. Reused by all three of boulder/rally/anchor rather than
// three near-identical copies.
const SPLIT_INNER_R = 25;
const SPLIT_OUTER_R = 65;

function showCommitCancelSplit(groupId, startAngle, endAngle, onCommit, onCancel) {
  const group = document.getElementById(groupId);
  if (!group || group.querySelector('.commit-cancel-split')) return;

  // Hide (not remove) the wedge's normal contents -- restored verbatim
  // by hideCommitCancelSplit once a choice is made.
  Array.from(group.children).forEach((c) => {
    c.style.opacity = '0';
    c.style.pointerEvents = 'none';
  });

  const mid = (startAngle + endAngle) / 2;
  const wrap = document.createElementNS(SVG_NS, 'g');
  wrap.classList.add('commit-cancel-split');

  const commitPath = document.createElementNS(SVG_NS, 'path');
  commitPath.setAttribute('d', donutPath(SPLIT_INNER_R, SPLIT_OUTER_R, startAngle, mid));
  commitPath.setAttribute('fill', '#27ae60');
  commitPath.setAttribute('stroke', '#111');
  commitPath.setAttribute('stroke-width', '2');
  commitPath.style.cursor = 'pointer';

  const cancelPath = document.createElementNS(SVG_NS, 'path');
  cancelPath.setAttribute('d', donutPath(SPLIT_INNER_R, SPLIT_OUTER_R, mid, endAngle));
  cancelPath.setAttribute('fill', '#eb5757');
  cancelPath.setAttribute('stroke', '#111');
  cancelPath.setAttribute('stroke-width', '2');
  cancelPath.style.cursor = 'pointer';

  const midR = (SPLIT_INNER_R + SPLIT_OUTER_R) / 2;
  const checkPos = polar(midR, (startAngle + mid) / 2);
  const check = document.createElementNS(SVG_NS, 'path');
  check.setAttribute(
    'd',
    `M ${checkPos.x - 7} ${checkPos.y} L ${checkPos.x - 2} ${checkPos.y + 6} L ${checkPos.x + 8} ${checkPos.y - 8}`
  );
  check.setAttribute('stroke', 'white');
  check.setAttribute('stroke-width', '3.5');
  check.setAttribute('fill', 'none');
  check.setAttribute('stroke-linecap', 'round');
  check.setAttribute('stroke-linejoin', 'round');
  check.style.pointerEvents = 'none';

  const xPos = polar(midR, (mid + endAngle) / 2);
  const xMark = document.createElementNS(SVG_NS, 'path');
  xMark.setAttribute(
    'd',
    `M ${xPos.x - 6} ${xPos.y - 6} L ${xPos.x + 6} ${xPos.y + 6} M ${xPos.x - 6} ${xPos.y + 6} L ${xPos.x + 6} ${xPos.y - 6}`
  );
  xMark.setAttribute('stroke', 'white');
  xMark.setAttribute('stroke-width', '3.5');
  xMark.setAttribute('stroke-linecap', 'round');
  xMark.style.pointerEvents = 'none';

  commitPath.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    hideCommitCancelSplit(groupId);
    onCommit();
  });
  cancelPath.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    hideCommitCancelSplit(groupId);
    onCancel();
  });

  wrap.appendChild(commitPath);
  wrap.appendChild(cancelPath);
  wrap.appendChild(check);
  wrap.appendChild(xMark);
  group.appendChild(wrap);
}

function hideCommitCancelSplit(groupId) {
  const group = document.getElementById(groupId);
  if (!group) return;
  const split = group.querySelector('.commit-cancel-split');
  if (split) split.remove();
  Array.from(group.children).forEach((c) => {
    if (c.classList && c.classList.contains('commit-cancel-split')) return;
    c.style.opacity = '';
    c.style.pointerEvents = '';
  });
}

// --- BOULDER PLACEMENT PREVIEW (TRD 2.3) --------------------------------
//
// Player-turn-only (see btnHex's own pointerdown handler for the enemy-
// turn immediate/no-preview branch, unchanged). Nothing is pushed into
// the real `rocks` array until commit -- a tap on the ring while this is
// pending just MOVES the candidate (re-placement, per the TRD's "may
// select any number of places").
let pendingRockPlacement = null; // { radius, angle } | null
let previewRockEl = null;

function showPreviewRock(radius, angle) {
  if (!previewRockEl) {
    previewRockEl = document.createElementNS(SVG_NS, 'g');
    previewRockEl.style.pointerEvents = 'none';
    previewRockEl.style.opacity = '0.55';
    const shape = document.createElementNS(SVG_NS, 'path');
    shape.setAttribute('d', 'M-6 -6 L4 -8 L8 -2 L6 6 L-2 8 L-8 2 Z');
    shape.setAttribute('fill', '#888');
    shape.setAttribute('stroke', '#fff');
    shape.setAttribute('stroke-width', '2');
    shape.setAttribute('stroke-dasharray', '3 2');
    previewRockEl.appendChild(shape);
    rockLayer.appendChild(previewRockEl);
  }
  const p = polar(radius, angle);
  previewRockEl.setAttribute('transform', `translate(${p.x}, ${p.y})`);
  previewRockEl.style.display = '';
}

function clearPreviewRock() {
  if (previewRockEl) previewRockEl.style.display = 'none';
}

function updateBoulderPreview() {
  if (!pendingRockPlacement) return;
  showPreviewRock(pendingRockPlacement.radius, pendingRockPlacement.angle);
  queuePreviewOverride = {
    unitOverrides: {},
    extraRocks: [
      { radius: pendingRockPlacement.radius, angle: pendingRockPlacement.angle, remainingMs: ROCK_DURATION_MS },
    ],
    // Any live unit COULD end up blocked by this placement -- the
    // overlay only actually draws an arrow for ones whose forecast slot
    // genuinely moved, so it's safe (and simplest) to just offer every
    // unit as a candidate rather than pre-computing which ones a rock at
    // this exact angle would affect.
    trackedUnitIds: units.map((u) => u.id),
  };
  showCommitCancelSplit(
    'group-hex',
    240,
    360,
    () => {
      saveState();
      rocks.push(createRock(pendingRockPlacement.radius, pendingRockPlacement.angle));
      pendingRockPlacement = null;
      refreshPendingTurnSnapshot();
      resetToIdle();
    },
    () => {
      pendingRockPlacement = null;
      resetToIdle();
    }
  );
}

// --- RALLY PREVIEW (TRD 2.4) ---------------------------------------------
//
// Player-turn-only (see group-star's own pointerdown handler for the
// enemy-turn immediate/no-preview branch, which is already exactly what
// 2.4 asks for and needed no changes). Unlike boulder/anchor there's no
// selection to make -- Rally's target set and per-unit share are fully
// determined by whose turn it is, so pressing the button starts the
// preview immediately; pressing it again before committing stacks
// another share on top (mirrors the stacking behavior performRally()
// itself already had for repeated REAL presses within the same turn,
// now happening at preview time instead).
let pendingRallyPreview = null; // { unitAtTurnId, shareMultiplier, baseAngles: Map<id, angle> } | null
let rallyRingGhosts = {};

function showRallyRingGhosts(candidateAngles) {
  const stillNeeded = new Set();
  candidateAngles.forEach(({ unit, angle }) => {
    stillNeeded.add(unit.id);
    const ghost = ensureRingGhost(rallyRingGhosts, unit.id, dragPreviewLayer);
    renderRingGhost(ghost, unit, angle);
  });
  Object.keys(rallyRingGhosts).forEach((id) => {
    if (!stillNeeded.has(id)) rallyRingGhosts[id].group.style.opacity = '0';
  });
}

function clearRallyRingGhosts() {
  Object.values(rallyRingGhosts).forEach((ghost) => ghost.group.remove());
  rallyRingGhosts = {};
}

function updateRallyPreview() {
  if (!pendingRallyPreview) return;
  const isPlayerTurn = pendingRallyPreview.unitAtTurnId.startsWith('player_');
  const groupUnits = units.filter((u) =>
    isPlayerTurn ? u.id.startsWith('player_') : u.id.startsWith('guardian_')
  );

  // Simulates the exact sequence of individual performRally() calls the
  // eventual commit makes (once per stacked share -- see its own commit
  // handler below), including each pass's own independent redistribution
  // (computeRallyTargets) -- rather than one lump N-pass calculation.
  // Those can disagree: if an INTERMEDIATE pass would have capped/
  // redistributed for some unit, the NEXT pass starts from THAT
  // resulting spot, not from where a naive lump-sum would have put it.
  let currentAngles = groupUnits.map((u) => ({ id: u.id, angle: pendingRallyPreview.baseAngles.get(u.id) }));
  for (let pass = 0; pass < pendingRallyPreview.shareMultiplier; pass++) {
    const targets = computeRallyTargets(currentAngles, RALLY_TOTAL_DEGREES);
    currentAngles = targets.map((t) => ({ id: t.id, angle: t.target }));
  }
  const angles = new Map(currentAngles.map((a) => [a.id, a.angle]));

  const unitOverrides = {};
  const candidateAngles = [];
  groupUnits.forEach((u) => {
    const angle = angles.get(u.id);
    unitOverrides[u.id] = { angle };
    candidateAngles.push({ unit: u, angle });
  });

  // TRD 2.4: "immediate preview of player position impacts on both the
  // speed ring and the speed queue... including the unit whose turn it
  // currently is" -- the ring ghosts show every group unit's post-rally
  // spot, the unit at turn included, even though the REAL commit below
  // (performRally) still defers that one specific unit's actual move via
  // pendingRallyMoves until its turn ends, same as it always has.
  showRallyRingGhosts(candidateAngles);

  queuePreviewOverride = {
    unitOverrides,
    extraRocks: [],
    trackedUnitIds: groupUnits.map((u) => u.id),
  };

  showCommitCancelSplit(
    'group-star',
    120,
    240,
    () => {
      const unitAtTurn = units.find((u) => u.id === pendingRallyPreview.unitAtTurnId);
      // performRally() applies exactly ONE share per call (and already
      // has its own stacking logic for repeated real calls within a
      // turn -- see its own comment) -- call it once per share the
      // preview accumulated so the committed result actually matches
      // what was shown, not just the first press's worth.
      const times = pendingRallyPreview.shareMultiplier;
      pendingRallyPreview = null;
      clearRallyRingGhosts();
      if (unitAtTurn) {
        for (let i = 0; i < times; i++) performRally(unitAtTurn);
      }
      resetToIdle();
    },
    () => {
      pendingRallyPreview = null;
      clearRallyRingGhosts();
      resetToIdle();
    }
  );
}

// --- ANCHOR SELECTION PREVIEW (TRD 2.5) -----------------------------------
//
// Player-turn-only -- see btnAnchor's own pointerdown handler. Enemy-turn
// anchoring ("the selection is deterministic with no preview needed")
// has NO existing auto-selection rule anywhere in this file the way
// boulder's autoPlaceBoulderForEnemyTurn() already did before this pass,
// so that branch is deliberately left calling the same manual
// ANCHOR_SELECT flow it always has rather than inventing a targeting
// heuristic with no spec to build it from -- flagged in my reply/
// INTEGRATION_NOTES rather than guessed at silently.
let pendingAnchorSelections = new Set();
const anchorSelectionRings = new Map(); // unitId -> highlight <circle>

function showAnchorSelectionHighlights() {
  const stillNeeded = new Set(pendingAnchorSelections);
  pendingAnchorSelections.forEach((id) => {
    const u = units.find((unit) => unit.id === id);
    if (!u) return;
    let ring = anchorSelectionRings.get(id);
    if (!ring) {
      ring = document.createElementNS(SVG_NS, 'circle');
      ring.setAttribute('r', '13');
      ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', '#2d9cdb');
      ring.setAttribute('stroke-width', '2.5');
      ring.style.pointerEvents = 'none';
      dragPreviewLayer.appendChild(ring);
      anchorSelectionRings.set(id, ring);
    }
    const p = polar(u.radius, u.angle);
    ring.setAttribute('cx', p.x);
    ring.setAttribute('cy', p.y);
    ring.style.opacity = '1';
  });
  anchorSelectionRings.forEach((ring, id) => {
    if (!stillNeeded.has(id)) ring.style.opacity = '0';
  });
}

function clearAnchorSelectionHighlights() {
  anchorSelectionRings.forEach((ring) => ring.remove());
  anchorSelectionRings.clear();
}

function updateAnchorPreview() {
  showAnchorSelectionHighlights();

  if (pendingAnchorSelections.size === 0) {
    hideCommitCancelSplit('group-anchor');
    queuePreviewOverride = null;
    return;
  }

  // Only a unit CURRENTLY under a net-negative modifier total is worth
  // overriding for the forecast -- anchoring removes every individual
  // slow-tier it's carrying (stripSlowModifiers' own rule), which
  // matches the real commit exactly since that's literally the same
  // function this preview and the two real commits above all now share.
  const unitOverrides = {};
  pendingAnchorSelections.forEach((id) => {
    const u = units.find((unit) => unit.id === id);
    if (u && u.speedMult < 1) {
      unitOverrides[id] = { speedModifiers: u.speedModifiers.filter((m) => m.tier >= 0) };
    }
  });

  queuePreviewOverride = {
    unitOverrides,
    extraRocks: [],
    trackedUnitIds: Array.from(pendingAnchorSelections),
  };

  showCommitCancelSplit(
    'group-anchor',
    0,
    120,
    () => {
      const selections = Array.from(pendingAnchorSelections);
      pendingAnchorSelections = new Set();
      clearAnchorSelectionHighlights();
      saveState();
      selections.forEach((id) => {
        const u = units.find((unit) => unit.id === id);
        if (!u) return;
        u.anchored = true;
        u.anchorDist = 0;
        stripSlowModifiers(u);
        u.anchorIndicator.style.opacity = '1';
      });
      refreshPendingTurnSnapshot();
      resetToIdle();
    },
    () => {
      pendingAnchorSelections = new Set();
      clearAnchorSelectionHighlights();
      resetToIdle();
    }
  );
}

// Cancels any of the three previews above with zero side effects --
// called from resetToIdle() so leaving ROCK_SELECT/ANCHOR_SELECT/a rally
// preview by ANY path (pressing the same button again, pressing a
// DIFFERENT control-ring button, committing, or explicitly cancelling)
// can never leave stale preview state, a stuck split-button, or an
// orphaned ghost/highlight on screen.
function cancelAllActionPreviews() {
  pendingRockPlacement = null;
  clearPreviewRock();
  hideCommitCancelSplit('group-hex');

  pendingRallyPreview = null;
  clearRallyRingGhosts();
  hideCommitCancelSplit('group-star');

  pendingAnchorSelections = new Set();
  clearAnchorSelectionHighlights();
  hideCommitCancelSplit('group-anchor');

  queuePreviewOverride = null;
}

// --- LOGIC FUNCTIONS ---
// inYellow: whether an angle falls within the orange arc zone (270-360°)
// shown on the speed rings. No longer gates the knockback DRAG (that now
// works from anywhere on the ring, per your request) -- currently
// unused, kept here for the arc's new passive meaning ("hit a unit here
// = automatic level-1 knockback") once that's implemented. See my reply
// for the question I need answered before building that part.
function inYellow(angle) {
  angle = ((angle % 360) + 360) % 360;
  return angle >= 270 && angle < 360;
}

function getAngleFromXY(x, y) {
  return ((Math.atan2(y, x) * 180) / Math.PI + 450) % 360;
}

let lastSaveStateTime = 0;

// Builds a ring snapshot without touching historyStack -- shared by
// saveState() (immediate push, for user-initiated actions like drag/
// anchor/rock placement) and the turn-boundary logic below (deferred
// push, for automatic turn-completion events).
function buildSnapshot() {
  return {
    type: 'ring',
    units: units.map((u) => ({
      id: u.id,
      radius: u.radius,
      angle: u.angle,
      speed: u.speed,
      color: u.color,
      sides: u.sides,
      rot: u.rot,
      speedMult: u.speedMult,
      speedModifiers: u.speedModifiers.map((m) => ({ ...m })), // deep-cloned -- see recomputeSpeedMult's own comment on why speedMult is derived from this list
      anchored: u.anchored,
      anchorDist: u.anchorDist,
      iconUrl: u.iconUrl,
    })),
    rocks: rocks.map((r) => ({
      radius: r.radius,
      angle: r.angle,
      remainingMs: r.remainingMs,
    })),
    guardianAssignment: JSON.parse(JSON.stringify(guardianAssignment)),
    corruptionLevel: corruptionLevel,
    corruptionFilled: corruptionFilled,
    // Both change mid-fight now that a player's death can drop the
    // shared threshold target (see handlePlayerRemovedFromCombat) --
    // without capturing them here, undoing back past a player's death
    // would correctly restore their guardianAssignment seat but leave the
    // threshold target stuck at the already-reduced number.
    overseerThresholdCount: overseerThresholdCount,
    overseerThresholdTarget: overseerThresholdTarget,
    activeCasts: activeCasts.map((c) => ({
      unitId: c.unit.id,
      endAngle: c.endAngle,
      radius: c.radius,
    })),
  };
}

function saveState() {
  const now = performance.now();
  if (now - lastSaveStateTime < 100) {
    // Another checkpoint was just pushed a moment ago (e.g. a speed-up drag
    // that immediately carried the unit across the action line on the very
    // next tick). Treat this as a continuation of that same action rather
    // than a separate undo step.
    return;
  }
  lastSaveStateTime = now;
  historyStack.push(buildSnapshot());
  if (historyStack.length > 50) historyStack.shift();
}

// --- Turn-boundary checkpoints (deferred push) --------------------------
//
// A unit reaching the action line is NOT a user action — it's an
// automatic event, and the display then sits paused on that exact state
// for as long as the player takes to look at it. If we pushed that
// snapshot onto historyStack immediately (as saveState() does for real
// user actions), it would sit on TOP of the stack for the whole pause —
// so the very next Undo press would pop and restore a snapshot that's
// IDENTICAL to what's already on screen: no visible change, which reads
// as "undo did nothing." A second Undo press would then pop the snapshot
// from the turn BEFORE that, skipping over the turn the player was
// actually looking at when they first pressed Undo.
//
// Fix: turn-boundary snapshots are held in pendingTurnSnapshot and only
// pushed onto historyStack once the NEXT turn boundary arrives (i.e. once
// they've genuinely become "the past," not "the present"). The very first
// Undo press during any turn's pause therefore always pops a snapshot
// from a DIFFERENT, earlier turn — a real, visible step backward — and
// each subsequent press steps back one further turn, in order, with none
// skipped.
let pendingTurnSnapshot = null;

function markTurnBoundary() {
  if (pendingTurnSnapshot) {
    historyStack.push(pendingTurnSnapshot);
    if (historyStack.length > 50) historyStack.shift();
  }
  pendingTurnSnapshot = buildSnapshot();
}

// Re-syncs pendingTurnSnapshot to the state RIGHT AFTER a discrete
// mid-turn ring action (anchor, boulder, rally, knockback, speed-change)
// commits -- called from each of those commit sites, right after their
// mutation completes. Without this, pendingTurnSnapshot stays frozen at
// whatever it was captured as when the CURRENT turn's pause began (see
// markTurnBoundary's own comment on what it represents), so a discrete
// action's own saveState() call (which correctly captures "before this
// action," for undoing just it within the same turn) had no counterpart
// ever capturing "after this action" as its OWN reachable checkpoint --
// a user found the concrete symptom: anchor a unit, let the next turn
// begin, Undo -- expected "just anchored," got "before anchor, still
// slowed" instead, with a second Undo press looking like it changed
// nothing (a near-duplicate of the same pre-anchor state) before a third
// finally reached genuinely earlier state.
//
// This intentionally does NOT refresh continuously every frame (an
// earlier version of this fix did, and update ran into a real edge
// case): anchorDist keeps accumulating in real time once the game
// resumes, so a continuous refresh could capture "anchored, but
// anchorDist already most of the way to its own natural 360° expiry" by
// the time the next boundary actually pushes it -- restoring THAT via
// Undo could make the anchor status expire again almost immediately,
// which looked like "the icon won't stay" even though the anchored fact
// itself round-tripped correctly. Refreshing only once, right when the
// action itself commits (anchorDist freshly at/near 0), avoids that.
function refreshPendingTurnSnapshot() {
  pendingTurnSnapshot = buildSnapshot();
}


// Records a console-side action (drag, consume, taint, skull) on the SAME
// unified stack as ring snapshots, so a single Undo button can reverse
// whichever kind of action happened most recently, in true chronological
// order — not two separate undo histories.
function pushConsoleUndo(undoFn) {
  historyStack.push({ type: 'console', undo: undoFn });
  if (historyStack.length > 50) historyStack.shift();
}

// Restores a full ring snapshot (units + rocks) exactly as it was saved.
function restoreRingSnapshot(prevState) {
  clearTurnIndicator();
  // Rally's deferred-move markers (pendingRallyMoves) aren't part of the
  // snapshot format -- saveState() is always called at the moment Rally
  // is used, before anything moves, so undoing straight back past a Rally
  // naturally lands before the marker ever existed. But undoing to some
  // OTHER earlier point while a Rally marker happens to still be showing
  // (e.g. several console actions were taken after it, each with their
  // own undo step, before the marker's own turn ever ended) would
  // otherwise leave that marker's SVG group orphaned on screen with no
  // corresponding state -- so it's cleared here unconditionally, same
  // defensive spirit as activeCasts being fully torn down and rebuilt
  // from the snapshot a few lines below rather than diffed.
  Object.values(pendingRallyMoves).forEach((m) => m.group && m.group.remove());
  pendingRallyMoves = {};
  // Same defensive reasoning as pendingRallyMoves just above -- a live
  // knockback ease (see its own 300ms ease code) isn't part of the
  // snapshot format either, and undoing mid-ease would otherwise leave
  // `knockback` pointing at a unit object this restore is about to
  // discard and replace.
  knockback = null;
  // turnPendingUnit is NOT nulled here anymore — it gets correctly
  // re-derived from the restored unit positions at the bottom of this
  // function instead. Nulling it unconditionally here was the actual bug
  // behind the corruption glitch: if this snapshot has a unit sitting
  // exactly at the action line (i.e. we're undoing to a moment where a
  // turn was pending), the OLD code lost track of whose turn it was. If
  // that pending unit was a PLAYER, the very next double-tap-to-resume
  // would silently skip that turn's corruption increment (undo, then
  // resume, ate a turn for free) — and conversely, undoing past an
  // ALREADY-resolved player turn and landing on a snapshot that still has
  // that same player sitting at the line (because the snapshot predates
  // their move away from angle 0) could leave a STALE turnPendingUnit
  // from a different point in time still armed, so a later resume
  // double-tap would apply an increment that didn't correspond to any
  // turn actually being completed at that moment. Both read as
  // "corruption changing at the wrong time" depending on the exact
  // undo/resume sequence — which matches reports of it looking like an
  // enemy's turn was triggering a player corruption change.

  if (prevState.guardianAssignment) {
    guardianAssignment = prevState.guardianAssignment;
  }
  if (prevState.corruptionLevel !== undefined) {
    corruptionLevel = prevState.corruptionLevel;
    corruptionFilled = prevState.corruptionFilled;
    renderCorruptionRing();
  }
  // Older snapshots (saved before this field existed) won't have it --
  // leave the current values alone rather than stomping them with
  // undefined in that case.
  if (prevState.overseerThresholdCount !== undefined) {
    overseerThresholdCount = prevState.overseerThresholdCount;
  }
  if (prevState.overseerThresholdTarget !== undefined) {
    overseerThresholdTarget = prevState.overseerThresholdTarget;
  }

  units.forEach((u) => {
    if (!prevState.units.find((p) => p.id === u.id)) u.el.remove();
  });

  units = prevState.units.map((p) => {
    let existing = units.find((u) => u.id === p.id);
    if (!existing) {
      existing = createUnit(
        p.id,
        p.radius,
        p.angle,
        p.speed,
        p.color,
        p.sides,
        p.rot,
        p.iconUrl || null
      );
    }

    existing.radius = p.radius;
    existing.angle = p.angle;
    existing.speed = p.speed;
    existing.color = p.color;
    existing.sides = p.sides;
    existing.rot = p.rot;
    existing.speedModifiers = (p.speedModifiers || []).map((m) => ({ ...m }));
    recomputeSpeedMult(existing);
    existing.anchored = p.anchored;
    existing.anchorDist = p.anchorDist;

    existing.anchorIndicator.style.opacity = p.anchored ? '1' : '0';

    // buildSnapshot() doesn't serialize isOverseerDot (it's derived, not
    // stored) -- re-derive it fresh from the just-restored
    // guardianAssignment rather than trust whatever a reused `existing`
    // happened to already have, so this stays correct even across an
    // undo that crosses an Overseer-encounter boundary.
    if (p.id.startsWith('guardian_')) {
      const pn = Number(p.id.slice('guardian_'.length));
      existing.isOverseerDot = !!(
        guardianAssignment[pn] &&
        (guardianAssignment[pn].isOverseer || guardianAssignment[pn].isInquisitor || guardianAssignment[pn].isHellLord)
      );
      // Same re-derive-fresh reasoning as isOverseerDot just above --
      // see that spot's own comment, and createUnit's original
      // assignment of this field, for why it can't just be trusted from
      // a reused `existing`/copied from the snapshot verbatim.
      existing.overseerId = (guardianAssignment[pn] && guardianAssignment[pn].overseerId) || null;
    }

    return existing;
  });

  rocks.forEach((r) => r.el.remove());
  rocks = prevState.rocks.map((p) => createRock(p.radius, p.angle));
  // createRock() always stamps a FRESH remainingMs (a full ROCK_DURATION_MS)
  // -- overwrite it with the snapshot's actual value so undoing doesn't
  // hand a boulder a brand new full duration it hadn't earned.
  rocks.forEach((r, i) => (r.remainingMs = prevState.rocks[i].remainingMs));

  // Restore active casts (star markers) — remove whatever currently exists,
  // then rebuild from the snapshot so a placed star can be undone same as
  // any other action.
  activeCasts.forEach((c) => c.group.remove());
  activeCasts = [];
  if (prevState.activeCasts) {
    prevState.activeCasts.forEach((c) => {
      const u = units.find((unit) => unit.id === c.unitId);
      if (u) createCastLine(u, c.endAngle, true);
    });
  }

  setPaused(true);
  units.forEach(
    (u) => (u.el.children[1].style.filter = `drop-shadow(0 0 8px ${u.color})`)
  );

  // Re-derive whose turn is pending from the restored positions, instead
  // of trusting a value carried over from before the undo — this is what
  // keeps a subsequent resume's corruption-increment decision correct.
  const atLine = units.find((u) => u.angle < 0.5 || u.angle > 359.5);
  turnPendingUnit = atLine || null;
  if (atLine) setTurnIndicator(atLine);

  // Re-sync pendingTurnSnapshot to the state we just landed on. Without
  // this, pendingTurnSnapshot would still hold whatever it was BEFORE the
  // undo — a state from later in the timeline than what's now on screen.
  // If a new turn boundary happened after that stale checkpoint got
  // pushed, it would insert a "future" state into what should now be a
  // rewritten history, letting a subsequent Undo jump to a moment that
  // the current timeline never actually passed through.
  pendingTurnSnapshot = buildSnapshot();
}

// The single Undo entry point — every player console's undo button calls
// this. Pops the most recent action, of EITHER kind (ring-state snapshot or
// a console action like a drag/consume/taint/skull), and reverses it.
function performGlobalUndo() {
  if (victoryLocked) return;
  if (historyStack.length === 0) return;
  const entry = historyStack.pop();

  if (entry.type === 'console') {
    entry.undo();
    refreshAllConsoles();
  } else {
    restoreRingSnapshot(entry);
    refreshAllConsoles();
  }
}

pauseBtn.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  if (victoryLocked) return;
  if (appState !== 'IDLE') {
    resetToIdle();
    return;
  }

  pauseBg.classList.remove('flash-on');
  void pauseBg.offsetWidth;
  pauseBg.classList.add('flash-on');

  setPaused(!paused);

  if (!paused) {
    units.forEach((u) => (u.el.children[1].style.filter = 'none'));
  } else {
    units.forEach(
      (u) =>
        (u.el.children[1].style.filter = `drop-shadow(0 0 8px ${u.color})`)
    );
  }
});

btnAnchor.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  if (appState === 'ANCHOR_SELECT') {
    resetToIdle();
  } else if (appState !== 'IDLE') {
    // Some OTHER mode (rock select, a rally preview) is active -- this
    // press cancels it, same one-press-to-back-out convention the
    // rally button already used before this pass. A second press then
    // actually enters ANCHOR_SELECT.
    resetToIdle();
  } else {
    appState = 'ANCHOR_SELECT';
    controlRing.classList.add('dim-state', 'dim-anchor-active');
  }
});

btnHex.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  if (appState === 'ROCK_SELECT') {
    resetToIdle();
    return;
  }
  if (appState !== 'IDLE') {
    // Some OTHER mode is active -- cancel it first (see btnAnchor's own
    // comment above for why this doesn't also immediately enter
    // ROCK_SELECT in the same press).
    resetToIdle();
    return;
  }
  // Enemy turn currently paused at the action line (any guardian_-
  // prefixed unit -- Guardian, Overseer, Inquisitor, and Hell Lord all
  // share that prefix): this button triggers the SAME auto-placement
  // algorithm as before (see autoPlaceBoulderForEnemyTurn's own
  // comment for the actual placement logic) -- it just now only runs
  // when a player presses this button during the enemy's turn, not the
  // instant an enemy dot reaches the line. Player's own turn (or no
  // turn currently pending): falls through to the unchanged manual
  // ROCK_SELECT flow below, exactly as before.
  if (turnPendingUnit && turnPendingUnit.id.startsWith('guardian_')) {
    autoPlaceBoulderForEnemyTurn();
    return;
  }
  appState = 'ROCK_SELECT';
  controlRing.classList.add('dim-state', 'dim-rock-active');
});

ring.addEventListener('pointerdown', (e) => {
  if (appState === 'COLOR' || appState === 'SPEED') return;
  // The check/X split (under group-star) is the only way to resolve a
  // rally preview, and stopPropagates its own taps -- so this only fires
  // for a tap ELSEWHERE, which stacks another share (same as pressing
  // the flag button again) rather than falling through to a normal drag/
  // double-tap while a decision is pending. Restoring the flag itself as
  // a stacking control isn't possible while the split covers it (see
  // showCommitCancelSplit's own use here), so a ring tap is the stand-in
  // control for it instead.
  if (appState === 'RALLY_PREVIEW') {
    if (pendingRallyPreview) {
      pendingRallyPreview.shareMultiplier++;
      updateRallyPreview();
    }
    return;
  }

  // TRD 3.1 Clear Protocol: any tap outside a queue icon (queue icons
  // stopPropagation their own pointerdown, so this never fires for them)
  // wipes an active Simulation Snapshot before the tap's own normal
  // effect (rock placement, unit selection, etc.) proceeds.
  clearQueueSnapshotSelection();

  const now = performance.now();
  const rect = ring.getBoundingClientRect();
  const scale = 400 / Math.min(rect.width, rect.height);
  const tx = (e.clientX - (rect.left + rect.width / 2)) * scale;
  const ty = (e.clientY - (rect.top + rect.height / 2)) * scale;

  const distToCenter = Math.hypot(tx, ty);
  const touchAngle = getAngleFromXY(tx, ty);

  if (appState === 'ROCK_SELECT') {
    const r1 = 130,
      r2 = 150;
    const d1 = Math.abs(distToCenter - r1);
    const d2 = Math.abs(distToCenter - r2);
    if (d1 < 15 || d2 < 15) {
      // TRD 2.3: a tap here only stages a CANDIDATE placement now --
      // reachable only for a player turn or no turn pending (btnHex's
      // own handler auto-places immediately and never enters ROCK_SELECT
      // for an enemy turn) -- nothing touches the real `rocks` array
      // until the split button's green check commits it. A second tap
      // elsewhere just moves the candidate, per the TRD's "may select
      // any number of places."
      const targetR = d1 < d2 ? r1 : r2;
      pendingRockPlacement = { radius: targetR, angle: touchAngle };
      updateBoulderPreview();
    }
    return;
  }

  let bestChoice = null;
  let closestDist = Infinity;
  units.forEach((u) => {
    // Determine the position to check against:
    // If it's fanned, we need to find where we visually moved it to.
    let checkPos;
    if (u.isFanned) {
      // Find the specific offset used in the fan-out logic
      const stacked = units.filter(
        (s) => s.radius === u.radius && Math.abs(s.angle - u.angle) < 1
      );
      const i = stacked.indexOf(u);
      const offset = (i - (stacked.length - 1) / 2) * 10;
      checkPos = polar(u.radius, u.angle + offset);
    } else {
      checkPos = polar(u.radius, u.angle);
    }

    const dist = Math.hypot(tx - checkPos.x, ty - checkPos.y);
    if (dist < closestDist) {
      closestDist = dist;
      bestChoice = u;
    }
  });

  if (appState === 'ANCHOR_SELECT') {
    if (bestChoice && closestDist < 30) {
      // Enemy turn: unchanged immediate-commit behavior (see this
      // block's own note in combat.js's Phase 3 section on why enemy-
      // turn anchor target selection isn't being made deterministic/
      // auto-preview here -- no existing rule to build it from).
      if (turnPendingUnit && turnPendingUnit.id.startsWith('guardian_')) {
        saveState();
        bestChoice.anchored = true;
        bestChoice.anchorDist = 0;
        stripSlowModifiers(bestChoice);
        bestChoice.anchorIndicator.style.opacity = '1';
        refreshPendingTurnSnapshot();
        resetToIdle();
        return;
      }

      // Player turn (or no turn pending): TRD 2.5 preview + multi-select
      // -- tapping an already-selected unit again deselects it, nothing
      // is actually anchored until the split button's green check.
      if (pendingAnchorSelections.has(bestChoice.id)) {
        pendingAnchorSelections.delete(bestChoice.id);
      } else {
        pendingAnchorSelections.add(bestChoice.id);
      }
      updateAnchorPreview();
    }
    return;
  }

  if (now - lastTap < 300) {
    if (victoryLocked) {
      lastTap = now;
      return;
    }
    setPaused(!paused);
    if (paused) {
      units.forEach(
        (u) =>
          (u.el.children[1].style.filter = `drop-shadow(0 0 8px ${u.color})`)
      );
    } else {
      units.forEach((u) => (u.el.children[1].style.filter = 'none'));

      // Apply any deferred Rally movement for the unit whose turn is
      // ending right now -- Rally marks where an "at the action line"
      // unit WILL move to instead of moving it immediately (see
      // performRally()); this is that deferred move actually landing,
      // now that its turn is genuinely over. Checked before the
      // corruption-increment block below since both key off the same
      // turnPendingUnit, and this one needs to run first (it reads/clears
      // pendingRallyMoves[turnPendingUnit.id], nothing downstream depends
      // on doing this in any other order).
      if (turnPendingUnit && pendingRallyMoves[turnPendingUnit.id]) {
        const { targetAngle, group } = pendingRallyMoves[turnPendingUnit.id];
        turnPendingUnit.angle = targetAngle;
        const p = polar(turnPendingUnit.radius, turnPendingUnit.angle);
        updateUnitTransform(turnPendingUnit, p.x, p.y, turnPendingUnit.angle);
        if (group && group.parentNode) group.remove();
        delete pendingRallyMoves[turnPendingUnit.id];
      }

      // This double-tap just resumed motion, meaning the player is
      // deliberately proceeding past whatever turn was sitting at the
      // action line. That's the moment player corruption auto-increments
      // — end of their turn, not the start of it.
      //
      // No separate saveState() here anymore -- markTurnBoundary() (in
      // tick(), when this unit first reached the line) already captured
      // a checkpoint for "before this player's turn," and that gets
      // committed to historyStack at the NEXT turn boundary, same as any
      // enemy turn. Adding an extra immediate saveState() here created a
      // SECOND, redundant checkpoint sitting on top of that one -- so
      // Undo had to be pressed twice for a player turn (once to pop this
      // near-duplicate and reveal barely any visible change, once more
      // to reach the actual earlier turn) while an enemy turn, which
      // never had this extra push, correctly needed only one press.
      // Removing it makes both cases undo with the same granularity: one
      // press reverts the player's entire last turn (arrival + corruption
      // increment) as a single step, landing on the previous turn.
      if (
        turnPendingUnit &&
        turnPendingUnit.id &&
        turnPendingUnit.id.startsWith('player_')
      ) {
        applyCorruptionDelta(1);
        refreshAllConsoles();
      }
      turnPendingUnit = null;

      // The overseer/inquisitor turn that just got dismissed was the one
      // that tripped the shared threshold (see tickInner's threshold
      // bookkeeping) -- NOW is when the ticker actually drops back to
      // "0/N", not the instant it hit max.
      if (overseerThresholdAwaitingReset) {
        overseerThresholdCount = 0;
        overseerThresholdAwaitingReset = false;
        refreshAllConsoles();
      }
    }
    dragging = null;
    lastTap = 0;
    return;
  }
  lastTap = now;

  if (!paused) return;

  if (bestChoice && closestDist < 60) {
    const stackedUnits = units.filter(
      (u) =>
        u.radius === bestChoice.radius &&
        Math.abs(u.angle - bestChoice.angle) < 1
    );

    // 1. If multiple units and NOT fanned yet: Fan them out and STOP.
    if (stackedUnits.length > 1 && !bestChoice.isFanned) {
      stackedUnits.forEach((u, i) => {
        u.isFanned = true;
        const offset = (i - (stackedUnits.length - 1) / 2) * 10;
        const p = polar(u.radius, u.angle + offset);
        updateUnitTransform(u, p.x, p.y, u.angle + offset);
        u.el.children[1].style.filter =
          'brightness(1.5) drop-shadow(0 0 8px white)';
      });
      return;
    }

    // 2. If we are here, we are DRAGGING (either a single unit or a fanned one).
    dragging = bestChoice;
    clearSpeedGhosts(); // defensive -- clears any stale ghosts left over from an interrupted previous drag

    // IMPORTANT: Reset the fanned state immediately so deletion math
    // is based on the actual ring radius, not the fanned offset.
    units.forEach((u) => (u.isFanned = false));

    // 3. Setup Drag Data
    // We need to know exactly where the unit was visually sitting when fanned
    const stacked = units.filter(
      (u) =>
        u.radius === dragging.radius && Math.abs(u.angle - dragging.angle) < 1
    );
    const fanIndex = stacked.indexOf(dragging);
    const fanOffset = (fanIndex - (stacked.length - 1) / 2) * 10;

    // Use the OFFSET angle for the starting visual position
    const visualP = polar(dragging.radius, dragging.angle + fanOffset);

    dragData = {
      startAngle: dragging.angle,
      currentPos: { ...visualP }, // Start where the dot ACTUALLY is visually
      lock: null,
      originX: tx,
      originY: ty,
    };

    // 4. Move to preview layer and capture pointer
    dragPreviewLayer.appendChild(dragging.el);
    controlRing.classList.add('dim-state');

    // This is vital for the 'radial' drag to work outside the ring boundaries
    ring.setPointerCapture(e.pointerId);
  }
});

window.addEventListener('pointermove', (e) => {
  if (castDrag) {
    const dist = Math.hypot(
      e.clientX - castDrag.startX,
      e.clientY - castDrag.startY
    );
    if (dist > 30) {
      // Successful "flick" to remove
      castDrag.cast.group.remove();
      activeCasts = activeCasts.filter((c) => c !== castDrag.cast);
      castDrag = null;
    }
  }

  if (!dragging) return;
  const rect = ring.getBoundingClientRect();
  const scale = 400 / Math.min(rect.width, rect.height);
  const x = (e.clientX - (rect.left + rect.width / 2)) * scale;
  const y = (e.clientY - (rect.top + rect.height / 2)) * scale;

  const currentRadius = Math.hypot(x, y);
  const currentAngle = getAngleFromXY(x, y);

  if (!dragData.lock) {
    const dx = x - dragData.originX;
    const dy = y - dragData.originY;
    const totalDist = Math.hypot(dx, dy);

    if (totalDist > 10) {
      // Check if the user is primarily moving in/out relative to the ring center
      const startR = Math.hypot(dragData.originX, dragData.originY);
      const radialMovement = Math.abs(currentRadius - startR);

      // Priority: If radial movement is significant, lock to radial (deletion path)
      if (radialMovement > 8) {
        dragData.lock = 'radial';
      } else {
        dragData.lock = 'tangential';
      }
    }
    return;
  }

  if (dragData.lock === 'radial') {
    // Use the angle where the drag ACTUALLY started (currentAngle at point of lock)
    // to prevent the dot from snapping to the center of the stack.
    if (!dragData.activeAngle) dragData.activeAngle = currentAngle;

    const rad = (dragData.activeAngle - 90) * DEG_TO_RAD;
    const ux = Math.cos(rad);
    const uy = Math.sin(rad);
    const dist = x * ux + y * uy;
    dragData.currentPos = { x: ux * dist, y: uy * dist };

    const radialDelta = dist - dragging.radius;
    if (radialDelta > dragging.radius * 0.25) {
      const s = 18;
      removeX.setAttribute(
        'd',
        `M ${dragData.currentPos.x - s} ${dragData.currentPos.y - s} L ${
          dragData.currentPos.x + s
        } ${dragData.currentPos.y + s} M ${dragData.currentPos.x - s} ${
          dragData.currentPos.y + s
        } L ${dragData.currentPos.x + s} ${dragData.currentPos.y - s}`
      );
      removeX.style.opacity = '1';
    } else {
      removeX.style.opacity = '0';
    }

    if (
      !dragging.anchored &&
      radialDelta < -20
    ) {
      const pct = Math.abs(radialDelta) / dragging.radius;
      let power = 0,
        kbAngle = 0;
      if (pct >= 0.6) {
        power = 3;
        kbAngle = 180;
      } else if (pct >= 0.45) {
        power = 2;
        kbAngle = 120;
      } else if (pct >= 0.3) {
        power = 1;
        kbAngle = 60;
      }

      if (power > 0) {
        const targetAngle = (dragData.startAngle - kbAngle + 360) % 360;
        const targetPos = polar(dragging.radius, targetAngle);
        ghost.setAttribute('cx', targetPos.x);
        ghost.setAttribute('cy', targetPos.y);
        ghost.style.opacity = '0.8';
        ghostArc.setAttribute(
          'd',
          `M ${dragData.currentPos.x} ${dragData.currentPos.y} A ${dragging.radius} ${dragging.radius} 0 0 0 ${targetPos.x} ${targetPos.y}`
        );
        ghostArc.style.opacity = '0.5';

        let boltsHtml = '';
        for (let i = 0; i < power; i++)
          boltsHtml += `<tspan x="0" dy="${i === 0 ? 0 : -22}">⚡</tspan>`;
        boltDisplay.innerHTML = boltsHtml;
        const boltBasePos = polar(dist + 25, dragData.startAngle);
        boltDisplay.setAttribute(
          'transform',
          `translate(${boltBasePos.x}, ${boltBasePos.y}) rotate(${dragData.startAngle})`
        );

        // TRD 2.1: real-time queue preview for knockback, same threshold
        // as the ring's own ghost dot above -- targetAngle is exactly
        // what pointerup would commit to dragging.angle if released now.
        queuePreviewOverride = {
          unitOverrides: { [dragging.id]: { angle: targetAngle } },
          extraRocks: [],
          trackedUnitIds: [dragging.id],
        };
      } else {
        ghost.style.opacity = '0';
        ghostArc.style.opacity = '0';
        boltDisplay.textContent = '';
        queuePreviewOverride = null;
      }
    } else {
      // Below the -20 knockback threshold, or the unit is anchored (per
      // TRD 2.1: "anchored units cannot be knocked back ... the drag
      // down knockback preview should do nothing for those units") --
      // either way no knockback is being previewed right now.
      queuePreviewOverride = null;
    }
  } else {
    dragData.currentPos = polar(dragging.radius, currentAngle);
    let angularDelta = currentAngle - dragData.startAngle;
    if (angularDelta > 180) angularDelta -= 360;
    if (angularDelta < -180) angularDelta += 360;
    if (dragging.anchored && angularDelta < 0) {
      angularDelta = 0;
      dragData.currentPos = polar(dragging.radius, dragData.startAngle);
    }
    const color = angularDelta > 0 ? '#27ae60' : '#eb5757';
    activeRadiusLine.setAttribute('x1', '0');
    activeRadiusLine.setAttribute('y1', '0');
    activeRadiusLine.setAttribute('x2', dragData.currentPos.x);
    activeRadiusLine.setAttribute('y2', dragData.currentPos.y);
    activeRadiusLine.style.opacity = '0.7';
    activeRadiusLine.setAttribute('stroke', color);
    if (Math.abs(angularDelta) >= 15) {
      const count = Math.min(3, Math.floor(Math.abs(angularDelta) / 15));
      chevronDisplay.textContent = (angularDelta > 0 ? '>' : '<').repeat(count);
      chevronDisplay.textContent = (angularDelta > 0 ? '>' : '<').repeat(count);
      chevronDisplay.setAttribute('fill', color);
      const tipAngle = currentAngle + (angularDelta > 0 ? 28 : -28);
      const pTip = polar(dragging.radius, tipAngle);
      const pDot = polar(dragging.radius, currentAngle);
      chevronPath.setAttribute(
        'd',
        angularDelta > 0
          ? `M ${pDot.x} ${pDot.y} A ${dragging.radius} ${dragging.radius} 0 0 1 ${pTip.x} ${pTip.y}`
          : `M ${pTip.x} ${pTip.y} A ${dragging.radius} ${dragging.radius} 0 0 1 ${pDot.x} ${pDot.y}`
      );

      // Speed Preview: candidateSpeedMult is the STACKED total this drag
      // would produce if released now -- this drag's own tier (from its
      // OWN angularDelta, same as always) ADDED to whatever tiers
      // `dragging` already has active (TRD: "if it already has that
      // boost... they should add together"), not a standalone value
      // computed as if dragging had no prior modifier. Both the ring
      // ghost dots and the queue preview below use this same combined
      // total, so they always show exactly what pointerup would commit.
      const signedCount = angularDelta > 0 ? count : -count;
      const existingTier = dragging.speedModifiers.reduce((sum, m) => sum + m.tier, 0);
      const candidateSpeedMult = speedMultForTotalTier(existingTier + signedCount);
      updateSpeedGhosts(dragging, candidateSpeedMult);

      // TRD 2.2: real-time queue preview for speed up/slow down, same
      // count/threshold math as the ghost dots above and as pointerup's
      // own commit below.
      queuePreviewOverride = {
        // The candidate modifier list is dragging's EXISTING tiers
        // (unaffected, each still counting down from whenever IT was
        // applied) plus this drag's own NEW tier with a fresh 360 --
        // matches addSpeedModifier() exactly, since that's what
        // pointerup's commit calls with this same signedCount if
        // released right now.
        unitOverrides: {
          [dragging.id]: { speedModifiers: [...dragging.speedModifiers, { tier: signedCount, remaining: 360 }] },
        },
        extraRocks: [],
        trackedUnitIds: [dragging.id],
      };
    } else {
      chevronDisplay.textContent = '';
      clearSpeedGhosts();
      queuePreviewOverride = null;
    }
  }
});

window.addEventListener('pointerup', () => {
  if (!dragging) return;
  const x = dragData.currentPos.x;
  const y = dragData.currentPos.y;
  const currentRadius = Math.hypot(x, y);
  const radialDelta = currentRadius - dragging.radius;

  if (dragData.lock === 'radial') {
    if (radialDelta > dragging.radius * 0.25) {
      saveState();
      removeCastsForUnit(dragging);
      dragging.el.remove();
      units = units.filter((u) => u !== dragging);

      // If this was a guardian, keep console/dot state in sync — same
      // outcome as pressing that guardian's skull button.
      if (dragging.id && dragging.id.startsWith('guardian_')) {
        const pNum = Number(dragging.id.split('_')[1]);
        if (guardianAssignment[pNum]) {
          creditGuardianDefeatToCurrentTurnPlayer();
          guardianAssignment[pNum].defeated = true;
          refreshAllConsoles();
          checkVictory();
        }
      } else if (dragging.id && dragging.id.startsWith('player_')) {
        // Player death -- this drag-off-the-ring gesture is the concrete
        // removal mechanism today. Any future automated cause (a status
        // effect like burn dealing lethal damage on its own turn, say)
        // should remove that player's unit the same way and call this
        // same handler.
        handlePlayerRemovedFromCombat(dragging);
      }
    } else if (
      radialDelta < -20 &&
      !dragging.anchored
    ) {
      const pct = Math.abs(radialDelta) / dragging.radius;
      let kbAngle = 0;
      if (pct >= 0.6) kbAngle = 180;
      else if (pct >= 0.45) kbAngle = 120;
      else if (pct >= 0.3) kbAngle = 60;
      if (kbAngle > 0) {
        saveState();
        knockback = {
          unit: dragging,
          from: dragData.startAngle,
          to: (dragData.startAngle - kbAngle + 360) % 360,
          startTime: performance.now(),
        };
      }
    }
  } else if (dragData.lock === 'tangential') {
    let angularDelta = getAngleFromXY(x, y) - dragData.startAngle;
    if (angularDelta > 180) angularDelta -= 360;
    if (angularDelta < -180) angularDelta += 360;
    if (dragging.anchored && angularDelta < 0) angularDelta = 0;
    if (Math.abs(angularDelta) >= 15) {
      saveState();
      const count = Math.min(3, Math.floor(Math.abs(angularDelta) / 15));
      // Stacks onto whatever tiers dragging already has active (TRD: a
      // 1-tier boost followed by a 2-tier boost should combine into a
      // 3-tier boost) rather than replacing them outright -- each tier
      // still expires independently after its OWN 360 degrees of travel
      // (see addSpeedModifier/advanceSpeedModifiers).
      addSpeedModifier(dragging, angularDelta > 0 ? count : -count);
      refreshPendingTurnSnapshot();
    }
  }

  dragging = null;
  controlRing.classList.remove('dim-state');
  activeRadiusLine.style.opacity = '0';
  removeX.style.opacity = '0';
  ghost.style.opacity = '0';
  ghostArc.style.opacity = '0';
  clearSpeedGhosts(); // finger lifted -- the forecast goes with it, per spec
  // Same for the queue preview (TRD 2.1/2.2): whether this pointerup
  // just committed a knockback/speedMult change (in which case the
  // committed forecast below will already reflect it -- immediately for
  // speedMult, after the ~300ms knockback ease for angle, since the
  // queue always reads the unit's REAL current angle) or aborted one,
  // the live preview itself is over either way.
  queuePreviewOverride = null;
  clearQueuePreviewOverlay();
  chevronDisplay.textContent = '';
  boltDisplay.textContent = '';
  units.forEach((u) => {
    u.isFanned = false; // RELEASE THE LOCK

    const p = polar(u.radius, u.angle);
    updateUnitTransform(u, p.x, p.y, u.angle);

    if (!paused) {
      u.el.children[1].style.filter = 'none';
    } else {
      u.el.children[1].style.filter = `drop-shadow(0 0 8px ${u.color})`;
    }
  });
  // Move unit back to default layer if it wasn't deleted
  units.forEach((u) => {
    if (u.el.parentNode === dragPreviewLayer) {
      unitLayer.appendChild(u.el);
    }
  });
  dragging = null;
});

document.getElementById('group-star').addEventListener('pointerdown', (e) => {
  e.stopPropagation();

  // Clicking center while some OTHER mode is active (rock/anchor select)
  // cancels that mode, same as before. Being already in RALLY_PREVIEW is
  // NOT one of those cases -- pressing this button again while a rally
  // preview is showing is what stacks another share onto it (TRD 2.4),
  // not a cancel.
  if (appState !== 'IDLE' && appState !== 'RALLY_PREVIEW') {
    resetToIdle();
    const sg = document.getElementById('spoke-group');
    if (sg) sg.innerHTML = '';
    return;
  }

  // Find unit exactly at the 0 degree mark (with 5 degree tolerance) --
  // same detection the cast flow used.
  const unitAtTurn = units.find((u) => {
    const diff = (u.angle + 360) % 360;
    return diff < 5 || diff > 355;
  });
  if (!unitAtTurn) return;

  // Enemy turn: unchanged immediate-apply behavior, no preview -- TRD
  // 2.4's own "things are different if it is an enemy turn" carve-out,
  // already exactly how this worked before this pass.
  if (unitAtTurn.id.startsWith('guardian_')) {
    performRally(unitAtTurn);
    return;
  }

  // Player turn: TRD 2.4 preview. First press starts it (captures every
  // group unit's CURRENT angle as the stacking base); a press while
  // already previewing just increments the share multiplier instead of
  // restarting from a moved baseline.
  if (!pendingRallyPreview || pendingRallyPreview.unitAtTurnId !== unitAtTurn.id) {
    const isPlayerTurn = unitAtTurn.id.startsWith('player_');
    const groupUnits = units.filter((u) =>
      isPlayerTurn ? u.id.startsWith('player_') : u.id.startsWith('guardian_')
    );
    // For the at-turn unit specifically: if an EARLIER real Rally was
    // already committed this same turn (a genuine `pendingRallyMoves`
    // entry exists), the preview's own base has to start from THAT
    // already-committed target, not from the unit's raw (still ~0°)
    // `.angle` -- otherwise a brand-new preview session started after
    // an already-committed Rally showed less total movement than it
    // should have, ignoring the earlier commit entirely. Every other
    // group unit already moved for real on that earlier commit, so
    // their own live `.angle` is already correct as a base.
    const baseAngles = new Map(
      groupUnits.map((u) => [
        u.id,
        u === unitAtTurn && pendingRallyMoves[u.id] ? pendingRallyMoves[u.id].targetAngle : u.angle,
      ])
    );
    pendingRallyPreview = { unitAtTurnId: unitAtTurn.id, shareMultiplier: 1, baseAngles };
  } else {
    pendingRallyPreview.shareMultiplier++;
  }
  appState = 'RALLY_PREVIEW';
  updateRallyPreview();
});

// Moves every unit of whichever type (player_ or guardian_) unitAtTurn
// belongs to forward by an equal share of RALLY_TOTAL_DEGREES. Every unit
// OTHER than unitAtTurn itself moves right away; unitAtTurn's own share
// is deferred to a marker (see pendingRallyMoves) since per spec the unit
// actually on the action line doesn't move until its turn ends.
// Distributes `totalDegrees` of Rally movement across a group, capping
// any unit at just-before-the-action-line (see performRally's own
// comment on why overshooting the line at all breaks turn order) --
// WITHOUT simply discarding whatever a capped unit couldn't use. A user
// asked for this directly: the degrees a unit can't use because it
// started too close to the line shouldn't be "burnt" -- they should go
// to teammates who can still use them.
//
// This is a water-filling distribution: repeatedly compute the average
// share across whoever's still uncapped, cap anyone whose own headroom
// (360 - their current angle) is below that average at exactly their
// headroom, and feed the leftover back into a recomputed (larger)
// average for the rest, until everyone remaining can absorb the current
// average in full. A unit's headroom shrinking as this iterates would
// only happen if it were credited with movement more than once, which
// it isn't -- headroom is fixed per unit for the whole call, so this
// always terminates (each iteration caps at least one more unit, or
// finishes).
//
// `unitsWithAngles` -- [{ id, angle }], every group member's angle
//   BEFORE this share is applied.
// Returns [{ id, angle, target }] -- target is the final post-rally
// angle, already staggered below 360 (never exactly at/past it) for any
// unit that got fully capped, using the user's own specified tiebreak:
// whichever unit was CLOSEST TO THE LINE BEFORE this rally (largest
// original angle -- i.e. would have reached it first pre-boost) is
// staggered closest to the line among any that tie.
function computeRallyTargets(unitsWithAngles, totalDegrees) {
  let active = unitsWithAngles.map((u) => ({ id: u.id, angle: u.angle, headroom: 360 - u.angle }));
  const assignedShare = new Map();
  let remaining = totalDegrees;

  while (active.length > 0) {
    const avg = remaining / active.length;
    const capped = active.filter((u) => u.headroom <= avg + 1e-9);
    if (capped.length === 0) {
      active.forEach((u) => assignedShare.set(u.id, avg));
      break;
    }
    capped.forEach((u) => {
      assignedShare.set(u.id, u.headroom);
      remaining -= u.headroom;
    });
    active = active.filter((u) => !capped.some((c) => c.id === u.id));
  }

  const raw = unitsWithAngles.map((u) => ({
    id: u.id,
    angle: u.angle,
    target: u.angle + (assignedShare.get(u.id) || 0),
  }));

  // Water-filling caps a unit at EXACTLY its headroom (target === 360),
  // never past it -- so "landed at the line" and "needs staggering" are
  // the same condition here, unlike the old per-pass overshoot check
  // this replaced.
  const atLine = raw.filter((r) => r.target >= 360 - 1e-6).sort((a, b) => b.angle - a.angle);
  atLine.forEach((r, i) => {
    r.target = 360 - RALLY_LINE_CLAMP_STEP * (i + 1);
  });

  return raw;
}

function performRally(unitAtTurn) {
  const isPlayerTurn = unitAtTurn.id.startsWith('player_');
  const groupUnits = units.filter((u) =>
    isPlayerTurn ? u.id.startsWith('player_') : u.id.startsWith('guardian_')
  );
  if (groupUnits.length === 0) return;

  saveState();

  const unitsWithAngles = groupUnits.map((u) => {
    if (u === unitAtTurn) {
      // If this unit already has a pending Rally move (a previous press
      // this same turn), stack on top of it instead of recomputing from
      // the unit's own (unmoved, still ~0°) angle.
      const existing = pendingRallyMoves[u.id];
      return { id: u.id, angle: existing ? existing.targetAngle : u.angle };
    }
    return { id: u.id, angle: u.angle };
  });

  const targets = computeRallyTargets(unitsWithAngles, RALLY_TOTAL_DEGREES);
  const targetById = new Map(targets.map((t) => [t.id, t.target]));

  groupUnits.forEach((u) => {
    const target = targetById.get(u.id);
    if (u === unitAtTurn) {
      const existing = pendingRallyMoves[u.id];
      if (existing && existing.group && existing.group.parentNode) {
        existing.group.remove();
      }
      // A user found this: when the water-filling distribution above
      // leaves this unit with only a sliver of headroom to actually use
      // (its own angle and its target end up nearly identical -- e.g.
      // several OTHER dots in a shared group already soaked up most of
      // the 90-degree budget, or repeated stacking left this unit with
      // almost nothing left before the line), the resulting marker is a
      // near-zero-length arc with a flag sitting right at the action
      // line -- visually present but showing no meaningful movement.
      // Below a small threshold, skip creating a new marker (and don't
      // record a pending move at all -- there's genuinely nothing useful
      // to defer) rather than leave a marker up that "serves no
      // purpose."
      const MEANINGFUL_RALLY_DEGREES = 3;
      if (target - u.angle < MEANINGFUL_RALLY_DEGREES) {
        delete pendingRallyMoves[u.id];
      } else {
        // Arc is still drawn from the unit's TRUE current angle (u.angle,
        // ~0 -- it hasn't actually moved yet) to the new CUMULATIVE
        // (post-clamp) target, not from the old target to the new one --
        // so a second Rally visually extends the same line further and
        // moves the flag to the new endpoint, rather than drawing a
        // second, disconnected arc.
        const marker = createRallyMarker(u, target);
        pendingRallyMoves[u.id] = { targetAngle: target, group: marker };
      }
    } else {
      u.angle = target;
      const p = polar(u.radius, u.angle);
      updateUnitTransform(u, p.x, p.y, u.angle);
    }
  });
  refreshPendingTurnSnapshot();
}

// The "you'll land here" marker for whichever unit's Rally motion is
// deferred -- a dashed arc from its current position to where it'll
// move, capped with a flag, matching the button's own new icon. Purely
// decorative/non-interactive (no drag-to-remove the way a cast star has)
// -- it clears itself the moment the deferred move actually lands (see
// the double-tap-to-resume handler).
function createRallyMarker(unit, endAngle) {
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.style.pointerEvents = 'none';

  const arc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arc.setAttribute('d', arcPath(unit.radius, unit.angle, endAngle));
  arc.setAttribute('stroke', unit.color);
  arc.setAttribute('stroke-width', '4');
  arc.setAttribute('stroke-dasharray', '6 5');
  arc.setAttribute('fill', 'none');
  arc.style.opacity = '0.75';
  group.appendChild(arc);

  const flag = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  const p = polar(unit.radius, endAngle);
  flag.setAttribute('x', p.x);
  flag.setAttribute('y', p.y);
  flag.setAttribute('font-size', '20');
  flag.setAttribute('text-anchor', 'middle');
  flag.setAttribute('dominant-baseline', 'central');
  flag.textContent = '\u{1F6A9}';
  group.appendChild(flag);

  dragPreviewLayer.appendChild(group);
  return group;
}

function renderSpokes(unit) {
  let spokeGroup = document.getElementById('spoke-group');
  if (!spokeGroup) {
    spokeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    spokeGroup.id = 'spoke-group';
    document.getElementById('drag-preview-layer').appendChild(spokeGroup);
  }
  spokeGroup.innerHTML = '';

  // Define where the unit is (Inner vs Outer ring)
  const isInner = unit.radius < 140;
  const targetRadius = isInner ? 100 : 175; // Offset spokes so they are easy to click
  const angles = [30, 60, 90];

  angles.forEach((deg) => {
    const spoke = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'circle'
    );
    const p = polar(targetRadius, deg);

    spoke.setAttribute('cx', p.x);
    spoke.setAttribute('cy', p.y);
    spoke.setAttribute('r', '15');
    spoke.setAttribute('fill', unit.color);
    spoke.setAttribute('stroke', 'white');
    spoke.setAttribute('stroke-width', '2');
    spoke.style.cursor = 'pointer';
    spoke.style.filter = 'drop-shadow(0 0 4px rgba(0,0,0,0.5))';

    // IMPORTANT: Use pointerdown to trigger the cast
    spoke.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      createCastLine(unit, deg);
      spokeGroup.innerHTML = '';
      appState = 'IDLE'; // Reset state after casting
    });

    spokeGroup.appendChild(spoke);
  });
}

function createCastLine(unit, endAngle, skipSave = false) {
  if (!skipSave) saveState();
  const isInner = unit.radius === 130;
  // Stack offset: count how many casts already exist on this ring
  const stackOffset =
    activeCasts.filter((c) => c.radius === unit.radius).length * 6;
  const displayRadius = isInner
    ? 130 - 15 - stackOffset
    : 150 + 15 + stackOffset;

  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute('d', arcPath(displayRadius, 0, endAngle));
  line.setAttribute('stroke', unit.color);
  line.setAttribute('stroke-width', '8');
  line.setAttribute('fill', 'none');
  line.style.opacity = '0.6';

  const star = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  const p = polar(displayRadius, endAngle);
  star.setAttribute('x', p.x);
  star.setAttribute('y', p.y);
  star.setAttribute('font-size', '20');
  star.setAttribute('text-anchor', 'middle');
  star.setAttribute('dominant-baseline', 'central');
  star.textContent = '⭐';
  star.style.cursor = 'grab';

  // Drag-to-destroy logic
  star.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    castDrag = { cast, startX: e.clientX, startY: e.clientY };
    star.setPointerCapture(e.pointerId);
  });

  group.appendChild(line);
  group.appendChild(star);
  unitLayer.appendChild(group);

  const cast = { unit, endAngle, group, star, radius: unit.radius };
  activeCasts.push(cast);
}

function tick(time) {
  try {
    tickInner(time);
  } catch (err) {
    // A thrown error here used to permanently kill the whole animation
    // loop — this function is the ONLY thing that re-schedules itself via
    // requestAnimationFrame, so one bad frame meant every unit visually
    // froze in place forever (matches the "player icon freezes, a new
    // duplicate dot appears" symptom: the frozen icon is the last frame
    // that rendered successfully; the "new dot" is a freshly-created unit
    // element that was appended but never got its first position update
    // because the very same frame threw before reaching that unit).
    // Logging and continuing next frame is a safety net on top of the
    // actual fixes (state now resets properly between combats, and undo
    // no longer produces the mismatched/duplicate units that could have
    // triggered this) — not a substitute for them.
    console.error('combat tick() error (recovered, continuing):', err);
  }
  requestAnimationFrame(tick);
}

function tickInner(time) {
  const dt = time - lastTime;
  lastTime = time;

  if (!paused && units.length > 0) {
    let finisher = null;
    let minTimeToFinish = Infinity;

    units.forEach((u) => {
      const currentSpeed = u.speed * u.speedMult;
      if (currentSpeed <= 0) return;

      // Check for rocks blocking this unit -- a timed obstacle now, not a
      // health pool, so hitting it just blocks movement; it no longer
      // takes damage from being run into (see ROCK_DURATION_MS's comment
      // for the full rationale).
      let move = dt * currentSpeed;
      let blocked = false;
      rocks.forEach((r) => {
        if (r.radius === u.radius) {
          let diff = (r.angle - u.angle + 360) % 360;
          if (diff < move && diff > -2) {
            blocked = true;
          }
        }
      });

      if (!blocked) {
        let distToFinish = 360 - u.angle;
        if (distToFinish <= 0) distToFinish += 360;
        const timeToFinish = distToFinish / currentSpeed;
        if (timeToFinish <= dt && timeToFinish < minTimeToFinish) {
          minTimeToFinish = timeToFinish;
          finisher = u;
        }
      }
    });

    if (finisher) {
      const actualDT = minTimeToFinish;

      // Whether THIS crossing should pass through without stopping the
      // clock -- only possible for an overseer dot, and only while fewer
      // than overseerThresholdTarget of them have crossed since the last
      // activation. Computed before the movement below (which is
      // unconditional either way) so both branches after it can just
      // read this flag.
      const isOverseerPassThrough =
        finisher.isOverseerDot &&
        overseerThresholdCount + 1 < overseerThresholdTarget;

      // NOTE: corruption no longer auto-increments here. Reaching the
      // action line marks the START of this unit's turn, not the end of
      // it — incrementing here would raise corruption before the player
      // has had a chance to act. Instead we just remember who's up, and
      // the actual increment happens when the player double-taps to
      // proceed past this turn (see the tap handler below). Skipped
      // entirely for a pass-through crossing, since that isn't a turn at
      // all -- just a dot completing a lap toward the shared threshold.
      if (!isOverseerPassThrough) {
        turnPendingUnit = finisher;
        // Run-wide stat: "which player had the most turns," defined as
        // whose own dot reached the action line the most. Only a real,
        // stopping turn counts -- a pass-through crossing (skipped by
        // this same isOverseerPassThrough guard) isn't a turn at all.
        if (finisher.id.startsWith('player_')) {
          const pNum = Number(finisher.id.split('_')[1]);
          recordPlayerTurn(pNum - 1); // gameState's players array is 0-indexed; pNum is 1-indexed
        }
      }

      const allFinishers = units.filter((u) => {
        const currentSpeed = u.speed * u.speedMult;
        if (currentSpeed <= 0) return false;
        let dist = 360 - u.angle;
        if (dist <= 0) dist += 360;
        return dist / currentSpeed <= actualDT + 0.001; // Small epsilon for float precision
      });

      if (!isOverseerPassThrough) {
        if (allFinishers.length > 1) {
          setTurnIndicator(finisher); // primary finisher's indicator covers this rare simultaneous case
        } else {
          setTurnIndicator(finisher);
        }
      }
      units.forEach((u) => {
        const currentSpeed = u.speed * u.speedMult;
        let move = actualDT * currentSpeed;

        // Final re-check for blocks during finish slice
        let blocked = false;
        rocks.forEach((r) => {
          if (r.radius === u.radius) {
            let diff = (r.angle - u.angle + 360) % 360;
            if (diff < move && diff > -2) blocked = true;
          }
        });

        if (!blocked) {
          activeCasts.forEach((cast, index) => {
            if (cast.unit === u) {
              // Check if unit has reached or passed the star
              if (u.angle >= cast.endAngle && u.angle < cast.endAngle + 5) {
                u.angle = cast.endAngle;
                setPaused(true);

                // Visual Feedback
                setTurnIndicator(u);

                // Toggle the darker background stars
                const bgStarLeft = document.getElementById('bg-star-left');
                const bgStarRight = document.getElementById('bg-star-right');
                if (bgStarLeft && bgStarRight) {
                  // Set star color to a slightly darker version or semi-transparent black
                  bgStarLeft.style.fill = 'rgba(0,0,0,0.15)';
                  bgStarRight.style.fill = 'rgba(0,0,0,0.15)';
                  bgStarLeft.style.opacity = '1';
                  bgStarRight.style.opacity = '1';
                }

                // Cleanup cast
                cast.group.remove();
                activeCasts.splice(index, 1);
              }
            }
          });

          u.angle = (u.angle + move) % 360;
          if (u.anchored) {
            u.anchorDist += Math.abs(move);
            if (u.anchorDist >= 360) {
              u.anchored = false;
              u.anchorIndicator.style.opacity = '0';
            }
          }
          advanceSpeedModifiers(u, Math.abs(move));
        }
      });

      // Threshold bookkeeping -- only overseer dots ever touch this
      // counter. Incrementing happens for EVERY overseer crossing
      // (pass-through or not); it's what isOverseerPassThrough above was
      // computed from (whether THIS crossing would still leave the
      // counter under target). Once it reaches target, the crossing that
      // trips it falls through to the normal stop behavior below, same as
      // any other enemy turn -- but the counter itself stays AT target
      // (showing e.g. "2/2" on the ticker) rather than snapping back to 0
      // immediately; overseerThresholdAwaitingReset flags that the reset
      // is owed, and the double-tap-to-resume handler applies it once
      // this activation turn is actually dismissed. Resetting here
      // instead would have zeroed the ticker before the player ever saw
      // it reach max.
      if (finisher.isOverseerDot) {
        overseerThresholdCount++;
        if (overseerThresholdCount >= overseerThresholdTarget) {
          overseerThresholdAwaitingReset = true;
        }
        refreshAllConsoles(); // updates the X/Y ticker on every console
      }

      finisher.angle = 0;

      if (isOverseerPassThrough) {
        // Dot passes straight through the action line and keeps going --
        // no pause, no turn indicator, no turn-boundary checkpoint. The
        // very next animation frame just re-evaluates finishers fresh,
        // this dot included, now starting its next lap from angle 0. See
        // module-level comment on overseerThresholdCount for the overall
        // rule.
      } else {
        // This crossing IS the real, shared turn (Overseer activation or
        // Inquisitor turn) -- for a player unit finishing normally, it's
        // just an ordinary player turn. The isOrdealCombat check below is
        // deliberately paired with finisher.isOverseerDot: isOrdealCombat
        // alone is true for the WHOLE combat, including every ordinary
        // player turn, so without the isOverseerDot check here the
        // Ordeal's turn clock was advancing on every player's turn too,
        // not just the Inquisitor's (bug: turns were decrementing far
        // faster than intended). Only an Inquisitor dot's crossing should
        // ever advance ordealState.
        if (isOrdealCombat && finisher.isOverseerDot) {
          ordealState.turnsElapsed++;
          ordealState.corruption +=
            ordealState.incrementalCorruptionPerPlayer * ordealState.numPlayers;
          refreshAllConsoles(); // updates the white dot's rounds-remaining/corruption
          if (ordealState.turnsElapsed > ordealState.turnsAllowed) {
            triggerOrdealFailure();
            return;
          }
        }
        setPaused(true);
        // Uses markTurnBoundary() (deferred push -- see its own comment
        // above) instead of saveState() (immediate push). The snapshot is
        // still captured right here, AFTER finisher.angle=0 is assigned, so
        // it accurately reflects the unit genuinely sitting at the line
        // (fixing the earlier "undo rewinds to just before the line" bug)
        // -- but it isn't added to historyStack until the NEXT turn
        // boundary arrives, which is what actually makes Undo step
        // backward through turns correctly instead of re-confirming the
        // turn already on screen.
        markTurnBoundary();
        units.forEach(
          (u) =>
            (u.el.children[1].style.filter = `drop-shadow(0 0 8px ${u.color})`)
        );
      }
    } else {
      units.forEach((u) => {
        const currentSpeed = u.speed * u.speedMult;
        let move = dt * currentSpeed;
        let blocked = false;
        rocks.forEach((r) => {
          if (r.radius === u.radius) {
            let diff = (r.angle - u.angle + 360) % 360;
            if (diff < move && diff > -2) blocked = true;
          }
        });

        if (!blocked) {
          // Check for Star/Cast collisions BEFORE moving
          const currentSpeed = u.speed * u.speedMult;
          let move = dt * currentSpeed;

          activeCasts.forEach((cast, index) => {
            if (cast.unit === u) {
              // Calculate distance to star
              let distToStar = (cast.endAngle - u.angle + 360) % 360;

              // If we would hit or pass the star in this frame
              if (distToStar <= move + 0.1 || distToStar < 0.5) {
                u.angle = cast.endAngle;
                move = 0;
                setPaused(true);

                // 1. Update main background colors
                setTurnIndicator(u);

                // 2. Handle the background stars
                const bgStarLeft = document.getElementById('bg-star-left');
                const bgStarRight = document.getElementById('bg-star-right');

                if (bgStarLeft && bgStarRight) {
                  // Instead of fixed black, use a darker version of the unit color
                  // or a high-contrast white/black with low opacity
                  bgStarLeft.style.fill = 'rgba(255, 255, 255, 0.2)';
                  bgStarRight.style.fill = 'rgba(255, 255, 255, 0.2)';
                  bgStarLeft.style.opacity = '1';
                  bgStarRight.style.opacity = '1';

                  // Optional: Add a "pop" animation class if you have CSS for it
                  bgStarLeft.classList.add('pulse-animation');
                }

                showLargeCenterStar(u.color);

                cast.group.remove();
                activeCasts.splice(index, 1);
              }
            }
          });

          u.angle = (u.angle + move) % 360;

          if (u.anchored) {
            u.anchorDist += Math.abs(move);
            if (u.anchorDist >= 360) {
              u.anchored = false;
              u.anchorIndicator.style.opacity = '0';
            }
          }
          advanceSpeedModifiers(u, Math.abs(move));
        }
      });
    }

    // Cleanup expired rocks -- counted down in GAME time (dt, only while
    // unpaused; see remainingMs's own comment on createRock for why not
    // wall-clock time), not a health pool: once ROCK_DURATION_MS worth of
    // actual unpaused time has elapsed since placement, it's gone
    // regardless of how many units it blocked (or didn't) in the
    // meantime.
    rocks.forEach((r) => {
      r.remainingMs -= dt;
    });
    rocks = rocks.filter((r) => {
      if (r.remainingMs <= 0) {
        r.el.remove();
        return false;
      }
      return true;
    });
  }

  units.forEach((u) => {
    // 1. If it's fanned out (but NOT the one we started dragging), leave it alone
    if (u.isFanned && dragging !== u) return;

    let x, y;
    let faceAngle;

    if (dragging === u) {
      // 2. If this is the dragging unit, use the live drag coordinates
      x = dragData.currentPos.x;
      y = dragData.currentPos.y;
      faceAngle = Math.atan2(y, x) * (180 / Math.PI) + 90;
    } else {
      // 3. Otherwise, use the standard orbital math
      let ang = u.angle;
      if (knockback && knockback.unit === u) {
        const t = Math.min((time - knockback.startTime) / 300, 1);
        const ease = 1 - (1 - t) * (1 - t);
        ang = knockback.from + (knockback.to - knockback.from) * ease;
        if (t >= 1) {
          u.angle = knockback.to;
          knockback = null;
          refreshPendingTurnSnapshot();
        }
      }
      const p = polar(u.radius, ang);
      x = p.x;
      y = p.y;
      faceAngle = ang;
    }

    // 4. Apply the calculated position
    updateUnitTransform(u, x, y, faceAngle);

    u.statusRing.setAttribute(
      'stroke',
      u.speedMult > 1 ? '#27ae60' : u.speedMult < 1 ? '#eb5757' : 'none'
    );
  });

  // Simulation Snapshot mode is a purely visual freeze (TRD 3.1) -- once
  // the game actually moves forward again (unpaused), its "Clear
  // Protocol" says to wipe it, same as a second tap or an empty-zone tap
  // (see clearQueueSnapshotSelection's other call site on the ring's own
  // pointerdown handler).
  if (!paused) clearQueueSnapshotSelection();

  updateSpeedQueueDisplay();
}

function showLargeCenterStar(color) {
  const star = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  star.setAttribute('font-size', '60');
  star.setAttribute('text-anchor', 'middle');
  star.setAttribute('dominant-baseline', 'central');
  star.setAttribute('fill', color);
  star.textContent = '⭐';
  star.style.pointerEvents = 'none';
  star.style.transition = 'opacity 0.8s, transform 0.8s';
  gameWorld.appendChild(star);

  setTimeout(() => {
    star.style.opacity = '0';
    star.style.transform = 'scale(2)';
    setTimeout(() => star.remove(), 800);
  }, 100);
}

requestAnimationFrame(tick);

// --- PHASE ENTRY POINT ---
// Called by the shell when gameState.phase becomes 'COMBAT'. Replaces the
// old flow where combat always started by showing its own orientation
// screen -- orientation is already fixed by the time this fires (set back
// in phase a., read via getPlayerPosition/PLAYER_CHARACTERS above), so
// combat goes straight to enemy declaration for the ring the map handed off.
export function startCombatPhase() {
  const { pendingCombat } = getState();
  if (!pendingCombat) {
    console.warn('startCombatPhase called with no pendingCombat in gameState');
    return;
  }
  PLAYER_CHARACTERS = buildPlayerCharacters();
  // Fire off preloading immediately, before any console has actually
  // rendered a single icon -- see the preloader's own comment above for
  // why this is what actually fixes the "icons sometimes don't load
  // during combat" symptom for any of these that DO exist as real files.
  preloadImages([
    ...Object.values(PLAYER_CHARACTERS).map((c) => c.icon),
    '/consumeicon.png',
    '/tainticon.png',
    '/corruption-level-3.png',
    '/corruption-level-4.png',
  ]);
  guardianAssignment = {};
  fiendAssignment = {};
  beginDeclaration(pendingCombat.ring, pendingCombat.nodeType);
}
