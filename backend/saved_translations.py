# ruff: noqa: B008
"""A translated selection is kept, so selecting the same words again shows it at once.

One row per (owner, file, exact quote, target language), kept as a reading
artifact of its own kind so it is counted in the storage budget, travels with
backups and exports, and goes away with its paper. A new translation of the
same words replaces the old one in place; a failed or stopped one leaves the
saved one alone.
"""

import hashlib
import json
import unicodedata

from fastapi import Depends
from pydantic import Field
from sqlalchemy import select

from .models import File, ReadingArtifact, now
from .schemas import Strict
from .storage_budget import StorageBudgetExceeded, lock_owner, require_space

KIND = "text_translation"
LANGUAGE = "zh"  # the selection prompt (direct_runs.SELECTION) translates into Simplified Chinese


class SavedLookup(Strict):
    quote: str = Field(min_length=1, max_length=10000)
    language: str = Field(default=LANGUAGE, max_length=10)


def quote_key(owner, file_id, language, quote):
    words = " ".join(unicodedata.normalize("NFC", quote).split())
    return hashlib.sha256(
        json.dumps([1, owner, file_id, KIND, language, words]).encode()
    ).hexdigest()


def find(d, owner, file_id, language, quote):
    return d.scalar(
        select(ReadingArtifact).where(
            ReadingArtifact.owner == owner,
            ReadingArtifact.cache_key == quote_key(owner, file_id, language, quote),
        )
    )


def save(d, settings, run, context, text):
    """Keep (or replace) the translation of a selection a direct run just finished."""
    if (
        context.get("source") != "selection"
        or context.get("action") != "translate"
        or not text
        or not text.strip()
        or not context.get("quote", "").strip()
    ):
        return
    file = d.get(File, context.get("file_id"))
    if not file or file.owner != run.owner:
        return
    quote = context["quote"]
    row = find(d, run.owner, file.id, LANGUAGE, quote)
    result = {"quote": quote, "translation": text}
    size = len(json.dumps(result, ensure_ascii=False).encode()) + 2048
    try:
        lock_owner(d, run.owner)
        require_space(d, settings, run.owner, max(0, size - (row.size if row else 0)))
    except StorageBudgetExceeded:
        return  # the reader still has the translation on screen; it is just not kept
    if row is None:
        row = ReadingArtifact(
            owner=run.owner,
            paper_id=file.paper_id,
            file_id=file.id,
            version_id=file.version_id,
            file_sha256=file.sha256,
            cache_key=quote_key(run.owner, file.id, LANGUAGE, quote),
            kind=KIND,
            parameters={"language": LANGUAGE},
        )
        d.add(row)
    row.model_config_id, row.model = run.model_config_id, run.model
    row.run_id = run.id
    row.status, row.error, row.result, row.size = "completed", "", result, size
    row.updated_at = now()


def install_saved_translation_routes(app, db, auth, owned):
    @app.post("/api/v1/files/{id}/saved-translation")
    def saved_translation(id: str, body: SavedLookup, a=Depends(auth), d=Depends(db)):
        file = owned(d, File, id, a)
        row = find(d, a["id"], file.id, body.language, body.quote)
        if row is None or row.status != "completed":
            return {"translation": None}
        return {
            "translation": row.result.get("translation"),
            "updated_at": row.updated_at,
        }
