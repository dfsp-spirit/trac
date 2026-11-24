"""Server-wide finished-participant chart aggregation."""

from __future__ import annotations

import os
from datetime import datetime

os.environ.setdefault("TUD_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("TUD_ALLOWED_ORIGINS", '["http://localhost:3000"]')

from o_timeusediary_backend.api import _build_server_completion_progress


def test_no_completions_produces_an_empty_series():
    progress = _build_server_completion_progress([], today=datetime(2026, 1, 5))

    assert progress == {
        "has_data": False,
        "dates": [],
        "cumulative": [],
        "total_finished": 0,
        "total_submitted": 0,
        "total_skipped": 0,
    }


def test_cumulative_counts_submitted_and_skipped_diaries():
    progress = _build_server_completion_progress(
        [
            (datetime(2026, 1, 1, 10, 0), None),
            (datetime(2026, 1, 1, 11, 0), datetime(2026, 1, 1, 11, 0)),
            (datetime(2026, 1, 3, 9, 0), None),
        ],
        today=datetime(2026, 1, 5, 12, 0),
    )

    assert progress["has_data"] is True
    assert progress["dates"] == [
        "2025-12-31",
        "2026-01-01",
        "2026-01-02",
        "2026-01-03",
        "2026-01-04",
        "2026-01-05",
    ]
    assert progress["cumulative"] == [0, 2, 2, 3, 3, 3]
    assert progress["total_finished"] == 3
    assert progress["total_submitted"] == 2
    assert progress["total_skipped"] == 1


def test_a_single_completion_day_still_has_a_zero_baseline():
    progress = _build_server_completion_progress(
        [(datetime(2026, 1, 5, 9, 0), None)],
        today=datetime(2026, 1, 5, 12, 0),
    )

    assert progress["dates"] == ["2026-01-04", "2026-01-05"]
    assert progress["cumulative"] == [0, 1]
