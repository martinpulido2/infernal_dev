// platformHardening.js
//
// Verbatim-behavior port of the iPad Safari hardening block that used to
// live only at the top of combat's main.js (lines ~156-314 of the
// original file). Since this is now a single-page app across all three
// phases, this needs to install ONCE at the shell level (index.html),
// not once per phase — installing it 3 times would triple up the
// gesturestart/touchend/dblclick listeners for no benefit and risk
// double-preventDefault edge cases.
//
// Call installPlatformHardening() exactly once, from the shell's own
// top-level script, before any phase module mounts.

export function installPlatformHardening({ preloadImages = [] } = {}) {
  installFullscreen();
  installOrientationLockFallback();
  installZoomPrevention();
  // Returned so a caller that renders something depending on one of these
  // assets IMMEDIATELY on mount (a. mounts synchronously right after this
  // call, and its arrow icons are visible from the very first frame) can
  // await it first — see preloadImage's own comment for why "fire and
  // forget" wasn't actually safe here.
  //
  // Concurrency-limited rather than Promise.all over the whole list. The
  // previous all-at-once version fired every preload simultaneously —
  // 14 of them, plus combat.js's own module-level victory.png <img> —
  // against a browser limit of ~6 connections per origin. On a fast local
  // server that's invisible. On a slow or cold one (a StackBlitz
  // WebContainer still warming up), those 15 low-priority image requests
  // take every available connection and hold it, so the REAL request the
  // UI makes for the same asset a moment later (select.js's own
  // `ringImage.src = '/public/Ring1.png'`) queues behind them and can sit
  // pending indefinitely — the app then renders with no art at all, which
  // is exactly the black-launch-screen symptom this was reported for.
  //
  // Keeping a few slots free means the UI's own asset requests always
  // have somewhere to go, and the preload still warms the cache — just
  // over a few more round trips instead of one stampede.
  return preloadWithLimit(preloadImages, 3);
}

// Runs `tasks` through `preloadImage` at most `limit` at a time. Resolves
// when every one has settled (preloadImage never rejects — see its own
// comment), so callers awaiting this can't be left hanging by one bad
// asset.
function preloadWithLimit(srcs, limit) {
  let next = 0;
  function runOne() {
    if (next >= srcs.length) return Promise.resolve();
    const src = srcs[next++];
    return preloadImage(src).then(runOne);
  }
  return Promise.all(
    Array.from({ length: Math.min(limit, srcs.length) }, runOne)
  );
}

// --- Fullscreen -----------------------------------------------------
// Browsers only allow requestFullscreen() in direct response to a user
// gesture — it cannot be triggered automatically on page load. This fires
// on the very first tap/click anywhere in the whole app (not per-phase),
// then removes itself.
function installFullscreen() {
  function requestAppFullscreen() {
    if (document.fullscreenElement) return; // already fullscreen -- cheap no-op
    const el = document.documentElement;
    const request =
      el.requestFullscreen ||
      el.webkitRequestFullscreen ||
      el.mozRequestFullScreen ||
      el.msRequestFullscreen;
    if (request) {
      request
        .call(el)
        .then(() => {
          // Orientation lock is only supported by some browsers (notably
          // NOT iOS Safari, which has no Screen Orientation lock API at
          // all), and where it exists it usually only works once
          // fullscreen is active.
          if (screen.orientation && screen.orientation.lock) {
            screen.orientation.lock('landscape').catch(() => {});
          }
        })
        .catch(() => {
          /* Fullscreen can be denied or unsupported (notably: iOS Safari
             does not support the Fullscreen API for arbitrary elements at
             all, only <video>). Fail silently — nothing else in the app
             depends on fullscreen actually succeeding. */
        });
    }
  }
  // Deliberately NOT { once: true } -- that meant a single successful
  // request permanently disarmed this listener, so if the very FIRST tap
  // of the session happened to fail (some browsers decline an app's
  // first-ever fullscreen gesture) or fullscreen was exited later for any
  // reason while moving between phases (e.g. map -> combat -> map), there
  // was no way back into fullscreen short of a full page reload -- which
  // is what "map doesn't default to fullscreen the way combat does"
  // actually was: not a per-phase difference in behavior (neither phase
  // had its own fullscreen call), just bad luck about which phase
  // happened to own the one-and-only attempt. Every tap now retries, and
  // the early return above makes each retry free once it's already
  // active, so this doesn't add meaningful overhead once fullscreen is
  // genuinely established.
  document.addEventListener('pointerdown', requestAppFullscreen);

  // A deliberate way to exit fullscreen without needing the OS swipe
  // gesture (which, in landscape, can be positioned right where a drag
  // would naturally happen — genuinely can't be suppressed from a
  // webpage; this is the practical alternative). Shown only while
  // actually in fullscreen. Lives at the shell level now (z-index 200,
  // above every phase's own content) instead of being combat-only.
  const exitFullscreenBtn = document.createElement('div');
  exitFullscreenBtn.id = 'exit-fullscreen-btn';
  exitFullscreenBtn.textContent = '✕';
  exitFullscreenBtn.style.cssText = `
    position:fixed; top:10px; right:10px; z-index:200; display:none;
    width:36px; height:36px; border-radius:50%; background:#1a1a1f;
    border:2px solid #444; color:#aaa; font-size:18px; font-weight:700;
    align-items:center; justify-content:center; cursor:pointer; touch-action:none;
  `;
  document.body.appendChild(exitFullscreenBtn);

  exitFullscreenBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const exit =
      document.exitFullscreen ||
      document.webkitExitFullscreen ||
      document.mozCancelFullScreen ||
      document.msExitFullscreen;
    if (exit) exit.call(document).catch(() => {});
  });

  function updateExitButtonVisibility() {
    const isFullscreen = !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
    );
    exitFullscreenBtn.style.display = isFullscreen ? 'flex' : 'none';
  }
  ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach(
    (evt) => document.addEventListener(evt, updateExitButtonVisibility)
  );
}

// --- Orientation lock fallback ---------------------------------------
// Universal fallback for devices/browsers where true orientation lock
// isn't available (this covers iPad Safari, which has no lock API at
// all): a full-screen prompt asking the player to rotate, shown whenever
// the viewport is currently taller than it is wide. Shell-level now since
// this table game should stay landscape through orientation select and
// the map too, not just combat.
function installOrientationLockFallback() {
  const rotatePrompt = document.createElement('div');
  rotatePrompt.id = 'rotate-prompt';
  rotatePrompt.style.cssText = `
    position:fixed; inset:0; z-index:100; display:none;
    background:#0b0b0f; color:#fff; align-items:center; justify-content:center;
    text-align:center; font-size:24px; font-weight:700; padding:40px;
  `;
  rotatePrompt.textContent = 'Please rotate your device to landscape';
  document.body.appendChild(rotatePrompt);

  function checkOrientationPrompt() {
    rotatePrompt.style.display = window.innerHeight > window.innerWidth ? 'flex' : 'none';
  }
  window.addEventListener('resize', checkOrientationPrompt);
  window.addEventListener('orientationchange', checkOrientationPrompt);
  checkOrientationPrompt();
}

// --- Zoom prevention ---------------------------------------------------
// Per-element touch-action/preventDefault wasn't fully reliable on iPad
// Safari — the browser's own double-tap-zoom and pinch-zoom gesture
// recognition can fire independently of pointer events. These listeners
// are the documented, robust way to defeat both, globally, regardless of
// what's under the finger. Installed once at the shell level so double-
// tap-to-preview (map) and double-tap-to-confirm (orientation ring, map
// descent interstitial) all get the same protection combat already had —
// this was the gap that made the map/orientation double-tap gestures more
// zoom-prone than combat's.
function installZoomPrevention() {
  document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });

  let lastTouchEnd = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 350) e.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false }
  );

  // Belt-and-suspenders: also catch it on the way in, not just the way
  // out — some iOS Safari versions decide to zoom based on touchstart
  // timing rather than (or in addition to) touchend.
  let lastTouchStart = 0;
  document.addEventListener(
    'touchstart',
    (e) => {
      const now = Date.now();
      if (now - lastTouchStart <= 350) e.preventDefault();
      lastTouchStart = now;
    },
    { passive: false }
  );

  // Some browsers zoom off a synthesized double-click rather than raw
  // touch timing — block that path too.
  document.addEventListener('dblclick', (e) => e.preventDefault());
}

// --- Image preloading ---------------------------------------------------
// Assets referenced only via SVG <image>/CSS background-image/mask-image
// reportedly load inconsistently on iPad Safari (known WebKit quirks
// around late/async image loads for both). A plain <img> tag has more
// robust native load behavior — preloading through one first means the
// later SVG/background-image/mask-image reference hits the browser's
// cache instead of triggering a fresh, sometimes-flaky load.
//
// Originally combat-only (4 icons). Now takes a list so a. (character
// portraits: obsidium.png, Ryadnae.png, siria.png, Marek.png, Ring1.png,
// Arrow.png) and b. (no raster images today — icons.js embeds inline SVG
// <symbol> markup, which doesn't have this failure mode, so nothing to
// add there) can each pass their own raster assets in.
function preloadImage(src) {
  // Previously fire-and-forget (created the <img>, never waited for it) --
  // that's WHY Arrow.png (and any other asset here) loaded inconsistently
  // on a real tablet despite being "preloaded": this function returned
  // before the browser had actually finished fetching anything, so a.
  // mounting synchronously right after installPlatformHardening() could
  // still render its own Arrow.png-masked elements before this <img>'s
  // request had completed -- on a slow/cold connection, a total race, not
  // a guarantee. Returning a promise that resolves on load/error, and
  // having the shell await ALL of them before mounting a., closes that
  // race instead of just narrowing it.
  return new Promise((resolve) => {
    const img = document.createElement('img');
    img.style.cssText = 'position:absolute; width:1px; height:1px; opacity:0; pointer-events:none;';
    img.addEventListener('load', () => resolve(), { once: true });
    // Resolve (not reject) on error too -- a genuinely missing/broken
    // asset shouldn't hang the whole app's startup forever; it'll just
    // fail to render later exactly as it would have before this change.
    img.addEventListener('error', () => resolve(), { once: true });
    img.src = src;
    document.body.appendChild(img);
    // Safety net: don't let one slow asset block startup indefinitely if
    // load/error somehow never fires. Harmless to resolve twice -- a
    // Promise's resolve is a no-op after the first call.
    setTimeout(resolve, 3000);
  });
}
