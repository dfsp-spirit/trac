import re
from datetime import datetime, timezone
from datetime import time
from typing import Mapping, Optional


def utc_now() -> datetime:
    """Get the current UTC time.

    Returns:
        datetime: Current UTC time
    """
    return datetime.now(timezone.utc)


def get_time_for_minutes_from_midnight(minutes_from_midnight: int) -> time:
    """
    Convert minutes from midnight to a time object.

    @param minutes_from_midnight Number of minutes since midnight.
    @return Time object representing the given minutes, wrapped to a 24-hour day.
    """
    # Handle minutes that might exceed 24 hours (1440 minutes)
    minutes_from_midnight = minutes_from_midnight % (24 * 60)

    # Calculate hours and minutes
    hours = minutes_from_midnight // 60
    minutes = minutes_from_midnight % 60

    return time(hours, minutes)


def coerce_utc_aware(value: datetime) -> datetime:
    """Coerce DB datetimes to UTC-aware values for safe cross-dialect comparisons."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)

    try:
        offset = value.tzinfo.utcoffset(value)
    except Exception:
        return value.replace(tzinfo=timezone.utc)

    if offset is None:
        return value.replace(tzinfo=timezone.utc)

    try:
        return value.astimezone(timezone.utc)
    except Exception:
        return value.replace(tzinfo=timezone.utc)


def to_utc_naive(value: datetime) -> datetime:
    """Normalize datetimes to naive UTC values for cross-dialect arithmetic."""
    return value.replace(tzinfo=None)


def localized_study_text(
    study: object, field_name: str, language: Optional[str] = None
) -> Optional[str]:
    """Resolve one of a study's per-language text columns to a single string.

    The columns hold either a plain string or a ``{language: text}`` map; the
    requested language wins, then the study's default, then English. Returns
    None rather than an empty string, so callers can test "does this study have
    instructions at all?".
    """
    target_language = language or getattr(study, "default_language", None)
    text_map = getattr(study, field_name, None)

    if isinstance(text_map, str):
        return text_map or None
    if not isinstance(text_map, dict) or not text_map:
        return None

    default_language = getattr(study, "default_language", None)
    return (
        text_map.get(target_language)
        or (text_map.get(default_language) if default_language else None)
        or text_map.get("en")
    )


#: The participant value study texts may reference. Kept in one place so the
#: payload builder, the docs and the tests cannot disagree about the spelling.
DISPLAY_NAME_PLACEHOLDER = "{display_name}"

# Only lower-case keys: study text is prose, and `{Name}` should stay literal
# rather than silently becoming something else.
_STUDY_TEXT_PLACEHOLDER_RE = re.compile(r"\{([a-z_]+)\}")

# Backstop only: `display_names.validate_display_name` already rejects every one
# of these, so a validated name reaches this function inert. It matters for
# values that did not come through the validator (a repaired row, a future edit
# path) and costs one pass over a 50-character string.
_MARKDOWN_SPECIAL_RE = re.compile(r"([\\`*_\[\]()#<>|~])")


def _escape_markdown_text(value: str) -> str:
    return _MARKDOWN_SPECIAL_RE.sub(r"\\\1", value)


def substitute_study_text_placeholders(
    text: Optional[str], values: Mapping[str, Optional[str]]
) -> Optional[str]:
    """Replace ``{key}`` tokens in a resolved study text with participant values.

    Runs *after* ``localized_study_text`` (so the study's language has already
    been chosen) and *before* the client renders the text as Markdown, which is
    why the substituted value is escaped for Markdown.

    A token whose value is missing is left untouched. Deleting it would break
    the sentence ("Please fill out the diary for ."), and substituting an empty
    string hides the real problem; a visible ``{display_name}`` tells the admin
    that the roster is missing a name for this participant.

    @param text The resolved study text, or None when the study has none.
    @param values Participant values keyed by placeholder name.
    @returns The text with known placeholders replaced, or None unchanged.
    """
    if not text:
        return text

    def replace(match: "re.Match[str]") -> str:
        key = match.group(1)
        value = values.get(key)
        if not value:
            return match.group(0)
        return _escape_markdown_text(str(value))

    return _STUDY_TEXT_PLACEHOLDER_RE.sub(replace, text)
