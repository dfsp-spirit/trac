"""The two banner messages: one server-wide, one per study.

A message is operational state, not study content: it announces a maintenance
window, not how the study works. Hence its own tables instead of columns on
``Study`` (which would drag it into the config parser and the study-text
editor) and instead of a deployment setting (which would need a redeploy to
change - awkward when the message is about the redeploy).

There is at most one server message and one message per study, each switched on
and off manually: ``is_active`` is the whole schedule, there is no scheduling.

The participant client dismisses a banner by :func:`message_key`. Bumping
``revision`` on every effective change is what makes an edited or re-activated
message reappear for someone who dismissed the previous version.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, List, Mapping, Optional

from sqlmodel import Session, select

from .models import ServerMessage, StudyActivityConfigBlob, StudyMessage
from .utils import utc_now

AUDIENCE_PARTICIPANTS = "participants"
AUDIENCE_ADMINS = "admins"
AUDIENCE_BOTH = "both"
AUDIENCES = (AUDIENCE_PARTICIPANTS, AUDIENCE_ADMINS, AUDIENCE_BOTH)

#: The fixed id of the single server-wide row.
SERVER_MESSAGE_ID = 1

#: Longest accepted text per language. Long enough for a maintenance window
#: with a contact address, short enough to stay a banner instead of a page.
MESSAGE_TEXT_MAX_LENGTH = 2000


class MessageValidationError(ValueError):
    """A message payload the admin API must reject with a 400."""


def normalize_language(language: Optional[str]) -> Optional[str]:
    """Reduce a language code to its primary subtag ("de-DE" -> "de")."""
    if not isinstance(language, str):
        return None
    primary = language.strip().lower().split("-")[0]
    return primary or None


def normalize_message_text(raw: Optional[Mapping[str, Any]]) -> Dict[str, str]:
    """Trim and validate a ``{language: text}`` map.

    Empty translations are dropped (an admin who leaves a language blank does
    not have to delete it), the keys are reduced to primary subtags and the
    result is sorted, so equal content always hashes to the same key.
    """
    if raw is None:
        return {}
    if not isinstance(raw, Mapping):
        raise MessageValidationError("text must be a language-to-text map")

    normalized: Dict[str, str] = {}
    for language, value in raw.items():
        key = normalize_language(language)
        if key is None:
            raise MessageValidationError(f"invalid language code: {language!r}")
        if not isinstance(value, str):
            raise MessageValidationError(f"text for language '{key}' must be a string")
        text = value.strip()
        if not text:
            continue
        if len(text) > MESSAGE_TEXT_MAX_LENGTH:
            raise MessageValidationError(
                f"text for language '{key}' is longer than "
                f"{MESSAGE_TEXT_MAX_LENGTH} characters"
            )
        normalized[key] = text
    return dict(sorted(normalized.items()))


def localized_message_text(
    text: Optional[Mapping[str, str]],
    requested_language: Optional[str] = None,
    fallback_language: Optional[str] = None,
) -> Optional[str]:
    """Resolve the text map to one string, or None when there is no text.

    Requested language, then the caller's fallback (the study's default for a
    study message), then English, then whatever the admin did write: a
    maintenance warning in the wrong language is better than no warning.
    """
    if not isinstance(text, Mapping) or not text:
        return None
    for language in (
        normalize_language(requested_language),
        normalize_language(fallback_language),
        "en",
    ):
        if language and text.get(language):
            return text[language]
    for language in sorted(text):
        if text[language]:
            return text[language]
    return None


def message_key(row: ServerMessage | StudyMessage) -> str:
    """A stable, opaque key for "this version of this message".

    The client remembers dismissed keys, so the key must change when the text
    or the activation changes, and must not change when only the reader's
    language changes.
    """
    scope = (
        "server"
        if isinstance(row, ServerMessage)
        else f"study:{row.study_id}"
    )
    payload = json.dumps(
        {
            "scope": scope,
            "text": row.text or {},
            "audience": getattr(row, "audience", AUDIENCE_PARTICIPANTS),
            "revision": row.revision or 0,
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def get_server_message(session: Session) -> Optional[ServerMessage]:
    """The server-wide message, whether active or not."""
    return session.get(ServerMessage, SERVER_MESSAGE_ID)


def get_study_message(session: Session, study_id: int) -> Optional[StudyMessage]:
    """The message of one study, whether active or not."""
    return session.exec(
        select(StudyMessage).where(StudyMessage.study_id == study_id)
    ).first()


def _is_active_for(row: Optional[ServerMessage], audience: str) -> bool:
    if row is None or not row.is_active:
        return False
    return row.audience in (audience, AUDIENCE_BOTH)


def active_participant_server_message(session: Session) -> Optional[ServerMessage]:
    """The server message if it is currently shown to study participants."""
    row = get_server_message(session)
    return row if _is_active_for(row, AUDIENCE_PARTICIPANTS) else None


def active_admin_server_message(session: Session) -> Optional[ServerMessage]:
    """The server message if it is currently shown in the admin panel."""
    row = get_server_message(session)
    return row if _is_active_for(row, AUDIENCE_ADMINS) else None


def active_study_message(session: Session, study_id: int) -> Optional[StudyMessage]:
    """The study's message if it is currently shown to its participants."""
    row = get_study_message(session, study_id)
    if row is None or not row.is_active:
        return None
    return row


def _apply(
    row: ServerMessage | StudyMessage,
    *,
    text: Dict[str, str],
    is_active: bool,
    audience: Optional[str] = None,
) -> bool:
    """Write the new state into ``row`` and bump the revision when it changed."""
    changed = text != (row.text or {}) or is_active != row.is_active
    if audience is not None and audience != row.audience:
        changed = True
    if not changed:
        return False

    row.text = text
    row.is_active = is_active
    if audience is not None:
        row.audience = audience
    row.revision = (row.revision or 0) + 1
    row.updated_at = utc_now()
    return True


def save_server_message(
    session: Session,
    *,
    text: Optional[Mapping[str, Any]],
    audience: str,
    is_active: bool,
) -> ServerMessage:
    """Create or replace the server-wide message. The caller commits."""
    normalized = normalize_message_text(text)
    if audience not in AUDIENCES:
        raise MessageValidationError(f"audience must be one of {list(AUDIENCES)}")
    if is_active and not normalized:
        raise MessageValidationError(
            "an active message needs text in at least one language"
        )

    row = get_server_message(session)
    if row is None:
        row = ServerMessage(id=SERVER_MESSAGE_ID)
        session.add(row)
    _apply(row, text=normalized, is_active=is_active, audience=audience)
    session.flush()
    return row


def save_study_message(
    session: Session,
    study_id: int,
    *,
    text: Optional[Mapping[str, Any]],
    is_active: bool,
) -> StudyMessage:
    """Create or replace one study's message. The caller commits."""
    normalized = normalize_message_text(text)
    if is_active and not normalized:
        raise MessageValidationError(
            "an active message needs text in at least one language"
        )

    row = get_study_message(session, study_id)
    if row is None:
        row = StudyMessage(study_id=study_id)
        session.add(row)
    _apply(row, text=normalized, is_active=is_active)
    session.flush()
    return row


def server_message_languages(session: Session) -> List[str]:
    """Interface languages the server-message form offers.

    The union of the languages this deployment's studies actually provide plus
    English, so the form never asks for a language nobody here speaks. A
    language already stored in the message stays editable even when no study
    uses it (the study may have been removed since).
    """
    languages = {"en"}
    for language in session.exec(select(StudyActivityConfigBlob.language)).all():
        normalized = normalize_language(language)
        if normalized:
            languages.add(normalized)
    row = get_server_message(session)
    if row is not None:
        for language in row.text or {}:
            normalized = normalize_language(language)
            if normalized:
                languages.add(normalized)
    return sorted(languages)
