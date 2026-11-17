import os
import uuid
from urllib.parse import urljoin, urlparse, parse_qs

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
async def test_external_task_launch_redirects_to_provider_url_with_assigned_token():
    study_name_short = f"it_launch_{uuid.uuid4().hex[:8]}"
    participant_id = "p1"

    import_payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"Launch Endpoint Study {study_name_short}",
                "name_short": study_name_short,
                "description": "Integration test for external launch redirect",
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
                        "task_key": "payment",
                        "name": {"en": "Payment Survey"},
                        "description": {"en": "Complete payment handoff."},
                        "outbound_url": "https://survey.academiccloud.de/f/153222?participant_id={participant_id}&study_name={study_name}&task={task_key}&token={survey_token}",
                        "confirmation_type": "none",
                        "outbound_tokens": [
                            {
                                "name": "survey_token",
                                "by_participant": {participant_id: "tok-launch-test-1"},
                            }
                        ],
                    }
                ],
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ],
    }

    async with httpx.AsyncClient(follow_redirects=False) as client:
        import_response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=import_payload,
            auth=ADMIN_AUTH,
        )
        assert import_response.status_code == 200

        study_cfg_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/study-config",
            params={"participant_id": participant_id, "lang": "en"},
        )
        assert study_cfg_response.status_code == 200
        study_cfg = study_cfg_response.json()

        external_tasks = study_cfg.get("external_tasks") or []
        assert external_tasks, "Expected at least one external task assignment"

        first_task = external_tasks[0]
        assigned_token = first_task["assigned_token"]
        continuation_url = first_task.get("continuation_url")
        assert continuation_url, "Expected continuation_url in external task payload"

        launch_url = urljoin(BASE_SCHEME, continuation_url)

        launch_response = await client.get(launch_url)

        assert launch_response.status_code in {302, 307}
        location = launch_response.headers.get("location")
        assert location, "Expected redirect location header"
        assert location.startswith("https://survey.academiccloud.de/")

        redirected_query = parse_qs(urlparse(location).query)
        flattened_values = [
            value for values in redirected_query.values() for value in values
        ]
        assert assigned_token in flattened_values
        assert participant_id in flattened_values

        delete_response = await client.delete(
            f"{BASE_URL}/api/admin/studies/{study_name_short}",
            auth=ADMIN_AUTH,
        )
        assert delete_response.status_code in {200, 404}


@pytest.mark.asyncio
async def test_task_level_two_stays_locked_until_level_one_is_confirmed():
    """The participant payload names the gate, so no client has to re-derive it.

    Level 2 is where a payment task sits: it must not be openable while the
    survey before it is still owed, and the participant must be told why rather
    than shown a link that cannot work.
    """
    study_name_short = f"it_levels_{uuid.uuid4().hex[:8]}"
    participant_id = "p1"

    import_payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"Task Level Study {study_name_short}",
                "name_short": study_name_short,
                "description": "Integration test for task-level locking",
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
                        "task_key": "first",
                        "task_level": 1,
                        "name": {"en": "First"},
                        "confirmation_type": "callback",
                        "outbound_url": "https://example.org/first?token={token}",
                        "outbound_tokens": [
                            {"name": "token", "by_participant": {participant_id: "tok-first"}}
                        ],
                        "callback_token_name": "token",
                    },
                    {
                        "task_key": "second",
                        "task_level": 2,
                        "name": {"en": "Second"},
                        "confirmation_type": "callback",
                        "outbound_url": "https://example.org/second?token={token}",
                        "outbound_tokens": [
                            {"name": "token", "by_participant": {participant_id: "tok-second"}}
                        ],
                        "callback_token_name": "token",
                    },
                ],
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ],
    }

    async with httpx.AsyncClient(follow_redirects=False) as client:
        import_response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=import_payload,
            auth=ADMIN_AUTH,
        )
        assert import_response.status_code == 200

        config_url = f"{BASE_URL}/api/studies/{study_name_short}/study-config"

        def by_key(payload: dict) -> dict:
            return {task["task_key"]: task for task in payload.get("external_tasks") or []}

        before = (await client.get(config_url, params={"participant_id": participant_id})).json()
        tasks = by_key(before)
        assert set(tasks) == {"first", "second"}
        assert tasks["first"]["task_level"] == 1
        assert tasks["first"]["locked_reason"] is None
        assert tasks["first"]["continuation_url"]
        assert tasks["second"]["task_level"] == 2
        assert tasks["second"]["locked_reason"] == "task_level"
        assert tasks["second"]["continuation_url"] == ""

        confirmed = await client.post(
            f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}"
            "/external-tasks/confirm",
            json={"task_key": "first", "assigned_token": tasks["first"]["assigned_token"]},
        )
        assert confirmed.status_code == 200

        after = (await client.get(config_url, params={"participant_id": participant_id})).json()
        tasks = by_key(after)
        assert tasks["first"]["is_confirmed"] is True
        assert tasks["first"]["locked_reason"] is None
        assert tasks["second"]["locked_reason"] is None
        assert tasks["second"]["continuation_url"], "level 2 opens once level 1 is confirmed"

        delete_response = await client.delete(
            f"{BASE_URL}/api/admin/studies/{study_name_short}",
            auth=ADMIN_AUTH,
        )
        assert delete_response.status_code in {200, 404}
