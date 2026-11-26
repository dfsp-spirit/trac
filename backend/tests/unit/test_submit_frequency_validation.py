from o_timeusediary_backend.api_deps.frequency import (
    allowed_frequency_keys_by_code,
    frequency_key_errors,
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


def test_allowed_frequency_keys_by_code_extracts_expected_sets():
    config = ActivitiesConfig(**_activities_payload_with_frequency())

    allowed = allowed_frequency_keys_by_code(config)

    assert allowed[100] == {"bi_weekly", "monthly"}
    assert allowed[200] == set()


def test_frequency_key_errors_allows_matching_key():
    config = ActivitiesConfig(**_activities_payload_with_frequency())
    allowed = allowed_frequency_keys_by_code(config)

    errors = frequency_key_errors(
        frequency_key="monthly",
        candidate_codes=[100],
        allowed_by_code=allowed,
        timeline_key="primary",
        activity_name="Sleep",
    )

    assert errors == []


def test_frequency_key_errors_rejects_unknown_key():
    config = ActivitiesConfig(**_activities_payload_with_frequency())
    allowed = allowed_frequency_keys_by_code(config)

    errors = frequency_key_errors(
        frequency_key="weekly",
        candidate_codes=[100],
        allowed_by_code=allowed,
        timeline_key="primary",
        activity_name="Sleep",
    )

    assert len(errors) == 1
    assert errors[0]["reason"] == "frequency_key_not_allowed"
    assert errors[0]["allowed_frequency_keys"] == ["bi_weekly", "monthly"]


def test_frequency_key_errors_rejects_when_activity_has_no_frequency_options():
    config = ActivitiesConfig(**_activities_payload_with_frequency())
    allowed = allowed_frequency_keys_by_code(config)

    errors = frequency_key_errors(
        frequency_key="monthly",
        candidate_codes=[200],
        allowed_by_code=allowed,
        timeline_key="primary",
        activity_name="Work",
    )

    assert len(errors) == 1
    assert errors[0]["reason"] == "no_frequency_options_for_activity"


def test_frequency_key_errors_ignores_absent_key():
    config = ActivitiesConfig(**_activities_payload_with_frequency())
    allowed = allowed_frequency_keys_by_code(config)

    errors = frequency_key_errors(
        frequency_key=None,
        candidate_codes=[100],
        allowed_by_code=allowed,
    )

    assert errors == []
