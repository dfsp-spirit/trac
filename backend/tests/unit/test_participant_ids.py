"""The shared participant-id rule."""

import pytest

from o_timeusediary_backend.participant_ids import (
    PARTICIPANT_ID_MAX_LENGTH,
    InvalidParticipantIdError,
    is_valid_participant_id,
    normalize_participant_id,
    normalize_participant_ids,
    validate_participant_id,
)


@pytest.mark.parametrize(
    "value",
    [
        "asfj3432hasfADsaf",
        "pending_01",
        "diary-01",
        "a",
        "0",
        "0000000000000016",
        "_",
        "-",
    ],
)
def test_valid_ids(value):
    assert is_valid_participant_id(value)
    assert validate_participant_id(value) == value


@pytest.mark.parametrize(
    "value",
    [
        "",
        " ",
        "a b",
        "a.b",
        "a@b",
        "jürgen",
        "pid,other",
        "a\tb",
        "a" * (PARTICIPANT_ID_MAX_LENGTH + 1),
    ],
)
def test_invalid_ids(value):
    assert not is_valid_participant_id(value)
    with pytest.raises(InvalidParticipantIdError):
        validate_participant_id(value)


def test_validate_strips_surrounding_whitespace():
    assert validate_participant_id("  invite_a\n") == "invite_a"


def test_normalize_participant_id_returns_none_for_blank():
    assert normalize_participant_id("   ") is None
    assert normalize_participant_id(None) is None
    assert normalize_participant_id(" x ") == "x"


def test_normalize_ids_strips_and_keeps_first_occurrence_order():
    assert normalize_participant_ids([" b ", "a", "b", "", "a"]) == ["b", "a"]


def test_normalize_ids_reports_every_bad_value_with_a_reason():
    with pytest.raises(InvalidParticipantIdError) as excinfo:
        normalize_participant_ids(
            ["ok", "bad id", "x" * (PARTICIPANT_ID_MAX_LENGTH + 1)]
        )

    message = str(excinfo.value)
    assert "'bad id'" in message
    assert "'xxx" in message
    assert "longer than" in message
    assert "letters, digits" in message


def test_normalize_ids_rejects_blank_only_when_asked():
    assert normalize_participant_ids(["", "a"]) == ["a"]

    with pytest.raises(InvalidParticipantIdError) as excinfo:
        normalize_participant_ids(["", "a"], reject_blank=True)
    assert "(empty)" in str(excinfo.value)


def test_error_message_summarizes_long_lists():
    invalid = [f"bad id {index}" for index in range(9)]

    with pytest.raises(InvalidParticipantIdError) as excinfo:
        normalize_participant_ids(invalid)

    message = str(excinfo.value)
    assert "'bad id 4'" in message
    assert "'bad id 5'" not in message
    assert "and 4 more" in message
