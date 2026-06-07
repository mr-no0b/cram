/* ============================================
   CRAM FLASHCARD PWA — Application Logic
   ============================================ */

// ═══════════════════════════════════════════
// DATABASE (IndexedDB + localStorage fallback)
// ═══════════════════════════════════════════
const DB = {
  db: null,
  DB_NAME: 'CramDB',
  DB_VERSION: 1,
  _ls: false,  // true = using localStorage fallback
  _data: null, // localStorage data cache

  async init() {
    // Try IndexedDB first, fall back to localStorage
    try {
      if (typeof indexedDB === 'undefined') throw new Error('No IndexedDB');
      await this._initIDB();
      console.log('DB: Using IndexedDB');
    } catch (e) {
      console.warn('DB: IndexedDB unavailable, using localStorage', e);
      this._ls = true;
      this._lsLoad();
    }
  },

  // ── IndexedDB init ──
  _initIDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('sets')) {
          const s = db.createObjectStore('sets', { keyPath: 'id', autoIncrement: true });
          s.createIndex('name', 'name', { unique: false });
          s.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('cards')) {
          db.createObjectStore('cards', { keyPath: 'id', autoIncrement: true })
            .createIndex('setId', 'setId', { unique: false });
        }
      };
      request.onsuccess = (e) => { this.db = e.target.result; resolve(); };
      request.onerror = (e) => reject(e.target.error);
    });
  },

  // ── localStorage helpers ──
  _lsLoad() {
    try {
      const raw = localStorage.getItem('cramData');
      this._data = raw ? JSON.parse(raw) : { sets: [], cards: [], nsi: 1, nci: 1 };
    } catch (e) {
      this._data = { sets: [], cards: [], nsi: 1, nci: 1 };
    }
  },
  _lsSave() { localStorage.setItem('cramData', JSON.stringify(this._data)); },

  // ── IDB helpers ──
  _tx(storeName, mode = 'readonly') {
    return this.db.transaction(storeName, mode).objectStore(storeName);
  },
  _request(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  // ── Sets ──
  async getAllSets() {
    if (this._ls) return [...this._data.sets];
    return this._request(this._tx('sets').getAll());
  },

  async getSet(id) {
    if (this._ls) return this._data.sets.find(s => s.id === id) || null;
    return this._request(this._tx('sets').get(id));
  },

  async createSet(name, frontLang = '', backLang = '') {
    const set = { name, frontLang, backLang, createdAt: Date.now(), lastStudied: null };
    if (this._ls) {
      set.id = this._data.nsi++;
      this._data.sets.push(set);
      this._lsSave();
      return set;
    }
    const store = this._tx('sets', 'readwrite');
    const id = await this._request(store.add(set));
    set.id = id;
    return set;
  },

  async updateSet(id, updates) {
    if (this._ls) {
      const set = this._data.sets.find(s => s.id === id);
      if (!set) return null;
      Object.assign(set, updates);
      this._lsSave();
      return set;
    }
    const set = await this.getSet(id);
    if (!set) return null;
    Object.assign(set, updates);
    await this._request(this._tx('sets', 'readwrite').put(set));
    return set;
  },

  async deleteSet(id) {
    if (this._ls) {
      this._data.sets = this._data.sets.filter(s => s.id !== id);
      this._data.cards = this._data.cards.filter(c => c.setId !== id);
      this._lsSave();
      return;
    }
    const cards = await this.getCardsBySet(id);
    const cardStore = this._tx('cards', 'readwrite');
    for (const card of cards) cardStore.delete(card.id);
    return this._request(this._tx('sets', 'readwrite').delete(id));
  },

  // ── Cards ──
  async getCardsBySet(setId) {
    if (this._ls) return this._data.cards.filter(c => c.setId === setId);
    return this._request(this._tx('cards').index('setId').getAll(setId));
  },

  async addCard(setId, front, back) {
    const card = { setId, front, back, level: 1 };
    if (this._ls) {
      card.id = this._data.nci++;
      this._data.cards.push(card);
      this._lsSave();
      return card;
    }
    const store = this._tx('cards', 'readwrite');
    const id = await this._request(store.add(card));
    card.id = id;
    return card;
  },

  async addCards(setId, cardsData) {
    if (this._ls) {
      const cards = [];
      for (const { front, back } of cardsData) {
        const card = { setId, front, back, level: 1, id: this._data.nci++ };
        this._data.cards.push(card);
        cards.push(card);
      }
      this._lsSave();
      return cards;
    }
    const store = this._tx('cards', 'readwrite');
    const cards = [];
    for (const { front, back } of cardsData) {
      const card = { setId, front, back, level: 1 };
      const req = store.add(card);
      await this._request(req);
      card.id = req.result;
      cards.push(card);
    }
    return cards;
  },

  async updateCard(id, updates) {
    if (this._ls) {
      const card = this._data.cards.find(c => c.id === id);
      if (!card) return null;
      Object.assign(card, updates);
      this._lsSave();
      return card;
    }
    const store = this._tx('cards');
    const card = await this._request(store.get(id));
    if (!card) return null;
    Object.assign(card, updates);
    await this._request(this._tx('cards', 'readwrite').put(card));
    return card;
  },

  async deleteCard(id) {
    if (this._ls) {
      this._data.cards = this._data.cards.filter(c => c.id !== id);
      this._lsSave();
      return;
    }
    return this._request(this._tx('cards', 'readwrite').delete(id));
  },

  async resetProgress(setId) {
    if (this._ls) {
      this._data.cards.forEach(c => { if (c.setId === setId) c.level = 1; });
      this._lsSave();
      return;
    }
    const cards = await this.getCardsBySet(setId);
    const store = this._tx('cards', 'readwrite');
    for (const card of cards) { card.level = 1; store.put(card); }
  },
};


// ═══════════════════════════════════════════
// CSV PARSER
// ═══════════════════════════════════════════
const CSV = {
  parse(text) {
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) return [];

    // Auto-detect delimiter
    const firstLine = lines[0];
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semiCount = (firstLine.match(/;/g) || []).length;
    const delimiter = tabCount > commaCount ? '\t' : (semiCount > commaCount ? ';' : ',');

    // Check if first line is a header
    const firstParsed = this._parseLine(lines[0], delimiter);
    const isHeader = firstParsed.length >= 2 &&
      firstParsed.every(cell => /^[a-zA-Z\s_-]+$/.test(cell.trim()));

    const startIndex = isHeader ? 1 : 0;
    const results = [];

    for (let i = startIndex; i < lines.length; i++) {
      const cells = this._parseLine(lines[i], delimiter);
      if (cells.length >= 2 && (cells[0].trim() || cells[1].trim())) {
        results.push({
          front: cells[0].trim(),
          back: cells[1].trim(),
        });
      }
    }

    return results;
  },

  _parseLine(line, delimiter) {
    const cells = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === delimiter) {
          cells.push(current);
          current = '';
        } else {
          current += char;
        }
      }
    }
    cells.push(current);
    return cells;
  },

  export(cards) {
    let csv = 'front,back\n';
    for (const card of cards) {
      const front = card.front.includes(',') ? `"${card.front.replace(/"/g, '""')}"` : card.front;
      const back = card.back.includes(',') ? `"${card.back.replace(/"/g, '""')}"` : card.back;
      csv += `${front},${back}\n`;
    }
    return csv;
  },
};


// ═══════════════════════════════════════════
// TEXT-TO-SPEECH (TTS) HELPER
// ═══════════════════════════════════════════
const TTS = {
  speak(text, lang) {
    if (!lang) return; // Do not speak if language is not set
    if (!('speechSynthesis' in window)) {
      console.warn('Text-to-speech not supported in this browser.');
      return;
    }

    // Cancel any ongoing speech to prevent overlap
    window.speechSynthesis.cancel();

    const cleanText = text.trim();
    if (!cleanText) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = lang;

    // Try to find a high-quality system voice matching the selected language
    if (window.speechSynthesis.getVoices) {
      const voices = window.speechSynthesis.getVoices();
      const voice = voices.find(v => v.lang === lang || v.lang.startsWith(lang));
      if (voice) {
        utterance.voice = voice;
      }
    }

    window.speechSynthesis.speak(utterance);
  }
};


// ═══════════════════════════════════════════
// ROUTER / VIEW MANAGEMENT
// ═══════════════════════════════════════════
const Router = {
  currentView: 'home',
  viewStack: [],

  navigate(viewName, pushStack = true) {
    const current = document.querySelector('.view.active');
    if (current) current.classList.remove('active');

    const next = document.getElementById(`view-${viewName}`);
    if (next) {
      next.classList.add('active');
      // Re-trigger animation
      next.style.animation = 'none';
      next.offsetHeight; // force reflow
      next.style.animation = '';
    }

    if (pushStack && this.currentView !== viewName) {
      this.viewStack.push(this.currentView);
    }

    this.currentView = viewName;
  },

  back() {
    const prev = this.viewStack.pop();
    if (prev) {
      this.navigate(prev, false);
    } else {
      this.navigate('home', false);
    }
  },
};


// ═══════════════════════════════════════════
// CRAM ENGINE
// ═══════════════════════════════════════════
const CramEngine = {
  allCards: [],
  currentLevelCards: [],
  currentIndex: 0,
  currentLevel: 1,
  results: { promoted: 0, demoted: 0, promotedToLevel: 0, demotedToLevel: 0 },
  setId: null,

  start(cards, setId) {
    this.allCards = cards;
    this.setId = setId;
    this.currentLevel = this._findLowestLevel();
    this._loadCurrentLevel();
  },

  _findLowestLevel() {
    let lowest = 5;
    for (const card of this.allCards) {
      if (card.level < lowest) lowest = card.level;
    }
    return lowest < 5 ? lowest : 1;
  },

  _loadCurrentLevel() {
    this.currentLevelCards = this.allCards.filter(c => c.level === this.currentLevel);
    // Shuffle
    for (let i = this.currentLevelCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.currentLevelCards[i], this.currentLevelCards[j]] = [this.currentLevelCards[j], this.currentLevelCards[i]];
    }
    this.currentIndex = 0;
    this.results = { promoted: 0, demoted: 0, promotedToLevel: 0, demotedToLevel: 0 };
  },

  getCurrentCard() {
    if (this.currentIndex >= this.currentLevelCards.length) return null;
    return this.currentLevelCards[this.currentIndex];
  },

  async markCorrect() {
    const card = this.getCurrentCard();
    if (!card) return;

    const newLevel = Math.min(card.level + 1, 5);
    card.level = newLevel;
    await DB.updateCard(card.id, { level: newLevel });

    this.results.promoted++;
    this.results.promotedToLevel = newLevel;
    this.currentIndex++;
  },

  async markWrong() {
    const card = this.getCurrentCard();
    if (!card) return;

    const newLevel = 1;
    card.level = newLevel;
    await DB.updateCard(card.id, { level: newLevel });

    this.results.demoted++;
    this.results.demotedToLevel = 1;
    this.currentIndex++;
  },

  isLevelComplete() {
    return this.currentIndex >= this.currentLevelCards.length;
  },

  getResults() {
    return {
      level: this.currentLevel,
      promoted: this.results.promoted,
      demoted: this.results.demoted,
      promotedToLevel: this.currentLevel + 1,
      demotedToLevel: 1,
      total: this.currentLevelCards.length,
    };
  },

  getLevelCounts() {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const card of this.allCards) {
      counts[card.level] = (counts[card.level] || 0) + 1;
    }
    return counts;
  },

  hasMoreLevels() {
    return this.allCards.some(c => c.level < 5 && c.level !== this.currentLevel);
  },

  nextLevel() {
    // Find next level with cards, or loop back
    for (let l = 1; l <= 4; l++) {
      if (this.allCards.some(c => c.level === l)) {
        this.currentLevel = l;
        this._loadCurrentLevel();
        return true;
      }
    }
    return false; // All memorized!
  },

  isAllMemorized() {
    return this.allCards.every(c => c.level === 5);
  },

  shuffleRemaining() {
    const reviewed = this.currentLevelCards.slice(0, this.currentIndex);
    const remaining = this.currentLevelCards.slice(this.currentIndex);
    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
    }
    this.currentLevelCards = [...reviewed, ...remaining];
  },
};


// ═══════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════
function showToast(message, type = '') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}


// ═══════════════════════════════════════════
// VIEW CONTROLLERS
// ═══════════════════════════════════════════

// ── Home View ──
const HomeView = {
  async render() {
    const sets = await DB.getAllSets();
    const setList = document.getElementById('set-list');
    const emptyState = document.getElementById('empty-state');
    const setCount = document.getElementById('set-count');

    // Sort by most recently created/studied
    sets.sort((a, b) => (b.lastStudied || b.createdAt) - (a.lastStudied || a.createdAt));

    setCount.textContent = sets.length;

    // Clear previous items (keep empty state)
    setList.querySelectorAll('.set-item').forEach(el => el.remove());

    if (sets.length === 0) {
      emptyState.style.display = 'flex';
      return;
    }

    emptyState.style.display = 'none';

    for (const set of sets) {
      const cards = await DB.getCardsBySet(set.id);
      const el = document.createElement('div');
      el.className = 'set-item';
      el.dataset.id = set.id;

      const memorized = cards.filter(c => c.level === 5).length;
      const lastStudied = set.lastStudied
        ? this._timeAgo(set.lastStudied)
        : 'Not studied yet';

      el.innerHTML = `
        <div class="set-item-info">
          <span class="set-item-name">${this._escapeHtml(set.name)}</span>
          <span class="set-item-meta">${cards.length} cards · ${memorized} memorized · ${lastStudied}</span>
        </div>
        <span class="set-item-chevron">›</span>
      `;

      el.addEventListener('click', () => SetView.open(set.id));
      setList.appendChild(el);
    }
  },

  filter(query) {
    const items = document.querySelectorAll('.set-item');
    const q = query.toLowerCase();
    items.forEach(item => {
      const name = item.querySelector('.set-item-name').textContent.toLowerCase();
      item.style.display = name.includes(q) ? '' : 'none';
    });
  },

  _timeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  },

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },
};


// ── Create/Edit View ──
const CreateView = {
  pendingCards: [],
  editingSetId: null,

  open(editSetId = null) {
    this.pendingCards = [];
    this.editingSetId = editSetId;

    const titleEl = document.getElementById('create-title');
    const nameInput = document.getElementById('set-name-input');
    const saveBtn = document.getElementById('btn-save-set');

    if (editSetId) {
      titleEl.textContent = 'Edit Card Set';
      saveBtn.textContent = 'Update Card Set';
      this._loadExistingSet(editSetId);
    } else {
      titleEl.textContent = 'New Card Set';
      saveBtn.textContent = 'Save Card Set';
      nameInput.value = '';
      document.getElementById('set-front-lang').value = '';
      document.getElementById('set-back-lang').value = '';
    }

    this._renderPreview();
    this._updateSaveButton();
    Router.navigate('create');
  },

  async _loadExistingSet(setId) {
    const set = await DB.getSet(setId);
    const cards = await DB.getCardsBySet(setId);

    document.getElementById('set-name-input').value = set.name;
    document.getElementById('set-front-lang').value = set.frontLang || '';
    document.getElementById('set-back-lang').value = set.backLang || '';
    this.pendingCards = cards.map(c => ({ front: c.front, back: c.back, existingId: c.id }));
    this._renderPreview();
    this._updateSaveButton();
  },

  addCard(front, back) {
    if (!front.trim() || !back.trim()) return;
    this.pendingCards.push({ front: front.trim(), back: back.trim() });
    this._renderPreview();
    this._updateSaveButton();
  },

  removeCard(index) {
    this.pendingCards.splice(index, 1);
    this._renderPreview();
    this._updateSaveButton();
  },

  importCSV(text) {
    const parsed = CSV.parse(text);
    if (parsed.length === 0) {
      showToast('No valid cards found in CSV', 'error');
      return;
    }
    this.pendingCards.push(...parsed);
    this._renderPreview();
    this._updateSaveButton();
    showToast(`Imported ${parsed.length} cards`, 'success');
  },

  _renderPreview() {
    const section = document.getElementById('preview-section');
    const list = document.getElementById('card-preview-list');
    const countEl = document.getElementById('card-count');

    countEl.textContent = this.pendingCards.length;

    if (this.pendingCards.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = '';
    list.innerHTML = '';

    this.pendingCards.forEach((card, i) => {
      const el = document.createElement('div');
      el.className = 'card-preview-item';
      el.innerHTML = `
        <span class="card-preview-front">${HomeView._escapeHtml(card.front)}</span>
        <span class="card-preview-divider">⟷</span>
        <span class="card-preview-back">${HomeView._escapeHtml(card.back)}</span>
        <button class="card-preview-delete" data-index="${i}" aria-label="Remove card">×</button>
      `;
      el.querySelector('.card-preview-delete').addEventListener('click', () => this.removeCard(i));
      list.appendChild(el);
    });
  },

  _updateSaveButton() {
    const name = document.getElementById('set-name-input').value.trim();
    const btn = document.getElementById('btn-save-set');
    btn.disabled = !name || this.pendingCards.length === 0;
  },

  async save() {
    const name = document.getElementById('set-name-input').value.trim();
    if (!name || this.pendingCards.length === 0) return;

    const frontLang = document.getElementById('set-front-lang').value;
    const backLang = document.getElementById('set-back-lang').value;

    const btn = document.getElementById('btn-save-set');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      if (this.editingSetId) {
        // Update existing set
        await DB.updateSet(this.editingSetId, { name, frontLang, backLang });

        // Delete old cards that aren't in the new list
        const existingCards = await DB.getCardsBySet(this.editingSetId);
        const keepIds = new Set(this.pendingCards.filter(c => c.existingId).map(c => c.existingId));
        for (const card of existingCards) {
          if (!keepIds.has(card.id)) {
            await DB.deleteCard(card.id);
          }
        }

        // Add new cards (ones without existingId)
        const newCards = this.pendingCards.filter(c => !c.existingId);
        if (newCards.length > 0) {
          await DB.addCards(this.editingSetId, newCards);
        }

        showToast('Card set updated!', 'success');
      } else {
        // Create new set
        const set = await DB.createSet(name, frontLang, backLang);
        await DB.addCards(set.id, this.pendingCards);
        showToast(`Created "${name}" with ${this.pendingCards.length} cards!`, 'success');
      }

      this.pendingCards = [];
      await HomeView.render();
      Router.navigate('home', false);
      Router.viewStack = [];
    } catch (err) {
      console.error('Save error:', err);
      showToast('Failed to save. Please try again.', 'error');
      btn.disabled = false;
      btn.textContent = this.editingSetId ? 'Update Card Set' : 'Save Card Set';
    }
  },
};


// ── Card Set View ──
const SetView = {
  currentSetId: null,
  currentSet: null,
  cards: [],

  async open(setId) {
    this.currentSetId = setId;
    this.currentSet = await DB.getSet(setId);
    this.cards = await DB.getCardsBySet(setId);

    document.getElementById('set-title').textContent = this.currentSet.name;
    document.getElementById('stat-total').textContent = this.cards.length;
    document.getElementById('stat-memorized').textContent = this.cards.filter(c => c.level === 5).length;

    // Reset mode selector
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector('[data-mode="cards"]').classList.add('active');

    this._renderCards();
    Router.navigate('set');
  },

  _renderCards() {
    const grid = document.getElementById('cards-grid');
    grid.innerHTML = '';

    if (this.cards.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🃏</div>
          <p class="empty-state-text">No cards in this set. Edit the set to add some!</p>
        </div>
      `;
      return;
    }

    this.cards.forEach(card => {
      const el = document.createElement('div');
      el.className = 'card-item';

      const levelColors = {
        1: '#ff6b6b',
        2: '#ffa502',
        3: '#ffd93d',
        4: '#6bcf7f',
        5: '#2ed573',
      };

      el.innerHTML = `
        <div class="card-item-front">${HomeView._escapeHtml(card.front)}</div>
        <div class="card-item-back">${HomeView._escapeHtml(card.back)}</div>
        <div style="margin-top:8px;display:flex;align-items:center;gap:6px;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${levelColors[card.level]};"></span>
          <span style="font-size:0.72rem;color:#999;">Level ${card.level === 5 ? '✓ Memorized' : card.level}</span>
        </div>
      `;
      grid.appendChild(el);
    });
  },

  async exportCSV() {
    const csvText = CSV.export(this.cards);
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.currentSet.name.replace(/[^a-zA-Z0-9\u0980-\u09FF]/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('CSV exported!', 'success');
  },

  async resetProgress() {
    await DB.resetProgress(this.currentSetId);
    this.cards = await DB.getCardsBySet(this.currentSetId);
    this._renderCards();
    document.getElementById('stat-memorized').textContent = '0';
    showToast('Progress reset', 'success');
  },
};


// ── Cram Mode View ──
const CramView = {
  isFlipped: false,
  reversed: false,
  autoplay: localStorage.getItem('cramAutoplay') === 'true',

  async start() {
    const cards = await DB.getCardsBySet(SetView.currentSetId);
    if (cards.length === 0) {
      showToast('No cards to study!', 'error');
      return;
    }

    // Update last studied
    await DB.updateSet(SetView.currentSetId, { lastStudied: Date.now() });

    CramEngine.start(cards, SetView.currentSetId);

    if (CramEngine.isAllMemorized()) {
      showToast('All cards memorized! 🎉 Reset progress to study again.', 'success');
      return;
    }

    // Reset reverse state button visual
    document.getElementById('btn-cram-reverse').classList.toggle('active', this.reversed);
    document.getElementById('btn-cram-autoplay').classList.toggle('active', this.autoplay);

    Router.navigate('cram');
    this._renderCard();
    this._updateLevelBar();
  },

  _renderCard() {
    const card = CramEngine.getCurrentCard();
    if (!card) {
      // Level complete — show results
      this._showResults();
      return;
    }

    this.isFlipped = false;
    const flipCard = document.getElementById('cram-card');
    flipCard.classList.remove('flipped');

    const frontText = this.reversed ? card.back : card.front;
    const backText = this.reversed ? card.front : card.back;
    document.getElementById('cram-front').querySelector('span').textContent = frontText;
    document.getElementById('cram-back').querySelector('span').textContent = backText;

    // Show/hide audio play buttons depending on set language configuration
    const frontActiveLang = this.reversed ? SetView.currentSet.backLang : SetView.currentSet.frontLang;
    const backActiveLang = this.reversed ? SetView.currentSet.frontLang : SetView.currentSet.backLang;

    document.getElementById('btn-cram-front-audio').style.display = frontActiveLang ? 'flex' : 'none';
    document.getElementById('btn-cram-back-audio').style.display = backActiveLang ? 'flex' : 'none';

    const counter = document.getElementById('cram-counter');
    counter.innerHTML = `Card <strong>${CramEngine.currentIndex + 1}</strong> of <strong>${CramEngine.currentLevelCards.length}</strong> · Level ${CramEngine.currentLevel}`;

    document.getElementById('answer-buttons').style.visibility = 'hidden';
    document.getElementById('flip-hint').style.display = '';

    // Auto-play front audio if enabled
    if (this.autoplay && frontActiveLang) {
      setTimeout(() => {
        if (CramEngine.getCurrentCard() === card && !this.isFlipped) {
          TTS.speak(frontText, frontActiveLang);
        }
      }, 350);
    }
  },

  flipCard() {
    this.isFlipped = !this.isFlipped;
    const flipCard = document.getElementById('cram-card');
    flipCard.classList.toggle('flipped', this.isFlipped);

    if (this.isFlipped) {
      document.getElementById('answer-buttons').style.visibility = 'visible';
      document.getElementById('flip-hint').style.display = 'none';

      // Auto-play back audio if enabled
      const card = CramEngine.getCurrentCard();
      const backActiveLang = this.reversed ? SetView.currentSet.frontLang : SetView.currentSet.backLang;
      const backText = this.reversed ? card.front : card.back;
      if (this.autoplay && backActiveLang) {
        TTS.speak(backText, backActiveLang);
      }
    } else {
      document.getElementById('answer-buttons').style.visibility = 'hidden';
      document.getElementById('flip-hint').style.display = '';
    }
  },

  toggleAutoplay() {
    this.autoplay = !this.autoplay;
    localStorage.setItem('cramAutoplay', this.autoplay);
    document.getElementById('btn-cram-autoplay').classList.toggle('active', this.autoplay);
    const memoAutoplayBtn = document.getElementById('btn-memorize-autoplay');
    if (memoAutoplayBtn) memoAutoplayBtn.classList.toggle('active', this.autoplay);
    MemorizeView.autoplay = this.autoplay;
  },

  async markCorrect() {
    await CramEngine.markCorrect();
    this._updateLevelBar();
    this._animateCard('right');
  },

  async markWrong() {
    await CramEngine.markWrong();
    this._updateLevelBar();
    this._animateCard('left');
  },

  shuffle() {
    CramEngine.shuffleRemaining();
    this._renderCard();
    showToast('Cards shuffled!', 'success');
  },

  toggleReverse() {
    this.reversed = !this.reversed;
    document.getElementById('btn-cram-reverse').classList.toggle('active', this.reversed);
    // Re-render current card with swapped front/back
    const card = CramEngine.getCurrentCard();
    if (card) {
      const flipCard = document.getElementById('cram-card');
      // If card is flipped, unflip it first
      if (this.isFlipped) {
        const inner = flipCard.querySelector('.flip-card-inner');
        inner.style.transition = 'none';
        flipCard.classList.remove('flipped');
        this.isFlipped = false;
        document.getElementById('answer-buttons').style.visibility = 'hidden';
        document.getElementById('flip-hint').style.display = '';
        requestAnimationFrame(() => {
          requestAnimationFrame(() => { inner.style.transition = ''; });
        });
      }
      this._renderCard();
    }
    showToast(this.reversed ? 'Reversed: showing back first' : 'Normal: showing front first', 'success');
  },

  _animateCard(direction) {
    const flipCard = document.getElementById('cram-card');
    flipCard.classList.add(direction === 'left' ? 'card-swipe-left' : 'card-swipe-right');

    setTimeout(() => {
      // Disable flip transition to prevent back-face flash
      const inner = flipCard.querySelector('.flip-card-inner');
      inner.style.transition = 'none';

      flipCard.classList.remove('card-swipe-left', 'card-swipe-right', 'flipped');
      this.isFlipped = false;

      if (CramEngine.isLevelComplete()) {
        this._showResults();
      } else {
        this._renderCard();
      }

      // Re-enable flip transition after layout settles
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          inner.style.transition = '';
        });
      });
    }, 300);
  },

  _updateLevelBar() {
    const counts = CramEngine.getLevelCounts();
    for (let l = 1; l <= 5; l++) {
      document.getElementById(`level-${l}-count`).textContent = counts[l];
      const segment = document.querySelector(`[data-level="${l}"]`);
      const bar = segment.querySelector('.level-segment-bar');

      segment.classList.toggle('active', l === CramEngine.currentLevel);
      bar.classList.toggle('active', counts[l] > 0);
    }
  },

  _showResults() {
    const results = CramEngine.getResults();
    const statsEl = document.getElementById('results-stats');
    const titleEl = document.getElementById('results-level-title');

    titleEl.textContent = `Level ${results.level} Results`;

    let html = '';
    if (results.promoted > 0) {
      html += `
        <div class="result-arrow promoted">
          <span class="result-arrow-num">${results.promoted}</span>
          <span class="result-arrow-text">CARDS PROMOTED TO LEVEL ${results.promotedToLevel}</span>
          <span class="result-arrow-icon">→</span>
        </div>
      `;
    }
    if (results.demoted > 0) {
      html += `
        <div class="result-arrow demoted">
          <span class="result-arrow-num">${results.demoted}</span>
          <span class="result-arrow-text">CARDS MOVED BACK TO LEVEL ${results.demotedToLevel}</span>
          <span class="result-arrow-icon">←</span>
        </div>
      `;
    }
    if (results.promoted === 0 && results.demoted === 0) {
      html = '<p style="color: var(--text-muted); text-align: center;">No cards were reviewed.</p>';
    }

    statsEl.innerHTML = html;

    // Update continue button text
    if (CramEngine.isAllMemorized()) {
      document.getElementById('continue-text').textContent = '🎉 All Memorized! Go Back';
    } else {
      const nextLevel = CramEngine._findLowestLevel();
      document.getElementById('continue-text').textContent = `Continue to Level ${nextLevel}`;
    }

    Router.navigate('results');
  },

  continueStudy() {
    if (CramEngine.isAllMemorized()) {
      Router.navigate('home', false);
      Router.viewStack = [];
      HomeView.render();
      showToast('Congratulations! All cards memorized! 🎉', 'success');
      return;
    }

    CramEngine.nextLevel();
    Router.navigate('cram', false);
    this._renderCard();
    this._updateLevelBar();
  },
};


// ── Memorize Mode View ──
const MemorizeView = {
  cards: [],
  currentIndex: 0,
  isFlipped: false,
  autoplay: localStorage.getItem('cramAutoplay') === 'true',

  async start() {
    this.cards = await DB.getCardsBySet(SetView.currentSetId);
    if (this.cards.length === 0) {
      showToast('No cards to study!', 'error');
      return;
    }

    this.currentIndex = 0;
    this.isFlipped = false;

    await DB.updateSet(SetView.currentSetId, { lastStudied: Date.now() });

    // Set autoplay toggle state
    document.getElementById('btn-memorize-autoplay').classList.toggle('active', this.autoplay);

    Router.navigate('memorize');
    this._renderCard();
  },

  _renderCard() {
    const card = this.cards[this.currentIndex];
    if (!card) return;

    this.isFlipped = false;
    document.getElementById('memorize-card').classList.remove('flipped');
    document.getElementById('memorize-front').querySelector('span').textContent = card.front;
    document.getElementById('memorize-back').querySelector('span').textContent = card.back;

    // Show/hide audio play buttons depending on set language configuration
    const frontLang = SetView.currentSet.frontLang;
    const backLang = SetView.currentSet.backLang;

    document.getElementById('btn-memorize-front-audio').style.display = frontLang ? 'flex' : 'none';
    document.getElementById('btn-memorize-back-audio').style.display = backLang ? 'flex' : 'none';

    document.getElementById('memorize-counter').innerHTML =
      `Card <strong>${this.currentIndex + 1}</strong> of <strong>${this.cards.length}</strong>`;
    document.getElementById('memorize-position').textContent =
      `${this.currentIndex + 1} / ${this.cards.length}`;

    document.getElementById('btn-prev').disabled = this.currentIndex === 0;
    document.getElementById('btn-next').disabled = this.currentIndex === this.cards.length - 1;

    // Auto-play front audio if enabled
    if (this.autoplay && frontLang) {
      setTimeout(() => {
        if (this.cards[this.currentIndex] === card && !this.isFlipped) {
          TTS.speak(card.front, frontLang);
        }
      }, 350);
    }
  },

  flipCard() {
    this.isFlipped = !this.isFlipped;
    document.getElementById('memorize-card').classList.toggle('flipped', this.isFlipped);

    if (this.isFlipped) {
      // Auto-play back audio if enabled
      const card = this.cards[this.currentIndex];
      const backLang = SetView.currentSet.backLang;
      if (this.autoplay && backLang && card) {
        TTS.speak(card.back, backLang);
      }
    }
  },

  toggleAutoplay() {
    this.autoplay = !this.autoplay;
    localStorage.setItem('cramAutoplay', this.autoplay);
    document.getElementById('btn-memorize-autoplay').classList.toggle('active', this.autoplay);
    const cramAutoplayBtn = document.getElementById('btn-cram-autoplay');
    if (cramAutoplayBtn) cramAutoplayBtn.classList.toggle('active', this.autoplay);
    CramView.autoplay = this.autoplay;
  },

  next() {
    if (this.currentIndex < this.cards.length - 1) {
      this.currentIndex++;
      this._renderCard();
    }
  },

  prev() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this._renderCard();
    }
  },

  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
    this.currentIndex = 0;
    this._renderCard();
    showToast('Cards shuffled!', 'success');
  },
};


// ═══════════════════════════════════════════
// CONFIRM DIALOG
// ═══════════════════════════════════════════
const ConfirmDialog = {
  _resolve: null,

  show(title, message) {
    return new Promise((resolve) => {
      this._resolve = resolve;
      document.getElementById('confirm-title').textContent = title;
      document.getElementById('confirm-message').textContent = message;
      document.getElementById('modal-confirm').classList.add('open');
    });
  },

  _handleOk() {
    document.getElementById('modal-confirm').classList.remove('open');
    if (this._resolve) this._resolve(true);
  },

  _handleCancel() {
    document.getElementById('modal-confirm').classList.remove('open');
    if (this._resolve) this._resolve(false);
  },
};


// ═══════════════════════════════════════════
// EVENT BINDINGS
// ═══════════════════════════════════════════
function bindEvents() {
  // ── Home ──
  document.getElementById('create-banner').addEventListener('click', () => CreateView.open());
  document.getElementById('btn-search').addEventListener('click', () => {
    const bar = document.getElementById('search-bar');
    bar.classList.toggle('open');
    if (bar.classList.contains('open')) {
      document.getElementById('search-input').focus();
    }
  });
  document.getElementById('search-input').addEventListener('input', (e) => {
    HomeView.filter(e.target.value);
  });

  // ── Create/Edit ──
  document.getElementById('btn-back-create').addEventListener('click', () => Router.back());
  document.getElementById('set-name-input').addEventListener('input', () => CreateView._updateSaveButton());

  document.getElementById('btn-add-card').addEventListener('click', () => {
    const front = document.getElementById('card-front-input');
    const back = document.getElementById('card-back-input');
    CreateView.addCard(front.value, back.value);
    front.value = '';
    back.value = '';
    front.focus();
  });

  // Enter key to add card
  ['card-front-input', 'card-back-input'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const front = document.getElementById('card-front-input');
        const back = document.getElementById('card-back-input');
        if (front.value && back.value) {
          CreateView.addCard(front.value, back.value);
          front.value = '';
          back.value = '';
          front.focus();
        } else if (id === 'card-front-input') {
          document.getElementById('card-back-input').focus();
        }
      }
    });
  });

  // CSV upload
  const csvUpload = document.getElementById('csv-upload');
  const csvInput = document.getElementById('csv-file-input');

  csvInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      CreateView.importCSV(ev.target.result);
      // Auto-fill set name from filename if empty
      const nameInput = document.getElementById('set-name-input');
      if (!nameInput.value.trim()) {
        nameInput.value = file.name.replace(/\.(csv|tsv|txt)$/i, '');
        CreateView._updateSaveButton();
      }
    };
    reader.readAsText(file, 'UTF-8');
    csvInput.value = ''; // Reset for re-upload
  });

  csvUpload.addEventListener('dragover', (e) => {
    e.preventDefault();
    csvUpload.classList.add('dragover');
  });
  csvUpload.addEventListener('dragleave', () => csvUpload.classList.remove('dragover'));
  csvUpload.addEventListener('drop', (e) => {
    e.preventDefault();
    csvUpload.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => CreateView.importCSV(ev.target.result);
      reader.readAsText(file, 'UTF-8');
    }
  });

  document.getElementById('btn-save-set').addEventListener('click', () => CreateView.save());

  // ── Card Set View ──
  document.getElementById('btn-back-set').addEventListener('click', () => {
    Router.navigate('home', false);
    Router.viewStack = [];
    HomeView.render();
  });

  document.getElementById('btn-edit-set').addEventListener('click', () => {
    CreateView.open(SetView.currentSetId);
  });

  document.getElementById('btn-delete-set').addEventListener('click', async () => {
    const ok = await ConfirmDialog.show(
      'Delete this set?',
      `"${SetView.currentSet.name}" and all its cards will be permanently deleted.`
    );
    if (ok) {
      await DB.deleteSet(SetView.currentSetId);
      showToast('Set deleted', 'success');
      Router.navigate('home', false);
      Router.viewStack = [];
      HomeView.render();
    }
  });

  document.getElementById('btn-export-csv').addEventListener('click', () => SetView.exportCSV());
  document.getElementById('btn-reset-progress').addEventListener('click', async () => {
    const ok = await ConfirmDialog.show(
      'Reset progress?',
      'All cards will be moved back to Level 1.'
    );
    if (ok) SetView.resetProgress();
  });

  // Mode selector
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const mode = btn.dataset.mode;
      if (mode === 'cram') CramView.start();
      else if (mode === 'memorize') MemorizeView.start();
    });
  });

  // ── Cram Mode ──
  document.getElementById('btn-back-cram').addEventListener('click', () => {
    Router.navigate('set', false);
    SetView.open(SetView.currentSetId);
  });

  document.getElementById('cram-card').addEventListener('click', () => CramView.flipCard());
  document.getElementById('btn-wrong').addEventListener('click', () => CramView.markWrong());
  document.getElementById('btn-correct').addEventListener('click', () => CramView.markCorrect());
  document.getElementById('btn-cram-shuffle').addEventListener('click', () => CramView.shuffle());
  document.getElementById('btn-cram-reverse').addEventListener('click', () => CramView.toggleReverse());
  document.getElementById('btn-cram-autoplay').addEventListener('click', () => CramView.toggleAutoplay());

  document.getElementById('btn-cram-front-audio').addEventListener('click', (e) => {
    e.stopPropagation();
    const card = CramEngine.getCurrentCard();
    if (!card) return;
    const text = CramView.reversed ? card.back : card.front;
    const lang = CramView.reversed ? SetView.currentSet.backLang : SetView.currentSet.frontLang;
    TTS.speak(text, lang);
  });

  document.getElementById('btn-cram-back-audio').addEventListener('click', (e) => {
    e.stopPropagation();
    const card = CramEngine.getCurrentCard();
    if (!card) return;
    const text = CramView.reversed ? card.front : card.back;
    const lang = CramView.reversed ? SetView.currentSet.frontLang : SetView.currentSet.backLang;
    TTS.speak(text, lang);
  });

  // Keyboard shortcuts for cram mode
  document.addEventListener('keydown', (e) => {
    if (Router.currentView === 'cram') {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        CramView.flipCard();
      } else if (e.key === 'ArrowLeft' || e.key === 'x' || e.key === 'X') {
        if (CramView.isFlipped) CramView.markWrong();
      } else if (e.key === 'ArrowRight' || e.key === 'c' || e.key === 'C') {
        if (CramView.isFlipped) CramView.markCorrect();
      }
    } else if (Router.currentView === 'memorize') {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        MemorizeView.flipCard();
      } else if (e.key === 'ArrowLeft') {
        MemorizeView.prev();
      } else if (e.key === 'ArrowRight') {
        MemorizeView.next();
      }
    }
  });

  // ── Memorize Mode ──
  document.getElementById('btn-back-memorize').addEventListener('click', () => {
    Router.navigate('set', false);
    SetView.open(SetView.currentSetId);
  });
  document.getElementById('memorize-card').addEventListener('click', () => MemorizeView.flipCard());
  document.getElementById('btn-prev').addEventListener('click', () => MemorizeView.prev());
  document.getElementById('btn-next').addEventListener('click', () => MemorizeView.next());
  document.getElementById('btn-shuffle').addEventListener('click', () => MemorizeView.shuffle());
  document.getElementById('btn-memorize-autoplay').addEventListener('click', () => MemorizeView.toggleAutoplay());

  document.getElementById('btn-memorize-front-audio').addEventListener('click', (e) => {
    e.stopPropagation();
    const card = MemorizeView.cards[MemorizeView.currentIndex];
    if (!card) return;
    TTS.speak(card.front, SetView.currentSet.frontLang);
  });

  document.getElementById('btn-memorize-back-audio').addEventListener('click', (e) => {
    e.stopPropagation();
    const card = MemorizeView.cards[MemorizeView.currentIndex];
    if (!card) return;
    TTS.speak(card.back, SetView.currentSet.backLang);
  });

  // ── Results ──
  document.getElementById('btn-back-results').addEventListener('click', () => {
    Router.navigate('set', false);
    SetView.open(SetView.currentSetId);
  });
  document.getElementById('btn-continue-cram').addEventListener('click', () => CramView.continueStudy());

  // ── Confirm Dialog ──
  document.getElementById('btn-confirm-ok').addEventListener('click', () => ConfirmDialog._handleOk());
  document.getElementById('btn-confirm-cancel').addEventListener('click', () => ConfirmDialog._handleCancel());
  document.getElementById('modal-confirm').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) ConfirmDialog._handleCancel();
  });

  // ── Touch swipe for cram mode ──
  let touchStartX = 0;
  let touchStartY = 0;

  document.getElementById('cram-card').addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  }, { passive: true });

  document.getElementById('cram-card').addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].screenX - touchStartX;
    const dy = e.changedTouches[0].screenY - touchStartY;

    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) && CramView.isFlipped) {
      if (dx > 0) {
        CramView.markCorrect();
      } else {
        CramView.markWrong();
      }
    }
  }, { passive: true });
}


// ═══════════════════════════════════════════
// APP INITIALIZATION
// ═══════════════════════════════════════════
async function init() {
  try {
    await DB.init();
    bindEvents();
    await HomeView.render();

    // Register Service Worker (only works over HTTP, not file://)
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js').then(() => {
        console.log('Service Worker registered');
      }).catch(err => {
        console.warn('SW registration failed:', err);
      });
    }

    console.log('Cram app initialized');
  } catch (err) {
    console.error('Init error:', err);
    showToast('Failed to initialize app', 'error');
  }
}

document.addEventListener('DOMContentLoaded', init);
