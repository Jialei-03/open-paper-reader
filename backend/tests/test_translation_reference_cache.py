import copy
import json

import pytest

from backend import translation_engine as engine


def test_only_corrupted_reference_cache_unit_is_retranslated(tmp_path, monkeypatch):
    source = tmp_path / 'source'
    source.mkdir()
    bad = r'The method uses \Cref{appendix-results} for detailed evidence.'
    good = r'The result follows \citep[note][]{valid_key} with stable memory.'
    (source / 'main.tex').write_text(r'\documentclass{article}\begin{document}\section{Method}' + '\n\n' + bad + '\n\n' + good + '\n\n' + r'\end{document}')
    calls = []
    def translate(config, system, content):
        rows = json.loads(content)
        calls.append(rows)
        return json.dumps([{'id': row['id'], 'text': '中文译文' + ''.join(engine.KEEP.findall(row['text']))} for row in rows], ensure_ascii=False)
    monkeypatch.setattr(engine, 'complete', translate)
    original = engine.translate_project(source, tmp_path / 'first', {}, lambda *a: None)
    cache = {unit['id']: copy.deepcopy(unit) for unit in original}
    bad_unit = next(unit for unit in cache.values() if unit['source_tex'] == bad)
    bad_unit['translated_tex'] = bad_unit['translated_tex'].replace('appendix-results', '附录结果')
    good_unit = next(unit for unit in original if unit['source_tex'] == good)
    calls.clear()
    repaired = engine.translate_project(source, tmp_path / 'second', {}, lambda *a: None, cached=cache)
    assert len(calls) == 1
    assert len(calls[0]) == 1
    assert calls[0][0]['id'] == bad_unit['id']
    assert 'appendix-results' not in calls[0][0]['text']
    result_bad = next(unit for unit in repaired if unit['source_tex'] == bad)
    result_good = next(unit for unit in repaired if unit['source_tex'] == good)
    assert r'\Cref{appendix-results}' in result_bad['translated_tex']
    assert result_good['translated_tex'] == good_unit['translated_tex']


@pytest.mark.parametrize('command', ['citep[note][]', 'Cref', 'cref', 'ref', 'autoref', 'eqref', 'label', 'Cref*'])
def test_command_arguments_detect_changed_missing_and_extra_references(command):
    source = '\\' + command + '{key}'
    assert engine.reference_arguments(source) != engine.reference_arguments(source.replace('key', '其他'))
    assert engine.reference_arguments(source) != engine.reference_arguments('')
    assert engine.reference_arguments(source) != engine.reference_arguments(source + source)
    masked, tokens = engine.protect(source)
    assert 'key' not in masked
    assert engine.restore(masked, masked, tokens) == source


def test_reference_movement_is_valid_but_optional_arguments_are_preserved():
    first = r'\Cref{a} \citep[see][]' + '{key}'
    reordered = r'\citep[see][]' + '{key}' + r' \Cref{a}'
    assert engine.reference_arguments(first) == engine.reference_arguments(reordered)
    assert engine.reference_arguments(first) != engine.reference_arguments(first.replace('[see]', '[changed]'))
