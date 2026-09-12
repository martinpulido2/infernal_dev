// speedQueue.js
//
// Phase 1 of the "Concentric Ring Battle System" speed-queue TRD:
//   - 1.1/1.2: the curved chronological queue itself (forecast engine +
//     rendering), including 2-letter enemy labels shared by the rings and
//     the queue, and lap repeats for fast units. Per user correction, the
//     queue shows ONLY subsequent turns -- the unit currently on the
//     action line is not repeated as a queue entry.
//   - 3.1: Queue Selection / Simulation Snapshot (tap a queue icon to see
//     ghost dots on both rings at that future moment).
//   - 3.2: Visual Anchor Status glyph on queue icons.
//   - 2.1/2.2 (Phase 2): live gesture-preview integration for knockback
//     and speed-up/slow-down -- ghosted original icon + tracking arrow +
//     a reserved gap at the old slot that bystanders shift around (not
//     into), wired into combat.js's existing radial (knockback) and
//     tangential (speed-change) drag branches.
//
// Deliberately pure where possible: computeQueueForecast() takes a plain
// snapshot of unit data and returns a plain forecast, with no DOM and no
// dependency on combat.js's module-level state, so it can be reasoned
// about (and unit-tested) independent of rendering. renderSpeedQueue() is
// the only DOM-touching half, and pools its <g> elements the same way
// combat.js's own updateSpeedGhosts() pools its ghost dots.
//
// Still NOT in this file: boulder/rally/anchor preview integration (TRD
// 2.3-2.5). Each of those is a distinct trigger (a button press, not a
// unit drag) with its own player-turn-only preview + split commit/cancel
// button UI described in the TRD -- a genuinely separate chunk of work
// from the two drag gestures above. computeQueueForecast() and
// renderQueuePreviewOverlay() already generalize to them (any candidate
// unit snapshot works, and the overlay just needs a unitId to track);
// it's the combat.js-side trigger/commit wiring for each of those three
// flows that's still open.

const SVG_NS = 'http://www.w3.org/2000/svg';

// --- FORECAST ENGINE -------------------------------------------------

// Simulates the ring(s) forward from `units`' CURRENT angle/speed, frame
// by frame the same way tickInner() finds its next finisher, except all
// at once and on a throwaway clone -- nothing here ever touches a real
// unit. Stops once every currently-active unit (or, for a shared-pool
// group like an Overseer/Hell Lord/Ordeal Inquisitor, every group) has
// logged at least one REAL turn (a pass-through crossing under the
// group's activation threshold doesn't count, mirroring tickInner's own
// isOverseerPassThrough rule).
//
// `units` -- LIVE unit objects (or any plain objects shaped the same
//   way): { id, angle, speed, speedMult, isOverseerDot, overseerId }.
//   The actual angular rate used is speed*speedMult -- same as
//   tickInner()'s own `currentSpeed` -- computed here rather than
//   requiring the caller to premultiply, so a unit under a speed-up/
//   slow-down modifier forecasts correctly. Units with an effective
//   rate <= 0 (stalled) are excluded up front: they have no future
//   crossing to forecast and are not part of the "everyone gets a turn"
//   completion requirement, same as updateSpeedGhosts()'s own
//   stillNeeded set skips them.
// `options.overseerThresholdCount`/`overseerThresholdTarget` -- current
//   real values from combat.js, so the very first simulated crossing
//   picks up the threshold ticker exactly where the real game state left
//   it.
// `options.rocks` -- live boulder/rock objects: { radius, angle,
//   remainingMs }. A unit whose path would cross a rock on its OWN
//   radius before reaching the action line freezes there instead of
//   crossing -- mirrors tickInner()'s own blocking check exactly (a rock
//   doesn't damage or remove a unit, just halts it in place) -- for
//   whatever's left of the rock's remainingMs at the moment it's
//   simulated to arrive, then resumes normal movement from that angle.
//   Since a rock decays in absolute (unpaused) game time regardless of
//   who it's blocking, remainingMs doubles directly as that rock's
//   absolute expiry time on this forecast's own clock (which starts at
//   0 = "right now"). Previously this simulation ignored rocks
//   entirely, which was silently wrong whenever one was in play -- and
//   is exactly what TRD 2.3's boulder-placement preview needs to be able
//   to show any effect at all.
//
// `units[i].speedModifiers` -- a unit's net speed modifier is the SUM of
//   every currently-active tier it's carrying (combat.js's
//   addSpeedModifier/recomputeSpeedMult), not a single scalar -- a
//   1-tier boost and a LATER 2-tier boost stack into a 3-tier boost, and
//   each one expires independently after 360 degrees of that unit's own
//   actual travel from the moment IT was applied (tickInner()'s
//   advanceSpeedModifiers). This simulation used to treat a unit's
//   modifier as a single permanent speedMult, which both overstated how
//   long a boost actually lasts (a user-caught bug, fixed previously)
//   and couldn't represent stacking at all (this pass). Each modifier's
//   `remaining` is tracked here exactly like a rock's `frozenUntil` is:
//   decremented by real distance travelled each step; when the SOONEST
//   one hits zero, only ITS tier drops out of the total (an 'expire'
//   event, same as before, just per-modifier instead of per-unit now) --
//   later-expiring modifiers keep contributing until their own turn.
//   `speedModifiers` entries are `{ tier, remaining }`; tier > 0 is a
//   speed-up count, tier < 0 a slow-down count, matching combat.js's own
//   convention.
//
// Returns an array of forecast steps in turn order:
//   { id, overseerId, snapshot: [{ id, angle }] }
// `snapshot` is a full copy of every simulated unit's angle at the exact
// moment this step's unit reaches the action line -- what section 3.1's
// Simulation Snapshot mode projects onto the rings.
// `options.extraRequiredIds` -- raw unit ids (not the 'unit:'/'group:' key
//   format) that this run must ALSO see appear at least once as a pushed
//   forecast entry before it's allowed to stop, on top of the normal
//   "every unit/group gets at least one real turn" requirement below.
//   Exists specifically for a live preview's candidate forecast: a
//   bystander belonging to a shared-pool group (Overseer/Hell Lord/
//   Ordeal Inquisitor) only needs ONE dot from that group to satisfy the
//   group's own requirement, so a SPECIFIC other dot from that same group
//   that happened to also get a "bonus" appearance in a longer committed
//   run (simulated further only because the tracked unit used to be
//   slower and take longer to satisfy ITS OWN requirement) has no
//   guarantee of reappearing in a shorter preview run where the
//   now-faster tracked unit stops blocking things sooner -- a real,
//   reported symptom: speeding a unit up made it correctly jump ahead in
//   the queue, but the specific bystanders it jumped ahead of vanished
//   from the display entirely rather than simply shifting later, because
//   the preview's OWN simulation legitimately never ran long enough to
//   need to re-simulate them. Passing every id already visible in the
//   reference (committed) forecast here keeps the preview simulating
//   until each of them gets its own chance to reappear too, so nothing
//   already on screen disappears out from under the player mid-preview.
//   Ignored for any id not present in `units` at all (nothing to wait
//   for), so it's always safe to pass even when the two forecasts don't
//   share their full roster.
export function computeQueueForecast(units, options = {}) {
  const { overseerThresholdCount = 0, overseerThresholdTarget = 0, maxSteps = 150, rocks = [], extraRequiredIds = [] } = options;

  const state = units
    .map((u) => ({
      id: u.id,
      angle: ((u.angle % 360) + 360) % 360,
      baseSpeed: u.speed,
      // Deep-cloned: this simulation mutates `remaining` in place as it
      // runs, and must never touch the live unit's own modifier objects.
      modifiers: (u.speedModifiers || []).map((m) => ({ tier: m.tier, remaining: Math.max(0, m.remaining) })),
      radius: u.radius,
      isOverseerDot: !!u.isOverseerDot,
      overseerId: u.overseerId || null,
      frozenUntil: null, // absolute sim-time this unit is stuck at a rock until, else null
    }))
    .filter((u) => u.baseSpeed > 0);

  if (state.length === 0) return [];

  // A rock's expiresAt is fixed on this forecast's own clock the moment
  // the forecast starts -- it never re-reads live remainingMs mid-loop,
  // same as the rest of this simulation working off a frozen snapshot.
  const rockState = rocks.map((r) => ({
    radius: r.radius,
    angle: ((r.angle % 360) + 360) % 360,
    expiresAt: r.remainingMs,
  }));

  const requiredKeys = new Set([
    ...state.map((u) => (u.overseerId ? 'group:' + u.overseerId : 'unit:' + u.id)),
    ...(() => {
      const stateIds = new Set(state.map((u) => u.id));
      return extraRequiredIds.filter((id) => stateIds.has(id)).map((id) => 'id:' + id);
    })(),
  ]);
  const satisfiedKeys = new Set();

  let threshCount = overseerThresholdCount;
  const threshTarget = overseerThresholdTarget;

  const forecast = [];
  let steps = 0;
  let simTime = 0;

  const candidateKey = (u) => (u.overseerId ? 'group:' + u.overseerId : 'unit:' + u.id);
  // The unit's CURRENT effective angular rate -- the sum of every still-
  // active modifier's tier, converted to a multiplier the same way
  // combat.js's speedMultForTotalTier() does, times its base rate. Never
  // cached on the unit itself: it can change from one iteration to the
  // next purely because time (and therefore each modifier's own
  // countdown) passed, with no discrete event of its own other than
  // whichever modifier's 'expire' fires next.
  const totalTier = (u) => u.modifiers.reduce((sum, m) => sum + m.tier, 0);
  const speedMultFor = (u) => {
    const total = totalTier(u);
    return total >= 0 ? 1 + total * 0.5 : 1 / (1 + Math.abs(total) * 0.5);
  };
  const effectiveSpeed = (u) => u.baseSpeed * speedMultFor(u);
  // The soonest any of this unit's OWN modifiers will expire -- only the
  // minimum matters per iteration, since that's the next thing that can
  // possibly change its rate; a later one gets its own turn once this
  // one's already been removed.
  const soonestModifierRemaining = (u) =>
    u.modifiers.length === 0 ? Infinity : Math.min(...u.modifiers.map((m) => m.remaining));

  while (satisfiedKeys.size < requiredKeys.size && steps < maxSteps) {
    steps++;

    let best = null;
    let bestTime = Infinity;
    let bestType = null; // 'cross' | 'freeze' | 'unfreeze' | 'expire'
    let bestRock = null;

    // On a near-exact tie, prefer whichever candidate hasn't logged its
    // required real turn yet over one that already has -- otherwise two
    // units that end up perfectly in phase (their base speeds are
    // deliberately drawn to avoid this, per the speed-slot table's own
    // comment, but freezing multiple units at the same rock and
    // releasing them together at the same instant can re-sync them
    // regardless of that) tie forever, with the same already-satisfied
    // unit winning every tie and the other one never getting its own
    // entry recorded within maxSteps.
    const considerCandidate = (u, t, type, rock) => {
      const strictlyBetter = t < bestTime - 1e-9;
      const tiedButMoreNeeded =
        Math.abs(t - bestTime) <= 1e-9 &&
        best &&
        satisfiedKeys.has(candidateKey(best)) &&
        !satisfiedKeys.has(candidateKey(u));
      if (strictlyBetter || tiedButMoreNeeded) {
        bestTime = t;
        best = u;
        bestType = type;
        bestRock = rock;
      }
    };

    state.forEach((u) => {
      if (u.frozenUntil !== null) {
        considerCandidate(u, u.frozenUntil - simTime, 'unfreeze', null);
        return;
      }

      const spd = effectiveSpeed(u);
      let distToLine = 360 - u.angle;
      if (distToLine <= 0) distToLine += 360;

      // Nearest live rock on this unit's own radius, strictly ahead of
      // it and before the action line, that will still be there by the
      // time it would arrive (at the unit's CURRENT rate -- if a
      // modifier is about to expire before then, that shows up as this
      // unit's own 'expire' candidate below and gets picked first when
      // it's actually sooner, so the rock's arrival time here just
      // needs to be re-evaluated fresh -- and it is, next iteration --
      // once the rate actually changes).
      let nearestRock = null;
      let nearestDiff = Infinity;
      rockState.forEach((r) => {
        if (r.radius !== u.radius) return;
        const diff = (r.angle - u.angle + 360) % 360;
        if (diff <= 0 || diff > distToLine) return;
        const arrival = simTime + diff / spd;
        if (arrival >= r.expiresAt) return; // gone before it'd get there
        if (diff < nearestDiff) {
          nearestDiff = diff;
          nearestRock = r;
        }
      });

      const lineTime = distToLine / spd;
      const rockTime = nearestRock ? nearestDiff / spd : Infinity;
      const soonestRemaining = soonestModifierRemaining(u);
      const expireTime = soonestRemaining < Infinity ? soonestRemaining / spd : Infinity;

      // Priority on a tie: freeze > cross > expire. A crossing (or a
      // rock) is a consequential event with its own visible effect on
      // the forecast; a modifier merely expiring is not, on its own --
      // if it happens to land at EXACTLY the same instant as a crossing
      // (a real scenario: a modifier applied fresh at the line expires
      // exactly 360 degrees later, i.e. exactly one more lap, landing
      // it back at the line again), the crossing must still be recorded
      // as a real turn. The modifier still correctly drops out of the
      // unit's active set either way, since the shared decrement below
      // runs regardless of which type wins this iteration.
      const minTime = Math.min(lineTime, rockTime, expireTime);
      if (rockTime <= minTime + 1e-9) {
        considerCandidate(u, minTime, 'freeze', nearestRock);
      } else if (lineTime <= minTime + 1e-9) {
        considerCandidate(u, minTime, 'cross', null);
      } else {
        considerCandidate(u, minTime, 'expire', null);
      }
    });
    if (!best) break;

    simTime += bestTime;
    state.forEach((u) => {
      if (u.frozenUntil !== null) return; // frozen units don't move (or count down modifiers -- tickInner() only decrements alongside actual movement, see advanceSpeedModifiers)
      const spd = effectiveSpeed(u);
      const distance = spd * bestTime;
      u.angle = (u.angle + distance) % 360;
      u.modifiers.forEach((m) => {
        m.remaining -= distance;
      });
      u.modifiers = u.modifiers.filter((m) => m.remaining > 0);
    });

    if (bestType === 'unfreeze') {
      best.frozenUntil = null;
      continue;
    }

    if (bestType === 'expire') {
      // The soonest-expiring modifier already got filtered out by the
      // shared decrement above (its `remaining` landed on exactly 0);
      // nothing else to do -- effectiveSpeed() just reflects whatever
      // modifiers are left for it from the next iteration on.
      continue;
    }

    if (bestType === 'freeze') {
      best.angle = bestRock.angle;
      best.frozenUntil = bestRock.expiresAt;
      continue;
    }

    best.angle = 0;

    let isRealTurn = true;
    if (best.isOverseerDot && threshTarget > 0) {
      threshCount++;
      if (threshCount >= threshTarget) {
        threshCount = 0; // mirrors tickInner()'s eventual reset -- see overseerThresholdAwaitingReset's own comment in combat.js for why the real game defers this reset slightly; irrelevant for a forward forecast.
      } else {
        isRealTurn = false;
      }
    }

    if (isRealTurn) {
      const key = best.overseerId ? 'group:' + best.overseerId : 'unit:' + best.id;
      forecast.push({
        id: best.id,
        overseerId: best.overseerId,
        time: simTime,
        snapshot: state.map((u) => ({ id: u.id, angle: u.angle })),
      });
      satisfiedKeys.add(key);
      // Only tracked when actually requested (extraRequiredIds) -- the
      // stopping condition below compares satisfiedKeys.size directly
      // against requiredKeys.size, so unconditionally adding this would
      // inflate satisfiedKeys past requiredKeys and stop the loop early
      // even when this id was never required to begin with.
      const idKey = 'id:' + best.id;
      if (requiredKeys.has(idKey)) satisfiedKeys.add(idKey);
    }
  }

  return forecast;
}

// First 2 letters of a guardian's name, uppercase, alphabetic-only (so
// e.g. "Julius Caesar" -> "JU", multi-word names never pick up a leading
// space). guardian_<pNum> units only -- players already carry a portrait
// and don't need this.
export function getEnemyQueueLabel(unitId, guardianAssignment) {
  if (!unitId || !unitId.startsWith('guardian_')) return null;
  const pNum = Number(unitId.split('_')[1]);
  const g = guardianAssignment[pNum];
  if (!g || !g.name) return '??';
  const letters = g.name.replace(/[^A-Za-z]/g, '');
  return (letters.slice(0, 2) || '??').toUpperCase();
}

// --- RENDERING ---------------------------------------------------------

// Center-to-center spacing between queue icons, in SVG user units --
// fixed regardless of QUEUE_RADIUS, so icons stay snugly packed (not the
// wide gaps a fixed angular step produces once the queue moved out to a
// larger radius). Icons are r=8 with a 2px stroke, so ~20 leaves a small
// but visible gap between neighbors, matching the trainer reference
// images' tight spacing.
const ICON_SPACING = 20;
// Hard display cap -- a defensive ceiling independent of maxSteps above.
// In practice computeQueueForecast() finishes far sooner (every unit
// needs only ONE real turn to satisfy the stop condition), but this keeps
// the runway from ever visually wrapping into itself if speed spread is
// ever pushed unusually high by stacked modifiers.
const MAX_QUEUE_ICONS = 18;

function polarPoint(radius, angleDeg) {
  const rad = (angleDeg - 90) * (Math.PI / 180);
  return { x: Math.cos(rad) * radius, y: Math.sin(rad) * radius };
}

// index 0 (the soonest upcoming turn -- the unit currently ON the action
// line is NOT part of this queue, see renderSpeedQueue's own note) sits
// immediately counter-clockwise of the 12 o'clock Action Line; each
// subsequent (further-future) index continues counter-clockwise behind
// it, per TRD 1.2. The runway itself is what flows clockwise -- as time
// passes, a given queue ENTRY's slot index falls by one and its icon
// visibly travels clockwise toward slot 0 / the line.
//
// Spacing is computed in degrees FROM the fixed pixel spacing above, at
// whatever radius the queue is actually drawn at -- arc length = radius
// x angle(radians), so a constant on-screen gap needs a smaller angular
// step at a larger radius.
function angleForSlot(index, radius) {
  const stepDeg = (ICON_SPACING / radius) * (180 / Math.PI);
  return -(index + 0.5) * stepDeg;
}

// Pool of queue icon DOM groups, keyed by "<unitId>#<occurrenceIndex>"
// (the Nth time this unit appears in THIS render's forecast) rather than
// by raw array index. This is what makes the accordion reflow (TRD 4.3:
// "never teleport abruptly") actually animate a given unit's OWN icon
// sliding between slots instead of just cross-fading whatever happens to
// occupy a fixed slot index frame to frame -- as long as a unit's
// relative order among the OTHER units it's interleaved with doesn't
// change (true for every bystander during a single unit's gesture
// preview, since only the dragged unit's own rate/position changed), its
// occurrence key stays the same across frames even as its slot index
// moves, so the same pooled <g> just eases toward a new angle.
const iconPool = new Map();
// How much of the remaining distance to the target angle each icon
// closes per render call (~once per animation frame, matching
// tickInner's own rAF cadence) -- a simple per-frame lerp toward the
// target, which reads as an ease-out curve (fast at first, slowing as it
// nears the target) without needing tickInner's fixed-duration
// start/end/startTime tween machinery. That fixed-duration approach (see
// its knockback tween) assumes a target that's set once and holds still;
// a queue slot's target angle can change continuously frame to frame
// (every tick as the rings move, or every pointermove during a live
// preview drag), which a simple convergent lerp handles gracefully and a
// fixed-duration tween does not.
const QUEUE_EASE = 0.28;

function keyForOccurrence(id, occurrenceCounts) {
  const n = occurrenceCounts.get(id) || 0;
  occurrenceCounts.set(id, n + 1);
  return id + '#' + n;
}

// Builds the "face" every icon-like element in this module shares: a
// colored circle, a clip-masked portrait image (shown when the unit has
// one), and a 2-letter label (shown otherwise, for guardians). Used by
// the full queue icon below (which adds a selection ring and an anchor
// glyph on top) AND the preview-overlay ghost (which uses this alone, at
// reduced opacity, as a translucent copy of the real icon rather than a
// plain dashed placeholder circle).
function buildIconFace(r) {
  const g = document.createElementNS(SVG_NS, 'g');

  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('r', String(r));
  circle.setAttribute('stroke', '#000');
  circle.setAttribute('stroke-width', '1.5');
  g.appendChild(circle);

  const clipId = 'icon-clip-' + Math.random().toString(36).slice(2);
  const clipPath = document.createElementNS(SVG_NS, 'clipPath');
  clipPath.id = clipId;
  const clipCircle = document.createElementNS(SVG_NS, 'circle');
  clipCircle.setAttribute('r', String(r));
  clipPath.appendChild(clipCircle);
  g.appendChild(clipPath);

  const img = document.createElementNS(SVG_NS, 'image');
  img.setAttribute('x', String(-r));
  img.setAttribute('y', String(-r));
  img.setAttribute('width', String(r * 2));
  img.setAttribute('height', String(r * 2));
  img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  img.setAttribute('clip-path', `url(#${clipId})`);
  img.style.display = 'none';
  g.appendChild(img);

  const label = document.createElementNS(SVG_NS, 'text');
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('dy', '0.35em');
  label.setAttribute('font-family', 'monospace');
  label.setAttribute('font-weight', '900');
  label.setAttribute('font-size', String(Math.round(r)));
  label.setAttribute('fill', '#fff');
  label.style.pointerEvents = 'none';
  g.appendChild(label);

  return { g, circle, img, label };
}

// Fills in an already-built face's color + portrait/label for a given
// unit -- shared by the queue icon pool and the preview-overlay ghost so
// "what does unit X look like" is computed in exactly one place.
function paintIconFace(face, unit, guardianAssignment) {
  face.circle.setAttribute('fill', unit.color);
  if (unit.iconUrl) {
    face.img.setAttribute('href', unit.iconUrl);
    face.img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', unit.iconUrl);
    face.img.style.display = '';
    face.label.textContent = '';
  } else {
    face.img.style.display = 'none';
    face.label.textContent = getEnemyQueueLabel(unit.id, guardianAssignment) || '';
  }
}

function makeQueueIcon(layer) {
  const face = buildIconFace(8);
  const g = face.g;
  g.classList.add('queue-icon');
  g.style.cursor = 'pointer';

  const ring = document.createElementNS(SVG_NS, 'circle');
  ring.setAttribute('r', '10');
  ring.setAttribute('fill', 'none');
  ring.setAttribute('stroke', '#fff');
  ring.setAttribute('stroke-width', '2');
  ring.style.opacity = '0';
  // The selection ring draws BEHIND the face (inserted first), matching
  // the original visual (a white outline showing through/around the
  // icon, not on top of the portrait).
  g.insertBefore(ring, g.firstChild);

  const anchorGlyph = document.createElementNS(SVG_NS, 'g');
  anchorGlyph.setAttribute('transform', 'translate(6,-6) scale(0.32)');
  anchorGlyph.style.opacity = '0';
  anchorGlyph.style.pointerEvents = 'none';
  anchorGlyph.innerHTML =
    '<circle r="9" fill="#1a1a1f" stroke="#fff" stroke-width="1.5"/>' +
    '<path d="M0 -10 L0 8 M-7 4 C-7 10 7 10 7 4" stroke="white" stroke-width="3.5" fill="none"/>' +
    '<circle cx="0" cy="-12" r="3.5" stroke="white" stroke-width="2.5" fill="none"/>' +
    '<line x1="-5" y1="-4" x2="5" y2="-4" stroke="white" stroke-width="3" />';
  g.appendChild(anchorGlyph);

  layer.appendChild(g);
  return { g, ring, circle: face.circle, img: face.img, label: face.label, anchorGlyph, visualAngle: null, lastSeenAt: 0 };
}

function getPoolIcon(layer, key) {
  let icon = iconPool.get(key);
  if (!icon) {
    icon = makeQueueIcon(layer);
    iconPool.set(key, icon);
  }
  return icon;
}

// `liveUnitsById` -- Map of id -> live unit object (for .color/.iconUrl/
//   .anchored), so the queue can mirror exactly what's on the rings
//   without duplicating that state.
// `onTapIcon(entry, index)` -- called on pointerdown of a queue icon;
//   combat.js owns what tapping means (simulation snapshot toggle, see
//   below).
// `selectedIndex` -- currently snapshotted slot, or null; highlighted
//   with the white outline ring per TRD 3.1 ("unhighlight the queue
//   icon" on clear).
export function renderSpeedQueue({
  layer,
  forecast,
  liveUnitsById,
  guardianAssignment,
  radius,
  onTapIcon,
  selectedIndex,
}) {
  const shown = Math.min(forecast.length, MAX_QUEUE_ICONS);
  const occurrenceCounts = new Map();
  const seenKeys = new Set();
  const now = Date.now();

  for (let i = 0; i < shown; i++) {
    const entry = forecast[i];
    // Reserved gap for a queue-preview ghost (see buildExpandedQueueDisplay)
    // -- this slot index is intentionally left with no REAL icon so the
    // tracked unit's old position stays vacant on-screen rather than being
    // reflowed into by a bystander (which used to land it exactly on top
    // of the ghost drawn there -- see that function's own header comment).
    // Still consumes slot `i` in the angleForSlot() numbering by simply
    // not rendering anything this iteration, which is what leaves the gap.
    if (entry.isGhostPlaceholder) continue;
    const unit = liveUnitsById.get(entry.id);
    const key = keyForOccurrence(entry.id, occurrenceCounts);
    if (!unit) continue;

    seenKeys.add(key);
    const icon = getPoolIcon(layer, key);
    icon.lastSeenAt = now;

    const targetAngle = angleForSlot(i, radius);
    icon.visualAngle = icon.visualAngle === null ? targetAngle : icon.visualAngle + (targetAngle - icon.visualAngle) * QUEUE_EASE;

    const pos = polarPoint(radius, icon.visualAngle);
    icon.g.style.opacity = '1';
    icon.g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
    icon.ring.style.opacity = selectedIndex === i ? '1' : '0';
    paintIconFace(icon, unit, guardianAssignment);
    icon.anchorGlyph.style.opacity = unit.anchored ? '1' : '0';

    icon.g.onpointerdown = (e) => {
      e.stopPropagation();
      if (onTapIcon) onTapIcon(entry, i);
    };
  }

  // Anything not touched this render hides. Pooled rather than removed
  // (same reasoning as everywhere else in this codebase that pools DOM
  // nodes) so a unit that reappears in the forecast a moment later --
  // very possible frame to frame during a live preview drag -- reuses
  // its own element and keeps its in-flight visualAngle tween instead of
  // popping back in from scratch.
  iconPool.forEach((icon, key) => {
    if (seenKeys.has(key)) return;
    icon.g.style.opacity = '0';
    icon.g.onpointerdown = null;
    // Stale entries (untouched for 5s+ -- well past any single gesture
    // or forecast-length fluctuation) are actually removed, so a long
    // combat with lots of defeated/replaced units doesn't grow this Map
    // forever.
    if (now - icon.lastSeenAt > 5000) {
      icon.g.remove();
      iconPool.delete(key);
    }
  });
}

// --- GESTURE PREVIEW OVERLAY (TRD 2.1/2.2) -----------------------------
//
// This went through three prior designs based on direct, iterative user
// feedback, each solving one collision but introducing another:
//   1. Dashed placeholder circle at the old slot -> ambiguous which unit
//      was moving when a bystander's REAL icon slid into the same slot
//      mid-transition.
//   2. Ghost icon copy (a translucent clone of the unit's own face,
//      instead of a dashed circle) at the old slot, WITH bystanders
//      reflowing to close the gap -- fixed the ambiguity, but reflowing
//      bystanders INTO the vacated old slot put a bystander's real icon
//      at that exact same angleForSlot() index as the ghost, so the two
//      still visually collided (just with a clearer ghost image instead
//      of a dashed circle).
//   3. Current design, below: bystanders no longer reflow INTO the
//      tracked unit's old slot at all -- buildExpandedQueueDisplay()
//      inserts an actual reserved gap into the rendered queue (see its
//      own comment), so the old slot stays genuinely empty of any real
//      icon for the ghost to sit in, and the tracked unit's real icon
//      lands one slot further out than it otherwise would, to make room.
//      This overlay's job stays the same either way: draw the ghost (its
//      old-slot position) and the tracking arrow to its real icon's new
//      position -- both positions are now passed in pre-computed by
//      buildExpandedQueueDisplay() rather than looked up here via
//      findIndex on the raw forecasts, since the SLOTS that matter are
//      the expanded ones actually being rendered, not the raw forecast
//      array indices. Pooled by unitId (a knockback/speed drag only ever
//      tracks one; a rally or boulder placement can affect several units
//      at once -- see TRD 2.3/2.4's own "could impact multiple units"
//      language).
const previewOverlayPool = new Map();

// Builds the "reserved gap" queue layout used while a live preview
// (knockback/speed drag, boulder placement, rally, etc.) is active. Per
// explicit user feedback + a mockup (round 3 of this feature's visual
// design -- see the GESTURE PREVIEW OVERLAY comment above for the two
// earlier attempts this replaced): a bystander reflowing into a tracked
// unit's just-vacated old slot lands on the exact same angleForSlot()
// index as the ghost drawn there, so the fix is to stop reflowing bystanders
// into that slot at all -- insert an actual placeholder into the
// rendered queue at the old slot instead, so the whole row's slot count
// temporarily grows by one for every unit actually being tracked+moved
// this frame, bystanders shift OUTWARD around the reserved gap rather
// than into it, and the tracked unit's own real icon ends up one slot
// further along than its raw preview-forecast index would suggest, to
// make room. Bystanders are assumed to keep the same relative order in
// both `committedForecast` and `previewForecast` (true for every
// knockback/speed/rally/boulder preview this module handles -- only the
// tracked unit(s)' own order relative to everyone else changes), which
// is what lets each bystander's finished slot be computed purely from
// where its neighbors fall in each forecast, independent of exactly how
// many other units are simultaneously being tracked.
//
// Returns:
//   expandedForecast -- pass directly as renderSpeedQueue's `forecast`.
//     Real entries are the actual forecast objects (so onTapIcon etc.
//     keep working normally); reserved-gap slots are minimal
//     `{ isGhostPlaceholder: true }` markers that renderSpeedQueue skips
//     over (still consuming that slot index, which is what leaves the
//     visible gap).
//   slotsByUnitId -- Map<unitId, { oldSlot, newSlot }> giving each
//     actually-moved tracked unit's ghost slot and real slot in the
//     EXPANDED numbering above, for renderQueuePreviewOverlay to feed
//     straight into angleForSlot() -- units that aren't in `trackedIds`,
//     aren't in both forecasts, or didn't actually change slot are
//     simply absent from this map (nothing to draw for them).
export function buildExpandedQueueDisplay({ committedForecast, previewForecast, trackedIds }) {
  const movedIds = trackedIds.filter((id) => {
    const oldIndex = committedForecast.findIndex((e) => e.id === id);
    const newIndex = previewForecast.findIndex((e) => e.id === id);
    return oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex;
  });

  if (movedIds.length === 0) {
    return { expandedForecast: previewForecast, slotsByUnitId: new Map() };
  }

  const movedSet = new Set(movedIds);
  // FIRST-occurrence entry of each id in each forecast -- looked up by
  // hand (not `new Map(arr.map((e,i) => [e.id,e]))`, which keeps the LAST
  // matching entry instead, each repeat overwriting the one before it). A
  // fast enough unit legitimately appears more than once in a single
  // forecast (it laps the line again before someone slower gets even
  // their first turn -- see computeQueueForecast's own "fast unit laps a
  // slow one" test), and that repeat entry is exactly the shape a
  // speed-up preview produces: the tracked unit's FIRST occurrence is the
  // very turn moving up is about, but the overwrite bug pointed
  // oldEntry/newEntry at whichever occurrence happened to be simulated
  // LAST instead -- silently substituting a LATER lap for the soonest
  // one, which is indistinguishable from "the unit's turn got skipped"
  // from the display's own perspective (a real, reported symptom: a unit
  // sped up enough to lap someone before that bystander's own first turn
  // rendered as if it had fallen BEHIND that bystander, recovering only
  // once the real game actually played forward past it).
  function firstEntryOf(forecastArr, id) {
    return forecastArr.find((e) => e.id === id);
  }

  // Bystanders, each carrying its own simulated crossing TIME (see
  // computeQueueForecast's own `time: simTime` field) -- the axis ghost/
  // real placement is computed against below, INSTEAD of array index.
  // Array index is not a sound way to compare a bystander's position
  // against the tracked unit's old/new turn: `committedForecast` and
  // `previewForecast` can end up completely different LENGTHS, with
  // completely different numbers of bystander repeat-laps, whenever the
  // tracked unit's own change shifts how long each simulation has to run
  // before every unit has had at least one turn -- a unit getting SLOWER
  // is the common case, since the preview then has to simulate much
  // further, so bystanders rack up extra laps in the preview that have no
  // counterpart in the committed array at all. An earlier version of this
  // function tried to pair up each bystander's Nth committed occurrence
  // with its Nth preview occurrence to work around exactly this, but that
  // pairing silently fell apart (falling back to a bystander's LAST known
  // occurrence for every extra lap beyond what committedForecast even
  // simulated) whenever the two forecasts' lengths diverged this way --
  // a real, reported symptom: knock a unit back far enough to force a
  // much longer preview simulation, and its ghost (its own CURRENT
  // position) rendered LATER than its own post-knockback real icon, i.e.
  // the two were effectively swapped. A bystander's own crossing TIME,
  // unlike its array index, is identical in both simulations regardless
  // (nothing about the tracked unit's angle/speed affects anyone else's
  // physics), so time is directly comparable across the two forecasts no
  // matter how differently shaped they end up.
  const working = previewForecast
    .filter((e) => !movedSet.has(e.id))
    .map((e) => ({ kind: 'bystander', id: e.id, entry: e }));

  // Finds the array index right after the LAST bystander entry currently
  // in `working` whose own crossing time is before `time` -- i.e. where a
  // new item belongs so it ends up positioned immediately after that
  // bystander (or at the very start, if none match). Only ever counts
  // `kind: 'bystander'` entries, so ghost/real slots already inserted for
  // OTHER tracked units never skew this -- each insertion is placed
  // purely relative to the bystanders, independent of insertion order.
  function insertionIndex(time) {
    let pos = 0;
    for (let i = 0; i < working.length; i++) {
      if (working[i].kind === 'bystander' && working[i].entry.time < time) pos = i + 1;
    }
    return pos;
  }

  movedIds.forEach((id) => {
    if (!movedSet.has(id)) return; // guards a duplicate id in trackedIds
    const oldEntry = firstEntryOf(committedForecast, id);
    const newEntry = firstEntryOf(previewForecast, id);

    const ghostPos = insertionIndex(oldEntry.time);
    working.splice(ghostPos, 0, { kind: 'ghost', id });

    const realPos = insertionIndex(newEntry.time);
    working.splice(realPos, 0, { kind: 'real', id, entry: newEntry });
  });

  const expandedForecast = [];
  const slotsByUnitId = new Map();
  working.forEach((w, slot) => {
    if (w.kind === 'ghost') {
      const prior = slotsByUnitId.get(w.id) || {};
      slotsByUnitId.set(w.id, { ...prior, oldSlot: slot });
      expandedForecast.push({ isGhostPlaceholder: true, id: w.id });
    } else if (w.kind === 'real') {
      const prior = slotsByUnitId.get(w.id) || {};
      slotsByUnitId.set(w.id, { ...prior, newSlot: slot });
      expandedForecast.push(w.entry);
    } else {
      expandedForecast.push(w.entry);
    }
  });

  return { expandedForecast, slotsByUnitId };
}

function getPreviewOverlayIcon(layer, unitId) {
  let overlay = previewOverlayPool.get(unitId);
  if (overlay) return overlay;

  const arrow = document.createElementNS(SVG_NS, 'path');
  arrow.setAttribute('fill', 'none');
  arrow.setAttribute('stroke-width', '2');
  arrow.setAttribute('stroke-linecap', 'round');
  arrow.style.pointerEvents = 'none';
  arrow.style.opacity = '0';
  layer.appendChild(arrow);

  const arrowHead = document.createElementNS(SVG_NS, 'polygon');
  arrowHead.style.pointerEvents = 'none';
  arrowHead.style.opacity = '0';
  layer.appendChild(arrowHead);

  // A 50%-opacity copy of the unit's own face (same circle/portrait/
  // label as its real queue icon), not a generic dashed placeholder --
  // reads unambiguously as "this specific unit, where it used to be."
  const ghostFace = buildIconFace(8);
  ghostFace.g.style.pointerEvents = 'none';
  ghostFace.g.style.opacity = '0';
  layer.appendChild(ghostFace.g);

  overlay = { arrow, arrowHead, ghost: ghostFace };
  previewOverlayPool.set(unitId, overlay);
  return overlay;
}

// `slotsByUnitId` -- the Map returned by buildExpandedQueueDisplay(),
//   giving each actually-moved tracked unit's { oldSlot, newSlot } in the
//   SAME expanded slot numbering that renderSpeedQueue is drawing the
//   rest of the queue with (see that function's own comment for why this
//   can no longer be recomputed here via a plain findIndex on the raw
//   forecasts -- the reserved-gap slot a unit lands in depends on how
//   many OTHER tracked units' gaps fall between it and its neighbors).
// `unitIds` -- every unit the live preview is tracking (a single-element
//   array for a knockback/speed drag; several for a rally or boulder
//   placement that can move/block more than one unit at once) -- used
//   only to know which pooled overlays to hide when a previously-tracked
//   unit is no longer moving (dropped from `slotsByUnitId`), without
//   wiping every tracked unit's overlay just because one stopped moving.
export function renderQueuePreviewOverlay({
  layer,
  slotsByUnitId,
  unitIds,
  radius,
  liveUnitsById,
  guardianAssignment,
}) {
  const stillTracked = new Set();

  unitIds.forEach((unitId) => {
    const unit = liveUnitsById.get(unitId);
    const slots = slotsByUnitId.get(unitId);

    if (!unit || !slots || slots.oldSlot === undefined || slots.newSlot === undefined) {
      const stale = previewOverlayPool.get(unitId);
      if (stale) {
        stale.arrow.style.opacity = '0';
        stale.arrowHead.style.opacity = '0';
        stale.ghost.g.style.opacity = '0';
      }
      return;
    }

    const { oldSlot: oldIndex, newSlot: newIndex } = slots;
    stillTracked.add(unitId);
    const overlay = getPreviewOverlayIcon(layer, unitId);

    const oldAngle = angleForSlot(oldIndex, radius);
    const newAngle = angleForSlot(newIndex, radius);
    const oldPos = polarPoint(radius, oldAngle);
    const newPos = polarPoint(radius, newAngle);

    overlay.ghost.g.setAttribute('transform', `translate(${oldPos.x}, ${oldPos.y})`);
    paintIconFace(overlay.ghost, unit, guardianAssignment);
    overlay.ghost.g.style.opacity = '0.5';

    // The tracking arrow points at newPos, which is exactly where
    // renderSpeedQueue's own reserved-gap layout (buildExpandedQueueDisplay)
    // is independently placing this unit's real, full-opacity pooled
    // icon this frame -- this overlay never draws a second copy of the
    // unit at its new position, only the ghost at the old one plus the
    // arrow connecting the two.
    // monotonically decreasing as index grows -- see its own comment),
    // so newIndex < oldIndex means the unit moved toward the line
    // (speed up / rally) and sweeps clockwise; newIndex > oldIndex means
    // it fell back (knockback / slow down / boulder) and sweeps
    // counter-clockwise.
    const movingForward = newIndex < oldIndex;
    const sweepFlag = movingForward ? 1 : 0;
    overlay.arrow.setAttribute(
      'd',
      `M ${oldPos.x} ${oldPos.y} A ${radius} ${radius} 0 0 ${sweepFlag} ${newPos.x} ${newPos.y}`
    );
    overlay.arrow.setAttribute('stroke', unit.color);
    overlay.arrow.style.opacity = '0.9';

    // Arrowhead at newPos, oriented along the arc's tangent direction
    // there. angleForSlot's output feeds polarPoint the same way a ring
    // token's own angle does, so the tangent for INCREASING angleDeg at
    // a given point is radius*(-sin(rad), cos(rad)); moving toward a
    // smaller index means angleDeg is increasing there (angleForSlot is
    // a decreasing function of index), so that tangent is used as-is
    // when movingForward, and flipped otherwise.
    const rad = (newAngle - 90) * (Math.PI / 180);
    let tx = -Math.sin(rad);
    let ty = Math.cos(rad);
    if (!movingForward) {
      tx = -tx;
      ty = -ty;
    }
    const px = -ty;
    const py = tx;
    const tip = { x: newPos.x + tx * 6, y: newPos.y + ty * 6 };
    const backL = { x: newPos.x - tx * 3 + px * 3.5, y: newPos.y - ty * 3 + py * 3.5 };
    const backR = { x: newPos.x - tx * 3 - px * 3.5, y: newPos.y - ty * 3 - py * 3.5 };
    overlay.arrowHead.setAttribute(
      'points',
      `${tip.x},${tip.y} ${backL.x},${backL.y} ${backR.x},${backR.y}`
    );
    overlay.arrowHead.setAttribute('fill', unit.color);
    overlay.arrowHead.style.opacity = '0.9';
  });

  // Any pooled overlay not tracked (or not moved) this render hides --
  // pooled rather than removed so a unit that's still being tracked next
  // frame (the common case, every frame of a live drag) reuses its own
  // elements instead of recreating them.
  previewOverlayPool.forEach((overlay, unitId) => {
    if (stillTracked.has(unitId)) return;
    overlay.arrow.style.opacity = '0';
    overlay.arrowHead.style.opacity = '0';
    overlay.ghost.g.style.opacity = '0';
  });
}

export function clearQueuePreviewOverlay() {
  previewOverlayPool.forEach((overlay) => {
    overlay.arrow.style.opacity = '0';
    overlay.arrowHead.style.opacity = '0';
    overlay.ghost.g.style.opacity = '0';
  });
}

// Fully resets the queue's pooled DOM state -- call once per new combat
// (startCombat) so a fresh fight never inherits stale tween state or
// leftover elements from the previous one.
export function resetQueuePool() {
  iconPool.forEach((icon) => icon.g.remove());
  iconPool.clear();
  previewOverlayPool.forEach((overlay) => {
    overlay.arrow.remove();
    overlay.arrowHead.remove();
    overlay.ghost.g.remove();
  });
  previewOverlayPool.clear();
  Object.keys(snapshotGhosts).forEach((id) => {
    snapshotGhosts[id].g.remove();
    delete snapshotGhosts[id];
  });
}

// --- SIMULATION SNAPSHOT (TRD 3.1) -------------------------------------

// Ghost icons projected onto BOTH rings for a snapshot -- a separate pool
// from combat.js's own drag-preview speedGhostDots, since the two modes
// (mid-gesture forecast vs. tap-to-freeze snapshot) are never active at
// the same time but are conceptually distinct and it keeps this module
// fully self-contained. Built from the same buildIconFace()/paintIconFace()
// pair as the queue icon pool and the gesture-preview overlay's ghost
// above, so all three forecast/preview treatments read as the same visual
// language: a 50%-opacity copy of the unit's own face, not a dashed
// placeholder circle (the dashed-circle version this replaced made it
// harder to tell which unit a projected dot belonged to, inconsistent
// with the low-opacity "clone" already used for the speed-ring forecast
// dots and the gesture-preview ghost).
const snapshotGhosts = {};

export function showQueueSnapshot(layer, snapshotEntries, liveUnitsById, guardianAssignment) {
  const stillNeeded = new Set();
  snapshotEntries.forEach(({ id, angle }) => {
    const unit = liveUnitsById.get(id);
    if (!unit) return;
    stillNeeded.add(id);

    let ghost = snapshotGhosts[id];
    if (!ghost) {
      const face = buildIconFace(8);
      face.g.style.pointerEvents = 'none';
      layer.appendChild(face.g);
      ghost = face;
      snapshotGhosts[id] = ghost;
    }

    const pos = polarPoint(unit.radius, angle);
    ghost.g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
    paintIconFace(ghost, unit, guardianAssignment);
    ghost.g.style.opacity = '0.5';
  });

  Object.keys(snapshotGhosts).forEach((id) => {
    if (!stillNeeded.has(id)) snapshotGhosts[id].g.style.opacity = '0';
  });
}

export function clearQueueSnapshot() {
  Object.values(snapshotGhosts).forEach((ghost) => {
    ghost.g.style.opacity = '0';
  });
}
