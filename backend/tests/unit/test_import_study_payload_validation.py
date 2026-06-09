import os
import json
from pathlib import Path

import pytest

os.environ.setdefault("TUD_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("TUD_ALLOWED_ORIGINS", '["http://localhost:3000"]')

from o_timeusediary_backend.api import (
    ImportStudiesConfigStudy,
    _build_external_task_continuation_url,
    _extract_study_from_studies_config_for_validation,
    _validate_import_study_payload,
)
from o_timeusediary_backend.models import StudyExternalTask
from o_timeusediary_backend.settings import settings


def _minimal_activities_payload(codes):
    return {
        "general": {"app_name": "TRAC", "version": "1.0", "language": "en"},
        "timeline": {
            "primary": {
                "name": "Primary",
                "description": "",
                "mode": "single-choice",
                "min_coverage": 0,
                "categories": [
                    {
                        "name": "General",
                        "activities": [
                            {
                                "name": f"Activity {code}",
                                "code": code,
                                "label": f"activity-{code}",
                                "color": "#000000",
                                "childItems": [],
                            }
                            for code in codes
                        ],
                    }
                ],
            }
        },
    }


def _base_payload():
    return {
        "name": "Unit Import Study",
        "name_short": "unit_import_study",
        "description": "payload validation",
        "day_labels": [
            {
                "name": "monday",
                "display_order": 0,
                "display_names": {"en": "Monday"},
            }
        ],
        "study_participant_ids": [],
        "allow_unlisted_participants": True,
        "default_language": "en",
        "supported_languages": ["en"],
        "data_collection_start": "2024-01-01T00:00:00Z",
        "data_collection_end": "2028-12-31T23:59:59Z",
    }


def _external_task_payload(
    task_key: str,
    *,
    participant_ids: list[str],
    confirmation_type: str = "none",
    token_values: list[str] | None = None,
) -> dict:
    values = token_values or [f"tok-{index + 1}" for index in range(len(participant_ids))]
    by_participant = {
        participant_id: values[index]
        for index, participant_id in enumerate(participant_ids)
    }
    return {
        "task_key": task_key,
        "name": {"en": "Payment Survey"},
        "description": {"en": "Post-study payment handoff."},
        "outbound_url": "https://example.org/payment?pid={participant_id}&study={study_name}&task={task_key}&survey_token={survey_token}",
        "confirmation_type": confirmation_type,
        "outbound_tokens": [
            {
                "name": "survey_token",
                "by_participant": by_participant,
            }
        ],
    }


def test_validate_import_payload_rejects_both_activities_sources():
    payload = _base_payload()
    payload["activities_json_data"] = {"en": _minimal_activities_payload([100])}
    payload["activities_json_files"] = {"en": "activities_default.json"}

    study_payload = ImportStudiesConfigStudy(**payload)

    with pytest.raises(
        ValueError,
        match="Provide exactly one of activities_json_data or activities_json_files, not both",
    ):
        _validate_import_study_payload(study_payload)


def test_validate_import_payload_accepts_activities_json_files_only(tmp_path):
    activities_file = tmp_path / "activities_test.en.json"
    activities_file.write_text(
        json.dumps(_minimal_activities_payload([100, 200])), encoding="utf-8"
    )

    studies_config_file = tmp_path / "studies_config.json"
    studies_config_file.write_text('{"studies": []}', encoding="utf-8")

    previous_studies_config_path = settings.studies_config_path
    settings.studies_config_path = str(studies_config_file)
    try:
        payload = _base_payload()
        payload["activities_json_files"] = {"en": str(Path("activities_test.en.json"))}

        study_payload = ImportStudiesConfigStudy(**payload)
        validated = _validate_import_study_payload(study_payload)

        assert validated["default_language"] == "en"
        assert "en" in validated["parsed_activities_by_lang"]
        assert "en" in validated["raw_activities_by_lang"]
    finally:
        settings.studies_config_path = previous_studies_config_path


def test_import_study_payload_require_consent_defaults_to_false():
    payload = _base_payload()
    payload["activities_json_data"] = {"en": _minimal_activities_payload([100])}
    study_payload = ImportStudiesConfigStudy(**payload)
    assert study_payload.require_consent is False


def test_import_study_payload_require_consent_can_be_true():
    payload = _base_payload()
    payload["require_consent"] = True
    payload["activities_json_data"] = {"en": _minimal_activities_payload([100])}
    study_payload = ImportStudiesConfigStudy(**payload)
    assert study_payload.require_consent is True


def test_import_study_payload_accepts_study_text_consent_and_noconsent():
    payload = _base_payload()
    payload["require_consent"] = True
    payload["study_text_consent"] = {"en": "Please consent.", "de": "Bitte zustimmen."}
    payload["study_text_end_noconsent"] = {"en": "No consent given."}
    payload["activities_json_data"] = {"en": _minimal_activities_payload([100])}
    study_payload = ImportStudiesConfigStudy(**payload)
    assert study_payload.require_consent is True
    assert study_payload.study_text_consent == {
        "en": "Please consent.",
        "de": "Bitte zustimmen.",
    }
    assert study_payload.study_text_end_noconsent == {"en": "No consent given."}


def test_import_study_payload_accepts_external_tasks():
    payload = _base_payload()
    payload["allow_unlisted_participants"] = False
    payload["study_participant_ids"] = ["p1", "p2"]
    payload["activities_json_data"] = {"en": _minimal_activities_payload([100])}
    payload["external_tasks"] = [
        _external_task_payload("payment", participant_ids=["p1", "p2"])
    ]

    study_payload = ImportStudiesConfigStudy(**payload)

    assert len(study_payload.external_tasks) == 1
    assert study_payload.external_tasks[0].task_key == "payment"
    assert study_payload.external_tasks[0].outbound_tokens[0].name == "survey_token"
    assert study_payload.external_tasks[0].outbound_tokens[0].by_participant == {
        "p1": "tok-1",
        "p2": "tok-2",
    }


def test_validate_import_payload_rejects_external_tasks_for_open_study():
    payload = _base_payload()
    payload["allow_unlisted_participants"] = True
    payload["study_participant_ids"] = ["p1", "p2"]
    payload["activities_json_data"] = {"en": _minimal_activities_payload([100])}
    payload["external_tasks"] = [
        _external_task_payload("payment", participant_ids=["p1", "p2"])
    ]

    study_payload = ImportStudiesConfigStudy(**payload)

    with pytest.raises(
        ValueError,
        match="external_tasks require allow_unlisted_participants=false",
    ):
        _validate_import_study_payload(study_payload)


def test_validate_import_payload_rejects_external_tasks_with_wrong_token_count():
    payload = _base_payload()
    payload["allow_unlisted_participants"] = False
    payload["study_participant_ids"] = ["p1", "p2"]
    payload["activities_json_data"] = {"en": _minimal_activities_payload([100])}
    payload["external_tasks"] = [
        _external_task_payload("payment", participant_ids=["p1"])
    ]

    study_payload = ImportStudiesConfigStudy(**payload)

    with pytest.raises(ValueError, match="must define tokens for exactly the study participants"):
        _validate_import_study_payload(study_payload)


def test_validate_import_payload_rejects_external_tasks_with_unsupported_confirmation_type():
    payload = _base_payload()
    payload["allow_unlisted_participants"] = False
    payload["study_participant_ids"] = ["p1"]
    payload["activities_json_data"] = {"en": _minimal_activities_payload([100])}
    payload["external_tasks"] = [
        _external_task_payload(
            "payment", participant_ids=["p1"], confirmation_type="email"
        )
    ]

    study_payload = ImportStudiesConfigStudy(**payload)

    with pytest.raises(ValueError, match="unsupported confirmation_type"):
        _validate_import_study_payload(study_payload)


def test_validate_import_payload_rejects_external_tasks_with_duplicate_tokens():
    payload = _base_payload()
    payload["allow_unlisted_participants"] = False
    payload["study_participant_ids"] = ["p1", "p2"]
    payload["activities_json_data"] = {"en": _minimal_activities_payload([100])}
    payload["external_tasks"] = [
        _external_task_payload(
            "payment", participant_ids=["p1", "p2"], token_values=["tok-1", "tok-1"]
        )
    ]

    study_payload = ImportStudiesConfigStudy(**payload)

    with pytest.raises(ValueError, match="duplicate tokens"):
        _validate_import_study_payload(study_payload)


def test_validate_import_payload_rejects_frequency_key_mismatch_across_languages():
    payload = _base_payload()
    payload["supported_languages"] = ["en", "sv"]
    payload["day_labels"][0]["display_names"] = {"en": "Monday", "sv": "Mandag"}

    en_data = _minimal_activities_payload([100])
    sv_data = _minimal_activities_payload([100])
    sv_data["general"]["language"] = "sv"

    en_data["timeline"]["primary"]["categories"][0]["activities"][0][
        "frequency_options"
    ] = [
        {"key": "bi_weekly", "label": "Bi-weekly"},
        {"key": "monthly", "label": "Monthly"},
    ]
    sv_data["timeline"]["primary"]["categories"][0]["activities"][0][
        "frequency_options"
    ] = [
        {"key": "annan_vecka", "label": "Varannan vecka"},
        {"key": "monthly", "label": "Manadsvis"},
    ]

    payload["activities_json_data"] = {"en": en_data, "sv": sv_data}

    study_payload = ImportStudiesConfigStudy(**payload)

    with pytest.raises(ValueError, match="structure mismatch"):
        _validate_import_study_payload(study_payload)


def test_validate_import_payload_reports_specific_structure_difference_details():
    payload = _base_payload()
    payload["supported_languages"] = ["en", "de"]
    payload["day_labels"][0]["display_names"] = {"en": "Monday", "de": "Montag"}

    en_data = _minimal_activities_payload([100])
    de_data = _minimal_activities_payload([100])
    de_data["general"]["language"] = "de"

    en_data["timeline"]["primary"]["categories"][0]["activities"][0][
        "frequency_options"
    ] = [
        {"key": "bi_weekly", "label": "Bi-weekly"},
        {"key": "monthly", "label": "Monthly"},
    ]
    de_data["timeline"]["primary"]["categories"][0]["activities"][0][
        "frequency_options"
    ] = [
        {"key": "monthly", "label": "Monatlich"},
    ]

    payload["activities_json_data"] = {"en": en_data, "de": de_data}

    study_payload = ImportStudiesConfigStudy(**payload)

    with pytest.raises(
        ValueError,
        match=r"timeline 'primary', activity code 100 frequency options mismatch",
    ):
        _validate_import_study_payload(study_payload)


def test_validate_import_payload_rejects_duplicate_internal_activities_languages():
    payload = _base_payload()
    payload["supported_languages"] = ["en", "sv"]
    payload["day_labels"][0]["display_names"] = {"en": "Monday", "sv": "Mandag"}

    en_data = _minimal_activities_payload([100])
    sv_data = _minimal_activities_payload([100])

    en_data["general"]["language"] = "sv"
    sv_data["general"]["language"] = "sv"

    payload["activities_json_data"] = {"en": en_data, "sv": sv_data}
    study_payload = ImportStudiesConfigStudy(**payload)

    with pytest.raises(
        ValueError,
        match=r"must declare distinct general\.language values",
    ):
        _validate_import_study_payload(study_payload)


def test_validate_import_payload_rejects_internal_language_mapped_key_mismatch():
    payload = _base_payload()
    payload["supported_languages"] = ["en", "sv"]
    payload["day_labels"][0]["display_names"] = {"en": "Monday", "sv": "Mandag"}

    en_data = _minimal_activities_payload([100])
    sv_data = _minimal_activities_payload([100])

    en_data["general"]["language"] = "en"
    sv_data["general"]["language"] = "de"

    payload["activities_json_data"] = {"en": en_data, "sv": sv_data}
    study_payload = ImportStudiesConfigStudy(**payload)

    with pytest.raises(
        ValueError,
        match=r"mapped to language 'sv' declares general\.language='de'",
    ):
        _validate_import_study_payload(study_payload)


def test_build_external_task_continuation_url_renders_template_with_token_and_pid():
    external_task = StudyExternalTask(
        study_id=1,
        task_key="payment",
        name="Payment Survey",
        url="https://example.org/payment?src=trac&survey_token={survey_token}&participant_id={participant_id}",
        confirmation_type="none",
        tokens=["tok-1"],
        config={
            "callback_token_name": "survey_token",
            "outbound_tokens": [
                {
                    "name": "survey_token",
                    "by_participant": {"p1": "tok-1"},
                }
            ],
        },
    )

    continuation_url = _build_external_task_continuation_url(
        external_task,
        "tok-1",
        "unit_import_study",
        participant_id="p1",
    )

    assert (
        continuation_url
        == "https://example.org/payment?src=trac&survey_token=tok-1&participant_id=p1"
    )


def test_build_external_task_continuation_url_renders_study_and_task_placeholders():
    external_task = StudyExternalTask(
        study_id=1,
        task_key="callback_task",
        name="Callback Task",
        url="https://example.org/callback?study={study_name}&task={task_key}&token={survey_token}",
        confirmation_type="callback",
        tokens=["cb-1"],
        config={
            "callback_token_name": "survey_token",
            "outbound_tokens": [
                {
                    "name": "survey_token",
                    "by_participant": {"p1": "cb-1"},
                }
            ],
        },
    )

    continuation_url = _build_external_task_continuation_url(
        external_task,
        "cb-1",
        "unit_import_study",
        participant_id="p1",
    )

    assert (
        continuation_url
        == "https://example.org/callback?study=unit_import_study&task=callback_task&token=cb-1"
    )


def test_build_external_task_continuation_url_renders_additional_outbound_tokens():
    external_task = StudyExternalTask(
        study_id=1,
        task_key="payment",
        name="Payment Survey",
        url="https://example.org/payment?survey={survey_token}&site={site_user_token}",
        confirmation_type="none",
        tokens=["tok-1"],
        config={
            "callback_token_name": "survey_token",
            "outbound_tokens": [
                {
                    "name": "survey_token",
                    "by_participant": {"p1": "tok-1"},
                },
                {
                    "name": "site_user_token",
                    "by_participant": {"p1": "site-77"},
                },
            ],
        },
    )

    continuation_url = _build_external_task_continuation_url(
        external_task,
        "tok-1",
        "unit_import_study",
        participant_id="p1",
    )

    assert continuation_url == "https://example.org/payment?survey=tok-1&site=site-77"


def test_extract_study_for_validation_requests_selection_when_multiple_studies_present():
    studies_config = {
        "studies": [
            {"name_short": "study_a", "name": "Study A"},
            {"name_short": "study_b", "name": "Study B"},
        ]
    }

    selected_study, available, selection_required = (
        _extract_study_from_studies_config_for_validation(studies_config)
    )

    assert selected_study == {}
    assert sorted(available) == ["study_a", "study_b"]
    assert selection_required is True


def test_extract_study_for_validation_picks_selected_study_from_multiple():
    studies_config = {
        "studies": [
            {"name_short": "study_a", "name": "Study A"},
            {"name_short": "study_b", "name": "Study B"},
        ]
    }

    selected_study, available, selection_required = (
        _extract_study_from_studies_config_for_validation(
            studies_config,
            selected_study_name_short="study_b",
        )
    )

    assert selected_study["name_short"] == "study_b"
    assert sorted(available) == ["study_a", "study_b"]
    assert selection_required is False
