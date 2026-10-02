"""Provider-reported usage. Missing usage is unknown, never an estimated zero."""

from sqlalchemy import func, select

from .config import Settings
from .models import ModelUsage, now
from .storage_budget import lock_owner


class ModelBudgetExceeded(ValueError):
    pass


def budget_state(d, owner, shared, settings):
    charge = func.coalesce(
        ModelUsage.total_tokens,
        func.nullif(ModelUsage.reserved_tokens, 0),
        settings.model_request_reserve,
    )
    used = int(
        d.scalar(
            select(func.coalesce(func.sum(charge), 0)).where(
                ModelUsage.owner == owner,
                ModelUsage.shared == shared,
                ModelUsage.created_at >= now()[:10],
            )
        )
    )
    overruns = d.scalar(
        select(func.count())
        .select_from(ModelUsage)
        .where(
            ModelUsage.owner == owner,
            ModelUsage.shared == shared,
            ModelUsage.created_at >= now()[:10],
            ModelUsage.reserved_tokens > 0,
            ModelUsage.total_tokens > ModelUsage.reserved_tokens,
        )
    )
    limit = settings.shared_daily_tokens if shared else settings.private_daily_tokens
    return {
        "scope": "shared" if shared else "private",
        "over_reservation_requests": overruns,
        "limit_tokens": limit,
        "charged_tokens": used,
        "remaining_tokens": max(0, limit - used) if limit else None,
        "request_reserve_tokens": settings.model_request_reserve,
    }


def normalize(value, protocol):
    if not isinstance(value, dict):
        return None
    names = {
        "openai": ("prompt_tokens", "completion_tokens"),
        "anthropic": ("input_tokens", "output_tokens"),
        "pi": ("input", "output"),
    }[protocol]
    counts = [value.get(name) for name in names]
    if any(type(n) is not int or not 0 <= n <= 10**12 for n in counts):
        return None
    cached = (
        value.get("cacheRead", 0)
        if protocol == "pi"
        else value.get("cache_read_input_tokens", 0)
    )
    written = (
        value.get("cacheWrite", 0)
        if protocol == "pi"
        else value.get("cache_creation_input_tokens", 0)
    )
    if protocol == "openai":
        cached = value.get("prompt_tokens_details") or {}
        if not isinstance(cached, dict):
            return None
        cached = cached.get("cached_tokens", 0)
        written = 0
    if any(type(n) is not int or not 0 <= n <= 10**12 for n in (cached, written)):
        return None
    total = sum(counts) + (cached + written if protocol != "openai" else 0)
    # Pi initializes usage to zero even when the upstream omitted it.
    if protocol == "pi" and total == 0:
        return None
    return {
        "input_tokens": counts[0],
        "output_tokens": counts[1],
        "cache_read_tokens": cached,
        "cache_write_tokens": written,
        "total_tokens": total,
    }


def start(maker, owner, source, task_id, config, settings=None):
    settings = settings or Settings.env()
    shared = bool(config.get("shared") or config.get("_platform_limit_dir"))
    with maker() as d:
        lock_owner(d, owner)
        state = budget_state(d, owner, shared, settings)
        if (
            state["limit_tokens"]
            and state["charged_tokens"] + settings.model_request_reserve
            > state["limit_tokens"]
        ):
            scope = "平台模型" if shared else "自带模型"
            raise ModelBudgetExceeded(
                f"今日{scope}预算不足以预留下一次请求；已完成操作保留。请在空间设置查看预算，UTC次日重置后可继续。"
            )
        row = ModelUsage(
            owner=owner,
            source=source,
            task_id=task_id,
            model=config["model"],
            shared=shared,
            reserved_tokens=settings.model_request_reserve,
        )
        d.add(row)
        d.commit()
        return row.id


def finish(maker, identifier, value, protocol, status="completed"):
    with maker() as d:
        row = d.get(ModelUsage, identifier)
        if not row:
            return
        lock_owner(d, row.owner)
        d.refresh(row)
        counts = normalize(value, protocol)
        if counts:
            for key, count in counts.items():
                setattr(row, key, count)
        row.status = status
        d.commit()


def summary(d, owner, settings=None):
    settings = settings or Settings.env()
    day = now()[:10]
    rows = d.execute(
        select(
            ModelUsage.source,
            func.count(),
            func.count(ModelUsage.total_tokens),
            func.coalesce(func.sum(ModelUsage.total_tokens), 0),
        )
        .where(ModelUsage.owner == owner, ModelUsage.created_at >= day)
        .group_by(ModelUsage.source)
    ).all()
    return {
        "day": day,
        "timezone": "UTC",
        "requests": sum(r[1] for r in rows),
        "unknown_requests": sum(r[1] - r[2] for r in rows),
        "total_tokens": sum(r[3] for r in rows),
        "budgets": [
            budget_state(d, owner, shared, settings) for shared in (True, False)
        ],
        "sources": [
            {
                "source": r[0],
                "requests": r[1],
                "known_requests": r[2],
                "total_tokens": r[3],
            }
            for r in rows
        ],
    }


def bind(config, maker, settings, owner, source, task_id=""):
    """Attach accounting to every non-streaming provider entry point."""
    value = dict(config)
    value["_usage_start"] = lambda: start(
        maker, owner, source, task_id, value, settings
    )
    value["_usage_finish"] = lambda identifier, result, status: finish(
        maker, identifier, result, value.get("protocol", "openai"), status
    )
    return value
