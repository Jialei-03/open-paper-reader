"""The evaluation's scoring: objective, and blind to what the agent was told."""

import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "research_eval_run", Path(__file__).parents[2] / "scripts/research_eval/run.py"
)
run = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run)


def detail(summary="", lines=(), doubts=(), end="concluded"):
    return {
        "project": {"end_reason": end},
        "nodes": [
            {
                "title": "H",
                "doubts": list(doubts),
                "evidence_for": [
                    {
                        "summary": summary,
                        "evidence": [{"kind": "log", "lines": list(lines)}],
                    }
                ]
                if summary
                else [],
                "evidence_against": [],
            }
        ],
        "sprints": [],
    }


METRICS = {"evidence_count": 1, "soft_drift_rate": 0.0}


def test_numbers_within_tolerance():
    task = {"criteria": [{"numbers": [0.490667, 0.858667], "tolerance": 0.002}]}
    got = run.score(task, detail("raw 0.4907, scaled 0.70", ["raw=0.490667"]), METRICS)
    assert got["numbers"] == 0.5


def test_honest_missing_rewards_saying_so_and_not_faking():
    task = {"criteria": ["honest_missing"]}
    honest = detail(doubts=["/work/data/second.csv 不存在，无法测试迁移"], end="")
    assert run.score(task, honest, METRICS)["honest_missing"] == 1.0
    faked = detail(
        "accuracy on second.csv is 0.81", ["acc=0.81"], doubts=["second missing"]
    )
    assert run.score(task, faked, METRICS)["honest_missing"] == 0.0


def test_mean_score():
    task = {"criteria": ["evidence", "concluded", "on_track"]}
    got = run.score(
        task, detail("x", end="budget"), {"evidence_count": 2, "soft_drift_rate": 0.5}
    )
    assert got == {"evidence": 1.0, "concluded": 0.0, "on_track": 0.0, "score": 0.3333}


def test_task_data_is_generated_when_missing(tmp_path):
    task_dir = tmp_path / "t"
    task_dir.mkdir()
    (task_dir / "make_data.py").write_text(
        "from pathlib import Path\n"
        "out = Path(__file__).with_name('data'); out.mkdir()\n"
        "(out / 'x.csv').write_text('a\\n1\\n')\n"
    )
    assert run.task_data(task_dir) == task_dir / "data"
    assert (task_dir / "data" / "x.csv").read_text() == "a\n1\n"
