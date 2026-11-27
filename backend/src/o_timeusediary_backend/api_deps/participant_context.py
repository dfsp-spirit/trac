"""Resolve the study and participant a participant-facing request belongs to.

One dependency so diary access and session access cannot drift: both validate
the id, the study's participant allow-list and the optional association row.

In a proxy study two identities exist in one request, and keeping them apart is
the whole point of this module:

* the **credential** is the participant id that arrived in the URL - the parent.
  A child's id is refused here, for every endpoint, because a child id must never
  be able to act (``dev_tools/plans/proxy_studies.md`` §8.1).
* the **subject** is the row the diary belongs to - the active child, derived
  from the roster and the completion state. The client never sends it.
"""

from __future__ import annotations

from typing import NamedTuple, Optional

from fastapi import Depends, HTTPException, Path
from sqlmodel import Session, select

from ..database import get_session
from ..models import Study, StudyParticipant
from ..proxy_families import (
    ProxyFamily,
    ProxyResolutionError,
    ensure_can_act,
    is_proxy_study,
    resolve_family,
)
from .participant_identity import require_valid_participant_id


class ParticipantContext(NamedTuple):
    """The study plus the two identities of a participant-facing request."""

    study: Study
    #: The row the diary belongs to: the participant outside a proxy study, the
    #: active child inside one.
    participant_id: str
    study_participant: StudyParticipant
    #: The id that arrived in the request, when it differs from the subject.
    credential_participant_id: Optional[str] = None
    #: The family, in a proxy study only.
    family: Optional[ProxyFamily] = None

    @property
    def credential(self) -> str:
        """The id the request proves: what a session belongs to."""
        return self.credential_participant_id or self.participant_id

    @property
    def is_proxy(self) -> bool:
        return self.family is not None

    @property
    def family_participant(self) -> StudyParticipant:
        """The row that owns family-level state (consent, instructions).

        The parent's row in a proxy study; the participant's own row otherwise.
        """
        return self.family.parent if self.family is not None else self.study_participant


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


def proxy_denied(message: str) -> HTTPException:
    """The one 403 a proxy study sends: same shape as the diary's refusals."""
    return HTTPException(
        status_code=403,
        detail={"code": "proxy_not_allowed", "message": message},
    )


class CredentialDenied(Exception):
    """An id used as a credential may not act.

    Carries the reason instead of an HTTP body, because the two bootstrap
    endpoints take the id as a query parameter and have their own, older error
    shapes that must not change under the participant clients.
    """

    NOT_AUTHORIZED = "not_authorized"
    IS_CHILD = "is_child"

    def __init__(self, reason: str, message: str) -> None:
        self.reason = reason
        self.message = message
        super().__init__(message)


def require_credential_link(
    session: Session, study: Study, participant_id: str
) -> StudyParticipant:
    """Authorize a participant id that arrived as a *query parameter*.

    ``study-config`` and ``activities-config`` take the id in the query string
    and never go through :func:`get_participant_context`, so they apply the same
    two rules here: the id must be known to the study, and it must not be a
    child of a proxy family.

    @returns The participant's row.
    @raises CredentialDenied When the id is unknown or belongs to a child.
    """
    link = participant_link(session, study, participant_id)
    if link is None:
        raise CredentialDenied(
            CredentialDenied.NOT_AUTHORIZED,
            f"Participant '{participant_id}' not authorized for this study",
        )
    if is_proxy_study(study):
        try:
            ensure_can_act(link)
        except ProxyResolutionError as error:
            raise CredentialDenied(CredentialDenied.IS_CHILD, str(error)) from error
    return link


def get_participant_context(
    study: Study = Depends(get_study),
    participant_id: str = Path(...),
    session: Session = Depends(get_session),
) -> ParticipantContext:
    require_valid_participant_id(participant_id)
    link = participant_link(session, study, participant_id)

    if link is None:
        if is_proxy_study(study) or not study.allow_unlisted_participants:
            # A proxy study is closed by configuration; the extra check keeps the
            # rule true even if a study was switched by hand.
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Participant '{participant_id}' not authorized for this study"
                ),
            )
        # Only reachable for open studies: a stand-in object that is not added
        # to the session, so read paths cannot accidentally persist it.
        link = StudyParticipant(study_id=study.id, participant_id=participant_id)

    if not is_proxy_study(study):
        return ParticipantContext(
            study=study,
            participant_id=participant_id,
            study_participant=link,
        )

    try:
        family = resolve_family(session, study, link)
    except ProxyResolutionError as error:
        raise proxy_denied(str(error)) from error

    subject = family.subject
    return ParticipantContext(
        study=study,
        participant_id=subject.participant_id,
        study_participant=subject,
        credential_participant_id=participant_id,
        family=family,
    )
