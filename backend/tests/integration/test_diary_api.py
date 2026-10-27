"""Integration tests for the incremental diary API (D18, D19, D27).

These exercise the endpoints a participant's browser actually calls, against a
real database and a running backend. The rules themselves are unit-tested in
tests/unit/test_coverage.py; what is pinned here is the contract: status codes,
per-target outcomes for a multi-day create, idempotent retries, the submitted
lock, and the fact that the old whole-day endpoint still writes rows the new one
can read (D25).
"""

import os
import uuid

import httpx
import pytest

from o_timeusediary_backend.settings import settings


BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.strip("/")
ADMIN_AUTH = (settings.admin_username, settings.admin_password)

DAY_NAMES = ["monday", "tuesday", "wednesday"]


def _activities_config(max_overlap: int = 2, min_coverage: int = 0) -> dict:
    return {
        "general": {"app_name": "TRAC", "version": "1.0", "language": "en"},
        "timeline": {
            "primary": {
                "name": "Primary",
                "description": "",
                "mode": "single-choice",
                "min_coverage": min_coverage,
                "max_overlap": max_overlap,
                "categories": [
                    {
                        "name": "General",
                        "activities": [
                            {
                                "name": f"Activity {code}",
                                "code": code,
                                "label": f"activity-{code}",
                                "color": "#000000",
                                "childItems": [],
                            }
                            for code in (100, 101, 102)
                        ],
                    }
                ],
            }
        },
    }


async def _create_study(
    client: httpx.AsyncClient, *, max_overlap: int = 2, min_coverage: int = 0
) -> str:
    study_name_short = f"it_diary_{uuid.uuid4().hex[:8]}"
    payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"Diary API {study_name_short}",
                "name_short": study_name_short,
                "description": "Integration test - incremental diary API",
                "day_labels": [
                    {
                        "name": name,
                        "display_order": index,
                        "display_names": {"en": name.title()},
                    }
                    for index, name in enumerate(DAY_NAMES)
                ],
                "study_participant_ids": [],
                # Open study: a participant exists as soon as they save.
                "allow_unlisted_participants": True,
                "default_language": "en",
                "supported_languages": ["en"],
                "activities_json_data": {
                    "en": _activities_config(max_overlap, min_coverage)
                },
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ],
    }
    response = await client.post(
        f"{BASE_URL}/api/admin/studies/import-config",
        json=payload,
        auth=ADMIN_AUTH,
    )
    assert response.status_code == 200, response.text
    return study_name_short


def _url(study: str, participant: str, suffix: str = "") -> str:
    return f"{BASE_URL}/api/studies/{study}/participants/{participant}{suffix}"


def _item(
    *,
    code: int = 100,
    start: int = 480,
    end: int = 600,
    days=(0,),
    client_uuid: str | None = None,
) -> dict:
    return {
        "client_uuid": client_uuid or str(uuid.uuid4()),
        "activity_code": code,
        "activity_name": f"Activity {code}",
        "category": "General",
        "start_minutes": start,
        "end_minutes": end,
        "day_label_indexes": list(days),
    }


async def _diary(client: httpx.AsyncClient, study: str, participant: str) -> dict:
    response = await client.get(_url(study, participant, "/diary"))
    assert response.status_code == 200, response.text
    return response.json()


def _activities_by_day(diary: dict) -> dict:
    grouped = {}
    for activity in diary["activities"]:
        grouped.setdefault(activity["day_label_index"], []).append(activity)
    return grouped


@pytest.mark.asyncio
async def test_empty_diary_lists_the_days_and_nothing_else():
    participant = f"p_{uuid.uuid4().hex[:6]}"
    async with httpx.AsyncClient() as client:
        study = await _create_study(client)
        diary = await _diary(client, study, participant)

    assert diary["schema_version"] == 1
    assert [day["index"] for day in diary["days"]] == [0, 1, 2]
    assert all(day["has_data"] is False for day in diary["days"])
    assert all(day["coverage_minutes"] == 0 for day in diary["days"])
    assert diary["activities"] == []
    assert diary["timeline"]["max_overlap"] == 2
    assert diary["study"]["submitted_at"] is None


@pytest.mark.asyncio
async def test_creating_one_activity_and_reading_it_back():
    participant = f"p_{uuid.uuid4().hex[:6]}"
    async with httpx.AsyncClient() as client:
        study = await _create_study(client)
        response = await client.post(
            _url(study, participant, "/activities"),
            json={"items": [_item(start=480, end=600)]},
        )
        assert response.status_code == 201, response.text
        created = response.json()
        assert created["created"] == 1
        assert created["results"][0]["status"] == "added"

        diary = await _diary(client, study, participant)

    assert len(diary["activities"]) == 1
    activity = diary["activities"][0]
    assert activity["start_minutes"] == 480
    assert activity["end_minutes"] == 600
    assert activity["day_label_index"] == 0
    assert diary["days"][0]["has_data"] is True
    assert diary["days"][0]["coverage_minutes"] == 120


@pytest.mark.asyncio
async def test_a_retried_create_does_not_duplicate_the_row():
    participant = f"p_{uuid.uuid4().hex[:6]}"
    item = _item()
    async with httpx.AsyncClient() as client:
        study = await _create_study(client)
        first = await client.post(
            _url(study, participant, "/activities"), json={"items": [item]}
        )
        second = await client.post(
            _url(study, participant, "/activities"), json={"items": [item]}
        )
        assert first.status_code == 201, first.text
        assert second.status_code == 201, second.text
        assert second.json()["created"] == 0
        assert second.json()["results"][0]["existing"] is True

        diary = await _diary(client, study, participant)

    assert len(diary["activities"]) == 1


@pytest.mark.asyncio
async def test_multi_day_create_shares_one_group_and_reports_each_day():
    participant = f"p_{uuid.uuid4().hex[:6]}"
    async with httpx.AsyncClient() as client:
        study = await _create_study(client)
        response = await client.post(
            _url(study, participant, "/activities"),
            json={"items": [_item(days=[0, 1, 2])]},
        )
        assert response.status_code == 201, response.text
        body = response.json()

        diary = await _diary(client, study, participant)

    assert body["created"] == 3
    assert [result["status"] for result in body["results"]] == [
        "added",
        "added",
        "added",
    ]
    assert len({activity["group_id"] for activity in diary["activities"]}) == 1
    assert sorted(_activities_by_day(diary)) == [0, 1, 2]


@pytest.mark.asyncio
async def test_a_duplicate_slot_is_skipped_not_created():
    participant = f"p_{uuid.uuid4().hex[:6]}"
    async with httpx.AsyncClient() as client:
        study = await _create_study(client)
        await client.post(
            _url(study, participant, "/activities"),
            json={"items": [_item(code=100, start=480, end=600)]},
        )
        response = await client.post(
            _url(study, participant, "/activities"),
            json={"items": [_item(code=100, start=480, end=600)]},
        )
        body = response.json()

    assert body["created"] == 0
    assert body["results"][0]["status"] == "skipped"
    assert body["results"][0]["code"] == "activity.duplicate"


@pytest.mark.asyncio
async def test_the_overlap_limit_is_enforced_per_minute():
    participant = f"p_{uuid.uuid4().hex[:6]}"
    async with httpx.AsyncClient() as client:
        study = await _create_study(client)
        await client.post(
            _url(study, participant, "/activities"),
            json={"items": [_item(code=100, start=480, end=600)]},
        )
        await client.post(
            _url(study, participant, "/activities"),
            json={"items": [_item(code=101, start=480, end=600)]},
        )
        third = await client.post(
            _url(study, participant, "/activities"),
            json={"items": [_item(code=102, start=480, end=600)]},
        )
        body = third.json()

    assert body["created"] == 0
    assert body["results"][0]["code"] == "overlap.limit_reached"
    assert body["results"][0]["max_overlap"] == 2


@pytest.mark.asyncio
async def test_a_study_can_raise_its_overlap_limit():
    participant = f"p_{uuid.uuid4().hex[:6]}"
    async with httpx.AsyncClient() as client:
        study = await _create_study(client, max_overlap=3)
        for code in (100, 101, 102):
            response = await client.post(
                _url(study, participant, "/activities"),
                json={"items": [_item(code=code, start=480, end=600)]},
            )
            assert response.status_code == 201, response.text
            assert response.json()["created"] == 1

        diary = await _diary(client, study, participant)

    assert len(diary["activities"]) == 3
    assert diary["timeline"]["max_overlap"] == 3


@pytest.mark.asyncio
async def test_an_activity_may_not_run_into_the_last_midnight():
    participant = f"p_{uuid.uuid4().hex[:6]}"
    async with httpx.AsyncClient() as client:
        study = await _create_study(client)
        response = await client.post(
            _url(study, participant, "/activities"),
            json={"items": [_item(start=1320, end=1920, days=[2])]},
        )
        body = response.json()

    assert body["created"] == 0
    assert body["results"][0]["code"] == "day.ends_at_midnight"


@pytest.mark.asyncio
async def test_coverage_is_a_union_so_parallel_activities_count_once():
    participant = f"p_{uuid.uuid4().hex[:6]}"
    async with httpx.AsyncClient() as client:
        study = await _create_study(client)
        await client.post(
            _url(study, participant, "/activities"),
            json={"items": [_item(code=100, start=480, end=660)]},
        )
        await client.post(
            _url(study, participant, "/activities"),
            json={"items": [_item(code=101, start=540, end=720)]},
        )
        diary = await _diary(client, study, participant)

    # 08:00-11:00 and 09:00-12:00 cover 08:00-12:00 once.
    assert diary["days"][0]["coverage_minutes"] == 240


@pytest.mark.asyncio
async def test_a_cross_midnight_activity_covers_both_days():
    participant = f"p_{uuid.uuid4().hex[:6]}"
    async with httpx.AsyncClient() as client:
        study = await _create_study(client)
        await client.post(
            _url(study, participant, "/activities"),
            json={"items": [_item(start=1320, end=1920, days=[0])]},
        )
        diary = await _diary(client, study, participant)

    assert diary["days"][0]["coverage_minutes"] == 120, "22:00 to midnight"
    assert diary["days"][1]["coverage_minutes"] == 480, "midnight to 08:00"


@pytest.mark.asyncio
async def test_patch_moves_an_activity_to_another_day():
    participant = f"p_{uuid.uuid4().hex[:6]}"
    item = _item(days=[0])
    async with httpx.AsyncClient() as client:
        study = await _create_study(client)
        created = await client.post(
            _url(study, participant, "/activities"), json={"items": [item]}
        )
        client_uuid = created.json()["activities"][0]["client_uuid"]

        response = await client.patch(
            _url(study, participant, f"/activities/{client_uuid}"),
            json={"day_label_index": 1, "start_minutes": 600, "end_minutes": 660},
        )
        assert response.status_code == 200, response.text
        diary = await _diary(client, study, participant)

    assert diary["activities"][0]["day_label_index"] == 1
    assert diary["activities"][0]["start_minutes"] == 600
    assert diary["days"][0]["has_data"] is False
    assert diary["days"][1]["coverage_minutes"] == 60


@pytest.mark.asyncio
async def test_delete_and_delete_group():
    participant = f"p_{uuid.uuid4().hex[:6]}"
    async with httpx.AsyncClient() as client:
        study = await _create_study(client)
        single = await client.post(
            _url(study, participant, "/activities"),
            json={"items": [_item(code=100, days=[0])]},
        )
        client_uuid = single.json()["activities"][0]["client_uuid"]
        deleted = await client.delete(
            _url(study, participant, f"/activities/{client_uuid}")
        )
        assert deleted.json() == {"deleted": 1}
        again = await client.delete(
            _url(study, participant, f"/activities/{client_uuid}")
        )
        assert again.json() == {"deleted": 0}

        group = await client.post(
            _url(study, participant, "/activities"),
            json={"items": [_item(code=101, days=[0, 1, 2])]},
        )
        group_id = group.json()["group_id"]
        removed = await client.delete(
            _url(study, participant, f"/activity-groups/{group_id}")
        )
        assert removed.json() == {"deleted": 3}

        diary = await _diary(client, study, participant)

    assert diary["activities"] == []


@pytest.mark.asyncio
async def test_a_submitted_diary_is_read_only():
    participant = f"p_{uuid.uuid4().hex[:6]}"
    async with httpx.AsyncClient() as client:
        study = await _create_study(client)
        created = await client.post(
            _url(study, participant, "/activities"),
            json={"items": [_item(days=[0, 1, 2])]},
        )
        client_uuid = created.json()["activities"][0]["client_uuid"]

        submit = await client.post(_url(study, participant, "/submit"))
        assert submit.status_code == 200, submit.text

        blocked = await client.post(
            _url(study, participant, "/activities"),
            json={"items": [_item(code=101, start=0, end=60, days=[0])]},
        )
        moved = await client.patch(
            _url(study, participant, f"/activities/{client_uuid}"),
            json={"start_minutes": 0},
        )
        removed = await client.delete(
            _url(study, participant, f"/activities/{client_uuid}")
        )
        diary = await _diary(client, study, participant)

    assert blocked.status_code == 403
    assert blocked.json()["detail"]["code"] == "study_already_submitted"
    assert moved.status_code == 403
    assert removed.status_code == 403
    # Reading still works, and says so.
    assert diary["study"]["submitted_at"] is not None
    assert len(diary["activities"]) == 3


@pytest.mark.asyncio
async def test_the_old_whole_day_endpoint_still_writes_rows_the_diary_reads():
    participant = f"p_{uuid.uuid4().hex[:6]}"
    async with httpx.AsyncClient() as client:
        study = await _create_study(client)
        legacy = await client.post(
            _url(study, participant, "/day_labels/monday/activities"),
            json={
                "activities": [
                    {
                        "timeline_key": "primary",
                        "activity": "Activity 100",
                        "category": "General",
                        "code": 100,
                        "start_minutes": 480,
                        "end_minutes": 600,
                        "mode": "single-choice",
                    }
                ]
            },
        )
        assert legacy.status_code == 200, legacy.text
        diary = await _diary(client, study, participant)

    assert len(diary["activities"]) == 1
    assert diary["activities"][0]["client_uuid"], "old rows get an identity too"
    assert diary["days"][0]["coverage_minutes"] == 120


@pytest.mark.asyncio
async def test_the_old_endpoint_rejects_a_duplicate_submission_clearly():
    participant = f"p_{uuid.uuid4().hex[:6]}"
    item = {
        "timeline_key": "primary",
        "activity": "Activity 100",
        "category": "General",
        "code": 100,
        "start_minutes": 480,
        "end_minutes": 600,
        "mode": "single-choice",
    }
    async with httpx.AsyncClient() as client:
        study = await _create_study(client)
        response = await client.post(
            _url(study, participant, "/day_labels/monday/activities"),
            json={"activities": [item, dict(item)]},
        )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "activity.duplicate"


@pytest.mark.asyncio
async def test_submitting_an_incomplete_diary_names_the_days_that_are_open():
    participant = f"p_{uuid.uuid4().hex[:6]}"
    async with httpx.AsyncClient() as client:
        study = await _create_study(client, min_coverage=120)
        # Day 0 is complete, day 1 has half the requirement, day 2 is empty.
        await client.post(
            _url(study, participant, "/activities"),
            json={"items": [_item(start=480, end=600, days=[0])]},
        )
        await client.post(
            _url(study, participant, "/activities"),
            json={"items": [_item(code=101, start=480, end=540, days=[1])]},
        )
        response = await client.post(_url(study, participant, "/diary/submit"))
        diary = await _diary(client, study, participant)

    assert response.status_code == 400, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "days.incomplete"
    assert detail["incomplete_day_indices"] == [1, 2]
    assert detail["days_complete"] == 1
    assert detail["total_days"] == 3
    assert diary["study"]["submitted_at"] is None, "a refused submit locks nothing"


@pytest.mark.asyncio
async def test_submitting_a_complete_diary_locks_it_and_is_idempotent():
    participant = f"p_{uuid.uuid4().hex[:6]}"
    async with httpx.AsyncClient() as client:
        study = await _create_study(client, min_coverage=120)
        await client.post(
            _url(study, participant, "/activities"),
            json={"items": [_item(start=480, end=600, days=[0, 1, 2])]},
        )
        first = await client.post(_url(study, participant, "/diary/submit"))
        second = await client.post(_url(study, participant, "/diary/submit"))
        diary = await _diary(client, study, participant)

    assert first.status_code == 200, first.text
    assert first.json()["already_submitted"] is False
    assert second.status_code == 200, "a retry after a lost response is not an error"
    assert second.json()["already_submitted"] is True
    assert second.json()["study_submitted_at"] == first.json()["study_submitted_at"]
    assert diary["study"]["submitted_at"] is not None
    assert all(day["meets_requirement"] for day in diary["days"])


@pytest.mark.asyncio
async def test_the_submit_gate_matches_the_coverage_the_diary_reports():
    participant = f"p_{uuid.uuid4().hex[:6]}"
    async with httpx.AsyncClient() as client:
        study = await _create_study(client, min_coverage=120)
        # Two parallel activities: 08:00-10:00 is 120 minutes of the day, not 240.
        await client.post(
            _url(study, participant, "/activities"),
            json={"items": [_item(start=480, end=600, days=[0])]},
        )
        await client.post(
            _url(study, participant, "/activities"),
            json={"items": [_item(code=101, start=480, end=600, days=[0])]},
        )
        diary = await _diary(client, study, participant)
        response = await client.post(_url(study, participant, "/diary/submit"))

    assert diary["days"][0]["coverage_minutes"] == 120, "the union counts once"
    assert diary["days"][0]["meets_requirement"] is True
    assert response.status_code == 400, "days 1 and 2 are still empty"
    assert response.json()["detail"]["incomplete_day_indices"] == [1, 2]
