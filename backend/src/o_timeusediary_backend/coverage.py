"""How much of a study day is covered by activities, in one place (D20).

Coverage is the union of the intervals, clipped to the study's day window, so
three activities running in parallel cover their minutes once and never sum past
24 hours. The number is used by the submit gate, the admin progress view, the
diary API and the participant's day rail, and it used to be computed by
summation in three different places - which is exactly how the gate and the
progress bar drift apart.

Conventions
-----------
* ``start_minutes`` / ``end_minutes`` are **clock** minutes as stored in the
  database. They are converted to minutes since the study day start
  (``Study.day_start_minutes``, 0 for new studies, 240 for legacy 04:00 studies)
  before any arithmetic.
* A record may end after midnight (``end_minutes > 1440``). Its head belongs to
  its own day label and its tail to the next day label in display order (D6).
  Length is always taken from the stored clock values, so a record whose shifted
  start and end would coincide (a full day in a shifted window) still measures
  correctly; the tail is dropped only when there is no next day label.
* Legacy rows may store a cross-midnight end as a *smaller* clock time; that is
  read as crossing midnight rather than as a negative duration.

Everything here is pure: no session, no ORM. Callers pass plain tuples.
"""

from __future__ import annotations

from typing import Iterable, Mapping, NamedTuple, Sequence

MINUTES_PER_DAY = 1440


class TimedActivity(NamedTuple):
    """The four fields coverage needs, decoupled from the ORM row."""

    day_label_id: int
    timeline_id: int
    start_minutes: int
    end_minutes: int


def to_day_relative(minutes: int, day_start_minutes: int = 0) -> int:
    """Clock minutes -> minutes since the study day started."""
    shifted = minutes - day_start_minutes
    if shifted < 0:
        shifted += MINUTES_PER_DAY
    return shifted


def union_minutes(intervals: Iterable[tuple[int, int]]) -> int:
    """Total length covered by a set of intervals, overlaps counted once."""
    ordered = sorted((start, end) for start, end in intervals if end > start)
    if not ordered:
        return 0

    total = 0
    current_start, current_end = ordered[0]
    for start, end in ordered[1:]:
        if start <= current_end:
            current_end = max(current_end, end)
        else:
            total += current_end - current_start
            current_start, current_end = start, end
    return total + (current_end - current_start)


def next_day_label_ids(day_label_ids_in_order: Sequence[int]) -> dict[int, int]:
    """Map each day label to the one that follows it in display order."""
    return dict(zip(day_label_ids_in_order, day_label_ids_in_order[1:]))


def coverage_by_day_and_timeline(
    activities: Iterable[TimedActivity],
    *,
    day_labels_in_order: Sequence[int] = (),
    day_start_minutes: int = 0,
) -> dict[int, dict[int, int]]:
    """Covered minutes per day label and timeline.

    Only days that have activities appear in the result, so
    ``day_label_id in result`` is the "has any data" test.

    @param activities Rows to measure.
    @param day_labels_in_order Day label ids ordered by display_order, so a tail
        can be attributed to the following day.
    @param day_start_minutes Where the reporting day starts.
    @returns ``{day_label_id: {timeline_id: minutes}}``.
    """
    following = next_day_label_ids(list(day_labels_in_order))
    buckets: dict[int, dict[int, list[tuple[int, int]]]] = {}

    for activity in activities:
        # Duration comes from the stored clock values, before any window shift:
        # a record can span a whole day, in which case both of its shifted
        # endpoints would be equal and the length would be lost.
        duration = activity.end_minutes - activity.start_minutes
        if duration < 0:
            # A cross-midnight row written by the old frontend can carry a
            # smaller end than start; read that as "ends tomorrow".
            duration += MINUTES_PER_DAY
        if duration <= 0:
            continue

        start = to_day_relative(activity.start_minutes, day_start_minutes)
        end = start + duration

        head_end = min(end, MINUTES_PER_DAY)
        if head_end > start:
            buckets.setdefault(activity.day_label_id, {}).setdefault(
                activity.timeline_id, []
            ).append((start, head_end))

        if end > MINUTES_PER_DAY:
            tail_end = min(end - MINUTES_PER_DAY, MINUTES_PER_DAY)
            target = following.get(activity.day_label_id)
            if target is not None and tail_end > 0:
                buckets.setdefault(target, {}).setdefault(
                    activity.timeline_id, []
                ).append((0, tail_end))

    return {
        day_label_id: {
            timeline_id: union_minutes(intervals)
            for timeline_id, intervals in per_timeline.items()
        }
        for day_label_id, per_timeline in buckets.items()
    }


def day_meets_requirements(
    coverage_for_day: Mapping[int, int],
    required_by_timeline: Mapping[int, int],
) -> bool:
    """Does a day satisfy every timeline's ``min_coverage``?

    A timeline without a requirement does not constrain the day; a day with no
    data never counts as complete, even when no timeline sets a requirement
    (that is the "any data" rule the old helper had).
    """
    if not coverage_for_day:
        return False
    if not any(minutes > 0 for minutes in coverage_for_day.values()):
        return False
    return all(
        coverage_for_day.get(timeline_id, 0) >= required
        for timeline_id, required in required_by_timeline.items()
    )


def required_coverage_by_timeline(timelines: Iterable[object]) -> dict[int, int]:
    """``{timeline_id: min_coverage}`` for timelines that require coverage."""
    required: dict[int, int] = {}
    for timeline in timelines:
        coverage = int(getattr(timeline, "min_coverage", 0) or 0)
        if coverage > 0:
            required[int(getattr(timeline, "id"))] = coverage
    return required
