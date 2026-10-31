import importlib.util
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import pytest

spec = importlib.util.spec_from_file_location('welcome_notes_storage', Path(__file__).parents[1] / 'helpers/storage.py')
storage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(storage)


def note(scope='shared', **overrides):
    return dict(id=str(uuid4()), scope=scope, revision=0, text='A note', x=40, y=80, width=260, height=240, open=True, **overrides)


def test_persistent_notes_and_independent_workspaces(tmp_path):
    path = tmp_path / 'data/notes.sqlite3'
    book = storage.Notebook(path)
    shared = book.save(note())
    first = book.save(note('chat:one'))
    book.save(note('chat:two'))
    book.save(note('welcome'))
    assert storage.Notebook(path).list('shared') == [shared]
    assert book.list('chat:one') == [first]
    assert {item['scope'] for item in book.list('welcome', overview=True)} == {'chat:one', 'chat:two', 'welcome'}
    assert storage.scope_for('shared', 'one') == 'shared'
    assert storage.scope_for('chat', 'one') == 'chat:one'
    assert storage.scope_for('chat', '') == 'welcome'
    assert path.stat().st_mode & 0o777 == 0o600


def test_revision_guards_preserve_edits_and_deleted_notes(tmp_path):
    book = storage.Notebook(tmp_path / 'notes.sqlite3')
    initial = book.save(note())
    updated = book.save({**initial, 'text': 'Newest edit'})
    with pytest.raises(storage.Conflict) as conflict:
        book.save({**initial, 'text': 'Stale edit'})
    assert conflict.value.note['text'] == 'Newest edit'
    with pytest.raises(storage.Conflict):
        book.delete(initial['id'], initial['scope'], initial['revision'])
    assert book.list('shared')[0]['text'] == 'Newest edit'
    book.delete(updated['id'], updated['scope'], updated['revision'])
    book.delete(updated['id'], updated['scope'], updated['revision'])
    with pytest.raises(storage.Conflict):
        book.save(updated)
    assert book.list('shared') == []


def test_concurrent_edits_allow_one_winner(tmp_path):
    book = storage.Notebook(tmp_path / 'notes.sqlite3')
    original = book.save(note())
    def update(text):
        try:
            book.save({**original, 'text': text})
            return 'saved'
        except storage.Conflict:
            return 'conflict'
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(update, ['one', 'two']))
    assert sorted(results) == ['conflict', 'saved']
    assert book.list('shared')[0]['revision'] == 2


@pytest.mark.parametrize('change', [
    {'id': '../../outside'}, {'scope': 'chat:../../outside'}, {'scope': 'unknown'},
    {'text': '<x>' * 4000}, {'text': {}}, {'x': float('nan')}, {'x': float('inf')},
    {'width': -1}, {'height': True}, {'revision': True}, {'revision': -1}, {'open': 'true'},
])
def test_invalid_notes_are_rejected_without_a_write(tmp_path, change):
    book = storage.Notebook(tmp_path / 'notes.sqlite3')
    with pytest.raises(ValueError):
        book.save({**note(), **change})
    assert not book.path.exists()


def test_html_is_plain_text_and_saved_scopes_cannot_change(tmp_path):
    book = storage.Notebook(tmp_path / 'notes.sqlite3')
    saved = book.save({**note(), 'text': '<script>alert(1)</script>\nAn ordinary note'})
    assert book.list('shared')[0]['text'] == saved['text']
    with pytest.raises(storage.Conflict):
        book.save({**saved, 'scope': 'chat:other'})
    assert book.list('chat:other') == []


def test_note_colors_persist_and_legacy_notes_load_without_migration(tmp_path):
    book = storage.Notebook(tmp_path / 'notes.sqlite3')
    saved = book.save(note(color='#cde5f3'))
    assert book.list('shared')[0]['color'] == '#cde5f3'
    db = book.connect()
    try:
        with db:
            db.execute("UPDATE notes SET data = json_remove(data, '$.color') WHERE id = ?", (saved['id'],))
    finally:
        db.close()
    legacy = book.list('shared')[0]
    assert legacy['color'] == ''
    assert book.save(legacy)['text'] == saved['text']


@pytest.mark.parametrize('color', ['red', '#fff', '#fff; display:none', None, {}, 123])
def test_invalid_note_colors_are_rejected(tmp_path, color):
    book = storage.Notebook(tmp_path / 'notes.sqlite3')
    with pytest.raises(ValueError):
        book.save(note(color=color))
    assert not book.path.exists()
