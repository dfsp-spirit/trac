import os
import json
from pathlib import Path

import pytest

os.environ.setdefault("TUD_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("TUD_ALLOWED_ORIGINS", '["http://localhost:3000"]')

from o_timeusediary_backend.api import (
    ImportStudiesConfigStudy,
    _build_external_task_continuation_url,
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
    payload["activities_json_data"] = {"en": _minimal_activities_payload([100])}
    payload["external_tasks"] = [
        {
            "task_key": "payment",
            "name": "Payment Survey",
            "description": "Post-study payment handoff.",
            "url": "https://example.org/payment",
            "confirmation_type": "none",
            "tokens": ["tok-1", "tok-2"],
            "send_pid": True,
            "pid_query_param": "participant_id",
            "config": {"provider": "example"},
        }
    ]

    study_payload = ImportStudiesConfigStudy(**payload)

    assert len(study_payload.external_tasks) == 1
    assert study_payload.external_tasks[0].task_key == "payment"
    assert study_payload.external_tasks[0].tokens == ["tok-1", "tok-2"]
    assert study_payload.external_tasks[0].send_pid is True
    assert study_payload.external_tasks[0].pid_query_param == "participant_id"


def test_validate_import_payload_rejects_external_tasks_for_open_study():
    payload = _base_payload()
    payload["allow_unlisted_participants"] = True
    payload["study_participant_ids"] = ["p1", "p2"]
    payload["activities_json_data"] = {"en": _minimal_activities_payload([100])}
    payload["external_tasks"] = [
        {
            "task_key": "payment",
            "name": "Payment Survey",
            "url": "https://example.org/payment",
            "confirmation_type": "none",
            "tokens": ["tok-1", "tok-2"],
            "config": {},
        }
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
        {
            "task_key": "payment",
            "name": "Payment Survey",
            "url": "https://example.org/payment",
            "confirmation_type": "none",
            "tokens": ["tok-1"],
            "config": {},
        }
    ]

    study_payload = ImportStudiesConfigStudy(**payload)

    with pytest.raises(ValueError, match="exactly one token per participant"):
        _validate_import_study_payload(study_payload)


def test_validate_import_payload_rejects_external_tasks_with_unsupported_confirmation_type():
    payload = _base_payload()
    payload["allow_unlisted_participants"] = False
    payload["study_participant_ids"] = ["p1"]
    payload["activities_json_data"] = {"en": _minimal_activities_payload([100])}
    payload["external_tasks"] = [
        {
            "task_key": "payment",
            "name": "Payment Survey",
            "url": "https://example.org/payment",
            "confirmation_type": "email",
            "tokens": ["tok-1"],
            "config": {},
        }
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
        {
            "task_key": "payment",
            "name": "Payment Survey",
            "url": "https://example.org/payment",
            "confirmation_type": "none",
            "tokens": ["tok-1", "tok-1"],
            "config": {},
        }
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


def test_build_external_task_continuation_url_uses_configured_token_query_param():
    external_task = StudyExternalTask(
        study_id=1,
        task_key="payment",
        name="Payment Survey",
        url="https://example.org/payment?src=trac",
        confirmation_type="none",
        tokens=["tok-1"],
        config={"token_query_param": "survey_token"},
    )

    continuation_url = _build_external_task_continuation_url(external_task, "tok-1")

    assert continuation_url == "https://example.org/payment?src=trac&survey_token=tok-1"


def test_build_external_task_continuation_url_replaces_existing_token_param():
    external_task = StudyExternalTask(
        study_id=1,
        task_key="callback_task",
        name="Callback Task",
        url="https://example.org/callback?token=old&src=trac",
        confirmation_type="callback",
        tokens=["cb-1"],
        config={},
    )

    continuation_url = _build_external_task_continuation_url(external_task, "cb-1")

    assert continuation_url == "https://example.org/callback?src=trac&token=cb-1"


def test_build_external_task_continuation_url_appends_pid_when_enabled():
    external_task = StudyExternalTask(
        study_id=1,
        task_key="payment",
        name="Payment Survey",
        url="https://example.org/payment?src=trac",
        confirmation_type="none",
        tokens=["tok-1"],
        config={
            "token_query_param": "survey_token",
            "send_pid": True,
            "pid_query_param": "participant_id",
        },
    )

    continuation_url = _build_external_task_continuation_url(
        external_task,
        "tok-1",
        participant_id="p1",
    )

    assert (
        continuation_url
        == "https://example.org/payment?src=trac&survey_token=tok-1&participant_id=p1"
    )
