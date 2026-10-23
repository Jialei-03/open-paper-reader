# ruff: noqa: F811
"""File definitions: all tests use temporary app data and no model/network calls."""

import importlib

import pytest
from sqlalchemy import select

from backend import agent_files as files, research_repo as repo
from backend.models import MemberLibrary, ResearchWorkspace, TeamMember
from backend.team_members import MemberConfig, config, description
from backend.tests.test_research_team import world, send, deliveries  # noqa: F401
from backend.tests.test_acceptance import env as cloud_env  # noqa: F401
from backend.tests.test_research_routes import env  # noqa: F401

SOURCE = """---
name: Ada
description: Verify evidence
tools: [files, web]
channels: ["#闲聊"]
budget: {turns: 3, tokens: 5000, minutes: 8, future: 42}
future: # keep this comment
  nested: [one, "two"]
---

# Evidence
Keep every citation.
"""


def add(world, source=SOURCE):
    result = world[1].post(world[7] + "/members", json={"source": source})
    assert result.status_code == 200, result.text
    return result.json()["id"]


def path_of(world, mid):
    app, _, _, settings, *_ = world
    with app.state.maker() as d:
        member = d.get(TeamMember, mid)
        return repo.repo_dir(settings, member.workspace_id) / member.file_path


def test_roundtrip_preserves_unknown_fields_comments_and_body():
    values = files.parse(SOURCE)
    values.update(
        name="Ada II", description="New description", role_description="# Revised\n"
    )
    updated = files.render(values, SOURCE)
    assert 'future: # keep this comment\n  nested: [one, "two"]' in updated
    assert files.split(updated)[0]["budget"]["future"] == 42
    assert files.parse(updated)["role_description"] == "# Revised\n"
    assert files.parse(updated)["wake_minutes"] == 8
    assert files.parse(updated)["tools"] == ["files", "web"]


@pytest.mark.parametrize(
    "source,line",
    [
        ("name: Ada\n", 1),
        ("---\nname: Ada\n", 2),
        ("---\nname: [\n---\n", 3),
        ("---\nname: Ada\ntools: Bash\n---\n", 3),
        ("---\nname: Ada\nname: Bob\n---\n", 3),
        ("---\nname: Ada\nbudget: {turns: true}\n---\n", 3),
        ("---\nname: ../Ada\n---\n", 2),
        ("---\nname: Ada\nenabled: no\n---\n", 3),
    ],
)
def test_format_errors_have_lines(source, line):
    with pytest.raises(files.DefinitionError) as error:
        files.parse(source)
    assert error.value.line == line


def test_external_dirty_and_committed_edits_refresh_pages_wakes_and_permissions(world):
    app, a, _, settings, _, _, wid, base, _ = world
    mid = add(world)
    path = path_of(world, mid)
    source = (
        path.read_text()
        .replace("Verify evidence", "External description")
        .replace("# Evidence", "# External body")
    )
    path.write_text(source)
    detail = a.get(base + f"/members/{mid}").json()
    assert (
        detail["description"] == "External description"
        and "# External body" in detail["role_description"]
    )
    assert detail["source"] == source
    assert detail["subscriptions"]
    # SQL fields are an archive, never a second definition source.
    with app.state.maker() as d:
        member = d.get(TeamMember, mid)
        member.legacy_role_description = "Wrong SQL definition"
        member.legacy_permissions = {
            "papers": True,
            "files": False,
            "commands": True,
            "machines": [],
            "readonly": False,
        }
        d.commit()
    repo.git(path.parents[2], "add", "--", str(path.relative_to(path.parents[2])))
    repo.git(path.parents[2], "commit", "-qm", "external edit")
    (repo.repo_dir(settings, wid) / "AGENTS.md").write_text(
        "# Shared\nEvery member reads this."
    )
    send(world, "@Ada check")
    with app.state.maker() as d:
        from backend.models import AgentRun

        run = d.get(AgentRun, deliveries(app)[0].run_id)
        assert (
            "# External body" in run.context
            and "Every member reads this." in run.context
        )
        member = d.get(TeamMember, mid)
        from backend.team_members import allowed

        assert allowed(member, {"name": "read"})
        assert not allowed(member, {"name": "bash"})
        assert member.wake_turns == 3 and member.wake_tokens == 5000


def test_invalid_external_file_keeps_last_valid_across_sessions_and_repair(world):
    _, a, _, _, _, _, _, base, _ = world
    mid = add(world)
    path = path_of(world, mid)
    path.write_text("---\nname: Ada\ntools: broken\n---\nBAD")
    for _ in range(2):
        detail = a.get(base + f"/members/{mid}").json()
        assert "Line 3" in detail["file_error"]
        assert detail["role_description"].startswith("# Evidence")
        assert "tools: broken" in detail["source"]
    result = a.patch(
        base + f"/members/{mid}",
        json={"source": SOURCE, "revision": detail["revision"]},
    )
    assert result.status_code == 200, result.text
    assert not a.get(base + f"/members/{mid}").json()["file_error"]


def test_save_renames_and_commits_only_agent_with_actor_and_checks_revision(world):
    _, a, _, settings, owner, _, wid, base, _ = world
    mid = add(world)
    detail = a.get(base + f"/members/{mid}").json()
    root = repo.repo_dir(settings, wid)
    (root / "unrelated.txt").write_text("do not commit")
    repo.git(root, "add", "unrelated.txt")
    source = detail["source"].replace("name: Ada", "name: New Ada")
    result = a.patch(
        base + f"/members/{mid}",
        json={"source": source, "revision": detail["revision"]},
    )
    assert result.status_code == 200, result.text
    assert not (root / ".ora/agents/Ada.md").exists()
    assert (root / ".ora/agents/New Ada.md").read_text() == source
    log = repo.git(root, "log", "-1", "--format=%s").stdout
    assert owner in log and "New Ada" in log
    assert (
        "unrelated.txt"
        not in repo.git(root, "show", "--format=", "--name-only", "HEAD").stdout
    )
    assert (
        a.patch(
            base + f"/members/{mid}",
            json={"source": source, "revision": detail["revision"]},
        ).status_code
        == 422
    )


def test_builtin_files_are_copied_and_can_restore(world):
    _, a, _, _, _, _, _, base, overview = world
    for member in overview["members"]:
        if member["role"] == "human":
            continue
        path = path_of(world, member["id"])
        assert path.is_file()
        assert (
            files.parse(path.read_text())["role_description"]
            == files.parse((files.BUILTINS / (member["role"] + ".md")).read_text())[
                "role_description"
            ]
        )
    builtin = next(m for m in overview["members"] if m["role"] == "librarian")
    mid = builtin["id"]
    assert a.patch(base + f"/members/{mid}", json={"source": SOURCE}).status_code == 200
    assert (
        a.patch(base + f"/members/{mid}", json={"restore_builtin": True}).status_code
        == 200
    )
    assert a.get(base + f"/members/{mid}").json()["name"] == "文献员"


def test_external_library_and_team_files_are_discovered(world):
    app, a, _, settings, owner, _, wid, base, _ = world
    library = files.library_root(settings, owner)
    library.mkdir(parents=True, exist_ok=True)
    (library / "Ada.md").write_text(SOURCE)
    rows = a.get(base + "/library").json()
    assert len(rows) == 1 and rows[0]["config"]["name"] == "Ada"
    result = a.post(base + "/members", json={"library_id": rows[0]["id"]})
    assert result.status_code == 200, result.text
    path = repo.repo_dir(settings, wid) / ".ora/agents/Bob.md"
    path.write_text(SOURCE.replace("name: Ada", "name: Bob"))
    members = a.get(base).json()["members"]
    bob = next(m for m in members if m["name"] == "Bob")
    assert not bob["builtin"]
    assert a.delete(base + f"/members/{bob['id']}").status_code == 200
    assert not any(
        m["id"] == bob["id"] and not m["deleted"] for m in a.get(base).json()["members"]
    )


def test_library_sync_keeps_external_team_overrides_and_unknown_fields(world):
    _, a, _, settings, owner, _, _, base, _ = world
    mid = add(world)
    row = a.get(base + "/library").json()[0]
    path = path_of(world, mid)
    path.write_text(
        path.read_text()
        .replace("Keep every citation.", "Team owns this body.")
        .replace("[one,", "[team,")
    )
    source = (
        row["source"]
        .replace("Verify evidence", "From library")
        .replace("turns: 3", "turns: 7")
    )
    result = a.patch(
        base + f"/library/{row['id']}",
        json={
            "source": source,
            "version": row["version"],
            "revision": row["revision"],
            "sync": True,
        },
    )
    assert result.status_code == 200, result.text
    detail = a.get(base + f"/members/{mid}").json()
    assert detail["description"] == "From library" and detail["wake_turns"] == 7
    assert (
        "Team owns this body." in detail["role_description"]
        and "[team," in detail["source"]
    )
    assert (
        files.parse((files.library_root(settings, owner) / "Ada.md").read_text())[
            "description"
        ]
        == "From library"
    )


@pytest.mark.parametrize(
    "filename,source",
    [
        (
            "checker.md",
            "---\nname: Checker\ndescription: Check\ntools: Read, Grep, Glob, Bash, WebFetch, FutureTool\nfuture: true\n---\n\nCheck it.",
        ),
        (
            "checker.toml",
            'description = "Check"\ndeveloper_instructions = "Check it."\nfuture = { value = 42 }\n',
        ),
    ],
)
def test_import_both_formats_and_api(world, filename, source):
    _, a, _, _, _, _, _, base, _ = world
    result = a.post(
        base + "/import-agent", json={"source": source, "filename": filename}
    )
    assert result.status_code == 200, result.text
    document = result.json()
    assert document["config"]["role_description"] == "Check it."
    assert "future" in document["source"]
    if filename.endswith(".md"):
        assert document["config"]["tools"] == ["files", "shell", "web", "FutureTool"]
        assert document["config"]["permissions"]["file_readonly"]
        assert not document["config"]["permissions"]["readonly"]
        assert document["warnings"] == ["未知工具 / Unknown tool: FutureTool"]
    mid = add(world, document["source"])
    assert a.get(base + f"/members/{mid}").json()["role_description"] == "Check it."


def test_form_source_conversion_retains_unknown_fields(world):
    _, a, _, _, _, _, _, base, _ = world
    parsed = a.post(base + "/agent-document", json={"source": SOURCE}).json()
    values = {k: parsed["config"][k] for k in MemberConfig.model_fields}
    values.update(description="Form edit", role_description="# New body")
    result = a.post(
        base + "/agent-document",
        json={"source": SOURCE, "config": values, "channels": ["#综述"]},
    )
    assert result.status_code == 200, result.text
    updated = result.json()
    assert "# keep this comment" in updated["source"]
    assert updated["config"]["channels"] == ["#综述"]
    assert updated["config"]["description"] == "Form edit"
    assert a.post(base + "/agent-document", json={"source": "bad"}).status_code == 422


def test_project_md_is_renamed_unchanged_once_and_shared_by_all_members(world):
    app, _, _, settings, _, _, wid, _, overview = world
    root = repo.repo_dir(settings, wid)
    (root / "AGENTS.md").unlink()
    content = b"# Legacy\r\nExact legacy instructions.\r\n"
    (root / "PROJECT.md").write_bytes(content)
    repo.git(root, "add", "-A")
    repo.git(root, "commit", "-qm", "legacy instructions")
    with app.state.maker() as d:
        workspace = d.get(ResearchWorkspace, wid)
        repo.ensure_repo(settings, workspace)
        once = repo.head(root)
        repo.ensure_repo(settings, workspace)
        assert repo.head(root) == once
        assert not (root / "PROJECT.md").exists()
        assert (root / "AGENTS.md").read_bytes() == content
        for member in d.scalars(
            select(TeamMember).where(
                TeamMember.workspace_id == wid, TeamMember.role != "human"
            )
        ):
            assert "Exact legacy instructions." in description(member)


def test_migration_exports_legacy_library_team_overrides_and_is_idempotent(world):
    app, _, _, settings, owner, _, wid, _, _ = world
    with app.state.maker() as d:
        library = MemberLibrary(
            owner=owner,
            config=MemberConfig(
                name="Legacy", role_description="Original body"
            ).model_dump(),
        )
        d.add(library)
        d.flush()
        member = TeamMember(
            workspace_id=wid,
            role="custom_legacy",
            name="Legacy",
            role_description="Team body",
            library_id=library.id,
            permissions={
                "papers": False,
                "files": True,
                "commands": False,
                "machines": ["host"],
                "readonly": True,
            },
            wake_turns=4,
            wake_tokens=6000,
            enabled=False,
        )
        d.add(member)
        d.flush()
        files.export_all(d)
        path = repo.repo_dir(settings, wid) / member.file_path
        assert files.parse(path.read_text())["role_description"] == "Team body"
        assert not member.enabled and member.wake_tokens == 6000
        assert config(member)["permissions"]["readonly"]
        assert "role_description" in member.overrides
        assert files.read_library(library)[1]["role_description"] == "Original body"
        before = repo.head(path.parents[2])
        files.export_all(d)
        assert repo.head(path.parents[2]) == before
        assert member.legacy_role_description == "Team body"
        d.commit()
    migration = importlib.import_module("backend.migrations.versions.0047_agent_files")
    assert migration.down_revision == "0046"


def test_symlinks_cannot_read_or_write_outside_agent_roots(world, tmp_path):
    _, a, _, _, _, _, _, base, _ = world
    mid = add(world)
    path = path_of(world, mid)
    external = tmp_path / "private.md"
    external.write_text(SOURCE.replace("# Evidence", "# Private"))
    path.unlink()
    path.symlink_to(external)
    detail = a.get(base + f"/members/{mid}").json()
    assert "# Private" not in detail["role_description"]
    assert detail["file_error"]
    assert a.patch(base + f"/members/{mid}", json={"source": SOURCE}).status_code == 422
    assert "# Private" in external.read_text()


def test_0047_schema_upgrade_exports_on_selected_data_directory_and_downgrades(
    tmp_path,
):
    import sqlalchemy as sa
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from backend.config import Settings, database
    from backend.models import Base, User

    settings = Settings(
        storage=str(tmp_path / "files"),
        database_url="sqlite:///" + str(tmp_path / "migration.db"),
        mode="local",
    )
    engine, maker = database(settings)
    Base.metadata.create_all(engine)
    with maker(info={}) as d:
        owner = User(username="migration", password="unused")
        d.add(owner)
        d.flush()
        workspace = ResearchWorkspace(owner=owner.id, name="Legacy project")
        d.add(workspace)
        d.flush()
        library = MemberLibrary(
            owner=owner.id,
            config=MemberConfig(
                name="Imported", role_description="Library archive"
            ).model_dump(),
        )
        d.add(library)
        d.flush()
        member = TeamMember(
            workspace_id=workspace.id,
            role="custom_old",
            name="Imported",
            role_description="Team archive",
            library_id=library.id,
        )
        d.add(member)
        d.flush()
        mid, lid, wid = member.id, library.id, workspace.id
        d.commit()
    migration = importlib.import_module("backend.migrations.versions.0047_agent_files")
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        connection.commit()
        with connection.begin():
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()
        connection.info["ora_settings"] = settings
        with connection.begin():
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                migration.upgrade()
            team_path = connection.execute(
                sa.text("SELECT file_path FROM team_members WHERE id=:id"), {"id": mid}
            ).scalar_one()
            library_path = connection.execute(
                sa.text("SELECT file_path FROM member_library WHERE id=:id"),
                {"id": lid},
            ).scalar_one()
            assert team_path and library_path
        assert (
            files.parse((repo.repo_dir(settings, wid) / team_path).read_text())[
                "role_description"
            ]
            == "Team archive"
        )
        assert (
            files.parse((tmp_path / "agents" / library_path).read_text())[
                "role_description"
            ]
            == "Library archive"
        )
        with connection.begin():
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()
        assert "file_path" not in {
            c["name"] for c in sa.inspect(connection).get_columns("team_members")
        }
        assert (repo.repo_dir(settings, wid) / team_path).exists()
    engine.dispose()


def test_shared_instruction_editor_writes_file_and_external_changes_reach_briefs(world):
    app, a, _, settings, _, _, wid, base, overview = world
    result = a.patch(
        f"/api/v1/research/workspaces/{wid}",
        json={"instructions": "Team instructions from editor"},
    )
    assert result.status_code == 200, result.text
    root = repo.repo_dir(settings, wid)
    assert (root / "AGENTS.md").read_text() == "Team instructions from editor"
    (root / "AGENTS.md").write_text("External team instructions")
    assert (
        a.get(f"/api/v1/research/workspaces/{wid}").json()["instructions"]
        == "External team instructions"
    )
    from backend.research_chat import overview as brief

    with app.state.maker() as d:
        workspace = d.get(ResearchWorkspace, wid)
        text = brief(d, workspace)
        assert "External team instructions" in text
        assert "Team instructions from editor" not in text
        for member in d.scalars(
            select(TeamMember).where(
                TeamMember.workspace_id == wid, TeamMember.role != "human"
            )
        ):
            assert "External team instructions" in description(member)


def test_source_is_authoritative_even_when_legacy_client_sends_subscription_ids(world):
    _, a, _, _, _, _, _, base, _ = world
    source = SOURCE.replace('["#闲聊"]', '["#Future channel"]')
    mid = add(world, source)
    result = a.patch(
        base + f"/members/{mid}", json={"source": source, "subscriptions": []}
    )
    assert result.status_code == 200, result.text
    assert "#Future channel" in a.get(base + f"/members/{mid}").json()["source"]


def test_cumulative_budget_is_read_from_file_and_legacy_budget_is_archived(world):
    app, a, _, _, _, _, _, base, _ = world
    mid = add(world)
    path = path_of(world, mid)
    values = files.parse(path.read_text())
    values["max_tokens"] = 12345
    path.write_text(files.render(values, path.read_text()))
    with app.state.maker() as d:
        member = d.get(TeamMember, mid)
        member.legacy_max_tokens = 99999
        d.commit()
        assert member.max_tokens == 12345
        assert member.wake_minutes == 8
    assert a.get(base + f"/members/{mid}").json()["max_tokens"] == 12345


def test_file_model_name_resolves_to_configured_model_without_model_call(world):
    app, a, _, settings, owner, model_id, _, base, _ = world
    from backend.translation_settings import read_store
    from backend.models import AgentRun

    model = next(
        row for row in read_store(settings, owner)["models"] if row["id"] == model_id
    )["model"]
    mid = add(world, SOURCE.replace("name: Ada", f"name: Ada\nmodel: {model}"))
    send(world, "@Ada use configured model")
    with app.state.maker() as d:
        member = d.get(TeamMember, mid)
        assert member.model_config_id == model_id
        assert d.get(AgentRun, deliveries(app)[0].run_id).model_config_id == model_id


def test_new_definitions_are_not_copied_back_into_legacy_database_fields(world):
    app, _, _, _, _, _, _, _, _ = world
    mid = add(world)
    with app.state.maker() as d:
        member = d.get(TeamMember, mid)
        library = d.get(MemberLibrary, member.library_id)
        assert library.legacy_config == {}
        assert member.legacy_role_description == ""
        assert member.legacy_permissions == {}
        assert files.read_member(member)[1]["role_description"].startswith("# Evidence")


def test_editor_can_rename_an_external_untracked_member_file(world):
    _, a, _, settings, _, _, wid, base, _ = world
    root = repo.repo_dir(settings, wid)
    path = root / ".ora/agents/External.md"
    path.write_text(SOURCE.replace("name: Ada", "name: External"))
    member = next(m for m in a.get(base).json()["members"] if m["name"] == "External")
    result = a.patch(
        base + f"/members/{member['id']}",
        json={"source": path.read_text().replace("name: External", "name: Renamed")},
    )
    assert result.status_code == 200, result.text
    assert not path.exists()
    assert (root / ".ora/agents/Renamed.md").exists()
    assert (
        ".ora/agents/Renamed.md"
        in repo.git(root, "show", "--format=", "--name-only", "HEAD").stdout
    )


def test_source_editor_uses_the_members_role_when_tools_are_omitted(world):
    _, a, _, _, _, _, _, base, _ = world
    source = "---\nname: Executor\n---\n\nRun experiments."
    result = a.post(
        base + "/agent-document", json={"source": source, "role": "executor"}
    )
    assert result.status_code == 200, result.text
    assert "shell" in result.json()["config"]["tools"]
    assert result.json()["config"]["permissions"]["commands"]
    fields = {k: result.json()["config"][k] for k in MemberConfig.model_fields}
    converted = a.post(
        base + "/agent-document",
        json={"source": source, "role": "executor", "config": fields},
    )
    assert converted.status_code == 200, converted.text
    assert "shell" in converted.json()["config"]["tools"]


def test_wake_token_cap_is_optional():
    plain = files.parse("---\nname: Ada\n---\n\nHi")
    assert plain["wake_tokens"] == 0
    source = files.render({**plain, "wake_tokens": 50000}, "---\nname: Ada\n---\n\nHi")
    assert files.parse(source)["wake_tokens"] == 50000
    cleared = files.render({**plain, "wake_tokens": 0}, source)
    assert "tokens:" not in cleared.replace("total_tokens:", "")
    assert files.parse(cleared)["wake_tokens"] == 0
