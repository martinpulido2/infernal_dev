// map/victoryRecap.js
//
// Shown instead of the normal map once the Hell Lord is defeated and the
// run is complete -- see mapPhase.js's renderNow(), which calls this
// instead of renderer.render() the moment isRunComplete(runState) becomes
// true. Reads the whole-run stats gameState accumulated via combat.js's
// recordPlayerTurn/recordGuardianDefeat/recordCombatVictory calls -- see
// gameState.js's own runStats comment for the data shape.

import { getState, resetRun } from '../gameState.js';

let mounted = false;

// Renders once per run -- there's nothing to update after the run is
// over, and mapPhase.js's renderNow() can call this repeatedly (any other
// MAP-phase state change re-renders), so this guards against rebuilding
// the whole screen (and restarting its guided-journey animation) on every
// one of those.
export function renderVictoryRecap(container) {
  if (mounted) return;
  mounted = true;

  const state = getState();
  const { defeatLog, turnsByPlayerIndex, guardianDefeatsByPlayerIndex } = state.runStats;
  const players = state.players;

  // Group the (already fight-ordered) log by ring, ascending. A run only
  // ever descends -- ring number increases monotonically (see
  // mapRunState.js's applyMove) -- so fight order and ring-ascending order
  // already coincide; sorting explicitly here is a correctness belt, not
  // a fix for anything actually arriving out of order.
  const byRing = new Map();
  defeatLog.forEach((entry) => {
    if (!byRing.has(entry.ring)) byRing.set(entry.ring, { ringName: entry.ringName, entries: [] });
    byRing.get(entry.ring).entries.push(entry);
  });
  const ringsSorted = [...byRing.keys()].sort((a, b) => a - b);

  const el = document.createElement('div');
  el.id = 'victory-recap';
  el.style.cssText = `
    position:fixed; inset:0; background:#0a0704; z-index:500;
    display:flex; flex-direction:column; align-items:center;
    overflow-y:auto; padding:48px 24px 80px;
    font-family:'Georgia','Times New Roman',serif; color:#efe6d8;
    text-align:center;
  `;

  const title = document.createElement('div');
  title.textContent = 'VICTORY';
  title.style.cssText = 'font-size:56px; font-weight:bold; color:#f4c14a; letter-spacing:4px; margin-bottom:8px;';
  el.appendChild(title);

  // The Hell Lord's own name, if a Hell Lord entry made it into the log
  // (it always should have, since this screen only ever shows once the
  // run is actually complete) -- reversed search since it's always the
  // LAST entry, but this doesn't assume that.
  const hellLordEntry = [...defeatLog].reverse().find((e) => e.nodeType === 'HELL_LORD');
  const subtitle = document.createElement('div');
  subtitle.textContent = hellLordEntry ? `${hellLordEntry.names[0]} has fallen.` : 'Hell has been conquered.';
  subtitle.style.cssText = 'font-size:22px; color:#c9b896; margin-bottom:40px;';
  el.appendChild(subtitle);

  // --- Circle-by-circle recap ---
  const journeyHeader = document.createElement('div');
  journeyHeader.textContent = 'The Journey';
  journeyHeader.style.cssText = 'font-size:28px; font-weight:bold; color:#f4c14a; margin-bottom:20px;';
  el.appendChild(journeyHeader);

  const journeyList = document.createElement('div');
  journeyList.style.cssText = 'display:flex; flex-direction:column; gap:14px; max-width:520px; width:100%; margin-bottom:48px;';
  el.appendChild(journeyList);

  const ringRows = [];
  ringsSorted.forEach((ringNum) => {
    const { ringName, entries } = byRing.get(ringNum);
    const row = document.createElement('div');
    row.style.cssText = `
      border:2px solid #3a322c; border-radius:10px; padding:14px 18px;
      background:rgba(255,255,255,0.03);
      transition: background 500ms ease, border-color 500ms ease;
    `;

    const rowTitle = document.createElement('div');
    rowTitle.textContent = `Ring ${ringNum} — ${ringName}`;
    rowTitle.style.cssText = 'font-weight:bold; font-size:18px; color:#f4c14a; margin-bottom:4px;';
    row.appendChild(rowTitle);

    // A ring can have multiple log entries (e.g. a Clash AND an Overseer
    // both fought there) -- flatten and dedupe every distinct name faced
    // on this ring across all of them.
    const names = [...new Set(entries.flatMap((e) => e.names))];
    const rowNames = document.createElement('div');
    rowNames.textContent = names.join(', ');
    rowNames.style.cssText = 'font-size:15px; color:#efe6d8;';
    row.appendChild(rowNames);

    journeyList.appendChild(row);
    ringRows.push(row);
  });

  // --- Stats ---
  const statsHeader = document.createElement('div');
  statsHeader.textContent = 'Notable Feats';
  statsHeader.style.cssText = 'font-size:28px; font-weight:bold; color:#f4c14a; margin-bottom:20px;';
  el.appendChild(statsHeader);

  const statsRow = document.createElement('div');
  statsRow.style.cssText = 'display:flex; gap:32px; flex-wrap:wrap; justify-content:center; margin-bottom:48px;';
  el.appendChild(statsRow);
  statsRow.appendChild(buildStatCard('Most Turns Taken', turnsByPlayerIndex, players));
  statsRow.appendChild(buildStatCard('Most Guardians Defeated', guardianDefeatsByPlayerIndex, players));

  // --- Play again ---
  const again = document.createElement('div');
  again.textContent = 'Tap to begin a new descent';
  again.style.cssText = `
    font-size:18px; color:#c9b896; border:2px solid #f4c14a; border-radius:10px;
    padding:14px 28px; cursor:pointer;
  `;
  again.addEventListener('pointerdown', () => {
    // Same clean-restart pattern combat.js's defeatScreen uses: a full
    // reload (not just resetRun() + patchState) guarantees no risk of
    // stale module-level closure state from THIS run leaking into the
    // next one.
    resetRun();
    window.location.reload();
  });
  el.appendChild(again);

  container.appendChild(el);

  // --- Guided journey ---
  // A brief sequential highlight through the ring rows above, ring 1
  // outward, before settling into the static list. This is cosmetic --
  // a glow per row, not an actual camera pan across the live map SVG
  // (that needs real viewport/zoom machinery this renderer doesn't have)
  // -- but it delivers the same idea: a guided pass through the journey,
  // highlighting the enemies faced as it moves outward ring by ring.
  ringRows.forEach((row, i) => {
    setTimeout(() => {
      row.style.background = 'rgba(244,193,74,0.18)';
      row.style.borderColor = '#f4c14a';
      setTimeout(() => {
        row.style.background = 'rgba(255,255,255,0.03)';
        row.style.borderColor = '#3a322c';
      }, 900);
    }, i * 1100 + 400);
  });
}

// One stat card: the label, then every player tied for the highest count
// (icon-only, side by side) and the count itself. Ties are shown
// together rather than picking an arbitrary "winner" among them.
function buildStatCard(label, countsByIndex, players) {
  const card = document.createElement('div');
  card.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:8px; width:180px;';

  const labelEl = document.createElement('div');
  labelEl.textContent = label;
  labelEl.style.cssText = 'font-size:15px; color:#c9b896;';
  card.appendChild(labelEl);

  const entries = Object.entries(countsByIndex || {}).map(([idx, count]) => ({ idx: Number(idx), count }));
  if (entries.length === 0) {
    const none = document.createElement('div');
    none.textContent = '—';
    none.style.cssText = 'font-size:16px; color:#8a7f6e;';
    card.appendChild(none);
    return card;
  }

  const maxCount = Math.max(...entries.map((e) => e.count));
  const leaders = entries.filter((e) => e.count === maxCount);

  const iconRow = document.createElement('div');
  iconRow.style.cssText = 'display:flex; gap:8px;';
  leaders.forEach(({ idx }) => {
    const p = players[idx];
    if (!p) return;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:56px; height:56px; border-radius:50%; overflow:hidden; border:2px solid #f4c14a; background:#111;';
    if (p.icon) {
      const img = document.createElement('img');
      img.src = p.icon;
      img.style.cssText = 'width:100%; height:100%; object-fit:cover;';
      wrap.appendChild(img);
    }
    iconRow.appendChild(wrap);
  });
  card.appendChild(iconRow);

  const countEl = document.createElement('div');
  countEl.textContent = String(maxCount);
  countEl.style.cssText = 'font-size:22px; font-weight:bold; color:#f4c14a;';
  card.appendChild(countEl);

  return card;
}
