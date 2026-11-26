"""Participant session lifecycle for the opt-in inactivity timeout.

A study with ``inactivity_timeout_minutes > 0`` protects participant data with a
server-side sliding session. The browser holds a random token in an HttpOnly
cookie; this module stores and checks only its SHA-256 hash.

The timeout is deliberately a privacy guard, not authentication: the invitation
link remains the credential that can start a new session.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Iterable, Optional

from sqlalchemy import delete
from sqlmodel import Session, select

from .models import ParticipantSession, Study
from .utils import coerce_utc_aware, utc_now

SESSION_COOKIE_NAME = "trac_session"
# Protected requests refresh the sliding window at most this often. The client
# also touches on non-API activity, so the server stays aligned without a write
# on every diary request.
SESSION_TOUCH_THROTTLE = timedelta(seconds=5)


def hash_session_token(token: str) -> str:
    """Return the value stored in the database for a cookie token."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def session_is_expired(
    last_seen_at: datetime,
    timeout_minutes: int,
    now: Optional[datetime] = None,
) -> bool:
    """Whether a session has been idle for the study's full timeout."""
    if timeout_minutes <= 0:
        return False
    moment = coerce_utc_aware(now or utc_now())
    last_seen = coerce_utc_aware(last_seen_at)
    return moment >= last_seen + timedelta(minutes=timeout_minutes)


def find_session(
    db: Session,
    token: str,
    study: Study,
    participant_id: str,
) -> Optional[ParticipantSession]:
    """Look up a token and verify it belongs to this study and participant."""
    if not token:
        return None
    row = db.exec(
        select(ParticipantSession).where(
            ParticipantSession.token_hash == hash_session_token(token)
        )
    ).first()
    if row is None:
        return None
    if row.study_id != study.id or row.participant_id != participant_id:
        return None
    return row


def create_session(
    db: Session,
    study: Study,
    participant_id: str,
    *,
    now: Optional[datetime] = None,
) -> tuple[ParticipantSession, str]:
    """Create a session and return it together with the raw cookie token."""
    moment = coerce_utc_aware(now or utc_now())
    token = secrets.token_urlsafe(32)
    row = ParticipantSession(
        study_id=study.id,
        participant_id=participant_id,
        token_hash=hash_session_token(token),
        created_at=moment,
        last_seen_at=moment,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row, token


def mark_session_ended(
    db: Session,
    row: ParticipantSession,
    *,
    now: Optional[datetime] = None,
) -> None:
    row.ended_at = coerce_utc_aware(now or utc_now())
    db.add(row)
    db.commit()


def touch_session(
    db: Session,
    row: ParticipantSession,
    *,
    now: Optional[datetime] = None,
    force: bool = True,
) -> bool:
    """Refresh the sliding window, optionally skipping the write throttle."""
    moment = coerce_utc_aware(now or utc_now())
    if not force:
        last_seen = coerce_utc_aware(row.last_seen_at)
        if moment - last_seen < SESSION_TOUCH_THROTTLE:
            return False
    row.last_seen_at = moment
    db.add(row)
    db.commit()
    return True


def delete_participant_sessions(
    db: Session,
    study_id: int,
    participant_ids: Iterable[str],
) -> int:
    """Delete sessions for one or more participants of a study."""
    ids = list(participant_ids)
    if not ids:
        return 0
    return (
        db.exec(
            delete(ParticipantSession).where(
                ParticipantSession.study_id == study_id,
                ParticipantSession.participant_id.in_(ids),
            )
        ).rowcount
        or 0
    )


def delete_study_sessions(db: Session, study_id: int) -> int:
    return (
        db.exec(
            delete(ParticipantSession).where(ParticipantSession.study_id == study_id)
        ).rowcount
        or 0
    )
