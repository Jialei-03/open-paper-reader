"""Scores finished runs again with the current criteria, from the projects' records.

    python scripts/research_eval/rescore.py --base http://127.0.0.1:8765 scripts/research_eval/results/*.jsonl

Rewrites each file in place; the projects must still exist. With several --base, each
project is looked up on each service in turn (runs split across two data folders).
"""

import argparse
import json
import urllib.error
from pathlib import Path

from run import HERE, Client, score


def find(clients, project_id):
    for client in clients:
        try:
            return client.get(f"/api/v1/research/projects/{project_id}")
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
    raise SystemExit(f"project {project_id} is on none of the services")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", action="append")
    parser.add_argument("paths", nargs="+")
    args = parser.parse_args()
    clients = [Client(base) for base in args.base or ["http://127.0.0.1:8765"]]
    for path in map(Path, args.paths):
        rows = [
            json.loads(line) for line in path.read_text().splitlines() if line.strip()
        ]
        for row in rows:
            task = json.loads((HERE / "tasks" / row["task"] / "task.json").read_text())
            detail = find(clients, row["project"])
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
