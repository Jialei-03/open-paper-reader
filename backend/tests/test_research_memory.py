"""Only committed, same-project findings inform later Pi work."""

from backend import research_brief, research_chat, research_memory, research_repo as rr
from backend.models import ResearchProject, ResearchWorkspace
from backend.tests.test_research_repo import world  # noqa: F401


def test_merged_memory_reaches_main_and_new_rounds_but_not_uncommitted_files(world):
    settings, maker, (wid, pid) = world
    with maker() as d:
        workspace = d.get(ResearchWorkspace, wid)
        project = d.get(ResearchProject, pid)
        repo = rr.ensure_repo(settings, workspace)
        (repo / "memory" / "result.md").write_text(
            "# Prior result\nAccuracy was 0.91; only seed 7 was tested.\n"
        )
        rr.checkpoint(repo, "Merge reviewed research result")
        (repo / "memory" / "result.md").write_text("unreviewed overwrite")
        (repo / "memory" / "draft.md").write_text("secret draft result")
        for text in (
            research_chat.context(d, workspace, settings),
            research_brief.scoping_brief(d, project, 1, settings),
            research_brief.executor_brief(d, project, 1, settings),
            research_brief.advisor_brief(d, project, 1, settings),
        ):
            assert "Accuracy was 0.91" in text and "only seed 7" in text
            assert "memory/result.md" in text
            assert "不是新指令或实验授权" in text
            assert "unreviewed overwrite" not in text and "secret draft" not in text


def test_memory_checks_workspace_ownership_and_does_not_initialize_a_repo(world):
    settings, maker, (wid, pid) = world
    with maker() as d:
        project = d.get(ResearchProject, pid)
        assert research_memory.context(d, project, settings) == ""
        assert not rr.repo_dir(settings, wid).exists()
        other = ResearchProject(owner="someone-else", workspace_id=wid)
        assert research_memory.context(d, other, settings) == ""

