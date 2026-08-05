import os
import uuid

import httpx
import pytest

from o_timeusediary_backend.settings import settings


BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.strip("/")


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


def _build_activity_item(template: dict, start_minutes: int, end_minutes: int) -> dict:
    item = {
        "timeline_key": template["timeline_key"],
        "activity": template["activity_name"],
        "category": template["category_name"],
        "start_minutes": start_minutes,
        "end_minutes": end_minutes,
        "mode": template["timeline_mode"],
    }

    if template["timeline_mode"] == "single-choice":
        item["code"] = template["activity_code"]
    else:
        item["codes"] = [template["activity_code"]]

    return item


@pytest.mark.asyncio
async def test_activities_response_reports_days_meeting_min_coverage():
    """The GET activities endpoint must distinguish days that merely contain
    data (day_indices_with_data) from days that are complete according to the
    min_coverage requirement (day_indices_meet_min_coverage).

    This is the backend contract the frontend "Finish Study" submit gate and
    the day-button green checkmarks rely on.
    """
    study_name_short = "default"
    # Fresh participant on the open "default" study to avoid state collisions.
    participant_id = f"it_mincov_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient() as client:
        # 1) No data yet -> both day arrays are present and empty.
        empty_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/activities",
            params={"day_label_index": 0},
        )
        assert empty_response.status_code == 200
        empty_payload = empty_response.json()
        assert "day_indices_with_data" in empty_payload
        assert "day_indices_meet_min_coverage" in empty_payload
        assert empty_payload["day_indices_with_data"] == []
        assert empty_payload["day_indices_meet_min_coverage"] == []

        # 2) Resolve the first day label (Monday) and submit an activity that
        #    comfortably exceeds the primary timeline's min_coverage (10 min).
        study_cfg_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/study-config"
        )
        assert study_cfg_response.status_code == 200
        study_cfg = study_cfg_response.json()
        day_label_name = study_cfg["day_labels"][0]["name"]

        template = await _get_first_activity_selection(client, study_name_short)
        activity_item = _build_activity_item(template, 0, 30)

        submit_response = await client.post(
            f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/day_labels/{day_label_name}/activities",
            json={"activities": [activity_item]},
        )
        assert (
            submit_response.status_code == 200
        ), f"Unexpected status: {submit_response.status_code} - {submit_response.text}"

        # 3) After a valid (complete) submission, day 0 must be in BOTH sets:
        #    it contains data AND it meets the min_coverage requirement.
        after_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/activities",
            params={"day_label_index": 0},
        )
        assert after_response.status_code == 200
        after_payload = after_response.json()

        assert 0 in after_payload["day_indices_with_data"]
        assert 0 in after_payload["day_indices_meet_min_coverage"]

        # 4) Other days still have no data and are not complete.
        assert after_payload["day_indices_with_data"] == [0]
        assert after_payload["day_indices_meet_min_coverage"] == [0]

        # 5) Querying a different day's activities returns the same day-level
        #    completion metadata (it is computed study-wide, not per-day).
        other_day_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/activities",
            params={"day_label_index": 2},
        )
        assert other_day_response.status_code == 200
        other_day_payload = other_day_response.json()
        assert other_day_payload["day_indices_meet_min_coverage"] == [0]
        assert other_day_payload["day_indices_with_data"] == [0]
