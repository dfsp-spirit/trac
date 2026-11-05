"""Unit tests for the usability-signal allow-list.

These are the tests that make the privacy claim checkable: a row may only ever
hold an allow-listed event name, allow-listed property keys and bounded values,
no matter what the client sends.
"""

from datetime import datetime, timedelta, timezone

import pytest

from o_timeusediary_backend import ux_events as ux


NOW = datetime(2026, 11, 5, 12, 0, tzinfo=timezone.utc)
LOAD_ID = "3f2b8c1e-9a4d-4f7b-8c2e-1d5a6b7c8d90"


def batch(events, **overrides):
    body = {
        "load_id": LOAD_ID,
        "app_version": "0.25.0",
        "language": "de",
        "events": events,
    }
    body.update(overrides)
    return body


# ---------------------------------------------------------------------------
# Event cleaning
# ---------------------------------------------------------------------------


def test_keeps_allow_listed_event_with_its_props():
    event = ux.clean_event(
        {
            "name": "activity.form.closed",
            "ts": NOW.isoformat(),
            "props": {
                "outcome": "saved",
                "source": "search",
                "is_custom_input": False,
                "duration_bucket": "10to30s",
                "had_child_choice": True,
            },
        },
        now=NOW,
    )
    assert event["name"] == "activity.form.closed"
    assert event["occurred_at"] == NOW
    assert event["props"]["outcome"] == "saved"
    assert event["props"]["is_custom_input"] is False


def test_unknown_event_name_is_rejected():
    with pytest.raises(ux.EventRejected):
        ux.clean_event({"name": "participant.favourite_color"}, now=NOW)


def test_unknown_props_are_dropped_so_free_text_cannot_ride_along():
    event = ux.clean_event(
        {
            "name": "activity.form.opened",
            "props": {
                "source": "catalogue",
                "note": "met Anna at breakfast",
                "activity_code": 1101,
            },
        },
        now=NOW,
    )
    assert event["props"] == {"source": "catalogue"}


def test_enum_prop_with_free_text_is_dropped():
    event = ux.clean_event(
        {"name": "activity.form.opened", "props": {"source": "my own words"}}, now=NOW
    )
    assert event["props"] is None


def test_activity_codes_are_not_part_of_any_property():
    for props in ux.EVENT_PROPS.values():
        assert "activity_code" not in props
        assert "parent_activity_code" not in props


def test_search_query_is_folded_and_capped():
    event = ux.clean_event(
        {"name": "search.no_result", "props": {"query": "  FRÜHSTÜCK   mit Ärger  "}},
        now=NOW,
    )
    assert event["props"]["query"] == "fruhstuck mit arger"

    long_query = ux.clean_event(
        {"name": "search.no_result", "props": {"query": "x" * 500}}, now=NOW
    )
    assert len(long_query["props"]["query"]) == ux.MAX_QUERY_CHARS


def test_empty_query_is_dropped():
    event = ux.clean_event(
        {"name": "search.no_result", "props": {"query": "   "}}, now=NOW
    )
    assert event["props"] is None


def test_blocked_codes_are_deduped_and_capped():
    codes = ["overlap.limit_reached", "overlap.limit_reached"] + [
        f"code.{i}" for i in range(10)
    ]
    event = ux.clean_event(
        {"name": "diary.blocked", "props": {"stage": "day_submit", "codes": codes}},
        now=NOW,
    )
    assert event["props"]["stage"] == "day_submit"
    assert len(event["props"]["codes"]) == ux.MAX_LIST_ITEMS
    assert event["props"]["codes"][0] == "overlap.limit_reached"


def test_refusal_stage_is_accepted_but_a_page_stage_is_too():
    for stage in (
        "day_submit",
        "study_submit",
        "activity_save",
        "multi_day",
        "diary",
        "review",
    ):
        event = ux.clean_event(
            {"name": "diary.blocked", "props": {"stage": stage}}, now=NOW
        )
        assert event["props"]["stage"] == stage
    unknown = ux.clean_event(
        {"name": "diary.blocked", "props": {"stage": "day 3"}}, now=NOW
    )
    assert unknown["props"] is None


def test_api_error_route_cannot_carry_a_participant_id():
    event = ux.clean_event(
        {
            "name": "api.error",
            "props": {
                "method": "POST",
                "route": "/api/studies/pilot/participants/bernddasbrot/activities?x=1",
                "status": 409,
                "code": "activity.duplicate",
            },
        },
        now=NOW,
    )
    assert event["props"]["route"] == "/api/studies/pilot/participants/:pid/activities"
    assert event["props"]["status"] == 409


def test_status_must_be_a_plausible_http_status():
    event = ux.clean_event(
        {"name": "api.error", "props": {"method": "GET", "status": 9999}}, now=NOW
    )
    assert event["props"] == {"method": "GET"}


def test_implausible_or_missing_timestamp_falls_back_to_server_time():
    assert ux.clean_event({"name": "session.started"}, now=NOW)["occurred_at"] is None
    old = (NOW - timedelta(days=3)).isoformat()
    assert (
        ux.clean_event({"name": "session.started", "ts": old}, now=NOW)["occurred_at"]
        is None
    )
    assert (
        ux.clean_event({"name": "session.started", "ts": "not a date"}, now=NOW)[
            "occurred_at"
        ]
        is None
    )


def test_no_event_can_exceed_the_property_size_cap():
    # The per-value caps bound every event below MAX_PROPS_BYTES, so a client
    # cannot use one property to smuggle an essay in.
    import json

    for name, keys in ux.EVENT_PROPS.items():
        props = {key: "x" * 512 for key in keys}
        event = ux.clean_event({"name": name, "props": props}, now=NOW)
        size = len(
            json.dumps(event["props"] or {}, separators=(",", ":")).encode("utf-8")
        )
        assert size <= ux.MAX_PROPS_BYTES, name


# ---------------------------------------------------------------------------
# Batch cleaning
# ---------------------------------------------------------------------------


def test_batch_accepts_a_canonical_uuid_load_id():
    load_id, context, events = ux.clean_batch(
        batch([{"name": "session.started"}]), now=NOW
    )
    assert load_id == LOAD_ID
    assert context == {"language": "de", "app_version": "0.25.0"}
    assert len(events) == 1


@pytest.mark.parametrize(
    "load_id",
    [
        "bernddasbrot",
        "",
        "3f2b8c1e-9a4d-4f7b-8c2e-1d5a6b7c8d9",
        "3f2b8c1e9a4d4f7b8c2e1d5a6b7c8d90",
        "not a uuid at all!!",
    ],
)
def test_batch_rejects_a_load_id_that_is_not_a_uuid(load_id):
    with pytest.raises(ux.EventRejected):
        ux.clean_batch(batch([{"name": "session.started"}], load_id=load_id), now=NOW)


def test_batch_rejects_empty_and_oversized_batches():
    with pytest.raises(ux.EventRejected):
        ux.clean_batch(batch([]), now=NOW)
    too_many = [{"name": "session.started"}] * (ux.MAX_EVENTS_PER_BATCH + 1)
    with pytest.raises(ux.EventRejected):
        ux.clean_batch(batch(too_many), now=NOW)


def test_batch_does_not_reject_single_bad_events():
    # One unusable event must not cost the whole batch: the endpoint counts it
    # as dropped and stores the rest.
    _, _, events = ux.clean_batch(
        batch([{"name": "session.started"}, {"name": "nope"}, "junk"]), now=NOW
    )
    assert len(events) == 3


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------


def test_rate_limiter_caps_events_per_load():
    limiter = ux.LoadRateLimiter(limit=10)
    assert limiter.allow("study:load", 8, now=NOW)
    assert not limiter.allow("study:load", 5, now=NOW)
    assert limiter.allow("study:load", 2, now=NOW)


def test_rate_limiter_window_expires():
    limiter = ux.LoadRateLimiter(limit=3)
    assert limiter.allow("k", 3, now=NOW)
    assert not limiter.allow("k", 1, now=NOW)
    assert limiter.allow("k", 1, now=NOW + timedelta(hours=1, seconds=1))
