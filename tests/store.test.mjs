import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import * as ui from '../webui/notes-ui.js';

const settle = () => new Promise(setImmediate);
async function setup() {
  const rows = new Map(), calls = [], errors = [], warnings = [], saved = {};
  const chats = { selected: '', contexts: [], displayName: context => context.name };
  let mode = 'shared', nextHandler;
  const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
  function handle(payload) {
    if (payload.action === 'list') {
      const scope = mode === 'shared' ? 'shared' : payload.context ? `chat:${payload.context}` : 'welcome';
      return response({ scope, mode, shortcut: 'Alt+Shift+N', notes: [...rows.values()].filter(note => note.scope === scope || (!payload.context && mode === 'chat' && note.scope !== 'shared')).map(note => ({ ...note })) });
    }
    if (payload.action === 'save') {
      const before = rows.get(payload.note.id);
      if (before && before.revision !== payload.note.revision) return response({ note: { ...before } }, 409);
      const note = { ...payload.note, revision: payload.note.revision + 1, updated: Date.now() / 1000 };
      rows.set(note.id, note);
      return response({ note: { ...note } });
    }
    if (payload.action === 'delete') { rows.delete(payload.id); return response({ ok: true }); }
    throw new Error('Unexpected action');
  }
  const storage = { getItem: key => saved[key] || null, setItem: (key, value) => { saved[key] = value; }, removeItem: key => { delete saved[key]; } };
  const window = new EventTarget(), document = Object.assign(new EventTarget(), { querySelector: () => null });
  const source = readFileSync(new URL('../webui/notes-store.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace('export const store', 'const store');
  const context = vm.createContext({
    ...ui, console, setTimeout, clearTimeout, AbortController, crypto: { randomUUID },
    innerWidth: 1200, innerHeight: 800, window, document, sessionStorage: storage, localStorage: storage,
    requestAnimationFrame: callback => callback(),
    createStore: (_, model) => model, getStore: name => name === 'chats' ? chats : {}, getModalStack: () => [],
    toastFrontendError: message => errors.push(message), toastFrontendWarning: message => warnings.push(message),
    fetchApi: async (url, options) => {
      assert.equal(url, '/api/plugins/welcome_notes/notes');
      const payload = JSON.parse(options.body); calls.push(payload);
      if (nextHandler) { const handler = nextHandler; nextHandler = null; return handler(payload); }
      return handle(payload);
    },
  });
  const store = vm.runInContext(`${source}\nstore`, context), owner = {};
  store.mount(owner); await settle();
  return { store, rows, calls, errors, warnings, saved, response, handle, chats,
    mode: value => { mode = value; }, next: handler => { nextHandler = handler; },
    cleanup: () => store.cleanup(owner) };
}

async function create(t, text = 'first') {
  t.store.create();
  const note = t.store.notes.at(-1);
  note.text = text; t.store.changed(note);
  await t.store.flush(note);
  return note;
}

test('autosaves serialize edits made during an outstanding request', async () => {
  const t = await setup();
  const note = await create(t);
  let release;
  t.next(payload => new Promise(resolve => { release = () => resolve(t.handle(payload)); }));
  note.text = 'second'; t.store.changed(note);
  const saving = t.store.flush(note);
  note.text = 'third'; t.store.changed(note);
  release(); await saving;
  assert.equal(t.rows.get(note.id).text, 'third');
  assert.equal(note.revision, 3);
  assert.equal(t.saved['welcomeNotes.drafts'], undefined);
  t.cleanup();
});

test('pending saves stay in their original chat while the visible context changes', async () => {
  const t = await setup(); t.mode('chat'); t.store.setContext('a'); await settle();
  const note = await create(t, 'Chat A');
  let release;
  t.next(payload => new Promise(resolve => { release = () => resolve(t.handle(payload)); }));
  note.text = 'Still A'; t.store.changed(note);
  const saving = t.store.flush(note);
  t.store.setContext('b'); await settle();
  assert.equal(t.store.scope, 'chat:b'); assert.equal(t.store.notes.length, 0);
  release(); await saving;
  assert.equal(t.rows.get(note.id).scope, 'chat:a');
  assert.equal(t.rows.get(note.id).text, 'Still A');
  assert.equal(t.store.notes.length, 0);
  t.cleanup();
});

test('a revision conflict preserves both edits in separate notes', async () => {
  const t = await setup();
  const note = await create(t, 'original'), oldId = note.id;
  t.rows.set(oldId, { ...t.rows.get(oldId), revision: 2, text: 'Other tab' });
  note.text = 'This tab'; t.store.changed(note);
  await t.store.flush(note);
  assert.notEqual(note.id, oldId);
  assert.equal(t.rows.get(oldId).text, 'Other tab');
  assert.equal(t.rows.get(note.id).text, 'This tab');
  assert.equal(t.warnings.length, 1);
  assert.equal(t.saved['welcomeNotes.drafts'], undefined);
  t.cleanup();
});

test('an uncertain successful create can be reconciled without duplicating its note', async () => {
  const t = await setup(); t.store.create(); const note = t.store.notes[0];
  t.handle({ action: 'save', note: ui.snapshot(note) });
  await t.store.flush(note);
  assert.equal(t.rows.size, 1); assert.equal(note.revision, 1); assert.equal(t.warnings.length, 0);
  t.cleanup();
});

test('failed concurrent flushes keep the draft and permit a later retry', async () => {
  const t = await setup(); const note = await create(t);
  let fail;
  t.next(() => new Promise((resolve, reject) => { fail = reject; }));
  note.text = 'Keep this'; t.store.changed(note);
  const first = t.store.flush(note), second = t.store.flush(note);
  fail(new Error('Offline'));
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
  assert.equal(JSON.parse(t.saved['welcomeNotes.drafts'])[0].text, 'Keep this');
  assert.equal(note.saveFailed, true);
  assert.equal(await t.store.flush(note), true);
  assert.equal(t.rows.get(note.id).text, 'Keep this');
  assert.equal(t.saved['welcomeNotes.drafts'], undefined);
  t.cleanup();
});

test('scope changes preserve both notebooks and hiding a note keeps its content', async () => {
  const t = await setup(); const shared = await create(t, 'Shared');
  t.store.hide(shared); await t.store.flush(shared);
  assert.equal(t.store.visible.length, 0);
  assert.equal(t.store.list.length, 1);
  t.mode('chat'); await t.store.reload(); const welcome = await create(t, 'Welcome');
  t.store.setContext('a'); await settle(); const chat = await create(t, 'Chat A');
  t.store.setContext(''); await settle();
  assert.equal(t.store.list.length, 2);
  t.store.open(t.store.notes.find(note => note.id === chat.id));
  assert.ok(t.store.visible.some(note => note.id === chat.id));
  t.mode('shared'); await t.store.reload();
  assert.equal(t.store.notes.length, 1); assert.equal(t.store.notes[0].id, shared.id);
  assert.ok(t.rows.has(welcome.id)); assert.ok(t.rows.has(chat.id));
  t.cleanup();
});

test('deleting waits for the latest save and removes the draft', async () => {
  const t = await setup(); const note = await create(t);
  note.text = 'Last edit'; t.store.changed(note);
  await t.store.remove(note);
  assert.equal(t.rows.size, 0); assert.equal(t.store.notes.length, 0);
  assert.equal(t.saved['welcomeNotes.drafts'], undefined);
  assert.deepEqual(t.calls.filter(call => call.action !== 'list').slice(-2).map(call => call.action), ['save', 'delete']);
  t.cleanup();
});

test('a canceled drag restores geometry and saves text without persisting its preview', async () => {
  const t = await setup(); const note = await create(t);
  const original = { x: note.x, y: note.y, width: note.width, height: note.height };
  const element = { setPointerCapture() {}, hasPointerCapture: () => false };
  const event = { button: 0, isPrimary: true, pointerId: 1, clientX: 100, clientY: 100,
    target: { closest: () => null }, currentTarget: { closest: () => element }, preventDefault() {} };
  note.text = 'Pending text'; t.store.changed(note);
  t.store.startGesture(note, event);
  t.store.moveGesture({ ...event, clientX: 160, clientY: 180 });
  assert.notEqual(note.y, original.y);
  assert.equal(await t.store.flush(note), false);
  assert.equal(t.rows.get(note.id).text, 'first');
  t.store.cancelGesture(); await settle();
  assert.equal(t.rows.get(note.id).text, 'Pending text');
  for (const [key, value] of Object.entries(original)) assert.equal(note[key], value);
  assert.equal(t.rows.get(note.id).y, original.y);
  t.cleanup();
});

test('retry after a lost successful response clears failure state without duplicating the note', async () => {
  const t = await setup(); t.store.create(); const note = t.store.notes[0];
  t.next(payload => { t.handle(payload); throw new Error('Response lost'); });
  assert.equal(await t.store.flush(note), false);
  assert.equal(note.saveFailed, true);
  assert.equal(await t.store.flush(note), true);
  assert.equal(note.saveFailed, false); assert.equal(note.revision, 1);
  assert.equal(t.rows.size, 1); assert.equal(t.saved['welcomeNotes.drafts'], undefined);
  t.cleanup();
});

test('a late list response cannot replace an edit saved while it was loading', async () => {
  const t = await setup(); const note = await create(t);
  let release;
  t.next(payload => { const stale = t.handle(payload); return new Promise(resolve => { release = () => resolve(stale); }); });
  const loading = t.store.reload();
  note.text = 'Newer edit'; t.store.changed(note); await t.store.flush(note);
  release(); await loading;
  assert.equal(t.store.notes[0].text, 'Newer edit'); assert.equal(t.store.notes[0].revision, 2);
  t.cleanup();
});

test('a late list response cannot hide a new note whose save has just completed', async () => {
  const t = await setup(); t.store.create(); const note = t.store.notes[0];
  let release;
  t.next(payload => { const stale = t.handle(payload); return new Promise(resolve => { release = () => resolve(stale); }); });
  const loading = t.store.reload(); await t.store.flush(note);
  release(); await loading;
  assert.equal(t.store.notes.length, 1); assert.equal(t.store.notes[0].id, note.id);
  assert.equal(t.store.notes[0].revision, 1);
  t.cleanup();
});


test('creating or deleting during a reload does not resurrect stale list entries', async () => {
  const t = await setup(); let release;
  t.next(payload => { const stale = t.handle(payload); return new Promise(resolve => { release = () => resolve(stale); }); });
  const beforeCreate = t.store.reload(); const note = await create(t);
  release(); await beforeCreate;
  assert.equal(t.store.notes[0].id, note.id);
  t.next(payload => { const stale = t.handle(payload); return new Promise(resolve => { release = () => resolve(stale); }); });
  const beforeDelete = t.store.reload(); await t.store.remove(note);
  release(); await beforeDelete; await settle();
  assert.equal(t.store.notes.length, 0); assert.equal(t.rows.size, 0);
  t.cleanup();
});

test('pastel assignment happens once at creation and survives editing and reload', async () => {
  const t = await setup();
  t.store.appearance = ui.appearance({ theme: 'paper', random_pastels: true });
  const note = await create(t); const color = note.color;
  assert.ok(ui.PASTELS.includes(color));
  note.text = 'Edited'; t.store.changed(note); await t.store.flush(note);
  await t.store.reload();
  assert.equal(t.rows.get(note.id).color, color);
  assert.equal(t.store.notes[0].color, color);
  t.cleanup();
});
