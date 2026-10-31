import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SHORTCUT, parseShortcut, matchesShortcut, shortcutFromEvent, fitRect, gestureRect } from '../webui/notes-ui.js';

test('shortcuts match exact modifiers without repeating or intercepting composition', () => {
  const event = { code: 'KeyN', altKey: true, shiftKey: true };
  assert.ok(matchesShortcut(event, DEFAULT_SHORTCUT));
  assert.ok(!matchesShortcut({ ...event, ctrlKey: true }, DEFAULT_SHORTCUT));
  assert.ok(!matchesShortcut({ ...event, repeat: true }, DEFAULT_SHORTCUT));
  assert.ok(!matchesShortcut({ ...event, isComposing: true }, DEFAULT_SHORTCUT));
  assert.ok(!matchesShortcut({ ...event, getModifierState: () => true }, DEFAULT_SHORTCUT));
  assert.equal(shortcutFromEvent({ code:'KeyJ', metaKey:true, altKey:true }), 'Alt+Meta+J');
  assert.equal(parseShortcut('Shift+N'), null);
  assert.equal(parseShortcut('Alt+Alt+N'), null);
  assert.equal(parseShortcut({}), null);
});

test('small viewports recover off-screen notes without changing saved desktop geometry', () => {
  const saved = { x: 1400, y: 800, width: 360, height: 300 };
  assert.deepEqual(fitRect(saved, { width: 390, height: 844 }), { x: 22, y: 536, width: 360, height: 300 });
  assert.deepEqual(fitRect(saved, { width: 320, height: 220, top: 80 }), { x: 8, y: 88, width: 304, height: 204 });
  assert.deepEqual(saved, { x: 1400, y: 800, width: 360, height: 300 });
});

test('moving and resizing stay in the viewport', () => {
  const start = { x: 40, y: 50, width: 260, height: 240 }, viewport = { width: 600, height: 800 };
  assert.deepEqual(gestureRect(start, -999, 999, 'move', viewport), { x: 8, y: 552, width: 260, height: 240 });
  assert.deepEqual(gestureRect(start, 999, 999, 'resize', viewport), { x: 40, y: 50, width: 552, height: 742 });
});

test('theme settings are safe, default to Agent Zero, and preserve chosen pastel colors', async () => {
  const { appearance, themeStyle, newNoteColor, PASTELS, snapshot } = await import('../webui/notes-ui.js');
  assert.equal(appearance().theme, 'agent_zero');
  assert.equal(appearance(null).theme, 'agent_zero');
  assert.equal(appearance({ theme: 'unknown' }).theme, 'agent_zero');
  assert.equal(themeStyle({ paper_color: 'url(https://example.com)' })['--wn-paper-color'], '#f6e7ac');
  assert.equal(themeStyle({ text_color: '#123456', paper_color: '#abcdef' }, { color: '#cde5f3' })['--wn-paper-color'], '#cde5f3');
  assert.equal(themeStyle({ text_color: '#123456' })['--wn-paper-ink'], '#123456');
  assert.equal(newNoteColor(appearance({ theme: 'agent_zero', random_pastels: true })), '');
  assert.equal(newNoteColor(appearance({ theme: 'paper', random_pastels: false })), '');
  const chosen = newNoteColor(appearance({ theme: 'paper', random_pastels: true }));
  assert.ok(PASTELS.includes(chosen));
  assert.equal(snapshot({ color: chosen }).color, chosen);
  assert.equal(snapshot({}).color, '');
});
