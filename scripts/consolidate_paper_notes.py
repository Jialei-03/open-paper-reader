"""Merge a user's legacy per-paper fragments, with a SQLite backup first.

Run explicitly: python scripts/consolidate_paper_notes.py DATABASE USERNAME
Existing ordinary notes are kept if no legacy fragments remain (safe to rerun).
"""
import sys
import sqlite3
from pathlib import Path
from datetime import datetime
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy import create_engine, select, delete
from sqlalchemy.orm import Session
from backend.models import User, Paper, Item, Revision, now, public
from backend.notebooks import default_note


def consolidate(database, username):
    database = Path(database).resolve()
    backup = database.with_name(database.name + '.before-simple-notes-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.bak')
    with sqlite3.connect(database) as src, sqlite3.connect(backup) as dst:
        src.backup(dst)
    engine = create_engine('sqlite:///' + str(database))
    merged = 0
    with Session(engine) as d, d.begin():
        user = d.scalar(select(User).where(User.username == username))
        if not user:
            raise ValueError('Unknown user')
        papers = list(d.scalars(select(Paper).where(Paper.owner == user.id)))
        items = list(d.scalars(select(Item).where(Item.owner == user.id)))
        replacements = {}
        removed = set()
        for paper in papers:
            entries = [i for i in items if i.paper_id == paper.id or (i.attribution.startswith('agent:') and i.paper_ids == [paper.id])]
            if entries and all(i.kind == 'note' for i in entries):
                continue
            note = default_note(d, paper, 'system:consolidation')
            chunks = []
            for i in sorted(entries, key=lambda i: (i.kind != 'analysis', i.created_at)):
                chunks.append('## ' + (i.title or i.kind) + '\n\n' + i.body)
                if i.locator.get('file_id'):
                    loc = i.locator
                    url = f'#paper/{paper.id}?file={loc["file_id"]}&page={loc.get("page", 1)}'
                    if loc.get('line_start'):
                        url += '&line=' + str(loc['line_start'])
                    chunks.append(f'[查看原文]({url})')
                    if loc.get('quote'):
                        chunks.append('> ' + loc['quote'].replace('\n', '\n> '))
                replacements[i.id] = note.id
                removed.add(i.id)
            note.body = '\n\n'.join(chunks)
            merged += len(entries)
        survivors = list(d.scalars(select(Item).where(Item.owner == user.id)))
        for i in survivors:
            if i.id in removed:
                continue
            for old, new in replacements.items():
                i.body = i.body.replace('#item/' + old, '#item/' + new)
            if any(e in removed for e in i.evidence_ids):
                links = {replacements[e] for e in i.evidence_ids if e in removed}
                i.body += '\n\n' + '\n'.join(f'[关联笔记](#item/{n})' for n in links)
                i.evidence_ids = [e for e in i.evidence_ids if e not in removed]
            if i.attribution == 'system:consolidation':
                d.add(Revision(owner=user.id, object_id=i.id, number=i.revision, snapshot=public(i), actor=i.attribution))
        if removed:
            d.execute(delete(Revision).where(Revision.owner == user.id, Revision.object_id.in_(removed)))
            d.execute(delete(Item).where(Item.owner == user.id, Item.id.in_(removed)))
    print(f'Merged {merged} fragments; backup: {backup}')

if __name__ == '__main__':
    consolidate(sys.argv[1], sys.argv[2])
