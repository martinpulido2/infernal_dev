// runStatsDisplay.js
//
// Renders the corruption-data-collection stats gathered this run (see
// gameState.js's runStats comment and /areas/inferno-card-game.md for
// what these feed into) as one self-contained block. Shared between
// map/victoryRecap.js and combat/combat.js's defeat screen so the two
// end-of-run screens can't quietly drift out of sync with each other —
// same numbers, same layout, regardless of which way the run ended.

// stats: { enemyTurnsFaced, corruptionManualUp: {events,total},
//          corruptionManualDown: {events,total}, consumeCount, taintCount,
//          optionalCorruption: {corruptedCard, acceptedInsteadOfPenalty, triggeredOnEnemy} }
export function buildCorruptionStatsSection(stats) {
  const {
    enemyTurnsFaced,
    corruptionManualUp,
    corruptionManualDown,
    consumeCount,
    taintCount,
    optionalCorruption,
  } = stats;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'width:100%; max-width:640px; margin-bottom:48px;';

  const header = document.createElement('div');
  header.textContent = 'Corruption Log';
  header.style.cssText = 'font-size:22px; font-weight:bold; color:#f4c14a; margin-bottom:14px;';
  wrap.appendChild(header);

  const grid = document.createElement('div');
  grid.style.cssText = 'display:flex; flex-wrap:wrap; gap:20px; justify-content:center;';
  wrap.appendChild(grid);

  const rows = [
    ['Enemy turns faced', enemyTurnsFaced],
    ['Corruption manually raised', `${corruptionManualUp.events}× (+${corruptionManualUp.total})`],
    // corruptionManualDown.total is negative (deltas keep their sign — see
    // recordManualCorruptionAdjustment) -- shown as a positive magnitude
    // here since "reduced by 6" reads far more naturally than "reduced by
    // -6" on a recap screen.
    ['Corruption manually reduced', `${corruptionManualDown.events}× (−${Math.abs(corruptionManualDown.total)})`],
    ['Consume used', consumeCount],
    ['Taint used', taintCount],
    ['Played a corrupted card', optionalCorruption.corruptedCard],
    ['Took corruption over a penalty', optionalCorruption.acceptedInsteadOfPenalty],
    ['Triggered corruption on an enemy', optionalCorruption.triggeredOnEnemy],
  ];

  rows.forEach(([label, value]) => {
    const cell = document.createElement('div');
    cell.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:4px; width:150px;';

    const valueEl = document.createElement('div');
    valueEl.textContent = String(value);
    valueEl.style.cssText = 'font-size:20px; font-weight:bold; color:#f4c14a;';
    cell.appendChild(valueEl);

    const labelEl = document.createElement('div');
    labelEl.textContent = label;
    labelEl.style.cssText = 'font-size:13px; color:#c9b896;';
    cell.appendChild(labelEl);

    grid.appendChild(cell);
  });

  return wrap;
}
