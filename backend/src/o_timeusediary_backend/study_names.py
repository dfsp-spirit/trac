"""What a study's ``name_short`` may look like - the single source of truth.

``name_short`` is the technical study identifier: it appears in admin and API
paths, in participant invitation links (``?study=<name_short>``), in external-task
return URLs and in import matching. The rule therefore has to hold everywhere a
study is created or renamed, and it lives here only once.

Lowercase letters, digits and ``_``, 2 to 50 characters. Lowercase-only is not
arbitrary: it keeps identifiers visually distinct from display names and avoids
two studies that differ only by case. No ``-``, because the pattern has been
documented that way since the config file existed.
"""

from __future__ import annotations

import re
from typing import Any, Optional

STUDY_NAME_SHORT_PATTERN = r"[a-z0-9_]{2,50}"
STUDY_NAME_SHORT_MIN_LENGTH = 2
STUDY_NAME_SHORT_MAX_LENGTH = 50

# Rendered into the admin UI so the hint cannot drift from the rule.
STUDY_NAME_SHORT_RULE_TEXT = (
    "Use lowercase letters (a-z), digits (0-9) and '_', "
    f"{STUDY_NAME_SHORT_MIN_LENGTH} to {STUDY_NAME_SHORT_MAX_LENGTH} characters."
)

_PATTERN = re.compile(STUDY_NAME_SHORT_PATTERN)


class InvalidStudyNameShortError(ValueError):
    """A study ``name_short`` does not follow the shared rule."""

    def __init__(self, value: str, *, source: str = "study name_short") -> None:
        self.value = value
        super().__init__(
            f"Invalid {source}: '{value}' ({_problem(value)}). "
            f"{STUDY_NAME_SHORT_RULE_TEXT}"
        )


def _problem(value: str) -> str:
    if not value:
        return "empty"
    if len(value) < STUDY_NAME_SHORT_MIN_LENGTH:
        return f"shorter than {STUDY_NAME_SHORT_MIN_LENGTH} characters"
    if len(value) > STUDY_NAME_SHORT_MAX_LENGTH:
        return f"longer than {STUDY_NAME_SHORT_MAX_LENGTH} characters"
    return (
        "contains characters other than lowercase letters (a-z), "
        "digits (0-9) and '_'"
    )


def is_valid_study_name_short(value: Any) -> bool:
    """Whether ``value`` is already a normalized, valid study ``name_short``."""
    return isinstance(value, str) and _PATTERN.fullmatch(value) is not None


def normalize_study_name_short(raw: Any) -> Optional[str]:
    """Strip ``raw`` and return it, or None when nothing remains.

    Does not validate: callers that persist the value must use
    :func:`validate_study_name_short`.
    """
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    return text or None


def validate_study_name_short(raw: Any, *, source: str = "study name_short") -> str:
    """Return the stripped ``name_short``.

    @param raw Value to check, typically from a request or a config file.
    @param source What to name in the error message.
    @returns The identifier without surrounding whitespace.
    @raises InvalidStudyNameShortError When the value breaks the rule.
    """
    text = normalize_study_name_short(raw) or ""
    if not is_valid_study_name_short(text):
        raise InvalidStudyNameShortError(text, source=source)
    return text
