"""Cascade deletion of a study and every row that belongs to it.

Shared by the admin API (`DELETE /api/admin/studies/{study_name_short}`) and the
`tud studies delete` CLI command, so both paths remove exactly the same data.
"""

from sqlalchemy import delete
from sqlmodel import Session, select

from .models import (
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


def delete_study_data(session: Session, study_name_short: str) -> bool:
    """Delete the study with the given short name and all data referencing it.

    The caller owns the transaction and must commit.

    @param session Database session to operate on.
    @param study_name_short Short name of the study to delete.
    @returns True when the study existed and its rows were deleted, False when
        no study with that short name exists.
    """
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()
    if study is None:
        return False

    external_task_ids = session.exec(
        select(StudyExternalTask.id).where(StudyExternalTask.study_id == study.id)
    ).all()

    available_activity_ids = session.exec(
        select(StudyAvailableActivity.id).where(
            StudyAvailableActivity.study_id == study.id
        )
    ).all()

    if external_task_ids:
        session.exec(
            delete(StudyExternalTaskAssignment).where(
                StudyExternalTaskAssignment.external_task_id.in_(external_task_ids)
            )
        )

    if available_activity_ids:
        session.exec(
            delete(StudyAvailableActivityI18n).where(
                StudyAvailableActivityI18n.activity_id.in_(available_activity_ids)
            )
        )

    session.exec(delete(Activity).where(Activity.study_id == study.id))
    session.exec(delete(StudyParticipant).where(StudyParticipant.study_id == study.id))
    session.exec(
        delete(StudyActivityConfigBlob).where(
            StudyActivityConfigBlob.study_id == study.id
        )
    )
    session.exec(
        delete(StudyAvailableActivity).where(
            StudyAvailableActivity.study_id == study.id
        )
    )
    session.exec(
        delete(StudyAvailableCategory).where(
            StudyAvailableCategory.study_id == study.id
        )
    )
    session.exec(
        delete(StudyAvailableTimeline).where(
            StudyAvailableTimeline.study_id == study.id
        )
    )
    session.exec(
        delete(StudyExternalTask).where(StudyExternalTask.study_id == study.id)
    )
    session.exec(delete(Timeline).where(Timeline.study_id == study.id))
    session.exec(delete(DayLabel).where(DayLabel.study_id == study.id))
    session.exec(delete(Study).where(Study.id == study.id))

    return True
