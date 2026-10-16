import asyncio

import httpx
import pytest

from backend.agent_receipts import verify_write


@pytest.mark.parametrize(
    "status,verification", [(200, "confirmed"), (503, "unavailable")]
)
def test_readback_does_not_replay_writes(status, verification):
    object_id = "a" * 36
    sent = []
    result = {"id": object_id, "revision": 2, "body": "Saved text"}

    def respond(request):
        sent.append(request.method)
        return httpx.Response(status, json=result)

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(respond), base_url="http://internal"
        ) as client:
            return await verify_write(
                client, "PUT", f"/items/{object_id}", result, 1, "operation"
            )

    receipt = asyncio.run(run())
    assert receipt["verification"] == verification
    assert sent == ["GET"]
    assert receipt["revision_before"] == 1


def test_readback_translation_is_submission_not_completion():
    object_id, paper_id = "a" * 36, "b" * 36
    result = {"id": object_id, "paper_id": paper_id, "status": "queued"}

    def respond(request):
        assert request.url.path == f"/api/v1/papers/{paper_id}/translations"
        return httpx.Response(200, json=[result])

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(respond), base_url="http://internal"
        ) as client:
            return await verify_write(
                client, "POST", f"/papers/{paper_id}/translations", result, None, "op"
            )

    receipt = asyncio.run(run())
    assert receipt["state"] == "submitted"
    assert receipt["verification"] == "confirmed"
    assert receipt["job_status"] == "queued"


def test_readback_does_not_confirm_concurrent_change():
    object_id = "a" * 36

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200, json={"id": object_id, "revision": 3}
                )
            ),
            base_url="http://internal",
        ) as client:
            return await verify_write(
                client,
                "PATCH",
                f"/papers/{object_id}",
                {"id": object_id, "revision": 2},
                1,
                "op",
            )

    assert asyncio.run(run())["verification"] == "changed"
