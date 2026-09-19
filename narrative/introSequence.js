// narrative/introSequence.js
//
// Implements the intro-sequence TRD (see intro-narrative-sequence-TRD.md)
// as an on-demand overlay rather than a first-launch flow — per spec, the
// "on first launch" trigger was dropped. installNarrativeTrigger() adds
// one small book-icon button that a player can tap to replay the
// sequence; it plays as a full-screen overlay and simply closes back to
// whatever was underneath on completion or Skip.
//
// VISIBILITY IS DELIBERATELY NOT THIS MODULE'S CALL: per spec, the button
// may only appear on the opening ring/vortex screen, before character
// select — never during map or combat, and not even during the later
// steps of orientation (character select, seat/edge picking). This
// module just exposes showNarrativeTrigger()/hideNarrativeTrigger() as
// plain visibility toggles; the CALLERS who actually know which sub-step
// is active are responsible for calling them at the right time:
//   - index.html's gameState subscribe callback hides it the instant
//     `phase` leaves 'ORIENTATION' (covers MAP/COMBAT, and also covers a
//     mid-run page refresh that restores straight into MAP — see that
//     file's own comment, since initOrientationPhase() unconditionally
//     re-runs on every load regardless of which phase gets restored).
//   - orientation/select.js calls hideNarrativeTrigger() the moment the
//     player double-taps the ring and transitionToCharSelect() runs,
//     since 'ORIENTATION' alone isn't a fine-grained enough phase to
//     distinguish "still on the ring" from "already at character select"
//     — that distinction only exists as select.js's own local
//     currentAppState, which this module has no visibility into.
// There is deliberately no code path that re-shows the button once
// hidden within the same page life — the only way back to the ring
// screen is the full page reload that defeat/victory already trigger
// (see gameState.js's resetRun() callers), which re-runs this module
// from scratch and defaults the button back to visible.
//
// Self-contained: call installNarrativeTrigger() exactly once from the
// shell's own top-level script (index.html), same pattern as
// installPlatformHardening() and initOrientationPhase(). Everything else
// here is module-private.

import { NARRATIVE_SCREENS } from './narrativeContent.js';

// --- Timing (TRD §5) ---------------------------------------------------
const READING_WPM = 200;
const PRE_ROLL_MS = 1500;   // image alone, no text, before each screen's text fades in
const POST_ROLL_MS = 2000;  // text held after the reading estimate completes
const MIN_SCREEN_MS = 6000; // floor, so the short screens (e.g. the Fall) aren't a flash
const TEXT_FADE_IN_MS = 400;
const TEXT_FADE_OUT_MS = 300;
const IMAGE_CROSSFADE_MS = 700;

function screenDurationMs(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const readMs = (words / READING_WPM) * 60000;
  return Math.max(MIN_SCREEN_MS, PRE_ROLL_MS + readMs + POST_ROLL_MS);
}

// --- Styles (injected once, lazily — no need to pay for this until the
// first time someone actually opens the sequence) ----------------------
let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .narrative-trigger-btn {
      position: fixed;
      /* Bottom-left, per the request. NOTE for design: this is the same
         literal corner combat/map's player-0-style corner HUDs can occupy
         (see layoutConstants.js CORNER_CSS['bottom-left']) — on a 4-player
         MAP/COMBAT screen this button will sit near/over that corner's
         HUD. Left as-is since it's small (48px) and sits at a higher
         z-index than any HUD (45) or console; flag if design wants it
         moved to a dead zone (e.g. screen-edge midpoint) instead of a
         true corner once real 4-player screens are checked visually. */
      bottom: 14px;
      left: 14px;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.35);
      background: rgba(11, 7, 6, 0.72);
      color: #e8ddb5;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 200; /* above player HUDs (45) and consoles, below the overlay (100000) */
      cursor: pointer;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      padding: 0;
    }
    .narrative-trigger-btn:active {
      background: rgba(11, 7, 6, 0.9);
      transform: scale(0.94);
    }
    .narrative-trigger-btn svg { width: 24px; height: 24px; display: block; }
    /* Must come after the base rule above so it wins at equal specificity. */
    .narrative-trigger-btn.hidden { display: none; }

    .narrative-overlay {
      position: fixed;
      inset: 0;
      z-index: 100000;
      background: #0b0706; /* fallback shown under a not-yet-loaded image, per TRD §10 */
      overflow: hidden;
      touch-action: manipulation;
      cursor: pointer;
    }
    .narrative-image-layer {
      position: absolute;
      inset: 0;
      background-size: cover;
      background-position: center;
      opacity: 0;
      transition: opacity ${IMAGE_CROSSFADE_MS}ms ease;
    }
    .narrative-image-layer.active { opacity: 1; }
    .narrative-scrim {
      position: absolute;
      inset: 0;
      background: linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.45) 38%, rgba(0,0,0,0) 68%);
      pointer-events: none;
    }
    .narrative-text {
      position: absolute;
      left: 50%;
      bottom: 9%;
      transform: translateX(-50%);
      width: min(80%, 900px);
      text-align: center;
      color: #f2ead9;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: clamp(18px, 2.4vw, 28px);
      line-height: 1.5;
      text-shadow: 0 2px 10px rgba(0,0,0,0.9);
      opacity: 0;
      transition: opacity ${TEXT_FADE_IN_MS}ms ease;
      pointer-events: none;
    }
    .narrative-text.visible {
      opacity: 1;
      transition: opacity ${TEXT_FADE_OUT_MS}ms ease;
    }
    .narrative-progress {
      position: absolute;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 6px;
      z-index: 2;
    }
    .narrative-dot {
      width: 22px;
      height: 3px;
      border-radius: 2px;
      background: rgba(255,255,255,0.28);
    }
    .narrative-dot.done { background: rgba(255,255,255,0.9); }
    .narrative-dot.current { background: rgba(255, 140, 0, 0.95); }
    .narrative-skip-btn {
      position: absolute;
      top: 12px;
      right: 14px;
      z-index: 2;
      background: rgba(0,0,0,0.5);
      color: #f2ead9;
      border: 1px solid rgba(255,255,255,0.35);
      border-radius: 6px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      letter-spacing: 1px;
      text-transform: uppercase;
      padding: 6px 12px;
      cursor: pointer;
      touch-action: manipulation;
    }
  `;
  document.head.appendChild(style);
}

// Minimal inline book glyph — no new binary asset needed, and it inherits
// currentColor so it re-themes for free if the trigger button's color
// ever changes.
const BOOK_ICON_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 4.5C4 3.7 4.7 3 5.5 3H12v18H5.5c-.8 0-1.5-.7-1.5-1.5v-15Z"/>
    <path d="M20 4.5c0-.8-.7-1.5-1.5-1.5H12v18h6.5c.8 0 1.5-.7 1.5-1.5v-15Z"/>
  </svg>
`;

// --- Playback state (module-scoped; only one instance of the overlay can
// ever be open at a time, so this doesn't need to be a class) ----------
let triggerBtnEl = null;
let overlayEl = null;
let imageLayerA = null;
let imageLayerB = null;
let textEl = null;
let dotEls = [];
let currentIndex = -1;
let usingLayerA = true; // which of the two crossfade layers is "front"
let screenTimers = [];
let screenStartTs = 0;
let currentScreenDuration = 0;
let pausedElapsedMs = 0;
let isPaused = false;

function clearScreenTimers() {
  screenTimers.forEach(clearTimeout);
  screenTimers = [];
}

function preloadAndShowImage(src) {
  const front = usingLayerA ? imageLayerA : imageLayerB;
  const back = usingLayerA ? imageLayerB : imageLayerA;
  usingLayerA = !usingLayerA;

  back.style.backgroundImage = `url('${src}')`;
  back.classList.add('active');
  front.classList.remove('active');
  // Both layers stay in the DOM permanently (see buildOverlay) — we're
  // just toggling which one is on top, so there's nothing to load-check
  // here beyond letting the browser's own cache/paint handle it. If the
  // image genuinely hasn't downloaded yet, the dark .narrative-overlay
  // background shows through underneath until it paints in, rather than
  // a blank flash (TRD §10).
}

// Runs the show/hide/advance timers for the CURRENT screen, starting
// `elapsedMs` into it — 0 for a freshly-entered screen, or however much
// had already elapsed when a previous run of this same screen was
// interrupted by backgrounding (TRD §6 pause-on-backgrounding).
function scheduleScreenTimers(elapsedMs) {
  clearScreenTimers();
  screenStartTs = performance.now() - elapsedMs;

  const showAt = PRE_ROLL_MS - elapsedMs;
  const hideAt = (currentScreenDuration - TEXT_FADE_OUT_MS) - elapsedMs;
  const advanceAt = currentScreenDuration - elapsedMs;

  if (showAt <= 0) {
    textEl.classList.add('visible');
  } else {
    screenTimers.push(setTimeout(() => textEl.classList.add('visible'), showAt));
  }
  screenTimers.push(setTimeout(() => textEl.classList.remove('visible'), Math.max(0, hideAt)));
  screenTimers.push(setTimeout(() => goToScreen(currentIndex + 1), Math.max(0, advanceAt)));
}

function goToScreen(index) {
  if (index >= NARRATIVE_SCREENS.length) {
    closeSequence();
    return;
  }
  currentIndex = index;
  const screen = NARRATIVE_SCREENS[index];
  currentScreenDuration = screenDurationMs(screen.text);

  textEl.classList.remove('visible');
  textEl.textContent = screen.text;
  preloadAndShowImage(screen.image);

  dotEls.forEach((dot, i) => {
    dot.classList.toggle('done', i < index);
    dot.classList.toggle('current', i === index);
  });

  scheduleScreenTimers(0);
}

function handleVisibilityChange() {
  if (!overlayEl) return;
  if (document.hidden) {
    if (!isPaused) {
      isPaused = true;
      pausedElapsedMs = performance.now() - screenStartTs;
      clearScreenTimers();
    }
  } else if (isPaused) {
    isPaused = false;
    scheduleScreenTimers(pausedElapsedMs);
  }
}

function handleOverlayTap(e) {
  if (e.target.closest('.narrative-skip-btn')) return; // skip button handles its own click
  clearScreenTimers();
  goToScreen(currentIndex + 1);
}

function buildOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'narrative-overlay';

  imageLayerA = document.createElement('div');
  imageLayerA.className = 'narrative-image-layer active';
  imageLayerB = document.createElement('div');
  imageLayerB.className = 'narrative-image-layer';

  const scrim = document.createElement('div');
  scrim.className = 'narrative-scrim';

  textEl = document.createElement('div');
  textEl.className = 'narrative-text';

  const progress = document.createElement('div');
  progress.className = 'narrative-progress';
  dotEls = NARRATIVE_SCREENS.map(() => {
    const dot = document.createElement('div');
    dot.className = 'narrative-dot';
    progress.appendChild(dot);
    return dot;
  });

  const skipBtn = document.createElement('button');
  skipBtn.className = 'narrative-skip-btn';
  skipBtn.type = 'button';
  skipBtn.textContent = 'Skip';
  skipBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeSequence();
  });

  overlay.append(imageLayerA, imageLayerB, scrim, textEl, progress, skipBtn);
  overlay.addEventListener('click', handleOverlayTap);
  return overlay;
}

function closeSequence() {
  clearScreenTimers();
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
  currentIndex = -1;
  isPaused = false;
}

function playNarrativeSequence() {
  ensureStyles();
  if (overlayEl) return; // already playing — the trigger button sits
                          // underneath the overlay's z-index, so a second
                          // tap can't normally reach it, but guard anyway.
  overlayEl = buildOverlay();
  document.body.appendChild(overlayEl);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  goToScreen(0);
}

// --- Public entry point --------------------------------------------------

export function installNarrativeTrigger() {
  ensureStyles();
  const btn = document.createElement('button');
  btn.className = 'narrative-trigger-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Show origin story');
  btn.innerHTML = BOOK_ICON_SVG;
  btn.addEventListener('click', playNarrativeSequence);
  document.getElementById('app-shell').appendChild(btn);
  triggerBtnEl = btn;
}

// See the visibility note at the top of this file — callers own WHEN
// these fire, this module just owns the toggle itself.
export function showNarrativeTrigger() {
  if (triggerBtnEl) triggerBtnEl.classList.remove('hidden');
}

export function hideNarrativeTrigger() {
  if (triggerBtnEl) triggerBtnEl.classList.add('hidden');
}
