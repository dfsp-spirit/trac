"""The shared participant display-name rule and the study-text placeholders."""

import pytest

from o_timeusediary_backend.display_names import (
    DISPLAY_NAME_MAX_LENGTH,
    InvalidDisplayNameError,
    is_valid_display_name,
    normalize_display_name,
    validate_display_name,
)
from o_timeusediary_backend.utils import substitute_study_text_placeholders


@pytest.mark.parametrize(
    "value",
    [
        "Tim",
        "ä",
        "Jörg",
        "Åsa Örjan",
        "José",
        "O'Brien",
        "D’Angelo",
        "Jean-Luc",
        "J. R. R.",
        "Anna-Lena",
        "Kind 1",
        "Łukasz Żółć",
        "Анна",
        "李",
        "محمد",
        "שרה",
    ],
)
def test_valid_names(value):
    assert is_valid_display_name(value)
    assert validate_display_name(value) == value


@pytest.mark.parametrize(
    "raw,normalized",
    [
        ("  Tim  ", "Tim"),
        ("Tim   Tom", "Tim Tom"),
        # A non-breaking space is what a spreadsheet paste produces.
        ("Tim\u00a0Tom", "Tim Tom"),
        # Composed and decomposed spellings are the same name (NFC).
        ("Jose\u0301", "Jos\u00e9"),
    ],
)
def test_names_are_normalized(raw, normalized):
    assert normalize_display_name(raw) == normalized
    assert validate_display_name(raw) == normalized


@pytest.mark.parametrize(
    "value",
    [
        "",
        " ",
        "- Tim",
        ".Tim",
        "Tim-",
        "Tim & Tom",
        "Tim/Tom",
        "Tim, Tom",
        "Tim(",
        "<b>Tim</b>",
        "**Tim**",
        "Tim `x`",
        "👦 Tim",
        "x" * (DISPLAY_NAME_MAX_LENGTH + 1),
    ],
)
def test_invalid_names(value):
    assert not is_valid_display_name(value)
    with pytest.raises(InvalidDisplayNameError):
        validate_display_name(value)


@pytest.mark.parametrize("value", ["Tim\nTom", "Tim\tTom", "Tim\u200b", "\u202etim"])
def test_invisible_characters_are_rejected_not_collapsed(value):
    """A stray newline could be two values; joining them would invent a name."""
    with pytest.raises(InvalidDisplayNameError):
        validate_display_name(value)


def test_the_error_names_the_offending_codepoint():
    with pytest.raises(InvalidDisplayNameError) as error:
        validate_display_name("Tim\u202eTom")
    assert "U+202E" in str(error.value)


def test_study_text_placeholder_is_replaced():
    text = "Bitte füllen Sie das Tagebuch für {display_name} aus."
    assert substitute_study_text_placeholders(text, {"display_name": "Jörg"}) == (
        "Bitte füllen Sie das Tagebuch für Jörg aus."
    )


def test_a_missing_value_leaves_the_placeholder_visible():
    """An empty string would break the sentence; a visible token is fixable."""
    text = "Diary for {display_name}."
    assert substitute_study_text_placeholders(text, {"display_name": None}) == text
    assert substitute_study_text_placeholders(text, {}) == text


def test_unknown_tokens_are_left_alone():
    text = "Hello {subject}!"
    assert substitute_study_text_placeholders(text, {"display_name": "Tim"}) == text


def test_none_stays_none():
    assert substitute_study_text_placeholders(None, {"display_name": "Tim"}) is None
    assert substitute_study_text_placeholders("", {"display_name": "Tim"}) == ""


def test_markdown_in_a_value_is_escaped():
    """Backstop for values that bypassed the validator (e.g. a repaired row)."""
    assert (
        substitute_study_text_placeholders(
            "{display_name}", {"display_name": "Tim *x* [y](z)"}
        )
        == "Tim \\*x\\* \\[y\\]\\(z\\)"
    )
