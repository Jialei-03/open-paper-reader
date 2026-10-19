"""Copies a task's data into a research project's workspace.

    python scripts/research_eval/seed_task.py <data-dir> <project-id> <task-name>

<data-dir> is the local edition's data directory (the one given to --data).
"""

import shutil
import sys
from pathlib import Path


def main():
    data_dir, project_id, task = sys.argv[1:4]
    source = Path(__file__).parent / "tasks" / task / "data"
    if not source.is_dir():
        raise SystemExit(f"no data for task {task}: run its make_data.py first")
    target = Path(data_dir) / "research" / project_id / "work" / "data"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, target, dirs_exist_ok=True)
    print(f"copied {source} -> {target}")


if __name__ == "__main__":
    main()
