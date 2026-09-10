// speedQueue.test.mjs
//
// Standalone regression tests for the PURE logic half of the speed queue
// (computeQueueForecast, getEnemyQueueLabel) -- no browser, no DOM, no
// app state. Run with:
//
//   node combat/speedQueue.test.mjs
//
// This covers everything that's testable in isolation: turn ordering,
// lap-repeats, shared-boss grouping, speed-modifier decay/stacking, rock
// blocking, and the tie-breaking rules. It does NOT cover anything that
// needs the actual DOM/gestures/UI (drag previews, the split commit/
// cancel buttons, the simulation snapshot's rendering, undo/redo) --
// see SPEED_QUEUE_MANUAL_TEST_PLAN.md for a checklist covering those.
//
// Re-run this any time the forecast engine changes. A green run here
// doesn't guarantee the UI wiring in combat.js is bug-free (several of
// the bugs found so far were in HOW combat.js called this engine, not in
// the engine itself) -- it guarantees the underlying math is sound,
// which is a necessary but not sufficient condition.

import assert from 'node:assert/strict';
import { computeQueueForecast, getEnemyQueueLabel } from './speedQueue.js';

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`      ${err.message}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// --- BASIC ORDERING -------------------------------------------------

section('Basic ordering');

test('faster unit (closer to line) goes first', () => {
  const units = [
    { id: 'player_1', angle: 350, speed: 0.18, radius: 150 },
    { id: 'player_2', angle: 300, speed: 0.19, radius: 150 },
  ];
  const order = computeQueueForecast(units).map((e) => e.id);
  assert.deepEqual(order, ['player_1', 'player_2']);
});

test('a unit exactly at the line (angle 0) is NOT auto-included -- forecast is future turns only', () => {
  const units = [
    { id: 'player_1', angle: 0, speed: 0.1, radius: 150 },
    { id: 'player_2', angle: 180, speed: 0.1, radius: 150 },
  ];
  // player_1 starts at the line, so its "next" crossing is a full lap
  // away (360), same distance player_2 needs from 180 is only 180 -- so
  // player_2 should come first despite player_1 already being "at" 0.
  const order = computeQueueForecast(units).map((e) => e.id);
  assert.deepEqual(order, ['player_2', 'player_1']);
});

test('fast unit laps a slow one -- appears multiple times before the slow unit gets its turn', () => {
  const units = [
    { id: 'player_1', angle: 350, speed: 0.2, radius: 150 },
    { id: 'guardian_1', angle: 10, speed: 0.05, radius: 130 },
  ];
  const order = computeQueueForecast(units, { maxSteps: 30 }).map((e) => e.id);
  const firstGuardianIdx = order.indexOf('guardian_1');
  assert.ok(firstGuardianIdx > 1, `expected player_1 to repeat before guardian_1's first turn, got: ${order}`);
  assert.equal(order[order.length - 1], 'guardian_1');
});

test('empty unit list returns empty forecast, no crash', () => {
  assert.deepEqual(computeQueueForecast([]), []);
});

test('all-zero-speed units are filtered out -- empty forecast, no crash/hang', () => {
  const units = [
    { id: 'player_1', angle: 0, speed: 0, radius: 150 },
    { id: 'player_2', angle: 0, speed: 0, radius: 150 },
  ];
  assert.deepEqual(computeQueueForecast(units), []);
});

// --- SHARED-BOSS GROUPING (Overseer / Hell Lord / Ordeal Inquisitor) --

section('Shared-boss grouping (overseerId)');

test('a 4-dot shared group needs only ONE dot to trigger the threshold -- not one turn per dot', () => {
  const units = [
    { id: 'player_1', angle: 350, speed: 0.18, radius: 150 },
    { id: 'player_2', angle: 300, speed: 0.19, radius: 150 },
    { id: 'guardian_1', angle: 340, speed: 0.13, radius: 130, isOverseerDot: true, overseerId: 'boss' },
    { id: 'guardian_2', angle: 280, speed: 0.14, radius: 130, isOverseerDot: true, overseerId: 'boss' },
    { id: 'guardian_3', angle: 220, speed: 0.15, radius: 130, isOverseerDot: true, overseerId: 'boss' },
    { id: 'guardian_4', angle: 100, speed: 0.11, radius: 130, isOverseerDot: true, overseerId: 'boss' },
  ];
  const forecast = computeQueueForecast(units, { overseerThresholdCount: 0, overseerThresholdTarget: 4 });
  const groupEntries = forecast.filter((e) => e.overseerId === 'boss');
  assert.equal(groupEntries.length, 1, `expected exactly one shared-boss entry, got ${groupEntries.length}: ${JSON.stringify(forecast)}`);
  // and the forecast should be short overall (this is the regression
  // check for the bug where a missing overseerId made the sim run to
  // maxSteps trying to satisfy every dot independently)
  assert.ok(forecast.length < 15, `forecast blew up to ${forecast.length} entries -- looks like the grouping bug is back`);
});

test('REGRESSION: dots missing overseerId are treated as independent units (this is what the old bug looked like)', () => {
  // Same setup as above but with overseerId stripped -- demonstrates
  // what goes wrong if that field is ever accidentally dropped again
  // (e.g. a future refactor of unit creation). This test intentionally
  // documents the BROKEN behavior so a future change that "fixes" this
  // test by making it pass would be a red flag, not a fix.
  const units = [
    { id: 'player_1', angle: 350, speed: 0.18, radius: 150 },
    { id: 'guardian_1', angle: 340, speed: 0.13, radius: 130, isOverseerDot: true },
    { id: 'guardian_2', angle: 280, speed: 0.14, radius: 130, isOverseerDot: true },
    { id: 'guardian_3', angle: 220, speed: 0.15, radius: 130, isOverseerDot: true },
    { id: 'guardian_4', angle: 100, speed: 0.11, radius: 130, isOverseerDot: true },
  ];
  const forecast = computeQueueForecast(units, { overseerThresholdCount: 0, overseerThresholdTarget: 4, maxSteps: 150 });
  // Without overseerId, each dot needs its OWN threshold-worth of
  // pass-throughs -- this should produce a much longer forecast (or hit
  // maxSteps) than the grouped version above. If this assertion ever
  // fails because the forecast came back SHORT, something changed in
  // how ungrouped dots are handled -- worth a second look either way.
  assert.ok(forecast.length > 15, `expected the ungrouped case to be much longer than the grouped one, got ${forecast.length}`);
});

test('two SEPARATE shared-boss groups in the same fight are tracked independently', () => {
  const units = [
    { id: 'player_1', angle: 0, speed: 0.15, radius: 150 },
    { id: 'guardian_1', angle: 340, speed: 0.13, radius: 130, isOverseerDot: true, overseerId: 'boss_A' },
    { id: 'guardian_2', angle: 300, speed: 0.14, radius: 130, isOverseerDot: true, overseerId: 'boss_A' },
    { id: 'guardian_3', angle: 200, speed: 0.12, radius: 130, isOverseerDot: true, overseerId: 'boss_B' },
    { id: 'guardian_4', angle: 100, speed: 0.16, radius: 130, isOverseerDot: true, overseerId: 'boss_B' },
  ];
  const forecast = computeQueueForecast(units, { overseerThresholdCount: 0, overseerThresholdTarget: 2, maxSteps: 100 });
  const groups = new Set(forecast.filter((e) => e.overseerId).map((e) => e.overseerId));
  assert.deepEqual([...groups].sort(), ['boss_A', 'boss_B'], `expected both groups represented independently, got groups: ${[...groups]}`);
});

test('REGRESSION: a just-tripped threshold must NOT be forecast as still being at target -- the reset is immediate for forecasting purposes', () => {
  // Mirrors exactly what combat.js's overseerThresholdAwaitingReset gap
  // caused: the real game keeps overseerThresholdCount PINNED at target
  // (e.g. 4/4) for as long as the resulting turn is displayed, only
  // resetting to 0 once the player dismisses it. Feeding that raw,
  // still-at-target count into the forecast (instead of the 0 it's
  // guaranteed to become) makes the very next dot crossing look like
  // enough to trigger ANOTHER shared turn immediately, when a full fresh
  // cycle is actually required -- pushing the boss's next real turn out
  // much further in simulated time than the buggy version shows.
  //
  // Calibrated with a slow bystander player whose own arrival sits
  // between "just one more crossing" and "a full fresh 4-crossing
  // cycle": the buggy (pinned-at-target) version should place the boss's
  // next turn BEFORE that bystander; the correct (reset-to-0) version
  // should place it AFTER.
  const guardians = [
    { id: 'guardian_1', angle: 340, speed: 0.13, radius: 130, isOverseerDot: true, overseerId: 'boss' },
    { id: 'guardian_2', angle: 300, speed: 0.14, radius: 130, isOverseerDot: true, overseerId: 'boss' },
    { id: 'guardian_3', angle: 200, speed: 0.15, radius: 130, isOverseerDot: true, overseerId: 'boss' },
    { id: 'guardian_4', angle: 100, speed: 0.16, radius: 130, isOverseerDot: true, overseerId: 'boss' },
  ];
  const bystander = { id: 'player_1', angle: 0, speed: 0.45, radius: 150 };
  const units = [...guardians, bystander];

  const buggy = computeQueueForecast(units, { overseerThresholdCount: 4, overseerThresholdTarget: 4, maxSteps: 200 });
  const correct = computeQueueForecast(units, { overseerThresholdCount: 0, overseerThresholdTarget: 4, maxSteps: 200 });

  const indexRelativeToBystander = (forecast) => {
    const bossIdx = forecast.findIndex((e) => e.overseerId === 'boss');
    const bystanderIdx = forecast.findIndex((e) => e.id === 'player_1');
    return bossIdx - bystanderIdx; // negative = boss comes first
  };

  assert.ok(indexRelativeToBystander(buggy) < 0, 'expected the buggy (pinned-at-target) version to trigger the boss before the slow bystander');
  assert.ok(indexRelativeToBystander(correct) > 0, 'expected the correct (reset-to-0) version to need a full fresh cycle, landing AFTER the slow bystander');
});

// --- SPEED MODIFIER DECAY & STACKING ----------------------------------

section('Speed modifier decay & stacking');

test('a single boost expires after 360 degrees of travel, not permanently', () => {
  const units = [
    { id: 'player_1', angle: 1, speed: 0.15, speedModifiers: [{ tier: 3, remaining: 360 }], radius: 150 },
    { id: 'player_2', angle: 200, speed: 0.15, speedModifiers: [], radius: 150 },
    { id: 'guardian_1', angle: 0, speed: 0.05, speedModifiers: [], radius: 130 },
  ];
  const order = computeQueueForecast(units, { maxSteps: 60 }).map((e) => e.id);
  // player_1 should get exactly ONE early turn from the boost, then
  // settle into roughly fair alternation with player_2 -- not dominate
  // indefinitely.
  const p1Count = order.slice(0, 6).filter((id) => id === 'player_1').length;
  const p2Count = order.slice(0, 6).filter((id) => id === 'player_2').length;
  assert.ok(Math.abs(p1Count - p2Count) <= 1, `expected roughly fair alternation after the boost expires, got: ${order}`);
});

test('two same-direction boosts stack additively (1-tier + 2-tier = 3-tier) while both are active', () => {
  const units = [
    { id: 'player_1', angle: 0, speed: 0.1, speedModifiers: [
        { tier: 1, remaining: 200 },
        { tier: 2, remaining: 360 },
      ], radius: 150 },
    { id: 'player_2', angle: 0, speed: 0.1, speedModifiers: [], radius: 150 },
  ];
  // player_1's combined mult while both active = 1 + 3*0.5 = 2.5x, vs
  // player_2's 1x -- player_1 must reach the line first.
  const order = computeQueueForecast(units, { maxSteps: 10 }).map((e) => e.id);
  assert.equal(order[0], 'player_1', `expected the stacked-boost unit to cross first, got: ${order}`);
});

test('two same-direction slow-downs stack additively (-1 + -2 = -3)', () => {
  const units = [
    { id: 'player_1', angle: 0, speed: 0.1, speedModifiers: [
        { tier: -1, remaining: 200 },
        { tier: -2, remaining: 360 },
      ], radius: 150 },
    { id: 'player_2', angle: 0, speed: 0.1, speedModifiers: [], radius: 150 },
  ];
  const order = computeQueueForecast(units, { maxSteps: 10 }).map((e) => e.id);
  assert.equal(order[0], 'player_2', `expected the normal-speed unit to cross first while the other is stack-slowed, got: ${order}`);
});

test('opposite-direction modifiers net out (+1 boost and -1 slow = base speed) while both active', () => {
  const units = [
    { id: 'player_1', angle: 0, speed: 0.1, speedModifiers: [
        { tier: 1, remaining: 500 },
        { tier: -1, remaining: 500 },
      ], radius: 150 },
    { id: 'player_2', angle: 0, speed: 0.1, speedModifiers: [], radius: 150 },
  ];
  // Both units at identical angle and identical NET speed (mult=1 for
  // both) should be an exact tie on the very first crossing -- verified
  // via the snapshot: both should reach angle 0 at the same simulated
  // moment, i.e. the second forecast entry's snapshot should show
  // whichever unit is NOT first already back at angle ~0 too, OR more
  // simply: both should appear within the first two entries (the
  // tie-break rule resolves who's listed "first" arbitrarily, but
  // neither should be dramatically ahead).
  const forecast = computeQueueForecast(units, { maxSteps: 10 });
  assert.equal(forecast.length, 2, `expected exactly one turn each (net-zero modifiers = identical speed = tie), got: ${forecast.map(e=>e.id)}`);
});

test('net-zero modifiers revert to whichever side outlasts the other once the shorter one expires', () => {
  const units = [
    { id: 'player_1', angle: 0, speed: 0.1, speedModifiers: [
        { tier: 1, remaining: 100 }, // boost expires first
        { tier: -1, remaining: 300 }, // slow outlasts it
      ], radius: 150 },
    { id: 'player_2', angle: 0, speed: 0.1, speedModifiers: [], radius: 150 },
  ];
  // Net 0 for the first 100 degrees (tied pace with player_2), then net
  // -1 (slower than player_2) for the rest -- player_2 should win the
  // race to the line outright.
  const order = computeQueueForecast(units, { maxSteps: 10 }).map((e) => e.id);
  assert.equal(order[0], 'player_2', `expected player_2 first once player_1's slow outlasts its boost, got: ${order}`);
});

test('anchor-style override (stripping only negative-tier modifiers) leaves a boost untouched', () => {
  const units = [
    { id: 'player_1', angle: 300, speed: 0.15, speedModifiers: [
        { tier: 2, remaining: 300 },
        { tier: -1, remaining: 100 },
      ], radius: 150 },
    { id: 'player_2', angle: 0, speed: 0.15, speedModifiers: [], radius: 150 },
  ];
  const stripped = units.map((u) =>
    u.id === 'player_1' ? { ...u, speedModifiers: u.speedModifiers.filter((m) => m.tier >= 0) } : u
  );
  // After stripping the slow, player_1's net tier goes from +1 to +2 --
  // strictly faster, so it should still cross before player_2 (sanity:
  // it already did before stripping too, since even net+1 beats 1x, but
  // the SPECIFIC thing under test is that the +2 tier survived the
  // strip untouched).
  const before = computeQueueForecast(units, { maxSteps: 4 });
  const after = computeQueueForecast(stripped, { maxSteps: 4 });
  assert.equal(before[0].id, 'player_1');
  assert.equal(after[0].id, 'player_1');
  // A stronger check: after stripping, player_1 should reach the line
  // STRICTLY sooner than before (since it's now faster, having lost only
  // the slow) -- compare via a snapshot's implied timing isn't exposed
  // directly, so instead verify player_1 gets a SECOND turn before
  // player_2's first turn only in the "after" case if the speed gap is
  // now large enough. (300 distance at mult 2x = 150 "time"; at mult
  // 1.5x = 200 "time" -- both still comfortably beat player_2's 360 at
  // 1x = 360, so instead just confirm the modifier list itself is
  // correct.)
  assert.deepEqual(stripped[0].speedModifiers, [{ tier: 2, remaining: 300 }]);
});

test('a modifier with remaining already at/below 0 is treated as expired, not active', () => {
  const units = [
    { id: 'player_1', angle: 0, speed: 0.1, speedModifiers: [{ tier: 5, remaining: 0 }], radius: 150 },
    { id: 'player_2', angle: 0, speed: 0.1, speedModifiers: [], radius: 150 },
  ];
  // If the zero-remaining modifier were incorrectly still active,
  // player_1 (mult 3.5x) would trounce player_2 (mult 1x). It shouldn't.
  const forecast = computeQueueForecast(units, { maxSteps: 4 });
  assert.equal(forecast.length, 2, `expected a tied/fair race (modifier already expired), got: ${forecast.map(e=>e.id)}`);
});

// --- TIE-BREAKING (regression coverage) -------------------------------

section('Tie-breaking');

test('REGRESSION: two units tied exactly on timing do not starve each other forever', () => {
  const units = [
    { id: 'player_1', angle: 0, speed: 0.15, radius: 150 },
    { id: 'player_2', angle: 0, speed: 0.15, radius: 150 },
  ];
  const forecast = computeQueueForecast(units, { maxSteps: 10 });
  const ids = new Set(forecast.map((e) => e.id));
  assert.ok(ids.has('player_1') && ids.has('player_2'), `expected both tied units to eventually appear, got: ${forecast.map(e=>e.id)}`);
});

test('REGRESSION: a modifier expiring at the EXACT instant of a crossing still counts as a real turn', () => {
  // A fresh 1-tier boost (360 remaining) on a unit starting exactly 360
  // degrees from its own next crossing at the BOOSTED rate will have its
  // modifier expire at precisely the same instant it reaches the line.
  const units = [
    { id: 'player_1', angle: 0, speed: 0.1, speedModifiers: [{ tier: 2, remaining: 360 }], radius: 150 },
    { id: 'player_2', angle: 359, speed: 0.1, speedModifiers: [], radius: 150 },
  ];
  const forecast = computeQueueForecast(units, { maxSteps: 6 });
  const p1Count = forecast.filter((e) => e.id === 'player_1').length;
  assert.ok(p1Count >= 1, `expected player_1's crossing to be recorded despite the exact-instant modifier expiry, got: ${forecast.map(e=>e.id)}`);
});

// --- ROCKS -------------------------------------------------------------

section('Rocks / boulder blocking');

test('a long-lived rock freezes a unit that runs into it, delaying its turn', () => {
  const units = [
    { id: 'player_1', angle: 300, speed: 0.2, radius: 150 },
    { id: 'player_2', angle: 340, speed: 0.15, radius: 150 },
  ];
  const noRock = computeQueueForecast(units).map((e) => e.id);
  const rocks = [{ radius: 150, angle: 355, remainingMs: 5000 }];
  const withRock = computeQueueForecast(units, { rocks }).map((e) => e.id);
  assert.deepEqual(noRock, ['player_2', 'player_1'], 'sanity check on the no-rock baseline');
  assert.equal(withRock[0], 'player_1', `expected player_1 (not blocked by the rock) to now go first, got: ${withRock}`);
});

test('a rock that will already be gone before a unit arrives does not block it', () => {
  const units = [{ id: 'player_1', angle: 300, speed: 0.1, radius: 150 }];
  const rocks = [{ radius: 150, angle: 340, remainingMs: 50 }]; // expires almost immediately
  const forecast = computeQueueForecast(units, { rocks });
  assert.equal(forecast.length, 1, 'unit should reach the line normally, unblocked');
});

test('a rock only blocks units on the SAME radius', () => {
  const units = [
    { id: 'player_1', angle: 340, speed: 0.15, radius: 150 }, // player ring
    { id: 'guardian_1', angle: 340, speed: 0.15, radius: 130 }, // enemy ring, same angle
  ];
  const rocks = [{ radius: 150, angle: 355, remainingMs: 100000 }]; // only on the player ring
  const forecast = computeQueueForecast(units, { rocks, maxSteps: 10 });
  // guardian_1 should be completely unaffected and reach the line
  // normally; player_1 should be delayed.
  assert.equal(forecast[0].id, 'guardian_1', `expected the unblocked guardian to go first, got: ${forecast.map(e=>e.id)}`);
});

test('a rock can sequentially block more than one unit', () => {
  const units = [
    { id: 'player_1', angle: 340, speed: 0.2, radius: 150 },
    { id: 'player_2', angle: 300, speed: 0.15, radius: 150 },
  ];
  const rocks = [{ radius: 150, angle: 358, remainingMs: 100000 }];
  const forecast = computeQueueForecast(units, { rocks, maxSteps: 10 });
  // Both should eventually be represented even though both get blocked
  // at the same spot in sequence -- this mostly checks the sim doesn't
  // hang or drop a unit when a rock affects multiple units.
  const ids = new Set(forecast.map((e) => e.id));
  assert.ok(ids.has('player_1') && ids.has('player_2'), `expected both units represented, got: ${forecast.map(e=>e.id)}`);
});

// --- LABELS -------------------------------------------------------------

section('Enemy queue labels');

test('getEnemyQueueLabel derives 2 uppercase letters from the guardian name', () => {
  assert.equal(getEnemyQueueLabel('guardian_1', { 1: { name: 'Ziz' } }), 'ZI');
  assert.equal(getEnemyQueueLabel('guardian_2', { 2: { name: 'Julius Caesar' } }), 'JU');
});

test('getEnemyQueueLabel returns null for a non-guardian id', () => {
  assert.equal(getEnemyQueueLabel('player_1', {}), null);
});

test('getEnemyQueueLabel falls back to "??" when the guardianAssignment entry is missing', () => {
  assert.equal(getEnemyQueueLabel('guardian_3', {}), '??');
});

// --- SUMMARY -------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailed tests:');
  failures.forEach(({ name, err }) => console.log(`  - ${name}: ${err.message}`));
  process.exitCode = 1;
}
