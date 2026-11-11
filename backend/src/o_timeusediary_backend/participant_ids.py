"""What a participant id may look like - the single source of truth.

A participant id identifies a person across studies and is also the credential
carried in an invitation link, so it ends up in URLs, CSV and TSV files. The
rule lives here and nowhere else; every boundary that creates or accepts an id
(admin paste box, file upload, study config import, CLI import, participant
frontends) calls into this module instead of writing its own check.

Allowed are ASCII letters, digits, ``_`` and ``-``, between 1 and
``PARTICIPANT_ID_MAX_LENGTH`` characters. The underscore and dash are not
decoration: the rosters shipped with the app (``pending_01``, ``diary_01``) and
the admin placeholder (``participant_001``) use them, and both are safe in a
URL, in CSV and in TSV without escaping.

Both participant frontends generate 16-digit numeric ids for open studies, which
fits this rule.
"""

from __future__ import annotations

import re
from typing import Any, Iterable, List, Optional, Sequence

PARTICIPANT_ID_PATTERN = r"[A-Za-z0-9_-]+"
PARTICIPANT_ID_MAX_LENGTH = 100

# Rendered into the admin UI so the hint cannot drift from the rule.
PARTICIPANT_ID_RULE_TEXT = (
    "Allowed are ASCII letters, digits, '_' and '-', "
    f"at most {PARTICIPANT_ID_MAX_LENGTH} characters."
)

# How many offending values an error message spells out before summarising.
MAX_REPORTED_INVALID_IDS = 5

_ID_RE = re.compile(PARTICIPANT_ID_PATTERN)


class InvalidParticipantIdError(ValueError):
    """One or more participant ids do not follow the shared rule."""

    def __init__(
        self, invalid: Sequence[str], *, source: str = "participant ids"
    ) -> None:
        self.invalid = list(invalid)
        super().__init__(_build_message(self.invalid, source))


def _build_message(invalid: Sequence[str], source: str) -> str:
    shown = ", ".join(
        f"'{value}' ({_problem(value)})" for value in invalid[:MAX_REPORTED_INVALID_IDS]
    )
    hidden = len(invalid) - MAX_REPORTED_INVALID_IDS
    if hidden > 0:
        shown += f" and {hidden} more"
    return f"Invalid {source}: {shown}. {PARTICIPANT_ID_RULE_TEXT}"


def _problem(value: str) -> str:
    if not value:
        return "empty"
    if len(value) > PARTICIPANT_ID_MAX_LENGTH:
        return f"longer than {PARTICIPANT_ID_MAX_LENGTH} characters"
    return "contains characters other than letters, digits, '_' and '-'"


def is_valid_participant_id(value: Any) -> bool:
    """Whether ``value`` is already a normalized, valid participant id."""
    return (
        isinstance(value, str)
        and len(value) <= PARTICIPANT_ID_MAX_LENGTH
        and _ID_RE.fullmatch(value) is not None
    )


def normalize_participant_id(raw: Any) -> Optional[str]:
    """Strip ``raw`` and return it, or None when nothing remains.

    Does not validate: callers that persist the value must use
    :func:`validate_participant_id` or :func:`normalize_participant_ids`.
    """
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    return text or None


def validate_participant_id(raw: Any, *, source: str = "participant id") -> str:
    """Return the stripped id.

    @param raw Value to check, typically from a request or a file.
    @param source What to name in the error message.
    @returns The id without surrounding whitespace.
    @raises InvalidParticipantIdError When the id breaks the rule.
    """
    text = normalize_participant_id(raw) or ""
    if not is_valid_participant_id(text):
        raise InvalidParticipantIdError([text], source=source)
    return text


def normalize_participant_ids(
    raw_ids: Iterable[Any],
    *,
    source: str = "participant ids",
    reject_blank: bool = False,
) -> List[str]:
    """Strip, validate and de-duplicate ids, keeping the first occurrence order.

    @param raw_ids Values to normalize.
    @param source What to name in the error message.
    @param reject_blank When true, an empty value is an error instead of being
        skipped. Use it for authored input (study configs), where a blank entry
        is a mistake, and not for pasted lists, where blank lines are just
        separators.
    @returns The valid ids, each appearing once.
    @raises InvalidParticipantIdError When any value breaks the rule; no value
        is returned in that case, so callers cannot partially apply a bad list.
    """
    normalized: List[str] = []
    invalid: List[str] = []
    seen: set[str] = set()

    for raw in raw_ids:
        text = normalize_participant_id(raw) or ""
        if not text:
            if reject_blank:
                invalid.append(text)
            continue
        if not is_valid_participant_id(text):
            invalid.append(text)
            continue
        if text in seen:
            continue
        seen.add(text)
        normalized.append(text)

    if invalid:
        raise InvalidParticipantIdError(invalid, source=source)
    return normalized
