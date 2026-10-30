"""Unit tests for flattening stored client info into export columns.

The export is deliberately narrow: it carries only the values a researcher reads
in a spreadsheet, and it disappears entirely for a study that does not collect
the data (no wide block of nulls). Everything else stays in the blob, which the
participant export ships as ``client_info_json``.
"""

import json
from datetime import datetime, timezone

from o_timeusediary_backend.api import _client_info_export_columns
from o_timeusediary_backend.models import StudyParticipant


CAPTURED_AT = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)

FULL_BLOB = {
    "schema_version": 1,
    "user_agent": "Mozilla/5.0 (iPhone)",
    "platform": "iPhone",
    "language": "de",
    "timezone": "Europe/Berlin",
    "screen": {"width": 390, "height": 844},
    "viewport": {"width": 390, "height": 664},
    "device_pixel_ratio": 3,
    "max_touch_points": 5,
    "capture_count": 2,
    "first_captured_at": "2026-01-01T10:00:00+00:00",
}


def _association(**kwargs) -> StudyParticipant:
    defaults = {
        "study_id": 1,
        "participant_id": "p1",
        "client_info": dict(FULL_BLOB),
        "client_info_captured_at": CAPTURED_AT,
    }
    defaults.update(kwargs)
    return StudyParticipant(**defaults)


def test_a_study_without_the_feature_exports_no_columns_at_all():
    """The main contract: nothing, not a block of nulls."""

    assert _client_info_export_columns(_association(), enabled=False) == {}
    assert _client_info_export_columns(None, enabled=False, include_raw_json=True) == {}


def test_columns_are_present_but_empty_without_an_association():
    columns = _client_info_export_columns(None, enabled=True)

    assert columns["client_info_collected"] is False
    assert columns["client_user_agent"] is None
    assert columns["client_info_captured_at"] is None
    # Every column must be present so the CSV/JSON schema stays stable.
    assert all(
        value is None
        for key, value in columns.items()
        if key != "client_info_collected"
    )


def test_the_curated_columns_are_filled():
    columns = _client_info_export_columns(_association(), enabled=True)

    assert columns["client_info_collected"] is True
    assert columns["client_user_agent"] == "Mozilla/5.0 (iPhone)"
    assert columns["client_platform"] == "iPhone"
    assert columns["client_language"] == "de"
    assert columns["client_timezone"] == "Europe/Berlin"
    assert columns["client_screen_width"] == 390
    assert columns["client_screen_height"] == 844
    assert columns["client_viewport_width"] == 390
    assert columns["client_viewport_height"] == 664
    assert columns["client_device_pixel_ratio"] == 3
    assert columns["client_max_touch_points"] == 5
    assert columns["client_info_schema_version"] == 1
    assert columns["client_info_capture_count"] == 2
    assert columns["client_info_first_captured_at"] == "2026-01-01T10:00:00+00:00"
    assert columns["client_info_captured_at"] == CAPTURED_AT.isoformat()


def test_the_export_is_small_and_grouped():
    """A prefix shared by every column keeps the block together in a CSV.

    ``export_csv`` sorts headers alphabetically, so a shared ``client_`` prefix
    is what makes the block contiguous instead of scattered among the
    ``participant_*`` columns.
    """

    columns = _client_info_export_columns(_association(), enabled=True)

    assert all(name.startswith("client_") for name in columns)
    assert len(columns) <= 20, sorted(columns)
    # No parsing results: the browser does not parse, so nothing derived is stored.
    for absent in (
        "client_browser_name",
        "client_os_name",
        "client_device_type",
        "client_info_parser_version",
    ):
        assert absent not in columns


def test_partial_and_malformed_blobs_do_not_raise():
    association = _association(
        client_info={"screen": "not-a-dict", "platform": "Android", "schema_version": 1}
    )

    columns = _client_info_export_columns(association, enabled=True)

    assert columns["client_info_collected"] is True
    # A scalar where a dict was expected is treated as "missing", not an error.
    assert columns["client_screen_width"] is None
    assert columns["client_platform"] == "Android"


def test_empty_blob_is_reported_as_not_collected():
    columns = _client_info_export_columns(_association(client_info={}), enabled=True)

    assert columns["client_info_collected"] is False
    assert columns["client_user_agent"] is None


def test_raw_json_is_only_included_on_request():
    without_json = _client_info_export_columns(_association(), enabled=True)
    assert "client_info_json" not in without_json

    with_json = _client_info_export_columns(
        _association(), enabled=True, include_raw_json=True
    )
    assert json.loads(with_json["client_info_json"])["platform"] == "iPhone"

    empty_json = _client_info_export_columns(
        _association(client_info={}), enabled=True, include_raw_json=True
    )
    assert empty_json["client_info_json"] is None
