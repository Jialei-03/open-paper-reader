"""Rebuild missing PDF counterpart locations from retained translation checkpoints.

Run as an administrator with the application's environment. Dry-run by default.
No model calls and no changes to PDFs, notes, or existing nonempty mappings.
"""

import argparse
import json
import re
import tempfile
from collections import defaultdict
from pathlib import Path

from sqlalchemy import select

from backend.arxiv_import import extract_source
from backend.config import Settings, database
from backend.models import File, TranslationJob
from backend.translation_engine import align, extract_pdf_pages, plain, protect, verbatim_anchors


def recover_archives(source_archive, target_archive):
    # Match only unique preserved LaTeX anchors, never paragraph position alone.
    with tempfile.TemporaryDirectory(prefix="paper-alignment-") as temp:
        roots = [Path(temp) / "source", Path(temp) / "translated"]
        for archive, root in zip((source_archive, target_archive), roots):
            extract_source(archive.read_bytes(), root)
        sides = []
        for root in roots:
            index = defaultdict(list)
            for path in root.rglob("*.tex"):
                for chunk in re.split(r"\n\s*\n", path.read_text(errors="replace")):
                    _, tokens = protect(chunk)
                    # Refs, labels, citations and formula content provide stable identities.
                    if not any(
                        re.match(r"\\(?:label|ref|cite|eqref)\b|\$", token)
                        for token in tokens
                    ):
                        continue
                    key = tuple(re.sub(r"\s+", "", token) for token in tokens)
                    index[key].append(plain(chunk, {}))
            sides.append(index)
        units = []
        for key, values in sides[0].items():
            targets = sides[1].get(key, [])
            if len(values) == len(targets) == 1 and values[0] != targets[0]:
                units.append(
                    {
                        "id": f"recovered-{len(units) + 1}",
                        "source_text": values[0],
                        "translated_text": targets[0],
                    }
                )
        return units


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--add-verbatim",
        action="store_true",
        help="Append anchors for untranslated passages (references) to existing mappings.",
    )
    args = parser.parse_args()
    settings = Settings.env()
    _, maker = database(settings)
    with maker() as db:
        ids = list(
            db.scalars(
                select(TranslationJob.id).where(TranslationJob.status == "completed")
            )
        )
    for job_id in ids:
        with maker() as db:
            job = db.get(TranslationJob, job_id)
            if not job:
                continue
            if args.add_verbatim:
                if not job.alignment or any(
                    str(row.get("id", "")).startswith("same-") for row in job.alignment
                ):
                    continue
                files = (db.get(File, job.source_file), db.get(File, job.translated_file))
                if not all(files) or any(
                    f.owner != job.owner or f.paper_id != job.paper_id or f.version_id != job.version_id
                    for f in files
                ):
                    print(job_id, "skipped: PDF unavailable or mismatched")
                    continue
                extra = verbatim_anchors(
                    *(extract_pdf_pages(Path(settings.storage) / f.id) for f in files)
                )
                print(job_id, f"+{len(extra)} verbatim anchors", "apply" if args.apply else "dry-run")
                if args.apply and extra:
                    job.alignment = [*job.alignment, *extra]
                    db.commit()
                continue
            if job.alignment:
                continue
            cache = (
                Path(settings.storage).parent
                / "translation-work"
                / job.id
                / "units.json"
            )
            source, target = (
                db.get(File, job.source_file),
                db.get(File, job.translated_file),
            )
            if not source or not target:
                print(job_id, "skipped: checkpoint or PDF unavailable")
                continue
            if any(
                f.owner != job.owner
                or f.paper_id != job.paper_id
                or f.version_id != job.version_id
                for f in (source, target)
            ):
                raise ValueError("Translation file ownership/version mismatch")
            if cache.is_file():
                units = list(json.loads(cache.read_text()).values())
            else:
                archives = [
                    db.get(File, key)
                    for key in (job.source_archive, job.translated_archive)
                ]
                if any(
                    not f or f.owner != job.owner or f.paper_id != job.paper_id
                    for f in archives
                ):
                    print(job_id, "skipped: source archives unavailable")
                    continue
                units = recover_archives(
                    *(Path(settings.storage) / f.id for f in archives)
                )
            rows = align(
                units,
                Path(settings.storage) / source.id,
                Path(settings.storage) / target.id,
            )
            reliable = sum(bool(row["source"] and row["translated"]) for row in rows)
            print(
                job_id,
                f"{reliable}/{len(rows)} matched",
                "apply" if args.apply else "dry-run",
            )
            if args.apply:
                job.alignment = rows
                db.commit()


if __name__ == "__main__":
    main()
