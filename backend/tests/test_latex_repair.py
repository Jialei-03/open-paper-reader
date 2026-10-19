import json

import pytest

from backend import latex_repair


def project(tmp_path):
    main = tmp_path / "main.tex"
    main.write_text(
        "\\documentclass{article}\n\\usepackage{broken}\n\\begin{document}\n正文 \\badmacro\n\\end{document}\n"
    )
    (tmp_path / "compile.log").write_text(
        "./main.tex:4: Undefined control sequence.\nl.4 正文 \\badmacro\n"
    )
    return main


def answers(*edits):
    replies = iter(json.dumps({"edits": e}) for e in edits)
    return lambda config, system, content, **kw: next(replies)


def test_a_model_fix_that_compiles_is_used(tmp_path, monkeypatch):
    main = project(tmp_path)
    calls = []

    def compile_(directory, **kwargs):
        calls.append(main.read_text())
        if "\\badmacro" in main.read_text():
            raise ValueError("中文 PDF 编译失败：Undefined control sequence.")
        return directory / "main.pdf"

    monkeypatch.setattr(latex_repair, "compile_project", compile_)
    seen = []

    def complete(config, system, content, **kw):
        seen.append(content)
        return json.dumps({"edits": [{"file": "main.tex", "find": "\\badmacro", "replace": ""}]})

    monkeypatch.setattr(latex_repair, "complete", complete)
    rounds = []
    result = latex_repair.compile_with_repair(tmp_path, {"api_key": "k"}, progress=rounds.append)
    assert result.name == "main.pdf"
    assert rounds == [1] and len(calls) == 2
    # The model saw the error and the numbered lines around it.
    assert "Undefined control sequence" in seen[0] and "    4| 正文 \\badmacro" in seen[0]


def test_unsafe_or_ambiguous_edits_are_not_made(tmp_path):
    main = project(tmp_path)
    (tmp_path / "other.txt").write_text("x")
    edits = [
        {"file": "../outside.tex", "find": "a", "replace": "b"},
        {"file": "other.txt", "find": "x", "replace": "y"},
        {"file": "main.tex", "find": "\\badmacro", "replace": "\\immediate\\write18{rm -rf ~}"},
        {"file": "main.tex", "find": "\\", "replace": "/"},
    ]
    assert latex_repair.apply_edits(tmp_path, edits) == 0
    assert "\\badmacro" in main.read_text()
    assert (tmp_path / "other.txt").read_text() == "x"


def test_without_a_model_the_first_error_stands(tmp_path, monkeypatch):
    project(tmp_path)

    def fail(directory, **kwargs):
        raise ValueError("中文 PDF 编译失败：Undefined control sequence.")

    monkeypatch.setattr(latex_repair, "compile_project", fail)
    with pytest.raises(ValueError, match="^中文 PDF 编译失败：Undefined control sequence.$"):
        latex_repair.compile_with_repair(tmp_path, {})


def test_when_no_round_compiles_the_first_error_is_reported_with_the_attempts(tmp_path, monkeypatch):
    project(tmp_path)

    def fail(directory, **kwargs):
        raise ValueError("中文 PDF 编译失败：Undefined control sequence.")

    monkeypatch.setattr(latex_repair, "compile_project", fail)
    monkeypatch.setattr(
        latex_repair,
        "complete",
        answers(*[[{"file": "main.tex", "find": "正文", "replace": f"正文{i}"}] for i in range(3)]),
    )
    with pytest.raises(ValueError, match="Undefined control sequence.*已尝试由 AI 自动修复 3 次"):
        latex_repair.compile_with_repair(tmp_path, {"api_key": "k"})


def test_an_error_inside_a_system_package_shows_the_preamble(tmp_path):
    main = project(tmp_path)
    (tmp_path / "compile.log").write_text(
        "/usr/share/texlive/texmf-dist/tex/generic/pgf/systemlayer/pgfsys-pdftex.def:385: Undefined control sequence.\n"
    )
    summary, path, excerpt = latex_repair.repair_context(tmp_path, main)
    assert "pgfsys-pdftex.def:385: Undefined control sequence." in summary
    assert path == main and "\\usepackage{broken}" in excerpt
