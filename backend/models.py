import uuid
from datetime import datetime, timezone
from typing import ClassVar

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def uid():
    return str(uuid.uuid4())


def now():
    return datetime.now(timezone.utc).isoformat()


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    username: Mapped[str] = mapped_column(String(32), unique=True)
    email: Mapped[str | None] = mapped_column(String(254), unique=True, nullable=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    password: Mapped[str] = mapped_column(Text)
    admin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[str] = mapped_column(String(40), default=now)


class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"))
    csrf: Mapped[str] = mapped_column(String(64))
    expires: Mapped[str] = mapped_column(String(40))


class AccountChallenge(Base):
    __tablename__ = "account_challenges"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"))
    purpose: Mapped[str] = mapped_column(String(16))
    email: Mapped[str] = mapped_column(String(254))
    expires: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[str] = mapped_column(String(40), default=now)


class Invitation(Base):
    __tablename__ = "invitations"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    username: Mapped[str] = mapped_column(String(32))
    expires: Mapped[str] = mapped_column(String(40))
    used: Mapped[bool] = mapped_column(Boolean, default=False)


class Token(Base):
    __tablename__ = "tokens"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    digest: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    scopes: Mapped[list] = mapped_column(JSON)
    expires: Mapped[str] = mapped_column(String(40))
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[str] = mapped_column(String(40), default=now)


class Paper(Base):
    __tablename__ = "papers"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(500))
    authors: Mapped[str] = mapped_column(Text, default="")
    abstract: Mapped[str] = mapped_column(Text, default="")
    external_id: Mapped[str] = mapped_column(String(200), default="")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    current_version: Mapped[str] = mapped_column(String(36), default="")
    agent_status: Mapped[str] = mapped_column(String(30), default="pending")
    reading_status: Mapped[str] = mapped_column(String(30), default="unread")
    favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    updated_at: Mapped[str] = mapped_column(String(40), default=now)
    __mapper_args__ = {"version_id_col": revision, "version_id_generator": False}


class Version(Base):
    __tablename__ = "versions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id"))
    label: Mapped[str] = mapped_column(String(100))
    provenance: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    __table_args__ = (UniqueConstraint("paper_id", "label"),)


class File(Base):
    __tablename__ = "files"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id"))
    version_id: Mapped[str] = mapped_column(ForeignKey("versions.id"))
    name: Mapped[str] = mapped_column(String(255))
    source_path: Mapped[str] = mapped_column(String(500))
    mime: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    pages: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now)


class InkStroke(Base):
    __tablename__ = "ink_strokes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id"), index=True)
    file_id: Mapped[str] = mapped_column(ForeignKey("files.id"), index=True)
    page: Mapped[int] = mapped_column(Integer)
    data: Mapped[dict] = mapped_column(JSON)
    size: Mapped[int] = mapped_column(Integer)
    deleted: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[str] = mapped_column(String(40), default=now)


class TextAnnotation(Base):
    __tablename__ = "text_annotations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id"), index=True)
    file_id: Mapped[str] = mapped_column(ForeignKey("files.id"), index=True)
    version_id: Mapped[str] = mapped_column(ForeignKey("versions.id"))
    page: Mapped[int] = mapped_column(Integer)
    quote: Mapped[str] = mapped_column(Text)
    prefix: Mapped[str] = mapped_column(Text, default="")
    rects: Mapped[list] = mapped_column(JSON)
    color: Mapped[str] = mapped_column(String(7))
    comment: Mapped[str] = mapped_column(Text, default="")
    size: Mapped[int] = mapped_column(Integer)
    deleted: Mapped[bool] = mapped_column(default=False)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    updated_at: Mapped[str] = mapped_column(String(40), default=now)
    __mapper_args__: ClassVar[dict] = {"version_id_col": revision, "version_id_generator": False}


class Item(Base):
    __tablename__ = "items"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(30), index=True)
    paper_id: Mapped[str | None] = mapped_column(ForeignKey("papers.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(500), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(30), default="open")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    paper_ids: Mapped[list] = mapped_column(JSON, default=list)
    evidence_ids: Mapped[list] = mapped_column(JSON, default=list)
    locator: Mapped[dict] = mapped_column(JSON, default=dict)
    attribution: Mapped[str] = mapped_column(String(150))
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    updated_at: Mapped[str] = mapped_column(String(40), default=now)
    __mapper_args__ = {"version_id_col": revision, "version_id_generator": False}


class Revision(Base):
    __tablename__ = "revisions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    object_id: Mapped[str] = mapped_column(String(36), index=True)
    number: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(JSON)
    actor: Mapped[str] = mapped_column(String(150))
    created_at: Mapped[str] = mapped_column(String(40), default=now)


class Event(Base):
    __tablename__ = "events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id"))
    kind: Mapped[str] = mapped_column(String(30))
    body: Mapped[str] = mapped_column(Text)
    locator: Mapped[dict] = mapped_column(JSON, default=dict)
    confirmed: Mapped[bool] = mapped_column(Boolean)
    actor: Mapped[str] = mapped_column(String(150))
    created_at: Mapped[str] = mapped_column(String(40), default=now)


class Feedback(Base):
    __tablename__ = "feedback"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id"))
    action: Mapped[str] = mapped_column(String(30))
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    __table_args__ = (UniqueConstraint("owner", "paper_id"),)


class Idempotency(Base):
    __tablename__ = "idempotency"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"))
    key: Mapped[str] = mapped_column(String(200))
    fingerprint: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(JSON)
    __table_args__ = (UniqueConstraint("owner", "key"),)


def public(obj):
    return {
        c.name: getattr(obj, c.name)
        for c in obj.__table__.columns
        if c.name not in {"owner", "password", "digest", "csrf"}
    }


class ResearchProfile(Base):
    __tablename__ = "research_profiles"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), unique=True)
    body: Mapped[str] = mapped_column(Text, default="")
    interests: Mapped[list] = mapped_column(JSON, default=list)
    excluded: Mapped[list] = mapped_column(JSON, default=list)
    tracking: Mapped[bool] = mapped_column(Boolean, default=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[str] = mapped_column(String(40), default=now)
    __mapper_args__ = {"version_id_col": revision, "version_id_generator": False}


class DiscoveryCandidate(Base):
    __tablename__ = "discovery_candidates"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    external_id: Mapped[str] = mapped_column(String(200))
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    action: Mapped[str] = mapped_column(String(30), default="")
    updated_at: Mapped[str] = mapped_column(String(40), default=now)
    __table_args__ = (UniqueConstraint("owner", "external_id"),)


class TranslationJob(Base):
    __tablename__ = "translation_jobs"
    __table_args__ = (
        Index(
            "uq_active_translation",
            "owner",
            "paper_id",
            unique=True,
            sqlite_where=text("status IN ('queued', 'running')"),
            postgresql_where=text("status IN ('queued', 'running')"),
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id"), index=True)
    version_id: Mapped[str] = mapped_column(ForeignKey("versions.id"))
    arxiv_id: Mapped[str] = mapped_column(String(80))
    engine: Mapped[str] = mapped_column(
        String(20), default="latex", server_default="latex"
    )
    status: Mapped[str] = mapped_column(String(24), default="queued")
    stage: Mapped[str] = mapped_column(String(100), default="等待处理")
    completed: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    source_file: Mapped[str] = mapped_column(String(36), default="")
    translated_file: Mapped[str] = mapped_column(String(36), default="")
    source_archive: Mapped[str] = mapped_column(String(36), default="")
    translated_archive: Mapped[str] = mapped_column(String(36), default="")
    model_config_id: Mapped[str] = mapped_column(String(36), default="")
    model_options: Mapped[dict] = mapped_column(JSON, default=dict)
    protocol: Mapped[str] = mapped_column(String(20), default="openai")
    model: Mapped[str] = mapped_column(String(200), default="")
    base_url: Mapped[str] = mapped_column(String(500), default="")
    error: Mapped[str] = mapped_column(Text, default="")
    alignment: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    updated_at: Mapped[str] = mapped_column(String(40), default=now)


class AgentSession(Base):
    __tablename__ = "agent_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(100), default="新会话")
    paper_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    updated_at: Mapped[str] = mapped_column(String(40), default=now)


class AgentRun(Base):
    __tablename__ = "agent_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("agent_sessions.id"), index=True)
    attachment_ids: Mapped[list] = mapped_column(JSON, default=list)
    model_config_id: Mapped[str] = mapped_column(String(36))
    model: Mapped[str] = mapped_column(String(200))
    prompt: Mapped[str] = mapped_column(Text)
    context: Mapped[str] = mapped_column(String(200), default="")
    writable: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(24), default="queued")
    response: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str] = mapped_column(String(500), default="")
    steps: Mapped[list] = mapped_column(JSON, default=list)
    runtime: Mapped[dict] = mapped_column(JSON, default=dict)
    # "" is the reader's conversation; "translation" is bulk page translation,
    # which runs beside it and never holds more than its share of the workers.
    lane: Mapped[str] = mapped_column(String(16), default="", server_default="")
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    updated_at: Mapped[str] = mapped_column(String(40), default=now)


class ReadingArtifact(Base):
    __tablename__ = "reading_artifacts"
    __table_args__ = (UniqueConstraint("owner", "cache_key"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id"), index=True)
    file_id: Mapped[str] = mapped_column(ForeignKey("files.id"))
    version_id: Mapped[str] = mapped_column(ForeignKey("versions.id"))
    file_sha256: Mapped[str] = mapped_column(String(64))
    cache_key: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(16))
    model_config_id: Mapped[str] = mapped_column(String(36))
    model: Mapped[str] = mapped_column(String(200))
    model_options: Mapped[dict] = mapped_column(JSON, default=dict)
    parameters: Mapped[dict] = mapped_column(JSON, default=dict)
    run_id: Mapped[str] = mapped_column(String(36), default="")
    session_id: Mapped[str] = mapped_column(String(36), default="")
    status: Mapped[str] = mapped_column(String(24), default="queued")
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    evidence_pages: Mapped[list] = mapped_column(JSON, default=list)
    evidence_text: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str] = mapped_column(String(500), default="")
    size: Mapped[int] = mapped_column(Integer, default=131072)
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    updated_at: Mapped[str] = mapped_column(String(40), default=now)


class AgentQuota(Base):
    __tablename__ = "agent_quotas"
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    day: Mapped[str] = mapped_column(String(10))
    runs: Mapped[int] = mapped_column(Integer, default=0)
    imports: Mapped[int] = mapped_column(Integer, default=0)


class NoteImage(Base):
    __tablename__ = "note_images"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[str] = mapped_column(String(40), default=now)


class AgentAttachment(Base):
    __tablename__ = "agent_attachments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    pages: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now)

    @property
    def paper_id(self):
        return None


class ModelUsage(Base):
    __tablename__ = "model_usage"
    __table_args__ = (Index("ix_model_usage_owner_created", "owner", "created_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(ForeignKey("users.id"))
    source: Mapped[str] = mapped_column(String(20))
    task_id: Mapped[str] = mapped_column(String(36))
    model: Mapped[str] = mapped_column(String(200))
    shared: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="started")
    input_tokens: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    cache_read_tokens: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    cache_write_tokens: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    reserved_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    total_tokens: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now)


from . import library_collections  # noqa: E402,F401

from . import citations  # noqa: E402,F401

from . import paper_shares  # noqa: E402,F401
