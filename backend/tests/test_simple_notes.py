from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from backend.models import Base, User, Paper, Item
from scripts.consolidate_paper_notes import consolidate


def test_consolidation_keeps_bodies_rewrites_links_and_preserves_added_notes(tmp_path):
    database = tmp_path / "notes.db"
    engine = create_engine("sqlite:///" + str(database))
    Base.metadata.create_all(engine)
    with Session(engine) as d, d.begin():
        user = User(username="reader", password="unused")
        d.add(user)
        d.flush()
        paper = Paper(owner=user.id, title="Paper")
        d.add(paper)
        d.flush()
        first = Item(owner=user.id, paper_id=paper.id, kind="evidence", title="Source", body="Original evidence", attribution="agent:test", locator={"file_id": "pdf", "page": 4, "quote": "Original quote"})
        d.add(first)
        d.flush()
        d.add(Item(owner=user.id, paper_id=paper.id, kind="analysis", body=f"Discussion [source](#item/{first.id})", attribution="agent:test"))
        owner, pid, old_id = user.id, paper.id, first.id
    consolidate(database, "reader")
    with Session(engine) as d, d.begin():
        notes = list(d.scalars(select(Item)))
        assert len(notes) == 1 and notes[0].kind == "note"
        assert "Original evidence" in notes[0].body and "Original quote" in notes[0].body
        assert "page=4" in notes[0].body and old_id not in notes[0].body
        d.add(Item(owner=owner, paper_id=pid, kind="note", title="Added by user", body="Keep separate", attribution="human:reader"))
    consolidate(database, "reader")
    with Session(engine) as d:
        assert len(list(d.scalars(select(Item)))) == 2
    assert len(list(tmp_path.glob("*.bak"))) == 2


def test_self_reference_is_plain_text_but_other_targets_remain_links():
    from backend.notebooks import without_self_links
    assert without_self_links('[self](#item/note?quote=text) [other](#item/other?quote=text) [paper](#paper/p?page=2)', 'note') == 'self [other](#item/other?quote=text) [paper](#paper/p?page=2)'
