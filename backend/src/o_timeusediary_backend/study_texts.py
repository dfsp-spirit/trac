"""Shared metadata and validation for localized study texts.

Every path that writes study text (the CLI/config parser, the admin import
endpoint and the admin text editor) must use this module. The texts live in JSON
columns on ``Study``; ``description`` also accepts the legacy single-string form.

Keeping the field list, the per-language rules and the revision hash in one place
is what prevents the CLI, the admin import and the admin editor from drifting
apart.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Mapping, Optional, Sequence

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class StudyTextFieldSpec:
    """One editable study text.

    ``format`` is advisory: it tells the admin editor which syntax the field is
    rendered with and lets it show the right help text. Validation only cares
    about language completeness and non-empty values.
    """

    key: str
    label: str
    group: str
    format: str
    help_text: str
    supports_legacy_string: bool = False


STUDY_TEXT_FIELD_SPECS: tuple[StudyTextFieldSpec, ...] = (
    StudyTextFieldSpec(
        key="description",
        label="Study description",
        group="Study information",
        format="plain",
        help_text="Shown on the admin overview and study detail page.",
        supports_legacy_string=True,
    ),
    StudyTextFieldSpec(
        key="study_text_intro",
        label="Introduction",
        group="Instructions page",
        format="markdown",
        help_text="Short introduction at the top of the instructions page. Markdown is supported.",
    ),
    StudyTextFieldSpec(
        key="study_text_instructions_title",
        label="Page title",
        group="Instructions page",
        format="inline_markdown",
        help_text="Heading at the very top of the instructions page. Inline Markdown only.",
    ),
    StudyTextFieldSpec(
        key="study_text_instructions",
        label="Instructions",
        group="Instructions page",
        format="markdown",
        help_text="Main instructions text below the introduction. Markdown is supported.",
    ),
    StudyTextFieldSpec(
        key="study_text_consent",
        label="Consent text",
        group="Consent",
        format="markdown",
        help_text="Text shown on the consent page. Markdown is supported.",
    ),
    StudyTextFieldSpec(
        key="study_text_end_noconsent",
        label="No-consent end text",
        group="Consent",
        format="html",
        help_text="Shown when a participant does not give consent. Raw HTML is inserted as-is.",
    ),
    StudyTextFieldSpec(
        key="study_text_end_completed",
        label="Completion end text",
        group="End pages",
        format="html",
        help_text="Shown after a participant completes all days. Raw HTML is inserted as-is.",
    ),
    StudyTextFieldSpec(
        key="study_text_end_skipped",
        label="Skipped end text",
        group="End pages",
        format="html",
        help_text="Shown when a participant skips the time-use part. Raw HTML is inserted as-is.",
    ),
    StudyTextFieldSpec(
        key="inactivity_page_custom_text",
        label="Inactivity page text",
        group="Inactivity page",
        format="markdown",
        help_text="Shown when a session times out due to inactivity. Markdown is supported.",
    ),
)

STUDY_TEXT_FIELD_NAMES: tuple[str, ...] = tuple(
    spec.key for spec in STUDY_TEXT_FIELD_SPECS
)


def study_text_specs_payload() -> list[dict[str, Any]]:
    """Return the editor metadata as JSON-serializable dictionaries."""
    return [asdict(spec) for spec in STUDY_TEXT_FIELD_SPECS]


def study_text_values_from_object(study_or_payload: Any) -> Dict[str, Any]:
    """Collect the text values from a ``Study`` or an import payload."""
    return {
        spec.key: getattr(study_or_payload, spec.key, None)
        for spec in STUDY_TEXT_FIELD_SPECS
    }


def canonical_study_text_values(study: Any) -> Dict[str, Optional[Dict[str, str]]]:
    """Normalize a study's text columns into ``{field: {language: text} | None}``.

    A legacy string ``description`` is represented as a map keyed by the study's
    default language. Empty maps and empty strings are returned as ``None`` so
    "not configured" has one representation in API payloads.
    """
    default_language = getattr(study, "default_language", None) or "en"
    values: Dict[str, Optional[Dict[str, str]]] = {}
    for spec in STUDY_TEXT_FIELD_SPECS:
        value = getattr(study, spec.key, None)
        if spec.supports_legacy_string and isinstance(value, str):
            values[spec.key] = {default_language: value} if value.strip() else None
        elif isinstance(value, dict) and value:
            values[spec.key] = dict(value)
        else:
            values[spec.key] = None
    return values


def study_text_revision(values: Mapping[str, Any]) -> str:
    """Stable content hash used for optimistic concurrency in the editor."""
    canonical = json.dumps(
        values,
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def validate_study_text_values(
    *,
    values: Mapping[str, Any],
    supported_languages: Sequence[str],
    default_language: str,
    study_name_short: str,
    require_complete_translations: bool = True,
) -> List[str]:
    """Validate the localized study text fields.

    Missing translations are hard errors for authoring paths (CLI/config
    parser, admin text editor). The admin import flow passes
    ``require_complete_translations=False`` because it must also restore an
    existing database export whose maps can be partial; those cases are returned
    as warnings so the admin still sees them. Values that are not maps, and
    empty individual strings, stay hard errors in both modes.

    Returns the warning messages (extra language keys, and missing translations
    in restore mode) so callers can surface them in an API response.
    """
    languages = list(dict.fromkeys(supported_languages))
    language_set = set(languages)
    warnings: List[str] = []

    def record_warning(message: str) -> None:
        logger.warning("%s", message)
        warnings.append(message)

    for spec in STUDY_TEXT_FIELD_SPECS:
        value = values.get(spec.key)
        if value is None:
            continue

        if spec.supports_legacy_string and isinstance(value, str):
            # Legacy single-string description: valid for the default language.
            # An empty string is treated as "not configured", like the importer.
            continue

        if not isinstance(value, dict):
            if spec.supports_legacy_string:
                raise ValueError(
                    f"Study '{study_name_short}': "
                    f"description must be either a string or a localized map (dict), "
                    f"got {type(value).__name__}."
                )
            raise ValueError(
                f"Study '{study_name_short}': "
                f"{spec.key} must be an object mapping language codes to text"
            )

        for language, text_value in value.items():
            if language not in language_set:
                record_warning(
                    f"Study '{study_name_short}': {spec.key} defines extra "
                    f"language '{language}' without corresponding "
                    "activities_json_files entry. This language will not be "
                    "available in the app."
                )
            if not isinstance(text_value, str) or text_value.strip() == "":
                raise ValueError(
                    f"Study '{study_name_short}': "
                    f'{spec.key}["{language}"] must be a non-empty string'
                )

        if spec.supports_legacy_string and default_language not in value:
            if require_complete_translations:
                raise ValueError(
                    f"Study '{study_name_short}': description is a localized map "
                    f'but is missing the default_language "{default_language}". '
                    f'Add a description for "{default_language}".'
                )
            record_warning(
                f"Study '{study_name_short}': description is a localized map "
                f'but is missing the default_language "{default_language}". '
                "Participants fall back to another available language."
            )

        missing_languages = sorted(language_set - set(value.keys()))
        if missing_languages:
            if spec.supports_legacy_string:
                message = (
                    f"Study '{study_name_short}': description is missing "
                    f"translations for supported languages: {missing_languages}."
                )
                if require_complete_translations:
                    message += (
                        " If description is provided as a localized map, it must "
                        "include all supported languages."
                    )
            else:
                message = (
                    f"Study '{study_name_short}': {spec.key} is missing "
                    f"translations for supported_languages: {missing_languages}."
                )
            if require_complete_translations:
                raise ValueError(message)
            record_warning(
                f"{message} Missing languages fall back to the default_language "
                f'"{default_language}" at runtime.'
            )

    return warnings
