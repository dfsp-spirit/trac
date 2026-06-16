import os
import uuid

import httpx
import pytest

from o_timeusediary_backend.settings import settings


BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.strip("/")


async def _get_submission_template(client: httpx.AsyncClient, study_name_short: str, participant_id: str = None):
    params = {}
    if participant_id:
        params["participant_id"] = participant_id
    activities_response = await client.get(
        f"{BASE_URL}/api/studies/{study_name_short}/activities-config",
        params=params,
    )
    assert activities_response.status_code == 200
    activities_data = activities_response.json()
    assert "timeline" in activities_data

    # pick first timeline and first activity
    timeline_key = next(iter(activities_data["timeline"].keys()))
    timeline_cfg = activities_data["timeline"][timeline_key]
    first_category = timeline_cfg["categories"][0]
    first_activity = first_category["activities"][0]

    return {
        "timeline_key": timeline_key,
        "timeline_mode": timeline_cfg["mode"],
        "category_name": first_category["name"],
        "activity_name": first_activity["name"],
        "activity_code": first_activity.get("code"),
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
async def test_min_coverage_validation_rejects_insufficient_coverage():
    study_name_short = "adult_pilot_de2"
    # Use a known authorized participant for restricted study
    participant_id = "bernd"
    day_label = "monday"

    async with httpx.AsyncClient() as client:
        template = await _get_submission_template(client, study_name_short, participant_id)

        # Create a single short activity (10 minutes) which is below the required min_coverage=1440
        items = [
            _build_activity_item(template, 0, 10),
        ]

        response = await client.post(
            f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/day_labels/{day_label}/activities",
            json={"activities": items},
        )

        # Expect validation rejection due to insufficient coverage
        assert response.status_code == 400, f"Unexpected status: {response.status_code} - {response.text}"
        payload = response.json()
        # API returns structured detail with error_type
        if isinstance(payload, dict) and payload.get("detail"):
            detail = payload.get("detail")
        else:
            detail = payload

        assert isinstance(detail, dict)
        assert detail.get("error_type") == "insufficient_timeline_coverage"
