"""A paper starts with one ordinary, freely editable note."""
from .models import Item


def default_note(session, paper, actor):
    note = Item(owner=paper.owner, kind="note", paper_id=paper.id,
                title="阅读笔记", body="", attribution=actor)
    session.add(note)
    session.flush()
    return note


def without_self_links(body, note_id):
    import re
    return re.sub(r'(?<!!)\[([^\]]+)\]\(#item/' + re.escape(note_id) + r'(?:\?[^)]*)?\)', r'\1', body)
