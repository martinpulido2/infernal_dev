// tutorial/tutorialOverlay.js
//
// Renders the Tutorial Mode overlay: a hub of chapter tiles, and a
// self-paced (Next/Back, no auto-advance) chapter step view. Deliberately
// NOT built like narrative/introSequence.js's timed slideshow -- see the
// TRD's §3 rationale: this is reference content a group reads at
// different speeds, not a story beat. What IS reused from
// introSequence.js is the general shape of a lazily-styled, module-scoped
// full-screen overlay with a persistent Close control.
//
// Pure UI: reads/writes nothing in gameState.js. "Chapter viewed" ticks
// are sessionStorage-only, matching this module's own lifetime (reset on
// the same full-page reload that resets everything else -- see
// resetRun()'s callers elsewhere in the app).

import { TUTORIAL_WELCOME, TUTORIAL_CHAPTERS } from './tutorialContent.js';
import * as diagrams from './tutorialDiagrams.js';

const VIEWED_KEY = 'tutorialChaptersViewed';

function getViewedSet() {
  try {
    const raw = sessionStorage.getItem(VIEWED_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}
function markViewed(chapterId) {
  try {
    const set = getViewedSet();
    set.add(chapterId);
    sessionStorage.setItem(VIEWED_KEY, JSON.stringify([...set]));
  } catch {
    // best-effort only -- a failed write just means no checkmark, never a crash
  }
}

let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .tut-overlay {
      position: fixed; inset: 0; z-index: 100000;
      background: #0b0706; color: #f2ead9;
      font-family: system-ui, -apple-system, sans-serif;
      touch-action: manipulation; overflow: hidden;
    }
    .tut-close-btn {
      position: absolute; top: 12px; right: 14px; z-index: 3;
      background: rgba(0,0,0,0.5); color: #f2ead9;
      border: 1px solid rgba(255,255,255,0.35); border-radius: 6px;
      font-size: 13px; letter-spacing: 1px; text-transform: uppercase;
      padding: 6px 12px; cursor: pointer; touch-action: manipulation;
    }
    .tut-hub {
      position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; padding: 40px 24px; gap: 22px;
    }
    .tut-hub-title {
      font-family: Georgia, 'Times New Roman', serif; text-transform: uppercase;
      letter-spacing: 2px; color: #f4c14a; font-size: clamp(20px, 3vw, 28px); text-align: center;
    }
    .tut-hub-sub { max-width: 640px; text-align: center; color: #c9b896; font-size: 14px; line-height: 1.5; }
    .tut-chapter-grid {
      display: grid; grid-template-columns: repeat(3, minmax(140px, 200px)); gap: 14px;
      max-width: 760px;
    }
    .tut-chapter-tile {
      position: relative; background: rgba(11,7,6,0.82); border: 2px solid rgba(244,193,74,0.35);
      border-radius: 10px; padding: 14px 12px; cursor: pointer; text-align: left;
      transition: border-color 0.15s ease, transform 0.1s ease;
    }
    .tut-chapter-tile:active { transform: scale(0.97); }
    .tut-chapter-tile.viewed { border-color: rgba(244,193,74,0.7); }
    .tut-chapter-num {
      font-family: Georgia, serif; color: #f4c14a; font-size: 12px; letter-spacing: 1px; opacity: 0.8;
    }
    .tut-chapter-title { font-family: Georgia, serif; font-size: 15px; font-weight: 700; color: #f4c14a; margin: 4px 0 4px; }
    .tut-chapter-blurb { font-size: 11.5px; color: #c9b896; line-height: 1.35; }
    .tut-chapter-check {
      position: absolute; top: 8px; right: 10px; color: #6fcf97; font-size: 14px;
    }
    .tut-chapter-view {
      position: absolute; inset: 0; display: none; flex-direction: column;
      align-items: center; justify-content: space-between; padding: 60px 24px 24px;
    }
    .tut-chapter-view.active { display: flex; }
    .tut-chapter-view-title {
      font-family: Georgia, serif; text-transform: uppercase; letter-spacing: 2px;
      color: #f4c14a; font-size: 15px; text-align: center;
    }
    .tut-diagram { width: min(70vw, 360px); height: min(70vw, 360px); max-height: 40vh; margin: 10px 0; }
    .tut-step-text {
      max-width: 640px; text-align: center; font-size: clamp(15px, 2vw, 18px); line-height: 1.5;
    }
    .tut-progress { display: flex; gap: 6px; margin-bottom: 6px; }
    .tut-dot { width: 20px; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.25); }
    .tut-dot.done { background: rgba(255,255,255,0.9); }
    .tut-dot.current { background: #f2994a; }
    .tut-nav-row { display: flex; align-items: center; gap: 18px; }
    .tut-nav-btn {
      background: rgba(244,193,74,0.14); border: 1px solid rgba(244,193,74,0.5);
      color: #f4c14a; border-radius: 8px; padding: 10px 22px; font-size: 14px;
      letter-spacing: 1px; text-transform: uppercase; cursor: pointer; touch-action: manipulation;
    }
    .tut-nav-btn:disabled { opacity: 0.3; }
    .tut-chapters-btn {
      position: absolute; top: 12px; left: 14px; z-index: 3;
      background: rgba(0,0,0,0.5); color: #f2ead9; border: 1px solid rgba(255,255,255,0.35);
      border-radius: 6px; font-size: 12px; letter-spacing: 1px; text-transform: uppercase;
      padding: 6px 12px; cursor: pointer; touch-action: manipulation;
    }
  `;
  document.head.appendChild(style);
}

function buildDiagramMarkup(descriptor) {
  if (!descriptor) return '';
  const fn = diagrams[descriptor.builder];
  if (typeof fn !== 'function') return '';
  const args = descriptor.args || [];
  try {
    return fn(...args);
  } catch {
    return '';
  }
}

let overlayEl = null;
let hubEl = null;
let chapterViewEls = {}; // chapterId -> { root, titleEl, progressEl, diagramEl, textEl, backBtn, nextBtn }
let activeChapterId = null;
let activeStepIndex = 0;

function showHub() {
  activeChapterId = null;
  Object.values(chapterViewEls).forEach((c) => c.root.classList.remove('active'));
  hubEl.style.display = 'flex';
  renderHubTiles();
}

function renderHubTiles() {
  const viewed = getViewedSet();
  const grid = hubEl.querySelector('.tut-chapter-grid');
  grid.innerHTML = '';
  TUTORIAL_CHAPTERS.forEach((ch, i) => {
    const tile = document.createElement('div');
    tile.className = 'tut-chapter-tile' + (viewed.has(ch.id) ? ' viewed' : '');
    tile.innerHTML = `
      ${viewed.has(ch.id) ? '<div class="tut-chapter-check">&#10003;</div>' : ''}
      <div class="tut-chapter-num">${String(i + 1).padStart(2, '0')}</div>
      <div class="tut-chapter-title">${ch.title}</div>
      <div class="tut-chapter-blurb">${ch.blurb}</div>
    `;
    tile.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      openChapter(ch.id);
    });
    grid.appendChild(tile);
  });
}

function openChapter(chapterId) {
  activeChapterId = chapterId;
  activeStepIndex = 0;
  hubEl.style.display = 'none';
  Object.entries(chapterViewEls).forEach(([id, c]) => c.root.classList.toggle('active', id === chapterId));
  renderStep();
  markViewed(chapterId);
}

function renderStep() {
  const chapter = TUTORIAL_CHAPTERS.find((c) => c.id === activeChapterId);
  const view = chapterViewEls[activeChapterId];
  if (!chapter || !view) return;
  const step = chapter.steps[activeStepIndex];

  view.progressEl.innerHTML = chapter.steps
    .map((_, i) => `<div class="tut-dot ${i < activeStepIndex ? 'done' : ''} ${i === activeStepIndex ? 'current' : ''}"></div>`)
    .join('');
  view.diagramEl.innerHTML = buildDiagramMarkup(step.diagram);
  view.diagramEl.style.display = step.diagram ? '' : 'none';
  view.textEl.textContent = step.text;
  view.backBtn.disabled = activeStepIndex === 0;
  view.nextBtn.textContent = activeStepIndex === chapter.steps.length - 1 ? 'Chapters' : 'Next';
}

function stepBack() {
  if (activeStepIndex > 0) {
    activeStepIndex -= 1;
    renderStep();
  }
}
function stepNext() {
  const chapter = TUTORIAL_CHAPTERS.find((c) => c.id === activeChapterId);
  if (!chapter) return;
  if (activeStepIndex < chapter.steps.length - 1) {
    activeStepIndex += 1;
    renderStep();
  } else {
    showHub();
  }
}

function buildChapterView(chapter) {
  const root = document.createElement('div');
  root.className = 'tut-chapter-view';

  const chaptersBtn = document.createElement('button');
  chaptersBtn.className = 'tut-chapters-btn';
  chaptersBtn.type = 'button';
  chaptersBtn.textContent = 'Chapters';
  chaptersBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showHub();
  });

  const titleEl = document.createElement('div');
  titleEl.className = 'tut-chapter-view-title';
  titleEl.textContent = chapter.title;

  const progressEl = document.createElement('div');
  progressEl.className = 'tut-progress';

  const diagramEl = document.createElement('div');
  diagramEl.className = 'tut-diagram';

  const textEl = document.createElement('div');
  textEl.className = 'tut-step-text';

  const navRow = document.createElement('div');
  navRow.className = 'tut-nav-row';
  const backBtn = document.createElement('button');
  backBtn.className = 'tut-nav-btn';
  backBtn.type = 'button';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    stepBack();
  });
  const nextBtn = document.createElement('button');
  nextBtn.className = 'tut-nav-btn';
  nextBtn.type = 'button';
  nextBtn.textContent = 'Next';
  nextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    stepNext();
  });
  navRow.append(backBtn, nextBtn);

  const top = document.createElement('div');
  top.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:10px;';
  top.append(progressEl, titleEl);

  const mid = document.createElement('div');
  mid.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:14px;flex:1;justify-content:center;';
  mid.append(diagramEl, textEl);

  root.append(chaptersBtn, top, mid, navRow);
  return { root, titleEl, progressEl, diagramEl, textEl, backBtn, nextBtn };
}

function buildOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'tut-overlay';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'tut-close-btn';
  closeBtn.type = 'button';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTutorial();
  });

  hubEl = document.createElement('div');
  hubEl.className = 'tut-hub';
  hubEl.innerHTML = `
    <div class="tut-hub-title">${TUTORIAL_WELCOME.title}</div>
    <div class="tut-hub-sub">${TUTORIAL_WELCOME.text}</div>
    <div class="tut-chapter-grid"></div>
  `;

  overlay.append(closeBtn, hubEl);

  chapterViewEls = {};
  TUTORIAL_CHAPTERS.forEach((chapter) => {
    const view = buildChapterView(chapter);
    chapterViewEls[chapter.id] = view;
    overlay.appendChild(view.root);
  });

  return overlay;
}

export function openTutorial() {
  ensureStyles();
  if (overlayEl) return; // already open
  overlayEl = buildOverlay();
  document.body.appendChild(overlayEl);
  showHub();
}

export function closeTutorial() {
  if (!overlayEl) return;
  overlayEl.remove();
  overlayEl = null;
  hubEl = null;
  chapterViewEls = {};
  activeChapterId = null;
}
