import os
import uuid

import httpx
import pytest

from o_timeusediary_backend.settings import settings


BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.strip("/")
ADMIN_AUTH = (settings.admin_username, settings.admin_password)


async def _get_first_activity_selection(
    client: httpx.AsyncClient, study_name_short: str
):
    cfg_response = await client.get(
        f"{BASE_URL}/api/studies/{study_name_short}/activities-config"
    )
    assert cfg_response.status_code == 200
    cfg = cfg_response.json()

    timeline_cfg = cfg.get("timeline") or {}
    for timeline_key, timeline_value in timeline_cfg.items():
        categories = timeline_value.get("categories") or []
        for category in categories:
            category_name = category.get("name")
            activities = category.get("activities") or []
            for activity in activities:
                activity_name = activity.get("name")
                activity_code = activity.get("code")
                if not activity_name:
                    continue
                return {
                    "timeline_key": timeline_key,
                    "timeline_mode": timeline_value.get("mode") or "single-choice",
                    "category_name": category_name,
                    "activity_name": activity_name,
                    "activity_code": activity_code,
                }

    raise AssertionError("Could not find any selectable activity in activities-config")


@pytest.mark.asyncio
async def test_admin_reset_participant_data_endpoint_resets_submission_and_flags():
    study_name_short = "default"
    participant_id = f"it_reset_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient() as client:
        assign_response = await client.post(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/assign-participants",
            json={"participant_ids": [participant_id]},
            auth=ADMIN_AUTH,
        )
        assert assign_response.status_code == 200

        consent_response = await client.post(
            f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/consent",
            json={"consent_given": True},
        )
        assert consent_response.status_code == 200

        instructions_response = await client.post(
            f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/instructions/complete",
            json={"completed": True},
        )
        assert instructions_response.status_code == 200

        study_cfg_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/study-config",
            params={"participant_id": participant_id},
        )
        assert study_cfg_response.status_code == 200
        study_cfg = study_cfg_response.json()
        day_label_names = [day_label["name"] for day_label in study_cfg["day_labels"]]
        assert day_label_names

        selection = await _get_first_activity_selection(client, study_name_short)

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

        # Every study day needs data before the study can be submitted.
        for day_label_name in day_label_names:
            submit_response = await client.post(
                f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/day_labels/{day_label_name}/activities",
                json={"activities": [activity_item]},
            )
            assert submit_response.status_code == 200

        # Submit the study: without a reset the participant would stay submitted
        # and the frontend would keep redirecting them away from the diary.
        study_submit_response = await client.post(
            f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/submit",
        )
        assert study_submit_response.status_code == 200

        cfg_before_reset_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/study-config",
            params={"participant_id": participant_id},
        )
        assert cfg_before_reset_response.status_code == 200
        cfg_before_reset = cfg_before_reset_response.json()
        assert cfg_before_reset["instructions_completed"] is True
        assert cfg_before_reset["consent_given"] is True
        assert cfg_before_reset["participant_has_completed_study"] is True
        assert cfg_before_reset["study_submitted_at"] is not None

        reset_response = await client.delete(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/participants/{participant_id}/data",
            auth=ADMIN_AUTH,
        )
        assert reset_response.status_code == 200
        reset_data = reset_response.json()
        assert reset_data["study_name_short"] == study_name_short
        assert reset_data["participant_id"] == participant_id
        assert reset_data["deleted_activity_rows"] >= 1
        assert "reset_external_task_assignment_rows" in reset_data
        assert reset_data["association_reset"] is True
        assert reset_data["submission_reset"] is True

        activities_after_reset_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/activities",
            params={"day_label_index": 0},
        )
        assert activities_after_reset_response.status_code == 200
        activities_after_reset = activities_after_reset_response.json()
        assert activities_after_reset["activities"] == []

        cfg_after_reset_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/study-config",
            params={"participant_id": participant_id},
        )
        assert cfg_after_reset_response.status_code == 200
        cfg_after_reset = cfg_after_reset_response.json()
        assert cfg_after_reset["instructions_completed"] is False
        assert cfg_after_reset["consent_given"] is None
        assert cfg_after_reset["participant_has_completed_study"] is False
        assert cfg_after_reset["study_submitted_at"] is None

        # Resetting again is idempotent and reports that there was no
        # submission left to clear.
        second_reset_response = await client.delete(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/participants/{participant_id}/data",
            auth=ADMIN_AUTH,
        )
        assert second_reset_response.status_code == 200
        second_reset_data = second_reset_response.json()
        assert second_reset_data["deleted_activity_rows"] == 0
        assert second_reset_data["submission_reset"] is False
