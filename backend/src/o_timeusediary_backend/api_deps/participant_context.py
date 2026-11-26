"""Resolve the study and participant a participant-facing request belongs to.

One dependency so diary access and session access cannot drift: both validate
the id, the study's participant allow-list and the optional association row.
"""

from __future__ import annotations

from typing import NamedTuple, Optional

from fastapi import Depends, HTTPException, Path
from sqlmodel import Session, select

from ..database import get_session
from ..models import Study, StudyParticipant
from .participant_identity import require_valid_participant_id


class ParticipantContext(NamedTuple):
    study: Study
    participant_id: str
    study_participant: StudyParticipant


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


def participant_link(
    session: Session, study: Study, participant_id: str
) -> Optional[StudyParticipant]:
    return session.exec(
        select(StudyParticipant).where(
            StudyParticipant.study_id == study.id,
            StudyParticipant.participant_id == participant_id,
        )
    ).first()


def get_participant_context(
    study: Study = Depends(get_study),
    participant_id: str = Path(...),
    session: Session = Depends(get_session),
) -> ParticipantContext:
    require_valid_participant_id(participant_id)
    link = participant_link(session, study, participant_id)
    if link is None:
        if not study.allow_unlisted_participants:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Participant '{participant_id}' not authorized for this study"
                ),
            )
        # Only reachable for open studies: a stand-in object that is not added
        # to the session, so read paths cannot accidentally persist it.
        link = StudyParticipant(study_id=study.id, participant_id=participant_id)
    return ParticipantContext(
        study=study,
        participant_id=participant_id,
        study_participant=link,
    )
