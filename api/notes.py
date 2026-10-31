import asyncio
import json

from helpers import files, plugins
from helpers.api import ApiHandler, Request, Response
from usr.plugins.welcome_notes.helpers.storage import Conflict, Notebook, scope_for


class Notes(ApiHandler):
    async def process(self, input: dict, request: Request):
        if not isinstance(input, dict):
            return Response(json.dumps({"error": "Invalid request."}), status=400, mimetype="application/json")
        notebook = Notebook(files.get_abs_path("usr", "plugin_data", "welcome_notes", "notes.sqlite3"))
        try:
            action = input.get("action", "list")
            if action == "list":
                config = plugins.get_plugin_config("welcome_notes") or {}
                mode = "chat" if config.get("scope") == "chat" else "shared"
                context = input.get("context", "")
                scope = scope_for(mode, context)
                notes = await asyncio.to_thread(notebook.list, scope, mode == "chat" and not context)
                appearance = {key: config.get(key) for key in ("theme", "paper_color", "text_color", "random_pastels")}
                return {"notes": notes, "scope": scope, "mode": mode, "shortcut": config.get("shortcut", "Alt+Shift+N"), "appearance": appearance}
            if action == "save":
                return {"note": await asyncio.to_thread(notebook.save, input.get("note"))}
            if action == "delete":
                await asyncio.to_thread(notebook.delete, input.get("id"), input.get("scope"), input.get("revision"))
                return {"ok": True}
            raise ValueError("Unknown notes action.")
        except Conflict as error:
            return Response(json.dumps({"error": str(error), "note": error.note}), status=409, mimetype="application/json")
        except ValueError as error:
            return Response(json.dumps({"error": str(error)}), status=400, mimetype="application/json")
