"""The shared study-text policy used by CLI, admin import and the editor."""

from __future__ import annotations

import logging
from types import SimpleNamespace

import pytest

from o_timeusediary_backend.study_texts import (
    STUDY_TEXT_FIELD_NAMES,
    canonical_study_text_values,
    missing_consent_languages,
    study_text_revision,
    study_text_values_from_object,
    validate_study_text_values,
)


def _values(**overrides):
    values = {
        "description": {"en": "English description", "sv": "Svensk beskrivning"},
        "study_text_intro": {"en": "Welcome", "sv": "Välkommen"},
        "study_text_instructions_title": {"en": "Title", "sv": "Titel"},
        "study_text_instructions": {"en": "Instructions", "sv": "Instruktioner"},
        "study_text_consent": {"en": "Consent", "sv": "Samtycke"},
        "study_text_end_noconsent": {"en": "No consent", "sv": "Inget samtycke"},
        "study_text_end_completed": {"en": "Done", "sv": "Klar"},
        "study_text_end_skipped": {"en": "Skipped", "sv": "Hoppade över"},
        "inactivity_page_custom_text": {"en": "Timeout", "sv": "Tidsgräns"},
    }
    values.update(overrides)
    return values


def _validate(values):
    validate_study_text_values(
        values=values,
        supported_languages=["en", "sv"],
        default_language="en",
        study_name_short="demo",
    )


def test_specs_cover_every_editable_text():
    assert "description" in STUDY_TEXT_FIELD_NAMES
    assert "inactivity_page_custom_text" in STUDY_TEXT_FIELD_NAMES
    assert "study_text_instructions_title" in STUDY_TEXT_FIELD_NAMES


def test_complete_maps_pass():
    _validate(_values())


def test_missing_consent_languages_reports_missing_or_blank_entries():
    assert missing_consent_languages(_values(), ["en", "sv"]) == []
    assert missing_consent_languages(
        _values(study_text_consent={"en": "Consent"}), ["en", "sv"]
    ) == ["sv"]
    assert missing_consent_languages(
        _values(study_text_consent={"en": "Consent", "sv": "   "}), ["en", "sv"]
    ) == ["sv"]
    assert missing_consent_languages(
        _values(study_text_consent=None), ["en", "sv"]
    ) == ["en", "sv"]


def test_missing_language_is_rejected():
    values = _values(study_text_intro={"en": "Welcome"})

    with pytest.raises(
        ValueError,
        match="study_text_intro is missing translations for supported_languages: \\['sv'\\]",
    ):
        _validate(values)


def test_empty_text_is_rejected():
    values = _values(study_text_consent={"en": "Consent", "sv": "   "})

    with pytest.raises(
        ValueError,
        match='study_text_consent\\["sv"\\] must be a non-empty string',
    ):
        _validate(values)


def test_non_mapping_is_rejected():
    values = _values(study_text_intro="not a map")

    with pytest.raises(
        ValueError,
        match="study_text_intro must be an object mapping language codes to text",
    ):
        _validate(values)


def test_legacy_description_string_is_accepted():
    _validate(_values(description="A legacy single-language description"))


def test_description_map_must_contain_default_language():
    values = _values(description={"sv": "Svensk"})

    with pytest.raises(ValueError, match='missing the default_language "en"'):
        _validate(values)


def test_description_map_must_contain_every_supported_language():
    values = _values(description={"en": "English"})

    with pytest.raises(
        ValueError,
        match="description is missing translations for supported languages: \\['sv'\\]",
    ):
        _validate(values)


def test_extra_language_is_a_warning_not_an_error(caplog):
    values = _values(
        study_text_intro={"en": "Welcome", "sv": "Välkommen", "de": "Willkommen"}
    )

    with caplog.at_level(logging.WARNING):
        _validate(values)

    assert "defines extra language 'de'" in caplog.text


def test_canonical_values_convert_legacy_description_and_empty_maps():
    study = SimpleNamespace(
        default_language="en",
        description="Legacy description",
        study_text_intro={"en": "Welcome"},
        study_text_instructions_title={},
        study_text_instructions=None,
        study_text_consent=None,
        study_text_end_noconsent=None,
        study_text_end_completed=None,
        study_text_end_skipped=None,
        inactivity_page_custom_text=None,
    )

    values = canonical_study_text_values(study)

    assert values["description"] == {"en": "Legacy description"}
    assert values["study_text_intro"] == {"en": "Welcome"}
    assert values["study_text_instructions_title"] is None


def test_revision_is_stable_and_changes_with_content():
    first = canonical_study_text_values(
        SimpleNamespace(
            default_language="en",
            description={"en": "One"},
            study_text_intro=None,
            study_text_instructions_title=None,
            study_text_instructions=None,
            study_text_consent=None,
            study_text_end_noconsent=None,
            study_text_end_completed=None,
            study_text_end_skipped=None,
            inactivity_page_custom_text=None,
        )
    )
    second = dict(first)
    second["description"] = {"en": "Two"}

    assert study_text_revision(first) == study_text_revision(dict(first))
    assert study_text_revision(first) != study_text_revision(second)


def test_values_from_object_collects_every_spec():
    study = SimpleNamespace(**{name: None for name in STUDY_TEXT_FIELD_NAMES})

    values = study_text_values_from_object(study)

    assert set(values) == set(STUDY_TEXT_FIELD_NAMES)


def test_missing_language_is_a_warning_in_restore_mode():
    values = _values(study_text_intro={"en": "Welcome"})

    warnings = validate_study_text_values(
        values=values,
        supported_languages=["en", "sv"],
        default_language="en",
        study_name_short="demo",
        require_complete_translations=False,
    )

    assert any(
        "study_text_intro is missing translations for supported_languages: ['sv']"
        in warning
        for warning in warnings
    )
