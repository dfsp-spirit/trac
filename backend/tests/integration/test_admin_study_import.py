import json
import os
import uuid
import asyncio
import copy
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

        summary_response = await client.get(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/available-activities-summary",
            auth=ADMIN_AUTH,
        )
        assert summary_response.status_code == 200
        summary_data = summary_response.json()
        assert summary_data["available_timeline_count"] > 0
        assert summary_data["available_category_count"] > 0
        assert summary_data["available_activity_count"] > 0
        assert summary_data["available_activity_i18n_count"] > 0

        duplicate_response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=payload,
            auth=ADMIN_AUTH,
        )
        assert duplicate_response.status_code == 200
        duplicate_data = duplicate_response.json()
        assert duplicate_data["summary"]["failed"] == 1
        assert any(result["status"] == "failed" for result in duplicate_data["results"])


@pytest.mark.asyncio
async def test_admin_import_roundtrip_from_runtime_config_export_uses_embedded_activities_data():
    roundtrip_study_name_short = f"it_roundtrip_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        export_response = await client.get(
            f"{BASE_URL}/api/admin/export/studies-runtime-config",
            params={"study_name": "default"},
            auth=ADMIN_AUTH,
        )
        assert export_response.status_code == 200

        export_data = export_response.json()
        assert "studies_config" in export_data
        assert export_data["studies_config"]["studies"]

        exported_study = copy.deepcopy(export_data["studies_config"]["studies"][0])
        exported_activities_json_data = exported_study.get("activities_json_data")
        if not exported_activities_json_data:
            exported_activities_json_data = export_data.get("activities", {}).get(exported_study["name_short"])
        assert exported_activities_json_data
        exported_study["activities_json_data"] = exported_activities_json_data

        exported_study["name"] = f"Roundtrip Import {roundtrip_study_name_short}"
        exported_study["name_short"] = roundtrip_study_name_short
        exported_study.pop("activities_json_files", None)
        exported_study.pop("activities_logged_by_userid", None)

        import_payload = {
            "mode": "create_only",
            "transaction_mode": "all_or_nothing",
            "studies": [exported_study],
        }

        import_response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=import_payload,
            auth=ADMIN_AUTH,
        )
        assert import_response.status_code == 200
        import_data = import_response.json()
        assert import_data["summary"]["created"] == 1
        assert import_data["summary"]["failed"] == 0

        activities_config_response = None
        for _ in range(5):
            activities_config_response = await client.get(
                f"{BASE_URL}/api/studies/{roundtrip_study_name_short}/activities-config",
                params={"lang": exported_study["default_language"]},
            )
            if activities_config_response.status_code == 200:
                break
            await asyncio.sleep(0.2)

        assert activities_config_response is not None
        assert activities_config_response.status_code == 200
        imported_activities_data = activities_config_response.json()

        exported_default_language_data = exported_study["activities_json_data"][exported_study["default_language"]]
        assert set(imported_activities_data["timeline"].keys()) == set(exported_default_language_data["timeline"].keys())

        summary_response = await client.get(
            f"{BASE_URL}/api/admin/studies/{roundtrip_study_name_short}/available-activities-summary",
            auth=ADMIN_AUTH,
        )
        assert summary_response.status_code == 200
        summary_data = summary_response.json()
        assert summary_data["available_timeline_count"] > 0
        assert summary_data["available_category_count"] > 0
        assert summary_data["available_activity_count"] > 0
        assert summary_data["available_activity_i18n_count"] > 0


@pytest.mark.asyncio
async def test_admin_import_rejects_payload_with_both_activity_sources():
    study_name_short = f"it_both_sources_{uuid.uuid4().hex[:8]}"
    activities_payload = _load_activities_template()

    payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"Integration Import Study {study_name_short}",
                "name_short": study_name_short,
                "description": "Integration test study with conflicting activity sources",
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
                "activities_json_files": {
                    "en": "activities_default.json",
                },
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ],
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        import_response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=payload,
            auth=ADMIN_AUTH,
        )
        assert import_response.status_code == 200
        import_data = import_response.json()
        assert import_data["summary"]["created"] == 0
        assert import_data["summary"]["failed"] == 1
        assert any(
            "Provide exactly one of activities_json_data or activities_json_files, not both" in error
            for result in import_data["results"]
            for error in result.get("errors", [])
        )


@pytest.mark.asyncio
async def test_admin_import_accepts_activities_json_files_only():
    study_name_short = f"it_file_source_{uuid.uuid4().hex[:8]}"

    payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"Integration Import Study {study_name_short}",
                "name_short": study_name_short,
                "description": "Integration test study using file-based activities references",
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
                "activities_json_files": {
                    "en": "activities_default.json",
                },
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ],
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        import_response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=payload,
            auth=ADMIN_AUTH,
        )
        assert import_response.status_code == 200
        import_data = import_response.json()
        assert import_data["summary"]["created"] == 1
        assert import_data["summary"]["failed"] == 0

        activities_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/activities-config",
            params={"lang": "en"},
        )
        assert activities_response.status_code == 200
        assert "timeline" in activities_response.json()
