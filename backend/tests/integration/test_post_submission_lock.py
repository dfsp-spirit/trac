"""Integration tests for the post-submission immutability guards.

Once a participant has submitted a study (``study_submitted_at`` set), the
backend must reject further diary edits and consent changes with 403 - the
frontend redirect is only a UX convenience, not the guarantee. External task
confirmations are intentionally left mutable.
"""

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


def _single_day_activities_payload(
    study_name_short: str, participant_id: str, task_key: str, assigned_token: str
) -> dict:
    return {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"Post Submission Lock {study_name_short}",
                "name_short": study_name_short,
                "description": "Integration test — post-submission guards",
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


def _activity_item(
    activity: str = "Activity 100",
    code: int = 100,
    start_minutes: int = 0,
    end_minutes: int = 10,
    days: list[int] | None = None,
) -> dict:
    return {
        "timeline_key": "primary",
        "activity_code": code,
        "activity_name": activity,
        "category": "General",
        "start_minutes": start_minutes,
        "end_minutes": end_minutes,
        "day_label_indexes": days or [0],
    }


async def _submit_day(
    client: httpx.AsyncClient, study: str, participant: str
) -> str:
    """Create one activity on day 0 and return its client_uuid."""
    response = await client.post(
        f"{BASE_URL}/api/studies/{study}/participants/{participant}/activities",
        json={"items": [_activity_item()]},
    )
    assert response.status_code == 201, response.text
    return response.json()["activities"][0]["client_uuid"]


async def _submit_study(client: httpx.AsyncClient, study: str, participant: str) -> None:
    response = await client.post(
        f"{BASE_URL}/api/studies/{study}/participants/{participant}/diary/submit",
    )
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_submitted_study_rejects_activity_edits_and_consent_changes():
    study_name_short = f"it_submitlock_{uuid.uuid4().hex[:8]}"
    participant_id = "p1"
    task_key = "survey"
    assigned_token = "tok-submitlock-1"

    import_payload = _single_day_activities_payload(
        study_name_short, participant_id, task_key, assigned_token
    )

    async with httpx.AsyncClient() as client:
        import_resp = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=import_payload,
            auth=ADMIN_AUTH,
        )
        assert import_resp.status_code == 200, import_resp.text

        try:
            # Consent, one complete day, then submit the study.
            consent_resp = await client.post(
                f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/consent",
                json={"consent_given": True},
            )
            assert consent_resp.status_code == 200, consent_resp.text

            await _submit_day(client, study_name_short, participant_id)
            await _submit_study(client, study_name_short, participant_id)

            # Sanity: the submission is recorded.
            cfg_resp = await client.get(
                f"{BASE_URL}/api/studies/{study_name_short}/study-config",
                params={"participant_id": participant_id},
            )
            assert cfg_resp.status_code == 200
            assert cfg_resp.json()["study_submitted_at"] is not None

            # 1. Diary edits are refused with 403.
            edit_resp = await client.post(
                f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}"
                f"/activities",
                json={"items": [_activity_item(end_minutes=20)]},
            )
            assert edit_resp.status_code == 403, edit_resp.text

            # ...and the submitted data is untouched by the rejected write.
            activities_resp = await client.get(
                f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/diary",
            )
            assert activities_resp.status_code == 200
            stored = [
                row
                for row in activities_resp.json()["activities"]
                if row["day_label_index"] == 0
            ]
            assert len(stored) == 1
            assert stored[0]["end_minutes"] == 10

            # 2. Consent changes are refused with 403 and leave consent intact.
            consent_change_resp = await client.post(
                f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/consent",
                json={"consent_given": False},
            )
            assert consent_change_resp.status_code == 403, consent_change_resp.text

            cfg_after_resp = await client.get(
                f"{BASE_URL}/api/studies/{study_name_short}/study-config",
                params={"participant_id": participant_id},
            )
            assert cfg_after_resp.json()["consent_given"] is True

            # 3. External task confirmations stay mutable after submission.
            valid_hmac = _compute_hmac(
                study_name_short, participant_id, task_key, assigned_token
            )
            confirm_resp = await client.post(
                f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}"
                f"/external-tasks/confirm",
                json={
                    "task_key": task_key,
                    "assigned_token": assigned_token,
                    "hmac": valid_hmac,
                },
            )
            assert confirm_resp.status_code == 200, confirm_resp.text
            assert confirm_resp.json()["is_confirmed"] is True
        finally:
            delete_resp = await client.delete(
                f"{BASE_URL}/api/admin/studies/{study_name_short}",
                auth=ADMIN_AUTH,
            )
            assert delete_resp.status_code in {200, 404}


@pytest.mark.asyncio
async def test_unsubmitted_study_still_allows_activity_edits():
    """Guard rail: the 403 must only apply after an actual submission."""
    study_name_short = f"it_submitlock_ok_{uuid.uuid4().hex[:8]}"
    participant_id = "p1"
    task_key = "survey"
    assigned_token = "tok-submitlock-2"

    import_payload = _single_day_activities_payload(
        study_name_short, participant_id, task_key, assigned_token
    )

    async with httpx.AsyncClient() as client:
        import_resp = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=import_payload,
            auth=ADMIN_AUTH,
        )
        assert import_resp.status_code == 200, import_resp.text

        try:
            client_uuid = await _submit_day(client, study_name_short, participant_id)

            # Edits before submission remain allowed.
            edit_resp = await client.patch(
                f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}"
                f"/activities/{client_uuid}",
                json={"end_minutes": 20},
            )
            assert edit_resp.status_code == 200, edit_resp.text

            activities_resp = await client.get(
                f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/diary",
            )
            assert activities_resp.status_code == 200
            stored = [
                row
                for row in activities_resp.json()["activities"]
                if row["day_label_index"] == 0
            ]
            assert len(stored) == 1
            assert stored[0]["end_minutes"] == 20
        finally:
            delete_resp = await client.delete(
                f"{BASE_URL}/api/admin/studies/{study_name_short}",
                auth=ADMIN_AUTH,
            )
            assert delete_resp.status_code in {200, 404}


def _two_day_payload(
    study_name_short: str, participant_id: str, task_key: str, assigned_token: str
) -> dict:
    """Study variant with a second day label so day-to-day copying is possible."""
    payload = _single_day_activities_payload(
        study_name_short, participant_id, task_key, assigned_token
    )
    payload["studies"][0]["day_labels"].append(
        {"name": "tuesday", "display_order": 1, "display_names": {"en": "Tuesday"}}
    )
    return payload


async def _copy_day(
    client: httpx.AsyncClient,
    study: str,
    participant: str,
    target_day: int,
    source_day: int,
) -> httpx.Response:
    return await client.post(
        f"{BASE_URL}/api/studies/{study}/participants/{participant}/day-copies",
        json={"source_day_index": source_day, "target_day_indexes": [target_day]},
    )


@pytest.mark.asyncio
async def test_submitted_study_rejects_day_copy_overwrite():
    """Copy-day rewrites a whole day, so it must honour the submission lock.

    Regression guard: this endpoint used to bypass ``study_submitted_at`` and
    would silently overwrite an already submitted diary - data a researcher may
    already have exported.
    """
    study_name_short = f"it_copylock_{uuid.uuid4().hex[:8]}"
    participant_id = "p1"

    import_payload = _two_day_payload(
        study_name_short, participant_id, "survey", "tok-copylock-1"
    )

    async with httpx.AsyncClient() as client:
        import_resp = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=import_payload,
            auth=ADMIN_AUTH,
        )
        assert import_resp.status_code == 200, import_resp.text

        try:
            await _submit_day(client, study_name_short, participant_id)

            # Before submission the copy is allowed - it is how the second day
            # gets filled in from the first.
            pre_copy = await _copy_day(
                client, study_name_short, participant_id, 1, 0
            )
            assert pre_copy.status_code == 201, pre_copy.text
            assert pre_copy.json()["results"][0]["status"] == "copied"

            await _submit_study(client, study_name_short, participant_id)

            # The reverse direction overwrites the submitted day -> refused.
            post_copy = await _copy_day(
                client, study_name_short, participant_id, 0, 1
            )
            assert post_copy.status_code == 403, post_copy.text

            # ...and the submitted data is untouched by the rejected copy.
            activities_resp = await client.get(
                f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/diary",
            )
            assert activities_resp.status_code == 200
            stored = [
                row
                for row in activities_resp.json()["activities"]
                if row["day_label_index"] == 0
            ]
            assert len(stored) == 1
            assert stored[0]["end_minutes"] == 10
        finally:
            delete_resp = await client.delete(
                f"{BASE_URL}/api/admin/studies/{study_name_short}",
                auth=ADMIN_AUTH,
            )
            assert delete_resp.status_code in {200, 404}
