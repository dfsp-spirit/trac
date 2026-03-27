import json

import pytest
from sqlmodel import SQLModel, create_engine

from o_timeusediary_backend import database as database_module


def _write_activities_file(tmp_path, codes: list[int]) -> str:
    activities_payload = {
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

    activities_path = tmp_path / "activities.json"
    activities_path.write_text(json.dumps(activities_payload), encoding="utf-8")
    return str(activities_path)


def _write_studies_config(
    tmp_path,
    *,
    activities_file: str,
    allow_unlisted_participants: bool,
    study_participant_ids: list[str],
    activities_logged_by_userid: dict,
) -> str:
    studies_payload = {
        "studies": [
            {
                "name": "Hydration Demo",
                "name_short": "hydration_demo",
                "description": "Demo",
                "day_labels": [
                    {
                        "name": "day1",
                        "display_order": 0,
                        "display_names": {"en": "Day 1"},
                    }
                ],
                "study_participant_ids": study_participant_ids,
                "allow_unlisted_participants": allow_unlisted_participants,
                "default_language": "en",
                "activities_json_files": {"en": activities_file},
                "activities_logged_by_userid": activities_logged_by_userid,
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2026-12-31T23:59:59Z",
            }
        ]
    }

    config_path = tmp_path / "studies_config.json"
    config_path.write_text(json.dumps(studies_payload), encoding="utf-8")
    return str(config_path)


@pytest.fixture
def isolated_test_db(monkeypatch, tmp_path):
    test_engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setattr(database_module, "engine", test_engine)
    SQLModel.metadata.create_all(test_engine)
    return test_engine


def test_create_config_file_studies_in_database_fails_for_invalid_logged_activity_code(tmp_path, isolated_test_db):
    activities_file = _write_activities_file(tmp_path, codes=[100])
    config_path = _write_studies_config(
        tmp_path,
        activities_file=activities_file,
        allow_unlisted_participants=True,
        study_participant_ids=[],
        activities_logged_by_userid={
            "user_1": {
                "day1": [
                    {
                        "timeline": "primary",
                        "activity_code": 999,
                        "start_minutes": 0,
                        "end_minutes": 10,
                    }
                ]
            }
        },
    )

    with pytest.raises(ValueError, match="Invalid studies_config JSON.*activity codes"):
        database_module.create_config_file_studies_in_database(config_path)


def test_create_config_file_studies_in_database_fails_for_unauthorized_logged_user_in_closed_study(tmp_path, isolated_test_db):
    activities_file = _write_activities_file(tmp_path, codes=[100])
    config_path = _write_studies_config(
        tmp_path,
        activities_file=activities_file,
        allow_unlisted_participants=False,
        study_participant_ids=["authorized_user"],
        activities_logged_by_userid={
            "unauthorized_user": {
                "day1": [
                    {
                        "timeline": "primary",
                        "activity_code": 100,
                        "start_minutes": 0,
                        "end_minutes": 10,
                    }
                ]
            }
        },
    )

    with pytest.raises(ValueError, match="Invalid studies_config JSON.*closed study.*unauthorized participants"):
        database_module.create_config_file_studies_in_database(config_path)
