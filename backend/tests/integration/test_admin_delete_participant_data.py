import asyncio
import json
import os
import uuid
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


def _first_activity_selection(cfg: dict) -> dict:
    timeline_key = next(iter(cfg["timeline"].keys()))
    timeline_cfg = cfg["timeline"][timeline_key]
    first_category = timeline_cfg["categories"][0]
    first_activity = first_category["activities"][0]
    return {
        "timeline_key": timeline_key,
        "timeline_mode": timeline_cfg["mode"],
        "category_name": first_category["name"],
        "activity_name": first_activity["name"],
        "activity_code": first_activity["code"],
    }


@pytest.fixture
def created_studies_for_cleanup():
    created_studies = []
    yield created_studies

    if not created_studies:
        return

    unique_names = list(dict.fromkeys(created_studies))
    with httpx.Client(timeout=60.0) as client:
        for study_name_short in reversed(unique_names):
            delete_response = client.delete(
                f"{BASE_URL}/api/admin/studies/{study_name_short}",
                auth=ADMIN_AUTH,
            )
            # Ignore already-deleted studies, but fail on unexpected server errors.
            if delete_response.status_code not in (200, 404):
                raise AssertionError(
                    f"Unexpected cleanup status for study '{study_name_short}': "
                    f"{delete_response.status_code}"
                )


@pytest.mark.asyncio
async def test_admin_delete_all_participant_data_keeps_study_operational(
    created_studies_for_cleanup,
):
    """Deleting all participant data removes activities, external-task
    assignments and study-participant associations, but keeps the study
    itself and its configuration (day labels, activities catalog, external
    task definitions) intact."""
    study_name_short = f"it_deldata_{uuid.uuid4().hex[:8]}"
    participant_id = f"it_delpid_{uuid.uuid4().hex[:8]}"
    activities_payload = _load_activities_template()

    payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"Delete Participant Data Study {study_name_short}",
                "name_short": study_name_short,
                "description": "Integration test study for delete-all-participant-data endpoint",
                "day_labels": [
                    {
                        "name": "monday",
                        "display_order": 0,
                        "display_names": {"en": "Monday"},
                    }
                ],
                "study_participant_ids": [participant_id],
                "allow_unlisted_participants": False,
                "external_tasks": [
                    {
                        "task_key": "payment",
                        "name": {"en": "Payment Survey"},
                        "description": {"en": "Complete payment handoff."},
                        "outbound_url": "https://example.org/payment?pid={participant_id}&study={study_name}&task={task_key}&survey_token={survey_token}",
                        "confirmation_type": "none",
                        "outbound_tokens": [
                            {
                                "name": "survey_token",
                                "by_participant": {
                                    participant_id: f"tok-{uuid.uuid4().hex[:8]}",
                                },
                            }
                        ],
                    }
                ],
                "default_language": "en",
                "supported_languages": ["en"],
                "activities_json_data": {"en": activities_payload},
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ],
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        # --- Create the throwaway study ---
        import_response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=payload,
            auth=ADMIN_AUTH,
        )
        assert import_response.status_code == 200
        assert import_response.json()["summary"]["created"] == 1
        created_studies_for_cleanup.append(study_name_short)

        # --- Reseed external task assignments for the participant ---
        reseed_response = await client.post(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/participants/{participant_id}/external-tasks/reseed",
            auth=ADMIN_AUTH,
        )
        assert reseed_response.status_code == 200
        assert reseed_response.json()["assignment_count"] >= 1

        # --- Submit one activity (closed study: participant must be listed) ---
        activities_config_response = None
        for _ in range(5):
            activities_config_response = await client.get(
                f"{BASE_URL}/api/studies/{study_name_short}/activities-config",
                params={"lang": "en", "participant_id": participant_id},
            )
            if activities_config_response.status_code == 200:
                break
            await asyncio.sleep(0.2)
        assert activities_config_response is not None
        assert activities_config_response.status_code == 200
        selection = _first_activity_selection(activities_config_response.json())

        activity_item = {
            "timeline_key": selection["timeline_key"],
            "activity": selection["activity_name"],
            "category": selection["category_name"],
            "start_minutes": 0,
            "end_minutes": 10,
            "mode": selection["timeline_mode"],
        }
        if selection["timeline_mode"] == "single-choice":
            activity_item["code"] = selection["activity_code"]
        else:
            activity_item["codes"] = [selection["activity_code"]]

        submit_response = await client.post(
            f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/day_labels/monday/activities",
            json={"activities": [activity_item]},
        )
        assert submit_response.status_code == 200

        # Sanity: activities are present before deletion.
        before_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/activities",
            params={"day_label_index": 0},
        )
        assert before_response.status_code == 200
        assert before_response.json()["activities"]

        # --- Delete all participant data ---
        delete_response = await client.delete(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/participant-data",
            auth=ADMIN_AUTH,
        )
        assert delete_response.status_code == 200
        delete_data = delete_response.json()
        assert delete_data["study_name_short"] == study_name_short
        assert delete_data["deleted_activities"] >= 1
        assert delete_data["deleted_external_task_assignments"] >= 1
        assert delete_data["deleted_participant_associations"] >= 1

        # --- Participant association is gone (closed study -> no longer authorized) ---
        after_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/activities",
            params={"day_label_index": 0},
        )
        assert after_response.status_code == 403

        # --- Export now finds no activities ---
        export_response = await client.get(
            f"{BASE_URL}/api/admin/export/{study_name_short}/activities",
            params={"format": "json"},
            auth=ADMIN_AUTH,
        )
        assert export_response.status_code == 404

        # --- Study is still operational: config preserved ---
        # Admin study detail page (which hosts the delete buttons) still renders.
        detail_response = await client.get(
            f"{BASE_URL}/admin/study/{study_name_short}",
            auth=ADMIN_AUTH,
        )
        assert detail_response.status_code == 200
        assert study_name_short in detail_response.text

        # Activities catalog (available activities) still present.
        summary_response = await client.get(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/available-activities-summary",
            auth=ADMIN_AUTH,
        )
        assert summary_response.status_code == 200

        # External task definitions are preserved (runtime config export).
        runtime_response = await client.get(
            f"{BASE_URL}/api/admin/export/studies-runtime-config",
            params={"study_name": study_name_short},
            auth=ADMIN_AUTH,
        )
        assert runtime_response.status_code == 200
        exported_study = runtime_response.json()["studies_config"]["studies"][0]
        assert any(
            task["task_key"] == "payment"
            for task in exported_study["external_tasks"]
        )
