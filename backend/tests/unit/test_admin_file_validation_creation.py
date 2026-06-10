import json
import os
import uuid
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

import pytest
from sqlmodel import SQLModel, Session, create_engine, select

os.environ.setdefault("TUD_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("TUD_ALLOWED_ORIGINS", '["http://localhost:3000"]')

from o_timeusediary_backend.api import (
    create_study_from_validated_uploads,
    validate_files_in_memory,
)
from o_timeusediary_backend.models import Study
from fastapi import UploadFile


def _backend_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _load_studies_config_payload() -> dict:
    return json.loads((_backend_root() / "studies_config.json").read_text(encoding="utf-8"))


def _get_study_by_name_short(studies_config_payload: dict, study_name_short: str) -> dict:
    for study in studies_config_payload.get("studies", []):
        if study.get("name_short") == study_name_short:
            return study
    raise AssertionError(f"Study '{study_name_short}' was not found in studies_config.json")


def _make_upload_file(filename: str, content_bytes: bytes) -> UploadFile:
    return UploadFile(filename=filename, file=BytesIO(content_bytes))


def _build_full_study_uploads(
    studies_config_payload: dict,
    selected_study_name_short: str,
) -> tuple[UploadFile, list[UploadFile]]:
    selected_study = _get_study_by_name_short(studies_config_payload, selected_study_name_short)
    language_to_file = selected_study.get("activities_json_files") or {}
    if not isinstance(language_to_file, dict) or not language_to_file:
        raise AssertionError("Selected study has no activities_json_files mapping")

    studies_config_upload = _make_upload_file(
        "studies_config.json",
        json.dumps(studies_config_payload).encode("utf-8"),
    )

    activities_uploads = []
    for activities_filename in language_to_file.values():
        activities_path = _backend_root() / str(activities_filename)
        activities_uploads.append(
            _make_upload_file(activities_path.name, activities_path.read_bytes())
        )

    return studies_config_upload, activities_uploads


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def _insert_existing_default_study(session: Session) -> None:
    existing_study = Study(
        name="Default Weekly Study for Adults",
        name_short="default",
        description="Existing default study",
        allow_unlisted_participants=True,
        require_consent=False,
        is_paused=False,
        allow_skip_timeuse=True,
        require_diary_before_external_tasks=False,
        default_language="en",
        activities_json_url="db_blob://default/en",
        data_collection_start=datetime(2024, 1, 1, tzinfo=timezone.utc),
        data_collection_end=datetime(2028, 12, 31, tzinfo=timezone.utc),
    )
    session.add(existing_study)
    session.commit()


@pytest.mark.asyncio
async def test_full_study_validation_reports_conflict_notice_for_existing_study(db_session):
    _insert_existing_default_study(db_session)

    studies_config_payload = _load_studies_config_payload()
    studies_config_upload, activities_uploads = _build_full_study_uploads(
        studies_config_payload,
        "default",
    )

    response_payload = await validate_files_in_memory(
        mode="full_study",
        default_language=None,
        supported_languages_csv=None,
        activities_language_map=None,
        full_study_name_short="default",
        activities_file=None,
        activities_files=activities_uploads,
        studies_config_file=studies_config_upload,
        current_admin="unit_test_admin",
        session=db_session,
    )

    assert response_payload["ok"] is True
    assert response_payload["summary"]["creation_mode"] == "create_only"
    assert response_payload["summary"]["transaction_mode"] == "all_or_nothing"
    assert response_payload["summary"]["creation_eligible"] is False
    assert response_payload["summary"]["creation_conflicts"]
    assert any(
        error.get("type") == "conflict_notice"
        for error in response_payload.get("errors", [])
    )


@pytest.mark.asyncio
async def test_create_from_files_blocks_existing_study_name_short(db_session):
    _insert_existing_default_study(db_session)

    studies_config_payload = _load_studies_config_payload()
    studies_config_upload, activities_uploads = _build_full_study_uploads(
        studies_config_payload,
        "default",
    )

    response_payload = await create_study_from_validated_uploads(
        full_study_name_short="default",
        activities_language_map=None,
        activities_files=activities_uploads,
        studies_config_file=studies_config_upload,
        current_admin="unit_test_admin",
        session=db_session,
    )

    assert response_payload["ok"] is False
    assert response_payload["mode"] == "create_only"
    assert response_payload["transaction_mode"] == "all_or_nothing"
    assert response_payload["summary"]["created"] == 0
    assert response_payload["summary"]["failed"] == 1
    assert any(
        "same name_short" in (error.get("message") or "")
        for error in response_payload.get("errors", [])
    )


@pytest.mark.asyncio
async def test_create_from_files_creates_only_selected_study_when_config_contains_several(
    db_session,
):
    studies_config_payload = _load_studies_config_payload()

    random_suffix = uuid.uuid4().hex[:8]
    selected_study_name_short = f"default_new_{random_suffix}"
    selected_study_name = f"Default Weekly Study Copy {random_suffix}"

    default_study = _get_study_by_name_short(studies_config_payload, "default")
    default_study["name_short"] = selected_study_name_short
    default_study["name"] = selected_study_name

    studies_config_upload, activities_uploads = _build_full_study_uploads(
        studies_config_payload,
        selected_study_name_short,
    )

    validation_payload = await validate_files_in_memory(
        mode="full_study",
        default_language=None,
        supported_languages_csv=None,
        activities_language_map=None,
        full_study_name_short=selected_study_name_short,
        activities_file=None,
        activities_files=activities_uploads,
        studies_config_file=studies_config_upload,
        current_admin="unit_test_admin",
        session=db_session,
    )

    assert validation_payload["ok"] is True
    assert validation_payload["summary"]["creation_eligible"] is True

    # Rebuild uploads because UploadFile streams are consumed by the first call.
    studies_config_upload, activities_uploads = _build_full_study_uploads(
        studies_config_payload,
        selected_study_name_short,
    )

    create_payload = await create_study_from_validated_uploads(
        full_study_name_short=selected_study_name_short,
        activities_language_map=None,
        activities_files=activities_uploads,
        studies_config_file=studies_config_upload,
        current_admin="unit_test_admin",
        session=db_session,
    )

    assert create_payload["ok"] is True
    assert create_payload["summary"]["created"] == 1

    all_studies = db_session.exec(select(Study)).all()
    assert len(all_studies) == 1
    assert all_studies[0].name_short == selected_study_name_short
