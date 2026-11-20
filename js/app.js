(function (global) {
  'use strict';

  const BracketApp = (global.BracketApp = global.BracketApp || {});

  const THEME_KEY = 'mal_tournament_bracket_theme_v1';
  const DEBOUNCE_MS = 250;

  // DOM references
  const dom = {};
  let store = null;
  let flameRenderer = null;

  // Viewport transform state
  let zoomScale = 1;
  let panX = 0;
  let panY = 0;
  let autoFitLocked = true;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panOriginX = 0;
  let panOriginY = 0;

  // Autocomplete state
  let acActive = null; // { matchIndex, side, inputEl, items, highlightedIndex, query, abortController, timer }
  let pendingImageTarget = null; // { matchIndex, side }

  // VS modal state
  let vsState = null; // { roundIndex, matchIndex, deciding: boolean, fitMode: 'cover' | 'contain' }
  let toastTimer = null;

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getInitials(name) {
    const words = String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }

  function formatFavorites(n) {
    const num = Number(n) || 0;
    if (num >= 1000) return `${(num / 1000).toFixed(num >= 10000 ? 0 : 1)}k`;
    return num > 0 ? String(num) : '';
  }

  function showToast(message) {
    if (!dom.toast) return;
    dom.toast.textContent = message;
    dom.toast.hidden = false;
    dom.toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      dom.toast.classList.remove('visible');
      setTimeout(() => {
        if (!dom.toast.classList.contains('visible')) {
          dom.toast.hidden = true;
        }
      }, 220);
    }, 2400);
  }

  function updateProviderBadge(provider) {
    if (!dom.apiStatusBadge) return;
    const map = {
      mal: { text: 'MAL', title: 'Direct MyAnimeList search active' },
      jikan: { text: 'MAL · Jikan', title: 'MyAnimeList via Jikan API' },
      anilist: { text: 'Fallback', title: 'Jikan unavailable; using AniList fallback' },
      offline: { text: 'Offline', title: 'Search offline; manual entry available' },
    };
    const info = map[provider] || map.mal;
    dom.apiStatusBadge.textContent = info.text;
    dom.apiStatusBadge.title = info.title;
    dom.apiStatusBadge.dataset.provider = provider;
  }

  // ==================== THEME ====================

  function applyTheme(theme) {
    const t = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    dom.iconSun.hidden = t === 'light';
    dom.iconMoon.hidden = t === 'dark';
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch (_) {}
  }

  function initTheme() {
    let saved = 'dark';
    try {
      saved = localStorage.getItem(THEME_KEY) || 'dark';
    } catch (_) {}
    applyTheme(saved);
  }

  // ==================== VIEWPORT ZOOM & PAN ====================

  function applyStageTransform() {
    dom.bracketStage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
    dom.btnZoomFit.textContent = autoFitLocked ? 'Fit' : `${Math.round(zoomScale * 100)}%`;
  }

  function fitToViewport() {
    const vpRect = dom.bracketViewport.getBoundingClientRect();
    const natW = dom.bracketRoot.offsetWidth;
    const natH = dom.bracketRoot.offsetHeight;
    if (!natW || !natH || !vpRect.width || !vpRect.height) return;

    const padX = 48;
    const padY = 40;
    const availW = Math.max(120, vpRect.width - padX);
    const availH = Math.max(120, vpRect.height - padY);

    const scale = Math.min(availW / natW, availH / natH, 1.12);
    zoomScale = Math.max(0.32, Math.min(1.5, scale));
    panX = Math.round((vpRect.width - natW * zoomScale) / 2);
    panY = Math.round((vpRect.height - natH * zoomScale) / 2);
    autoFitLocked = true;
    applyStageTransform();
  }

  function setManualZoom(nextScale, pivotClientX, pivotClientY) {
    const clamped = Math.max(0.32, Math.min(1.85, nextScale));
    const vpRect = dom.bracketViewport.getBoundingClientRect();
    const px = pivotClientX != null ? pivotClientX - vpRect.left : vpRect.width / 2;
    const py = pivotClientY != null ? pivotClientY - vpRect.top : vpRect.height / 2;

    const worldX = (px - panX) / zoomScale;
    const worldY = (py - panY) / zoomScale;

    zoomScale = clamped;
    panX = px - worldX * zoomScale;
    panY = py - worldY * zoomScale;
    autoFitLocked = false;
    applyStageTransform();
    closeAutocomplete();
  }

  // ==================== BRACKET RENDERING ====================

  function createAvatarEl(character, seedNumber, editableImage) {
    const wrap = document.createElement('div');
    wrap.className = 'slot-avatar';
    if (editableImage) {
      wrap.classList.add('slot-avatar-editable');
      wrap.title = 'Click to set custom image';
    }

    if (character && character.image) {
      const img = document.createElement('img');
      img.src = character.image;
      img.alt = character.name;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', () => {
        wrap.innerHTML = `<span class="slot-monogram">${escapeHtml(getInitials(character.name))}</span>`;
      });
      wrap.appendChild(img);
    } else if (character) {
      wrap.innerHTML = `<span class="slot-monogram">${escapeHtml(getInitials(character.name))}</span>`;
    } else if (seedNumber != null) {
      wrap.innerHTML = `<span class="slot-seed">${seedNumber}</span>`;
    } else {
      wrap.innerHTML = `<span class="slot-tbd-dot"></span>`;
    }
    return wrap;
  }

  function createSlotEl(roundIndex, matchIndex, side, match, totalRounds) {
    const character = match.slots[side];
    const isRound0 = roundIndex === 0;
    const isWinner = match.winnerIndex === side;
    const isLoser = match.winnerIndex !== null && match.winnerIndex !== side;

    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.dataset.round = String(roundIndex);
    slot.dataset.match = String(matchIndex);
    slot.dataset.side = String(side);

    if (character) slot.classList.add('slot-filled');
    else slot.classList.add('slot-empty');
    if (isWinner) slot.classList.add('slot-winner');
    if (isLoser) slot.classList.add('slot-loser');

    const seedNum = isRound0 ? matchIndex * 2 + side + 1 : null;
    const avatar = createAvatarEl(character, seedNum, isRound0 && Boolean(character));

    if (isRound0 && character) {
      avatar.addEventListener('click', (e) => {
        e.stopPropagation();
        pendingImageTarget = { matchIndex, side };
        dom.customImageFile.value = '';
        dom.customImageFile.click();
      });
    }

    slot.appendChild(avatar);

    const body = document.createElement('div');
    body.className = 'slot-body';

    if (isRound0) {
      if (character) {
        const nameBtn = document.createElement('button');
        nameBtn.type = 'button';
        nameBtn.className = 'slot-name-btn';
        nameBtn.textContent = character.name;
        nameBtn.title = `${character.name}${character.sourceTitle ? ' — ' + character.sourceTitle : ''} (click to change)`;
        nameBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          enterInlineEdit(slot, matchIndex, side, character);
        });
        body.appendChild(nameBtn);

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'slot-clear-btn';
        clearBtn.title = 'Clear slot';
        clearBtn.setAttribute('aria-label', `Clear ${character.name}`);
        clearBtn.innerHTML = '&times;';
        clearBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          closeAutocomplete();
          store.setSeedSlot(matchIndex, side, null);
        });
        slot.appendChild(body);
        slot.appendChild(clearBtn);
      } else {
        const input = createSeedInput(matchIndex, side, '');
        body.appendChild(input);
        slot.appendChild(body);
      }
    } else {
      const nameSpan = document.createElement('span');
      nameSpan.className = 'slot-name-static';
      if (character) {
        nameSpan.textContent = character.name;
        nameSpan.title = character.name;
      } else {
        nameSpan.textContent = 'TBD';
        nameSpan.classList.add('slot-tbd');
      }
      body.appendChild(nameSpan);
      slot.appendChild(body);
    }

    if (isWinner) {
      const check = document.createElement('span');
      check.className = 'slot-win-mark';
      check.title = 'Winner';
      check.innerHTML =
        '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5L6.5 11.5L12.5 4.5"/></svg>';
      slot.appendChild(check);
    }

    return slot;
  }

  function createSeedInput(matchIndex, side, initialValue, existingChar) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'slot-input';
    input.placeholder = 'Search character...';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = initialValue || '';
    input.dataset.match = String(matchIndex);
    input.dataset.side = String(side);

    input.addEventListener('focus', () => {
      if (input.value.trim()) {
        openAutocompleteFor(input, matchIndex, side, existingChar);
      }
    });

    input.addEventListener('input', () => {
      openAutocompleteFor(input, matchIndex, side, existingChar);
    });

    input.addEventListener('keydown', (e) => {
      if (acActive && acActive.inputEl === input) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          moveAutocompleteHighlight(1);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          moveAutocompleteHighlight(-1);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          confirmAutocompleteSelection();
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          closeAutocomplete();
          if (existingChar) {
            renderBracket();
          } else {
            input.blur();
          }
          return;
        }
      } else if (e.key === 'Enter' && input.value.trim()) {
        e.preventDefault();
        commitCustomEntry(matchIndex, side, input.value.trim());
      } else if (e.key === 'Escape' && existingChar) {
        e.preventDefault();
        renderBracket();
      }
    });

    input.addEventListener('blur', () => {
      // Small delay so clicks on dropdown items register before closing
      setTimeout(() => {
        if (acActive && acActive.inputEl === input) {
          closeAutocomplete();
        }
        if (existingChar && document.activeElement !== input) {
          renderBracket();
        }
      }, 170);
    });

    return input;
  }

  function enterInlineEdit(slotEl, matchIndex, side, existingChar) {
    closeAutocomplete();
    const body = slotEl.querySelector('.slot-body');
    const clearBtn = slotEl.querySelector('.slot-clear-btn');
    if (clearBtn) clearBtn.remove();
    body.innerHTML = '';

    const input = createSeedInput(matchIndex, side, existingChar.name, existingChar);
    body.appendChild(input);
    input.focus();
    input.select();
    openAutocompleteFor(input, matchIndex, side, existingChar);
  }

  function createMatchCard(roundIndex, matchIndex, match, totalRounds, extraClass) {
    const card = document.createElement('div');
    card.className = 'match-card';
    if (extraClass) card.classList.add(extraClass);
    card.dataset.round = String(roundIndex);
    card.dataset.match = String(matchIndex);

    const ready = Boolean(match.slots[0] && match.slots[1]);
    const decided = match.winnerIndex !== null;
    if (ready) card.classList.add('match-ready');
    if (decided) card.classList.add('match-decided');

    const slotTop = createSlotEl(roundIndex, matchIndex, 0, match, totalRounds);
    const slotBottom = createSlotEl(roundIndex, matchIndex, 1, match, totalRounds);

    // Center divider seam with the dedicated VS button RIGHT BETWEEN the two characters
    const seam = document.createElement('div');
    seam.className = 'match-seam';

    const vsBtn = document.createElement('button');
    vsBtn.type = 'button';
    vsBtn.className = 'vs-launch-btn';
    vsBtn.textContent = 'VS';
    vsBtn.disabled = !ready;
    vsBtn.title = ready
      ? decided
        ? 'Re-open matchup screen'
        : 'Open matchup screen'
      : 'Fill both slots to start matchup';
    if (ready && !decided) {
      vsBtn.classList.add('vs-launch-active');
    } else if (decided) {
      vsBtn.classList.add('vs-launch-decided');
    }

    vsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!ready) return;
      openVsOverlay(roundIndex, matchIndex);
    });

    seam.appendChild(vsBtn);

    if (decided) {
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'match-reset-btn';
      resetBtn.title = 'Clear this match result';
      resetBtn.setAttribute('aria-label', 'Clear match result');
      resetBtn.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';
      resetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        store.clearMatchWinner(roundIndex, matchIndex);
      });
      seam.appendChild(resetBtn);
    }

    card.appendChild(slotTop);
    card.appendChild(seam);
    card.appendChild(slotBottom);
    return card;
  }

  function createWinnerCard(champion) {
    const card = document.createElement('div');
    card.className = 'winner-card';
    card.id = 'winner-card';
    if (champion) card.classList.add('winner-filled');

    const label = document.createElement('div');
    label.className = 'winner-label';
    label.textContent = 'Winner';
    card.appendChild(label);

    const portraitWrap = document.createElement('div');
    portraitWrap.className = 'winner-portrait';
    if (champion && champion.image) {
      const img = document.createElement('img');
      img.src = champion.image;
      img.alt = champion.name;
      img.addEventListener('error', () => {
        portraitWrap.innerHTML = `<span class="winner-monogram">${escapeHtml(getInitials(champion.name))}</span>`;
      });
      portraitWrap.appendChild(img);
    } else if (champion) {
      portraitWrap.innerHTML = `<span class="winner-monogram">${escapeHtml(getInitials(champion.name))}</span>`;
    } else {
      portraitWrap.innerHTML = '<span class="winner-placeholder">—</span>';
    }
    card.appendChild(portraitWrap);

    const nameEl = document.createElement('div');
    nameEl.className = 'winner-name';
    nameEl.textContent = champion ? champion.name : 'TBD';
    card.appendChild(nameEl);

    return card;
  }

  function buildRoundColumn(roundIndex, matchesSlice, startMatchIdx, totalRounds, columnHeight, sideClass) {
    const col = document.createElement('div');
    col.className = `round-column ${sideClass || ''}`.trim();
    col.dataset.round = String(roundIndex);

    const header = document.createElement('div');
    header.className = 'round-header';
    header.textContent = BracketApp.getRoundLabel(roundIndex, totalRounds);
    col.appendChild(header);

    const list = document.createElement('div');
    list.className = 'round-matches';
    list.style.height = `${columnHeight}px`;

    for (let i = 0; i < matchesSlice.length; i++) {
      const mIdx = startMatchIdx + i;
      const card = createMatchCard(roundIndex, mIdx, matchesSlice[i], totalRounds);
      list.appendChild(card);
    }

    col.appendChild(list);
    return col;
  }

  function renderBracket(meta) {
    const state = store.state;
    const totalRounds = state.rounds.length;
    const r0Count = state.rounds[0].length;

    dom.bracketRoot.innerHTML = '';
    dom.bracketRoot.className = `bracket-root layout-${state.layout} size-${state.size}`;

    if (state.layout === 'split' && totalRounds >= 2) {
      const halfR0 = r0Count / 2;
      const unitHeight = state.size >= 32 ? 148 : 168;
      const colHeight = Math.max(360, halfR0 * unitHeight);

      // Left half: rounds 0 .. totalRounds - 2 (first half of matches)
      for (let r = 0; r < totalRounds - 1; r++) {
        const matches = state.rounds[r];
        const half = matches.length / 2;
        const col = buildRoundColumn(
          r,
          matches.slice(0, half),
          0,
          totalRounds,
          colHeight,
          'side-left'
        );
        dom.bracketRoot.appendChild(col);
      }

      // Center column: Winner card + Final match
      const centerCol = document.createElement('div');
      centerCol.className = 'round-column center-column';

      const centerHeader = document.createElement('div');
      centerHeader.className = 'round-header';
      centerHeader.textContent = 'Final';
      centerCol.appendChild(centerHeader);

      const centerStack = document.createElement('div');
      centerStack.className = 'center-stack';
      centerStack.style.height = `${colHeight}px`;

      const winnerCard = createWinnerCard(state.champion);
      const finalMatch = state.rounds[totalRounds - 1][0];
      const finalCard = createMatchCard(
        totalRounds - 1,
        0,
        finalMatch,
        totalRounds,
        'match-final'
      );

      centerStack.appendChild(winnerCard);
      centerStack.appendChild(finalCard);
      centerCol.appendChild(centerStack);
      dom.bracketRoot.appendChild(centerCol);

      // Right half: rounds totalRounds - 2 down to 0 (second half of matches)
      for (let r = totalRounds - 2; r >= 0; r--) {
        const matches = state.rounds[r];
        const half = matches.length / 2;
        const col = buildRoundColumn(
          r,
          matches.slice(half),
          half,
          totalRounds,
          colHeight,
          'side-right'
        );
        dom.bracketRoot.appendChild(col);
      }
    } else {
      // Linear left-to-right layout
      const unitHeight = state.size >= 16 ? 148 : 168;
      const colHeight = Math.max(380, r0Count * unitHeight);

      for (let r = 0; r < totalRounds; r++) {
        const col = buildRoundColumn(
          r,
          state.rounds[r],
          0,
          totalRounds,
          colHeight,
          'side-left'
        );
        dom.bracketRoot.appendChild(col);
      }

      const winnerCol = document.createElement('div');
      winnerCol.className = 'round-column winner-column';

      const header = document.createElement('div');
      header.className = 'round-header';
      header.textContent = 'Winner';
      winnerCol.appendChild(header);

      const wrap = document.createElement('div');
      wrap.className = 'round-matches';
      wrap.style.height = `${colHeight}px`;
      wrap.appendChild(createWinnerCard(state.champion));
      winnerCol.appendChild(wrap);
      dom.bracketRoot.appendChild(winnerCol);
    }

    syncToolbarState();

    // Measure and render SVG connectors + auto-fit on layout/size changes
    requestAnimationFrame(() => {
      if (meta && (meta.type === 'resize' || meta.type === 'layout' || meta.type === 'import' || meta.type === 'init')) {
        fitToViewport();
      } else if (autoFitLocked) {
        fitToViewport();
      }
      drawConnectors();

      // Subtle highlight pulse on newly advanced slot
      if (meta && meta.type === 'winner' && meta.advancedTarget) {
        let pulseTarget = null;
        if (meta.advancedTarget.champion) {
          pulseTarget = document.getElementById('winner-card');
        } else {
          const t = meta.advancedTarget;
          pulseTarget = dom.bracketRoot.querySelector(
            `.slot[data-round="${t.roundIndex}"][data-match="${t.matchIndex}"][data-side="${t.side}"]`
          );
        }
        if (pulseTarget) {
          pulseTarget.classList.add('slot-just-advanced');
          setTimeout(() => pulseTarget.classList.remove('slot-just-advanced'), 900);
        }
      }
    });
  }

  function syncToolbarState() {
    const state = store.state;
    if (document.activeElement !== dom.titleInput) {
      dom.titleInput.value = state.title;
    }
    document.title = state.title || 'Tournament Bracket';

    dom.sizeButtons.forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.size) === state.size);
    });
    dom.layoutButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.layout === state.layout);
    });
    dom.btnUndo.disabled = !store.canUndo();
  }

  // ==================== SVG CONNECTOR LINES ====================

  function drawConnectors() {
    const svg = dom.bracketConnectors;
    const stageRect = dom.bracketStage.getBoundingClientRect();
    const natW = dom.bracketRoot.offsetWidth;
    const natH = dom.bracketRoot.offsetHeight;
    if (!natW || !natH) return;

    svg.setAttribute('width', String(natW));
    svg.setAttribute('height', String(natH));
    svg.setAttribute('viewBox', `0 0 ${natW} ${natH}`);
    svg.innerHTML = '';

    const s = zoomScale || 1;
    const toLocal = (rect) => ({
      left: (rect.left - stageRect.left) / s,
      right: (rect.right - stageRect.left) / s,
      top: (rect.top - stageRect.top) / s,
      bottom: (rect.bottom - stageRect.top) / s,
      cx: (rect.left + rect.right) / 2 / s - stageRect.left / s,
      cy: (rect.top + rect.bottom) / 2 / s - stageRect.top / s,
    });

    const addPath = (d, active) => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', active ? 'connector-line connector-active' : 'connector-line');
      svg.appendChild(path);
    };

    const state = store.state;
    const totalRounds = state.rounds.length;

    const getCard = (r, m) =>
      dom.bracketRoot.querySelector(`.match-card[data-round="${r}"][data-match="${m}"]`);
    const getSlot = (r, m, side) =>
      dom.bracketRoot.querySelector(
        `.slot[data-round="${r}"][data-match="${m}"][data-side="${side}"]`
      );

    if (state.layout === 'split' && totalRounds >= 2) {
      // Connect non-final rounds on left and right sides
      for (let r = 0; r < totalRounds - 1; r++) {
        const matches = state.rounds[r];
        const half = matches.length / 2;
        for (let m = 0; m < matches.length; m++) {
          const isRightHalf = m >= half;
          const feederEl = getCard(r, m);
          const nextR = r + 1;
          const nextM = Math.floor(m / 2);
          const nextSide = m % 2;
          const targetEl = getSlot(nextR, nextM, nextSide);
          if (!feederEl || !targetEl) continue;

          const f = toLocal(feederEl.getBoundingClientRect());
          const t = toLocal(targetEl.getBoundingClientRect());
          const active = matches[m].winnerIndex !== null;

          if (!isRightHalf) {
            const x1 = f.right;
            const y1 = f.cy;
            const x2 = t.left;
            const y2 = t.cy;
            const midX = (x1 + x2) / 2;
            addPath(`M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`, active);
          } else {
            const x1 = f.left;
            const y1 = f.cy;
            const x2 = t.right;
            const y2 = t.cy;
            const midX = (x1 + x2) / 2;
            addPath(`M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`, active);
          }
        }
      }

      // Connect Final card upward to Winner card
      const finalCard = getCard(totalRounds - 1, 0);
      const winnerCard = document.getElementById('winner-card');
      if (finalCard && winnerCard) {
        const fc = toLocal(finalCard.getBoundingClientRect());
        const wc = toLocal(winnerCard.getBoundingClientRect());
        const active = Boolean(state.champion);
        addPath(`M ${fc.cx} ${fc.top} V ${wc.bottom}`, active);
      }
    } else {
      // Linear left-to-right connectors
      for (let r = 0; r < totalRounds - 1; r++) {
        const matches = state.rounds[r];
        for (let m = 0; m < matches.length; m++) {
          const feederEl = getCard(r, m);
          const targetEl = getSlot(r + 1, Math.floor(m / 2), m % 2);
          if (!feederEl || !targetEl) continue;

          const f = toLocal(feederEl.getBoundingClientRect());
          const t = toLocal(targetEl.getBoundingClientRect());
          const x1 = f.right;
          const y1 = f.cy;
          const x2 = t.left;
          const y2 = t.cy;
          const midX = (x1 + x2) / 2;
          addPath(`M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`, matches[m].winnerIndex !== null);
        }
      }

      // Connect Final match to Winner card
      const finalCard = getCard(totalRounds - 1, 0);
      const winnerCard = document.getElementById('winner-card');
      if (finalCard && winnerCard) {
        const fc = toLocal(finalCard.getBoundingClientRect());
        const wc = toLocal(winnerCard.getBoundingClientRect());
        const midX = (fc.right + wc.left) / 2;
        addPath(
          `M ${fc.right} ${fc.cy} H ${midX} V ${wc.cy} H ${wc.left}`,
          Boolean(state.champion)
        );
      }
    }
  }

  // ==================== AUTOCOMPLETE PORTAL ====================

  function positionAutocomplete(inputEl) {
    const portal = dom.autocompletePortal;
    const slotEl = inputEl.closest('.slot') || inputEl;
    const rect = slotEl.getBoundingClientRect();
    const dropWidth = Math.max(290, Math.min(360, rect.width + 44));
    const maxHeight = 360;

    let left = rect.left;
    if (left + dropWidth > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - dropWidth - 12);
    }

    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const openUpward = spaceBelow < 230 && rect.top > spaceBelow;

    portal.style.width = `${dropWidth}px`;
    portal.style.left = `${Math.round(left)}px`;

    if (openUpward) {
      portal.style.top = 'auto';
      portal.style.bottom = `${Math.round(window.innerHeight - rect.top + 6)}px`;
      portal.style.maxHeight = `${Math.min(maxHeight, rect.top - 16)}px`;
    } else {
      portal.style.bottom = 'auto';
      portal.style.top = `${Math.round(rect.bottom + 6)}px`;
      portal.style.maxHeight = `${Math.min(maxHeight, spaceBelow)}px`;
    }
  }

  function closeAutocomplete() {
    if (!acActive) return;
    clearTimeout(acActive.timer);
    if (acActive.abortController) {
      acActive.abortController.abort();
    }
    acActive = null;
    dom.autocompletePortal.hidden = true;
    dom.autocompletePortal.innerHTML = '';
  }

  function openAutocompleteFor(inputEl, matchIndex, side, existingChar) {
    const query = inputEl.value.trim();

    if (acActive && acActive.inputEl === inputEl) {
      clearTimeout(acActive.timer);
      if (acActive.abortController) acActive.abortController.abort();
    } else {
      closeAutocomplete();
      acActive = {
        matchIndex,
        side,
        inputEl,
        existingChar: existingChar || null,
        items: [],
        highlightedIndex: 0,
        query: '',
        provider: BracketApp.api.getActiveProvider(),
        loading: false,
        error: '',
        abortController: null,
        timer: null,
      };
    }

    acActive.query = query;
    if (!query) {
      dom.autocompletePortal.hidden = true;
      return;
    }

    acActive.loading = true;
    acActive.error = '';
    positionAutocomplete(inputEl);
    renderAutocomplete();

    const currentSession = acActive;
    currentSession.timer = setTimeout(async () => {
      if (acActive !== currentSession) return;
      const controller = new AbortController();
      currentSession.abortController = controller;

      try {
        const res = await BracketApp.api.searchCharacters(query, controller.signal);
        if (acActive !== currentSession) return;
        currentSession.loading = false;
        currentSession.items = res.items || [];
        currentSession.provider = res.provider || 'mal';
        currentSession.error = res.error || '';
        currentSession.highlightedIndex = 0;
        positionAutocomplete(inputEl);
        renderAutocomplete();
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        if (acActive !== currentSession) return;
        currentSession.loading = false;
        currentSession.items = [];
        currentSession.error = 'Search failed';
        renderAutocomplete();
      }
    }, DEBOUNCE_MS);
  }

  function renderAutocomplete() {
    if (!acActive) return;
    const portal = dom.autocompletePortal;
    portal.innerHTML = '';
    portal.hidden = false;

    const list = document.createElement('div');
    list.className = 'ac-list';

    if (acActive.loading) {
      const loadingRow = document.createElement('div');
      loadingRow.className = 'ac-status-row';
      loadingRow.innerHTML = '<span class="ac-spinner"></span><span>Searching...</span>';
      list.appendChild(loadingRow);
    } else if (acActive.items.length > 0) {
      acActive.items.forEach((item, idx) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'ac-item';
        row.setAttribute('role', 'option');
        if (idx === acActive.highlightedIndex) row.classList.add('ac-active');

        const thumb = document.createElement('div');
        thumb.className = 'ac-thumb';
        if (item.image) {
          const img = document.createElement('img');
          img.src = item.image;
          img.alt = '';
          img.loading = 'eager';
          img.addEventListener('error', () => {
            thumb.innerHTML = `<span class="ac-thumb-mono">${escapeHtml(getInitials(item.name))}</span>`;
          });
          thumb.appendChild(img);
        } else {
          thumb.innerHTML = `<span class="ac-thumb-mono">${escapeHtml(getInitials(item.name))}</span>`;
        }

        const meta = document.createElement('div');
        meta.className = 'ac-meta';

        const nameEl = document.createElement('div');
        nameEl.className = 'ac-name';
        nameEl.textContent = item.name;
        meta.appendChild(nameEl);

        const subParts = [];
        if (item.sourceTitle) subParts.push(item.sourceTitle);
        const favStr = formatFavorites(item.favorites);
        if (favStr) subParts.push(`${favStr} favs`);

        if (subParts.length) {
          const subEl = document.createElement('div');
          subEl.className = 'ac-sub';
          subEl.textContent = subParts.join(' · ');
          meta.appendChild(subEl);
        }

        row.appendChild(thumb);
        row.appendChild(meta);

        row.addEventListener('mouseenter', () => {
          acActive.highlightedIndex = idx;
          updateAutocompleteHighlight();
        });

        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          selectAutocompleteItem(item);
        });

        list.appendChild(row);
      });
    } else {
      const emptyRow = document.createElement('div');
      emptyRow.className = 'ac-status-row';
      emptyRow.textContent = acActive.error || 'No characters found';
      list.appendChild(emptyRow);
    }

    // Always offer manual custom entry at the bottom
    const customIdx = acActive.items.length;
    const customRow = document.createElement('button');
    customRow.type = 'button';
    customRow.className = 'ac-item ac-custom-item';
    if (!acActive.loading && acActive.highlightedIndex === customIdx) {
      customRow.classList.add('ac-active');
    }
    customRow.innerHTML = `<span class="ac-custom-plus">+</span><span>Use "<strong>${escapeHtml(
      acActive.query
    )}</strong>" as custom entry</span>`;
    customRow.addEventListener('mouseenter', () => {
      acActive.highlightedIndex = customIdx;
      updateAutocompleteHighlight();
    });
    customRow.addEventListener('mousedown', (e) => {
      e.preventDefault();
      commitCustomEntry(acActive.matchIndex, acActive.side, acActive.query);
    });
    list.appendChild(customRow);

    portal.appendChild(list);

    const footer = document.createElement('div');
    footer.className = 'ac-footer';
    const providerLabels = {
      mal: 'Source: MyAnimeList',
      jikan: 'Source: MyAnimeList (Jikan)',
      anilist: 'Source: Fallback directory',
      offline: 'Offline mode',
    };
    footer.textContent = providerLabels[acActive.provider] || 'Source: MyAnimeList';
    portal.appendChild(footer);
  }

  function updateAutocompleteHighlight() {
    if (!acActive) return;
    const rows = dom.autocompletePortal.querySelectorAll('.ac-item');
    rows.forEach((row, idx) => {
      row.classList.toggle('ac-active', idx === acActive.highlightedIndex);
      if (idx === acActive.highlightedIndex) {
        row.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function moveAutocompleteHighlight(delta) {
    if (!acActive) return;
    const total = acActive.items.length + 1; // +1 for custom entry row
    acActive.highlightedIndex = (acActive.highlightedIndex + delta + total) % total;
    updateAutocompleteHighlight();
  }

  function confirmAutocompleteSelection() {
    if (!acActive) return;
    if (acActive.highlightedIndex < acActive.items.length) {
      selectAutocompleteItem(acActive.items[acActive.highlightedIndex]);
    } else if (acActive.query) {
      commitCustomEntry(acActive.matchIndex, acActive.side, acActive.query);
    }
  }

  function selectAutocompleteItem(item) {
    if (!acActive) return;
    const { matchIndex, side } = acActive;
    closeAutocomplete();
    store.setSeedSlot(matchIndex, side, item);
  }

  function commitCustomEntry(matchIndex, side, name) {
    const clean = String(name || '').trim();
    if (!clean) return;
    closeAutocomplete();
    store.setSeedSlot(matchIndex, side, {
      id: `custom:${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      malId: null,
      name: clean,
      image: '',
      sourceTitle: '',
      favorites: 0,
      provider: 'custom',
    });
  }

  // ==================== FULLSCREEN VS OVERLAY ====================

  function populateVsSide(sideIdx, character) {
    const isLeft = sideIdx === 0;
    const imgEl = isLeft ? dom.vsLeftImg : dom.vsRightImg;
    const blurEl = isLeft ? dom.vsLeftBlur : dom.vsRightBlur;
    const monoEl = isLeft ? dom.vsLeftMonogram : dom.vsRightMonogram;
    const nameEl = isLeft ? dom.vsLeftName : dom.vsRightName;
    const subEl = isLeft ? dom.vsLeftSub : dom.vsRightSub;

    nameEl.textContent = character.name;
    subEl.textContent = character.sourceTitle || '';
    subEl.hidden = !character.sourceTitle;

    if (character.image) {
      imgEl.hidden = false;
      blurEl.hidden = false;
      monoEl.hidden = true;
      imgEl.alt = character.name;
      imgEl.src = character.image;
      blurEl.src = character.image;

      imgEl.onerror = () => {
        imgEl.hidden = true;
        blurEl.hidden = true;
        monoEl.hidden = false;
        monoEl.textContent = getInitials(character.name);
      };
    } else {
      imgEl.hidden = true;
      blurEl.hidden = true;
      imgEl.removeAttribute('src');
      blurEl.removeAttribute('src');
      monoEl.hidden = false;
      monoEl.textContent = getInitials(character.name);
    }
  }

  function openVsOverlay(roundIndex, matchIndex) {
    const state = store.state;
    const match = state.rounds[roundIndex] && state.rounds[roundIndex][matchIndex];
    if (!match || !match.slots[0] || !match.slots[1]) return;

    closeAutocomplete();

    vsState = {
      roundIndex,
      matchIndex,
      deciding: false,
      fitMode: vsState ? vsState.fitMode : 'cover',
    };

    dom.vsOverlay.classList.remove('vs-mode-contain', 'vs-deciding');
    if (vsState.fitMode === 'contain') {
      dom.vsOverlay.classList.add('vs-mode-contain');
    }
    dom.vsBtnFitMode.textContent = vsState.fitMode === 'cover' ? 'Fill' : 'Fit';

    dom.vsSideLeft.classList.remove('vs-winner-chosen', 'vs-loser-chosen');
    dom.vsSideRight.classList.remove('vs-winner-chosen', 'vs-loser-chosen');

    populateVsSide(0, match.slots[0]);
    populateVsSide(1, match.slots[1]);

    dom.vsMatchLabel.textContent = BracketApp.getMatchLabel(
      roundIndex,
      matchIndex,
      state.rounds.length
    );

    dom.vsOverlay.hidden = false;
    requestAnimationFrame(() => {
      dom.vsOverlay.classList.add('vs-open');
      flameRenderer.start();
    });
  }

  function closeVsOverlay() {
    if (!vsState) return;
    dom.vsOverlay.classList.remove('vs-open', 'vs-deciding');
    flameRenderer.stop();
    const finishClose = () => {
      dom.vsOverlay.hidden = true;
      vsState = null;
    };
    setTimeout(finishClose, 180);
  }

  function decideVsWinner(sideIndex) {
    if (!vsState || vsState.deciding) return;
    vsState.deciding = true;

    const { roundIndex, matchIndex } = vsState;
    const winnerBtn = sideIndex === 0 ? dom.vsSideLeft : dom.vsSideRight;
    const loserBtn = sideIndex === 0 ? dom.vsSideRight : dom.vsSideLeft;

    dom.vsOverlay.classList.add('vs-deciding');
    winnerBtn.classList.add('vs-winner-chosen');
    loserBtn.classList.add('vs-loser-chosen');
    flameRenderer.setHover(sideIndex === 0 ? -1 : 1);
    flameRenderer.triggerBurst();

    setTimeout(() => {
      closeVsOverlay();
      store.selectWinner(roundIndex, matchIndex, sideIndex);
    }, 430);
  }

  // ==================== FILE IMPORT / EXPORT ====================

  function exportBracketFile() {
    const json = store.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug = (store.state.title || 'tournament-bracket')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'tournament-bracket';
    a.href = url;
    a.download = `${slug}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Bracket exported');
  }

  // ==================== EVENT WIRING ====================

  function bindEvents() {
    // Title editing
    dom.titleInput.addEventListener('input', () => {
      store.setTitle(dom.titleInput.value);
      document.title = dom.titleInput.value.trim() || 'Tournament Bracket';
    });

    // Bracket size buttons
    dom.sizeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const size = Number(btn.dataset.size);
        store.setSize(size);
      });
    });

    // Layout buttons
    dom.layoutButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        store.setLayout(btn.dataset.layout);
      });
    });

    // Actions
    dom.btnShuffle.addEventListener('click', () => {
      const ok = store.shuffleSeeds();
      showToast(ok ? 'Round 1 shuffled' : 'Add at least 2 characters to shuffle');
    });

    dom.btnUndo.addEventListener('click', () => {
      if (store.undo()) showToast('Undone');
    });

    dom.btnResetResults.addEventListener('click', () => {
      if (confirm('Clear all match winners and keep Round 1 characters?')) {
        store.resetResults();
        showToast('Results reset');
      }
    });

    dom.btnClearAll.addEventListener('click', () => {
      if (confirm('Clear all characters and match results?')) {
        store.clearAll();
        showToast('Bracket cleared');
      }
    });

    dom.btnExport.addEventListener('click', exportBracketFile);

    dom.btnImport.addEventListener('click', () => {
      dom.fileImport.value = '';
      dom.fileImport.click();
    });

    dom.fileImport.addEventListener('change', () => {
      const file = dom.fileImport.files && dom.fileImport.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          store.importJSON(String(reader.result || ''));
          showToast('Bracket imported');
        } catch (err) {
          showToast('Invalid bracket JSON file');
        }
      };
      reader.readAsText(file);
    });

    // Custom local character image upload
    dom.customImageFile.addEventListener('change', () => {
      const file = dom.customImageFile.files && dom.customImageFile.files[0];
      const target = pendingImageTarget;
      pendingImageTarget = null;
      if (!file || !target) return;

      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          store.updateSeedImage(target.matchIndex, target.side, reader.result);
          showToast('Character image updated');
        }
      };
      reader.readAsDataURL(file);
    });

    // Zoom & view controls
    dom.btnZoomIn.addEventListener('click', () => setManualZoom(zoomScale * 1.15));
    dom.btnZoomOut.addEventListener('click', () => setManualZoom(zoomScale / 1.15));
    dom.btnZoomFit.addEventListener('click', () => {
      fitToViewport();
      drawConnectors();
    });

    dom.btnTheme.addEventListener('click', () => {
      const curr = document.documentElement.getAttribute('data-theme');
      applyTheme(curr === 'dark' ? 'light' : 'dark');
    });

    dom.btnFullscreen.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    // Drag-to-pan on empty viewport canvas
    dom.bracketViewport.addEventListener('mousedown', (e) => {
      if (
        e.button !== 0 ||
        e.target.closest('button, input, .slot, .match-card, .winner-card')
      ) {
        return;
      }
      isPanning = true;
      autoFitLocked = false;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panOriginX = panX;
      panOriginY = panY;
      dom.bracketViewport.classList.add('is-panning');
      closeAutocomplete();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isPanning) return;
      panX = panOriginX + (e.clientX - panStartX);
      panY = panOriginY + (e.clientY - panStartY);
      applyStageTransform();
    });

    window.addEventListener('mouseup', () => {
      if (!isPanning) return;
      isPanning = false;
      dom.bracketViewport.classList.remove('is-panning');
    });

    // Wheel zoom (Ctrl+Wheel or Alt+Wheel) or wheel pan
    dom.bracketViewport.addEventListener(
      'wheel',
      (e) => {
        if (vsState) return;
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const factor = e.deltaY < 0 ? 1.1 : 0.91;
          setManualZoom(zoomScale * factor, e.clientX, e.clientY);
        } else if (!autoFitLocked) {
          e.preventDefault();
          panX -= e.deltaX;
          panY -= e.deltaY;
          applyStageTransform();
        }
      },
      { passive: false }
    );

    // VS overlay interactions
    dom.vsSideLeft.addEventListener('mouseenter', () => {
      if (vsState && !vsState.deciding) flameRenderer.setHover(-1);
    });
    dom.vsSideRight.addEventListener('mouseenter', () => {
      if (vsState && !vsState.deciding) flameRenderer.setHover(1);
    });
    dom.vsSideLeft.addEventListener('mouseleave', () => {
      if (vsState && !vsState.deciding) flameRenderer.setHover(0);
    });
    dom.vsSideRight.addEventListener('mouseleave', () => {
      if (vsState && !vsState.deciding) flameRenderer.setHover(0);
    });

    dom.vsSideLeft.addEventListener('click', () => decideVsWinner(0));
    dom.vsSideRight.addEventListener('click', () => decideVsWinner(1));

    dom.vsBtnClose.addEventListener('click', () => {
      if (vsState && !vsState.deciding) closeVsOverlay();
    });

    dom.vsBtnFitMode.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!vsState) return;
      vsState.fitMode = vsState.fitMode === 'cover' ? 'contain' : 'cover';
      dom.vsOverlay.classList.toggle('vs-mode-contain', vsState.fitMode === 'contain');
      dom.vsBtnFitMode.textContent = vsState.fitMode === 'cover' ? 'Fill' : 'Fit';
    });

    // Global keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (vsState) {
        if (e.key === 'Escape' && !vsState.deciding) {
          e.preventDefault();
          closeVsOverlay();
        } else if ((e.key === 'ArrowLeft' || e.key === '1') && !vsState.deciding) {
          e.preventDefault();
          decideVsWinner(0);
        } else if ((e.key === 'ArrowRight' || e.key === '2') && !vsState.deciding) {
          e.preventDefault();
          decideVsWinner(1);
        }
        return;
      }

      // Ctrl/Cmd+Z undo (when not typing inside an input)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          if (store.undo()) showToast('Undone');
        }
      }
    });

    // ResizeObserver keeps bracket fitted on window / fullscreen / projector resolution changes
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        if (autoFitLocked) {
          fitToViewport();
        }
        drawConnectors();
      });
      ro.observe(dom.bracketViewport);
    } else {
      window.addEventListener('resize', () => {
        if (autoFitLocked) fitToViewport();
        drawConnectors();
      });
    }
  }

  // ==================== BOOTSTRAP ====================

  function init() {
    dom.titleInput = document.getElementById('tournament-title');
    dom.apiStatusBadge = document.getElementById('api-status-badge');
    dom.sizeButtons = Array.from(document.querySelectorAll('[data-size]'));
    dom.layoutButtons = Array.from(document.querySelectorAll('[data-layout]'));
    dom.btnShuffle = document.getElementById('btn-shuffle');
    dom.btnUndo = document.getElementById('btn-undo');
    dom.btnResetResults = document.getElementById('btn-reset-results');
    dom.btnClearAll = document.getElementById('btn-clear-all');
    dom.btnImport = document.getElementById('btn-import');
    dom.fileImport = document.getElementById('file-import');
    dom.btnExport = document.getElementById('btn-export');
    dom.customImageFile = document.getElementById('custom-image-file');

    dom.btnZoomOut = document.getElementById('btn-zoom-out');
    dom.btnZoomFit = document.getElementById('btn-zoom-fit');
    dom.btnZoomIn = document.getElementById('btn-zoom-in');
    dom.btnTheme = document.getElementById('btn-theme');
    dom.iconSun = document.getElementById('icon-theme-sun');
    dom.iconMoon = document.getElementById('icon-theme-moon');
    dom.btnFullscreen = document.getElementById('btn-fullscreen');

    dom.bracketViewport = document.getElementById('bracket-viewport');
    dom.bracketStage = document.getElementById('bracket-stage');
    dom.bracketConnectors = document.getElementById('bracket-connectors');
    dom.bracketRoot = document.getElementById('bracket-root');
    dom.autocompletePortal = document.getElementById('autocomplete-portal');
    dom.toast = document.getElementById('toast');

    dom.vsOverlay = document.getElementById('vs-overlay');
    dom.vsSideLeft = document.getElementById('vs-side-left');
    dom.vsSideRight = document.getElementById('vs-side-right');
    dom.vsLeftImg = document.getElementById('vs-left-img');
    dom.vsLeftBlur = document.getElementById('vs-left-blur');
    dom.vsLeftMonogram = document.getElementById('vs-left-monogram');
    dom.vsLeftName = document.getElementById('vs-left-name');
    dom.vsLeftSub = document.getElementById('vs-left-sub');
    dom.vsRightImg = document.getElementById('vs-right-img');
    dom.vsRightBlur = document.getElementById('vs-right-blur');
    dom.vsRightMonogram = document.getElementById('vs-right-monogram');
    dom.vsRightName = document.getElementById('vs-right-name');
    dom.vsRightSub = document.getElementById('vs-right-sub');
    dom.vsMatchLabel = document.getElementById('vs-match-label');
    dom.vsBtnFitMode = document.getElementById('vs-btn-fitmode');
    dom.vsBtnClose = document.getElementById('vs-btn-close');
    dom.vsFlameCanvas = document.getElementById('vs-flame-canvas');

    initTheme();

    store = new BracketApp.BracketStore();
    flameRenderer = new BracketApp.FlameRenderer(dom.vsFlameCanvas);

    BracketApp.api.onProviderChange(updateProviderBadge);
    BracketApp.api.probeLocalProxy();

    store.subscribe((_state, meta) => {
      renderBracket(meta);
    });

    bindEvents();
    renderBracket({ type: 'init' });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
