"""File format schema versions.

Three format families are versioned (see ``o_timeusediary_backend/formats.py``):
``studies_config``, the activities file, and the admin data exports. These tests
pin the reading policy that all three share:

* absent key means version 1, so files written before versioning keep working,
* the current version is accepted,
* a newer version is rejected with an actionable message (never parsed),
* a value that is not a positive integer is rejected - including ``true``,
  which pydantic's lax mode would otherwise turn into ``1``.
"""

import pytest
from pydantic import ValidationError

from o_timeusediary_backend.formats import (
    ACTIVITIES_SCHEMA_VERSION,
    EXPORT_SCHEMA_VERSION,
    STUDIES_CONFIG_SCHEMA_VERSION,
    UnsupportedSchemaVersionError,
    coerce_schema_version,
    ensure_supported_schema_version,
    read_schema_version,
)
from o_timeusediary_backend.parsers.activities_config import ActivitiesConfig
from o_timeusediary_backend.parsers.studies_config import CfgFileStudies


def _minimal_study() -> dict:
    return {
        "name": "Schema Version Study",
        "name_short": "schema_study",
        "day_labels": [
            {"name": "day1", "display_order": 0, "display_names": {"en": "Day 1"}}
        ],
        "study_participant_ids": [],
        "allow_unlisted_participants": True,
        "default_language": "en",
        "supported_languages": ["en"],
        "activities_json_data": {"en": _minimal_activities()},
        "data_collection_start": "2024-01-01T00:00:00Z",
        "data_collection_end": "2028-12-31T23:59:59Z",
    }


def _minimal_activities() -> dict:
    return {
        "general": {"app_name": "TRAC", "language": "en"},
        "timeline": {
            "primary": {
                "name": "Primary",
                "mode": "single-choice",
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


# --- formats.py primitives ---------------------------------------------------


@pytest.mark.parametrize("value", [1, 2, 42, "3"])
def test_coerce_accepts_positive_integers(value):
    assert coerce_schema_version(value) == int(value)


@pytest.mark.parametrize("value", [0, -1, True, False, 1.0, "x", None, [], {}])
def test_coerce_rejects_everything_that_is_not_a_positive_integer(value):
    with pytest.raises(ValueError):
        coerce_schema_version(value)


def test_read_schema_version_defaults_to_one_when_absent():
    assert read_schema_version({"studies": []}, "studies_config") == 1


def test_ensure_supported_accepts_the_current_version():
    assert (
        ensure_supported_schema_version(
            {"schema_version": STUDIES_CONFIG_SCHEMA_VERSION},
            "studies_config",
            STUDIES_CONFIG_SCHEMA_VERSION,
        )
        == STUDIES_CONFIG_SCHEMA_VERSION
    )


def test_ensure_supported_rejects_a_newer_version_with_an_actionable_message():
    with pytest.raises(UnsupportedSchemaVersionError) as excinfo:
        ensure_supported_schema_version({"schema_version": 99}, "studies_config", 1)
    message = str(excinfo.value)
    assert "99" in message and "supports 1" in message
    assert "newer TRAC" in message


def test_ensure_supported_rejects_a_version_below_the_oldest_readable():
    with pytest.raises(UnsupportedSchemaVersionError):
        ensure_supported_schema_version(
            {"schema_version": 1}, "studies_config", 3, oldest_readable=2
        )


# --- studies_config ----------------------------------------------------------


def test_studies_config_without_version_is_read_as_version_one():
    parsed = CfgFileStudies(studies=[_minimal_study()])
    assert parsed.schema_version == 1 == STUDIES_CONFIG_SCHEMA_VERSION


def test_studies_config_accepts_an_explicit_current_version():
    parsed = CfgFileStudies(
        schema_version=STUDIES_CONFIG_SCHEMA_VERSION, studies=[_minimal_study()]
    )
    assert parsed.schema_version == STUDIES_CONFIG_SCHEMA_VERSION


def test_studies_config_rejects_a_newer_version():
    with pytest.raises(ValidationError) as excinfo:
        CfgFileStudies(schema_version=STUDIES_CONFIG_SCHEMA_VERSION + 1, studies=[])
    assert "newer TRAC" in str(excinfo.value)


@pytest.mark.parametrize("bad_value", [0, -3, True, "1.0", 1.5])
def test_studies_config_rejects_a_malformed_version(bad_value):
    with pytest.raises(ValidationError):
        CfgFileStudies(schema_version=bad_value, studies=[])


def test_studies_config_accepts_a_numeric_string_version():
    assert CfgFileStudies(schema_version="1", studies=[]).schema_version == 1


# --- activities --------------------------------------------------------------


def test_activities_without_version_stay_valid():
    parsed = ActivitiesConfig(**_minimal_activities())
    assert parsed.general.schema_version is None
    assert parsed.general.version is None


def test_activities_accept_the_current_version_in_general():
    payload = _minimal_activities()
    payload["general"]["schema_version"] = ACTIVITIES_SCHEMA_VERSION
    parsed = ActivitiesConfig(**payload)
    assert parsed.general.schema_version == ACTIVITIES_SCHEMA_VERSION


def test_activities_general_version_stays_authoring_metadata():
    """``general.version`` predates versioning and must not be reinterpreted."""
    payload = _minimal_activities()
    payload["general"]["version"] = "2.7.0"
    parsed = ActivitiesConfig(**payload)
    assert parsed.general.version == "2.7.0"
    assert parsed.general.schema_version is None


def test_activities_reject_a_newer_version():
    payload = _minimal_activities()
    payload["general"]["schema_version"] = ACTIVITIES_SCHEMA_VERSION + 1
    with pytest.raises(ValidationError) as excinfo:
        ActivitiesConfig(**payload)
    assert "newer TRAC" in str(excinfo.value)


def test_activities_reject_a_boolean_version():
    payload = _minimal_activities()
    payload["general"]["schema_version"] = True
    with pytest.raises(ValidationError):
        ActivitiesConfig(**payload)


# --- export envelope ---------------------------------------------------------


def test_export_schema_version_is_a_positive_integer():
    """The constant is written into envelopes and headers, so it must be an int."""
    assert isinstance(EXPORT_SCHEMA_VERSION, int)
    assert EXPORT_SCHEMA_VERSION >= 1
