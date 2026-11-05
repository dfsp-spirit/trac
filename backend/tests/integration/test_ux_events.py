"""Integration tests for the unlinked usability signals.

Covers the whole path: the per-study ``save_ux_events`` flag, the study-scoped
``ux-events`` endpoint, the aggregate admin page, and the CSV export the study
team uses to build an alias list.

The privacy promises are asserted here, not just in the unit tests: a study that
did not opt in stores nothing, an unknown event name is dropped, and a
participant id cannot survive in a stored property.
"""

import json
import os
import uuid
from pathlib import Path

import httpx
import pytest

from o_timeusediary_backend.settings import settings


BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.strip("/")
ADMIN_AUTH = (settings.admin_username, settings.admin_password)

LOAD_ID = "3f2b8c1e-9a4d-4f7b-8c2e-1d5a6b7c8d90"


def _load_activities_template() -> dict:
    backend_root = Path(__file__).resolve().parents[2]
    activities_file = backend_root / "activities_default.json"
    return json.loads(activities_file.read_text(encoding="utf-8"))


@pytest.fixture
def created_studies_for_cleanup():
    created = []
    yield created
    if not created:
        return
    with httpx.Client(timeout=60.0) as client:
        for study_name_short in reversed(list(dict.fromkeys(created))):
            response = client.delete(
                f"{BASE_URL}/api/admin/studies/{study_name_short}", auth=ADMIN_AUTH
            )
            if response.status_code not in (200, 404):
                raise AssertionError(
                    f"Unexpected cleanup status for '{study_name_short}': "
                    f"{response.status_code}"
                )


async def _import_study(
    client: httpx.AsyncClient, study_name_short: str, *, save_ux_events: bool
) -> None:
    study_payload = {
        "name": f"UX Signals Test Study {study_name_short}",
        "name_short": study_name_short,
        "description": "Integration test for usability signals",
        "day_labels": [
            {"name": "monday", "display_order": 0, "display_names": {"en": "Monday"}},
        ],
        "study_participant_ids": [],
        "allow_unlisted_participants": True,
        "default_language": "en",
        "supported_languages": ["en"],
        "activities_json_data": {"en": _load_activities_template()},
        "study_text_intro": {"en": "Intro"},
        "study_text_end_completed": {"en": "Done"},
        "study_text_end_skipped": {"en": "Skipped"},
        "data_collection_start": "2024-01-01T00:00:00Z",
        "data_collection_end": "2028-12-31T23:59:59Z",
        "save_ux_events": save_ux_events,
    }

    response = await client.post(
        f"{BASE_URL}/api/admin/studies/import-config",
        json={
            "mode": "create_only",
            "transaction_mode": "all_or_nothing",
            "studies": [study_payload],
        },
        auth=ADMIN_AUTH,
    )
    assert response.status_code == 200, (
        f"Import failed: {response.status_code} {response.text}"
    )
    summary = response.json()["summary"]
    assert summary["created"] == 1 and summary["failed"] == 0, summary


async def _post_signals(
    client: httpx.AsyncClient, study_name_short: str, events: list[dict]
) -> httpx.Response:
    return await client.post(
        f"{BASE_URL}/api/studies/{study_name_short}/ux-events",
        json={
            "load_id": LOAD_ID,
            "language": "en",
            "app_version": "0.25.0",
            "events": events,
        },
    )


def _unique_short_name(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


@pytest.mark.asyncio
async def test_a_study_that_did_not_opt_in_stores_nothing(created_studies_for_cleanup):
    study = _unique_short_name("ux_off")
    created_studies_for_cleanup.append(study)
    async with httpx.AsyncClient(timeout=60.0) as client:
        await _import_study(client, study, save_ux_events=False)

        response = await _post_signals(
            client, study, [{"name": "search.no_result", "props": {"query": "kaffee"}}]
        )
        assert response.status_code == 200
        assert response.json()["accepted"] == 0
        assert response.json()["reason"] == "ux_events_disabled"

        csv_response = await client.get(
            f"{BASE_URL}/admin/ux-signals/export.csv",
            params={"study_name_short": study, "dataset": "queries"},
            auth=ADMIN_AUTH,
        )
        assert csv_response.status_code == 200
        assert "kaffee" not in csv_response.text


@pytest.mark.asyncio
async def test_signals_are_stored_and_show_up_as_aggregates(
    created_studies_for_cleanup,
):
    study = _unique_short_name("ux_on")
    created_studies_for_cleanup.append(study)
    async with httpx.AsyncClient(timeout=60.0) as client:
        await _import_study(client, study, save_ux_events=True)

        response = await _post_signals(
            client,
            study,
            [
                {
                    "name": "session.started",
                    "props": {"stage": "diary", "viewport_class": "phone"},
                },
                {"name": "search.no_result", "props": {"query": "Frühstück"}},
                {
                    "name": "diary.blocked",
                    "props": {
                        "stage": "day_submit",
                        "codes": ["overlap.limit_reached"],
                    },
                },
            ],
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["accepted"] == 3, body
        assert body["dropped"] == 0, body

        page = await client.get(
            f"{BASE_URL}/admin/ux-signals",
            params={"study_name_short": study, "days": 7},
            auth=ADMIN_AUTH,
        )
        assert page.status_code == 200
        # The server folds the term again, so the admin list groups spellings.
        assert "fruhstuck" in page.text
        assert "overlap.limit_reached" in page.text
        # And nothing that identifies a person is rendered anywhere.
        assert LOAD_ID not in page.text

        csv_response = await client.get(
            f"{BASE_URL}/admin/ux-signals/export.csv",
            params={"study_name_short": study, "dataset": "queries", "days": 7},
            auth=ADMIN_AUTH,
        )
        assert csv_response.status_code == 200
        assert csv_response.text.splitlines()[0].startswith("query,count,loads")
        assert "fruhstuck" in csv_response.text


@pytest.mark.asyncio
async def test_unknown_events_and_identifiers_are_refused(created_studies_for_cleanup):
    study = _unique_short_name("ux_guard")
    created_studies_for_cleanup.append(study)
    async with httpx.AsyncClient(timeout=60.0) as client:
        await _import_study(client, study, save_ux_events=True)

        # A participant id is not a load id: the batch is refused outright.
        pid_as_load = await client.post(
            f"{BASE_URL}/api/studies/{study}/ux-events",
            json={"load_id": "bernddasbrot", "events": [{"name": "session.started"}]},
        )
        assert pid_as_load.status_code == 200
        assert pid_as_load.json()["accepted"] == 0
        assert pid_as_load.json()["reason"] == "missing or malformed load_id"

        # An unknown event name and an extra property are both dropped.
        mixed = await _post_signals(
            client,
            study,
            [
                {
                    "name": "participant.notes",
                    "props": {"text": "met Anna at breakfast"},
                },
                {
                    "name": "search.no_result",
                    "props": {"query": "kaffee", "note": "met Anna at breakfast"},
                },
            ],
        )
        assert mixed.json()["accepted"] == 1
        assert mixed.json()["dropped"] == 1

        # A route that carries a real participant id is templated by the server.
        errored = await _post_signals(
            client,
            study,
            [
                {
                    "name": "api.error",
                    "props": {
                        "method": "POST",
                        "route": "/api/studies/x/participants/bernddasbrot/activities",
                        "status": 409,
                        "code": "activity.duplicate",
                    },
                }
            ],
        )
        assert errored.json()["accepted"] == 1

        page = await client.get(
            f"{BASE_URL}/admin/ux-signals",
            params={"study_name_short": study, "days": 7},
            auth=ADMIN_AUTH,
        )
        assert page.status_code == 200
        assert "bernddasbrot" not in page.text
        assert "participants/:pid" in page.text
        assert "met Anna" not in page.text


@pytest.mark.asyncio
async def test_oversized_batches_are_dropped(created_studies_for_cleanup):
    study = _unique_short_name("ux_big")
    created_studies_for_cleanup.append(study)
    async with httpx.AsyncClient(timeout=60.0) as client:
        await _import_study(client, study, save_ux_events=True)

        response = await _post_signals(
            client, study, [{"name": "session.started"}] * 21
        )
        assert response.status_code == 200
        assert response.json()["accepted"] == 0
        assert response.json()["reason"] == "too many events in one batch"


def test_the_aggregate_page_requires_admin():
    with httpx.Client(timeout=30.0) as client:
        assert client.get(f"{BASE_URL}/admin/ux-signals").status_code == 401
        response = client.get(
            f"{BASE_URL}/admin/ux-signals/export.csv",
            params={"study_name_short": "default", "dataset": "queries"},
        )
        assert response.status_code == 401
