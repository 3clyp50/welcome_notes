import { createStore, getStore } from '/js/AlpineStore.js';
import { fetchApi } from '/js/api.js';
import { getModalStack } from '/js/modals.js';
import { toastFrontendError, toastFrontendWarning } from '/components/notifications/notification-store.js';
import { DEFAULT_SHORTCUT, snapshot, title, parseShortcut, matchesShortcut, shortcutFromEvent, shortcutLabel, fitRect, gestureRect, THEMES, PASTELS, appearance, themeStyle, newNoteColor } from '/plugins/welcome_notes/webui/notes-ui.js';

const ID = 'welcome_notes.list', DRAFTS = 'welcomeNotes.drafts';
const cache = new Map(), work = new Map();
let owner, listeners, loadToken = 0;

async function request(data, keepalive = false) {
  const response = await fetchApi('/api/plugins/welcome_notes/notes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), keepalive,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || 'Could not save notes.'), { status: response.status, note: result.note });
  return result;
}

function sameContent(a, b) {
  return b && Object.keys(snapshot(a)).every(key => key === 'revision' || a[key] === b[key]);
}

function isDraft(note) {
  return note && typeof note.id === 'string' && /^[a-f0-9-]{36}$/.test(note.id)
    && typeof note.scope === 'string' && /^(shared|welcome|chat:[\w-]{1,128})$/.test(note.scope)
    && typeof note.text === 'string' && note.text.length <= 10000 && typeof note.open === 'boolean'
    && Number.isInteger(note.revision) && note.revision >= 0
    && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(note[key]) && note[key] >= 0);
}

export const store = createStore('welcomeNotes', {
  notes: [], context: '', scope: 'shared', mode: 'shared', shortcut: DEFAULT_SHORTCUT,
  loading: true, ready: false, editingId: '', activeId: '', peekId: '', gesture: null, suppressClick: '',
  viewport: { width: 1024, height: 768, left: 0, top: 0 }, wide: false,
  title, shortcutLabel, themes: THEMES, pastels: PASTELS, appearance: appearance(), normalizeAppearance: appearance, themeStyle,
  get hidden() { return getStore('welcomeStore')?.hiddenSections?.includes(ID) || false; },
  get list() { return [...this.notes].sort((a, b) => (b.updated || 0) - (a.updated || 0)); },
  get visible() {
    return this.notes.filter(note => note.open && (note.scope === this.scope || note.id === this.peekId))
      .sort((a, b) => (a.updated || 0) - (b.updated || 0));
  },
  get shortcutKeys() { return shortcutLabel(this.shortcut); },
  scopeLabel(note) {
    if (this.mode !== 'chat') return '';
    if (note.scope === 'welcome') return 'Welcome';
    const context = getStore('chats')?.contexts?.find(context => `chat:${context.id}` === note.scope);
    return context ? getStore('chats').displayName(context) : 'Chat';
  },
  belongs(note) { return note.scope === this.scope || (!this.context && this.mode === 'chat' && note.scope !== 'shared'); },

  mount(element) {
    if (owner === element) return;
    if (owner) this.cleanup(owner);
    owner = element;
    listeners = new AbortController();
    const options = { signal: listeners.signal };
    this.context = getStore('chats')?.selected || '';
    this.updateViewport();
    this.restoreDrafts();
    window.addEventListener('resize', () => { this.cancelGesture(); this.updateViewport(); }, options);
    window.visualViewport?.addEventListener('resize', () => this.updateViewport(), options);
    window.visualViewport?.addEventListener('scroll', () => this.updateViewport(), options);
    window.addEventListener('blur', () => { this.cancelGesture(); this.flushAll(); }, options);
    window.addEventListener('focus', () => { this.flushAll(); this.reload(); }, options);
    window.addEventListener('online', () => { this.flushAll(); this.reload(); }, options);
    window.addEventListener('beforeunload', event => {
      if ([...work.values()].some(state => state.dirty || state.saving)) { event.preventDefault(); event.returnValue = ''; }
    }, options);
    window.addEventListener('pagehide', () => this.flushAll(true), options);
    document.addEventListener('keydown', event => this.keydown(event), { ...options, capture: true });
    void this.reload();
  },
  cleanup(element) {
    if (element !== owner) return;
    this.cancelGesture(); this.finishEdit(); this.flushAll(true);
    listeners?.abort(); listeners = null; owner = null; loadToken++;
    this.ready = false;
  },
  setContext(context) {
    if (context === this.context) return;
    this.cancelGesture(); this.finishEdit(); this.flushAll();
    this.context = context; this.peekId = ''; this.activeId = '';
    if (this.mode !== 'shared') { this.ready = false; this.notes = []; }
    void this.reload();
  },
  async reload() {
    if (!owner) return;
    const token = ++loadToken;
    const known = new Set(work.keys());
    const pending = new Set([...work.values()].filter(state => state.dirty || state.saving));
    this.loading = true;
    try {
      const result = await request({ action: 'list', context: this.context });
      if (token !== loadToken || !owner) return;
      this.scope = result.scope; this.mode = result.mode;
      this.appearance = appearance(result.appearance);
      this.shortcut = parseShortcut(result.shortcut) ? result.shortcut : DEFAULT_SHORTCUT;
      const rows = new Map((result.notes || []).map(note => [note.id, note]));
      for (const state of work.values()) if (state.dirty || state.saving || pending.has(state) || !known.has(state.note.id)) rows.set(state.note.id, state.note);
      this.notes = [...rows.values()].filter(note => this.belongs(note)).map(note => {
        const prior = cache.get(note.id), state = work.get(note.id);
        if (!prior) return note;
        if (!state?.dirty && !state?.saving && note.revision >= prior.revision) Object.assign(prior, note);
        return prior;
      });
      for (const note of this.notes) {
        cache.set(note.id, note);
        const state = work.get(note.id);
        if (state) state.note = note;
      }
      this.ready = true;
      this.flushAll();
    } catch (error) { if (token === loadToken) toastFrontendError(error.message, 'Notes'); }
    finally { if (token === loadToken) this.loading = false; }
  },
  welcomeMount() {
    try {
      this.wide = localStorage.getItem('welcomeNotes.wide') === 'true';
      if (localStorage.getItem(`welcome_hidden_${ID}`) === 'true') getStore('welcomeStore')?.dismissSection(ID);
    } catch { /* Preferences can be unavailable in private browsing. */ }
  },
  dismiss() { getStore('welcomeStore')?.dismissSection(ID); },
  toggleWidth() {
    this.wide = !this.wide;
    try { localStorage.setItem('welcomeNotes.wide', String(this.wide)); } catch { /* Width is still usable for this visit. */ }
  },
  async settings() {
    const { store: settings } = await import('/components/plugins/plugin-settings-store.js');
    return settings.openConfig('welcome_notes');
  },
  recordShortcut(event, config) {
    if (event.key === 'Tab') return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { event.target.blur(); return; }
    const shortcut = shortcutFromEvent(event);
    if (shortcut) config.shortcut = shortcut;
    return Boolean(shortcut);
  },
  keydown(event) {
    if (event.key === 'Escape' && this.gesture) { event.preventDefault(); event.stopPropagation(); this.cancelGesture(); return; }
    if (event.target.closest?.('[data-note-shortcut]') || getModalStack().length) return;
    if (matchesShortcut(event, this.shortcut) && this.ready) {
      event.preventDefault(); event.stopPropagation(); this.create();
    }
  },

  create() {
    if (!this.ready) return;
    this.finishEdit();
    const offset = (this.visible.length % 6) * 24;
    const rect = fitRect({ x: this.viewport.width - 320 - offset, y: 100 + offset, width: 272, height: 260 }, this.viewport);
    const note = { id: crypto.randomUUID(), scope: this.scope, revision: 0, text: '', color: newNoteColor(this.appearance), open: true, updated: Date.now() / 1000, ...rect, width: 272, height: 260 };
    this.notes.push(note);
    const reactive = this.notes.find(item => item.id === note.id);
    cache.set(note.id, reactive);
    this.changed(reactive); this.edit(reactive);
  },
  open(note) {
    this.finishEdit();
    if (note.scope !== this.scope) this.peekId = note.id;
    this.activeId = note.id;
    if (!note.open) { note.open = true; this.changed(note); }
    requestAnimationFrame(() => document.querySelector(`[data-note-id="${note.id}"]`)?.focus({ preventScroll: true }));
  },
  hide(note) {
    if (this.editingId === note.id) this.finishEdit();
    note.open = false; this.changed(note);
    if (this.peekId === note.id) this.peekId = '';
  },
  click(note, event) {
    if (this.suppressClick === note.id) { this.suppressClick = ''; return; }
    if (event.target.closest('button,textarea')) return;
    this.edit(note);
  },
  edit(note) {
    if (note.deleting) return;
    this.activeId = note.id; this.editingId = note.id;
    requestAnimationFrame(() => {
      const input = document.querySelector(`[data-note-id="${note.id}"] textarea`);
      input?.focus({ preventScroll: true });
      input?.setSelectionRange(input.value.length, input.value.length);
    });
  },
  finishEdit(id = this.editingId) {
    if (!id || this.editingId !== id) return;
    this.editingId = '';
    const note = cache.get(id);
    if (note) void this.flush(note);
  },
  changed(note) {
    let state = work.get(note.id);
    if (!state) { state = { note, dirty: false, saving: null, failed: false, timer: null }; work.set(note.id, state); }
    state.note = note; state.dirty = true; state.failed = false; note.saveFailed = false;
    clearTimeout(state.timer);
    this.writeDrafts();
    state.timer = setTimeout(() => this.flush(note), 400);
  },
  writeDrafts() {
    try {
      const drafts = [...work.values()].filter(state => state.dirty || state.saving).map(state => snapshot(state.note));
      if (drafts.length) sessionStorage.setItem(DRAFTS, JSON.stringify(drafts));
      else sessionStorage.removeItem(DRAFTS);
    } catch { /* The beforeunload guard still protects unsaved in-memory edits. */ }
  },
  restoreDrafts() {
    try {
      const drafts = JSON.parse(sessionStorage.getItem(DRAFTS) || '[]');
      if (!Array.isArray(drafts)) return;
      for (const draft of drafts) if (isDraft(draft) && !work.has(draft.id)) {
        const note = { ...snapshot(draft), updated: Date.now() / 1000 };
        cache.set(note.id, note); work.set(note.id, { note, dirty: true, saving: null, failed: false, timer: null });
      }
    } catch (error) { toastFrontendError('Could not restore unsaved notes.', 'Notes'); }
  },
  async flush(note, keepalive = false) {
    const state = work.get(note.id);
    if (!state) return true;
    if (this.gesture?.note.id === note.id) return false;
    clearTimeout(state.timer);
    if (state.saving) {
      try { await state.saving; } catch { /* The owning save reports the failure and retains the draft. */ }
      return state.dirty && !state.failed ? this.flush(note, keepalive) : !state.failed;
    }
    if (!state.dirty) return !state.failed;
    const payload = snapshot(note);
    state.dirty = false;
    state.saving = request({ action: 'save', note: payload }, keepalive);
    try {
      const result = await state.saving;
      note.revision = result.note.revision; note.updated = result.note.updated; note.saveFailed = false; state.failed = false;
    } catch (error) {
      if (error.status === 409) {
        state.failed = false; note.saveFailed = false;
        if (sameContent(payload, error.note)) {
          note.revision = error.note.revision; note.updated = error.note.updated;
        } else {
          const oldId = note.id;
          work.delete(oldId); cache.delete(oldId);
          note.id = crypto.randomUUID(); note.revision = 0;
          work.set(note.id, state); cache.set(note.id, note);
          if (this.editingId === oldId) this.editingId = note.id;
          if (this.activeId === oldId) this.activeId = note.id;
          if (this.peekId === oldId) this.peekId = note.id;
          if (error.note && this.belongs(error.note)) this.notes.push(error.note);
          state.dirty = true;
          toastFrontendWarning('A newer edit exists. Keeping your changes in a separate note.', 'Notes');
        }
      } else {
        state.dirty = true; state.failed = true; note.saveFailed = true;
        toastFrontendError(error.status === 400 ? error.message : 'Could not save this note. Try again when you’re connected.', 'Notes');
      }
    } finally { state.saving = null; this.writeDrafts(); }
    return state.dirty && !state.failed ? this.flush(note, keepalive) : !state.failed;
  },
  flushAll(keepalive = false) {
    for (const state of work.values()) if (state.dirty && !state.saving) void this.flush(state.note, keepalive);
  },
  async remove(note) {
    if (note.deleting) return;
    this.finishEdit(note.id); note.deleting = true;
    try {
      if (!await this.flush(note)) return;
      await request({ action: 'delete', id: note.id, scope: note.scope, revision: note.revision });
      work.delete(note.id); cache.delete(note.id);
      this.notes = this.notes.filter(item => item.id !== note.id);
      this.writeDrafts();
      void this.reload();
    } catch (error) {
      toastFrontendError(error.status === 409 ? 'This note changed. Review it before deleting.' : 'Could not delete this note.', 'Notes');
      if (error.status === 409) void this.reload();
    } finally { note.deleting = false; }
  },

  updateViewport() {
    const viewport = window.visualViewport;
    this.viewport = { width: viewport?.width || innerWidth, height: viewport?.height || innerHeight, left: viewport?.offsetLeft || 0, top: viewport?.offsetTop || 0 };
  },
  noteStyle(note) {
    const rect = fitRect(note, this.viewport);
    return { ...themeStyle(this.appearance, note), left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`, zIndex: note.id === this.activeId ? 2 : 1 };
  },
  startGesture(note, event, kind = 'move') {
    if (event.button !== 0 || event.isPrimary === false || note.deleting || this.gesture) return;
    if (kind === 'move' && event.target.closest('button,textarea,input,a,select')) return;
    this.activeId = note.id; this.suppressClick = '';
    const element = event.currentTarget.closest('[data-note-id]');
    this.gesture = { note, element, pointer: event.pointerId, kind, x: event.clientX, y: event.clientY, start: fitRect(note, this.viewport), original: { x: note.x, y: note.y, width: note.width, height: note.height }, moved: false };
    element.setPointerCapture(event.pointerId);
    if (kind === 'resize') event.preventDefault();
  },
  moveGesture(event) {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointer) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) < 6) return;
    gesture.moved = true; event.preventDefault();
    const rect = gestureRect(gesture.start, dx, dy, gesture.kind, this.viewport);
    gesture.note.x = rect.x; gesture.note.y = rect.y;
    if (gesture.kind === 'resize') { gesture.note.width = Math.max(200, rect.width); gesture.note.height = Math.max(160, rect.height); }
  },
  endGesture(event, cancel = false) {
    const gesture = this.gesture;
    if (!gesture || (event && event.pointerId !== gesture.pointer)) return;
    this.gesture = null;
    if (cancel) Object.assign(gesture.note, gesture.original);
    else if (gesture.moved) { this.suppressClick = gesture.note.id; this.changed(gesture.note); }
    if (cancel || !gesture.moved) void this.flush(gesture.note);
    if (gesture.element.hasPointerCapture(gesture.pointer)) gesture.element.releasePointerCapture(gesture.pointer);
  },
  cancelGesture() { this.endGesture(null, true); },
  noteKey(note, event, kind = 'move') {
    if (event.target.closest('textarea,input') || (kind === 'move' && event.target.closest('button'))) return;
    if (event.key === 'Enter' && kind === 'move') { event.preventDefault(); this.edit(note); return; }
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction) return;
    event.preventDefault(); event.stopPropagation();
    const step = event.shiftKey ? 20 : 4;
    const rect = gestureRect(fitRect(note, this.viewport), direction[0] * step, direction[1] * step, kind, this.viewport);
    note.x = rect.x; note.y = rect.y;
    if (kind === 'resize') { note.width = Math.max(200, rect.width); note.height = Math.max(160, rect.height); }
    this.activeId = note.id; this.changed(note);
  },
});
