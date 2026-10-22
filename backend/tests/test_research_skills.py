import pytest
from fastapi.testclient import TestClient

from backend import research_skills
from backend.tests.test_acceptance import env  # noqa: F401

BASE = "/api/v1/research/roles"


@pytest.fixture
def skills(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_RUNTIME_DIR", str(tmp_path))
    root = tmp_path / "skills"
    role = root / "research-executor"
    role.mkdir(parents=True)
    body = "# 执行者\n\n## 工作\n\n- 读取计划\n- **完成研究**\n"
    (role / "SKILL.md").write_text(body, encoding="utf-8")
    other = root / "paper-workspace"
    other.mkdir()
    (other / "SKILL.md").write_text("# Other", encoding="utf-8")
    return root, body


def test_lists_and_reads_roles_without_writing(env, skills):  # noqa: F811
    _app, client, _other, settings = env
    settings.mode = "local"
    root, body = skills
    before = {
        p: (p.read_bytes(), p.stat().st_mtime_ns) for p in root.rglob("SKILL.md")
    }
    response = client.get(BASE)
    assert response.status_code == 200
    assert response.json() == [{"id": "research-executor", "title": "执行者"}]
    response = client.get(f"{BASE}/research-executor")
    assert response.status_code == 200
    assert response.json() == {"id": "research-executor", "title": "执行者", "body": body}
    assert (
        client.put(f"{BASE}/research-executor", json={"body": "changed"}).status_code
        == 405
    )
    assert before == {
        p: (p.read_bytes(), p.stat().st_mtime_ns) for p in root.rglob("SKILL.md")
    }


def test_roles_require_authenticated_local_access(env, skills):  # noqa: F811
    app, client, _other, settings = env
    for path in [BASE, f"{BASE}/research-executor"]:
        assert client.get(path).status_code == 403
        settings.mode = "local"
        with TestClient(app) as guest:
            assert guest.get(path).status_code == 401
        settings.mode = "cloud"


def test_unknown_unsafe_and_symlink_roles_are_unavailable(
    env, skills, tmp_path
):  # noqa: F811
    _app, client, _other, settings = env
    settings.mode = "local"
    root, _body = skills
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "SKILL.md").write_text("private", encoding="utf-8")
    (root / "research-linked").symlink_to(outside, target_is_directory=True)
    role = root / "research-file-link"
    role.mkdir()
    (role / "SKILL.md").symlink_to(outside / "SKILL.md")
    for role_id in [
        "research-unknown", "paper-workspace", "research-linked", "research-file-link"
    ]:
        assert client.get(f"{BASE}/{role_id}").status_code == 404
    for role_id in [
        "../outside", "/tmp/research-executor", "research-executor/../../outside",
        "research-executor%2f..",
    ]:
        with pytest.raises(FileNotFoundError):
            research_skills.read_role(role_id)
    assert len(client.get(BASE).json()) == 1


def test_bundled_research_roles(monkeypatch):
    monkeypatch.delenv("AGENT_RUNTIME_DIR", raising=False)
    roles = research_skills.list_roles()
    assert {r["id"] for r in roles} >= {
        "research-scoping",
        "research-executor",
        "research-advisor",
        "research-distiller",
        "research-chat",
        "research-lead",
        "research-discussion",
    }
    assert all(research_skills.read_role(r["id"])["body"] for r in roles)
