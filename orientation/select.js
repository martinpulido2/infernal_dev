// orientation/select.js
//
// Phase a. Structurally unchanged from the original prototype's inline
// script -- same vortex canvas intro, same character-console/lock-in/
// orientation-arrow flow -- with two additions: charData now carries each
// character's combat speedSlot + combat ring icon (previously hardcoded
// separately, and only for 2 of the 4 characters, inside combat.js's
// PLAYER_CHARACTERS), and locking in the last orientation now hands the
// full player roster off to gameState instead of dead-ending at
// currentAppState = 'GAME_ACTIVE'.

import { patchState } from '../gameState.js';
import { hideNarrativeTrigger } from '../narrative/introSequence.js';
import { hideTutorialTrigger } from '../tutorial/tutorialTrigger.js';
import { GAME_MODES } from '../map/mapConstants.js';

export function initOrientationPhase() {

      const canvas = document.getElementById('vortexCanvas');
      const ctx = canvas.getContext('2d');

      const ringImage = new Image();
      ringImage.src = '/public/Ring1.png';

      // speedSlot: this character's fixed speed-tier slot in combat (one
      // of the 7 "*2" slots reserved for players -- see
      // SPEED_SLOT_VALUES in combat.js). combatIcon: the small icon shown
      // on that character's token on the combat speed ring -- distinct
      // from `src`, which is the larger portrait used on THIS screen's
      // selection tokens.
      const charData = [
        {
          id: 'obsidium',
          name: 'Obsidium',
          colorClass: 'token-obsidium',
          hex: '#e53935',
          src: '/public/obsidium.png',
          speedSlot: 'LS2',
          combatIcon: '/public/obsidiumicon.png',
        },
        {
          id: 'ryadnae',
          name: 'Ryadnae',
          colorClass: 'token-ryadnae',
          hex: '#1e88e5',
          src: '/public/Ryadnae.png',
          speedSlot: 'SW2',
          combatIcon: '/public/ryadnaeicon.png',
        },
        {
          id: 'siria',
          name: 'Siria',
          colorClass: 'token-siria',
          hex: '#43a047',
          src: '/public/siria.png',
          speedSlot: 'N2',
          combatIcon: '/public/siriaicon.png', // TODO: confirm actual filename
        },
        {
          id: 'marek',
          name: 'Marek',
          colorClass: 'token-marek',
          hex: '#fdd835',
          src: '/public/Marek.png',
          speedSlot: 'F2',
          combatIcon: '/public/marekicon.png', // TODO: confirm actual filename
        },
      ];

      const cornerNames = [
        'corner-top-left',
        'corner-top-right',
        'corner-bottom-left',
        'corner-bottom-right',
      ];

      let currentAppState = 'RING';
      let particleCount = 200;
      let particles = [];
      let centerX = 0,
        centerY = 0,
        ringRadius = 0,
        ringRotationAngle = 0;
      let lastTapTime = 0;

      let playerSelections = [null, null, null, null]; // Maps player/corner index to charId
      let activePlayers = []; // List of { cornerIndex, charId, colorHex }
      let orientationChoices = {}; // Maps cornerIndex to chosen orientation ('edge1' or 'edge2')
      let selectedGameMode = null; // GAME_MODES.STANDARD | GAME_MODES.RUSH — set by
                                    // the center mode panel (setupModeSelector, below);
                                    // finishOrientationSelect() cannot fire until this
                                    // AND every active player's orientation are both set.

      function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
        centerX = rect.width / 2;
        centerY = rect.height / 2;
      }

      class InnerVortexParticle {
        constructor() {
          this.reset(true);
        }
        reset(initial = false) {
          const innerHoleRadius = ringRadius * 0.85;
          this.radius = initial
            ? Math.random() * innerHoleRadius
            : innerHoleRadius;
          this.angle = Math.random() * Math.PI * 2;
          this.baseSpeed = 0.015 + Math.random() * 0.02;
          this.speed = this.baseSpeed;
          this.decay = 0.5 + Math.random() * 1.0;
          this.size = Math.random() * 2 + 0.6;
          this.color = Math.random() > 0.3 ? '#ff4500' : '#ff8c00';
        }
        update() {
          this.angle += this.speed;
          this.radius -= this.decay;
          this.speed = this.baseSpeed + 0.04 * (1 / (this.radius * 0.05 + 1));
          if (this.radius < 10) this.reset();
        }
        draw() {
          const x = centerX + Math.cos(this.angle) * this.radius;
          const y = centerY + Math.sin(this.angle) * this.radius;
          const alpha = Math.min(1, this.radius / (ringRadius * 0.3));
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.fillStyle = this.color;
          ctx.beginPath();
          ctx.arc(x, y, this.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      function initParticles() {
        particles = [];
        for (let i = 0; i < particleCount; i++)
          particles.push(new InnerVortexParticle());
      }

      function animate(timestamp) {
        if (currentAppState !== 'RING') return;

        ctx.fillStyle = 'rgba(11, 7, 6, 0.3)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const rect = canvas.getBoundingClientRect();
        const minDim = Math.min(rect.width, rect.height);
        const displaySize = minDim * 0.75;
        ringRadius = displaySize / 2;

        ctx.save();
        ctx.beginPath();
        ctx.arc(centerX, centerY, ringRadius * 0.9, 0, Math.PI * 2);
        ctx.clip();

        const gradient = ctx.createRadialGradient(
          centerX,
          centerY,
          0,
          centerX,
          centerY,
          ringRadius * 0.4
        );
        gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
        gradient.addColorStop(0.7, 'rgba(25, 6, 2, 0.85)');
        gradient.addColorStop(1, 'rgba(11, 7, 6, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(centerX, centerY, ringRadius * 0.4, 0, Math.PI * 2);
        ctx.fill();

        particles.forEach((p) => {
          p.update();
          p.draw();
        });
        ctx.restore();

        ringRotationAngle -= 0.002;
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(ringRotationAngle);
        // naturalWidth, not just .complete: a FAILED image reports
        // complete === true with naturalWidth === 0, and passing that to
        // drawImage throws an InvalidStateError -- which, inside the
        // rAF loop, would kill every subsequent frame and take the
        // particles down with it. Checking the decoded width means a
        // broken ring costs only the ring.
        if (ringImage.complete && ringImage.naturalWidth > 0) {
          ctx.drawImage(
            ringImage,
            -displaySize / 2,
            -displaySize / 2,
            displaySize,
            displaySize
          );
        }
        ctx.restore();

        requestAnimationFrame(animate);
      }

      function buildCharacterConsoles() {
        const consoles = document.querySelectorAll('.player-console');
        consoles.forEach((consoleEl, playerIdx) => {
          consoleEl.innerHTML = '';
          charData.forEach((char) => {
            const token = document.createElement('div');
            token.className = `char-token ${char.colorClass}`;
            token.dataset.player = playerIdx;
            token.dataset.char = char.id;

            const img = document.createElement('img');
            img.src = char.src;
            token.appendChild(img);

            // "P1"/"P2"/etc overlay -- text/visibility set in
            // updateConsoleUI based on selectionSequence, not here (this
            // just creates the slot once per token).
            const badge = document.createElement('div');
            badge.className = 'player-badge';
            token.appendChild(badge);

            token.addEventListener('click', () =>
              handleCharacterSelection(playerIdx, char.id)
            );
            consoleEl.appendChild(token);
          });
        });
        updateConsoleUI();
      }

      // Order players CONFIRMED a selection in -- NOT the same as playerIdx
      // (which is fixed by physical corner/console position). "P1" per
      // spec means whoever selected FIRST, regardless of which corner
      // they're sitting in. Deselecting removes a player from this list;
      // re-selecting afterward puts them at the END (they're now the
      // most-recent pick, not reinstated to their old position) -- the
      // simplest rule that still matches "first to select is P1" without
      // needing to store literal timestamps.
      let selectionSequence = [];

      function handleCharacterSelection(playerIdx, charId) {
        if (currentAppState !== 'CHAR_SELECT') return;

        if (playerSelections[playerIdx] === charId) {
          playerSelections[playerIdx] = null;
          selectionSequence = selectionSequence.filter((p) => p !== playerIdx);
        } else {
          if (playerSelections.includes(charId)) return;
          playerSelections[playerIdx] = charId;
          if (!selectionSequence.includes(playerIdx)) {
            selectionSequence.push(playerIdx);
          }
        }
        updateConsoleUI();
      }

      function updateConsoleUI() {
        const consoles = document.querySelectorAll('.player-console');
        consoles.forEach((consoleEl, playerIdx) => {
          const tokens = consoleEl.querySelectorAll('.char-token');
          tokens.forEach((token) => {
            const charId = token.dataset.char;
            const isSelectedByThisPlayer =
              playerSelections[playerIdx] === charId;
            const isSelectedByAnyone = playerSelections.includes(charId);

            token.classList.remove('selected', 'disabled');

            if (isSelectedByThisPlayer) {
              token.classList.add('selected');
              const badge = token.querySelector('.player-badge');
              if (badge) {
                badge.textContent = `P${selectionSequence.indexOf(playerIdx) + 1}`;
              }
            } else if (isSelectedByAnyone) {
              token.classList.add('disabled');
            }
          });
        });

        const selectedCount = playerSelections.filter((s) => s !== null).length;

        // Keep the center lock-in button hidden until at least one
        // character has been picked, so a double-tap on the portal (which
        // sits in roughly the same screen spot) can't immediately land on
        // it before anyone's chosen anything.
        document
          .getElementById('centerActionHub')
          .classList.toggle('visible', selectedCount > 0);

        document.getElementById(
          'statusMessage'
        ).innerText = `Selected: ${selectedCount} (1-4)`;
      }

      canvas.addEventListener('pointerdown', (e) => {
        if (currentAppState !== 'RING') return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left - centerX;
        const y = e.clientY - rect.top - centerY;
        const distanceFromCenter = Math.sqrt(x * x + y * y);

        if (distanceFromCenter <= ringRadius * 0.85) {
          const currentTime = new Date().getTime();
          const tapLength = currentTime - lastTapTime;

          if (tapLength < 400 && tapLength > 0) {
            transitionToCharSelect();
          }
          lastTapTime = currentTime;
        }
      });

      function transitionToCharSelect() {
        currentAppState = 'CHAR_SELECT';
        // The narrative book icon (and its tutorial-compass companion)
        // are only allowed on the ring screen itself (see
        // narrative/introSequence.js's visibility note) — this is the
        // exact moment that's no longer true.
        hideNarrativeTrigger();
        hideTutorialTrigger();
        canvas.style.display = 'none';
        document.getElementById('ringInstruction').style.display = 'none';
        document.getElementById('charSelectUI').style.display = 'block';
        buildCharacterConsoles();
      }

      document.getElementById('lockInBtn').addEventListener('click', () => {
        if (currentAppState !== 'CHAR_SELECT') return;

        const activePicks = playerSelections.filter((s) => s !== null);
        if (activePicks.length >= 1) {
          // Populate active players list
          activePlayers = [];
          playerSelections.forEach((charId, idx) => {
            if (charId !== null) {
              const charObj = charData.find((c) => c.id === charId);
              activePlayers.push({
                cornerIndex: idx,
                charId: charId,
                colorHex: charObj.hex,
              });
            }
          });

          currentAppState = 'ORIENTATION_SELECT';
          document.getElementById('charSelectUI').style.display = 'none';
          setupOrientationSelector();
          setupModeSelector();
        } else {
          const status = document.getElementById('statusMessage');
          status.innerText = 'Select at least 1 character!';
          setTimeout(() => {
            const count = playerSelections.filter((s) => s !== null).length;
            status.innerText = `Selected: ${count} (1-4)`;
          }, 1500);
        }
      });

      // --- Orientation geometry ---------------------------------------
      // An arrow rotated by these degrees points OUTWARD, toward the edge
      // it represents (0deg = up, and clockwise from there).
      const EDGE_ARROW_ROTATION = { top: 0, right: 90, bottom: 180, left: 270 };
      // A player standing just beyond an edge, facing in toward the
      // table, reads a label correctly when the label's "up" points AWAY
      // from that edge — the opposite of the arrow that points toward it.
      // So label rotation is always the arrow rotation + 180deg.
      const EDGE_LABEL_ROTATION = { top: 180, right: 270, bottom: 0, left: 90 };

      // The two edges that meet at each corner, plus the pixel offsets
      // (unchanged from the original layout) for the arrow/label that sits
      // on each of those edges. Each .orientation-corner div is pinned to
      // its own screen corner (see .orient-* CSS), so a child using the
      // SAME side the div is anchored to (left vs right, top vs bottom)
      // stays aligned to the true screen edge no matter which corner it's in.
      const CORNER_CONFIG = {
        0: {
          // Top-Left
          horizontalEdge: 'top',
          verticalEdge: 'left',
          arrowHorizontal: { top: '20px', left: '100px' },
          arrowVertical: { top: '100px', left: '20px' },
          labelHorizontal: { top: '40px', left: '150px' },
          labelVertical: { top: '150px', left: '40px' },
        },
        1: {
          // Top-Right
          horizontalEdge: 'top',
          verticalEdge: 'right',
          arrowHorizontal: { top: '20px', right: '100px' },
          arrowVertical: { top: '100px', right: '20px' },
          labelHorizontal: { top: '40px', right: '150px' },
          labelVertical: { top: '150px', right: '40px' },
        },
        2: {
          // Bottom-Left
          horizontalEdge: 'bottom',
          verticalEdge: 'left',
          arrowHorizontal: { bottom: '20px', left: '100px' },
          arrowVertical: { bottom: '100px', left: '20px' },
          labelHorizontal: { bottom: '40px', left: '150px' },
          labelVertical: { bottom: '150px', left: '40px' },
        },
        3: {
          // Bottom-Right
          horizontalEdge: 'bottom',
          verticalEdge: 'right',
          arrowHorizontal: { bottom: '20px', right: '100px' },
          arrowVertical: { bottom: '100px', right: '20px' },
          labelHorizontal: { bottom: '40px', right: '150px' },
          labelVertical: { bottom: '150px', right: '40px' },
        },
      };

      // cornerIndex -> that corner's .orientation-corner element, kept
      // around so chooseOrientation() can swap that corner's arrows for
      // its label in place, without touching anyone else's corner.
      let cornerDivs = {};

      // Set up the orientation selector screen with blinking arrows pointing to corner edges as in Teacher6.png
      function setupOrientationSelector() {
        const orientUI = document.getElementById('orientationSelectUI');
        orientUI.style.display = 'block';
        orientUI.innerHTML = '';
        cornerDivs = {};
        orientationChoices = {};

        activePlayers.forEach((player) => {
          const cfg = CORNER_CONFIG[player.cornerIndex];
          const cornerDiv = document.createElement('div');
          cornerDiv.className = `orientation-corner orient-${cornerNames[
            player.cornerIndex
          ].replace('corner-', '')}`;
          cornerDivs[player.cornerIndex] = cornerDiv;

          // Two arrows per corner, one per bordering edge, as shown in
          // Teacher6.png: each chevron points outward toward the edge it
          // represents (the horizontal top/bottom edge, and the vertical
          // left/right edge).
          cornerDiv.appendChild(
            buildOrientationArrow(player, cfg.horizontalEdge, cfg.arrowHorizontal)
          );
          cornerDiv.appendChild(
            buildOrientationArrow(player, cfg.verticalEdge, cfg.arrowVertical)
          );

          orientUI.appendChild(cornerDiv);
        });
      }

      // Mode options shown in the center panel. Array-driven rather than
      // two hardcoded buttons so adding Dynamic later (see
      // /areas/inferno-card-game.md -- gated on the corruption-scaling
      // data collection Marty's about to start running) is just another
      // entry here, not new structural code.
      const MODE_OPTIONS = [
        {
          id: GAME_MODES.STANDARD,
          label: 'Standard',
          desc: 'The full descent — a combat every circle.',
        },
        {
          id: GAME_MODES.RUSH,
          label: 'Rush',
          desc: 'A faster descent — combat required only every other circle.',
        },
      ];

      let modeButtonEls = {};

      // Center panel, shown alongside the corner orientation arrows so the
      // whole party settles seating AND mode together before the map
      // generates. A single shared choice, not per-player — any player can
      // tap either option, same as the optional-corruption panel in
      // combat.js is a shared control rather than one-per-seat.
      function setupModeSelector() {
        const modeUI = document.getElementById('modeSelectUI');
        modeUI.style.display = 'flex';
        modeUI.innerHTML = '';
        modeButtonEls = {};
        selectedGameMode = null;

        const heading = document.createElement('div');
        heading.className = 'mode-select-heading';
        heading.textContent = 'Choose Your Descent';
        modeUI.appendChild(heading);

        const row = document.createElement('div');
        row.className = 'mode-select-row';
        MODE_OPTIONS.forEach((opt) => {
          const btn = document.createElement('div');
          btn.className = 'mode-option';
          btn.innerHTML = `<div class="mode-option-label">${opt.label}</div><div class="mode-option-desc">${opt.desc}</div>`;
          btn.addEventListener('click', () => chooseGameMode(opt.id));
          modeButtonEls[opt.id] = btn;
          row.appendChild(btn);
        });
        modeUI.appendChild(row);
      }

      function chooseGameMode(modeId) {
        selectedGameMode = modeId;
        Object.entries(modeButtonEls).forEach(([id, el]) => {
          el.classList.toggle('selected', id === modeId);
        });
        maybeFinishOrientationSelect();
      }

      // Shared completion check -- called after EITHER an orientation pick
      // or a mode pick, since the two happen independently/in either order
      // and finishOrientationSelect() can't fire until both are done.
      function maybeFinishOrientationSelect() {
        if (
          selectedGameMode !== null &&
          Object.keys(orientationChoices).length === activePlayers.length
        ) {
          currentAppState = 'GAME_ACTIVE';
          finishOrientationSelect();
        }
      }

      function buildOrientationArrow(player, edge, positionStyle) {
        const arrow = document.createElement('div');
        arrow.className = 'orientation-arrow';
        arrow.style.color = player.colorHex;
        arrow.style.backgroundImage = "url('/public/Arrow.png')";
        Object.assign(arrow.style, positionStyle);
        // The blink animation (arrowBlink) drives `transform` itself each
        // frame, so a plain inline `transform: rotate()` here would just
        // get overwritten by the animation's own scale keyframes — which
        // is why every arrow was rendering pointing straight up regardless
        // of edge. Feeding the rotation in as a CSS custom property lets
        // the keyframes read it back (`rotate(var(--arrow-rotation)) ...`)
        // so scaling and rotation both apply together.
        arrow.style.setProperty('--arrow-rotation', `${EDGE_ARROW_ROTATION[edge]}deg`);
        arrow.addEventListener('click', () =>
          chooseOrientation(player.cornerIndex, edge)
        );
        return arrow;
      }

      function chooseOrientation(cornerIndex, edge) {
        if (orientationChoices[cornerIndex]) return; // already locked in

        orientationChoices[cornerIndex] = edge;

        // Swap that corner's two arrows for its "Player N" label
        // immediately, as shown in Teacher7.png — don't wait for the
        // other corners to finish choosing.
        const player = activePlayers.find((p) => p.cornerIndex === cornerIndex);
        const playerNumber = activePlayers.indexOf(player) + 1;
        const cornerDiv = cornerDivs[cornerIndex];
        cornerDiv.innerHTML = '';
        cornerDiv.appendChild(buildPlayerLabel(player, playerNumber, edge));

        // Once every active player has locked in an orientation AND the
        // party has chosen a mode, the selection phase is complete — hand
        // the full roster off to shared state and advance to the map phase.
        maybeFinishOrientationSelect();
      }

      // Merges activePlayers (charId + color + corner) with
      // orientationChoices (corner -> edge) into the single players array
      // gameState expects, then switches the shell to the map phase.
      function finishOrientationSelect() {
        const players = activePlayers.map((p) => {
          const char = charData.find((c) => c.id === p.charId);
          return {
            charId: p.charId,
            name: char.name,
            color: p.colorHex,
            icon: char.combatIcon,
            slot: char.speedSlot,
            corner: p.cornerIndex,
            orientationEdge: orientationChoices[p.cornerIndex],
            soulShards: 0,
            soulShardsMax: 0,
          };
        });
        patchState({ players, phase: 'MAP', mode: selectedGameMode });
      }

      function buildPlayerLabel(player, playerNumber, edge) {
        const cfg = CORNER_CONFIG[player.cornerIndex];
        const positionStyle =
          edge === cfg.horizontalEdge ? cfg.labelHorizontal : cfg.labelVertical;

        const label = document.createElement('div');
        label.className = 'player-label';
        label.style.color = player.colorHex;
        label.innerText = `Player ${playerNumber}`;
        Object.assign(label.style, positionStyle);
        label.style.transform = `rotate(${EDGE_LABEL_ROTATION[edge]}deg)`;
        return label;
      }

      window.addEventListener('resize', () => {
        if (currentAppState === 'RING') resizeCanvas();
      });

      // Vortex startup. Previously this ONLY ever began from
      // ringImage.onload / ringImage.complete -- which meant a Ring1.png
      // that was slow, stalled, or failed outright never started the
      // animation loop AT ALL. Not just "ring missing, particles still
      // spinning": animate() was never called even once, so the canvas
      // was never drawn to and sat pure black, with only the DOM
      // "double-tap the abyss" caption visible on top of it. That's a
      // black launch screen caused by one asset request, even though
      // every particle in the vortex is drawn independently of that
      // image.
      //
      // The loop already re-checks ringImage each frame (see the
      // drawImage guard in animate()), so starting WITHOUT the image is
      // safe and self-healing -- if it arrives late, the ring simply
      // fades in on the next frame that sees it decoded. So: start on
      // whichever of load / error / timeout happens first, and never
      // start twice.
      let vortexStarted = false;
      function startVortex() {
        if (vortexStarted) return;
        vortexStarted = true;
        resizeCanvas();
        initParticles();
        requestAnimationFrame(animate);
      }

      ringImage.onload = startVortex;
      // A 404/decode failure must not leave a black screen -- run the
      // vortex without the ring rather than not at all.
      ringImage.onerror = startVortex;
      // Backstop for the case that actually bit in StackBlitz: a request
      // that neither loads nor errors, just hangs (the browser's 6-
      // connections-per-origin pool saturated by the preload batch, so
      // this one queues behind them indefinitely). Neither handler above
      // ever fires in that state.
      setTimeout(startVortex, 2000);

      if (ringImage.complete) startVortex();

} // end initOrientationPhase
