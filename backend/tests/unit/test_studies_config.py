import json

import pytest

from o_timeusediary_backend.parsers.studies_config import load_studies_config


def _valid_studies_payload() -> dict:
    return {
        "studies": [
            {
                "name": "Demo Study",
                "name_short": "demo_study",
                "description": "Short description",
                "day_labels": [
                    {
                        "name": "day1",
                        "display_order": 1,
                        "display_names": {"en": "Day 1", "sv": "Day 1"},
                    }
                ],
                "study_participant_ids": ["p1"],
                "allow_unlisted_participants": False,
                "default_language": "en",
                "activities_json_files": {
                    "en": "activities_default.json",
                    "sv": "activities_default.sv.json",
                },
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2024-01-07T00:00:00Z",
            }
        ]
    }


def _minimal_activities_payload(codes: list[int]) -> dict:
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
                            {"name": f"Activity {code}", "code": code} for code in codes
                        ],
                    }
                ],
            }
        },
    }


def _write_default_multilingual_activities(
    tmp_path, codes_en: list[int] | None = None, codes_sv: list[int] | None = None
):
    en_codes = codes_en or [100, 200, 300]
    sv_codes = codes_sv or en_codes

    (tmp_path / "activities_default.json").write_text(
        json.dumps(_minimal_activities_payload(en_codes)),
        encoding="utf-8",
    )
    (tmp_path / "activities_default.sv.json").write_text(
        json.dumps(_minimal_activities_payload(sv_codes)),
        encoding="utf-8",
    )


def test_load_studies_config_from_json(tmp_path):
    _write_default_multilingual_activities(tmp_path)
    config_file = tmp_path / "studies_config.json"
    config_file.write_text(json.dumps(_valid_studies_payload()), encoding="utf-8")

    config = load_studies_config(str(config_file))

    assert len(config.studies) == 1
    assert config.studies[0].name_short == "demo_study"
    assert config.studies[0].default_language == "en"
    assert sorted(config.studies[0].get_supported_languages()) == ["en", "sv"]


def test_load_studies_config_accepts_external_tasks(tmp_path):
    _write_default_multilingual_activities(tmp_path)
    payload = _valid_studies_payload()
    payload["studies"][0]["external_tasks"] = [
        {
            "task_key": "payment",
            "name": "Payment Survey",
            "description": "Complete payment handoff.",
            "url": "https://example.org/payment",
            "confirmation_type": "none",
            "tokens": ["tok-1"],
            "config": {"provider": "example"},
        }
    ]

    config_file = tmp_path / "studies_config.json"
    config_file.write_text(json.dumps(payload), encoding="utf-8")

    config = load_studies_config(str(config_file))

    assert len(config.studies[0].external_tasks) == 1
    assert config.studies[0].external_tasks[0].task_key == "payment"


def test_load_studies_config_rejects_external_tasks_for_open_study(tmp_path):
    _write_default_multilingual_activities(tmp_path)
    payload = _valid_studies_payload()
    payload["studies"][0]["allow_unlisted_participants"] = True
    payload["studies"][0]["external_tasks"] = [
        {
            "task_key": "payment",
            "name": "Payment Survey",
            "url": "https://example.org/payment",
            "confirmation_type": "none",
            "tokens": ["tok-1"],
            "config": {},
        }
    ]

    config_file = tmp_path / "studies_config.json"
    config_file.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(
        ValueError,
        match="external_tasks require allow_unlisted_participants=false",
    ):
        load_studies_config(str(config_file))


def test_load_studies_config_rejects_external_tasks_with_wrong_token_count(tmp_path):
    _write_default_multilingual_activities(tmp_path)
    payload = _valid_studies_payload()
    payload["studies"][0]["study_participant_ids"] = ["p1", "p2"]
    payload["studies"][0]["external_tasks"] = [
        {
            "task_key": "payment",
            "name": "Payment Survey",
            "url": "https://example.org/payment",
            "confirmation_type": "none",
            "tokens": ["tok-1"],
            "config": {},
        }
    ]

    config_file = tmp_path / "studies_config.json"
    config_file.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(ValueError, match="exactly one token per participant"):
        load_studies_config(str(config_file))


def test_load_studies_config_rejects_external_tasks_with_unsupported_confirmation_type(
    tmp_path,
):
    _write_default_multilingual_activities(tmp_path)
    payload = _valid_studies_payload()
    payload["studies"][0]["external_tasks"] = [
        {
            "task_key": "payment",
            "name": "Payment Survey",
            "url": "https://example.org/payment",
            "confirmation_type": "email",
            "tokens": ["tok-1"],
            "config": {},
        }
    ]

    config_file = tmp_path / "studies_config.json"
    config_file.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(ValueError, match="unsupported confirmation_type"):
        load_studies_config(str(config_file))


def test_load_studies_config_rejects_external_tasks_with_duplicate_task_keys(tmp_path):
    _write_default_multilingual_activities(tmp_path)
    payload = _valid_studies_payload()
    payload["studies"][0]["external_tasks"] = [
        {
            "task_key": "payment",
            "name": "Payment Survey A",
            "url": "https://example.org/payment-a",
            "confirmation_type": "none",
            "tokens": ["tok-1"],
            "config": {},
        },
        {
            "task_key": "payment",
            "name": "Payment Survey B",
            "url": "https://example.org/payment-b",
            "confirmation_type": "callback",
            "tokens": ["tok-2"],
            "config": {},
        },
    ]

    config_file = tmp_path / "studies_config.json"
    config_file.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(ValueError, match="duplicate external task key"):
        load_studies_config(str(config_file))


def test_load_studies_config_rejects_invalid_name_short(tmp_path):
    _write_default_multilingual_activities(tmp_path)
    payload = _valid_studies_payload()
    payload["studies"][0]["name_short"] = "Demo-Study"

    config_file = tmp_path / "studies_config.json"
    config_file.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(ValueError, match="name_short"):
        load_studies_config(str(config_file))


def test_load_studies_config_rejects_missing_daylabel_translation_for_existing_activity_language(
    tmp_path,
):
    _write_default_multilingual_activities(tmp_path)
    payload = _valid_studies_payload()
    payload["studies"][0]["day_labels"][0]["display_names"] = {"en": "Day 1"}

    config_file = tmp_path / "studies_config.json"
    config_file.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(ValueError, match="missing translated display names"):
        load_studies_config(str(config_file))


def test_load_studies_config_rejects_mismatching_activity_code_sets_across_languages(
    tmp_path,
):
    _write_default_multilingual_activities(
        tmp_path, codes_en=[100, 200], codes_sv=[100, 300]
    )
    config_file = tmp_path / "studies_config.json"
    config_file.write_text(json.dumps(_valid_studies_payload()), encoding="utf-8")

    with pytest.raises(ValueError, match="inconsistent activity code sets"):
        load_studies_config(str(config_file))


def test_load_studies_config_accepts_matching_activity_code_sets_across_languages(
    tmp_path,
):
    _write_default_multilingual_activities(
        tmp_path, codes_en=[100, 200, 300], codes_sv=[100, 200, 300]
    )
    config_file = tmp_path / "studies_config.json"
    config_file.write_text(json.dumps(_valid_studies_payload()), encoding="utf-8")

    config = load_studies_config(str(config_file))
    assert len(config.studies) == 1


def test_load_studies_config_warns_for_extra_text_language_without_activities_file(
    tmp_path, caplog
):
    _write_default_multilingual_activities(tmp_path)
    payload = _valid_studies_payload()
    payload["studies"][0]["study_text_intro"] = {
        "en": "English intro",
        "sv": "Swedish intro",
    }
    payload["studies"][0]["study_text_intro"]["de"] = (
        "Zusätzlicher Text ohne Activities-Datei"
    )

    config_file = tmp_path / "studies_config.json"
    config_file.write_text(json.dumps(payload), encoding="utf-8")

    config = load_studies_config(str(config_file))
    assert len(config.studies) == 1
    assert config.studies[0].get_supported_languages() == ["en", "sv"]
    assert "extra language 'de'" in caplog.text


def test_load_studies_config_warns_for_extra_daylabel_language_without_activities_file(
    tmp_path, caplog
):
    _write_default_multilingual_activities(tmp_path)
    payload = _valid_studies_payload()
    payload["studies"][0]["day_labels"][0]["display_names"]["de"] = "Tag 1"

    config_file = tmp_path / "studies_config.json"
    config_file.write_text(json.dumps(payload), encoding="utf-8")

    config = load_studies_config(str(config_file))
    assert len(config.studies) == 1
    assert config.studies[0].get_supported_languages() == ["en", "sv"]
    assert "defines extra translation languages ['de']" in caplog.text


def test_load_studies_config_uses_explicit_supported_languages_subset(tmp_path):
    _write_default_multilingual_activities(tmp_path)
    payload = _valid_studies_payload()
    payload["studies"][0]["supported_languages"] = ["en"]

    config_file = tmp_path / "studies_config.json"
    config_file.write_text(json.dumps(payload), encoding="utf-8")

    config = load_studies_config(str(config_file))
    study = config.studies[0]

    assert study.get_supported_languages() == ["en"]
    assert study.get_supported_activities_json_files() == {
        "en": "activities_default.json",
    }


def test_load_studies_config_rejects_supported_languages_missing_text_translation(
    tmp_path,
):
    _write_default_multilingual_activities(tmp_path)
    payload = _valid_studies_payload()
    payload["studies"][0]["supported_languages"] = ["en", "sv"]
    payload["studies"][0]["study_text_intro"] = {
        "en": "English intro only",
    }

    config_file = tmp_path / "studies_config.json"
    config_file.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(
        ValueError,
        match="study_text_intro is missing translations for supported_languages",
    ):
        load_studies_config(str(config_file))


def test_load_studies_config_rejects_supported_language_without_activity_file(tmp_path):
    _write_default_multilingual_activities(tmp_path)
    payload = _valid_studies_payload()
    payload["studies"][0]["supported_languages"] = ["en", "de"]

    config_file = tmp_path / "studies_config.json"
    config_file.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(
        ValueError,
        match="supported_languages contains languages without activities configuration",
    ):
        load_studies_config(str(config_file))


def test_load_studies_config_ignores_unsupported_language_file_for_code_consistency(
    tmp_path,
):
    _write_default_multilingual_activities(
        tmp_path, codes_en=[100, 200], codes_sv=[100, 200]
    )
    (tmp_path / "activities_default.de.json").write_text(
        json.dumps(_minimal_activities_payload([999])),
        encoding="utf-8",
    )

    payload = _valid_studies_payload()
    payload["studies"][0]["activities_json_files"]["de"] = "activities_default.de.json"
    payload["studies"][0]["supported_languages"] = ["en", "sv"]

    config_file = tmp_path / "studies_config.json"
    config_file.write_text(json.dumps(payload), encoding="utf-8")

    config = load_studies_config(str(config_file))
    assert len(config.studies) == 1


def test_load_studies_config_accepts_embedded_activities_json_data(tmp_path):
    payload = _valid_studies_payload()
    payload["studies"][0].pop("activities_json_files", None)
    payload["studies"][0]["supported_languages"] = ["en", "sv"]
    payload["studies"][0]["activities_json_data"] = {
        "en": _minimal_activities_payload([100, 200]),
        "sv": _minimal_activities_payload([100, 200]),
    }

    config_file = tmp_path / "studies_config.json"
    config_file.write_text(json.dumps(payload), encoding="utf-8")

    config = load_studies_config(str(config_file))
    study = config.studies[0]
    assert study.get_supported_languages() == ["en", "sv"]
    assert set(study.get_supported_activities_json_data().keys()) == {"en", "sv"}
    assert study.get_supported_activities_json_files() == {}


def test_load_studies_config_rejects_mismatching_codes_for_mixed_file_and_embedded_data(
    tmp_path,
):
    _write_default_multilingual_activities(
        tmp_path, codes_en=[100, 200], codes_sv=[100, 200]
    )
    payload = _valid_studies_payload()
    payload["studies"][0]["activities_json_data"] = {
        "sv": _minimal_activities_payload([100, 999]),
    }

    config_file = tmp_path / "studies_config.json"
    config_file.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(ValueError, match="inconsistent activity code sets"):
        load_studies_config(str(config_file))
