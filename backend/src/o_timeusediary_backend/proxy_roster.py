"""The KI's parent/child roster: read it, check it, apply it.

A proxy study has no way to add participants one by one - every participant is
either a parent or a child, and the link between them can only come from this
file (``dev_tools/plans/proxy_studies.md`` §6). The file is long-format, one row
per child:

    parent_id, subject_id, subject_name_encrypted,
    latest_possible_submission_at_encrypted

The names and the deadline arrive **encrypted** with the KI's key; they are
decrypted here, validated with the app's own rules and the name is re-encrypted
before it is stored. A row that cannot be decrypted is an error for the whole
file, never a silently dropped child: the roster is a mailing list, and a missing
child means a family that cannot finish.

Nothing is deleted by an import. A child that disappears from a new upload is
unlinked (its link is cleared, its diary stays) and reported, because deleting
research data is an explicit admin action and not a side effect of fixing a typo.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from sqlmodel import Session, select

from .display_names import InvalidDisplayNameError, validate_display_name
from .encrypted_fields import DecryptionError, decode_incoming, encrypt_text
from .models import Study, StudyParticipant
from .utils import coerce_utc_aware
from .participant_ids import InvalidParticipantIdError, validate_participant_id
from .tabular_files import ParsedDelimitedFile, find_header

PARENT_COLUMN = "parent_id"
SUBJECT_COLUMN = "subject_id"
NAME_COLUMN = "subject_name_encrypted"
DEADLINE_COLUMN = "latest_possible_submission_at_encrypted"

#: How many offending lines an error message spells out before summarising.
MAX_REPORTED_ERRORS = 5


class ProxyRosterError(ValueError):
    """The roster cannot be applied as a whole.

    The message lists the first few offending lines and never contains a
    decrypted name or a token.
    """


@dataclass(frozen=True)
class RosterChild:
    participant_id: str
    #: The child's name, validated, ready to be sealed for storage.
    display_name: Optional[str]
    #: The same name, sealed. Stored as-is; never logged, never exported.
    name_encoded: Optional[str]


@dataclass(frozen=True)
class RosterFamily:
    parent_id: str
    deadline_at: Optional[datetime]
    children: List[RosterChild]


def parse_proxy_roster(
    parsed: ParsedDelimitedFile, study: Study
) -> Tuple[List[RosterFamily], List[str]]:
    """Validate a whole roster file.

    @param parsed The uploaded table, already decoded and split into rows.
    @param study The proxy study the roster belongs to (for the window check).
    @returns ``(families, warnings)`` - warnings are things an admin should see
        but that do not stop the import (a deadline in the past).
    @raises ProxyRosterError When any line is unusable. Nothing is returned in
        that case, so a bad file cannot be half-applied.
    """
    parent_header = find_header(parsed.headers, PARENT_COLUMN)
    subject_header = find_header(parsed.headers, SUBJECT_COLUMN)
    name_header = find_header(parsed.headers, NAME_COLUMN)
    deadline_header = find_header(parsed.headers, DEADLINE_COLUMN)

    errors: List[str] = []
    warnings: List[str] = []
    families: Dict[str, dict] = {}
    order: List[str] = []
    seen_children: set[str] = set()
    parent_ids: set[str] = set()

    for line_number, row in parsed.rows:
        parent_id = _read_id(row, parent_header, line_number, errors)
        subject_id = _read_id(row, subject_header, line_number, errors)
        if parent_id is None or subject_id is None:
            continue

        if parent_id == subject_id:
            errors.append(
                f"Line {line_number}: '{parent_id}' cannot be its own parent."
            )
            continue
        if subject_id in seen_children:
            errors.append(
                f"Line {line_number}: child '{subject_id}' appears more than once."
            )
            continue
        seen_children.add(subject_id)

        name = _read_name(row.get(name_header, ""), line_number, errors)
        deadline = _read_deadline(row.get(deadline_header, ""), line_number, errors)
        if deadline is False:
            continue

        family = families.get(parent_id)
        if family is None:
            family = {"deadline": deadline, "children": []}
            families[parent_id] = family
            order.append(parent_id)
            parent_ids.add(parent_id)
        elif family["deadline"] != deadline:
            errors.append(
                f"Line {line_number}: parent '{parent_id}' has two different "
                "deadlines in this file."
            )
            continue

        family["children"].append(
            RosterChild(
                participant_id=subject_id,
                display_name=name,
                name_encoded=encrypt_text(name) if name else None,
            )
        )

    # A parent in one row must not be a child in another.
    both = sorted(parent_ids & seen_children)
    if both:
        errors.append(
            "These ids are a parent in one row and a child in another: "
            + ", ".join(f"'{value}'" for value in both)
        )

    if errors:
        raise ProxyRosterError(_summarize(errors))

    result: List[RosterFamily] = []
    for parent_id in order:
        family = families[parent_id]
        deadline = family["deadline"]
        _check_deadline_window(study, parent_id, deadline, warnings)
        result.append(
            RosterFamily(
                parent_id=parent_id,
                deadline_at=deadline,
                children=family["children"],
            )
        )
    return result, warnings


def apply_proxy_roster(
    session: Session,
    study: Study,
    families: List[RosterFamily],
    *,
    dry_run: bool = False,
) -> Dict[str, int]:
    """Write the roster: parent rows, child rows and their links.

    Idempotent by construction: rows are looked up by ``(study, participant_id)``
    and updated, so re-uploading a corrected file is how a typo is fixed.

    @returns Counts so the admin sees what happened.
    """
    summary = {
        "families": len(families),
        "parents_created": 0,
        "children_created": 0,
        "children_updated": 0,
        "children_unlinked": 0,
    }

    for family in families:
        parent = _participant_row(session, study, family.parent_id)
        if parent is None:
            summary["parents_created"] += 1
            if not dry_run:
                session.add(
                    StudyParticipant(
                        study_id=study.id,
                        participant_id=family.parent_id,
                        proxy_deadline_at=family.deadline_at,
                    )
                )
        elif parent.proxy_deadline_at != family.deadline_at and not dry_run:
            parent.proxy_deadline_at = family.deadline_at
            session.add(parent)

        kept: set[str] = set()
        for child in family.children:
            kept.add(child.participant_id)
            existing = _participant_row(session, study, child.participant_id)
            if existing is None:
                summary["children_created"] += 1
                if not dry_run:
                    session.add(
                        StudyParticipant(
                            study_id=study.id,
                            participant_id=child.participant_id,
                            proxy_participant_id=family.parent_id,
                            subject_name_encrypted=child.name_encoded,
                            display_name=None,
                        )
                    )
                continue

            changed = (
                existing.proxy_participant_id != family.parent_id
                or existing.subject_name_encrypted != child.name_encoded
            )
            if changed:
                summary["children_updated"] += 1
            if changed and not dry_run:
                existing.proxy_participant_id = family.parent_id
                existing.subject_name_encrypted = child.name_encoded
                session.add(existing)

        # A child that left the file keeps its row and its diary; only the link
        # goes, so the family does not silently keep filling in a questionnaire
        # that the KI withdrew.
        for orphan in _children_of(session, study, family.parent_id):
            if orphan.participant_id in kept:
                continue
            summary["children_unlinked"] += 1
            if not dry_run:
                orphan.proxy_participant_id = None
                session.add(orphan)

    return summary


def _summarize(errors: List[str]) -> str:
    shown = "; ".join(errors[:MAX_REPORTED_ERRORS])
    hidden = len(errors) - MAX_REPORTED_ERRORS
    if hidden > 0:
        shown += f"; and {hidden} more"
    return f"Nothing was imported. {shown}"


def _read_id(
    row: Dict[str, str], header: str, line_number: int, errors: List[str]
) -> Optional[str]:
    try:
        return validate_participant_id(row.get(header, ""))
    except InvalidParticipantIdError as error:
        errors.append(f"Line {line_number}: {error}")
        return None


def _read_name(raw: str, line_number: int, errors: List[str]) -> Optional[str]:
    """Decrypt, validate and keep the plaintext; the sealed form is built later."""
    cell = (raw or "").strip()
    if not cell:
        return None
    try:
        plaintext = decode_incoming(cell)
    except DecryptionError:
        # Never echo the token or anything decrypted from it.
        errors.append(
            f"Line {line_number}: the value in '{NAME_COLUMN}' could not be "
            "decrypted with the configured key."
        )
        return None
    if not plaintext:
        return None
    try:
        return validate_display_name(plaintext, source=f"line {line_number} name")
    except InvalidDisplayNameError as error:
        errors.append(f"Line {line_number}: {error}")
        return None


def _read_deadline(raw: str, line_number: int, errors: List[str]):
    """Return the instant, None when empty, or False when the cell is unusable."""
    cell = (raw or "").strip()
    if not cell:
        return None
    try:
        plaintext = decode_incoming(cell)
    except DecryptionError:
        errors.append(
            f"Line {line_number}: the value in '{DEADLINE_COLUMN}' could not be "
            "decrypted with the configured key."
        )
        return False
    if not plaintext or not plaintext.strip():
        return None
    try:
        parsed = datetime.fromisoformat(plaintext.strip())
    except ValueError:
        errors.append(
            f"Line {line_number}: the deadline is not an ISO 8601 instant "
            "('2026-10-27T14:30:00+02:00')."
        )
        return False
    if parsed.tzinfo is None:
        # App-wide convention, same as data_collection_start/end: no offset means
        # UTC, never local time.
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _check_deadline_window(
    study: Study, parent_id: str, deadline: Optional[datetime], warnings: List[str]
) -> None:
    if deadline is None:
        return
    if deadline > coerce_utc_aware(study.data_collection_end):
        warnings.append(
            f"Parent '{parent_id}': the deadline is after the study's "
            "data_collection_end, so the family cannot use the extra time."
        )
    if deadline <= datetime.now(timezone.utc):
        warnings.append(f"Parent '{parent_id}': the deadline is already in the past.")


def _participant_row(
    session: Session, study: Study, participant_id: str
) -> Optional[StudyParticipant]:
    return session.exec(
        select(StudyParticipant).where(
            StudyParticipant.study_id == study.id,
            StudyParticipant.participant_id == participant_id,
        )
    ).first()


def _children_of(
    session: Session, study: Study, parent_id: str
) -> List[StudyParticipant]:
    return list(
        session.exec(
            select(StudyParticipant).where(
                StudyParticipant.study_id == study.id,
                StudyParticipant.proxy_participant_id == parent_id,
            )
        ).all()
    )
