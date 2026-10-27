"""Unit tests for the one coverage rule (D20).

Coverage used to be a sum, computed in two live places plus a dead submit
validator. These tests pin the rule the whole app now shares: a union clipped to
the study's day window, with the tail of a cross-midnight activity counted on the
day it runs into.
"""

from types import SimpleNamespace

from o_timeusediary_backend.coverage import (
    TimedActivity,
    coverage_by_day_and_timeline,
    day_meets_requirements,
    next_day_label_ids,
    required_coverage_by_timeline,
    to_day_relative,
    union_minutes,
)


def timed(day: int, start: int, end: int, timeline: int = 1) -> TimedActivity:
    return TimedActivity(
        day_label_id=day, timeline_id=timeline, start_minutes=start, end_minutes=end
    )


# --- primitives -----------------------------------------------------------
def test_union_minutes_counts_overlaps_once():
    assert union_minutes([]) == 0
    assert union_minutes([(0, 60)]) == 60
    assert union_minutes([(0, 60), (60, 120)]) == 120, "touching intervals merge"
    assert union_minutes([(0, 120), (60, 180)]) == 180
    assert union_minutes([(0, 100), (10, 40)]) == 100, "nested intervals"
    assert union_minutes([(0, 0), (10, 10)]) == 0, "zero-length intervals are ignored"


def test_to_day_relative_shifts_into_the_study_day():
    assert to_day_relative(0, 0) == 0
    assert to_day_relative(600, 0) == 600
    assert to_day_relative(240, 240) == 0, "04:00 is the start of a 04:00 study day"
    assert to_day_relative(120, 240) == 1320, "02:00 belongs to the end of that day"
    assert to_day_relative(1560, 240) == 1320, "02:00 next day, same place"


# --- coverage -------------------------------------------------------------
def test_coverage_of_a_simple_day():
    covered = coverage_by_day_and_timeline([timed(10, 480, 600)])
    assert covered == {10: {1: 120}}


def test_parallel_activities_do_not_sum_past_a_day():
    covered = coverage_by_day_and_timeline(
        [timed(10, 0, 1440), timed(10, 0, 1440), timed(10, 0, 1440)]
    )
    assert covered[10][1] == 1440


def test_parallel_activities_count_their_union():
    covered = coverage_by_day_and_timeline([timed(10, 0, 120), timed(10, 60, 180)])
    assert covered[10][1] == 180


def test_cross_midnight_tail_counts_on_the_following_day():
    covered = coverage_by_day_and_timeline(
        [timed(10, 1320, 1920)],
        day_labels_in_order=[10, 11, 12],
    )
    assert covered[10][1] == 120, "22:00 to midnight"
    assert covered[11][1] == 480, "midnight to 08:00"


def test_the_tail_of_the_last_day_has_nowhere_to_go():
    covered = coverage_by_day_and_timeline(
        [timed(12, 1320, 1920)], day_labels_in_order=[10, 11, 12]
    )
    assert covered[12][1] == 120
    assert 13 not in covered


def test_a_legacy_end_smaller_than_start_is_read_as_crossing_midnight():
    covered = coverage_by_day_and_timeline(
        [timed(10, 1320, 60)], day_labels_in_order=[10, 11]
    )
    assert covered[10][1] == 120
    assert covered[11][1] == 60


def test_the_day_window_moves_where_a_record_sits():
    # 02:00-03:00 in a 04:00 study is the end of the previous day's window.
    covered = coverage_by_day_and_timeline([timed(10, 120, 180)], day_start_minutes=240)
    assert covered[10][1] == 60


def test_a_full_clock_day_is_split_at_a_shifted_window():
    # 00:00-24:00 clock in a 04:00 study: the first four hours end the previous
    # window, the rest opens the next one, and the total is still 24 hours.
    covered = coverage_by_day_and_timeline(
        [timed(10, 0, 1440)], day_labels_in_order=[10, 11], day_start_minutes=240
    )
    assert covered[10][1] == 240
    assert covered[11][1] == 1200
    assert sum(covered[10].values()) + sum(covered[11].values()) == 1440


def test_days_without_data_are_absent():
    covered = coverage_by_day_and_timeline([timed(10, 0, 60)])
    assert set(covered) == {10}


def test_timelines_are_measured_separately():
    covered = coverage_by_day_and_timeline(
        [timed(10, 0, 60, timeline=1), timed(10, 0, 300, timeline=2)]
    )
    assert covered[10] == {1: 60, 2: 300}


# --- requirements ---------------------------------------------------------
def test_next_day_label_ids_maps_display_order():
    assert next_day_label_ids([10, 11, 12]) == {10: 11, 11: 12}
    assert next_day_label_ids([10]) == {}
    assert next_day_label_ids([]) == {}


def test_required_coverage_ignores_timelines_without_a_requirement():
    timelines = [
        SimpleNamespace(id=1, min_coverage=1440),
        SimpleNamespace(id=2, min_coverage=None),
        SimpleNamespace(id=3, min_coverage=0),
        SimpleNamespace(id=4, min_coverage=200),
    ]
    assert required_coverage_by_timeline(timelines) == {1: 1440, 4: 200}


def test_a_day_without_data_never_counts_as_complete():
    assert day_meets_requirements({}, {}) is False
    assert day_meets_requirements({1: 0}, {1: 0}) is False


def test_a_day_meets_every_required_timeline():
    assert day_meets_requirements({1: 1440}, {1: 1440}) is True
    assert day_meets_requirements({1: 1439}, {1: 1440}) is False
    assert day_meets_requirements({1: 600, 2: 30}, {1: 600, 2: 60}) is False
    assert day_meets_requirements({1: 600}, {}) is True, "no requirement, but data"
