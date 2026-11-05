# ux_signals.py -- aggregation for the admin "UX Signals" page.
"""Turn ``ux_events`` rows into the few tables an admin actually reads.

Kept separate from :mod:`api` and free of SQL so the arithmetic is testable
without a database. The caller loads the rows for one study and one window; the
report is built from plain dicts.

Everything here is an aggregate. No function returns an individual event or a
``load_id``: the point of the feature is that nobody can look up a person, so
the presentation layer must not offer a way to.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

from .ux_events import (
    ACTIVITY_FORM_CLOSED,
    ACTIVITY_FORM_OPENED,
    API_ERROR,
    CLIENT_ERROR,
    DIARY_BLOCKED,
    SEARCH_NO_RESULT,
    SESSION_STARTED,
)


def _props(row: Dict[str, Any]) -> Dict[str, Any]:
    props = row.get("props")
    return props if isinstance(props, dict) else {}


def _loads(rows: Iterable[Dict[str, Any]]) -> set:
    return {row.get("load_id") for row in rows if row.get("load_id")}


def _rate(numerator: float, denominator: float, per: float = 100.0) -> Optional[float]:
    if not denominator:
        return None
    return round(numerator / denominator * per, 1)


def _share(numerator: float, denominator: float) -> Optional[float]:
    if not denominator:
        return None
    return round(numerator / denominator * 100.0, 1)


def kpis(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """The headline numbers: rates per 100 page loads, and form completion.

    Rates are per *load*, not per participant: there is deliberately no
    participant in the data, and a load is the only denominator available.
    """
    loads = len(_loads(rows))
    opened = [r for r in rows if r["name"] == ACTIVITY_FORM_OPENED]
    closed = [r for r in rows if r["name"] == ACTIVITY_FORM_CLOSED]
    saved = [r for r in closed if _props(r).get("outcome") == "saved"]
    cancelled = [r for r in closed if _props(r).get("outcome") == "cancelled"]
    blocked = [r for r in rows if r["name"] == DIARY_BLOCKED]
    no_result = [r for r in rows if r["name"] == SEARCH_NO_RESULT]
    api_errors = [r for r in rows if r["name"] == API_ERROR]
    client_errors = [r for r in rows if r["name"] == CLIENT_ERROR]

    return {
        "loads": loads,
        "events": len(rows),
        "form_opened": len(opened),
        "form_saved": len(saved),
        "form_cancelled": len(cancelled),
        "form_completion_rate": _share(len(saved), len(saved) + len(cancelled)),
        # An open without a matching close in the same load is someone who left
        # mid-form - the one signal no server-side table can provide.
        "form_unclosed": max(0, len(opened) - len(closed)),
        "blocked": len(blocked),
        "blocked_per_100_loads": _rate(len(blocked), loads),
        "no_result": len(no_result),
        "no_result_per_100_loads": _rate(len(no_result), loads),
        "api_errors_per_100_loads": _rate(len(api_errors), loads),
        "client_errors_per_100_loads": _rate(len(client_errors), loads),
    }


def by_name(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    counts = Counter(row["name"] for row in rows)
    total = sum(counts.values())
    return [
        {"name": name, "count": count, "share": _share(count, total)}
        for name, count in counts.most_common()
    ]


def daily_series(rows: List[Dict[str, Any]], start: date, days: int) -> Dict[str, Any]:
    """Events per day per event name, including days with no events."""
    labels = [start + timedelta(days=offset) for offset in range(days)]
    index = {label: position for position, label in enumerate(labels)}
    per_name: Dict[str, List[int]] = defaultdict(lambda: [0] * days)

    for row in rows:
        occurred = row.get("occurred_at")
        if not isinstance(occurred, datetime):
            continue
        day = (
            occurred.astimezone(timezone.utc).date()
            if occurred.tzinfo
            else occurred.date()
        )
        position = index.get(day)
        if position is None:
            continue
        per_name[row["name"]][position] += 1

    return {
        "labels": [label.isoformat() for label in labels],
        "series": [
            {"name": name, "values": values}
            for name, values in sorted(per_name.items())
        ],
    }


def daily_totals(
    rows: List[Dict[str, Any]], start: date, days: int
) -> List[Dict[str, Any]]:
    """Total events per day, scaled to the busiest day for a bar chart."""
    series = daily_series(rows, start, days)
    totals = (
        [
            sum(values)
            for values in zip(*[entry["values"] for entry in series["series"]])
        ]
        if series["series"]
        else [0] * days
    )
    peak = max(totals) if totals else 0
    return [
        {
            "day": series["labels"][position],
            "count": count,
            "pct": round(count / peak * 100) if peak else 0,
        }
        for position, count in enumerate(totals)
    ]


def blocked_codes(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Which validation rule refused which save - the core "where do they get stuck"."""
    counts: Counter = Counter()
    loads: Dict[str, set] = defaultdict(set)
    for row in rows:
        if row["name"] != DIARY_BLOCKED:
            continue
        props = _props(row)
        codes = props.get("codes")
        if not isinstance(codes, list) or not codes:
            # Still worth counting: a refusal the client could not name is a gap
            # in the client's error mapping.
            counts["(no code reported)"] += 1
            loads["(no code reported)"].add(row.get("load_id"))
            continue
        for code in codes:
            counts[str(code)] += 1
            loads[str(code)].add(row.get("load_id"))

    return [
        {"code": code, "count": count, "loads": len(loads[code])}
        for code, count in counts.most_common()
    ]


def no_result_queries(
    rows: List[Dict[str, Any]], limit: int = 50
) -> List[Dict[str, Any]]:
    """Search terms that matched nothing - the alias shortlist for study authors."""
    counts: Counter = Counter()
    loads: Dict[str, set] = defaultdict(set)
    for row in rows:
        if row["name"] != SEARCH_NO_RESULT:
            continue
        query = _props(row).get("query")
        if not isinstance(query, str) or not query:
            continue
        counts[query] += 1
        loads[query].add(row.get("load_id"))

    return [
        {"query": query, "count": count, "loads": len(loads[query])}
        for query, count in counts.most_common(limit)
    ]


def api_errors(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    counts: Counter = Counter()
    for row in rows:
        if row["name"] != API_ERROR:
            continue
        props = _props(row)
        counts[
            (
                str(props.get("method") or "?"),
                str(props.get("route") or "?"),
                props.get("status") if isinstance(props.get("status"), int) else None,
                str(props.get("code") or ""),
            )
        ] += 1
    return [
        {
            "method": method,
            "route": route,
            "status": status,
            "code": code,
            "count": count,
        }
        for (method, route, status, code), count in counts.most_common(25)
    ]


def client_errors(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    counts: Counter = Counter()
    for row in rows:
        if row["name"] != CLIENT_ERROR:
            continue
        props = _props(row)
        counts[
            (
                str(props.get("kind") or "?"),
                str(props.get("name") or "?"),
                str(props.get("source") or "?"),
                props.get("line") if isinstance(props.get("line"), int) else None,
            )
        ] += 1
    return [
        {"kind": kind, "name": name, "source": source, "line": line, "count": count}
        for (kind, name, source, line), count in counts.most_common(25)
    ]


def form_by_source(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Where an activity entry started, and how it ended."""
    opened: Counter = Counter()
    saved: Counter = Counter()
    cancelled: Counter = Counter()
    for row in rows:
        source = str(_props(row).get("source") or "(unknown)")
        if row["name"] == ACTIVITY_FORM_OPENED:
            opened[source] += 1
        elif row["name"] == ACTIVITY_FORM_CLOSED:
            outcome = _props(row).get("outcome")
            if outcome == "saved":
                saved[source] += 1
            elif outcome == "cancelled":
                cancelled[source] += 1

    return [
        {
            "source": source,
            "opened": opened[source],
            "saved": saved[source],
            "cancelled": cancelled[source],
            "unclosed": max(0, opened[source] - saved[source] - cancelled[source]),
        }
        for source in sorted(opened, key=lambda key: -opened[key])
    ]


def context_breakdown(rows: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """Coarse client context: language, viewport class, app version."""

    def counts_for(key: str, source: str) -> List[Dict[str, Any]]:
        counts = Counter(
            str(value)
            for row in rows
            if row["name"] == source
            for value in [_props(row).get(key)]
            if value
        )
        total = sum(counts.values())
        return [
            {"value": value, "count": count, "share": _share(count, total)}
            for value, count in counts.most_common(10)
        ]

    return {
        "language": [
            {"value": value, "count": count, "share": None}
            for value, count in Counter(
                row.get("language") for row in rows if row.get("language")
            ).most_common(10)
        ],
        "viewport": counts_for("viewport_class", SESSION_STARTED),
        "app_version": [
            {"value": value, "count": count, "share": None}
            for value, count in Counter(
                row.get("app_version") for row in rows if row.get("app_version")
            ).most_common(10)
        ],
    }


def build_report(rows: List[Dict[str, Any]], start: date, days: int) -> Dict[str, Any]:
    """Everything the template renders for one study and one window."""
    return {
        "start": start.isoformat(),
        "days": days,
        "kpis": kpis(rows),
        "by_name": by_name(rows),
        "daily": daily_series(rows, start, days),
        "daily_totals": daily_totals(rows, start, days),
        "blocked_codes": blocked_codes(rows),
        "no_result_queries": no_result_queries(rows),
        "api_errors": api_errors(rows),
        "client_errors": client_errors(rows),
        "form_by_source": form_by_source(rows),
        "context": context_breakdown(rows),
    }


def delta_pct(
    current: Dict[str, Any], previous: Dict[str, Any], key: str
) -> Optional[float]:
    """Percent change of a KPI, or ``None`` when there is no comparison."""
    now = current.get(key)
    before = previous.get(key)
    if not isinstance(now, (int, float)) or not isinstance(before, (int, float)):
        return None
    if before == 0:
        return None
    return round((now - before) / before * 100.0, 1)
