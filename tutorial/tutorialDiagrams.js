// tutorial/tutorialDiagrams.js
//
// Builds inline SVG markup for tutorial steps. Every diagram here reuses
// either the real node-icon symbols (map/icons.js -- same <symbol> defs
// the live map renders) or the same polar/arcPath/donutPath math the live
// control ring is drawn with (tutorial/geometry.js). The goal is that a
// diagram is never "close enough" art -- it's built from the same
// geometry/icons as the screen it's teaching, so it can't silently drift
// out of sync the way a screenshot would.
//
// Every builder returns a plain markup STRING (not a DOM node), matching
// the string-building convention already used by map/icons.js's own
// buildIconDefsMarkup() -- the overlay just drops these into innerHTML.

import { polar, arcPath, donutPath } from './geometry.js';
import { NODE_TYPE_TO_SYMBOL_ID, buildIconDefsMarkup, ICON_CONTENT_BBOX } from '../map/icons.js';
import { NODE_PREVIEW_CONTENT } from '../map/nodePreviewContent.js';

const KNOCKBACK_COLOR = '#f2994a';
const CORRUPTION_COLOR = '#f2c94c';
const ANCHOR_COLOR = '#2d9cdb';
const RALLY_COLOR = '#27ae60';
const OBSTACLE_COLOR = '#4f4f4f';
const HP_COLOR = '#ff5555';

function wrap(inner, viewBox = '-160 -160 320 320', extraStyle = '') {
  return `<svg viewBox="${viewBox}" style="width:100%;height:100%;display:block;${extraStyle}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

function iconUse(symbolId, cx, cy, size) {
  const bbox = ICON_CONTENT_BBOX[symbolId] || [0, 0, 612, 792];
  const [x0, y0, x1, y1] = bbox;
  const w = x1 - x0;
  const h = y1 - y0;
  const scale = size / Math.max(w, h);
  const tx = cx - (x0 + x1) / 2 * scale;
  const ty = cy - (y0 + y1) / 2 * scale;
  return `<use href="#${symbolId}" width="612" height="792" transform="translate(${tx} ${ty}) scale(${scale})" />`;
}

// --- 1. Ring double-tap (opening screen + declaration screen + victory
// screens all share this same "double-tap anywhere to advance" gesture) --
export function doubleTapDiagram(label = 'DOUBLE-TAP') {
  const inner = `
    <circle r="90" fill="none" stroke="#444" stroke-width="10"/>
    <circle r="60" fill="none" stroke="#2a2a2a" stroke-width="6"/>
    <g opacity="0.9">
      <circle cx="0" cy="0" r="14" fill="#f4c14a">
        <animate attributeName="r" values="10;22;10" dur="1.1s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.9;0.15;0.9" dur="1.1s" repeatCount="indefinite"/>
      </circle>
      <circle cx="0" cy="0" r="6" fill="#fff"/>
    </g>
    <text x="0" y="120" text-anchor="middle" fill="#f2ead9" font-family="system-ui, sans-serif"
          font-size="18" font-weight="700" letter-spacing="2">${label}</text>
  `;
  return wrap(inner);
}

// --- 2. Character token select (orientation chapter) ---
export function charTokenDiagram() {
  const inner = `
    <circle r="70" fill="#1a1a1f" stroke="#e53935" stroke-width="8"/>
    <circle r="70" fill="none" stroke="#fff" stroke-width="3" opacity="0.9">
      <animate attributeName="r" values="70;84;70" dur="1.6s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.9;0;0.9" dur="1.6s" repeatCount="indefinite"/>
    </circle>
    <text x="0" y="10" text-anchor="middle" fill="#fff" font-size="34" font-family="system-ui">👤</text>
    <text x="0" y="115" text-anchor="middle" fill="#f2ead9" font-family="system-ui, sans-serif"
          font-size="16" letter-spacing="1">TAP TO CLAIM SEAT</text>
  `;
  return wrap(inner);
}

// --- 3. Orientation arrows (four corners, one per seat) ---
export function orientationArrowsDiagram() {
  const corners = [
    { x: -110, y: -110, rot: 45 },
    { x: 110, y: -110, rot: 135 },
    { x: -110, y: 110, rot: -45 },
    { x: 110, y: 110, rot: -135 },
  ];
  const arrows = corners
    .map(
      (c) => `
      <g transform="translate(${c.x} ${c.y}) rotate(${c.rot})">
        <path d="M0,-22 L14,6 L4,6 L4,22 L-4,22 L-4,6 L-14,6 Z" fill="#f4c14a">
          <animate attributeName="opacity" values="1;0.25;1" dur="1.3s" repeatCount="indefinite"/>
        </path>
      </g>`
    )
    .join('');
  const inner = `
    <rect x="-140" y="-140" width="280" height="280" rx="18" fill="none" stroke="#444" stroke-width="4"/>
    ${arrows}
    <text x="0" y="6" text-anchor="middle" fill="#c9b896" font-family="system-ui, sans-serif" font-size="14">tap your edge</text>
  `;
  return wrap(inner);
}

// --- 4. Mode select panel (Standard vs Rush) ---
export function modeSelectDiagram() {
  const card = (x, title, selected) => `
    <g transform="translate(${x} 0)">
      <rect x="-58" y="-40" width="116" height="80" rx="8"
            fill="${selected ? 'rgba(244,193,74,0.16)' : 'rgba(11,7,6,0.82)'}"
            stroke="${selected ? '#f4c14a' : 'rgba(244,193,74,0.4)'}" stroke-width="2"/>
      <text x="0" y="-6" text-anchor="middle" fill="#f4c14a" font-family="Georgia, serif"
            font-size="15" font-weight="700" letter-spacing="1">${title}</text>
      <text x="0" y="18" text-anchor="middle" fill="#c9b896" font-family="system-ui, sans-serif" font-size="10">tap to choose</text>
    </g>`;
  const inner = `${card(-65, 'STANDARD', true)}${card(65, 'RUSH', false)}`;
  return wrap(inner, '-160 -80 320 160');
}

// --- 5. Map node states: dim (not legal) / glowing (legal) / previewing (red) ---
export function nodeStatesDiagram() {
  const states = [
    { x: -100, fill: '#2a2a2a', opacity: 0.45, label: 'NOT REACHABLE', glow: false },
    { x: 0, fill: '#3a322c', opacity: 1, label: 'LEGAL MOVE', glow: true },
    { x: 100, fill: '#8a3b32', opacity: 1, label: 'PREVIEWING\n(tap again to confirm)', glow: true },
  ];
  const symbolId = NODE_TYPE_TO_SYMBOL_ID.STANDARD_COMBAT;
  const nodes = states
    .map(
      (s) => `
      <g transform="translate(${s.x} 0)" opacity="${s.opacity}">
        ${s.glow ? `<circle r="42" fill="url(#glow)" opacity="0.6"/>` : ''}
        <circle r="30" fill="${s.fill}" stroke="#3a322c" stroke-width="2"/>
        ${iconUse(symbolId, 0, 0, 34)}
      </g>`
    )
    .join('');
  const labels = states
    .map(
      (s) => `<text x="${s.x}" y="58" text-anchor="middle" fill="#c9b896" font-family="system-ui, sans-serif" font-size="10">${s.label.split('\n')[0]}</text>`
    )
    .join('');
  const inner = `
    ${buildIconDefsMarkup()}
    <defs><radialGradient id="glow"><stop offset="0%" stop-color="#f4c14a" stop-opacity="0.7"/><stop offset="100%" stop-color="#f4c14a" stop-opacity="0"/></radialGradient></defs>
    ${nodes}${labels}
  `;
  return wrap(inner, '-160 -60 320 140');
}

// --- 6. Grid of the seven node type icons, with title/flavor lookups ---
export function nodeTypeGridDiagram(typeKeys) {
  const cols = 4;
  const spacing = 78;
  const startX = -((Math.min(typeKeys.length, cols) - 1) * spacing) / 2;
  const cells = typeKeys
    .map((key, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * spacing;
      const y = row * 96 - (row > 0 ? 8 : 0);
      const symbolId = NODE_TYPE_TO_SYMBOL_ID[key];
      const title = (NODE_PREVIEW_CONTENT[key] && NODE_PREVIEW_CONTENT[key].title) || key;
      return `
        <g transform="translate(${x} ${y})">
          <circle r="28" fill="#241b16" stroke="#3a322c" stroke-width="2"/>
          ${iconUse(symbolId, 0, 0, 32)}
          <text x="0" y="46" text-anchor="middle" fill="#c9b896" font-family="system-ui, sans-serif" font-size="10">${title}</text>
        </g>`;
    })
    .join('');
  const rows = Math.ceil(typeKeys.length / cols);
  const h = rows * 96 + 40;
  const inner = `${buildIconDefsMarkup()}${cells}`;
  return wrap(inner, `-160 ${-h / 2 + 10} 320 ${h}`);
}

// --- 7. Hot Spring / Reflection Chamber option cards ---
export function optionCardsDiagram(options) {
  const n = options.length;
  const spacing = 130;
  const startX = -((n - 1) * spacing) / 2;
  const cards = options
    .map((opt, i) => {
      const x = startX + i * spacing;
      const color = opt.corruptionDelta > 0 ? CORRUPTION_COLOR : opt.corruptionDelta < 0 ? '#6fcf97' : '#c9b896';
      const deltaLabel =
        opt.corruptionDelta === 0 ? 'no corruption' : opt.corruptionDelta > 0 ? `+${opt.corruptionDelta} corruption` : `${opt.corruptionDelta} corruption`;
      return `
        <g transform="translate(${x} 0)">
          <rect x="-58" y="-46" width="116" height="92" rx="8" fill="rgba(11,7,6,0.82)" stroke="rgba(244,193,74,0.4)" stroke-width="2"/>
          <text x="0" y="-22" text-anchor="middle" fill="#f4c14a" font-family="Georgia, serif" font-size="13" font-weight="700">${opt.title}</text>
          <foreignObject x="-52" y="-12" width="104" height="42">
            <div xmlns="http://www.w3.org/1999/xhtml" style="color:#c9b896;font-family:system-ui,sans-serif;font-size:9.5px;line-height:1.3;text-align:center;">${opt.description}</div>
          </foreignObject>
          <text x="0" y="38" text-anchor="middle" fill="${color}" font-family="system-ui, sans-serif" font-size="10" font-weight="700">${deltaLabel}</text>
        </g>`;
    })
    .join('');
  return wrap(cards, '-160 -70 320 150');
}

// --- 8. Declaration / combat-preview guardian card ---
export function guardianCardDiagram({ name = 'GUARDIAN', hp = 6, corruption = 3, color = '#e53935', isFiend = false, fiendNum = 1 } = {}) {
  const inner = `
    <circle r="70" fill="#1a1a1f" stroke="${color}" stroke-width="7"/>
    <text x="0" y="-10" text-anchor="middle" fill="#fff" font-family="system-ui, sans-serif" font-size="13" font-weight="700">${name}</text>
    <text x="-20" y="20" text-anchor="middle" fill="${HP_COLOR}" font-family="system-ui, sans-serif" font-size="22" font-weight="700">${hp}</text>
    <text x="20" y="20" text-anchor="middle" fill="${CORRUPTION_COLOR}" font-family="system-ui, sans-serif" font-size="22" font-weight="700">${corruption}</text>
    ${isFiend ? `<text x="0" y="95" text-anchor="middle" fill="#c9b896" font-family="system-ui, sans-serif" font-size="11">+ Fiend ${fiendNum}: pull its card too</text>` : ''}
  `;
  return wrap(inner, '-100 -90 200 210');
}

// --- 9. Full speed ring: outer(player)/inner(enemy) rings, action line,
// the orange "knockback zone" arc, and optional unit dots. This is the
// workhorse diagram for most of chapter e. ---
export function speedRingDiagram({ dots = [], showArc = true, showControlRing = false, highlightSegment = null } = {}) {
  const arc150 = showArc ? `<path d="${arcPath(150, 270, 360)}" fill="none" stroke="${KNOCKBACK_COLOR}" stroke-width="10" opacity="0.85"/>` : '';
  const arc130 = showArc ? `<path d="${arcPath(130, 270, 360)}" fill="none" stroke="${KNOCKBACK_COLOR}" stroke-width="10" opacity="0.85"/>` : '';
  const dotEls = dots
    .map((d) => {
      const p = polar(d.radius, d.angle);
      return `<circle cx="${p.x}" cy="${p.y}" r="9" fill="${d.color}" stroke="#000" stroke-width="2"/>${
        d.label ? `<text x="${p.x}" y="${p.y - 16}" text-anchor="middle" fill="#f2ead9" font-family="system-ui, sans-serif" font-size="9">${d.label}</text>` : ''
      }`;
    })
    .join('');

  const seg = (id, start, end, color, iconPath) => {
    const dim = highlightSegment && highlightSegment !== id ? 0.25 : 1;
    return `
      <g opacity="${dim}">
        <path d="${donutPath(25, 65, start, end)}" fill="${color}" stroke="#111" stroke-width="2"/>
        ${iconPath}
      </g>`;
  };
  const controlRing = showControlRing
    ? `
      <g id="corruption-donut">
        <path d="${donutPath(0, 20, 0, 359.9)}" fill="none" stroke="${CORRUPTION_COLOR}" stroke-width="6" opacity="0.55"/>
      </g>
      ${seg('anchor', 0, 120, ANCHOR_COLOR, `<circle cx="36" cy="-21" r="4" fill="#fff"/>`)}
      ${seg('rally', 120, 240, RALLY_COLOR, `<rect x="-3" y="30" width="6" height="14" fill="#fff"/>`)}
      ${seg('obstacle', 240, 360, OBSTACLE_COLOR, `<circle cx="-36" cy="-21" r="4" fill="#fff"/>`)}
    `
    : '';

  const inner = `
    <circle r="170" fill="#0b0b0f"/>
    <circle r="150" fill="none" stroke="#444" stroke-width="12"/>
    ${arc150}
    <circle r="130" fill="none" stroke="#777" stroke-width="12"/>
    ${arc130}
    <line x1="0" y1="-160" x2="0" y2="-120" stroke="#ff5555" stroke-width="3"/>
    <text x="0" y="-172" text-anchor="middle" fill="#ff8c66" font-family="system-ui, sans-serif" font-size="10" letter-spacing="1">ACTION LINE</text>
    ${dotEls}
    ${controlRing}
  `;
  return wrap(inner);
}

// --- 10. Gesture arrows: tangential (speed change) vs radial (knockback) ---
export function gestureArrowDiagram(type) {
  if (type === 'tangential') {
    const a1 = polar(150, -40);
    const a2 = polar(150, 40);
    const inner = `
      <circle r="150" fill="none" stroke="#333" stroke-width="10"/>
      <path d="M ${a1.x} ${a1.y} A 150 150 0 0 1 ${a2.x} ${a2.y}" fill="none" stroke="#7fc1ff" stroke-width="4" marker-end="url(#arrowhead)"/>
      <circle cx="${a1.x}" cy="${a1.y}" r="9" fill="#4da3ff"/>
      <defs><marker id="arrowhead" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#7fc1ff"/></marker></defs>
      <text x="0" y="0" text-anchor="middle" fill="#f2ead9" font-family="system-ui, sans-serif" font-size="13">drag left/right</text>
      <text x="0" y="20" text-anchor="middle" fill="#c9b896" font-family="system-ui, sans-serif" font-size="11">= speed up / slow down</text>
    `;
    return wrap(inner);
  }
  // radial (knockback)
  const inner = `
    <circle r="150" fill="none" stroke="#333" stroke-width="10"/>
    <circle r="90" fill="none" stroke="#333" stroke-width="10"/>
    <line x1="0" y1="-90" x2="0" y2="-150" stroke="${KNOCKBACK_COLOR}" stroke-width="4" marker-end="url(#arrowhead2)"/>
    <circle cx="0" cy="-90" r="9" fill="#4da3ff"/>
    <defs><marker id="arrowhead2" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="${KNOCKBACK_COLOR}"/></marker></defs>
    <text x="0" y="30" text-anchor="middle" fill="#f2ead9" font-family="system-ui, sans-serif" font-size="13">drag toward / away from center</text>
    <text x="0" y="50" text-anchor="middle" fill="#c9b896" font-family="system-ui, sans-serif" font-size="11">= knockback</text>
  `;
  return wrap(inner);
}

// --- 11. Corruption ring drag ---
export function corruptionRingDiagram() {
  const inner = `
    <path d="${donutPath(70, 93, 0, 270)}" fill="${CORRUPTION_COLOR}" opacity="0.85"/>
    <path d="${donutPath(70, 93, 270, 360)}" fill="none" stroke="${CORRUPTION_COLOR}" stroke-width="2" stroke-dasharray="3 4"/>
    <text x="0" y="6" text-anchor="middle" fill="#0b0706" font-family="system-ui, sans-serif" font-size="12" font-weight="700">3/4</text>
    <path d="M -70 -90 A 100 100 0 0 1 20 -128" fill="none" stroke="#fff" stroke-width="3" marker-end="url(#arrowhead3)" opacity="0.85"/>
    <defs><marker id="arrowhead3" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#fff"/></marker></defs>
    <text x="0" y="150" text-anchor="middle" fill="#f2ead9" font-family="system-ui, sans-serif" font-size="12">clockwise = add · counterclockwise = remove</text>
  `;
  return wrap(inner, '-160 -160 320 200');
}

// --- 12. Player console mock: HP/corruption drag stats, skull/consume/taint,
// toggle dots ---
export function consoleDiagram() {
  const dots = [-1, 0, 1].map((i) => {
    const theta = -90 + i * 30;
    const p = polar(166, theta);
    const active = i === 0;
    return `<circle cx="${p.x}" cy="${p.y}" r="14" fill="${['#e53935', '#1e88e5', '#43a047'][i + 1]}" stroke="#000" stroke-width="2" ${active ? 'stroke-dasharray="0" filter="drop-shadow(0 0 3px #fff)"' : ''}/>`;
  }).join('');
  const inner = `
    <circle r="144" fill="#1a1a1f" stroke="#e53935" stroke-width="6"/>
    <circle cx="0" cy="-70" r="16" fill="#333"/>
    <text x="0" y="-65" text-anchor="middle" font-size="16">💀</text>
    <text x="0" y="-8" text-anchor="middle" fill="#fff" font-family="system-ui, sans-serif" font-size="16" font-weight="700">GUARDIAN</text>
    <text x="-38" y="30" text-anchor="middle" fill="${HP_COLOR}" font-family="system-ui, sans-serif" font-size="30" font-weight="700">6</text>
    <text x="38" y="30" text-anchor="middle" fill="${CORRUPTION_COLOR}" font-family="system-ui, sans-serif" font-size="30" font-weight="700">3</text>
    <text x="-38" y="50" text-anchor="middle" fill="#c9b896" font-family="system-ui, sans-serif" font-size="8">drag ↔ HP</text>
    <text x="38" y="50" text-anchor="middle" fill="#c9b896" font-family="system-ui, sans-serif" font-size="8">drag ↔ corruption</text>
    <circle cx="0" cy="70" r="16" fill="#555"/>
    <text x="0" y="75" text-anchor="middle" font-size="14" fill="#fff">↺</text>
    <circle cx="-95" cy="115" r="20" fill="#4a2b1a" stroke="#111" stroke-width="2"/>
    <circle cx="95" cy="115" r="20" fill="#5a1a1a" stroke="#111" stroke-width="2"/>
    <text x="-95" y="120" text-anchor="middle" font-size="16">🍷</text>
    <text x="95" y="120" font-size="16" text-anchor="middle">🩸</text>
    <text x="-95" y="145" text-anchor="middle" fill="#c9b896" font-family="system-ui, sans-serif" font-size="9">Consume</text>
    <text x="95" y="145" text-anchor="middle" fill="#c9b896" font-family="system-ui, sans-serif" font-size="9">Taint</text>
    ${dots}
  `;
  return wrap(inner, '-170 -160 340 340');
}

// --- 13. Shared threshold ticker (Overseer / Hell Lord / Ordeal) ---
export function sharedThresholdDiagram() {
  const inner = `
    <text x="0" y="10" text-anchor="middle" fill="${KNOCKBACK_COLOR}" font-family="system-ui, sans-serif" font-size="40" font-weight="700" stroke="#000" stroke-width="1">2/4</text>
    <text x="0" y="46" text-anchor="middle" fill="#c9b896" font-family="system-ui, sans-serif" font-size="12">dots banked toward shared activation</text>
  `;
  return wrap(inner, '-160 -70 320 140');
}

// --- 14. Ordeal card (rounds remaining + Inquisitor infinity) ---
export function ordealCardDiagram() {
  const inner = `
    <circle r="70" fill="#1a1a1f" stroke="#e8e8e8" stroke-width="6"/>
    <text x="0" y="-10" text-anchor="middle" fill="#fff" font-family="system-ui, sans-serif" font-size="12" font-weight="700">ORDEAL</text>
    <text x="-20" y="22" text-anchor="middle" fill="#3ddc73" font-family="system-ui, sans-serif" font-size="22" font-weight="700">3</text>
    <text x="20" y="22" text-anchor="middle" fill="${CORRUPTION_COLOR}" font-family="system-ui, sans-serif" font-size="22" font-weight="700">1</text>
    <text x="-20" y="40" text-anchor="middle" fill="#c9b896" font-family="system-ui, sans-serif" font-size="8">rounds left</text>
    <text x="20" y="40" text-anchor="middle" fill="#c9b896" font-family="system-ui, sans-serif" font-size="8">corruption</text>
    <circle cx="130" cy="0" r="60" fill="#1a1a1f" stroke="#555" stroke-width="6"/>
    <text x="130" y="-4" text-anchor="middle" fill="#fff" font-family="system-ui, sans-serif" font-size="10">INQUISITOR</text>
    <text x="110" y="24" text-anchor="middle" fill="${HP_COLOR}" font-family="system-ui, sans-serif" font-size="20">&#8734;</text>
    <text x="150" y="24" text-anchor="middle" fill="${CORRUPTION_COLOR}" font-family="system-ui, sans-serif" font-size="20">&#8734;</text>
    <text x="130" y="80" text-anchor="middle" fill="#c9b896" font-family="system-ui, sans-serif" font-size="9">no skull — can't be defeated</text>
  `;
  return wrap(inner, '-100 -90 300 200');
}
