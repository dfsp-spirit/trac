"""FastAPI dependency enforcing the opt-in participant inactivity session."""

from __future__ import annotations

from typing import NamedTuple, Optional

from fastapi import Depends, HTTPException, Request
from sqlmodel import Session

from ..database import get_session
from ..models import ParticipantSession, Study
from ..participant_sessions import (
    SESSION_COOKIE_NAME,
    find_session,
    mark_session_ended,
    session_is_expired,
    touch_session,
)
from ..utils import utc_now
from .participant_context import ParticipantContext, get_participant_context


class ParticipantSessionContext(NamedTuple):
    study: Study
    participant_id: str
    participant_session: ParticipantSession


def session_error(code: str, message: str, status_code: int = 401) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )


def session_timeout_minutes(study: Study) -> int:
    return max(0, int(study.inactivity_timeout_minutes or 0))


def require_participant_session(
    request: Request,
    context: ParticipantContext = Depends(get_participant_context),
    db: Session = Depends(get_session),
) -> Optional[ParticipantSessionContext]:
    """Validate and refresh the session, or do nothing when the timeout is off.

    Study bootstrap endpoints (``study-config``, ``activities-config``) do not
    use this dependency: the client needs them before it can create a session.
    """
    timeout_minutes = session_timeout_minutes(context.study)
    if timeout_minutes <= 0:
        return None

    token = request.cookies.get(SESSION_COOKIE_NAME, "")
    if not token:
        raise session_error(
            "session.required",
            "This request needs an active session. Please open your invitation link again.",
        )

    row = find_session(db, token, context.study, context.participant_id)
    if row is None:
        raise session_error(
            "session.invalid",
            "This session is not valid. Please open your invitation link again.",
        )

    now = utc_now()
    if row.ended_at is not None or session_is_expired(
        row.last_seen_at, timeout_minutes, now
    ):
        if row.ended_at is None:
            mark_session_ended(db, row, now=now)
        raise session_error(
            "session.expired",
            "This session ended after a period of inactivity. Please open your invitation link again.",
        )

    touch_session(db, row, now=now, force=False)
    return ParticipantSessionContext(
        study=context.study,
        participant_id=context.participant_id,
        participant_session=row,
    )
