import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

from o_timeusediary_backend.settings import settings


BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.strip("/")
ADMIN_AUTH = (settings.admin_username, settings.admin_password)


def _load_activities_template() -> dict:
    backend_root = Path(__file__).resolve().parents[2]
    activities_file = backend_root / "activities_default.json"
    return json.loads(activities_file.read_text(encoding="utf-8"))


def _parse_dt(value: str) -> datetime:
    """Parse ISO datetime values that may use either 'Z' or explicit offsets."""
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


async def _create_study_for_window_tests(
    client: httpx.AsyncClient, study_name_short: str
) -> None:
    activities_payload = _load_activities_template()
    payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"Integration Window Study {study_name_short}",
                "name_short": study_name_short,
                "description": "Integration test study for collection window updates",
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
                "activities_json_data": {
                    "en": activities_payload,
                },
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ],
    }

    response = await client.post(
        f"{BASE_URL}/api/admin/studies/import-config",
        json=payload,
        auth=ADMIN_AUTH,
    )
    assert response.status_code == 200
    response_json = response.json()
    assert response_json["summary"]["created"] == 1
    assert response_json["summary"]["failed"] == 0


@pytest.mark.asyncio
async def test_admin_collection_window_update_and_pause_behavior():
    study_name_short = f"it_window_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        await _create_study_for_window_tests(client, study_name_short)

        unauthorized_response = await client.patch(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/collection-window",
            json={"data_collection_end": "2029-01-10T23:59:59Z"},
        )
        assert unauthorized_response.status_code == 401

        invalid_response = await client.patch(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/collection-window",
            json={
                "data_collection_start": "2029-01-02T00:00:00Z",
                "data_collection_end": "2029-01-02T00:00:00Z",
            },
            auth=ADMIN_AUTH,
        )
        assert invalid_response.status_code == 400
        assert "earlier than" in str(invalid_response.json().get("detail", ""))

        tomorrow = datetime.now(timezone.utc) + timedelta(days=1)
        tomorrow_start = tomorrow.replace(hour=0, minute=0, second=0, microsecond=0)
        tomorrow_end = tomorrow.replace(hour=23, minute=59, second=59, microsecond=0)

        future_window_response = await client.patch(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/collection-window",
            json={
                "data_collection_start": tomorrow_start.isoformat().replace(
                    "+00:00", "Z"
                ),
                "data_collection_end": tomorrow_end.isoformat().replace("+00:00", "Z"),
            },
            auth=ADMIN_AUTH,
        )
        assert future_window_response.status_code == 200
        future_window_json = future_window_response.json()
        updated_start = _parse_dt(
            future_window_json["updated"]["data_collection_start"]
        ).astimezone(timezone.utc)
        updated_end = _parse_dt(
            future_window_json["updated"]["data_collection_end"]
        ).astimezone(timezone.utc)
        assert updated_start == tomorrow_start
        assert updated_end == tomorrow_end
        assert future_window_json["is_currently_collecting"] is False

        yesterday = datetime.now(timezone.utc) - timedelta(days=1)
        day_before_yesterday = datetime.now(timezone.utc) - timedelta(days=2)
        pause_start = day_before_yesterday.replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        yesterday_end = yesterday.replace(hour=23, minute=59, second=59, microsecond=0)

        paused_response = await client.patch(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/collection-window",
            json={
                "data_collection_start": pause_start.isoformat().replace("+00:00", "Z"),
                "data_collection_end": yesterday_end.isoformat().replace("+00:00", "Z"),
            },
            auth=ADMIN_AUTH,
        )
        assert paused_response.status_code == 200
        paused_json = paused_response.json()
        paused_start = _parse_dt(
            paused_json["updated"]["data_collection_start"]
        ).astimezone(timezone.utc)
        paused_end = _parse_dt(
            paused_json["updated"]["data_collection_end"]
        ).astimezone(timezone.utc)
        assert paused_start == pause_start
        assert paused_end == yesterday_end
        assert paused_json["is_currently_collecting"] is False


@pytest.mark.asyncio
async def test_admin_pause_and_unpause_study():
    study_name_short = f"it_pause_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        await _create_study_for_window_tests(client, study_name_short)

        # Pause requires auth
        unauth = await client.patch(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/pause"
        )
        assert unauth.status_code == 401

        # Pause study
        pause_resp = await client.patch(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/pause",
            auth=ADMIN_AUTH,
        )
        assert pause_resp.status_code == 200
        assert pause_resp.json()["is_paused"] is True

        # Pausing again should return 400
        double_pause = await client.patch(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/pause",
            auth=ADMIN_AUTH,
        )
        assert double_pause.status_code == 400

        # Unpause study
        unpause_resp = await client.patch(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/unpause",
            auth=ADMIN_AUTH,
        )
        assert unpause_resp.status_code == 200
        assert unpause_resp.json()["is_paused"] is False

        # Unpausing again should return 400
        double_unpause = await client.patch(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/unpause",
            auth=ADMIN_AUTH,
        )
        assert double_unpause.status_code == 400

        # Pause non-existent study returns 404
        not_found = await client.patch(
            f"{BASE_URL}/api/admin/studies/nonexistent_study_xyz/pause",
            auth=ADMIN_AUTH,
        )
        assert not_found.status_code == 404
