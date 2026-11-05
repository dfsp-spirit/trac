"""Unit tests for the UX-signal aggregate report."""

import json
from datetime import date, datetime, timedelta, timezone

from o_timeusediary_backend import ux_signals as us

NOW = datetime(2026, 11, 5, 12, 0, tzinfo=timezone.utc)


def row(event, load="load-1", **props):
    return {
        "load_id": load,
        "name": event,
        "occurred_at": NOW,
        "received_at": NOW,
        "language": "de",
        "app_version": "0.25.0",
        "props": props or None,
    }


def sample_rows():
    return [
        row(
            "session.started",
            "a",
            stage="diary",
            viewport_class="phone",
            catalogue_version="3",
        ),
        row("activity.form.opened", "a", source="search"),
        row("activity.form.closed", "a", source="search", outcome="saved"),
        row("activity.form.opened", "a", source="catalogue"),
        row("activity.form.closed", "a", source="catalogue", outcome="cancelled"),
        row("activity.form.opened", "a", source="recent"),
        row("search.no_result", "a", query="fruhstuck"),
        row("search.no_result", "b", query="fruhstuck"),
        row("search.no_result", "b", query="kaffee"),
        row("diary.blocked", "a", stage="day_submit", codes=["overlap.limit_reached"]),
        row(
            "diary.blocked",
            "b",
            stage="study_submit",
            codes=["overlap.limit_reached", "day.ends_at_midnight"],
        ),
        row("diary.blocked", "b", stage="study_submit"),
        row(
            "api.error",
            "b",
            method="POST",
            route="/api/x/participants/:pid/activities",
            status=409,
            code="activity.duplicate",
        ),
        row(
            "client.error",
            "b",
            kind="js",
            name="TypeError",
            source="panelController.js",
            line=42,
        ),
    ]


def test_kpis_use_loads_as_the_denominator():
    kpis = us.kpis(sample_rows())
    assert kpis["loads"] == 2
    assert kpis["events"] == 14
    # 1 save, 1 cancel -> 50 %
    assert kpis["form_completion_rate"] == 50.0
    # 3 opens, 2 closes -> one participant left mid-form
    assert kpis["form_unclosed"] == 1
    assert kpis["blocked"] == 3
    assert kpis["blocked_per_100_loads"] == 150.0
    assert kpis["no_result_per_100_loads"] == 150.0
    assert kpis["client_errors_per_100_loads"] == 50.0


def test_kpis_avoid_dividing_by_zero():
    kpis = us.kpis([])
    assert kpis["loads"] == 0
    assert kpis["form_completion_rate"] is None
    assert kpis["blocked_per_100_loads"] is None


def test_by_name_counts_and_shares():
    counts = us.by_name(sample_rows())
    top = counts[0]
    assert top["name"] == "activity.form.opened"
    assert top["count"] == 3
    assert top["share"] == round(3 / 14 * 100, 1)


def test_daily_totals_include_empty_days_and_scale_to_the_peak():
    start = date(2026, 10, 30)
    totals = us.daily_totals(sample_rows(), start, 7)
    assert [entry["day"] for entry in totals] == [
        (start + timedelta(days=offset)).isoformat() for offset in range(7)
    ]
    assert sum(entry["count"] for entry in totals) == 14
    assert max(entry["pct"] for entry in totals) == 100
    empty = us.daily_totals([], start, 3)
    assert [entry["count"] for entry in empty] == [0, 0, 0]
    assert [entry["pct"] for entry in empty] == [0, 0, 0]


def test_blocked_codes_rank_the_rules_and_count_affected_loads():
    codes = us.blocked_codes(sample_rows())
    assert codes[0] == {"code": "overlap.limit_reached", "count": 2, "loads": 2}
    assert {entry["code"] for entry in codes} == {
        "overlap.limit_reached",
        "day.ends_at_midnight",
        "(no code reported)",
    }


def test_no_result_queries_are_ranked():
    queries = us.no_result_queries(sample_rows())
    assert queries[0] == {"query": "fruhstuck", "count": 2, "loads": 2}
    assert queries[1]["query"] == "kaffee"


def test_api_errors_group_by_method_route_status_code():
    errors = us.api_errors(sample_rows())
    assert len(errors) == 1
    assert errors[0]["route"].endswith("/participants/:pid/activities")
    assert errors[0]["status"] == 409


def test_form_by_source_shows_where_entries_start_and_how_they_end():
    sources = {entry["source"]: entry for entry in us.form_by_source(sample_rows())}
    assert sources["search"]["saved"] == 1
    assert sources["catalogue"]["cancelled"] == 1
    assert sources["recent"]["unclosed"] == 1
    assert sources["search"]["unclosed"] == 0


def test_report_never_exposes_a_load_id():
    report = us.build_report(sample_rows(), start=date(2026, 11, 1), days=7)
    assert '"load_id"' not in json.dumps(report)
    assert "load-1" not in json.dumps(report)


def test_delta_pct_handles_missing_and_zero_baselines():
    assert us.delta_pct({"x": 12}, {"x": 10}, "x") == 20.0
    assert us.delta_pct({"x": 12}, {"x": 0}, "x") is None
    assert us.delta_pct({"x": None}, {"x": 10}, "x") is None
    assert us.delta_pct({}, {}, "x") is None
