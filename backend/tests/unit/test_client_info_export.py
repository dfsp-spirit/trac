"""Unit tests for flattening stored client info into export columns.

The mapping is intentionally defensive: exports must never fail on a partial or
legacy blob, so these tests pin down the None-behaviour of the lookups as much
as the happy path.
"""

import json
from datetime import datetime, timezone

from o_timeusediary_backend.api import _client_info_export_columns
from o_timeusediary_backend.models import StudyParticipant


CAPTURED_AT = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)

FULL_BLOB = {
    "parser_library": "ua-parser-js",
    "parser_version": "1.0.41",
    "browser": {"name": "Mobile Safari", "version": "17.5"},
    "engine": {"name": "WebKit", "version": "605.1.15"},
    "os": {"name": "iOS", "version": "17.5"},
    "device": {"vendor": "Apple", "model": "iPhone", "type": "mobile"},
    "cpu": {"architecture": "arm64"},
    "screen": {"width": 390, "height": 844},
    "viewport": {"width": 390, "height": 664},
    "device_pixel_ratio": 3,
    "max_touch_points": 5,
    "platform": "iPhone",
    "timezone": "Europe/Berlin",
    "language": "de",
    "capture_count": 2,
    "first_captured_at": "2026-01-01T10:00:00+00:00",
}


def _association(**kwargs) -> StudyParticipant:
    defaults = {
        "study_id": 1,
        "participant_id": "p1",
        "user_agent": "Mozilla/5.0 (iPhone)",
        "client_info": dict(FULL_BLOB),
        "client_info_captured_at": CAPTURED_AT,
    }
    defaults.update(kwargs)
    return StudyParticipant(**defaults)


def test_columns_are_empty_without_an_association():
    columns = _client_info_export_columns(None)

    assert columns["participant_client_info_collected"] is False
    assert columns["participant_user_agent"] is None
    assert columns["participant_browser_name"] is None
    assert columns["participant_client_info_captured_at"] is None
    # Every column must be present so the CSV/JSON schema stays stable.
    assert all(value is None for key, value in columns.items() if key != "participant_client_info_collected")


def test_full_blob_is_flattened():
    columns = _client_info_export_columns(_association())

    assert columns["participant_client_info_collected"] is True
    assert columns["participant_user_agent"] == "Mozilla/5.0 (iPhone)"
    assert columns["participant_browser_name"] == "Mobile Safari"
    assert columns["participant_browser_version"] == "17.5"
    assert columns["participant_engine_name"] == "WebKit"
    assert columns["participant_os_name"] == "iOS"
    assert columns["participant_device_type"] == "mobile"
    assert columns["participant_device_vendor"] == "Apple"
    assert columns["participant_device_model"] == "iPhone"
    assert columns["participant_cpu_architecture"] == "arm64"
    assert columns["participant_screen_width"] == 390
    assert columns["participant_viewport_height"] == 664
    assert columns["participant_device_pixel_ratio"] == 3
    assert columns["participant_max_touch_points"] == 5
    assert columns["participant_client_language"] == "de"
    assert columns["participant_client_timezone"] == "Europe/Berlin"
    assert columns["participant_client_info_parser_version"] == "1.0.41"
    assert columns["participant_client_info_capture_count"] == 2
    assert columns["participant_client_info_first_captured_at"] == (
        "2026-01-01T10:00:00+00:00"
    )
    assert columns["participant_client_info_captured_at"] == CAPTURED_AT.isoformat()


def test_partial_and_malformed_blobs_do_not_raise():
    association = _association(
        client_info={"browser": "not-a-dict", "os": {"name": "Android"}}
    )

    columns = _client_info_export_columns(association)

    assert columns["participant_client_info_collected"] is True
    # A scalar where a dict was expected is treated as "missing", not an error.
    assert columns["participant_browser_name"] is None
    assert columns["participant_os_name"] == "Android"
    assert columns["participant_device_type"] is None


def test_empty_blob_is_reported_as_not_collected():
    columns = _client_info_export_columns(_association(client_info={}))

    assert columns["participant_client_info_collected"] is False
    # The column is always present; it just has no value.
    assert columns["participant_user_agent"] == "Mozilla/5.0 (iPhone)"


def test_raw_json_is_only_included_on_request():
    without_json = _client_info_export_columns(_association())
    assert "participant_client_info_json" not in without_json

    with_json = _client_info_export_columns(_association(), include_raw_json=True)
    assert json.loads(with_json["participant_client_info_json"])["browser"][
        "name"
    ] == "Mobile Safari"

    empty_json = _client_info_export_columns(
        _association(client_info={}), include_raw_json=True
    )
    assert empty_json["participant_client_info_json"] is None
