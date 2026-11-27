"""Who fills in whose diary: the parent -> child resolution of a proxy study.

One place answers the questions the whole proxy flow hangs on
(``dev_tools/plans/proxy_studies.md`` §0 and §5):

* which children belong to a credentialed parent,
* which of them is the *active* one, i.e. the first questionnaire that is not
  finished,
* whether the family is finished.

Nothing here raises HTTP errors or imports FastAPI: a denial is a
``ProxyResolutionError`` and the caller turns it into a 403. Keeping the rules
free of the web layer is what lets the participant context, the stage machine
and the exports agree instead of drifting.

Identity vocabulary, because two ids now exist in one request:

* the **credential** is the participant id from the invitation link - the parent
  in a proxy study, and the only thing the request is allowed to prove;
* the **subject** is the row the diary belongs to - the active child. The server
  derives it; the client never sends it.
"""

from __future__ import annotations

from typing import Dict, List, NamedTuple, Optional, Sequence

from sqlmodel import Session, select

from .models import REPORT_MODE_PROXY, Study, StudyParticipant


class ProxyResolutionError(Exception):
    """A participant id cannot act in this proxy study.

    The message is participant-facing, so it says what to do ("open your own
    invitation link") instead of naming the internal roles.
    """


CHILD_ID_MESSAGE = (
    "This link belongs to a participant whose diary is filled in by someone "
    "else. Please open your own invitation link."
)


class ProxyFamily(NamedTuple):
    """One parent and the children whose questionnaires they fill in.

    ``children`` is never empty (see :func:`resolve_family`), which is what makes
    :attr:`subject` total.
    """

    #: The participant id from the invitation link; the parent.
    credential_participant_id: str
    #: The parent's own row. Consent, instructions and the deadline live here.
    parent: StudyParticipant
    #: The children in roster order (insertion order, see the plan §3.3).
    children: List[StudyParticipant]
    #: The first child with an unfinished questionnaire, or None when done.
    active: Optional[StudyParticipant]

    @property
    def finished(self) -> bool:
        """Every child has a closed questionnaire (submitted or skipped, §5)."""
        return self.active is None

    @property
    def subject(self) -> StudyParticipant:
        """The row diary data is read from and written to.

        The active child while the family is working. Once every child is
        finished there is no active one, and the last child stands in: its
        ``study_submitted_at`` is set, which is exactly the state that makes the
        participant `done`, so a finished family needs no special case here.
        """
        return self.active or self.children[-1]


def is_proxy_study(study: Study) -> bool:
    """Whether this study is filled in by parents (see ``studies.report_mode``)."""
    return getattr(study, "report_mode", None) == REPORT_MODE_PROXY


def is_subject(participant: StudyParticipant) -> bool:
    """Whether the row is a child's, i.e. its id must never act as a credential."""
    return participant.proxy_participant_id is not None


def ensure_can_act(credential: StudyParticipant) -> None:
    """Refuse a child row used as a credential (decision 5).

    Used by every place that authorizes a participant id, including the two
    bootstrap endpoints that take the id as a query parameter and never touch
    the shared context dependency.
    """
    if is_subject(credential):
        raise ProxyResolutionError(CHILD_ID_MESSAGE)


def family_children(
    session: Session, study: Study, credential_participant_id: str
) -> List[StudyParticipant]:
    """The children this parent fills in, in roster order."""
    return list(
        session.exec(
            select(StudyParticipant)
            .where(
                StudyParticipant.study_id == study.id,
                StudyParticipant.proxy_participant_id == credential_participant_id,
            )
            .order_by(StudyParticipant.id)
        ).all()
    )


def active_child(
    children: Sequence[StudyParticipant],
) -> Optional[StudyParticipant]:
    """The first child whose questionnaire is not finished (decision 17).

    "Finished" is one definition for the server, the stage machine and the admin
    views: ``study_submitted_at`` is set, whether by submitting or by skipping.
    """
    for child in children:
        if child.study_submitted_at is None:
            return child
    return None


def resolve_family(
    session: Session, study: Study, credential: StudyParticipant
) -> ProxyFamily:
    """Resolve the family of a credentialed parent.

    @param session Database session.
    @param study The proxy study.
    @param credential The parent's association row (already loaded by the
        caller, which needed it to decide that the id is known at all).
    @returns The family, with ``active`` set to None when it is finished.
    @raises ProxyResolutionError When the id belongs to a child, or when it is
        not a parent in this study's roster - both are a 403, not an empty
        family: a credential the roster does not know must not see a blank
        questionnaire.
    """
    ensure_can_act(credential)
    children = family_children(session, study, credential.participant_id)
    if not children:
        raise ProxyResolutionError(
            "This participant is not listed as a parent in this study's roster. "
            "Please use the invitation link you received."
        )
    return ProxyFamily(
        credential_participant_id=credential.participant_id,
        parent=credential,
        children=children,
        active=active_child(children),
    )


#: What a participant is in their study, for the admin views and exports. The
#: KI's vocabulary is parent/child; "self" is the only role in a self-report
#: study, and "unlinked" marks a roster row that is in neither position, which
#: an import should never produce (it is reported instead of hidden).
ROLE_PARENT = "parent"
ROLE_CHILD = "child"
ROLE_SELF = "self"
ROLE_UNLINKED = "unlinked"


def roles_for(participants: Sequence[StudyParticipant], study: Study) -> Dict[str, str]:
    """Map every participant id of one study to its role.

    Derived, never stored (decision 7 + §5): the roster is the single source of
    truth, so a role cannot drift from it.
    """
    if not is_proxy_study(study):
        return {row.participant_id: ROLE_SELF for row in participants}
    parents = {
        row.proxy_participant_id for row in participants if row.proxy_participant_id
    }
    roles: Dict[str, str] = {}
    for row in participants:
        if is_subject(row):
            roles[row.participant_id] = ROLE_CHILD
        elif row.participant_id in parents:
            roles[row.participant_id] = ROLE_PARENT
        else:
            roles[row.participant_id] = ROLE_UNLINKED
    return roles


def children_by_parent(
    participants: Sequence[StudyParticipant],
) -> Dict[str, List[StudyParticipant]]:
    """Group child rows by their parent's id, for completion and exports."""
    grouped: Dict[str, List[StudyParticipant]] = {}
    for row in participants:
        if row.proxy_participant_id:
            grouped.setdefault(row.proxy_participant_id, []).append(row)
    return grouped


def family_finished(child_rows: Sequence[StudyParticipant]) -> bool:
    """Whether a parent's children are all finished (decisions 15 + 17)."""
    return bool(child_rows) and all(
        row.study_submitted_at is not None for row in child_rows
    )
