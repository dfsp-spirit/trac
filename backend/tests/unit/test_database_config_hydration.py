import json
import importlib

import pytest
from sqlmodel import SQLModel, Session, create_engine, select

from o_timeusediary_backend.models import (
    Study,
    StudyActivityConfigBlob,
    StudyAvailableActivity,
    StudyAvailableActivityI18n,
    StudyExternalTask,
    StudyExternalTaskAssignment,
)


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
    external_tasks: list[dict] | None = None,
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
                "study_text_intro": {"en": "Intro text"},
                "study_text_consent": {"en": "Consent text"},
                "study_text_end_noconsent": {"en": "No consent text"},
                "external_tasks": external_tasks or [],
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


def _write_studies_config_with_embedded_activities(
    tmp_path,
    *,
    activities_data: dict,
    allow_unlisted_participants: bool,
    study_participant_ids: list[str],
    activities_logged_by_userid: dict,
) -> str:
    studies_payload = {
        "studies": [
            {
                "name": "Hydration Demo Embedded",
                "name_short": "hydration_demo_embedded",
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
                "supported_languages": ["en"],
                "study_text_intro": {"en": "Intro text"},
                "activities_json_data": {"en": activities_data},
                "activities_logged_by_userid": activities_logged_by_userid,
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2026-12-31T23:59:59Z",
            }
        ]
    }

    config_path = tmp_path / "studies_config_embedded.json"
    config_path.write_text(json.dumps(studies_payload), encoding="utf-8")
    return str(config_path)


@pytest.fixture
def database_module(monkeypatch, tmp_path):
    monkeypatch.setenv("TUD_DATABASE_URL", f"sqlite:///{tmp_path / 'module_import.db'}")
    imported_module = importlib.import_module("o_timeusediary_backend.database")
    imported_module = importlib.reload(imported_module)

    test_engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setattr(imported_module, "engine", test_engine)
    SQLModel.metadata.create_all(test_engine)
    return imported_module


def test_create_config_file_studies_in_database_fails_for_invalid_logged_activity_code(
    tmp_path, database_module
):
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


def test_create_config_file_studies_in_database_fails_for_unauthorized_logged_user_in_closed_study(
    tmp_path, database_module
):
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

    with pytest.raises(
        ValueError,
        match="Invalid studies_config JSON.*closed study.*unauthorized participants",
    ):
        database_module.create_config_file_studies_in_database(config_path)


def test_create_config_file_studies_in_database_accepts_embedded_activities_json_data(
    tmp_path, database_module
):
    _write_activities_file(tmp_path, codes=[100, 200])
    activities_data = json.loads(
        (tmp_path / "activities.json").read_text(encoding="utf-8")
    )
    activities_data["timeline"]["primary"]["categories"][0]["activities"][0][
        "frequency_options"
    ] = [
        {"key": "bi_weekly", "label": "Bi-weekly"},
        {"key": "monthly", "label": "Monthly"},
    ]

    config_path = _write_studies_config_with_embedded_activities(
        tmp_path,
        activities_data=activities_data,
        allow_unlisted_participants=True,
        study_participant_ids=[],
        activities_logged_by_userid={
            "user_1": {
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

    database_module.create_config_file_studies_in_database(config_path)

    with Session(database_module.engine) as session:
        study = session.exec(
            select(Study).where(Study.name_short == "hydration_demo_embedded")
        ).first()
        assert study is not None
        assert study.activities_json_url == "db_blob://hydration_demo_embedded/en"
        assert study.study_text_intro == {"en": "Intro text"}

        blob = session.exec(
            select(StudyActivityConfigBlob).where(
                StudyActivityConfigBlob.study_id == study.id
            )
        ).first()
        assert blob is not None
        assert blob.language == "en"
        assert (
            blob.activities_json_data["timeline"]["primary"]["categories"][0][
                "activities"
            ][0]["code"]
            == 100
        )

        available_activity_count = len(
            session.exec(
                select(StudyAvailableActivity).where(
                    StudyAvailableActivity.study_id == study.id
                )
            ).all()
        )
        assert available_activity_count >= 2

        i18n_row = session.exec(
            select(StudyAvailableActivityI18n)
            .join(
                StudyAvailableActivity,
                StudyAvailableActivityI18n.activity_id == StudyAvailableActivity.id,
            )
            .where(
                StudyAvailableActivity.study_id == study.id,
                StudyAvailableActivity.activity_code == 100,
                StudyAvailableActivityI18n.language == "en",
            )
        ).first()
        assert i18n_row is not None
        assert i18n_row.frequency_options == [
            {"key": "bi_weekly", "label": "Bi-weekly"},
            {"key": "monthly", "label": "Monthly"},
        ]


def test_create_config_file_studies_in_database_persists_study_texts(
    tmp_path, database_module
):
    activities_file = _write_activities_file(tmp_path, codes=[100])
    config_path = _write_studies_config(
        tmp_path,
        activities_file=activities_file,
        allow_unlisted_participants=True,
        study_participant_ids=[],
        activities_logged_by_userid={},
    )

    database_module.create_config_file_studies_in_database(config_path)

    with Session(database_module.engine) as session:
        study = session.exec(
            select(Study).where(Study.name_short == "hydration_demo")
        ).first()
        assert study is not None
        assert study.study_text_intro == {"en": "Intro text"}
        assert study.study_text_consent == {"en": "Consent text"}
        assert study.study_text_end_noconsent == {"en": "No consent text"}


def test_create_config_file_studies_in_database_persists_external_tasks(
    tmp_path, database_module
):
    activities_file = _write_activities_file(tmp_path, codes=[100])
    config_path = _write_studies_config(
        tmp_path,
        activities_file=activities_file,
        allow_unlisted_participants=False,
        study_participant_ids=["p1", "p2"],
        activities_logged_by_userid={},
        external_tasks=[
            {
                "task_key": "payment",
                "name": "Payment Survey",
                "description": "Complete payment handoff.",
                "url": "https://example.org/payment",
                "confirmation_type": "none",
                "tokens": ["tok-1", "tok-2"],
                "config": {"provider": "example"},
            }
        ],
    )

    database_module.create_config_file_studies_in_database(config_path)

    with Session(database_module.engine) as session:
        study = session.exec(
            select(Study).where(Study.name_short == "hydration_demo")
        ).first()
        assert study is not None

        external_tasks = session.exec(
            select(StudyExternalTask)
            .where(StudyExternalTask.study_id == study.id)
            .order_by(StudyExternalTask.task_key)
        ).all()

        assert len(external_tasks) == 1
        assert external_tasks[0].task_key == "payment"
        assert external_tasks[0].tokens == ["tok-1", "tok-2"]

        assignments = session.exec(
            select(StudyExternalTaskAssignment)
            .where(StudyExternalTaskAssignment.external_task_id == external_tasks[0].id)
            .order_by(StudyExternalTaskAssignment.assignment_order)
        ).all()

        assert [assignment.participant_id for assignment in assignments] == ["p1", "p2"]
        assert [assignment.assigned_token for assignment in assignments] == [
            "tok-1",
            "tok-2",
        ]
    assert [assignment.is_confirmed for assignment in assignments] == [False, False]
    assert [assignment.confirmed_at for assignment in assignments] == [None, None]


