from typing import Literal
from pydantic import BaseModel, Field, ConfigDict, field_validator


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Credentials(Strict):
    username: str = Field(
        min_length=3, max_length=32, pattern=r"^[a-zA-Z][a-zA-Z0-9_]{2,31}$"
    )
    password: str = Field(min_length=1, max_length=256)

    @field_validator("username")
    @classmethod
    def lower(cls, v):
        return v.lower()


class Register(Credentials):
    password: str = Field(min_length=8, max_length=256)
    invitation: str = Field(default="", min_length=20, max_length=200)

    @field_validator("username")
    @classmethod
    def reserved(cls, v):
        if v in {"admin", "administrator", "root", "system", "security", "support"}:
            raise ValueError("This username is reserved")
        return v


class Invite(Strict):
    username: str = Field(
        min_length=3, max_length=32, pattern=r"^[a-zA-Z][a-zA-Z0-9_]{2,31}$"
    )

    @field_validator("username")
    @classmethod
    def normalize(cls, v):
        return v.lower()


class RecoveryRequest(Strict):
    email: str = Field(max_length=254, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

    @field_validator("email")
    @classmethod
    def normalize(cls, v):
        return v.lower()


class EmailBinding(RecoveryRequest):
    password: str = Field(min_length=1, max_length=256)


class ChallengeInput(Strict):
    token: str = Field(min_length=32, max_length=128)


class PasswordReset(ChallengeInput):
    password: str = Field(min_length=8, max_length=256)


class TokenInput(Strict):
    name: str = Field(min_length=1, max_length=120)
    scopes: list[Literal["read", "write"]] = Field(min_length=1, max_length=2)
    days: int = Field(default=30, ge=1, le=365)


class PaperCreate(Strict):
    title: str = Field(min_length=1, max_length=500)
    authors: str = Field(default="", max_length=4000)
    abstract: str = Field(default="", max_length=50000)
    external_id: str = Field(default="", max_length=200)
    tags: list[str] = Field(default_factory=list, max_length=30)
    version_label: str = Field(default="v1", min_length=1, max_length=100)
    provenance: str = Field(default="", max_length=10000)

    @field_validator("tags")
    @classmethod
    def tags_valid(cls, v):
        if any(not t.strip() or len(t) > 80 for t in v):
            raise ValueError("Tags must be 1–80 characters")
        return list(dict.fromkeys(t.strip() for t in v))


class PaperPatch(Strict):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    authors: str | None = Field(default=None, max_length=4000)
    abstract: str | None = Field(default=None, max_length=50000)
    external_id: str | None = Field(default=None, max_length=200)
    tags: list[str] | None = Field(default=None, max_length=30)
    agent_status: Literal["pending", "processing", "ready", "failed"] | None = None
    favorite: bool | None = None
    archived: bool | None = None

    @field_validator("tags")
    @classmethod
    def tags_valid(cls, v):
        return PaperCreate.tags_valid(v) if v is not None else v


class VersionInput(Strict):
    label: str = Field(min_length=1, max_length=100)
    provenance: str = Field(default="", max_length=10000)


class Locator(Strict):
    version_id: str = Field(min_length=1, max_length=36)
    file_id: str = Field(min_length=1, max_length=36)
    page: int | None = Field(default=None, ge=1)
    line_start: int | None = Field(default=None, ge=1)
    line_end: int | None = Field(default=None, ge=1)
    quote: str = Field(default="", max_length=10000)
    label: str = Field(default="", max_length=500)


class ItemInput(Strict):
    kind: Literal["note", "evidence", "analysis", "question", "topic", "link"]
    paper_id: str | None = None
    title: str = Field(default="", max_length=500)
    body: str = Field(default="", max_length=100000)
    status: Literal["open", "resolved"] = "open"
    tags: list[str] = Field(default_factory=list, max_length=30)
    paper_ids: list[str] = Field(default_factory=list, max_length=100)
    evidence_ids: list[str] = Field(default_factory=list, max_length=100)
    locator: Locator | None = None

    @field_validator("tags")
    @classmethod
    def tags_valid(cls, v):
        return PaperCreate.tags_valid(v)


class EventInput(Strict):
    kind: Literal["suggestion", "reading", "correction"]
    body: str = Field(min_length=1, max_length=10000)
    locator: Locator | None = None
    reading_status: Literal["unread", "reading", "read"] | None = None


class FeedbackInput(Strict):
    action: Literal["queue", "dismiss", "not_interested", "reset"]
