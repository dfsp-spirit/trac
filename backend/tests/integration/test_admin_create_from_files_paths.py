import json
import os
import uuid

import httpx
import pytest

from o_timeusediary_backend.settings import settings


BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.strip("/")
ADMIN_AUTH = (settings.admin_username, settings.admin_password)


def _minimal_activities_payload() -> dict:
    return {
        "general": {"app_name": "TRAC", "version": "1.0", "language": "en"},
        "timeline": {
            "primary": {
                "name": "Primary",
                "description": "",
                "mode": "single-choice",
                "min_coverage": 0,
                "categories": [
                    {
                        "name": "General",
                        "activities": [
                            {
                                "name": "Activity 100",
                                "code": 100,
                                "label": "activity-100",
                                "color": "#000000",
                                "childItems": [],
                            }
                        ],
                    }
                ],
            }
        },
    }


@pytest.mark.asyncio
async def test_create_from_files_accepts_windows_style_subdir_activity_references():
    study_name_short = f"it_paths_{uuid.uuid4().hex[:8]}"

    studies_config = {
        "studies": [
            {
                "name": f"Path Import Study {study_name_short}",
                "name_short": study_name_short,
                "description": "Integration test for studies_config path separator handling",
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
                    "en": "activities\\imports\\activities_test.en.json"
                },
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ]
    }

    studies_config_bytes = json.dumps(studies_config).encode("utf-8")
    activities_bytes = json.dumps(_minimal_activities_payload()).encode("utf-8")

    async with httpx.AsyncClient() as client:
        try:
            create_response = await client.post(
                f"{BASE_URL}/api/admin/studies/create-from-files",
                auth=ADMIN_AUTH,
                data={"mode": "full_study"},
                files=[
                    (
                        "studies_config_file",
                        (
                            "studies_config.json",
                            studies_config_bytes,
                            "application/json",
                        ),
                    ),
                    (
                        "activities_files",
                        (
                            "activities_test.en.json",
                            activities_bytes,
                            "application/json",
                        ),
                    ),
                ],
            )

            assert create_response.status_code == 200
            create_payload = create_response.json()
            assert create_payload.get("ok") is True
            assert (
                create_payload.get("summary", {}).get("study_name_short")
                == study_name_short
            )

            activities_config_response = await client.get(
                f"{BASE_URL}/api/studies/{study_name_short}/activities-config"
            )
            assert activities_config_response.status_code == 200
            activities_config = activities_config_response.json()
            assert "timeline" in activities_config
            assert "primary" in activities_config["timeline"]
        finally:
            await client.delete(
                f"{BASE_URL}/api/admin/studies/{study_name_short}",
                auth=ADMIN_AUTH,
            )


@pytest.mark.asyncio
async def test_validate_full_study_returns_the_review_fields():
    """The review panel on /admin/file-validation reads these summary values."""
    study_name_short = f"it_review_{uuid.uuid4().hex[:8]}"

    studies_config = {
        "studies": [
            {
                "name": f"Review Fields Study {study_name_short}",
                "name_short": study_name_short,
                "description": "Integration test for the validation review summary",
                "day_labels": [
                    {
                        "name": "monday",
                        "display_order": 0,
                        "display_names": {"en": "Monday"},
                    }
                ],
                "study_participant_ids": [],
                "allow_unlisted_participants": False,
                "default_language": "en",
                "supported_languages": ["en"],
                "activities_json_data": {"en": _minimal_activities_payload()},
                "require_consent": True,
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ]
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{BASE_URL}/api/admin/validate/files",
            data={"mode": "full_study_embedded"},
            files={
                "studies_config_file": (
                    "studies_config.json",
                    json.dumps(studies_config),
                    "application/json",
                )
            },
            auth=ADMIN_AUTH,
        )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["ok"] is True, payload
    summary = payload["summary"]

    assert summary["study_name"] == f"Review Fields Study {study_name_short}"
    assert summary["study_name_short"] == study_name_short
    assert summary["allow_unlisted_participants"] is False
    assert summary["require_consent"] is True
    assert summary["day_label_count"] == 1
    assert summary["external_task_count"] == 0
    assert summary["creation_eligible"] is True
