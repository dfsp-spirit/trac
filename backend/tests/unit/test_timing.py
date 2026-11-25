"""The study's time grid: which configurations are accepted, and why."""

import os
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

os.environ.setdefault("TUD_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("TUD_ALLOWED_ORIGINS", '["http://localhost:3000"]')

from o_timeusediary_backend.parsers.studies_config import CfgFileStudy
from o_timeusediary_backend.timing import (
    TIME_STEP_CHOICES,
    validate_timing_settings,
)


def _study(**overrides) -> CfgFileStudy:
    payload = {
        "name": "Timing study",
        "name_short": "timing_study",
        "day_labels": [
            {"name": "monday", "display_order": 0, "display_names": {"en": "Monday"}}
        ],
        "activities_json_file": "activities_default.json",
        "data_collection_start": datetime(2024, 1, 1, tzinfo=UTC),
        "data_collection_end": datetime(2028, 1, 1, tzinfo=UTC),
        **overrides,
    }
    return CfgFileStudy(**payload)


def test_the_defaults_are_the_historical_grid():
    study = _study()
    assert study.time_step_minutes == 10
    assert study.min_duration_minutes == 10


def test_a_five_minute_step_with_a_ten_minute_minimum_is_accepted():
    study = _study(time_step_minutes=5, min_duration_minutes=10)
    assert (study.time_step_minutes, study.min_duration_minutes) == (5, 10)


@pytest.mark.parametrize(
    "timing",
    [
        {"time_step_minutes": 25},  # does not divide 1440: midnight off the grid
        {"time_step_minutes": 7},  # not a multiple of five
        {"time_step_minutes": 15, "min_duration_minutes": 10},  # minimum off the grid
        {"time_step_minutes": 10, "min_duration_minutes": 5},  # below the step
    ],
)
def test_an_impossible_grid_is_refused_with_the_study_name(timing):
    with pytest.raises(ValidationError) as excinfo:
        _study(**timing)
    assert "timing_study" in str(excinfo.value)


def test_the_choices_are_multiples_of_five_that_divide_the_day():
    for step in TIME_STEP_CHOICES:
        assert step % 5 == 0
        assert 1440 % step == 0


def test_validate_timing_settings_accepts_valid_pairs_and_refuses_the_rest():
    validate_timing_settings(5, 10)
    validate_timing_settings(10, 20)
    with pytest.raises(ValueError):
        validate_timing_settings(20, 10)
    with pytest.raises(ValueError):
        validate_timing_settings(15, 20)
