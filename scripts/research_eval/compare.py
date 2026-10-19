"""Compares two conditions on one task: mean sprints and tokens, the difference, and a
95% bootstrap interval for it (fixed seed, so the numbers can be reproduced).

    python scripts/research_eval/compare.py --task fresh-fraud-leak \\
        results/a.jsonl results/b.jsonl
"""

import argparse
import json
import random
from pathlib import Path
from statistics import mean


def difference(a, b, draws=10000, seed=0):
    """mean(a) - mean(b), and the 2.5% and 97.5% points of its bootstrap distribution."""
    rng = random.Random(seed)
    samples = sorted(
        mean(rng.choices(a, k=len(a))) - mean(rng.choices(b, k=len(b)))
        for _ in range(draws)
    )
    return (
        mean(a) - mean(b),
        samples[int(0.025 * draws)],
        samples[int(0.975 * draws) - 1],
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", required=True)
    parser.add_argument("paths", nargs="+")
    args = parser.parse_args()
    rows = [
        json.loads(line)
        for p in args.paths
        for line in Path(p).read_text().splitlines()
        if line.strip()
    ]
    rows = [r for r in rows if r["task"] == args.task]
    by = {}
    for r in rows:
        by.setdefault(r["condition"], []).append(r)
    a, b = by["playbook"], by["no-playbook"]
    print(f"{args.task}: playbook n={len(a)}, no-playbook n={len(b)}")
    for key in ("sprints", "tokens"):
        diff, low, high = difference([r[key] for r in a], [r[key] for r in b])
        print(
            f"{key}: playbook {mean(r[key] for r in a):.2f}, "
            f"no-playbook {mean(r[key] for r in b):.2f}, "
            f"difference {diff:.2f} (95% CI {low:.2f} to {high:.2f})"
        )
    right = {
        c: sum(r["scores"]["score"] == 1.0 for r in group) for c, group in by.items()
    }
    print(
        f"full marks: playbook {right['playbook']}/{len(a)}, no-playbook {right['no-playbook']}/{len(b)}"
    )


if __name__ == "__main__":
    main()
