import os
import uuid

import httpx
import pytest
import pytest_asyncio

from o_timeusediary_backend.settings import settings


BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.strip("/")


async def _get_first_activity_selection(client: httpx.AsyncClient, study_name_short: str) -> dict:
    activities_response = await client.get(f"{BASE_URL}/api/studies/{study_name_short}/activities-config")
    assert activities_response.status_code == 200
    activities_data = activities_response.json()
    assert "timeline" in activities_data

    timeline_key = next(iter(activities_data["timeline"].keys()))
    timeline_cfg = activities_data["timeline"][timeline_key]
    timeline_mode = timeline_cfg["mode"]
    first_category = timeline_cfg["categories"][0]
    first_activity = first_category["activities"][0]
    first_code = first_activity["code"]

    return {
        "timeline_key": timeline_key,
        "timeline_mode": timeline_mode,
        "category_name": first_category["name"],
        "activity_name": first_activity["name"],
        "activity_code": first_code,
    }


@pytest_asyncio.fixture
async def prepared_submission_context():
    async with httpx.AsyncClient() as client:
        study_name_short = "default"

        study_cfg_response = await client.get(f"{BASE_URL}/api/studies/{study_name_short}/study-config")
        assert study_cfg_response.status_code == 200
        study_cfg = study_cfg_response.json()
        assert "day_labels" in study_cfg
        day_label_name = study_cfg["day_labels"][0]["name"]

        selection = await _get_first_activity_selection(client, study_name_short)

        participant_id = f"it_{uuid.uuid4().hex[:8]}"

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
            f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/day_labels/{day_label_name}/activities",
            json={"activities": [activity_item]},
        )
        assert submit_response.status_code == 200
        submit_data = submit_response.json()
        for key in ["message", "study", "participant", "day_label", "operation"]:
            assert key in submit_data

    return {
        "study_name_short": study_name_short,
        "participant_id": participant_id,
        "day_label_name": day_label_name,
    }


@pytest.mark.asyncio
async def test_public_endpoints_are_available_with_expected_structure():
    async with httpx.AsyncClient() as client:
        root_response = await client.get(f"{BASE_URL}/api")
        assert root_response.status_code == 200
        root_data = root_response.json()
        assert "message" in root_data

        health_response = await client.get(f"{BASE_URL}/api/health")
        assert health_response.status_code == 200
        health_data = health_response.json()
        for key in ["status", "all_studies_count", "open_studies_count", "tud_version"]:
            assert key in health_data

        docs_redirect_response = await client.get(f"{BASE_URL}/api/docs", follow_redirects=False)
        assert docs_redirect_response.status_code in {302, 307}
        assert "location" in docs_redirect_response.headers

        open_studies_response = await client.get(f"{BASE_URL}/api/active_open_study_names")
        assert open_studies_response.status_code == 200
        open_studies_data = open_studies_response.json()
        assert isinstance(open_studies_data, list)
        if open_studies_data:
            assert "name_short" in open_studies_data[0]

        favicon_response = await client.get(f"{BASE_URL}/favicon.ico")
        assert favicon_response.status_code in {200, 204}


@pytest.mark.asyncio
async def test_study_and_participant_endpoints_are_available_with_expected_structure(prepared_submission_context):
    study_name_short = prepared_submission_context["study_name_short"]
    participant_id = prepared_submission_context["participant_id"]
    day_label_name = prepared_submission_context["day_label_name"]

    async with httpx.AsyncClient() as client:
        study_cfg_response = await client.get(f"{BASE_URL}/api/studies/{study_name_short}/study-config")
        assert study_cfg_response.status_code == 200
        study_cfg = study_cfg_response.json()
        for key in [
            "study_name",
            "study_name_short",
            "allow_unlisted_participants",
            "default_language",
            "supported_languages",
            "selected_language",
            "timelines",
            "day_labels",
            "study_days_count",
        ]:
            assert key in study_cfg

        assert isinstance(study_cfg["supported_languages"], list)
        assert study_cfg["default_language"] in study_cfg["supported_languages"]

        selected_lang = "sv" if "sv" in study_cfg["supported_languages"] else study_cfg["default_language"]
        study_cfg_lang_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/study-config",
            params={"lang": selected_lang},
        )
        assert study_cfg_lang_response.status_code == 200
        study_cfg_lang = study_cfg_lang_response.json()
        assert study_cfg_lang["selected_language"] == selected_lang

        activities_cfg_response = await client.get(f"{BASE_URL}/api/studies/{study_name_short}/activities-config")
        assert activities_cfg_response.status_code == 200
        activities_cfg = activities_cfg_response.json()
        for key in ["general", "timeline"]:
            assert key in activities_cfg

        activities_cfg_lang_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/activities-config",
            params={"lang": selected_lang},
        )
        assert activities_cfg_lang_response.status_code == 200

        participant_activities_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/activities",
            params={"day_label_name": day_label_name},
        )
        assert participant_activities_response.status_code == 200
        participant_activities = participant_activities_response.json()
        for key in [
            "study",
            "participant",
            "day_label",
            "timelines_in_study",
            "activities",
            "has_template",
            "template_activities",
        ]:
            assert key in participant_activities


@pytest.mark.asyncio
async def test_admin_endpoints_are_available_with_auth_and_expected_structure(prepared_submission_context):
    study_name_short = prepared_submission_context["study_name_short"]

    async with httpx.AsyncClient() as client:
        unauthorized_admin = await client.get(f"{BASE_URL}/admin")
        assert unauthorized_admin.status_code == 401

        admin_response = await client.get(
            f"{BASE_URL}/admin",
            auth=(settings.admin_username, settings.admin_password),
        )
        assert admin_response.status_code == 200
        assert "text/html" in admin_response.headers.get("Content-Type", "")

        export_response = await client.get(
            f"{BASE_URL}/api/admin/export/{study_name_short}/activities",
            params={"format": "json"},
            auth=(settings.admin_username, settings.admin_password),
        )
        assert export_response.status_code == 200
        export_data = export_response.json()
        for key in ["metadata", "data"]:
            assert key in export_data

        runtime_config_export_response = await client.get(
            f"{BASE_URL}/api/admin/export/studies-runtime-config",
            params={"study_name": study_name_short},
            auth=(settings.admin_username, settings.admin_password),
        )
        assert runtime_config_export_response.status_code == 200
        runtime_config_export_data = runtime_config_export_response.json()
        assert "studies_config" in runtime_config_export_data
        assert "activities" in runtime_config_export_data
        assert "studies" in runtime_config_export_data["studies_config"]
        assert len(runtime_config_export_data["studies_config"]["studies"]) == 1

        exported_study = runtime_config_export_data["studies_config"]["studies"][0]
        for key in ["name", "name_short", "logged_activities", "ratings", "study_participant_ids"]:
            assert key in exported_study

        assert study_name_short in runtime_config_export_data["activities"]
