import json
import pytest
from backend.translation_memory import immutable_metadata
from backend.tests.test_translation_memory_batches import memory
from backend.tests.test_acceptance import env

URLS = '5\r\nhttps://platform.openai.com/docs/models/gpt-3-5\r\n6\r\nhttps://platform.openai.com/docs/models/gpt-4-and-gpt\x024-turbo'
MORE_URLS = '12https://pypi.org/project/rouge/\r\n13https://pypi.org/project/bert-score/\r\n14https://github.com/shmsw25/FActScore'
AUTHORS = 'A. Ni, S. Iyer, D. Radev, V. Stoyanov, W.-t.'


def test_source_metadata_is_checkpointed_without_any_provider_request(env, monkeypatch):
    m = memory(env)
    def forbidden(*args, **kwargs):pytest.fail('Immutable metadata must not call a model')
    monkeypatch.setattr('backend.translation_memory.complete', forbidden)
    values = [URLS, MORE_URLS, AUTHORS]
    pairs = m.translate(values)
    assert [p['translation'] for p in pairs] == values
    assert [p['original'] for p in pairs] == values
    assert m.translate(values) == pairs


@pytest.mark.parametrize('source', [
    'The model stores these important memories to improve future conversation quality.',
    'A New Architecture for Long Term Language Agent Memory Retrieval',
    'Figure 2. Model results explain the comparison between several strong baselines.',
    '# This code comment explains how the model updates existing memory entries.',
    'See https://platform.openai.com/docs/models for the latest model documentation.',
    'A. Ni, S. Iyer, D. Radev, Our results explain memory retrieval.',
])
def test_prose_titles_captions_and_comments_are_not_metadata(env, monkeypatch, source):
    m = memory(env)
    assert not immutable_metadata(source)
    calls = []
    def complete(cfg, system, content, **kwargs):
        calls.append(content)
        return json.dumps({'sentences':[{'id':0,'translation':'正文译文','kind':'text'}]})
    monkeypatch.setattr('backend.translation_memory.complete', complete)
    assert m.translate([source])[0]['translation'] == '正文译文'
    assert len(calls) == 1
    with pytest.raises(ValueError, match='中文'):
        m._validate_unit(source, {'translation':source,'kind':'text'})


def test_metadata_validation_requires_unchanged_source(env):
    m = memory(env)
    assert m._validate_unit(URLS, {'translation':URLS,'kind':'text'})['translation'] == URLS
    for source in [URLS, AUTHORS]:
        with pytest.raises(ValueError, match='不得改写'):
            m._validate_unit(source, {'translation':'中文改写：'+source,'kind':'text'})
    assert not immutable_metadata(URLS+'\x00')
    assert not immutable_metadata('A. Ni, S. Iyer')


@pytest.mark.parametrize('source', [
    'URL https://openreview.net/forum?id=\r\njKN1pXi7b0.',
    'https://aiarchitect.wordpress.com/2009/10/19/\r\ncoordinating-agents-with-behavior-trees-synchronizing-multiple-agents-in\x02cryengine-2/',
])
def test_wrapped_url_metadata_preserves_original_without_requests(env, monkeypatch, source):
    m = memory(env)
    def forbidden(*args, **kwargs):pytest.fail('Wrapped metadata must not call a model')
    monkeypatch.setattr('backend.translation_memory.complete', forbidden)
    assert immutable_metadata(source)
    result = m.translate([source])[0]
    assert result['original'] == source and result['translation'] == source


@pytest.mark.parametrize('source', [
    'https://aiarchitect.wordpress.com/2009/10/19/\r\ncoordinating-agents-with-behavior-trees-synchronizing-multiple-agents-in\x02cryengine-2/\r\n[83] Prolific.',
    'URL https://openreview.net/forum?id=\r\nThis is ordinary prose about the method.',
    'https://example.org/\nDiscussion',
    'https://example.org/\nDiscussion.',
])
def test_url_continuation_does_not_swallow_prose_or_next_citation(source):
    assert not immutable_metadata(source)
