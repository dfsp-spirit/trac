"""Integration coverage for the opt-in participant inactivity session."""

import os
import uuid
from datetime import timedelta

import httpx
import pytest
from sqlmodel import Session, select

from o_timeusediary_backend.database import engine
from o_timeusediary_backend.models import ParticipantSession, Study
from o_timeusediary_backend.settings import settings
from o_timeusediary_backend.utils import utc_now

BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.strip("/")
ADMIN_AUTH = (settings.admin_username, settings.admin_password)


def _minimal_activities_payload() -> dict:
    return {
        "general": {"app_name": "TRAC", "version": "1.0", "language": "en"},
        "timeline": {
            "primary": {
                "name": "Primary",
                "description": "",
                "mode": "single-choice",
                "min_coverage": 0,
                "categories": [
                    {
                        "name": "General",
                        "activities": [
                            {
                                "name": "Activity 100",
                                "code": 100,
                                "label": "activity-100",
                                "color": "#000000",
                                "childItems": [],
                            }
                        ],
                    }
                ],
            }
        },
    }


def _study_payload(name_short: str, participant_id: str, timeout_minutes: int) -> dict:
    return {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"Session Study {name_short}",
                "name_short": name_short,
                "description": "Integration test for participant sessions",
                "day_labels": [
                    {
                        "name": "monday",
                        "display_order": 0,
                        "display_names": {"en": "Monday"},
                    }
                ],
                "study_participant_ids": [participant_id],
                "allow_unlisted_participants": False,
                "default_language": "en",
                "supported_languages": ["en"],
                "activities_json_data": {"en": _minimal_activities_payload()},
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
                "inactivity_timeout_minutes": timeout_minutes,
            }
        ],
    }


async def _import_study(client: httpx.AsyncClient, payload: dict) -> None:
    response = await client.post(
        f"{BASE_URL}/api/admin/studies/import-config",
        json=payload,
        auth=ADMIN_AUTH,
    )
    assert response.status_code == 200, response.text


async def _delete_study(client: httpx.AsyncClient, name_short: str) -> None:
    response = await client.delete(
        f"{BASE_URL}/api/admin/studies/{name_short}",
        auth=ADMIN_AUTH,
    )
    assert response.status_code in {200, 404}


@pytest.mark.asyncio
async def test_session_is_required_and_revoked_for_a_timed_study():
    study_name_short = f"it_session_{uuid.uuid4().hex[:8]}"
    participant_id = "p1"

    async with httpx.AsyncClient() as client:
        await _import_study(
            client,
            _study_payload(study_name_short, participant_id, timeout_minutes=30),
        )

        diary_url = (
            f"{BASE_URL}/api/studies/{study_name_short}"
            f"/participants/{participant_id}/diary"
        )
        session_url = (
            f"{BASE_URL}/api/studies/{study_name_short}"
            f"/participants/{participant_id}/session"
        )

        missing = await client.get(diary_url)
        assert missing.status_code == 401
        assert missing.json()["detail"]["code"] == "session.required"

        started = await client.post(session_url)
        assert started.status_code == 200, started.text
        state = started.json()
        assert state["active"] is True
        assert state["timeout_minutes"] == 30
        assert state["expires_at"]

        diary = await client.get(diary_url)
        assert diary.status_code == 200, diary.text

        touched = await client.post(f"{session_url}/touch")
        assert touched.status_code == 200, touched.text
        assert touched.json()["active"] is True

        ended = await client.delete(session_url)
        assert ended.status_code == 204

        after_end = await client.get(diary_url)
        assert after_end.status_code == 401
        assert after_end.json()["detail"]["code"] == "session.required"

        await _delete_study(client, study_name_short)


@pytest.mark.asyncio
async def test_expired_session_is_rejected_and_a_page_load_replaces_it():
    study_name_short = f"it_session_{uuid.uuid4().hex[:8]}"
    participant_id = "p1"

    async with httpx.AsyncClient() as client:
        await _import_study(
            client,
            _study_payload(study_name_short, participant_id, timeout_minutes=1),
        )

        diary_url = (
            f"{BASE_URL}/api/studies/{study_name_short}"
            f"/participants/{participant_id}/diary"
        )
        session_url = (
            f"{BASE_URL}/api/studies/{study_name_short}"
            f"/participants/{participant_id}/session"
        )

        started = await client.post(session_url)
        assert started.status_code == 200, started.text

        with Session(engine) as db:
            study = db.exec(
                select(Study).where(Study.name_short == study_name_short)
            ).first()
            assert study is not None
            row = db.exec(
                select(ParticipantSession).where(
                    ParticipantSession.study_id == study.id,
                    ParticipantSession.participant_id == participant_id,
                )
            ).first()
            assert row is not None
            row.last_seen_at = utc_now() - timedelta(minutes=2)
            db.add(row)
            db.commit()

        expired = await client.get(diary_url)
        assert expired.status_code == 401
        assert expired.json()["detail"]["code"] == "session.expired"

        touch = await client.post(f"{session_url}/touch")
        assert touch.status_code == 401
        assert touch.json()["detail"]["code"] == "session.expired"

        # A full page load is a fresh entry: start replaces the expired session.
        replaced = await client.post(session_url)
        assert replaced.status_code == 200, replaced.text
        assert (await client.get(diary_url)).status_code == 200

        await _delete_study(client, study_name_short)


@pytest.mark.asyncio
async def test_session_rows_are_deleted_with_participant_data():
    study_name_short = f"it_session_{uuid.uuid4().hex[:8]}"
    participant_id = "p1"

    async with httpx.AsyncClient() as client:
        await _import_study(
            client,
            _study_payload(study_name_short, participant_id, timeout_minutes=30),
        )
        session_url = (
            f"{BASE_URL}/api/studies/{study_name_short}"
            f"/participants/{participant_id}/session"
        )
        assert (await client.post(session_url)).status_code == 200

        reset = await client.delete(
            f"{BASE_URL}/api/admin/studies/{study_name_short}"
            f"/participants/{participant_id}/data",
            auth=ADMIN_AUTH,
        )
        assert reset.status_code == 200, reset.text

        with Session(engine) as db:
            study = db.exec(
                select(Study).where(Study.name_short == study_name_short)
            ).first()
            assert study is not None
            rows = db.exec(
                select(ParticipantSession).where(
                    ParticipantSession.study_id == study.id,
                    ParticipantSession.participant_id == participant_id,
                )
            ).all()
            assert rows == []

        await _delete_study(client, study_name_short)
