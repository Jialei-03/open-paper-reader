"""Scores finished runs again with the current criteria, from the projects' records.

    python scripts/research_eval/rescore.py --base http://127.0.0.1:8765 scripts/research_eval/results/*.jsonl

Rewrites each file in place; the projects must still exist in that data folder.
"""

import argparse
import json
from pathlib import Path

from run import HERE, Client, score


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8765")
    parser.add_argument("paths", nargs="+")
    args = parser.parse_args()
    client = Client(args.base)
    for path in map(Path, args.paths):
        rows = [
            json.loads(line) for line in path.read_text().splitlines() if line.strip()
        ]
        for row in rows:
            task = json.loads((HERE / "tasks" / row["task"] / "task.json").read_text())
            detail = client.get(f"/api/v1/research/projects/{row['project']}")
            before = row["scores"]["score"]
            row["scores"] = score(task, detail, row["metrics"])
            if row["scores"]["score"] != before:
                print(
                    f"{path.name}: {row['task']} {row['condition']} seed {row['seed']}: {before} -> {row['scores']['score']}"
                )
        path.write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
        )


if __name__ == "__main__":
    main()
