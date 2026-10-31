# Welcome Notes

![Welcome Notes](webui/thumbnail.webp)

Movable notes for the Agent Zero welcome screen and chats. Drag a note with your mouse or finger, resize its corner, and click to write. Notes use Agent Zero's Rubik font.

## Install

Open **Plugins → Plugin Hub → Install from Git** and use:

```text
https://github.com/3clyp50/welcome_notes
```

Enable the plugin and reload the WebUI. Requires Agent Zero's plugin-enabled WebUI. No API key, model calls, extra dependencies, or background service are needed.

## Use

- Choose **New note** in the welcome Notes panel, or press **Alt+Shift+N** from the welcome screen or a chat.
- Drag anywhere on the paper while it is not being edited. Click to write; while editing, text selection and scrolling work normally. The paper's top edge remains draggable.
- Drag the bottom-right corner to resize. Notes stay within the visible screen, including narrow layouts.
- **Close** hides a note. Open it again from the welcome list. **Delete** uses Agent Zero's two-click confirmation and permanently removes it.
- Focus a note and use the arrow keys to move it, or focus its corner and use the arrow keys to resize. Hold Shift for larger steps. Enter starts editing; Escape leaves the editor or cancels a drag.
- The welcome panel supports half/full width, reordering, and dismissal on current welcome layouts. **Show all dismissed** restores it; dismissing the panel does not close your notes.

## Settings

Open the gear in the Notes panel or the plugin's configuration in Plugins.

**Theme** offers three selectable cards with live previews:

- **Agent Zero** (default): a modern panel using A0's colours, border and blue accent. It follows the app's light/dark mode.
- **Paper**: textured sticky notes with configurable **Note colour** and **Text colour**. The **Random pastels** toggle appears directly below the theme previews, only when Paper is selected. It assigns a pastel to each newly created Paper note; that colour stays with the note. Turning it off makes new notes use the selected note colour. Existing pastel notes retain their colours.
- **Notebook**: pale ruled paper with a quiet margin line.

Theme changes apply to all notes without changing their text, size, position or chat. Colour controls update the Paper preview as you choose them; **Save** applies your settings. Existing notes without an assigned pastel use the configured Paper colour.

**Notes** defaults to **Shared**: the same notes are available across the welcome screen and every chat. **Per chat** keeps a separate set for each chat and another for the welcome screen. The welcome list includes all per-chat notes with their chat names; opening one there previews it without changing its original chat. Switching modes preserves both sets of notes.

**New note shortcut** records a key combination with Ctrl, Alt, or Command. The welcome panel shows your current shortcut. Browser or operating-system shortcuts may take precedence; choose another combination if yours is reserved. The shortcut is inactive while an Agent Zero modal is open.

## Storage and recovery

Notes autosave to `usr/plugin_data/welcome_notes/notes.sqlite3` on the Agent Zero runtime, outside the plugin's web assets. Include this file in your backups. Notes are plain text, limited to 10,000 characters each and 500 saved notes per instance. Their content is never sent to a model by this plugin.

Simultaneous edits to the same note preserve a separate copy instead of overwriting newer text. A failed save keeps the draft in memory and, when browser storage permits, in that tab's session storage for reload recovery. A retry icon appears on the note. Keep the tab open until saving succeeds; this is not an offline backup.

Disable or uninstall through Plugins. Stored notes remain in the data directory; reinstalling restores them. Chat deletion does not delete its notes: they remain accessible from the welcome list in Per chat mode. Panel width/dismissal are browser-local preferences; note content, positions and sizes are saved on the runtime.

## Development

The stable overlay mounts through `sidebar-start`; `welcome-actions-end` supplies the list with block ID `welcome_notes.list`. The plugin reuses Agent Zero's stores, authenticated API client, modal settings, icons, confirmation controls and welcome layout. It does not change Core's component or extension loaders.

Run from the plugin directory:

```bash
python -m pytest tests/test_storage.py -q
node --test tests/*.test.mjs
```

Use Agent Zero's framework Python environment for backend checks. Live verification covers mouse and touch dragging/resizing, keyboard controls, reload persistence, shared/per-chat switching, shortcut configuration, close/reopen and responsive layouts.

MIT license. Thumbnail generated with OpenAI imagegen; `webui/thumbnail.webp` is 256×256 pixels and under 20 KB.
