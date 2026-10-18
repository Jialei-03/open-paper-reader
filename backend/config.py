import os
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

# Names that only ever reach this machine. The local (no-login) mode refuses to
# start on, or answer through, anything else.
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


def is_loopback(host):
    host = (host or "").strip().lower().removeprefix("[").removesuffix("]")
    return host in LOOPBACK_HOSTS or host.startswith("127.")


@dataclass
class Settings:
    database_url: str = "sqlite:///./data/platform.db"
    storage: str = "./data/files"
    secure_cookie: bool = False
    origin: str = "http://127.0.0.1:8765"
    upload_limit: int = 50 * 1024 * 1024
    testing: bool = False
    storage_limit: int = 1024**3
    storage_min_free: int = 1024**3
    shared_daily_tokens: int = 0
    private_daily_tokens: int = 0
    model_request_reserve: int = 131072
    translation_cache_days: int = 7
    translation_orphan_days: int = 30
    pdf_layout_image: str = ""
    # A user's agent tasks are not limited for now (0 means no limit). Each limit
    # can be switched back on from the environment; the site-wide queue only
    # guards against a runaway loop.
    agent_active_limit: int = 0
    agent_daily_runs: int = 0
    agent_queue_limit: int = 1000
    translation_active_limit: int = 0
    agent_worker_concurrency: int = 0
    agent_translation_workers: int = 0
    # "open": anyone can create an account. "invite": an account needs an
    # invitation code made by an administrator.
    registration: str = "open"
    # "cloud": the hosted site, every user signs in. "local": the one-person
    # desktop build (open-paper-reader), bound to loopback, signs in by itself.
    mode: str = "cloud"
    host: str = "127.0.0.1"

    @classmethod
    def env(cls):
        production = os.getenv("APP_ENV") == "production"
        url = os.getenv("DATABASE_URL", cls.database_url)
        origin = os.getenv("APP_ORIGIN", cls.origin).rstrip("/")
        if production and (
            not origin.startswith("https://") or not url.startswith("postgresql")
        ):
            raise RuntimeError(
                "Production requires HTTPS APP_ORIGIN and PostgreSQL DATABASE_URL"
            )

        registration = os.getenv("REGISTRATION", "open").strip().lower()
        if registration not in {"open", "invite"}:
            raise ValueError("REGISTRATION must be open or invite")

        mode = os.getenv("APP_MODE", "cloud").strip().lower() or "cloud"
        if mode not in {"cloud", "local"}:
            raise ValueError("APP_MODE must be cloud or local")
        host = os.getenv("APP_HOST", "127.0.0.1").strip()
        if mode == "local" and (production or not is_loopback(host)):
            raise RuntimeError(
                "APP_MODE=local only runs on a loopback address (127.0.0.1) outside production"
            )

        def budget_value(name, default, minimum=0):
            value = int(os.getenv(name, str(default)))
            if not minimum <= value <= 10**12:
                raise ValueError(f"{name} must be between {minimum} and 1000000000000")
            return value

        return cls(
            url,
            os.getenv("STORAGE_DIR", cls.storage),
            production,
            origin,
            int(os.getenv("UPLOAD_LIMIT_MB", "50")) * 1024 * 1024,
            registration=registration,
            mode=mode,
            host=host,
            translation_cache_days=budget_value("TRANSLATION_CACHE_DAYS", 7),
            translation_orphan_days=budget_value("TRANSLATION_ORPHAN_DAYS", 30),
            pdf_layout_image=os.getenv("PDF_LAYOUT_IMAGE", ""),
            agent_active_limit=budget_value("AGENT_ACTIVE_LIMIT", 0),
            agent_daily_runs=budget_value("AGENT_DAILY_RUNS", 0),
            agent_queue_limit=budget_value("AGENT_QUEUE_LIMIT", 1000),
            translation_active_limit=budget_value("AGENT_TRANSLATION_ACTIVE", 0),
            agent_worker_concurrency=budget_value("AGENT_WORKER_CONCURRENCY", 0),
            agent_translation_workers=budget_value("AGENT_TRANSLATION_WORKERS", 0),
            shared_daily_tokens=budget_value("SHARED_MODEL_DAILY_TOKENS", 0),
            private_daily_tokens=budget_value("PRIVATE_MODEL_DAILY_TOKENS", 0),
            model_request_reserve=budget_value(
                "MODEL_REQUEST_RESERVE_TOKENS", 131072, 1
            ),
            storage_limit=max(1, int(os.getenv("USER_STORAGE_LIMIT_MB", "1024")))
            * 1024**2,
            storage_min_free=max(1, int(os.getenv("STORAGE_MIN_FREE_MB", "1024")))
            * 1024**2,
        )


def database(settings):
    if settings.database_url.startswith("sqlite:///"):
        Path(settings.database_url.removeprefix("sqlite:///")).parent.mkdir(
            parents=True, exist_ok=True
        )
    engine = create_engine(
        settings.database_url,
        connect_args={"check_same_thread": False}
        if settings.database_url.startswith("sqlite")
        else {},
        pool_pre_ping=True,
    )
    if settings.database_url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def pragmas(conn, _):
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA busy_timeout=10000")

    return engine, sessionmaker(engine, expire_on_commit=False)
