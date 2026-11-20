(function (global) {
  'use strict';

  const BracketApp = (global.BracketApp = global.BracketApp || {});

  const STORAGE_KEY = 'mal_tournament_bracket_state_v1';
  const VALID_SIZES = [4, 8, 16, 32];
  const MAX_UNDO = 40;

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function normalizeChar(c) {
    if (!c || typeof c !== 'object' || !c.name) return null;
    return {
      id: String(c.id || `custom:${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
      malId: c.malId != null ? Number(c.malId) : null,
      name: String(c.name).trim(),
      image: typeof c.image === 'string' ? c.image : '',
      sourceTitle: typeof c.sourceTitle === 'string' ? c.sourceTitle : '',
      favorites: Number(c.favorites) || 0,
      provider: typeof c.provider === 'string' ? c.provider : 'custom',
    };
  }

  function createEmptyRounds(size) {
    const totalRounds = Math.log2(size);
    const rounds = [];
    for (let r = 0; r < totalRounds; r++) {
      const matchCount = size / Math.pow(2, r + 1);
      const matches = [];
      for (let m = 0; m < matchCount; m++) {
        matches.push({
          slots: [null, null],
          winnerIndex: null,
        });
      }
      rounds.push(matches);
    }
    return rounds;
  }

  function defaultLayoutForSize(size) {
    return size >= 16 ? 'split' : 'linear';
  }

  function getRoundLabel(roundIndex, totalRounds) {
    const fromEnd = totalRounds - 1 - roundIndex;
    if (fromEnd === 0) return 'Final';
    if (fromEnd === 1) return 'Semifinals';
    if (fromEnd === 2) return 'Quarterfinals';
    return `Round ${roundIndex + 1}`;
  }

  function getMatchLabel(roundIndex, matchIndex, totalRounds) {
    const roundName = getRoundLabel(roundIndex, totalRounds);
    if (roundName === 'Final') return 'Final';
    const singular = roundName.endsWith('s') ? roundName.slice(0, -1) : roundName;
    return `${singular} ${matchIndex + 1}`;
  }

  class BracketStore {
    constructor() {
      this.undoStack = [];
      this.listeners = [];
      this.state = this._loadInitial();
    }

    _createDefaultState(size) {
      const s = VALID_SIZES.includes(size) ? size : 8;
      return {
        version: 1,
        title: 'Tournament Bracket',
        size: s,
        layout: defaultLayoutForSize(s),
        rounds: createEmptyRounds(s),
        champion: null,
      };
    }

    _loadInitial() {
      try {
        const raw = global.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const validated = this._validateImportedState(parsed);
          if (validated) return validated;
        }
      } catch (_) {
        // Ignore storage restrictions
      }
      return this._createDefaultState(8);
    }

    _persist() {
      try {
        global.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch (_) {
        // Ignore quota or sandboxed file:// storage errors
      }
    }

    _pushUndo() {
      this.undoStack.push(clone(this.state));
      if (this.undoStack.length > MAX_UNDO) {
        this.undoStack.shift();
      }
    }

    _emit(meta) {
      this._persist();
      this.listeners.forEach((fn) => {
        try {
          fn(this.state, meta || {});
        } catch (err) {
          console.error('Bracket listener error:', err);
        }
      });
    }

    subscribe(fn) {
      this.listeners.push(fn);
    }

    canUndo() {
      return this.undoStack.length > 0;
    }

    undo() {
      if (!this.undoStack.length) return false;
      this.state = this.undoStack.pop();
      this._emit({ type: 'undo' });
      return true;
    }

    setTitle(title) {
      this.state.title = String(title || '').slice(0, 120);
      this._persist();
    }

    setLayout(layout) {
      if (layout !== 'linear' && layout !== 'split') return;
      if (this.state.layout === layout) return;
      this.state.layout = layout;
      this._emit({ type: 'layout' });
    }

    setSize(newSize) {
      if (!VALID_SIZES.includes(newSize) || newSize === this.state.size) return;
      this._pushUndo();

      // Preserve existing Round 1 entrants in order
      const existingSeeds = [];
      const r0 = this.state.rounds[0] || [];
      for (let m = 0; m < r0.length; m++) {
        existingSeeds.push(r0[m].slots[0]);
        existingSeeds.push(r0[m].slots[1]);
      }

      const nextRounds = createEmptyRounds(newSize);
      for (let i = 0; i < Math.min(existingSeeds.length, newSize); i++) {
        const mIdx = Math.floor(i / 2);
        const side = i % 2;
        nextRounds[0][mIdx].slots[side] = existingSeeds[i] ? clone(existingSeeds[i]) : null;
      }

      this.state.size = newSize;
      this.state.layout = defaultLayoutForSize(newSize);
      this.state.rounds = nextRounds;
      this.state.champion = null;
      this._emit({ type: 'resize' });
    }

    _clearDownstreamFrom(roundIndex, matchIndex) {
      const rounds = this.state.rounds;
      if (roundIndex >= rounds.length - 1) {
        this.state.champion = null;
        return;
      }

      const nextRound = roundIndex + 1;
      const nextMatchIdx = Math.floor(matchIndex / 2);
      const nextSide = matchIndex % 2;
      const targetMatch = rounds[nextRound][nextMatchIdx];

      targetMatch.slots[nextSide] = null;
      if (targetMatch.winnerIndex !== null) {
        targetMatch.winnerIndex = null;
        this._clearDownstreamFrom(nextRound, nextMatchIdx);
      }
    }

    setSeedSlot(matchIndex, side, character) {
      const match = this.state.rounds[0] && this.state.rounds[0][matchIndex];
      if (!match || (side !== 0 && side !== 1)) return;

      this._pushUndo();
      match.slots[side] = normalizeChar(character);
      if (match.winnerIndex !== null) {
        match.winnerIndex = null;
        this._clearDownstreamFrom(0, matchIndex);
      }
      this._emit({ type: 'slot', roundIndex: 0, matchIndex, side });
    }

    updateSeedImage(matchIndex, side, imageUrl) {
      const match = this.state.rounds[0] && this.state.rounds[0][matchIndex];
      if (!match || !match.slots[side]) return;

      this._pushUndo();
      const targetId = match.slots[side].id;
      match.slots[side].image = imageUrl;

      // Propagate updated image to any advanced instances of this exact entrant
      for (let r = 1; r < this.state.rounds.length; r++) {
        for (let m = 0; m < this.state.rounds[r].length; m++) {
          for (let s = 0; s < 2; s++) {
            const slot = this.state.rounds[r][m].slots[s];
            if (slot && slot.id === targetId) {
              slot.image = imageUrl;
            }
          }
        }
      }
      if (this.state.champion && this.state.champion.id === targetId) {
        this.state.champion.image = imageUrl;
      }

      this._emit({ type: 'image', roundIndex: 0, matchIndex, side });
    }

    selectWinner(roundIndex, matchIndex, winnerSide) {
      const round = this.state.rounds[roundIndex];
      const match = round && round[matchIndex];
      if (!match || (winnerSide !== 0 && winnerSide !== 1)) return false;
      const winner = match.slots[winnerSide];
      if (!winner) return false;

      this._pushUndo();

      const changedWinner = match.winnerIndex !== winnerSide;
      if (changedWinner && match.winnerIndex !== null) {
        this._clearDownstreamFrom(roundIndex, matchIndex);
      }

      match.winnerIndex = winnerSide;

      let advancedTarget = null;
      if (roundIndex < this.state.rounds.length - 1) {
        const nextRound = roundIndex + 1;
        const nextMatchIdx = Math.floor(matchIndex / 2);
        const nextSide = matchIndex % 2;
        this.state.rounds[nextRound][nextMatchIdx].slots[nextSide] = clone(winner);
        advancedTarget = { roundIndex: nextRound, matchIndex: nextMatchIdx, side: nextSide };
      } else {
        this.state.champion = clone(winner);
        advancedTarget = { champion: true };
      }

      this._emit({
        type: 'winner',
        roundIndex,
        matchIndex,
        winnerSide,
        advancedTarget,
      });
      return true;
    }

    clearMatchWinner(roundIndex, matchIndex) {
      const match = this.state.rounds[roundIndex] && this.state.rounds[roundIndex][matchIndex];
      if (!match || match.winnerIndex === null) return;
      this._pushUndo();
      match.winnerIndex = null;
      this._clearDownstreamFrom(roundIndex, matchIndex);
      this._emit({ type: 'clear-winner', roundIndex, matchIndex });
    }

    resetResults() {
      this._pushUndo();
      const totalRounds = this.state.rounds.length;
      for (let m = 0; m < this.state.rounds[0].length; m++) {
        this.state.rounds[0][m].winnerIndex = null;
      }
      for (let r = 1; r < totalRounds; r++) {
        for (let m = 0; m < this.state.rounds[r].length; m++) {
          this.state.rounds[r][m].slots = [null, null];
          this.state.rounds[r][m].winnerIndex = null;
        }
      }
      this.state.champion = null;
      this._emit({ type: 'reset-results' });
    }

    clearAll() {
      this._pushUndo();
      this.state.rounds = createEmptyRounds(this.state.size);
      this.state.champion = null;
      this._emit({ type: 'clear-all' });
    }

    shuffleSeeds() {
      const r0 = this.state.rounds[0];
      const filled = [];
      for (let m = 0; m < r0.length; m++) {
        if (r0[m].slots[0]) filled.push(clone(r0[m].slots[0]));
        if (r0[m].slots[1]) filled.push(clone(r0[m].slots[1]));
      }
      if (filled.length < 2) return false;

      this._pushUndo();

      // Fisher-Yates shuffle
      for (let i = filled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = filled[i];
        filled[i] = filled[j];
        filled[j] = tmp;
      }

      const freshRounds = createEmptyRounds(this.state.size);
      for (let i = 0; i < filled.length; i++) {
        const mIdx = Math.floor(i / 2);
        const side = i % 2;
        freshRounds[0][mIdx].slots[side] = filled[i];
      }

      this.state.rounds = freshRounds;
      this.state.champion = null;
      this._emit({ type: 'shuffle' });
      return true;
    }

    exportJSON() {
      return JSON.stringify(this.state, null, 2);
    }

    _validateImportedState(data) {
      if (!data || typeof data !== 'object') return null;
      const size = Number(data.size);
      if (!VALID_SIZES.includes(size)) return null;
      const totalRounds = Math.log2(size);
      if (!Array.isArray(data.rounds) || data.rounds.length !== totalRounds) return null;

      const rounds = createEmptyRounds(size);
      for (let r = 0; r < totalRounds; r++) {
        const expected = size / Math.pow(2, r + 1);
        if (!Array.isArray(data.rounds[r]) || data.rounds[r].length !== expected) {
          return null;
        }
        for (let m = 0; m < expected; m++) {
          const src = data.rounds[r][m];
          if (!src || !Array.isArray(src.slots)) return null;
          rounds[r][m].slots = [normalizeChar(src.slots[0]), normalizeChar(src.slots[1])];
          const w = src.winnerIndex;
          rounds[r][m].winnerIndex =
            (w === 0 || w === 1) && rounds[r][m].slots[w] ? w : null;
        }
      }

      return {
        version: 1,
        title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : 'Tournament Bracket',
        size,
        layout: data.layout === 'linear' || data.layout === 'split' ? data.layout : defaultLayoutForSize(size),
        rounds,
        champion: normalizeChar(data.champion),
      };
    }

    importJSON(text) {
      const parsed = JSON.parse(text);
      const validated = this._validateImportedState(parsed);
      if (!validated) {
        throw new Error('Invalid bracket file format');
      }
      this._pushUndo();
      this.state = validated;
      this._emit({ type: 'import' });
      return true;
    }
  }

  BracketApp.BracketStore = BracketStore;
  BracketApp.getRoundLabel = getRoundLabel;
  BracketApp.getMatchLabel = getMatchLabel;
})(window);
