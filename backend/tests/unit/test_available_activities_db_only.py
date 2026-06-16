import os
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlmodel import SQLModel, Session, create_engine

os.environ.setdefault("TUD_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("TUD_ALLOWED_ORIGINS", '["http://localhost:3000"]')
os.environ.setdefault("TUD_API_ADMIN_USERNAME", "admin")
os.environ.setdefault("TUD_API_ADMIN_PASSWORD", "admin")

from o_timeusediary_backend.api_deps.available_activities import (
    get_study_activities_config_model,
)
from o_timeusediary_backend.models import Study, StudyActivityConfigBlob


def _activities_payload(language: str) -> dict:
    return {
        "general": {"app_name": "TRAC", "language": language},
        "timeline": {
            "primary": {
                "name": "Primary",
                "description": "",
                "mode": "single-choice",
                "categories": [
                    {
                        "name": "General",
                        "activities": [
                            {
                                "name": "Sleep",
                                "code": 100,
                                "childItems": [],
                            }
                        ],
                    }
                ],
            }
        },
    }


def _new_study(name_short: str = "study1") -> Study:
    return Study(
        name="Study 1",
        name_short=name_short,
        description="demo",
        allow_unlisted_participants=True,
        require_consent=False,
        is_paused=False,
        allow_skip_timeuse=True,
        require_diary_before_external_tasks=False,
        default_language="en",
        activities_json_url=f"db_blob://{name_short}/en",
        data_collection_start=datetime(2024, 1, 1, tzinfo=timezone.utc),
        data_collection_end=datetime(2028, 1, 1, tzinfo=timezone.utc),
    )


def test_get_study_activities_config_model_requires_db_blob():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        study = _new_study("no_blob")
        session.add(study)
        session.commit()
        session.refresh(study)

        with pytest.raises(HTTPException) as exc_info:
            get_study_activities_config_model(session=session, study=study, lang="en")

    assert exc_info.value.status_code == 500
    assert "missing DB-backed activities config blobs" in str(exc_info.value.detail)


def test_get_study_activities_config_model_reads_db_blob():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        study = _new_study("with_blob")
        session.add(study)
        session.commit()
        session.refresh(study)

        session.add(
            StudyActivityConfigBlob(
                study_id=study.id,
                language="en",
                activities_json_data=_activities_payload("en"),
            )
        )
        session.commit()

        config, source, selected_language = get_study_activities_config_model(
            session=session,
            study=study,
            lang="en",
        )

    assert source == "db_blob"
    assert selected_language == "en"
    assert config.timeline["primary"].categories[0].activities[0].code == 100
