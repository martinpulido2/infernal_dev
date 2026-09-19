// tutorial/tutorialTrigger.js
//
// Small compass-icon button that opens Tutorial Mode. Mirrors
// narrative/introSequence.js's own trigger pattern deliberately -- same
// visibility contract (installTutorialTrigger() once; show/hide are
// plain toggles that CALLERS drive, this module has no opinion on when),
// same "on-demand only, no first-launch gating" design, same z-index
// layer. See introSequence.js's own top-of-file comment for the full
// rationale; it applies here unchanged.
//
// Positioned beside (not on top of) the narrative trigger: that button
// sits at bottom:14px; left:14px (48px wide). This one sits at
// left:70px (14 + 48 + 8 gap) so the two read as a matched pair rather
// than two unrelated floating buttons.

import { openTutorial } from './tutorialOverlay.js';

let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .tutorial-trigger-btn {
      position: fixed;
      bottom: 14px;
      left: 70px; /* narrative trigger (14px + 48px wide) + 8px gap */
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.35);
      background: rgba(11, 7, 6, 0.72);
      color: #e8ddb5;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 200; /* same layer as the narrative trigger */
      cursor: pointer;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      padding: 0;
    }
    .tutorial-trigger-btn:active {
      background: rgba(11, 7, 6, 0.9);
      transform: scale(0.94);
    }
    .tutorial-trigger-btn svg { width: 24px; height: 24px; display: block; }
    .tutorial-trigger-btn.hidden { display: none; }
  `;
  document.head.appendChild(style);
}

// Compass-rose glyph -- deliberately NOT a book, so the two trigger
// buttons are silhouette-distinguishable at a glance before a player has
// learned what either one does. Inherits currentColor, same convention
// as introSequence.js's BOOK_ICON_SVG.
const COMPASS_ICON_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="9"/>
    <path d="M15.5 8.5 L13 13 L8.5 15.5 L11 11 Z" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>
  </svg>
`;

let triggerBtnEl = null;

export function installTutorialTrigger() {
  ensureStyles();
  const btn = document.createElement('button');
  btn.className = 'tutorial-trigger-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Show app tutorial');
  btn.innerHTML = COMPASS_ICON_SVG;
  btn.addEventListener('click', openTutorial);
  document.getElementById('app-shell').appendChild(btn);
  triggerBtnEl = btn;
}

export function showTutorialTrigger() {
  if (triggerBtnEl) triggerBtnEl.classList.remove('hidden');
}

export function hideTutorialTrigger() {
  if (triggerBtnEl) triggerBtnEl.classList.add('hidden');
}
