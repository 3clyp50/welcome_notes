import json
import math
import re
import sqlite3
import time
from pathlib import Path
from uuid import UUID

MAX_TEXT = 10_000
MAX_NOTES = 500
SCOPE = re.compile(r"(?:shared|welcome|chat:[A-Za-z0-9_-]{1,128})\Z")
FIELDS = {"text", "x", "y", "width", "height", "open"}


class Conflict(Exception):
    def __init__(self, note):
        super().__init__("This note changed elsewhere.")
        self.note = note


def validate_id(value):
    if not isinstance(value, str):
        raise ValueError("Invalid note.")
    try:
        if str(UUID(value)) != value:
            raise ValueError
    except (ValueError, AttributeError):
        raise ValueError("Invalid note.") from None
    return value


def validate_scope(value):
    if not isinstance(value, str) or not SCOPE.fullmatch(value):
        raise ValueError("Invalid notes workspace.")
    return value


def scope_for(mode, context):
    if not isinstance(context, str) or (context and not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", context)):
        raise ValueError("Invalid chat.")
    return "shared" if mode == "shared" else f"chat:{context}" if context else "welcome"


def validate_revision(value):
    if type(value) is not int or value < 0:
        raise ValueError("Invalid note revision.")
    return value


def validate_note(note):
    if not isinstance(note, dict):
        raise ValueError("Invalid note.")
    validate_id(note.get("id"))
    validate_scope(note.get("scope"))
    validate_revision(note.get("revision"))
    if not isinstance(note.get("text"), str) or len(note["text"]) > MAX_TEXT:
        raise ValueError(f"Notes can contain up to {MAX_TEXT:,} characters.")
    if type(note.get("open")) is not bool:
        raise ValueError("Invalid note visibility.")
    color = note.get("color", "")
    if not isinstance(color, str) or (color and not re.fullmatch(r"#[0-9a-fA-F]{6}", color)):
        raise ValueError("Invalid note color.")
    for key, minimum, maximum in [("x", 0, 100_000), ("y", 0, 100_000), ("width", 120, 4096), ("height", 100, 4096)]:
        value = note.get(key)
        if type(value) not in (float, int) or not math.isfinite(value) or not minimum <= value <= maximum:
            raise ValueError("Invalid note position or size.")
    return {**{key: note[key] for key in FIELDS}, "color": color}


class Notebook:
    def __init__(self, path):
        self.path = Path(path)

    def connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        db = sqlite3.connect(self.path, timeout=10)
        self.path.chmod(0o600)
        db.row_factory = sqlite3.Row
        db.execute("CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, scope TEXT NOT NULL, revision INTEGER NOT NULL, updated REAL NOT NULL, data TEXT NOT NULL)")
        return db

    @staticmethod
    def unpack(row):
        return {"color": "", **json.loads(row["data"]), "id": row["id"], "scope": row["scope"], "revision": row["revision"], "updated": row["updated"]} if row else None

    def list(self, scope, overview=False):
        validate_scope(scope)
        db = self.connect()
        try:
            query, args = ("scope != ?", ("shared",)) if overview else ("scope = ?", (scope,))
            return [self.unpack(row) for row in db.execute(f"SELECT * FROM notes WHERE {query} ORDER BY updated DESC, id", args)]
        finally:
            db.close()

    def save(self, note):
        data = validate_note(note)
        db = self.connect()
        try:
            with db:
                db.execute("BEGIN IMMEDIATE")
                current = db.execute("SELECT * FROM notes WHERE id = ?", (note["id"],)).fetchone()
                if current:
                    if current["scope"] != note["scope"] or current["revision"] != note["revision"]:
                        raise Conflict(self.unpack(current))
                elif note["revision"]:
                    raise Conflict(None)
                elif db.execute("SELECT COUNT(*) FROM notes").fetchone()[0] >= MAX_NOTES:
                    raise ValueError(f"You can keep up to {MAX_NOTES} notes.")
                revision, updated = note["revision"] + 1, time.time()
                db.execute("INSERT INTO notes VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, updated=excluded.updated, data=excluded.data",
                           (note["id"], note["scope"], revision, updated, json.dumps(data, ensure_ascii=False)))
            return {**data, "id": note["id"], "scope": note["scope"], "revision": revision, "updated": updated}
        finally:
            db.close()

    def delete(self, note_id, scope, revision):
        validate_id(note_id)
        validate_scope(scope)
        validate_revision(revision)
        db = self.connect()
        try:
            with db:
                db.execute("BEGIN IMMEDIATE")
                current = db.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
                if current and (current["scope"] != scope or current["revision"] != revision):
                    raise Conflict(self.unpack(current))
                db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        finally:
            db.close()
