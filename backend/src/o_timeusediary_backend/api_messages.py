"""Banner messages: the participant and admin-panel endpoints.

Two messages exist (see ``messages.py``): one server-wide and one per study,
each switched on and off manually. This module only exposes them:

* ``GET /api/messages`` - what a participant client shows as a banner.
* ``GET /api/admin/messages`` - what the admin panel shows as a banner.
* ``GET|PUT /api/admin/messages/server`` - the super admin's one message.
* ``GET|PUT /api/admin/studies/{name}/message`` - a study's message.

Reading is deliberately unauthenticated on the participant side: a banner says
"server maintenance tonight", which is not participant data, and the endpoint
must also work on the entry page where no participant identity exists yet. It
returns nothing for a study that does not exist instead of a 404, because a
banner is never worth turning a page into an error.
"""

from __future__ import annotations

import logging
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlmodel import Session, select

from .api_deps.admin_auth import (
    AdminIdentity,
    require_admin_identity,
    require_super_admin,
)
from .database import get_session
from .messages import (
    AUDIENCE_PARTICIPANTS,
    MessageValidationError,
    active_admin_server_message,
    active_participant_server_message,
    active_study_message,
    get_server_message,
    get_study_message,
    localized_message_text,
    message_key,
    save_server_message,
    save_study_message,
)
from .models import Study

logger = logging.getLogger(__name__)

router = APIRouter()


class MessageContent(BaseModel):
    """One banner as the client sees it: resolved text plus a dismissal key."""

    text: str
    key: str


class ParticipantMessagesResponse(BaseModel):
    server: Optional[MessageContent] = None
    study: Optional[MessageContent] = None


class AdminMessagesResponse(BaseModel):
    server: Optional[MessageContent] = None


class ServerMessageState(BaseModel):
    text: Dict[str, str]
    audience: str
    is_active: bool
    revision: int


class ServerMessageUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: Dict[str, str] = {}
    audience: str = AUDIENCE_PARTICIPANTS
    is_active: bool = False


class StudyMessageState(BaseModel):
    text: Dict[str, str]
    is_active: bool
    revision: int


class StudyMessageUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: Dict[str, str] = {}
    is_active: bool = False


def _content(
    row: object,
    requested_language: Optional[str],
    fallback_language: Optional[str] = None,
) -> Optional[MessageContent]:
    """Resolved text and key for one row, or None when it has no text."""
    if row is None:
        return None
    text = localized_message_text(
        getattr(row, "text", None), requested_language, fallback_language
    )
    if not text:
        return None
    return MessageContent(text=text, key=message_key(row))


def _get_study_or_404(session: Session, study_name_short: str) -> Study:
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()
    if study is None:
        raise HTTPException(
            status_code=404, detail=f"Study '{study_name_short}' not found"
        )
    return study


@router.get(
    "/api/messages",
    response_model=ParticipantMessagesResponse,
    name="Get participant banner messages",
)
def get_participant_messages(
    study_name_short: Optional[str] = Query(default=None),
    lang: Optional[str] = Query(default=None),
    session: Session = Depends(get_session),
):
    """What the participant client shows as banners on the current page.

    Without a study (the entry page) only the server message is returned. A
    study that does not exist gets the same answer: no study message, no error.
    """
    study = None
    if study_name_short:
        study = session.exec(
            select(Study).where(Study.name_short == study_name_short)
        ).first()

    study_row = (
        active_study_message(session, study.id) if study is not None else None
    )
    return ParticipantMessagesResponse(
        server=_content(active_participant_server_message(session), lang),
        study=_content(
            study_row,
            lang,
            study.default_language if study is not None else None,
        ),
    )


@router.get(
    "/api/admin/messages",
    response_model=AdminMessagesResponse,
    name="Get admin banner messages",
)
def get_admin_messages(
    lang: Optional[str] = Query(default=None),
    identity: AdminIdentity = Depends(require_admin_identity),
    session: Session = Depends(get_session),
):
    """What the admin panel shows as a banner. Any administrator may read it."""
    return AdminMessagesResponse(
        server=_content(active_admin_server_message(session), lang)
    )


@router.get(
    "/api/admin/messages/server",
    response_model=ServerMessageState,
    name="Get the server message",
)
def get_server_message_state(
    identity: AdminIdentity = Depends(require_super_admin),
    session: Session = Depends(get_session),
):
    row = get_server_message(session)
    if row is None:
        return ServerMessageState(
            text={}, audience=AUDIENCE_PARTICIPANTS, is_active=False, revision=0
        )
    return ServerMessageState(
        text=dict(row.text or {}),
        audience=row.audience,
        is_active=row.is_active,
        revision=row.revision,
    )


@router.put(
    "/api/admin/messages/server",
    response_model=ServerMessageState,
    name="Update the server message",
)
def update_server_message(
    payload: ServerMessageUpdate,
    identity: AdminIdentity = Depends(require_super_admin),
    session: Session = Depends(get_session),
):
    """Replace the server-wide message.

    Last write wins: there is exactly one message, and an admin who saves knows
    what she typed. A revision conflict would only add a dialog to a form that
    is two fields long.
    """
    try:
        row = save_server_message(
            session,
            text=payload.text,
            audience=payload.audience,
            is_active=payload.is_active,
        )
    except MessageValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    session.commit()
    session.refresh(row)
    logger.info(
        "Admin '%s' saved the server message (active=%s, audience=%s).",
        identity.username,
        row.is_active,
        row.audience,
    )
    return ServerMessageState(
        text=dict(row.text or {}),
        audience=row.audience,
        is_active=row.is_active,
        revision=row.revision,
    )


@router.get(
    "/api/admin/studies/{study_name_short}/message",
    response_model=StudyMessageState,
    name="Get a study message",
)
def get_study_message_state(
    study_name_short: str,
    identity: AdminIdentity = Depends(require_admin_identity),
    session: Session = Depends(get_session),
):
    study = _get_study_or_404(session, study_name_short)
    row = get_study_message(session, study.id)
    if row is None:
        return StudyMessageState(text={}, is_active=False, revision=0)
    return StudyMessageState(
        text=dict(row.text or {}), is_active=row.is_active, revision=row.revision
    )


@router.put(
    "/api/admin/studies/{study_name_short}/message",
    response_model=StudyMessageState,
    name="Update a study message",
)
def update_study_message(
    study_name_short: str,
    payload: StudyMessageUpdate,
    identity: AdminIdentity = Depends(require_admin_identity),
    session: Session = Depends(get_session),
):
    study = _get_study_or_404(session, study_name_short)
    try:
        row = save_study_message(
            session,
            study.id,
            text=payload.text,
            is_active=payload.is_active,
        )
    except MessageValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    session.commit()
    session.refresh(row)
    logger.info(
        "Admin '%s' saved the message of study '%s' (active=%s).",
        identity.username,
        study.name_short,
        row.is_active,
    )
    return StudyMessageState(
        text=dict(row.text or {}), is_active=row.is_active, revision=row.revision
    )
