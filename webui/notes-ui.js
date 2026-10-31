export const DEFAULT_SHORTCUT = 'Alt+Shift+N';
export const NOTE_FIELDS = ['id', 'scope', 'revision', 'text', 'x', 'y', 'width', 'height', 'open', 'color'];
export const snapshot = note => Object.fromEntries(NOTE_FIELDS.map(key => [key, key === 'color' ? note.color || '' : note[key]]));
export const title = note => note.text.trim().split('\n')[0].slice(0, 80) || 'Untitled note';

export const THEMES = [{ id: 'agent_zero', name: 'Agent Zero' }, { id: 'paper', name: 'Paper' }, { id: 'notebook', name: 'Notebook' }];
export const PASTELS = ['#f6e7ac', '#f2cfd8', '#d9e9c5', '#cde5f3', '#e1d6f2', '#f3d9c1'];
const color = (value, fallback) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
export function appearance(value = {}) {
  return {
    theme: THEMES.some(theme => theme.id === value?.theme) ? value.theme : 'agent_zero',
    paper_color: color(value?.paper_color, '#f6e7ac'), text_color: color(value?.text_color, '#3b3423'),
    random_pastels: value?.random_pastels === true,
  };
}
export function themeStyle(settings, note = {}) {
  const options = appearance(settings);
  return { '--wn-paper-color': color(note.color, options.paper_color), '--wn-paper-ink': options.text_color };
}
export function newNoteColor(settings) {
  return settings.theme === 'paper' && settings.random_pastels ? PASTELS[Math.floor(Math.random() * PASTELS.length)] : '';
}

const modifiers = ['Control', 'Alt', 'Shift', 'Meta'];
export function parseShortcut(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split('+');
  const key = parts.pop()?.toUpperCase();
  if (!key || !/^(?:[A-Z0-9]|F(?:[1-9]|1[0-2]))$/.test(key)
      || !parts.some(part => ['Control', 'Alt', 'Meta'].includes(part))
      || parts.some(part => !modifiers.includes(part)) || new Set(parts).size !== parts.length) return null;
  return { key, modifiers: parts };
}

function eventKey(event) {
  return event.code?.replace(/^Key|^Digit/, '').toUpperCase() || event.key?.toUpperCase();
}

export function matchesShortcut(event, value) {
  const shortcut = parseShortcut(value);
  if (!shortcut || event.repeat || event.isComposing || event.getModifierState?.('AltGraph')) return false;
  return shortcut.key === eventKey(event)
    && modifiers.every((key, index) => Boolean(event[['ctrlKey', 'altKey', 'shiftKey', 'metaKey'][index]]) === shortcut.modifiers.includes(key));
}

export function shortcutFromEvent(event) {
  if (event.repeat || event.isComposing || event.getModifierState?.('AltGraph')) return null;
  const value = [...modifiers.filter((key, index) => event[['ctrlKey', 'altKey', 'shiftKey', 'metaKey'][index]]), eventKey(event)].join('+');
  return parseShortcut(value) ? value : null;
}

export function shortcutLabel(value) {
  return (parseShortcut(value) ? value : DEFAULT_SHORTCUT).replace('Control', 'Ctrl').replace('Meta', '⌘').split('+');
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
export function fitRect(note, viewport) {
  const availableWidth = Math.max(1, viewport.width - 16);
  const availableHeight = Math.max(1, viewport.height - 16);
  const width = clamp(note.width, Math.min(200, availableWidth), availableWidth);
  const height = clamp(note.height, Math.min(160, availableHeight), availableHeight);
  const left = (viewport.left || 0) + 8, top = (viewport.top || 0) + 8;
  return {
    x: clamp(note.x, left, left + availableWidth - width),
    y: clamp(note.y, top, top + availableHeight - height), width, height,
  };
}

export function gestureRect(start, dx, dy, kind, viewport) {
  const next = kind === 'resize'
    ? { ...start, width: Math.max(200, start.width + dx), height: Math.max(160, start.height + dy) }
    : { ...start, x: start.x + dx, y: start.y + dy };
  if (kind === 'resize') {
    next.width = Math.min(next.width, viewport.width + (viewport.left || 0) - start.x - 8);
    next.height = Math.min(next.height, viewport.height + (viewport.top || 0) - start.y - 8);
  }
  return fitRect(next, viewport);
}
