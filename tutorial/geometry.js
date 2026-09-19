// tutorial/geometry.js
//
// Small, pure SVG-path helpers used by tutorial diagrams. These are
// intentionally MIRRORED from combat/combat.js's own module-private
// polar()/arcPath()/donutPath() rather than imported from there --
// combat.js doesn't export them, and duplicating ~10 lines of pure math
// here is a lot cheaper (and lower-risk) than changing combat.js's public
// surface just so the tutorial can reach them. If combat.js's own
// versions ever change (e.g. a different angle convention), keep these in
// sync -- they must draw pixel-identical rings/segments to whatever the
// real control ring renders, since the whole point of these diagrams is
// "this is literally what you'll see in the app."

const DEG_TO_RAD = Math.PI / 180;

// 0deg = 12 o'clock (the action line's own position in combat.js),
// increasing clockwise -- identical convention to combat.js's polar().
export function polar(radius, angleDeg) {
  const rad = (angleDeg - 90) * DEG_TO_RAD;
  return { x: Math.cos(rad) * radius, y: Math.sin(rad) * radius };
}

export function arcPath(radius, startAngle, endAngle) {
  const s = polar(radius, endAngle);
  const e = polar(radius, startAngle);
  const diff = (endAngle - startAngle + 360) % 360;
  const largeArc = diff > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${largeArc} 0 ${e.x} ${e.y}`;
}

export function donutPath(innerR, outerR, startAngle, endAngle) {
  const p1 = polar(outerR, endAngle);
  const p2 = polar(outerR, startAngle);
  const p3 = polar(innerR, startAngle);
  const p4 = polar(innerR, endAngle);
  const diff = (endAngle - startAngle + 360) % 360;
  const largeArc = diff > 180 ? 1 : 0;
  return `M ${p1.x} ${p1.y} A ${outerR} ${outerR} 0 ${largeArc} 0 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${innerR} ${innerR} 0 ${largeArc} 1 ${p4.x} ${p4.y} Z`;
}

export function svgEl(tag, attrs = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
