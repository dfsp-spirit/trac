"""The shared study ``name_short`` rule."""

import pytest

from o_timeusediary_backend.study_names import (
    STUDY_NAME_SHORT_MAX_LENGTH,
    InvalidStudyNameShortError,
    is_valid_study_name_short,
    normalize_study_name_short,
    validate_study_name_short,
)


@pytest.mark.parametrize(
    "value",
    [
        "default",
        "pilot_mpiae_01_open",
        "newui_02_paused",
        "a1",
        "ab",
        "a" * STUDY_NAME_SHORT_MAX_LENGTH,
    ],
)
def test_valid_names(value):
    assert is_valid_study_name_short(value)
    assert validate_study_name_short(value) == value


@pytest.mark.parametrize(
    "value",
    [
        "",
        " ",
        "a",
        "ab" * 26,
        "Demo",
        "demo-study",
        "demo study",
        "demo.study",
        "demo/study",
        "study#1",
        "stüdy",
        "a" * (STUDY_NAME_SHORT_MAX_LENGTH + 1),
    ],
)
def test_invalid_names(value):
    assert not is_valid_study_name_short(value)
    with pytest.raises(InvalidStudyNameShortError):
        validate_study_name_short(value)


def test_validate_strips_surrounding_whitespace():
    assert validate_study_name_short("  demo_study\n") == "demo_study"


def test_normalize_returns_none_for_blank():
    assert normalize_study_name_short("   ") is None
    assert normalize_study_name_short(None) is None
    assert normalize_study_name_short(" demo ") == "demo"


@pytest.mark.parametrize(
    "value,reason",
    [
        ("", "empty"),
        ("a", "shorter than 2 characters"),
        ("a" * (STUDY_NAME_SHORT_MAX_LENGTH + 1), "longer than 50 characters"),
        ("Demo", "lowercase letters"),
    ],
)
def test_error_message_names_the_problem(value, reason):
    with pytest.raises(InvalidStudyNameShortError) as excinfo:
        validate_study_name_short(value)

    assert reason in str(excinfo.value)
