"""The research report: what was asked, what was found and from which evidence, what was dropped."""

from backend import research_map as rm
from backend.research_report import report
from backend.tests.test_research_map import db as db  # noqa: PLC0414


def finished_project(d, owner):
    project = rm.create_project(d, owner, "Do polynomial features help?", "", "model-1")
    root = rm.root(d, project)
    hypothesis = rm.add_node(
        d,
        project,
        root.id,
        "hypothesis",
        "Degree-2 features add 2 points",
        kill_if="poly accuracy is not 0.02 above raw",
        actor="executor",
    )
    hypothesis.evidence_against = [
        {
            "summary": "raw 0.785, poly 0.76",
            "evidence": [
                {
                    "kind": "log",
                    "job_id": "0f641906-aaaa-bbbb-cccc-000000000000",
                    "from_line": 3,
                    "to_line": 4,
                    "lines": ["raw=0.785", "poly=0.76"],
                }
            ],
            "kill_triggered": "yes",
        }
    ]
    rm.update_node(
        d, hypothesis, status="refuted", actor="executor", reason="kill_if met"
    )
    rm.event(
        d,
        project,
        hypothesis,
        "advisor",
        "advice",
        {"verdict": "kill", "reason": "poly is 2.5 points lower"},
    )
    rm.event(
        d,
        project,
        None,
        "advisor",
        "concluded",
        {"status": "refuted", "summary": "No: polynomial features lower accuracy."},
    )
    project.status, project.end_reason = "finished", "refuted"
    project.spent = {"sprints": 4, "tokens": 33898}
    d.flush()
    return project


def test_report_states_the_answer_and_its_evidence(db):
    d, owner = db
    text = report(d, finished_project(d, owner), "en")
    assert text.startswith("# Do polynomial features help?\n")
    assert "No: polynomial features lower accuracy." in text
    assert "raw 0.785, poly 0.76" in text
    # Each result names the log it came from, so a reader can check it.
    assert "job 0f641906, lines 3–4" in text
    assert "raw=0.785" in text


def test_report_lists_dropped_directions_with_their_kill_condition(db):
    d, owner = db
    text = report(d, finished_project(d, owner), "en")
    dropped = text.split("## Dropped")[1]
    assert "Degree-2 features add 2 points" in dropped
    assert "poly accuracy is not 0.02 above raw" in dropped
    assert "poly is 2.5 points lower" in text


def test_report_headings_follow_the_language(db):
    d, owner = db
    text = report(d, finished_project(d, owner), "zh")
    assert "## 结论" in text and "## 证据" in text and "## 放弃的方向" in text
    assert "4 轮" in text
    assert "*假设，已否定*" in text


def test_unfinished_project_says_so(db):
    d, owner = db
    project = rm.create_project(d, owner, "Open question?", "", "model-1")
    text = report(d, project, "en")
    assert "Not finished yet" in text
