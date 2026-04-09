import json
from pathlib import Path

import pytest

from o_timeusediary_backend.api import ImportStudiesConfigStudy, _validate_import_study_payload
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

    with pytest.raises(ValueError, match="Provide exactly one of activities_json_data or activities_json_files, not both"):
        _validate_import_study_payload(study_payload)


def test_validate_import_payload_accepts_activities_json_files_only(tmp_path):
    activities_file = tmp_path / "activities_test.en.json"
    activities_file.write_text(json.dumps(_minimal_activities_payload([100, 200])), encoding="utf-8")

    studies_config_file = tmp_path / "studies_config.json"
    studies_config_file.write_text("{\"studies\": []}", encoding="utf-8")

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
