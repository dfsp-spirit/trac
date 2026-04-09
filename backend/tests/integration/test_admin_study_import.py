import json
import os
import uuid
import asyncio
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


@pytest.mark.asyncio
async def test_admin_import_study_config_with_embedded_activities_data():
    study_name_short = f"it_blob_{uuid.uuid4().hex[:8]}"
    activities_payload = _load_activities_template()

    payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"Integration Import Study {study_name_short}",
                "name_short": study_name_short,
                "description": "Integration test study created through admin import-config endpoint",
                "day_labels": [
                    {
                        "name": "monday",
                        "display_order": 0,
                        "display_names": {"en": "Monday"},
                    },
                    {
                        "name": "tuesday",
                        "display_order": 1,
                        "display_names": {"en": "Tuesday"},
                    },
                ],
                "study_participant_ids": [],
                "allow_unlisted_participants": True,
                "default_language": "en",
                "supported_languages": ["en"],
                "activities_json_data": {
                    "en": activities_payload,
                },
                "study_text_intro": {"en": "Intro"},
                "study_text_end_completed": {"en": "Done"},
                "study_text_end_skipped": {"en": "Skipped"},
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ],
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        unauthorized_response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=payload,
        )
        assert unauthorized_response.status_code == 401

        import_response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=payload,
            auth=ADMIN_AUTH,
        )
        assert import_response.status_code == 200
        import_data = import_response.json()
        assert import_data["summary"]["created"] == 1
        assert import_data["summary"]["failed"] == 0

        # Small retry loop for environments where API and DB commits are slightly delayed.
        activities_config_response = None
        for _ in range(5):
            activities_config_response = await client.get(
                f"{BASE_URL}/api/studies/{study_name_short}/activities-config",
                params={"lang": "en"},
            )
            if activities_config_response.status_code == 200:
                break
            await asyncio.sleep(0.2)

        assert activities_config_response is not None
        assert activities_config_response.status_code == 200
        activities_data = activities_config_response.json()

        assert "timeline" in activities_data
        assert set(activities_data["timeline"].keys()) == set(activities_payload["timeline"].keys())

        duplicate_response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=payload,
            auth=ADMIN_AUTH,
        )
        assert duplicate_response.status_code == 200
        duplicate_data = duplicate_response.json()
        assert duplicate_data["summary"]["failed"] == 1
        assert any(result["status"] == "failed" for result in duplicate_data["results"])
