"""Read back common business writes using the same owner-scoped ASGI client."""

import re


async def verify_write(client, method, path, result, revision, operation_id):
    if method == "GET" or not isinstance(result, dict):
        return None
    entity = None
    object_id = result.get("id")
    match = re.fullmatch(r"/(papers|items)/([0-9a-f-]{36})", path)
    if match:
        entity, object_id = match.groups()
    elif path in {"/papers", "/import/arxiv"}:
        entity = "papers"
    elif path == "/items":
        entity = "items"
    elif re.fullmatch(r"/papers/[0-9a-f-]{36}/translations", path) or re.fullmatch(
        r"/translations/[0-9a-f-]{36}/cancel", path
    ):
        entity = "translations"
    if not entity or not re.fullmatch(r"[0-9a-f-]{36}", str(object_id)):
        return None
    deleted = method == "DELETE"
    receipt = {
        "operation_id": operation_id,
        "entity_type": entity,
        "entity_id": object_id,
        "revision_before": revision,
        "revision_after": result.get("revision"),
        "state": "deleted"
        if deleted
        else "submitted"
        if entity == "translations"
        else "saved",
        "verification": "unavailable",
        "url": ""
        if deleted
        else f"#{'paper' if entity == 'papers' else 'item'}/{object_id}",
    }
    if entity == "translations":
        receipt["url"] = f"#paper/{result.get('paper_id', '')}"
    try:
        target = f"/api/v1/{entity}/{object_id}"
        if entity == "translations":
            paper_id = result.get("paper_id", "")
            if not re.fullmatch(r"[0-9a-f-]{36}", str(paper_id)):
                return receipt
            target = f"/api/v1/papers/{paper_id}/translations"
        response = await client.get(target)
        if deleted:
            receipt["verification"] = (
                "confirmed"
                if response.status_code == 404
                else "changed"
                if response.status_code == 200
                else "unavailable"
            )
        elif response.status_code == 200:
            current = response.json()
            if entity == "translations":
                current = next(
                    (row for row in current if row.get("id") == object_id), {}
                )
            fields = [
                k
                for k in (
                    "id",
                    "revision",
                    "body",
                    "title",
                    "favorite",
                    "archived",
                    "tags",
                    "status",
                )
                if k in result
            ]
            receipt["verification"] = (
                "confirmed"
                if all(current.get(k) == result[k] for k in fields)
                else "changed"
            )
            receipt["verified_fields"] = fields
            receipt["revision_after"] = current.get("revision")
            if entity == "translations":
                receipt["job_status"] = current.get("status")
                receipt["url"] = f"#paper/{current.get('paper_id', '')}"
    except Exception:  # noqa: BLE001 -- a failed read-back must never replay a successful write
        return receipt
    return receipt
