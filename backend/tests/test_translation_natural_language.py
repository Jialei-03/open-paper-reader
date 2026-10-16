import pytest

from backend import translation_engine as engine


@pytest.mark.parametrize('masked', ['__PW_KEEP_0____PW_KEEP_1__', '123 __PW_KEEP_0__ + 42'])
def test_pure_markup_and_numbers_do_not_need_chinese(masked):
    assert not engine.unit_needs_chinese({'masked': masked, 'source_tex': r'\section{\BENCHMARK}'})


def test_only_confirmed_identifier_heading_can_keep_english():
    heading = {'masked': '__PW_KEEP_0__MemOperator__PW_KEEP_1__', 'source_tex': r'\subsubsection{MemOperator}'}
    assert not engine.unit_needs_chinese(heading, {'MemOperator'})
    assert engine.unit_needs_chinese(heading)
    assert engine.unit_needs_chinese({**heading, 'source_tex': 'MemOperator performs the memory operations.'}, {'MemOperator'})
    assert engine.unit_needs_chinese({'masked': '__PW_KEEP_0__Introduction__PW_KEEP_1__', 'source_tex': r'\section{Introduction}'}, {'Introduction'})


def test_no_model_requests_for_pure_macro_and_established_name_headings(tmp_path, monkeypatch):
    source = tmp_path / 'source'
    source.mkdir()
    (source / 'main.tex').write_text(r'\documentclass{article}\newcommand{\BENCHMARK}{LongMemEval}\begin{document}' + '\n' + r'\section{\BENCHMARK}' + '\n\n' + r'\subsection{MemOperator}' + '\n\n' + r'\subsection{MemOperator}' + '\n\n' + r'\end{document}')
    def never(*args):
        raise AssertionError('Structural and identifier units must not call a model')
    monkeypatch.setattr(engine, 'complete', never)
    units = engine.translate_project(source, tmp_path / 'translated', {}, lambda *a: None)
    assert len(units) == 3
    assert all(u['source_tex'] == u['translated_tex'] for u in units)


def test_cross_references_and_double_optional_citations_are_atomic():
    source = r'Compare \Cref{appendix-evaluation-metric}, \cref{other}, \autoref{third} and \citep[note][]{key_one,key_two}.'
    masked, tokens = engine.protect(source)
    assert 'appendix-evaluation-metric' not in masked
    assert 'key_one' not in masked
    assert engine.restore(masked, masked, tokens) == source
