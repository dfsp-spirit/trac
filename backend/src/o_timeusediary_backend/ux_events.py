# ux_events.py -- allow-list and validation for the unlinked usability signals.
"""Server-side rules for the ``ux_events`` table.

The client is not trusted to decide what a row may contain, because the whole
value of this feature rests on the rows staying unlinkable: an event that
carried a participant id, a raw path with a pid in it, or an activity code could
be joined back to a person (and to the diary) by anyone with database access.

So everything is filtered here, against a fixed catalogue:

* only the event names in :data:`EVENT_PROPS` are stored; anything else is
  dropped, which keeps the vocabulary small enough to read on a dashboard;
* properties are filtered down to the allow-listed keys of that event, and
  enumerated properties must match a known value - an unexpected string is
  dropped rather than stored as free text;
* values are bounded (string length, list length, integer range), so one row
  cannot hold a participant's own words beyond a search term;
* ``api.error`` routes are templated defensively: the server rewrites the path
  so a participant id cannot survive in the property.

Nothing in here is DBMS-specific.
"""

from __future__ import annotations

import json
import re
import threading
import unicodedata
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Any, Deque, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Event catalogue
# ---------------------------------------------------------------------------

SESSION_STARTED = "session.started"
ACTIVITY_FORM_OPENED = "activity.form.opened"
ACTIVITY_FORM_CLOSED = "activity.form.closed"
DIARY_BLOCKED = "diary.blocked"
SEARCH_NO_RESULT = "search.no_result"
API_ERROR = "api.error"
CLIENT_ERROR = "client.error"

#: Event name -> allowed property keys. This is the complete vocabulary; add a
#: name here only together with the dashboard table that reads it.
EVENT_PROPS: Dict[str, Tuple[str, ...]] = {
    SESSION_STARTED: ("stage", "viewport_class"),
    ACTIVITY_FORM_OPENED: ("source", "is_custom_input"),
    ACTIVITY_FORM_CLOSED: (
        "outcome",
        "source",
        "is_custom_input",
        "duration_bucket",
        "had_child_choice",
    ),
    DIARY_BLOCKED: ("stage", "codes"),
    SEARCH_NO_RESULT: ("query",),
    API_ERROR: ("method", "route", "status", "code"),
    CLIENT_ERROR: ("kind", "name", "source", "line"),
}

#: Closed value sets for properties that must never become free text.
ENUM_PROPS: Dict[str, Tuple[str, ...]] = {
    "stage": ("consent", "instructions", "diary", "review", "done", "task"),
    "viewport_class": ("phone", "tablet", "desktop"),
    "source": ("search", "catalogue", "recent", "custom", "edit"),
    "outcome": ("saved", "cancelled", "deleted"),
    "duration_bucket": ("lt10s", "10to30s", "30to60s", "1to3m", "gt3m"),
    "kind": ("js", "promise"),
    "method": ("GET", "POST", "PATCH", "PUT", "DELETE"),
}

#: Event names that may carry the (only) free-text property.
QUERY_PROP = "query"

MAX_EVENTS_PER_BATCH = 20
MAX_PROPS_BYTES = 512
MAX_BODY_BYTES = 32 * 1024
MAX_EVENTS_PER_LOAD_PER_HOUR = 200
MAX_QUERY_CHARS = 48
MAX_STRING_CHARS = 64
MAX_LIST_ITEMS = 6
MAX_LOAD_ID_CHARS = 36
MAX_LANGUAGE_CHARS = 8
MAX_APP_VERSION_CHARS = 32
#: A client clock this far off wall time is not trusted; `received_at` wins.
MAX_CLOCK_SKEW = timedelta(hours=24)

_STAGE_CODES = (
    "activity_save",
    "multi_day",
    "nudge",
    "day_submit",
    "study_submit",
)


class EventRejected(ValueError):
    """The event cannot be stored at all (as opposed to a dropped property)."""


# ---------------------------------------------------------------------------
# Field cleaning
# ---------------------------------------------------------------------------


def fold_query(value: Any) -> Optional[str]:
    """Fold a search term the way the client does: case, accents, ``ß``.

    Done again on the server so the admin table groups identical terms even when
    an older client sent an unfolded query.
    """
    if not isinstance(value, str):
        return None
    text = unicodedata.normalize("NFKD", value)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace("ß", "ss").replace("\u1e9e", "SS").lower()
    text = " ".join(text.split())
    if not text:
        return None
    return text[:MAX_QUERY_CHARS]


def clean_text(value: Any, max_chars: int = MAX_STRING_CHARS) -> Optional[str]:
    """Trimmed, control-character-free string, or ``None`` when unusable."""
    if not isinstance(value, str):
        return None
    text = "".join(ch for ch in value if ch.isprintable()).strip()
    if not text:
        return None
    return text[:max_chars]


def clean_route(value: Any) -> Optional[str]:
    """A route template that cannot carry a participant id.

    The client is supposed to send ``/api/studies/{s}/participants/:pid/...``,
    but a mistake (or a debug build) must not be able to park a real pid in the
    admin dashboard, so anything after ``/participants/`` is replaced.
    """
    route = clean_text(value, 96)
    if route is None:
        return None
    route = re.sub(r"/participants/[^/?]+", "/participants/:pid", route)
    route = re.sub(r"\?.*$", "", route)
    return route


def clean_codes(value: Any) -> Optional[List[str]]:
    """A short list of stable machine codes (validation or API error codes)."""
    if not isinstance(value, list):
        return None
    codes: List[str] = []
    # Scan more than we keep so duplicates in the head do not shrink the list.
    for item in value[: MAX_LIST_ITEMS * 4]:
        code = clean_text(item, 48)
        if code is not None and code not in codes:
            codes.append(code)
        if len(codes) == MAX_LIST_ITEMS:
            break
    return codes or None


def _clean_prop(key: str, value: Any) -> Tuple[bool, Any]:
    """Return ``(keep, value)`` for one allow-listed property."""
    if key == QUERY_PROP:
        folded = fold_query(value)
        return (folded is not None, folded)
    if key == "codes":
        codes = clean_codes(value)
        return (codes is not None, codes)
    if key == "route":
        route = clean_route(value)
        return (route is not None, route)
    if key == "stage":
        text = clean_text(value, 32)
        # Two shapes share the key: the page stage and the refusal stage.
        keep = text is not None and (
            text in ENUM_PROPS["stage"] or text in _STAGE_CODES
        )
        return (keep, text)
    if key == "status":
        return (isinstance(value, int) and 100 <= value <= 599, value)
    if key == "line":
        return (isinstance(value, int) and 0 <= value <= 10_000_000, value)
    if key in ENUM_PROPS:
        text = clean_text(value, 32)
        return (text is not None and text in ENUM_PROPS[key], text)
    if isinstance(value, bool):
        return (True, value)
    text = clean_text(value)
    return (text is not None, text)


def _parse_occurred_at(value: Any, now: datetime) -> Optional[datetime]:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    if abs(now - parsed) > MAX_CLOCK_SKEW:
        return None
    return parsed


def clean_event(raw: Any, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Validate one event from the request body.

    @param raw One entry of the client's ``events`` array.
    @param now Reference time for plausibility checks (injectable for tests).
    @returns ``{"name": str, "occurred_at": datetime | None, "props": dict | None}``
    @raises EventRejected When the name is unknown or the shape is unusable.
    """
    now = now or datetime.now(timezone.utc)
    if not isinstance(raw, dict):
        raise EventRejected("event is not an object")

    name = raw.get("name")
    if not isinstance(name, str) or name not in EVENT_PROPS:
        raise EventRejected("unknown event name")

    props: Dict[str, Any] = {}
    raw_props = raw.get("props")
    if isinstance(raw_props, dict):
        for key in EVENT_PROPS[name]:
            if key not in raw_props:
                continue
            keep, value = _clean_prop(key, raw_props[key])
            if keep:
                props[key] = value

    if (
        props
        and len(json.dumps(props, separators=(",", ":")).encode("utf-8"))
        > MAX_PROPS_BYTES
    ):
        raise EventRejected("properties too large")

    return {
        "name": name,
        "occurred_at": _parse_occurred_at(raw.get("ts"), now),
        "props": props or None,
    }


def clean_batch(
    body: Any, now: Optional[datetime] = None
) -> Tuple[str, Optional[dict], List[Dict[str, Any]]]:
    """Validate a whole request body.

    @param body Parsed JSON body.
    @param now Reference time for plausibility checks.
    @returns ``(load_id, context, events)`` where ``context`` holds the
        batch-level ``language``/``app_version`` that at least one event needs.
    @raises EventRejected When the batch itself is unusable (not when single
        events are rejected - those are counted and skipped by the caller).
    """
    if not isinstance(body, dict):
        raise EventRejected("body is not an object")

    load_id = clean_text(body.get("load_id"), MAX_LOAD_ID_CHARS)
    # A canonical UUID only: a participant id must not be able to pass as a
    # load id, even from a doctored client.
    if load_id is None or not re.fullmatch(
        r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
        load_id,
    ):
        raise EventRejected("missing or malformed load_id")

    events = body.get("events")
    if not isinstance(events, list) or not events:
        raise EventRejected("events must be a non-empty list")
    if len(events) > MAX_EVENTS_PER_BATCH:
        raise EventRejected("too many events in one batch")

    context = {
        "language": clean_text(body.get("language"), MAX_LANGUAGE_CHARS),
        "app_version": clean_text(body.get("app_version"), MAX_APP_VERSION_CHARS),
    }
    return load_id, context, events


def summary_counts(events: List[Dict[str, Any]]) -> Dict[str, int]:
    """Count by event name, for the response body (never shown to participants)."""
    counts: Dict[str, int] = defaultdict(int)
    for event in events:
        counts[event["name"]] += 1
    return dict(counts)


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------


class LoadRateLimiter:
    """A per-process ceiling on events from one ``load_id``.

    In-memory on purpose: a persisted counter would be a per-client identifier,
    which is exactly what this feature avoids. The consequence is a per-worker
    limit, which is fine for its actual job - stopping a runaway client loop
    from filling the table.
    """

    def __init__(
        self,
        limit: int = MAX_EVENTS_PER_LOAD_PER_HOUR,
        window: timedelta = timedelta(hours=1),
        max_keys: int = 5000,
    ) -> None:
        self._limit = limit
        self._window = window
        self._max_keys = max_keys
        self._hits: Dict[str, Deque[datetime]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str, amount: int, now: Optional[datetime] = None) -> bool:
        """Reserve ``amount`` events for ``key``; ``False`` when over the limit."""
        now = now or datetime.now(timezone.utc)
        cutoff = now - self._window
        with self._lock:
            if key not in self._hits and len(self._hits) >= self._max_keys:
                # Drop the oldest key instead of growing without bound.
                self._hits.pop(next(iter(self._hits)), None)
            hits = self._hits.setdefault(key, deque())
            while hits and hits[0] < cutoff:
                hits.popleft()
            if len(hits) + amount > self._limit:
                return False
            hits.extend([now] * amount)
            return True

    def reset(self) -> None:
        """Forget all counters (tests)."""
        with self._lock:
            self._hits.clear()
