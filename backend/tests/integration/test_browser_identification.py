"""Integration tests for browser/device identification.

Covers the whole path: the per-study ``save_browser_identification`` flag in
study-config, the participant ``client-info`` capture endpoint, and both
research-data exports (activities + participants).

The participant-level export matters most here: it exists precisely so that
participants who never logged an activity -- and therefore have no row in the
activities export -- still carry their browser data.
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

TEST_USER_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
)


def _load_activities_template() -> dict:
    backend_root = Path(__file__).resolve().parents[2]
    activities_file = backend_root / "activities_default.json"
    return json.loads(activities_file.read_text(encoding="utf-8"))


@pytest.fixture
def created_studies_for_cleanup():
    created_studies = []
    yield created_studies

    if not created_studies:
        return

    unique_names = list(dict.fromkeys(created_studies))
    with httpx.Client(timeout=60.0) as client:
        for study_name_short in reversed(unique_names):
            delete_response = client.delete(
                f"{BASE_URL}/api/admin/studies/{study_name_short}",
                auth=ADMIN_AUTH,
            )
            if delete_response.status_code not in (200, 404):
                raise AssertionError(
                    f"Unexpected cleanup status for study '{study_name_short}': "
                    f"{delete_response.status_code}"
                )


async def _import_study(
    client: httpx.AsyncClient,
    study_name_short: str,
    *,
    save_browser_identification: bool | None = None,
) -> None:
    """Import an open study, optionally with browser identification disabled."""
    activities_payload = _load_activities_template()

    study_payload = {
        "name": f"Browser Identification Test Study {study_name_short}",
        "name_short": study_name_short,
        "description": "Integration test for browser identification",
        "day_labels": [
            {
                "name": "monday",
                "display_order": 0,
                "display_names": {"en": "Monday"},
            },
        ],
        "study_participant_ids": [],
        "allow_unlisted_participants": True,
        "default_language": "en",
        "supported_languages": ["en"],
        "activities_json_data": {"en": activities_payload},
        "study_text_intro": {"en": "Intro"},
        "study_text_end_completed": {"en": "Done"},
        "study_text_end_skipped": {"en": "Skipped"},
        "data_collection_start": "2024-01-01T00:00:00Z",
        "data_collection_end": "2028-12-31T23:59:59Z",
    }
    if save_browser_identification is not None:
        study_payload["save_browser_identification"] = save_browser_identification

    import_response = await client.post(
        f"{BASE_URL}/api/admin/studies/import-config",
        json={
            "mode": "create_only",
            "transaction_mode": "all_or_nothing",
            "studies": [study_payload],
        },
        auth=ADMIN_AUTH,
    )
    assert (
        import_response.status_code == 200
    ), f"Import failed: {import_response.status_code} {import_response.text}"
    import_data = import_response.json()
    assert import_data["summary"]["created"] == 1
    assert import_data["summary"]["failed"] == 0


async def _get_first_activity_selection(
    client: httpx.AsyncClient, study_name_short: str
) -> dict:
    """Pick the first timeline / category / activity from the study config."""
    activities_response = await client.get(
        f"{BASE_URL}/api/studies/{study_name_short}/activities-config"
    )
    assert activities_response.status_code == 200
    activities_data = activities_response.json()

    timeline_key = next(iter(activities_data["timeline"].keys()))
    timeline_cfg = activities_data["timeline"][timeline_key]
    first_category = timeline_cfg["categories"][0]
    first_activity = first_category["activities"][0]

    return {
        "timeline_key": timeline_key,
        "timeline_mode": timeline_cfg["mode"],
        "category_name": first_category["name"],
        "activity_name": first_activity["name"],
        "activity_code": first_activity["code"],
    }


async def _submit_one_activity(
    client: httpx.AsyncClient, study_name_short: str, participant_id: str
) -> None:
    """Give a participant a single activity so the activities export is non-empty."""
    study_config_response = await client.get(
        f"{BASE_URL}/api/studies/{study_name_short}/study-config"
    )
    assert study_config_response.status_code == 200
    day_label_name = study_config_response.json()["day_labels"][0]["name"]

    template = await _get_first_activity_selection(client, study_name_short)
    activity_item = {
        "timeline_key": template["timeline_key"],
        "activity": template["activity_name"],
        "category": template["category_name"],
        "start_minutes": 0,
        "end_minutes": 30,
        "mode": template["timeline_mode"],
    }
    if template["timeline_mode"] == "single-choice":
        activity_item["code"] = template["activity_code"]
    else:
        activity_item["codes"] = [template["activity_code"]]

    submit_response = await client.post(
        f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}"
        f"/day_labels/{day_label_name}/activities",
        json={"activities": [activity_item]},
    )
    assert (
        submit_response.status_code == 200
    ), f"Activity submit failed: {submit_response.status_code} {submit_response.text}"


async def _ensure_participant_exists(
    client: httpx.AsyncClient, study_name_short: str, participant_id: str
) -> None:
    """Create the study-participant association without submitting any diary data."""
    response = await client.post(
        f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}"
        "/instructions/complete",
        json={"completed": True},
    )
    assert (
        response.status_code == 200
    ), f"Instructions call failed: {response.status_code} {response.text}"


async def _submit_client_info(
    client: httpx.AsyncClient,
    study_name_short: str,
    participant_id: str,
    *,
    browser_name: str = "Mobile Safari",
) -> httpx.Response:
    return await client.post(
        f"{BASE_URL}/api/studies/{study_name_short}/participants/{participant_id}/client-info",
        json={
            "user_agent": TEST_USER_AGENT,
            "client_info": {
                "parser_library": "ua-parser-js",
                "parser_version": "1.0.41",
                "browser": {"name": browser_name, "version": "17.5"},
                "engine": {"name": "WebKit", "version": "605.1.15"},
                "os": {"name": "iOS", "version": "17.5"},
                "device": {"vendor": "Apple", "model": "iPhone", "type": "mobile"},
                "cpu": {"architecture": ""},
                "screen": {"width": 390, "height": 844},
                "viewport": {"width": 390, "height": 664},
                "device_pixel_ratio": 3,
                "max_touch_points": 5,
                "platform": "iPhone",
                "timezone": "Europe/Berlin",
                "language": "de",
                "client_hints": None,
            },
        },
    )


async def _get_export_records(
    client: httpx.AsyncClient, url: str, **params
) -> list[dict]:
    response = await client.get(url, params=params, auth=ADMIN_AUTH)
    assert (
        response.status_code == 200
    ), f"Export failed: {response.status_code} {response.text}"
    payload = response.json()
    assert isinstance(payload.get("data"), list)
    return payload["data"]


@pytest.mark.asyncio
async def test_browser_identification_is_stored_and_exported(
    created_studies_for_cleanup,
):
    """Default-on capture reaches both exports, including activity-less participants."""
    study_name_short = f"it_browser_{uuid.uuid4().hex[:8]}"
    created_studies_for_cleanup.append(study_name_short)

    participant_with_activity = f"it_bi_a_{uuid.uuid4().hex[:6]}"
    participant_without_activity = f"it_bi_b_{uuid.uuid4().hex[:6]}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        await _import_study(client, study_name_short)

        # The flag defaults to true and is part of the study-config contract.
        config_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/study-config"
        )
        assert config_response.status_code == 200
        assert config_response.json()["save_browser_identification"] is True

        await _submit_one_activity(client, study_name_short, participant_with_activity)

        for participant_id in (participant_with_activity, participant_without_activity):
            capture_response = await _submit_client_info(
                client, study_name_short, participant_id
            )
            assert (
                capture_response.status_code == 200
            ), f"Capture failed: {capture_response.status_code} {capture_response.text}"
            capture_payload = capture_response.json()
            assert capture_payload["saved"] is True
            assert capture_payload["client_info_captured_at"] is not None

        participant_records = await _get_export_records(
            client,
            f"{BASE_URL}/api/admin/export/{study_name_short}/participants",
            format="json",
        )

    records_by_pid = {record["participant_id"]: record for record in participant_records}

    # Both participants are exported, even though only one ever logged an activity.
    assert set(records_by_pid) == {
        participant_with_activity,
        participant_without_activity,
    }
    assert (
        "participant_days_with_data" in records_by_pid[participant_with_activity]
    ), "participant export should still carry the progress columns"

    for participant_id in (participant_with_activity, participant_without_activity):
        record = records_by_pid[participant_id]
        assert record["study_save_browser_identification"] is True
        assert record["participant_client_info_collected"] is True
        assert record["participant_user_agent"] == TEST_USER_AGENT
        assert record["participant_browser_name"] == "Mobile Safari"
        assert record["participant_os_name"] == "iOS"
        assert record["participant_device_type"] == "mobile"
        assert record["participant_device_vendor"] == "Apple"
        assert record["participant_screen_width"] == 390
        assert record["participant_max_touch_points"] == 5
        assert record["participant_client_info_parser_version"] == "1.0.41"
        assert record["participant_client_info_capture_count"] == 1
        assert record["participant_client_info_captured_at"] is not None
        assert record["participant_client_info_json"]

    # The participant export is deliberately free of activity data.
    for record in participant_records:
        assert "activity_code" not in record
        assert "start_minutes" not in record

    # The activities export repeats the participant-level browser columns.
    async with httpx.AsyncClient(timeout=30.0) as client:
        activity_records = await _get_export_records(
            client,
            f"{BASE_URL}/api/admin/export/{study_name_short}/activities",
            format="json",
        )

    assert len(activity_records) == 1
    activity_record = activity_records[0]
    assert activity_record["participant_id"] == participant_with_activity
    assert activity_record["study_save_browser_identification"] is True
    assert activity_record["participant_user_agent"] == TEST_USER_AGENT
    assert activity_record["participant_browser_name"] == "Mobile Safari"
    assert activity_record["participant_device_type"] == "mobile"


@pytest.mark.asyncio
async def test_client_info_is_upserted_and_counted(created_studies_for_cleanup):
    """Repeat captures update the row and keep the first capture visible."""
    study_name_short = f"it_browser_{uuid.uuid4().hex[:8]}"
    created_studies_for_cleanup.append(study_name_short)
    participant_id = f"it_bi_u_{uuid.uuid4().hex[:6]}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        await _import_study(client, study_name_short)

        first_response = await _submit_client_info(
            client, study_name_short, participant_id
        )
        assert first_response.status_code == 200
        first_captured_at = first_response.json()["client_info_captured_at"]

        second_response = await _submit_client_info(
            client, study_name_short, participant_id, browser_name="Safari"
        )
        assert second_response.status_code == 200
        assert second_response.json()["saved"] is True

        participant_records = await _get_export_records(
            client,
            f"{BASE_URL}/api/admin/export/{study_name_short}/participants",
            format="json",
        )

    assert len(participant_records) == 1
    record = participant_records[0]
    # Latest snapshot wins ...
    assert record["participant_browser_name"] == "Safari"
    # ... but the capture history stays visible.
    assert record["participant_client_info_capture_count"] == 2
    assert record["participant_client_info_first_captured_at"] is not None
    assert record["participant_client_info_first_captured_at"] == first_captured_at
    assert (
        record["participant_client_info_captured_at"]
        >= record["participant_client_info_first_captured_at"]
    )


@pytest.mark.asyncio
async def test_disabled_study_stores_nothing(created_studies_for_cleanup):
    """A study with the flag off accepts the call but stores no data."""
    study_name_short = f"it_browser_{uuid.uuid4().hex[:8]}"
    created_studies_for_cleanup.append(study_name_short)
    participant_id = f"it_bi_d_{uuid.uuid4().hex[:6]}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        await _import_study(
            client, study_name_short, save_browser_identification=False
        )

        config_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/study-config"
        )
        assert config_response.status_code == 200
        assert config_response.json()["save_browser_identification"] is False

        # The participant exists in the study independently of the capture, so
        # the export has a row to inspect.
        await _ensure_participant_exists(client, study_name_short, participant_id)

        capture_response = await _submit_client_info(
            client, study_name_short, participant_id
        )
        assert capture_response.status_code == 200
        capture_payload = capture_response.json()
        assert capture_payload["saved"] is False
        assert (
            capture_payload["reason"] == "save_browser_identification_disabled"
        )

        participant_records = await _get_export_records(
            client,
            f"{BASE_URL}/api/admin/export/{study_name_short}/participants",
            format="json",
        )

    assert len(participant_records) == 1
    record = participant_records[0]
    # The marker column makes the empty columns interpretable.
    assert record["study_save_browser_identification"] is False
    assert record["participant_client_info_collected"] is False
    assert record["participant_user_agent"] is None
    assert record["participant_browser_name"] is None


@pytest.mark.asyncio
async def test_participant_export_csv_and_filter(created_studies_for_cleanup):
    """CSV output carries the browser columns and the filter narrows the set."""
    study_name_short = f"it_browser_{uuid.uuid4().hex[:8]}"
    created_studies_for_cleanup.append(study_name_short)

    participant_with_client_info = f"it_bi_c_{uuid.uuid4().hex[:6]}"
    participant_without_client_info = f"it_bi_e_{uuid.uuid4().hex[:6]}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        await _import_study(client, study_name_short)
        await _submit_client_info(
            client, study_name_short, participant_with_client_info
        )
        # This participant exists in the study but never posted client info, so
        # the unfiltered export must contain them and the filter must drop them.
        await _ensure_participant_exists(
            client, study_name_short, participant_without_client_info
        )

        filtered_records = await _get_export_records(
            client,
            f"{BASE_URL}/api/admin/export/{study_name_short}/participants",
            format="json",
            only_with_client_info="true",
        )

        csv_response = await client.get(
            f"{BASE_URL}/api/admin/export/{study_name_short}/participants",
            params={"format": "csv"},
            auth=ADMIN_AUTH,
        )

    # The participant who never posted client info still exists in the study,
    # so the filtered export must contain exactly one row.
    assert [record["participant_id"] for record in filtered_records] == [
        participant_with_client_info
    ]

    assert csv_response.status_code == 200
    assert csv_response.headers["content-type"].startswith("text/csv")
    header_line = csv_response.text.splitlines()[0]
    for expected_column in (
        "participant_id",
        "study_save_browser_identification",
        "participant_client_info_collected",
        "participant_user_agent",
        "participant_browser_name",
        "participant_device_type",
    ):
        assert expected_column in header_line, (
            f"CSV header missing '{expected_column}': {header_line}"
        )
    assert participant_without_client_info in csv_response.text
