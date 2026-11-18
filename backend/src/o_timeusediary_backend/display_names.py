"""What a participant display name may look like - the single source of truth.

``display_name`` is display text, not a key. It is shown in the participant
frontend ("For: Tim"), substituted into study texts via the ``{display_name}``
placeholder, and carried in the participant export. Unlike a participant id it
has to accept every script the app is deployed in, so the rule is *Unicode
permissive, structure strict*:

* allowed: Unicode letters (``ä ö ü ß Å æ ø ł ż é ç ñ ő ș ı`` and any other
  script), combining marks (so a decomposed ``José`` is not rejected), digits,
  a single space, and ``-``, ``‐``, ``'``, ``’``, ``.``;
* the first character must be a letter or digit (so a name can never start a
  Markdown list item when it is substituted into a study text), and the last
  one must be a letter, digit or dot (initials: ``J. R. R.``);
* everything else is rejected. In particular markup characters
  (``< > & " ` * _ # [ ] ( ) | ~ \\ /``), because the value is substituted into
  Markdown study texts *before* they are rendered, and every control/format
  character (Unicode category ``C``), which includes newlines, tabs, zero-width
  joiners and the bidi overrides that can make a name display as something else.

Values are normalized to NFC, trimmed, and have internal whitespace collapsed
before they are validated and stored, so ``"  Tim   Tom "`` and ``"Tim Tom"``
are the same name. Control and format characters are rejected *before* that
normalization, so a cell that picked up a stray newline cannot be merged into a
single name that the roster never contained.
"""

from __future__ import annotations

import unicodedata
from typing import Any, Mapping, Optional, Sequence

DISPLAY_NAME_MAX_LENGTH = 50

# Rendered into the admin UI so the hint cannot drift from the rule.
DISPLAY_NAME_RULE_TEXT = (
    "Allowed are Unicode letters, digits, spaces and the punctuation "
    f"- ‐ ' ’ . , between 1 and {DISPLAY_NAME_MAX_LENGTH} characters, "
    "starting and ending with a letter or digit."
)

# The punctuation a real name or label may carry: hyphen (both spellings), the
# two apostrophes (O'Brien, D’Angelo) and the dot of initials. Nothing here can
# start a Markdown construct.
_ALLOWED_PUNCTUATION = frozenset("-‐'’.")
_SPACE = " "


def normalize_display_name(value: Any) -> str:
    """Trim, NFC-normalize and collapse internal whitespace.

    Applied before validation and before storage, so two spellings of the same
    name (composed vs decomposed, double spaces, non-breaking spaces pasted from
    a spreadsheet) do not produce two different values.

    @param value The raw value from a form, a file or the database.
    @returns The normalized string, possibly empty.
    """
    text = unicodedata.normalize("NFC", str(value or ""))
    return _SPACE.join(text.split())


def _is_name_char(char: str) -> bool:
    category = unicodedata.category(char)
    return category[0] in {"L", "M", "N"} or char == _SPACE or char in _ALLOWED_PUNCTUATION


def _is_first_char(char: str) -> bool:
    return unicodedata.category(char)[0] in {"L", "N"}


def _is_last_char(char: str) -> bool:
    # A dot is allowed at the end for initials (`J. R. R.`); it cannot start a
    # Markdown construct, unlike the characters `_is_first_char` keeps out.
    return _is_first_char(char) or char == "."


def _describe(char: str) -> str:
    return f"{char!r} (U+{ord(char):04X})"


def _problem(value: str) -> str:
    if not value:
        return "empty"
    if len(value) > DISPLAY_NAME_MAX_LENGTH:
        return f"longer than {DISPLAY_NAME_MAX_LENGTH} characters"
    if not _is_first_char(value[0]):
        return "must start with a letter or digit"
    if not _is_last_char(value[-1]):
        return "must end with a letter, digit or dot"
    for char in value:
        if not _is_name_char(char):
            return f"contains {_describe(char)}"
    return "does not follow the rule"


class InvalidDisplayNameError(ValueError):
    """A display name does not follow the shared rule."""

    def __init__(
        self,
        value: str,
        *,
        source: str = "display name",
        problem: Optional[str] = None,
    ) -> None:
        self.value = value
        super().__init__(
            f"Invalid {source} {value!r}: {problem or _problem(value)}. "
            f"{DISPLAY_NAME_RULE_TEXT}"
        )


def validate_display_name(value: Any, *, source: str = "display name") -> str:
    """Normalize and validate a display name.

    @param value The raw value. ``None`` and empty values are rejected: a row
        either has a name or the column stays NULL, and an empty string would
        make the UI show a label with nothing after it.
    @param source What to name in the error message.
    @returns The normalized name.
    @raises InvalidDisplayNameError When the value breaks the rule.
    """
    raw = str(value or "")
    # Invisible characters are rejected before normalization, not collapsed into
    # spaces: a cell that picked up a stray newline may hold two different
    # values ("Tim\nTom"), and silently joining them into one name would store
    # data the roster never contained.
    for char in raw:
        if unicodedata.category(char)[0] == "C":
            raise InvalidDisplayNameError(
                raw.strip(), source=source, problem=f"contains {_describe(char)}"
            )

    normalized = normalize_display_name(raw)
    if (
        not normalized
        or len(normalized) > DISPLAY_NAME_MAX_LENGTH
        or not _is_first_char(normalized[0])
        or not _is_last_char(normalized[-1])
        or not all(_is_name_char(char) for char in normalized)
    ):
        raise InvalidDisplayNameError(normalized, source=source)
    return normalized


def is_valid_display_name(value: Any) -> bool:
    """Whether ``value`` is already a normalized, valid display name."""
    try:
        return validate_display_name(value) == value
    except InvalidDisplayNameError:
        return False


def validate_participant_display_names(
    mapping: Optional[Mapping[str, str]],
    *,
    study_name_short: str,
    study_participant_ids: Sequence[str],
    allow_unlisted_participants: bool,
) -> dict[str, str]:
    """Validate the config-file ``participant_display_names`` map.

    The map is optional and sparse: it names some or all of the study's
    pre-defined participants. It is a *seed* for fixtures and demo studies -
    production names belong in the roster upload or the admin, not in a file
    that lives in the repository.

    Rules, all of which fail the import rather than dropping a name silently:

    * every key must be one of ``study_participant_ids`` (a typo in a pid is a
      participant with no name, which nobody would notice otherwise);
    * an open study (``allow_unlisted_participants``) has no participant list,
      so it cannot have names either;
    * every value follows the shared display-name rule.

    @param mapping The map from the config file, possibly None.
    @param study_name_short Study name, for the error message.
    @param study_participant_ids The study's pre-defined participants.
    @param allow_unlisted_participants Whether the study is open.
    @returns The normalized map (empty when nothing was given).
    @raises ValueError When the map breaks one of the rules.
    """
    names = dict(mapping or {})
    if not names:
        return {}

    if allow_unlisted_participants:
        raise ValueError(
            f"Study '{study_name_short}': participant_display_names is only valid "
            "for studies with allow_unlisted_participants=false - an open study has "
            "no participant list to name."
        )

    unknown = sorted(set(names) - set(study_participant_ids))
    if unknown:
        shown = ", ".join(unknown[:5])
        hidden = len(unknown) - 5
        if hidden > 0:
            shown += f" and {hidden} more"
        raise ValueError(
            f"Study '{study_name_short}': participant_display_names names "
            f"participant(s) that are not in study_participant_ids: {shown}. "
            "Add the id to the list or remove the name."
        )

    normalized: dict[str, str] = {}
    for participant_id, value in names.items():
        try:
            normalized[participant_id] = validate_display_name(
                value,
                source=(
                    f"display name for participant '{participant_id}' "
                    f"in study '{study_name_short}'"
                ),
            )
        except InvalidDisplayNameError as error:
            raise ValueError(str(error)) from error
    return normalized
