from datetime import datetime, timezone
from datetime import time


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
