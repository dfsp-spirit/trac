import os
from datetime import UTC, datetime

from sqlmodel import Session, SQLModel, create_engine, func, select

os.environ.setdefault("TUD_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("TUD_ALLOWED_ORIGINS", '["http://localhost:3000"]')
os.environ.setdefault("TUD_API_ADMIN_USERNAME", "admin")
os.environ.setdefault("TUD_API_ADMIN_PASSWORD", "admin")

from o_timeusediary_backend.models import (
    Activity,
    DayLabel,
    Study,
    StudyActivityConfigBlob,
    StudyAvailableActivity,
    StudyAvailableActivityI18n,
    StudyAvailableCategory,
    StudyAvailableTimeline,
    StudyExternalTask,
    StudyExternalTaskAssignment,
    StudyParticipant,
    Timeline,
)
from o_timeusediary_backend.study_cleanup import delete_study_data

STUDY_TABLES = (
    Activity,
    DayLabel,
    StudyActivityConfigBlob,
    StudyAvailableActivity,
    StudyAvailableCategory,
    StudyAvailableTimeline,
    StudyExternalTask,
    StudyParticipant,
    Timeline,
)


def _new_study(name_short: str) -> Study:
    return Study(
        name=f"Study {name_short}",
        name_short=name_short,
        activities_json_url=f"db_blob://{name_short}/en",
        data_collection_start=datetime(2024, 1, 1, tzinfo=UTC),
        data_collection_end=datetime(2028, 1, 1, tzinfo=UTC),
    )


def _populate_study(session: Session, study: Study) -> dict[str, int]:
    """Insert one row per study-owned table and return the inserted row ids."""
    session.add(study)
    session.commit()
    session.refresh(study)

    day_label = DayLabel(
        study_id=study.id,
        name="monday",
        display_order=0,
        display_name="Monday",
    )
    timeline = Timeline(
        study_id=study.id,
        name="primary",
        display_name="Primary",
        mode="single-choice",
    )
    session.add(day_label)
    session.add(timeline)
    session.add(
        StudyActivityConfigBlob(
            study_id=study.id,
            language="en",
            activities_json_data={"general": {"language": "en"}},
        )
    )
    session.add(
        StudyAvailableTimeline(
            study_id=study.id,
            timeline_key="primary",
            display_name="Primary",
            mode="single-choice",
        )
    )
    session.commit()
    session.refresh(day_label)
    session.refresh(timeline)

    available_timeline = session.exec(
        select(StudyAvailableTimeline).where(
            StudyAvailableTimeline.study_id == study.id
        )
    ).one()
    available_category = StudyAvailableCategory(
        study_id=study.id,
        timeline_id=available_timeline.id,
        category_name="General",
    )
    session.add(available_category)
    session.commit()
    session.refresh(available_category)

    available_activity = StudyAvailableActivity(
        study_id=study.id,
        timeline_id=available_timeline.id,
        category_id=available_category.id,
        activity_code=100,
    )
    session.add(available_activity)
    session.commit()
    session.refresh(available_activity)

    external_task = StudyExternalTask(
        study_id=study.id,
        task_key="questionnaire",
        name="Questionnaire",
        url="https://example.org/q",
    )
    session.add(external_task)
    session.add(StudyParticipant(study_id=study.id, participant_id="p1"))
    session.add(
        Activity(
            study_id=study.id,
            participant_id="p1",
            day_label_id=day_label.id,
            timeline_id=timeline.id,
            start_minutes=480,
            end_minutes=540,
            activity_code=100,
            activity_name="Work",
            activity_path_frontend="General > Work",
        )
    )
    session.commit()
    session.refresh(external_task)

    session.add(
        StudyAvailableActivityI18n(
            activity_id=available_activity.id,
            language="en",
            name="Work",
        )
    )
    assignment = StudyExternalTaskAssignment(
        external_task_id=external_task.id,
        participant_id="p1",
        assigned_token="token-1",
    )
    session.add(assignment)
    session.commit()
    session.refresh(assignment)

    i18n_row = session.exec(
        select(StudyAvailableActivityI18n).where(
            StudyAvailableActivityI18n.activity_id == available_activity.id
        )
    ).one()

    return {
        "study_id": study.id,
        "available_activity_id": available_activity.id,
        "external_task_id": external_task.id,
        "i18n_id": i18n_row.id,
        "assignment_id": assignment.id,
    }


def _count(session: Session, model) -> int:
    return int(session.exec(select(func.count()).select_from(model)).one() or 0)


def test_delete_study_data_removes_all_study_rows_and_keeps_other_studies():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        deleted = _new_study("delete_me")
        kept = _new_study("keep_me")
        deleted_ids = _populate_study(session, deleted)
        _populate_study(session, kept)

        assert delete_study_data(session, "delete_me") is True
        session.commit()

        assert (
            session.exec(select(Study).where(Study.name_short == "delete_me")).first()
            is None
        )
        assert (
            session.exec(select(Study).where(Study.name_short == "keep_me")).first()
            is not None
        )

        for model in STUDY_TABLES:
            assert _count(session, model) == 1, model.__name__
            remaining = session.exec(
                select(model).where(model.study_id == kept.id)
            ).all()
            assert len(remaining) == 1, model.__name__

        assert session.get(StudyAvailableActivityI18n, deleted_ids["i18n_id"]) is None
        assert (
            session.get(StudyExternalTaskAssignment, deleted_ids["assignment_id"])
            is None
        )
        assert _count(session, StudyAvailableActivityI18n) == 1
        assert _count(session, StudyExternalTaskAssignment) == 1


def test_delete_study_data_returns_false_for_unknown_study():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        _populate_study(session, _new_study("keep_me"))

        assert delete_study_data(session, "does_not_exist") is False
        session.commit()

        assert _count(session, Study) == 1
        assert _count(session, Activity) == 1
