"""The participant's stage as the API reports it (D37).

The unit tests pin the decision table; these pin the contract the browser relies
on: `study-config` says where the participant belongs, every step that changes
their state answers with the next stage, and no step can be skipped by walking
the URLs by hand.
"""

import os
import uuid

import httpx
import pytest

from o_timeusediary_backend.settings import settings

BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.strip("/")
ADMIN_AUTH = (settings.admin_username, settings.admin_password)

DAY_NAMES = ["monday", "tuesday", "wednesday"]


def _activities_config(min_coverage: int = 0) -> dict:
    return {
        "general": {"app_name": "TRAC", "version": "1.0", "language": "en"},
        "timeline": {
            "primary": {
                "name": "Primary",
                "description": "",
                "mode": "single-choice",
                "min_coverage": min_coverage,
                "max_overlap": 2,
                "categories": [
                    {
                        "name": "General",
                        "activities": [
                            {
                                "name": f"Activity {code}",
                                "code": code,
                                "label": f"activity-{code}",
                                "color": "#000000",
                                "childItems": [],
                            }
                            for code in (100, 101)
                        ],
                    }
                ],
            }
        },
    }


async def _create_study(
    client: httpx.AsyncClient,
    *,
    min_coverage: int = 0,
    require_consent: bool = False,
    instructions: str | None = None,
    require_diary_before_external_tasks: bool = False,
    external_tasks: list[dict] | None = None,
    participant_ids: list[str] | None = None,
) -> str:
    study_name_short = f"it_stage_{uuid.uuid4().hex[:8]}"
    study = {
        "name": f"Stage API {study_name_short}",
        "name_short": study_name_short,
        "description": "Integration test - participant stage",
        "day_labels": [
            {
                "name": name,
                "display_order": index,
                "display_names": {"en": name.title()},
            }
            for index, name in enumerate(DAY_NAMES)
        ],
        "study_participant_ids": participant_ids or [],
        # A closed study is required for per-participant task tokens; an open one
        # needs a token pool instead, which these tests do not exercise.
        "allow_unlisted_participants": not participant_ids,
        "default_language": "en",
        "supported_languages": ["en"],
        "activities_json_data": {"en": _activities_config(min_coverage)},
        "data_collection_start": "2024-01-01T00:00:00Z",
        "data_collection_end": "2028-12-31T23:59:59Z",
        "require_consent": require_consent,
        "require_diary_before_external_tasks": require_diary_before_external_tasks,
    }
    if instructions is not None:
        study["study_text_instructions"] = {"en": instructions}
    if external_tasks is not None:
        study["external_tasks"] = external_tasks

    payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [study],
    }
    response = await client.post(
        f"{BASE_URL}/api/admin/studies/import-config", json=payload, auth=ADMIN_AUTH
    )
    assert response.status_code == 200, response.text
    return study_name_short


def _url(study: str, participant: str, suffix: str = "") -> str:
    return f"{BASE_URL}/api/studies/{study}/participants/{participant}{suffix}"


async def _stage(client: httpx.AsyncClient, study: str, participant: str) -> dict:
    response = await client.get(
        f"{BASE_URL}/api/studies/{study}/study-config",
        params={"participant_id": participant, "lang": "en"},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    return {"stage": payload["stage"], "done_reason": payload["done_reason"]}


def _item(start: int = 480, end: int = 600, days=(0, 1, 2)) -> dict:
    return {
        "client_uuid": str(uuid.uuid4()),
        "activity_code": 100,
        "activity_name": "Activity 100",
        "category": "General",
        "start_minutes": start,
        "end_minutes": end,
        "day_label_indexes": list(days),
    }


@pytest.mark.asyncio
async def test_a_plain_study_puts_a_new_participant_in_the_diary():
    participant = f"p_{uuid.uuid4().hex[:6]}"
    async with httpx.AsyncClient() as client:
        study = await _create_study(client)
        reported = await _stage(client, study, participant)

    assert reported == {"stage": "diary", "done_reason": None}


@pytest.mark.asyncio
async def test_consent_then_instructions_then_diary_in_one_walk():
    participant = f"p_{uuid.uuid4().hex[:6]}"
    async with httpx.AsyncClient() as client:
        study = await _create_study(
            client, require_consent=True, instructions="Please read this first."
        )

        assert (await _stage(client, study, participant))["stage"] == "consent"

        consent = await client.post(
            _url(study, participant, "/consent"), json={"consent_given": True}
        )
        assert consent.status_code == 200, consent.text
        assert consent.json()["stage"] == "instructions"
        assert (await _stage(client, study, participant))["stage"] == "instructions"

        instructions = await client.post(
            _url(study, participant, "/instructions/complete"), json={"completed": True}
        )
        assert instructions.status_code == 200, instructions.text
        assert instructions.json()["stage"] == "diary"
        assert (await _stage(client, study, participant))["stage"] == "diary"


@pytest.mark.asyncio
async def test_declining_consent_is_terminal_and_says_why():
    participant = f"p_{uuid.uuid4().hex[:6]}"
    async with httpx.AsyncClient() as client:
        study = await _create_study(client, require_consent=True)
        response = await client.post(
            _url(study, participant, "/consent"), json={"consent_given": False}
        )
        assert response.status_code == 200, response.text
        assert response.json()["stage"] == "done"
        assert await _stage(client, study, participant) == {
            "stage": "done",
            "done_reason": "noconsent",
        }


@pytest.mark.asyncio
async def test_submitting_answers_with_done():
    participant = f"p_{uuid.uuid4().hex[:6]}"
    async with httpx.AsyncClient() as client:
        study = await _create_study(client, min_coverage=120)
        await client.post(
            _url(study, participant, "/activities"),
            json={"items": [_item(days=[0, 1, 2])]},
        )
        submit = await client.post(_url(study, participant, "/diary/submit"))
        assert submit.status_code == 200, submit.text
        assert submit.json()["stage"] == "done"
        assert await _stage(client, study, participant) == {
            "stage": "done",
            "done_reason": "completed",
        }


@pytest.mark.asyncio
async def test_an_owed_external_task_keeps_the_participant_in_tasks():
    participant = f"p_{uuid.uuid4().hex[:6]}"
    async with httpx.AsyncClient() as client:
        study = await _create_study(
            client,
            min_coverage=0,
            require_diary_before_external_tasks=True,
            participant_ids=[participant],
            external_tasks=[
                {
                    "task_key": "survey",
                    "task_level": 1,
                    "name": {"en": "Fill in the survey"},
                    "description": {"en": "One short survey."},
                    "confirmation_type": "callback",
                    "outbound_tokens": [
                        {
                            "name": "survey_token",
                            "by_participant": {participant: "tok-1"},
                        }
                    ],
                    "outbound_url": "https://example.org/s?token={survey_token}",
                }
            ],
        )
        # The task is locked behind the diary, so the diary comes first.
        assert (await _stage(client, study, participant))["stage"] == "diary"

        await client.post(
            _url(study, participant, "/activities"),
            json={"items": [_item(days=[0, 1, 2])]},
        )
        submit = await client.post(_url(study, participant, "/diary/submit"))
        assert submit.status_code == 200, submit.text
        assert submit.json()["stage"] == "tasks"
        assert (await _stage(client, study, participant))["stage"] == "tasks"
