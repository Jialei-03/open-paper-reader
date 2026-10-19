"""Summarizes evaluation results as a Markdown table: one row per task and condition.

python scripts/research_eval/report.py scripts/research_eval/results/*.jsonl
"""

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean


def main(paths):
    rows = [
        json.loads(line)
        for p in paths
        for line in Path(p).read_text().splitlines()
        if line.strip()
    ]
    groups = defaultdict(list)
    for row in rows:
        groups[(row["task"], row["condition"])].append(row)
    print(
        "| task | condition | runs | score | ended | drift | evidence | sprints | tokens |"
    )
    print("|---|---|---|---|---|---|---|---|---|")
    for (task, condition), group in sorted(groups.items()):
        drift = [
            r["metrics"]["soft_drift_rate"]
            for r in group
            if r["metrics"]["soft_drift_rate"] is not None
        ]
        cells = [
            task,
            condition,
            str(len(group)),
            f"{mean(r['scores']['score'] for r in group):.2f}",
            ", ".join(
                f"{reason} {n}"
                for reason, n in sorted(Counter(r["end_reason"] for r in group).items())
            ),
            f"{mean(drift):.2f}" if drift else "—",
            f"{mean(r['metrics']['evidence_count'] for r in group):.1f}",
            f"{mean(r['sprints'] for r in group):.1f}",
            f"{mean(r['tokens'] for r in group):.0f}",
        ]
        print("| " + " | ".join(cells) + " |")


if __name__ == "__main__":
    main(sys.argv[1:])
