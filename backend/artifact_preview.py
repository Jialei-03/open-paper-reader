"""Bounded, explicitly unfinished reading previews from complete JSON array items.

No partial JSON strings or objects are repaired. Publication and coverage checks
remain exclusively in finish_artifact; these checks only permit useful drafts.
"""

import json
import re

from pydantic import ValidationError

from .reading_artifacts import (
    RESULT_LIMIT,
    GuideSection,
    Keypoint,
    OutlineEntry,
    Question,
    SuggestedHighlight,
    TranslatedParagraph,
    normalized_text,
)
from .sentence_alignment import merged


def complete_arrays(raw):
    """Read top-level arrays only, stopping at the first incomplete JSON value."""
    raw = re.sub(r"^```(?:json)?\s*", "", raw.lstrip())
    if len(raw.encode()) > RESULT_LIMIT or not raw.startswith("{"):
        return {}
    decoder, result, pos = json.JSONDecoder(), {}, 1
    try:
        while True:
            while pos < len(raw) and raw[pos].isspace():
                pos += 1
            if pos >= len(raw) or raw[pos] == "}":
                return result
            key, pos = decoder.raw_decode(raw, pos)
            if not isinstance(key, str) or key in result:
                return {}
            while pos < len(raw) and raw[pos].isspace():
                pos += 1
            if raw[pos] != ":":
                return {}
            pos += 1
            while pos < len(raw) and raw[pos].isspace():
                pos += 1
            if raw[pos] != "[":
                return {}
            pos += 1
            result[key] = []
            while True:
                while pos < len(raw) and raw[pos].isspace():
                    pos += 1
                if pos >= len(raw):
                    return result
                if raw[pos] == "]":
                    pos += 1
                    break
                item, end = decoder.raw_decode(raw, pos)
                # A scalar such as 1 may still become 12. Only publish after
                # its array delimiter arrives; objects/strings also use this rule.
                pos = end
                while pos < len(raw) and raw[pos].isspace():
                    pos += 1
                if pos >= len(raw) or raw[pos] not in ",]":
                    return result
                result[key].append(item)
                if len(result[key]) > 300:
                    return {}
                if raw[pos] == "]":
                    pos += 1
                    break
                pos += 1
            while pos < len(raw) and raw[pos].isspace():
                pos += 1
            if pos >= len(raw) or raw[pos] == "}":
                return result
            if raw[pos] != ",":
                return {}
            pos += 1
    except (json.JSONDecodeError, IndexError):
        return result


def preview(kind, raw, *, texts, pages, units=None):
    arrays = complete_arrays(raw)
    result = {}
    fields = {
        "guide": {
            "keywords": (None, 12),
            "summary": (None, 3),
            "sections": (GuideSection, 4),
        },
        "quiz": {"questions": (Question, 15)},
        "outline": {"entries": (OutlineEntry, 200)},
        "highlights": {"highlights": (SuggestedHighlight, 30)},
        "keypoints": {"keypoints": (Keypoint, 24)},
        "page_translation": {"paragraphs": (TranslatedParagraph, 300)},
    }[kind]
    if kind == "page_translation" and "sentences" in arrays and units is not None:
        paragraphs = []
        for index, item in enumerate(arrays["sentences"]):
            if (
                not isinstance(item, dict)
                or set(item) != {"id", "kind", "translation"}
                or type(item["id"]) is not int
                or item["id"] != index
                or index >= len(units)
            ):
                break
            paragraphs.append(
                {
                    "original": units[index]["original"],
                    "kind": item["kind"],
                    "translation": item["translation"],
                }
            )
        arrays = {"paragraphs": paragraphs}
    for field, (schema, limit) in fields.items():
        values = []
        for item in arrays.get(field, [])[:limit]:
            try:
                if schema is None:
                    maximum = 120 if field == "keywords" else 4000
                    if (
                        not isinstance(item, str)
                        or not item.strip()
                        or len(item) > maximum
                    ):
                        break
                    values.append(item)
                    continue
                entry = schema.model_validate(item)
                if kind in {"guide", "quiz"} and not set(entry.pages).issubset(pages):
                    break
                if (
                    field == "sections"
                    and entry.title
                    != ["研究问题", "方法", "主要结果", "适用边界"][len(values)]
                ):
                    break
                if field == "questions" and any(
                    v["question"].strip() == entry.question.strip() for v in values
                ):
                    break
                if kind in {"outline", "highlights", "keypoints"}:
                    needle = normalized_text(
                        entry.title if kind == "outline" else entry.quote
                    )
                    if (
                        entry.page not in pages
                        or not needle
                        or needle not in normalized_text(texts.get(str(entry.page), ""))
                    ):
                        break
                    if kind == "outline" and values and entry.page < values[-1]["page"]:
                        break
                if kind == "page_translation":
                    original = normalized_text(entry.original)
                    if (
                        not entry.translation.strip()
                        or not original
                        or merged(entry)
                        or not any(
                            original in normalized_text(text) for text in texts.values()
                        )
                    ):
                        break
                value = entry.model_dump(mode="json")
                if value not in values:
                    values.append(value)
            except (ValidationError, ValueError, TypeError):
                break
        if values:
            result[field] = values
    return (
        result
        if len(json.dumps(result, ensure_ascii=False).encode()) <= RESULT_LIMIT
        else {}
    )


def store_preview(d, run, raw, *, units=None):
    """Update only the current artifact's draft, without touching its result."""
    from .models import ReadingArtifact

    runtime = dict(run.runtime or {})
    artifact_id = runtime.get("reading_artifact_id")
    if not artifact_id:
        return False
    row = d.get(ReadingArtifact, artifact_id)
    runtime.pop("artifact_preview", None)
    if (
        row
        and row.run_id == run.id
        and row.owner == run.owner
        and run.status == "running"
    ):
        value = preview(
            row.kind,
            raw,
            texts=row.evidence_text or {},
            pages=set(row.evidence_pages or []),
            units=units,
        )
        if value:
            runtime["artifact_preview"] = value
    run.runtime = runtime
    return True
