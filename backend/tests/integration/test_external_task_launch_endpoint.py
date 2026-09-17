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
