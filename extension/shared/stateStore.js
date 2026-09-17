// Persistent state store backed by chrome.storage.local.
// Categories/templates, sent-log, dedupe records, pending review queue.

const STORE_KEY = 'waState';

const DEFAULT_STATE = {
  categories: {},          // { [category]: { template, createdAt, updatedAt, approvedBy } }
  sentLog: [],             // { id, chatId, contactName, phone, category, text, ts }
  dedupe: [],              // { key, type, chatId, ts }
  pending: [],             // { id, message, classification, ts, status }
  meetLinks: [],           // { id, url, type, chatId, contactName, ts }
  settings: {},
};

export class StateStore {
  constructor() {
    this.cache = null;
  }

  async _load() {
    if (this.cache) return this.cache;
    const result = await chrome.storage.local.get(STORE_KEY);
    this.cache = { ...DEFAULT_STATE, ...(result[STORE_KEY] || {}) };
    // cap arrays
    const cap = (arr, n = 500) => (arr.length > n ? arr.slice(-n) : arr);
    this.cache.sentLog = cap(this.cache.sentLog);
    this.cache.dedupe = cap(this.cache.dedupe);
    this.cache.pending = cap(this.cache.pending);
    this.cache.meetLinks = cap(this.cache.meetLinks);
    return this.cache;
  }

  async _save() {
    if (!this.cache) return;
    await chrome.storage.local.set({ [STORE_KEY]: this.cache });
  }

  async getCategories() {
    const s = await this._load();
    return s.categories;
  }

  async getCategory(category) {
    const s = await this._load();
    return s.categories[category] || null;
  }

  async setCategory(category, template) {
    const s = await this._load();
    s.categories[category] = {
      template,
      createdAt: s.categories[category]?.createdAt || Date.now(),
      updatedAt: Date.now(),
      approvedBy: 'human',
    };
    await this._save();
    return s.categories[category];
  }

  async deleteCategory(category) {
    const s = await this._load();
    delete s.categories[category];
    await this._save();
  }

  async addPending(message, classification) {
    const s = await this._load();
    if (s.pending.length >= 50) return null;
    const item = {
      id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      message,
      classification,
      ts: Date.now(),
      status: 'pending',
    };
    s.pending.push(item);
    await this._save();
    return item;
  }

  async getPending() {
    const s = await this._load();
    return s.pending.filter(p => p.status === 'pending');
  }

  async resolvePending(id, action, editedReply) {
    const s = await this._load();
    const item = s.pending.find(p => p.id === id);
    if (!item) return null;
    item.status = action;
    item.resolvedAt = Date.now();
    if (action === 'approve') {
      if (editedReply !== undefined && editedReply !== null && editedReply !== '') {
        await this.setCategory(item.classification.category, editedReply);
      } else if (item.classification.suggestedReply) {
        await this.setCategory(item.classification.category, item.classification.suggestedReply);
      }
    }
    await this._save();
    return item;
  }

  async isDuplicate(category, chatId, text) {
    const s = await this._load();
    const now = Date.now();
    const windowMs = (s.settings && s.settings.dedupeWindowMs) || 24 * 60 * 60 * 1000;

    // 1) exact text to same contact
    const exact = s.sentLog.find(
      l => l.chatId === chatId && (l.text || '').trim() === (text || '').trim()
    );
    if (exact) return { dup: true, reason: 'exact_text' };

    // 2) same category-template to same contact within rolling window
    const catDup = s.sentLog.find(
      l =>
        l.chatId === chatId &&
        l.category === category &&
        now - l.ts < windowMs
    );
    if (catDup) return { dup: true, reason: 'category_window' };

    return { dup: false };
  }

  async recordSend(chatId, contactName, phone, category, text) {
    const s = await this._load();
    const item = {
      id: 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      chatId,
      contactName: contactName || 'Unknown',
      phone: phone || 'Unknown',
      category,
      text,
      ts: Date.now(),
    };
    s.sentLog.push(item);
    await this._save();
    return item;
  }

  async addMeetLinks(links, chatId, contactName) {
    if (!links || !links.length) return [];
    const s = await this._load();
    const added = links.map(url => ({
      id: 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      url,
      type: _detectType(url),
      chatId,
      contactName: contactName || 'Unknown',
      ts: Date.now(),
    }));
    s.meetLinks.push(...added);
    await this._save();
    return added;
  }

  async getMeetLinks() {
    const s = await this._load();
    return s.meetLinks;
  }

  async getSettings() {
    const s = await this._load();
    return s.settings || {};
  }

  async setSettings(patch) {
    const s = await this._load();
    s.settings = { ...(s.settings || {}), ...patch };
    await this._save();
    return s.settings;
  }
}

function _detectType(url) {
  if (url.includes('zoom.us')) return 'zoom';
  if (url.includes('meet.google.com')) return 'google-meet';
  if (url.includes('teams.microsoft.com')) return 'teams';
  if (url.includes('webex.com')) return 'webex';
  return 'other';
}