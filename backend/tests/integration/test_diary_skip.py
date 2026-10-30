"""Integration tests for skipping the diary (D41).

Skipping is a server action, not the old redirect: it closes the diary, records
why, and the stage machine routes the participant onwards - to the tasks when the
study allows that, otherwise straight to the thanks page (with the study's
"skipped" text). The rule that matters most: a study requiring the diary before
its external tasks keeps those tasks closed for a skipper.
"""

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
    return json.loads(
        (backend_root / "activities_default.json").read_text(encoding="utf-8")
    )


@pytest.fixture
def created_studies_for_cleanup():
    created = []
    yield created
    if not created:
        return
    with httpx.Client(timeout=60.0) as client:
        for study_name_short in reversed(list(dict.fromkeys(created))):
            response = client.delete(
                f"{BASE_URL}/api/admin/studies/{study_name_short}", auth=ADMIN_AUTH
            )
            assert response.status_code in (200, 404), response.text


async def _import_study(
    client: httpx.AsyncClient,
    study_name_short: str,
    *,
    allow_skip_timeuse: bool = True,
    require_diary_before_external_tasks: bool = False,
    task_participant_id: str | None = None,
) -> None:
    study = {
        "name": f"Skip Test Study {study_name_short}",
        "name_short": study_name_short,
        "description": "Integration test for skipping the diary",
        "day_labels": [
            {"name": "monday", "display_order": 0, "display_names": {"en": "Monday"}}
        ],
        # A study with external tasks is closed: tokens are assigned per
        # participant, which is also what creates the pending assignment.
        "study_participant_ids": [task_participant_id] if task_participant_id else [],
        "allow_unlisted_participants": task_participant_id is None,
        "default_language": "en",
        "supported_languages": ["en"],
        "activities_json_data": {"en": _load_activities_template()},
        "study_text_intro": {"en": "Intro"},
        "study_text_end_completed": {"en": "Thank you, submitted."},
        "study_text_end_skipped": {"en": "Thank you, you skipped the diary."},
        "study_text_end_noconsent": {"en": "No consent."},
        "data_collection_start": "2024-01-01T00:00:00Z",
        "data_collection_end": "2028-12-31T23:59:59Z",
        "allow_skip_timeuse": allow_skip_timeuse,
        "require_diary_before_external_tasks": require_diary_before_external_tasks,
    }
    if task_participant_id is not None:
        # A token assigned to this participant is what creates the pending
        # assignment the "diary before tasks" rule is about.
        study["external_tasks"] = [
            {
                "task_key": "questionnaire",
                "name": {"en": "Questionnaire"},
                "description": {"en": "A questionnaire in another app."},
                "outbound_url": (
                    "https://example.org/q?participant_id={participant_id}"
                    "&token={survey_token}"
                ),
                "confirmation_type": "none",
                "outbound_tokens": [
                    {
                        "name": "survey_token",
                        "by_participant": {task_participant_id: "tok-skip-test"},
                    }
                ],
            }
        ]

    response = await client.post(
        f"{BASE_URL}/api/admin/studies/import-config",
        json={
            "mode": "create_only",
            "transaction_mode": "all_or_nothing",
            "studies": [study],
        },
        auth=ADMIN_AUTH,
    )
    assert response.status_code == 200, response.text
    summary = response.json()["summary"]
    assert summary["created"] == 1, summary
    assert summary["failed"] == 0, response.json()


async def _skip(
    client: httpx.AsyncClient,
    study_name_short: str,
    participant_id: str,
    **body,
) -> httpx.Response:
    return await client.post(
        f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}"
        "/diary/skip",
        json=body or None,
    )


async def _study_config(
    client: httpx.AsyncClient, study_name_short: str, participant_id: str
) -> dict:
    response = await client.get(
        f"{BASE_URL}/api/studies/{study_name_short}/study-config",
        params={"participant_id": participant_id, "lang": "en"},
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_skipping_closes_the_diary_and_moves_to_done(
    created_studies_for_cleanup,
):
    study_name_short = f"it_skip_{uuid.uuid4().hex[:8]}"
    created_studies_for_cleanup.append(study_name_short)
    participant_id = f"it_skip_a_{uuid.uuid4().hex[:6]}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        await _import_study(client, study_name_short)

        # Before: the participant is in the diary, and the option is offered.
        before = await _study_config(client, study_name_short, participant_id)
        assert before["stage"] == "diary"
        assert before["allow_skip_timeuse"] is True
        assert before["study_skipped_at"] is None

        skip = await _skip(
            client,
            study_name_short,
            participant_id,
            reason_code="technical_problem",
            reason_note="The timeline did not load on my tablet.",
        )
        assert skip.status_code == 200, skip.text
        payload = skip.json()
        assert payload["already_closed"] is False
        assert payload["study_submitted_at"]
        assert payload["skipped_at"]
        assert payload["stage"] == "done"

        after = await _study_config(client, study_name_short, participant_id)
        assert after["stage"] == "done"
        assert after["done_reason"] == "skipped"
        assert after["study_skipped_at"] is not None
        # The study's own "you skipped" text is what the thanks page shows.
        assert after["study_text_end_skipped"] == "Thank you, you skipped the diary."

        # The diary is closed: writing is refused like after a submission.
        blocked = await client.post(
            f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}"
            "/activities",
            json={"items": []},
        )
        assert blocked.status_code in (400, 403, 409), blocked.text


@pytest.mark.asyncio
async def test_the_reason_is_optional_and_validated(created_studies_for_cleanup):
    study_name_short = f"it_skip_{uuid.uuid4().hex[:8]}"
    created_studies_for_cleanup.append(study_name_short)
    participant_without_reason = f"it_skip_b_{uuid.uuid4().hex[:6]}"
    participant_with_bad_reason = f"it_skip_c_{uuid.uuid4().hex[:6]}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        await _import_study(client, study_name_short)

        # No body at all: skipping must never require an explanation.
        plain = await _skip(client, study_name_short, participant_without_reason)
        assert plain.status_code == 200, plain.text
        assert plain.json()["stage"] == "done"

        unknown = await _skip(
            client, study_name_short, participant_with_bad_reason, reason_code="because"
        )
        assert unknown.status_code == 400, unknown.text
        assert unknown.json()["detail"]["code"] == "diary.unknown_skip_reason"


@pytest.mark.asyncio
async def test_a_study_without_the_option_refuses_to_skip(
    created_studies_for_cleanup,
):
    study_name_short = f"it_skip_{uuid.uuid4().hex[:8]}"
    created_studies_for_cleanup.append(study_name_short)
    participant_id = f"it_skip_d_{uuid.uuid4().hex[:6]}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        await _import_study(client, study_name_short, allow_skip_timeuse=False)

        config = await _study_config(client, study_name_short, participant_id)
        assert config["allow_skip_timeuse"] is False

        response = await _skip(client, study_name_short, participant_id)
        assert response.status_code == 400, response.text
        assert response.json()["detail"]["code"] == "diary.skip_not_allowed"


@pytest.mark.asyncio
async def test_skipping_twice_is_idempotent(created_studies_for_cleanup):
    study_name_short = f"it_skip_{uuid.uuid4().hex[:8]}"
    created_studies_for_cleanup.append(study_name_short)
    participant_id = f"it_skip_e_{uuid.uuid4().hex[:6]}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        await _import_study(client, study_name_short)
        first = await _skip(client, study_name_short, participant_id)
        assert first.status_code == 200, first.text

        second = await _skip(
            client, study_name_short, participant_id, reason_code="other"
        )
        assert second.status_code == 200, second.text
        payload = second.json()
        assert payload["already_closed"] is True
        assert payload["skipped_at"] == first.json()["skipped_at"]


@pytest.mark.asyncio
async def test_a_skip_does_not_unlock_tasks_that_require_the_diary(
    created_studies_for_cleanup,
):
    """The rule from the plan: skipping is not a filled diary."""
    study_name_short = f"it_skip_{uuid.uuid4().hex[:8]}"
    created_studies_for_cleanup.append(study_name_short)
    participant_id = f"it_skip_f_{uuid.uuid4().hex[:6]}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        await _import_study(
            client,
            study_name_short,
            require_diary_before_external_tasks=True,
            task_participant_id=participant_id,
        )

        skip = await _skip(client, study_name_short, participant_id)
        assert skip.status_code == 200, skip.text
        # A task is still owed, but it cannot be reached: `done`, not `tasks`.
        assert skip.json()["stage"] == "done"

        config = await _study_config(client, study_name_short, participant_id)
        assert config["stage"] == "done"
        assert config["done_reason"] == "skipped"
        # A locked task has no launch URL - that is how the payload says it.
        for task in config["external_tasks"]:
            assert task["continuation_url"] == "", task


@pytest.mark.asyncio
async def test_a_skip_reaches_the_tasks_when_the_study_allows_it(
    created_studies_for_cleanup,
):
    """The case `allow_skip_timeuse` exists for: the diary is one part of a study."""
    study_name_short = f"it_skip_{uuid.uuid4().hex[:8]}"
    created_studies_for_cleanup.append(study_name_short)
    participant_id = f"it_skip_g_{uuid.uuid4().hex[:6]}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        await _import_study(
            client,
            study_name_short,
            require_diary_before_external_tasks=False,
            task_participant_id=participant_id,
        )

        skip = await _skip(client, study_name_short, participant_id)
        assert skip.status_code == 200, skip.text
        assert skip.json()["stage"] == "tasks"


@pytest.mark.asyncio
async def test_the_skip_is_exported_with_its_reason(created_studies_for_cleanup):
    study_name_short = f"it_skip_{uuid.uuid4().hex[:8]}"
    created_studies_for_cleanup.append(study_name_short)
    participant_id = f"it_skip_h_{uuid.uuid4().hex[:6]}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        await _import_study(client, study_name_short)
        response = await _skip(
            client,
            study_name_short,
            participant_id,
            reason_code="did_not_understand",
            reason_note="I was not sure which activity to pick.",
        )
        assert response.status_code == 200, response.text

        export = await client.get(
            f"{BASE_URL}/api/admin/export/{study_name_short}/participants",
            params={"format": "json"},
            auth=ADMIN_AUTH,
        )
        assert export.status_code == 200, export.text
        record = export.json()["data"][0]

    assert record["participant_skipped_at"] is not None
    assert record["participant_skip_reason_code"] == "did_not_understand"
    assert record["participant_skip_note"] == "I was not sure which activity to pick."
    # A skipped diary is closed, but not a filled one.
    assert record["participant_study_submitted_at"] is not None
    assert record["participant_diary_completed_at"] is None


@pytest.mark.asyncio
async def test_a_study_that_cannot_skip_exports_no_skip_columns(
    created_studies_for_cleanup,
):
    study_name_short = f"it_skip_{uuid.uuid4().hex[:8]}"
    created_studies_for_cleanup.append(study_name_short)
    participant_id = f"it_skip_i_{uuid.uuid4().hex[:6]}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        await _import_study(client, study_name_short, allow_skip_timeuse=False)
        await client.post(
            f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}"
            "/instructions/complete",
            json={"completed": True},
        )
        export = await client.get(
            f"{BASE_URL}/api/admin/export/{study_name_short}/participants",
            params={"format": "json"},
            auth=ADMIN_AUTH,
        )
        assert export.status_code == 200, export.text
        record = export.json()["data"][0]

    assert not [key for key in record if "skip" in key], record.keys()
