def test_self_reference_is_plain_text_but_other_targets_remain_links():
    from backend.notebooks import without_self_links
    assert without_self_links('[self](#item/note?quote=text) [other](#item/other?quote=text) [paper](#paper/p?page=2)', 'note') == 'self [other](#item/other?quote=text) [paper](#paper/p?page=2)'
