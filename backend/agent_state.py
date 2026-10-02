"""Persist execution phases separately from business tool receipts."""

from datetime import datetime

from .models import now


def snapshot(runtime, at=None):
    value = dict(runtime or {})
    if not value.get("since"):
        return value
    at = at or now()
    elapsed = max(
        0,
        (
            datetime.fromisoformat(at) - datetime.fromisoformat(value["since"])
        ).total_seconds(),
    )
    field = (
        "waiting_seconds"
        if value.get("phase") == "waiting_model"
        else "execution_seconds"
    )
    value[field] = round(value.get(field, 0) + elapsed, 2)
    value["since"] = at
    return value


def transition(runtime, phase):
    at = now()
    value = snapshot(runtime, at)
    return {**value, "phase": phase, "since": at}


def presentation(run):
    # Terminal runs freeze at their last update; reading the API never writes state.
    value = snapshot(run.runtime, None if run.status == "running" else run.updated_at)
    if run.status != "running":
        value["phase"] = run.status
    return value
