"""Access rules for the incremental diary API (D27).

One dependency per concern, so every write endpoint gets the same answer to the
same questions: does the study exist, is it collecting right now, is this
participant allowed, and has the diary already been submitted?

The old whole-day endpoint keeps its own inline copy of these checks until it is
deleted at cutover (D25); that path is deliberately frozen, while this module is
where the rules live for everything new.
"""

from __future__ import annotations

from typing import NamedTuple, Optional

from fastapi import Depends, HTTPException, Path
from sqlmodel import Session, select

from ..database import get_session
from ..models import Participant, Study, StudyParticipant
from ..utils import coerce_utc_aware, utc_now


class DiaryContext(NamedTuple):
    """The study and participant a diary request operates on."""

    study: Study
    study_participant: StudyParticipant


def ensure_study_is_currently_available(study: Study) -> None:
    """Raise 403 when a study cannot currently be filled in by participants."""
    now = coerce_utc_aware(utc_now())
    collection_start = coerce_utc_aware(study.data_collection_start)
    collection_end = coerce_utc_aware(study.data_collection_end)

    if now < collection_start or now > collection_end or study.is_paused:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "study_unavailable",
                "message": "Diese Studie ist momentan nicht verfügbar.",
            },
        )


def get_study(
    study_name_short: str,
    session: Session = Depends(get_session),
) -> Study:
    """Resolve a study by its short name or raise 404."""
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()
    if not study:
        raise HTTPException(
            status_code=404, detail=f"Study '{study_name_short}' not found"
        )
    return study


def _participant_link(
    session: Session, study: Study, participant_id: str
) -> Optional[StudyParticipant]:
    return session.exec(
        select(StudyParticipant).where(
            StudyParticipant.study_id == study.id,
            StudyParticipant.participant_id == participant_id,
        )
    ).first()


def ensure_participant_allowed(
    session: Session, study: Study, participant_id: str
) -> None:
    """Raise 403 when a closed study has no link for this participant."""
    if study.allow_unlisted_participants:
        return
    if _participant_link(session, study, participant_id) is None:
        raise HTTPException(
            status_code=403,
            detail=f"Participant '{participant_id}' not authorized for this study",
        )


def get_readable_diary_context(
    study: Study = Depends(get_study),
    participant_id: str = Path(...),
    session: Session = Depends(get_session),
) -> DiaryContext:
    """Context for reading a diary.

    A participant who has not started yet is not an error: an empty diary is
    returned, which is what the new frontend renders on first load.
    """
    ensure_participant_allowed(session, study, participant_id)
    link = _participant_link(session, study, participant_id)
    if link is None:
        # Only reachable for open studies: a stand-in object that is not added
        # to the session, so read paths cannot accidentally persist it.
        link = StudyParticipant(study_id=study.id, participant_id=participant_id)
    return DiaryContext(study=study, study_participant=link)


def get_writable_diary_context(
    context: DiaryContext = Depends(get_readable_diary_context),
    session: Session = Depends(get_session),
) -> DiaryContext:
    """Context for writing a diary: collecting, allowed, not yet submitted.

    Creates the participant rows on first write for open studies, matching what
    the whole-day endpoint has always done.
    """
    study = context.study
    link = context.study_participant

    ensure_study_is_currently_available(study)

    if link.id is None:
        participant = session.exec(
            select(Participant).where(Participant.id == link.participant_id)
        ).first()
        if participant is None:
            participant = Participant(id=link.participant_id)
            session.add(participant)
            session.flush()
        session.add(link)
        session.flush()

    if link.study_submitted_at is not None:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "study_already_submitted",
                "message": "This diary has already been submitted and can no longer be edited.",
                "submitted_at": link.study_submitted_at.isoformat(),
            },
        )

    return DiaryContext(study=study, study_participant=link)
