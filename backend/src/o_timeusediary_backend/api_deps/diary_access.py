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
from ..proxy_families import ProxyFamily
from ..utils import coerce_utc_aware, utc_now
from .participant_context import ParticipantContext, get_participant_context
from .participant_session import ParticipantSessionContext, require_participant_session


class DiaryContext(NamedTuple):
    """The study and participant a diary request operates on.

    ``study_participant`` is the row the diary belongs to - the active child in a
    proxy study. ``family`` carries the parent, whose row owns the family-level
    state (consent, instructions, deadline).
    """

    study: Study
    study_participant: StudyParticipant
    participant_session: Optional[ParticipantSessionContext] = None
    family: Optional[ProxyFamily] = None

    @property
    def family_participant(self) -> StudyParticipant:
        """The row that owns family-level state; the subject's own row outside proxy."""
        return self.family.parent if self.family is not None else self.study_participant

    @property
    def credential(self) -> str:
        """The id the request proves: the parent in a proxy study."""
        if self.family is not None:
            return self.family.credential_participant_id
        return self.study_participant.participant_id


UNAVAILABLE_PAUSED = "paused"
UNAVAILABLE_NOT_STARTED = "not_started"
UNAVAILABLE_ENDED = "ended"
#: The family's own hard cut-off passed (decision 16). More specific than
#: "ended", so it wins the message when both apply.
UNAVAILABLE_DEADLINE = "deadline_passed"


class Availability(NamedTuple):
    """Whether a study is collecting right now, and if not, why not.

    The reason is participant-facing: the client has one `unavailable` page and
    three very different messages to show, and "paused" and "closed four months
    ago" are not the same thing to someone holding a link (D39).
    """

    available: bool
    reason: Optional[str] = None


def family_deadline(family: Optional[ProxyFamily]) -> Optional[datetime]:
    """The family's hard cut-off, or None when it has none."""
    if family is None or family.parent.proxy_deadline_at is None:
        return None
    return coerce_utc_aware(family.parent.proxy_deadline_at)


def study_availability(
    study: Study,
    now: Optional[datetime] = None,
    family: Optional[ProxyFamily] = None,
) -> Availability:
    """Is the study collecting right now, and if not, why?

    The one place that answers this, because the 403, the participant's stage
    (D37) and the unavailable page (D39) need the same answer and must not drift.

    Precedence: the family deadline first (it is the more specific statement and
    tells the participant something they can act on), then a window that has
    ended or has not started, then the pause switch, because the date is what the
    participant can act on; "paused" only describes a study that would otherwise
    be open.

    @param study The study.
    @param now Moment to test; defaults to the current instant.
    @param family The proxy family whose deadline narrows the window, if any.
    """
    moment = coerce_utc_aware(now or utc_now())
    collection_start = coerce_utc_aware(study.data_collection_start)
    collection_end = coerce_utc_aware(study.data_collection_end)
    deadline = family_deadline(family)
    if deadline is not None and moment > deadline:
        return Availability(False, UNAVAILABLE_DEADLINE)
    if moment > collection_end:
        return Availability(False, UNAVAILABLE_ENDED)
    if moment < collection_start:
        return Availability(False, UNAVAILABLE_NOT_STARTED)
    if study.is_paused:
        return Availability(False, UNAVAILABLE_PAUSED)
    return Availability(True)


def study_is_currently_available(
    study: Study, family: Optional[ProxyFamily] = None
) -> bool:
    """Is the study collecting right now? See study_availability for the reason."""
    return study_availability(study, family=family).available


def ensure_study_is_currently_available(
    study: Study, family: Optional[ProxyFamily] = None
) -> None:
    """Raise 403 when a study cannot currently be filled in by participants."""
    availability = study_availability(study, family=family)
    if availability.available:
        return
    # A passed family deadline gets its own code: the client has to be able to
    # say "the deadline passed", which is not the same message as "the study
    # ended" (plan §9.8), and a refused write should not make it guess from a
    # reason field.
    if availability.reason == UNAVAILABLE_DEADLINE:
        raise deadline_error(family)
    raise HTTPException(
        status_code=403,
        detail={
            "code": "study_unavailable",
            "message": "Diese Studie ist momentan nicht verfügbar.",
            "reason": availability.reason,
        },
    )


def ensure_before_deadline(
    study: Study, family: Optional[ProxyFamily], now: Optional[datetime] = None
) -> None:
    """Refuse a family action after its hard cut-off (decision 16).

    A deadline is a deadline: the last-minute starter loses the submission, and
    the data that already exists stays as it is. Applies to every family action,
    including submitting and skipping, so a family cannot be closed "just after"
    the cut-off.

    @raises HTTPException 403 with ``deadline_passed`` when the deadline has
        passed.
    """
    deadline = family_deadline(family)
    if deadline is None:
        return
    if coerce_utc_aware(now or utc_now()) <= deadline:
        return
    raise deadline_error(family)


def deadline_error(family: Optional[ProxyFamily]) -> HTTPException:
    """The one refusal a passed family deadline produces."""
    deadline = family_deadline(family)
    return HTTPException(
        status_code=403,
        detail={
            "code": "deadline_passed",
            "message": (
                "The submission deadline for this study has passed. "
                "No further changes can be saved."
            ),
            "deadline": deadline.isoformat() if deadline else None,
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
        family=context.family,
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

    ensure_study_is_currently_available(study, family=context.family)

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
        family=context.family,
    )
