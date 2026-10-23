"""Run: PAPER_TOKEN=... python docs/examples/agent_client.py BASE_URL PAPER_ID SOURCE.tex"""

import json
import os
from pathlib import Path
import sys
import uuid
import httpx

base, paper_id, source = sys.argv[1:]
path = Path(source)
raw = path.read_bytes()
first = raw.decode("utf-8").splitlines()[0]
with httpx.Client(
    base_url=base.rstrip("/") + "/api/v1",
    headers={"Authorization": "Bearer " + os.environ["PAPER_TOKEN"]},
    timeout=60,
) as client:
    paper = client.get("/papers/" + paper_id)
    paper.raise_for_status()
    paper = paper.json()
    # Keep the same key if retrying any individual operation after a timeout.
    file_key = str(uuid.uuid4())
    r = client.post(
        "/papers/" + paper_id + "/files",
        files={"file": (path.name, raw)},
        data={"version_id": paper["current_version"], "source_path": path.name},
        headers={"Idempotency-Key": file_key},
    )
    r.raise_for_status()
    file = r.json()
    # External scoped tokens propose changes; they cannot overwrite the user's
    # reading note. Keep the excerpt with the suggestion, not a new index item.
    r = client.post(
        "/papers/" + paper_id + "/events",
        json={
            "kind": "suggestion",
            "body": "Source first line: " + first,
            "locator": {"file_id": file["id"], "version_id": file["version_id"], "line_start": 1, "line_end": 1, "quote": first},
        },
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    r.raise_for_status()
    r = client.get("/papers/" + paper_id + "/context")
    r.raise_for_status()
    # Private workspace content: write to a file readable by the current user only.
    fd = os.open("paper-context.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as out:
        json.dump(r.json(), out, ensure_ascii=False, indent=2)
    print(
        "Saved paper-context.json; user reading status:",
        r.json()["paper"]["reading_status"],
    )
