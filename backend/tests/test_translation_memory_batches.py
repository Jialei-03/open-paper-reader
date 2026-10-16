import json
import re
import pytest
from sqlalchemy import select
from backend.models import File
from backend.translation_memory import SentenceMemory, TranslationUnitError
from backend.tests.test_acceptance import env, paper, attach
from backend.tests.test_agents import pdf_bytes


def memory(env):
    app, client, _, settings = env
    p = paper(client)
    f = attach(client, p, 'source.pdf', pdf_bytes())
    with app.state.maker() as d:
        owner = d.get(File, f['id']).owner
    return SentenceMemory(settings, app.state.maker, owner, f['sha256'],
                          {'model': 'fixture', 'base_url': 'https://api.openai.com/v1'})


def answer(units):
    return json.dumps({'sentences': [{'id': u['id'], 'translation': '已翻译：' + u['original'],
                                     'kind': 'text'} for u in units]})


def decode(content):
    return json.loads(content.split('\nPrevious result failed:', 1)[0])


def test_invalid_large_json_splits_and_retains_reusable_subgroups(env, monkeypatch):
    m = memory(env)
    calls = []
    def complete(config, system, content, **kwargs):
        units = decode(content); calls.append([u['original'] for u in units])
        return '{broken' if len(units) > 2 else answer(units)
    monkeypatch.setattr('backend.translation_memory.complete', complete)
    originals = ['Sentence one.', 'Sentence two.', 'Sentence three.', 'Sentence four.']
    result = m.translate(originals)
    assert [r['original'] for r in result] == originals
    assert list(map(len, calls)) == [4, 4, 2, 2]
    assert m.translate(originals) == result and len(calls) == 4


def test_one_nonchinese_unit_does_not_discard_valid_units(env, monkeypatch):
    m = memory(env)
    calls = []
    bad = 'This original prose has more than eight ordinary English words.'
    originals = ['Good first sentence.', bad, 'Good last sentence.']
    def complete(config, system, content, **kwargs):
        units = decode(content); calls.append([u['original'] for u in units])
        rows = json.loads(answer(units))
        for row, unit in zip(rows['sentences'], units):
            if unit['original'] == bad: row['translation'] = bad
        return json.dumps(rows)
    monkeypatch.setattr('backend.translation_memory.complete', complete)
    with pytest.raises(TranslationUnitError, match='中文'):
        m.translate(originals)
    assert m.lookup([originals[0], originals[2]]) is not None
    assert m.lookup([bad]) is None
    calls.clear()
    monkeypatch.setattr('backend.translation_memory.complete',
                        lambda cfg, system, content, **kwargs: (calls.append(decode(content)), answer(decode(content)))[1])
    m.translate(originals)
    assert len(calls) == 1 and [u['original'] for u in calls[0]] == [bad]


def test_ambiguous_duplicate_id_is_not_checkpointed(env, monkeypatch):
    m = memory(env)
    seen = []
    def complete(config, system, content, **kwargs):
        units = decode(content); seen.append(units)
        rows = json.loads(answer(units))
        if len(units) == 2:
            rows['sentences'].append({'id': 0, 'translation': '冲突译文', 'kind': 'text'})
        return json.dumps(rows)
    monkeypatch.setattr('backend.translation_memory.complete', complete)
    result = m.translate(['First sentence.', 'Second sentence.'])
    assert len(seen) == 2
    assert result[0]['translation'] != '冲突译文'
    assert len(seen[1]) == 1


def test_formula_guard_failure_keeps_other_units_and_requires_repair(env, monkeypatch):
    m = memory(env)
    source = ['Valid sentence.', 'A formula {v2} remains here.']
    def complete(config, system, content, **kwargs):
        rows = json.loads(answer(decode(content)))
        for row in rows['sentences']:
            row['translation'] = re.sub(r'__PW_LAYOUT_KEEP_[a-f0-9]{12}_[0-9]+__', '{v3}', row['translation'])
        return json.dumps(rows)
    monkeypatch.setattr('backend.translation_memory.complete', complete)
    with pytest.raises(TranslationUnitError, match='标记'):
        m.translate(source)
    assert m.lookup([source[0]]) is not None and m.lookup([source[1]]) is None


def test_provider_error_does_not_split_into_more_requests(env, monkeypatch):
    m = memory(env)
    calls = []
    def request(config, system, content, cancelled):
        calls.append(decode(content));raise ValueError('模型服务返回 HTTP 429')
    monkeypatch.setattr('backend.translation_memory.request', request)
    with pytest.raises(ValueError, match='429'):
        m.translate(['One.', 'Two.', 'Three.', 'Four.'])
    assert len(calls) == 1 and len(calls[0]) == 4


def test_literal_nul_is_never_written_but_newline_tab_remain_valid(env, monkeypatch):
    m = memory(env)
    def complete(config, system, content, **kwargs):
        return '{"sentences":[{"id":0,"kind":"text","translation":"译文\x00内容"}]}'
    monkeypatch.setattr('backend.translation_memory.complete', complete)
    with pytest.raises(TranslationUnitError, match='格式'):
        m.translate(['Source sentence.'])
    assert m.lookup(['Source sentence.']) is None
    monkeypatch.setattr('backend.translation_memory.complete', lambda *args, **kwargs:
                        '{"sentences":[{"id":0,"kind":"text","translation":"译文\n内容\t保留"}]}')
    assert m.translate(['Source sentence.'])[0]['translation'] == '译文\n内容\t保留'
