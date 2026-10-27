from datetime import datetime, timezone
from datetime import time
from typing import Optional


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
