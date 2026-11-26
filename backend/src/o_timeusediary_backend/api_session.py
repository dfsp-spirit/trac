"""Participant session endpoints for the opt-in inactivity timeout.

The session is a random token in an HttpOnly cookie. ``POST /session`` starts or
resumes it on a page load; ``POST /session/touch`` refreshes an existing session
from user activity without making the activity itself a diary request.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
from sqlmodel import Session

from .api_deps.participant_context import ParticipantContext, get_participant_context
from .api_deps.participant_session import (
    ParticipantSessionContext,
    require_participant_session,
    session_error,
    session_timeout_minutes,
)
from .database import get_session
from .models import ParticipantSession
from .participant_sessions import (
    SESSION_COOKIE_NAME,
    create_session,
    find_session,
    mark_session_ended,
    session_is_expired,
    touch_session,
)
from .settings import settings
from .utils import coerce_utc_aware, utc_now

router = APIRouter(
    prefix="/api/studies/{study_name_short}/participants/{participant_id}"
)


class ParticipantSessionState(BaseModel):
    active: bool
    timeout_minutes: int
    expires_at: Optional[datetime] = None


def _cookie_path(request: Request) -> str:
    """The participant root, with a trailing slash, for path-scoped cookies."""
    path = request.url.path
    marker = "/session"
    index = path.find(marker)
    if index >= 0:
        path = path[:index]
    return path.rstrip("/") + "/"


def _cookie_is_secure() -> bool:
    return settings.frontend_url.startswith("https://")


def _set_session_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        secure=_cookie_is_secure(),
        path=_cookie_path(request),
    )


def _clear_session_cookie(response: Response, request: Request) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path=_cookie_path(request),
    )


def _state(
    row: ParticipantSession, timeout_minutes: int
) -> ParticipantSessionState:
    last_seen = coerce_utc_aware(row.last_seen_at)
    return ParticipantSessionState(
        active=True,
        timeout_minutes=timeout_minutes,
        expires_at=last_seen + timedelta(minutes=timeout_minutes),
    )


def _inactive_state() -> ParticipantSessionState:
    return ParticipantSessionState(active=False, timeout_minutes=0)


@router.post("/session", response_model=ParticipantSessionState)
def start_participant_session(
    request: Request,
    response: Response,
    context: ParticipantContext = Depends(get_participant_context),
    db: Session = Depends(get_session),
) -> ParticipantSessionState:
    """Start a session, or resume the one the browser already has.

    A full page load is a fresh entry, so an expired cookie is replaced here.
    ``/session/touch`` deliberately does not do that: an idle tab must not be
    able to mint a new session just by ticking.
    """
    timeout_minutes = session_timeout_minutes(context.study)
    if timeout_minutes <= 0:
        _clear_session_cookie(response, request)
        return _inactive_state()

    now = utc_now()
    token = request.cookies.get(SESSION_COOKIE_NAME, "")
    row = (
        find_session(db, token, context.study, context.participant_id)
        if token
        else None
    )
    if (
        row is not None
        and row.ended_at is None
        and not session_is_expired(row.last_seen_at, timeout_minutes, now)
    ):
        touch_session(db, row, now=now, force=True)
    else:
        if row is not None and row.ended_at is None:
            mark_session_ended(db, row, now=now)
        row, token = create_session(
            db, context.study, context.participant_id, now=now
        )

    _set_session_cookie(response, request, token)
    return _state(row, timeout_minutes)


@router.post("/session/touch", response_model=ParticipantSessionState)
def touch_participant_session(
    request: Request,
    context: ParticipantContext = Depends(get_participant_context),
    db: Session = Depends(get_session),
) -> ParticipantSessionState:
    timeout_minutes = session_timeout_minutes(context.study)
    if timeout_minutes <= 0:
        return _inactive_state()

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

    touch_session(db, row, now=now, force=True)
    return _state(row, timeout_minutes)


@router.get("/session", response_model=ParticipantSessionState)
def get_participant_session(
    context: ParticipantContext = Depends(get_participant_context),
    current: Optional[ParticipantSessionContext] = Depends(
        require_participant_session
    ),
) -> ParticipantSessionState:
    timeout_minutes = session_timeout_minutes(context.study)
    if timeout_minutes <= 0 or current is None:
        return _inactive_state()
    return _state(current.participant_session, timeout_minutes)


@router.delete("/session", status_code=204)
def end_participant_session(
    request: Request,
    response: Response,
    context: ParticipantContext = Depends(get_participant_context),
    db: Session = Depends(get_session),
) -> None:
    """End the browser's session, if it has one. Always succeeds."""
    token = request.cookies.get(SESSION_COOKIE_NAME, "")
    if token:
        row = find_session(db, token, context.study, context.participant_id)
        if row is not None and row.ended_at is None:
            mark_session_ended(db, row, now=utc_now())
    _clear_session_cookie(response, request)
    return None
