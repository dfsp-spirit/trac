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
) -> dict:
    """Pick the first timeline / category / activity from the study config."""
    activities_response = await client.get(
        f"{BASE_URL}/api/studies/{study_name_short}/activities-config"
    )
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


def _build_activity_item(
    template: dict, start_minutes: int, end_minutes: int, day_indexes: list[int]
) -> dict:
    return {
        "timeline_key": template["timeline_key"],
        "activity_code": template["activity_code"],
        "activity_name": template["activity_name"],
        "category": template["category_name"],
        "start_minutes": start_minutes,
        "end_minutes": end_minutes,
        "day_label_indexes": day_indexes,
    }


@pytest.mark.asyncio
async def test_diary_response_reports_days_meeting_min_coverage():
    """The diary endpoint distinguishes days with data from complete days.

    This is the backend contract the review/submit gate and the day rail rely
    on: a day can carry entries and still miss its timeline's min_coverage.
    """
    study_name_short = "default"
    # Fresh participant on the open "default" study to avoid state collisions.
    participant_id = f"it_mincov_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient() as client:
        # 1) No data yet -> every day is empty and incomplete.
        empty_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/diary",
        )
        assert empty_response.status_code == 200
        empty_payload = empty_response.json()
        assert empty_payload["days"]
        assert all(not day["has_data"] for day in empty_payload["days"])
        assert all(not day["meets_requirement"] for day in empty_payload["days"])

        # 2) Create an activity on day 0 that comfortably exceeds the primary
        #    timeline's min_coverage (10 min).
        template = await _get_first_activity_selection(client, study_name_short)
        activity_item = _build_activity_item(template, 0, 30, [0])

        submit_response = await client.post(
            f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/activities",
            json={"items": [activity_item]},
        )
        assert (
            submit_response.status_code == 201
        ), f"Unexpected status: {submit_response.status_code} - {submit_response.text}"

        # 3) Day 0 has data and meets the requirement; other days do not.
        after_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/diary",
        )
        assert after_response.status_code == 200
        after_payload = after_response.json()
        days = after_payload["days"]

        assert days[0]["has_data"] is True
        assert days[0]["meets_requirement"] is True
        assert [day["index"] for day in days if day["has_data"]] == [0]
        assert [day["index"] for day in days if day["meets_requirement"]] == [0]
