import pytest

from o_timeusediary_backend.api import (
    ActivitySubmitItem,
    _build_allowed_frequency_keys_by_code,
    _validate_frequency_key_for_codes,
)
from o_timeusediary_backend.parsers.activities_config import ActivitiesConfig


def _activities_payload_with_frequency() -> dict:
    return {
        "general": {"app_name": "TRAC"},
        "timeline": {
            "primary": {
                "name": "Primary",
                "mode": "single-choice",
                "categories": [
                    {
                        "name": "Main",
                        "activities": [
                            {
                                "name": "Sleep",
                                "code": 100,
                                "frequency_options": [
                                    {"key": "bi_weekly", "label": "Bi-weekly"},
                                    {"key": "monthly", "label": "Monthly"},
                                ],
                            },
                            {
                                "name": "Work",
                                "code": 200,
                            },
                        ],
                    }
                ],
            }
        },
    }


def test_build_allowed_frequency_keys_by_code_extracts_expected_sets():
    config = ActivitiesConfig(**_activities_payload_with_frequency())

    allowed = _build_allowed_frequency_keys_by_code(config)

    assert allowed[100] == {"bi_weekly", "monthly"}
    assert allowed[200] == set()


def test_validate_frequency_key_for_codes_allows_matching_key():
    config = ActivitiesConfig(**_activities_payload_with_frequency())
    allowed = _build_allowed_frequency_keys_by_code(config)

    activity_item = ActivitySubmitItem(
        timeline_key="primary",
        activity="Sleep",
        category="Main",
        code=100,
        start_minutes=0,
        end_minutes=10,
        mode="single-choice",
        frequency_key="monthly",
    )

    errors = _validate_frequency_key_for_codes(
        activity_item=activity_item,
        candidate_codes=[100],
        allowed_frequency_keys_by_code=allowed,
    )

    assert errors == []


def test_validate_frequency_key_for_codes_rejects_unknown_key():
    config = ActivitiesConfig(**_activities_payload_with_frequency())
    allowed = _build_allowed_frequency_keys_by_code(config)

    activity_item = ActivitySubmitItem(
        timeline_key="primary",
        activity="Sleep",
        category="Main",
        code=100,
        start_minutes=0,
        end_minutes=10,
        mode="single-choice",
        frequency_key="weekly",
    )

    errors = _validate_frequency_key_for_codes(
        activity_item=activity_item,
        candidate_codes=[100],
        allowed_frequency_keys_by_code=allowed,
    )

    assert len(errors) == 1
    assert errors[0]["reason"] == "frequency_key_not_allowed"
    assert errors[0]["allowed_frequency_keys"] == ["bi_weekly", "monthly"]


def test_validate_frequency_key_for_codes_rejects_when_activity_has_no_frequency_options():
    config = ActivitiesConfig(**_activities_payload_with_frequency())
    allowed = _build_allowed_frequency_keys_by_code(config)

    activity_item = ActivitySubmitItem(
        timeline_key="primary",
        activity="Work",
        category="Main",
        code=200,
        start_minutes=0,
        end_minutes=10,
        mode="single-choice",
        frequency_key="monthly",
    )

    errors = _validate_frequency_key_for_codes(
        activity_item=activity_item,
        candidate_codes=[200],
        allowed_frequency_keys_by_code=allowed,
    )

    assert len(errors) == 1
    assert errors[0]["reason"] == "no_frequency_options_for_activity"


def test_activity_submit_item_rejects_blank_frequency_key():
    with pytest.raises(ValueError, match="frequency_key"):
        ActivitySubmitItem(
            timeline_key="primary",
            activity="Sleep",
            category="Main",
            code=100,
            start_minutes=0,
            end_minutes=10,
            mode="single-choice",
            frequency_key="   ",
        )
