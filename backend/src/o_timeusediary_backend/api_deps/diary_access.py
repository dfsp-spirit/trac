"""Access rules for the incremental diary API (D27).

One dependency per concern, so every write endpoint gets the same answer to the
same questions: does the study exist, is it collecting right now, is this
participant allowed, and has the diary already been submitted?

This module is the one place where those rules live.
"""

from __future__ import annotations

from datetime import datetime
from typing import NamedTuple, Optional

from fastapi import Depends, HTTPException
from sqlmodel import Session

from ..database import get_session
from ..models import Study, StudyParticipant
from ..utils import coerce_utc_aware, utc_now
from .participant_context import ParticipantContext, get_participant_context
from .participant_session import ParticipantSessionContext, require_participant_session


class DiaryContext(NamedTuple):
    """The study and participant a diary request operates on."""

    study: Study
    study_participant: StudyParticipant
    participant_session: Optional[ParticipantSessionContext] = None


UNAVAILABLE_PAUSED = "paused"
UNAVAILABLE_NOT_STARTED = "not_started"
UNAVAILABLE_ENDED = "ended"


class Availability(NamedTuple):
    """Whether a study is collecting right now, and if not, why not.

    The reason is participant-facing: the client has one `unavailable` page and
    three very different messages to show, and "paused" and "closed four months
    ago" are not the same thing to someone holding a link (D39).
    """

    available: bool
    reason: Optional[str] = None


def study_availability(study: Study, now: Optional[datetime] = None) -> Availability:
    """Is the study collecting right now, and if not, why?

    The one place that answers this, because the 403, the participant's stage
    (D37) and the unavailable page (D39) need the same answer and must not drift.

    Precedence: a window that has ended or has not started yet wins over the
    pause switch, because the date is what the participant can act on; "paused"
    only describes the state of a study that would otherwise be open.
    """
    moment = coerce_utc_aware(now or utc_now())
    collection_start = coerce_utc_aware(study.data_collection_start)
    collection_end = coerce_utc_aware(study.data_collection_end)
    if moment > collection_end:
        return Availability(False, UNAVAILABLE_ENDED)
    if moment < collection_start:
        return Availability(False, UNAVAILABLE_NOT_STARTED)
    if study.is_paused:
        return Availability(False, UNAVAILABLE_PAUSED)
    return Availability(True)


def study_is_currently_available(study: Study) -> bool:
    """Is the study collecting right now? See study_availability for the reason."""
    return study_availability(study).available


def ensure_study_is_currently_available(study: Study) -> None:
    """Raise 403 when a study cannot currently be filled in by participants."""
    if study_is_currently_available(study):
        return
    raise HTTPException(
        status_code=403,
        detail={
            "code": "study_unavailable",
            "message": "Diese Studie ist momentan nicht verfügbar.",
        },
    )


def get_readable_diary_context(
    context: ParticipantContext = Depends(get_participant_context),
    participant_session: Optional[ParticipantSessionContext] = Depends(
        require_participant_session
    ),
) -> DiaryContext:
    """Context for reading a diary.

    A participant who has not started yet is not an error: an empty diary is
    returned, which is what the new frontend renders on first load.
    """
    return DiaryContext(
        study=context.study,
        study_participant=context.study_participant,
        participant_session=participant_session,
    )


def ensure_study_participant_row(session: Session, link: StudyParticipant) -> None:
    """Create the study association on first write.

    The readable context hands out an unsaved stand-in for open studies; every
    endpoint that writes through it has to materialise it first. Shared so
    submit, skip and the write path cannot drift apart.
    """
    if link.id is not None:
        return
    session.add(link)
    session.flush()


def get_writable_diary_context(
    context: DiaryContext = Depends(get_readable_diary_context),
    session: Session = Depends(get_session),
) -> DiaryContext:
    """Context for writing a diary: collecting, allowed, not yet submitted.

    Creates the study association on first write for open studies, matching what
    the whole-day endpoint has always done.
    """
    study = context.study
    link = context.study_participant

    ensure_study_is_currently_available(study)

    ensure_study_participant_row(session, link)

    if link.study_submitted_at is not None:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "study_already_submitted",
                "message": "This diary has already been submitted and can no longer be edited.",
                "submitted_at": link.study_submitted_at.isoformat(),
            },
        )

    return DiaryContext(
        study=study,
        study_participant=link,
        participant_session=context.participant_session,
    )
