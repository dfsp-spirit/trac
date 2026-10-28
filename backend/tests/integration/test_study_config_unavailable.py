"""Why a study is not collecting reaches the participant (D39).

The rewrite asks for `include_unavailable=true` so it can render one page with
three different messages; the old frontend keeps its 403 signal until cutover.
Both halves are pinned here, because the flag is the seam between them.
"""

import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

from o_timeusediary_backend.settings import settings


BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
# Tolerate an empty root path (a bare-uvicorn run), so the same file works in CI
# behind nginx and against a scratch server.
BASE_URL = f"{BASE_SCHEME}/{settings.rootpath.strip('/')}".rstrip("/")
ADMIN_AUTH = (settings.admin_username, settings.admin_password)


def _activities_template() -> dict:
    backend_root = Path(__file__).resolve().parents[2]
    return json.loads(
        (backend_root / "activities_default.json").read_text(encoding="utf-8")
    )


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _window(start: datetime, end: datetime) -> dict:
    return {"data_collection_start": _iso(start), "data_collection_end": _iso(end)}


@pytest.fixture
def created_studies_for_cleanup():
    created_studies = []
    yield created_studies
    if not created_studies:
        return
    with httpx.Client(timeout=60.0) as client:
        for study_name_short in reversed(list(dict.fromkeys(created_studies))):
            response = client.delete(
                f"{BASE_URL}/api/admin/studies/{study_name_short}", auth=ADMIN_AUTH
            )
            assert response.status_code in (200, 404), response.text


async def _create_study(client: httpx.AsyncClient, study_name_short: str) -> None:
    payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"Integration Unavailable Study {study_name_short}",
                "name_short": study_name_short,
                "description": "Integration test study for the unavailable reason",
                "day_labels": [
                    {
                        "name": "monday",
                        "display_order": 0,
                        "display_names": {"en": "Monday"},
                    }
                ],
                "study_participant_ids": [],
                "allow_unlisted_participants": True,
                "default_language": "en",
                "supported_languages": ["en"],
                "activities_json_data": {"en": _activities_template()},
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ],
    }
    response = await client.post(
        f"{BASE_URL}/api/admin/studies/import-config", json=payload, auth=ADMIN_AUTH
    )
    assert response.status_code == 200, response.text
    assert response.json()["summary"]["created"] == 1


async def _study_config(
    client: httpx.AsyncClient, study_name_short: str, *, include_unavailable: bool
) -> httpx.Response:
    params = {"lang": "en"}
    if include_unavailable:
        params["include_unavailable"] = "true"
    return await client.get(
        f"{BASE_URL}/api/studies/{study_name_short}/study-config", params=params
    )


@pytest.mark.asyncio
async def test_the_unavailable_reason_matches_the_collection_window(
    created_studies_for_cleanup,
):
    study_name_short = f"it_unavail_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        await _create_study(client, study_name_short)
        created_studies_for_cleanup.append(study_name_short)

        now = datetime.now(timezone.utc)

        # Not started yet: the window opens tomorrow.
        start = (now + timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        response = await client.patch(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/collection-window",
            json=_window(start, start + timedelta(days=7)),
            auth=ADMIN_AUTH,
        )
        assert response.status_code == 200, response.text

        # The old frontend's signal is unchanged ...
        legacy = await _study_config(
            client, study_name_short, include_unavailable=False
        )
        assert legacy.status_code == 403
        assert legacy.json()["detail"]["code"] == "study_unavailable"

        # ... while the rewrite is told why.
        body = (
            await _study_config(client, study_name_short, include_unavailable=True)
        ).json()
        assert body["stage"] == "unavailable"
        assert body["unavailable_reason"] == "not_started"

        # Paused inside its window.
        yesterday = now - timedelta(days=1)
        response = await client.patch(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/collection-window",
            json=_window(yesterday, now + timedelta(days=7)),
            auth=ADMIN_AUTH,
        )
        assert response.status_code == 200, response.text
        response = await client.patch(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/pause", auth=ADMIN_AUTH
        )
        assert response.status_code == 200, response.text
        body = (
            await _study_config(client, study_name_short, include_unavailable=True)
        ).json()
        assert body["stage"] == "unavailable"
        assert body["unavailable_reason"] == "paused"

        # Window over: the date wins over the pause switch.
        response = await client.patch(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/collection-window",
            json=_window(now - timedelta(days=30), now - timedelta(days=1)),
            auth=ADMIN_AUTH,
        )
        assert response.status_code == 200, response.text
        body = (
            await _study_config(client, study_name_short, include_unavailable=True)
        ).json()
        assert body["stage"] == "unavailable"
        assert body["unavailable_reason"] == "ended"

        # An open study is simply available, with no reason.
        response = await client.patch(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/unpause", auth=ADMIN_AUTH
        )
        assert response.status_code == 200, response.text
        response = await client.patch(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/collection-window",
            json=_window(yesterday, now + timedelta(days=7)),
            auth=ADMIN_AUTH,
        )
        assert response.status_code == 200, response.text
        body = (
            await _study_config(client, study_name_short, include_unavailable=True)
        ).json()
        assert body["stage"] == "diary"
        assert body["unavailable_reason"] is None
