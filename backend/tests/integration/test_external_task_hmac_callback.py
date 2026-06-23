"""Integration tests for HMAC-signed external task callbacks."""

import hashlib
import hmac as hmac_lib
import os
import uuid

import httpx
import pytest

from o_timeusediary_backend.settings import settings


BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.strip("/")
ADMIN_AUTH = (settings.admin_username, settings.admin_password)

# Must match the value in TUD_EXTERNAL_TASK_HMAC_SECRETS in all .env files.
TEST_HMAC_SECRET = "integration-test-secret-do-not-use-in-production"
TEST_HMAC_REF = "test_hmac_key"


def _compute_hmac(
    study_name: str,
    participant_id: str,
    task_key: str,
    assigned_token: str,
) -> str:
    """Compute the expected HMAC-SHA256 signature for a callback."""
    message = f"{study_name}|{participant_id}|{task_key}|{assigned_token}"
    return hmac_lib.new(
        TEST_HMAC_SECRET.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


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
async def test_confirm_callback_with_valid_hmac_succeeds():
    """A valid HMAC-signed callback should confirm the external task."""
    study_name_short = f"it_hmac_pos_{uuid.uuid4().hex[:8]}"
    participant_id = "p1"
    task_key = "survey"

    assigned_token = "tok-hmac-valid-1"
    valid_hmac = _compute_hmac(
        study_name_short, participant_id, task_key, assigned_token
    )

    import_payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"HMAC Positive Study {study_name_short}",
                "name_short": study_name_short,
                "description": "Integration test — valid HMAC callback",
                "day_labels": [
                    {
                        "name": "monday",
                        "display_order": 0,
                        "display_names": {"en": "Monday"},
                    }
                ],
                "study_participant_ids": [participant_id],
                "allow_unlisted_participants": False,
                "default_language": "en",
                "supported_languages": ["en"],
                "activities_json_data": {"en": _minimal_activities_payload()},
                "external_tasks": [
                    {
                        "task_key": task_key,
                        "name": {"en": "Survey"},
                        "description": {"en": "Complete the survey."},
                        "outbound_url": (
                            "https://survey.example.org/f/1"
                            "?pid={participant_id}"
                            "&study_name={study_name}"
                            "&task={task_key}"
                            "&token={survey_token}"
                        ),
                        "confirmation_type": "callback",
                        "hmac_secret_reference": TEST_HMAC_REF,
                        "outbound_tokens": [
                            {
                                "name": "survey_token",
                                "by_participant": {participant_id: assigned_token},
                            }
                        ],
                    }
                ],
                "require_diary_before_external_tasks": False,
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ],
    }

    async with httpx.AsyncClient() as client:
        # 1. Import the study
        import_resp = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=import_payload,
            auth=ADMIN_AUTH,
        )
        assert import_resp.status_code == 200, import_resp.text

        # 2. Confirm with valid HMAC
        confirm_resp = await client.post(
            f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/external-tasks/confirm",
            json={
                "task_key": task_key,
                "assigned_token": assigned_token,
                "hmac": valid_hmac,
            },
        )
        assert confirm_resp.status_code == 200, confirm_resp.text
        result = confirm_resp.json()
        assert result["task_key"] == task_key
        assert result["is_confirmed"] is True
        assert result["confirmed_at"] is not None

        # 3. Clean up
        delete_resp = await client.delete(
            f"{BASE_URL}/api/admin/studies/{study_name_short}",
            auth=ADMIN_AUTH,
        )
        assert delete_resp.status_code in {200, 404}


@pytest.mark.asyncio
async def test_confirm_callback_with_invalid_hmac_is_rejected():
    """An invalid HMAC signature must result in 403, leaving the task unconfirmed."""
    study_name_short = f"it_hmac_neg_{uuid.uuid4().hex[:8]}"
    participant_id = "p1"
    task_key = "survey"

    assigned_token = "tok-hmac-bad-1"
    bogus_hmac = "deadbeef" * 8  # intentionally wrong

    import_payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"HMAC Negative Study {study_name_short}",
                "name_short": study_name_short,
                "description": "Integration test — invalid HMAC callback",
                "day_labels": [
                    {
                        "name": "monday",
                        "display_order": 0,
                        "display_names": {"en": "Monday"},
                    }
                ],
                "study_participant_ids": [participant_id],
                "allow_unlisted_participants": False,
                "default_language": "en",
                "supported_languages": ["en"],
                "activities_json_data": {"en": _minimal_activities_payload()},
                "external_tasks": [
                    {
                        "task_key": task_key,
                        "name": {"en": "Survey"},
                        "description": {"en": "Complete the survey."},
                        "outbound_url": (
                            "https://survey.example.org/f/1"
                            "?pid={participant_id}"
                            "&study_name={study_name}"
                            "&task={task_key}"
                            "&token={survey_token}"
                        ),
                        "confirmation_type": "callback",
                        "hmac_secret_reference": TEST_HMAC_REF,
                        "outbound_tokens": [
                            {
                                "name": "survey_token",
                                "by_participant": {participant_id: assigned_token},
                            }
                        ],
                    }
                ],
                "require_diary_before_external_tasks": False,
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ],
    }

    async with httpx.AsyncClient() as client:
        # 1. Import the study
        import_resp = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=import_payload,
            auth=ADMIN_AUTH,
        )
        assert import_resp.status_code == 200, import_resp.text

        # 2. Try to confirm with a bogus HMAC — must be rejected
        confirm_resp = await client.post(
            f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/external-tasks/confirm",
            json={
                "task_key": task_key,
                "assigned_token": assigned_token,
                "hmac": bogus_hmac,
            },
        )
        assert (
            confirm_resp.status_code == 403
        ), f"Expected 403 for invalid HMAC, got {confirm_resp.status_code}: {confirm_resp.text}"

        # 3. Verify the task is still not confirmed
        study_cfg_resp = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/study-config",
            params={"participant_id": participant_id, "lang": "en"},
        )
        assert study_cfg_resp.status_code == 200
        study_cfg = study_cfg_resp.json()
        tasks = study_cfg.get("external_tasks") or []
        assert any(
            t["task_key"] == task_key and t.get("is_confirmed") is not True
            for t in tasks
        ), "Task should still be unconfirmed after invalid HMAC"

        # 4. Clean up
        delete_resp = await client.delete(
            f"{BASE_URL}/api/studies/{study_name_short}",
            auth=ADMIN_AUTH,
        )
        assert delete_resp.status_code in {200, 404}


@pytest.mark.asyncio
async def test_confirm_callback_with_missing_hmac_is_rejected():
    """A callback without HMAC on an HMAC-requiring task must be rejected (400)."""
    study_name_short = f"it_hmac_mis_{uuid.uuid4().hex[:8]}"
    participant_id = "p1"
    task_key = "survey"

    assigned_token = "tok-hmac-missing-1"

    import_payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"HMAC Missing Study {study_name_short}",
                "name_short": study_name_short,
                "description": "Integration test — missing HMAC callback",
                "day_labels": [
                    {
                        "name": "monday",
                        "display_order": 0,
                        "display_names": {"en": "Monday"},
                    }
                ],
                "study_participant_ids": [participant_id],
                "allow_unlisted_participants": False,
                "default_language": "en",
                "supported_languages": ["en"],
                "activities_json_data": {"en": _minimal_activities_payload()},
                "external_tasks": [
                    {
                        "task_key": task_key,
                        "name": {"en": "Survey"},
                        "description": {"en": "Complete the survey."},
                        "outbound_url": (
                            "https://survey.example.org/f/1"
                            "?pid={participant_id}"
                            "&study_name={study_name}"
                            "&task={task_key}"
                            "&token={survey_token}"
                        ),
                        "confirmation_type": "callback",
                        "hmac_secret_reference": TEST_HMAC_REF,
                        "outbound_tokens": [
                            {
                                "name": "survey_token",
                                "by_participant": {participant_id: assigned_token},
                            }
                        ],
                    }
                ],
                "require_diary_before_external_tasks": False,
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ],
    }

    async with httpx.AsyncClient() as client:
        # 1. Import the study
        import_resp = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=import_payload,
            auth=ADMIN_AUTH,
        )
        assert import_resp.status_code == 200, import_resp.text

        # 2. Try to confirm without any HMAC — must be rejected
        confirm_resp = await client.post(
            f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/external-tasks/confirm",
            json={
                "task_key": task_key,
                "assigned_token": assigned_token,
                # deliberately no "hmac" key
            },
        )
        assert (
            confirm_resp.status_code == 400
        ), f"Expected 400 for missing HMAC, got {confirm_resp.status_code}: {confirm_resp.text}"

        # 3. Verify the task is still not confirmed
        study_cfg_resp = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/study-config",
            params={"participant_id": participant_id, "lang": "en"},
        )
        assert study_cfg_resp.status_code == 200
        study_cfg = study_cfg_resp.json()
        tasks = study_cfg.get("external_tasks") or []
        assert any(
            t["task_key"] == task_key and t.get("is_confirmed") is not True
            for t in tasks
        ), "Task should still be unconfirmed after missing HMAC"

        # 4. Clean up
        delete_resp = await client.delete(
            f"{BASE_URL}/api/studies/{study_name_short}",
            auth=ADMIN_AUTH,
        )
        assert delete_resp.status_code in {200, 404}
