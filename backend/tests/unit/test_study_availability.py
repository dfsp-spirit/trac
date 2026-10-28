"""Why a study is not collecting (D39).

`study_availability` is the single answer the 403, the stage machine and the
participant's unavailable page share, so the reason it reports is part of the
contract. Pure: a fake study object and an explicit "now" are enough.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from o_timeusediary_backend.api_deps.diary_access import (
    UNAVAILABLE_ENDED,
    UNAVAILABLE_NOT_STARTED,
    UNAVAILABLE_PAUSED,
    study_availability,
)

START = datetime(2026, 6, 1, tzinfo=timezone.utc)
END = datetime(2026, 8, 1, tzinfo=timezone.utc)


def _study(*, paused: bool = False, start: datetime = START, end: datetime = END):
    return SimpleNamespace(
        is_paused=paused, data_collection_start=start, data_collection_end=end
    )


def test_an_open_study_is_available_without_a_reason():
    availability = study_availability(_study(), now=START + timedelta(days=1))
    assert availability.available is True
    assert availability.reason is None


def test_the_window_boundaries_are_inclusive():
    def available(now: datetime) -> bool:
        return study_availability(_study(), now=now).available

    assert available(START) is True
    assert available(END) is True


def test_a_paused_study_inside_its_window_says_paused():
    availability = study_availability(
        _study(paused=True), now=START + timedelta(days=1)
    )
    assert availability.available is False
    assert availability.reason == UNAVAILABLE_PAUSED


def test_a_window_that_is_over_says_ended():
    availability = study_availability(_study(), now=END + timedelta(seconds=1))
    assert availability.available is False
    assert availability.reason == UNAVAILABLE_ENDED


def test_a_window_that_has_not_started_says_not_started():
    availability = study_availability(_study(), now=START - timedelta(seconds=1))
    assert availability.available is False
    assert availability.reason == UNAVAILABLE_NOT_STARTED


def test_the_date_wins_over_the_pause_switch():
    """A pause is meaningless once the window is over or has not opened."""
    ended = study_availability(_study(paused=True), now=END + timedelta(days=1))
    not_started = study_availability(_study(paused=True), now=START - timedelta(days=1))
    assert ended.reason == UNAVAILABLE_ENDED
    assert not_started.reason == UNAVAILABLE_NOT_STARTED


def test_a_naive_now_is_read_as_utc():
    """The database may hand back naive datetimes; the answer must not flip."""
    availability = study_availability(
        _study(start=START.replace(tzinfo=None), end=END.replace(tzinfo=None)),
        now=START + timedelta(days=1),
    )
    assert availability.available is True
