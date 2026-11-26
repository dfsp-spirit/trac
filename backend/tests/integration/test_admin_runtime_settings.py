"""Admin runtime study settings: partial updates and invariants."""

import os
import uuid
from typing import Optional

import httpx
import pytest
from sqlmodel import Session, select

from o_timeusediary_backend.database import engine
from o_timeusediary_backend.models import Study
from o_timeusediary_backend.settings import settings

BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.strip("/")
ADMIN_AUTH = (settings.admin_username, settings.admin_password)


def _minimal_activities_payload(language: str = "en") -> dict:
    return {
        "general": {"app_name": "TRAC", "version": "1.0", "language": language},
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


def _study_payload(
    name_short: str,
    *,
    consent_text: Optional[dict] = None,
) -> dict:
    study = {
        "name": f"Runtime Settings Study {name_short}",
        "name_short": name_short,
        "description": "Integration test for admin runtime settings",
        "day_labels": [
            {
                "name": "monday",
                "display_order": 0,
                "display_names": {"en": "Monday", "sv": "Måndag"},
            }
        ],
        "study_participant_ids": [],
        "allow_unlisted_participants": True,
        "default_language": "en",
        "supported_languages": ["en", "sv"],
        "activities_json_data": {
            "en": _minimal_activities_payload("en"),
            "sv": _minimal_activities_payload("sv"),
        },
        "data_collection_start": "2024-01-01T00:00:00Z",
        "data_collection_end": "2028-12-31T23:59:59Z",
        "require_consent": False,
        "allow_skip_timeuse": False,
        "num_recent_activities_shown": 5,
        "time_step_minutes": 10,
        "min_duration_minutes": 10,
        "inactivity_timeout_minutes": 0,
        "hide_server_wide_links": False,
    }
    if consent_text is not None:
        study["study_text_consent"] = consent_text
    return {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [study],
    }


async def _import_study(client: httpx.AsyncClient, payload: dict) -> str:
    response = await client.post(
        f"{BASE_URL}/api/admin/studies/import-config",
        json=payload,
        auth=ADMIN_AUTH,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["summary"]["created"] == 1, body
    return payload["studies"][0]["name_short"]


async def _delete_study(client: httpx.AsyncClient, name_short: str) -> None:
    response = await client.delete(
        f"{BASE_URL}/api/admin/studies/{name_short}",
        auth=ADMIN_AUTH,
    )
    assert response.status_code in {200, 404}


@pytest.mark.asyncio
async def test_runtime_settings_partial_update_keeps_other_fields():
    name_short = f"it_runtime_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient() as client:
        await _import_study(client, _study_payload(name_short))
        url = f"{BASE_URL}/api/admin/studies/{name_short}/runtime-settings"

        response = await client.patch(
            url,
            json={
                "num_recent_activities_shown": 0,
                "time_step_minutes": 15,
                "min_duration_minutes": 30,
                "allow_skip_timeuse": True,
                "hide_server_wide_links": True,
            },
            auth=ADMIN_AUTH,
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["changed"] == [
            "allow_skip_timeuse",
            "num_recent_activities_shown",
            "time_step_minutes",
            "min_duration_minutes",
            "hide_server_wide_links",
        ]
        assert body["settings"]["num_recent_activities_shown"] == 0
        assert body["settings"]["time_step_minutes"] == 15
        assert body["settings"]["min_duration_minutes"] == 30
        assert body["settings"]["allow_skip_timeuse"] is True
        assert body["settings"]["hide_server_wide_links"] is True

        partial = await client.patch(
            url,
            json={"allow_skip_timeuse": False},
            auth=ADMIN_AUTH,
        )
        assert partial.status_code == 200, partial.text
        settings_after = partial.json()["settings"]
        assert settings_after["allow_skip_timeuse"] is False
        assert settings_after["num_recent_activities_shown"] == 0
        assert settings_after["time_step_minutes"] == 15
        assert settings_after["min_duration_minutes"] == 30
        assert settings_after["hide_server_wide_links"] is True

        export = await client.get(
            f"{BASE_URL}/api/admin/export/studies-runtime-config",
            params={"study_name": name_short},
            auth=ADMIN_AUTH,
        )
        assert export.status_code == 200, export.text
        exported = export.json()["studies_config"]["studies"][0]
        assert exported["num_recent_activities_shown"] == 0
        assert exported["time_step_minutes"] == 15
        assert exported["min_duration_minutes"] == 30
        assert exported["hide_server_wide_links"] is True

        await _delete_study(client, name_short)


@pytest.mark.asyncio
async def test_runtime_settings_validates_the_merged_timing_pair():
    name_short = f"it_runtime_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient() as client:
        await _import_study(client, _study_payload(name_short))
        url = f"{BASE_URL}/api/admin/studies/{name_short}/runtime-settings"

        invalid = await client.patch(
            url,
            json={"time_step_minutes": 15},
            auth=ADMIN_AUTH,
        )
        assert invalid.status_code == 400
        assert "at least time_step_minutes" in invalid.json()["detail"]

        valid = await client.patch(
            url,
            json={"time_step_minutes": 15, "min_duration_minutes": 30},
            auth=ADMIN_AUTH,
        )
        assert valid.status_code == 200, valid.text
        assert valid.json()["settings"]["time_step_minutes"] == 15
        assert valid.json()["settings"]["min_duration_minutes"] == 30

        await _delete_study(client, name_short)


@pytest.mark.asyncio
async def test_consent_activation_requires_text_for_every_supported_language():
    name_short = f"it_runtime_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient() as client:
        await _import_study(client, _study_payload(name_short))
        settings_url = f"{BASE_URL}/api/admin/studies/{name_short}/runtime-settings"

        # The bulk import path requires complete translations, so seed the
        # partial legacy state directly to exercise the activation guard.
        with Session(engine) as db:
            study = db.exec(select(Study).where(Study.name_short == name_short)).first()
            assert study is not None
            study.study_text_consent = {"en": "Consent EN"}
            db.add(study)
            db.commit()

        blocked = await client.patch(
            settings_url,
            json={"require_consent": True},
            auth=ADMIN_AUTH,
        )
        assert blocked.status_code == 400, blocked.text
        detail = blocked.json()["detail"]
        assert detail["code"] == "consent_text_incomplete"
        assert detail["missing_languages"] == ["sv"]

        # Unrelated edits must still work while the consent text is incomplete.
        unrelated = await client.patch(
            settings_url,
            json={"allow_skip_timeuse": True},
            auth=ADMIN_AUTH,
        )
        assert unrelated.status_code == 200, unrelated.text
        assert unrelated.json()["settings"]["require_consent"] is False

        texts = await client.get(
            f"{BASE_URL}/api/admin/studies/{name_short}/texts",
            auth=ADMIN_AUTH,
        )
        assert texts.status_code == 200, texts.text
        revision = texts.json()["revision"]
        added = await client.patch(
            f"{BASE_URL}/api/admin/studies/{name_short}/texts",
            json={
                "revision": revision,
                "values": {
                    "study_text_consent": {
                        "en": "Consent EN",
                        "sv": "Samtycke SV",
                    }
                },
            },
            auth=ADMIN_AUTH,
        )
        assert added.status_code == 200, added.text

        enabled = await client.patch(
            settings_url,
            json={"require_consent": True},
            auth=ADMIN_AUTH,
        )
        assert enabled.status_code == 200, enabled.text
        assert enabled.json()["settings"]["require_consent"] is True

        # While consent is required, the texts editor must not clear the text.
        texts = await client.get(
            f"{BASE_URL}/api/admin/studies/{name_short}/texts",
            auth=ADMIN_AUTH,
        )
        revision = texts.json()["revision"]
        cleared = await client.patch(
            f"{BASE_URL}/api/admin/studies/{name_short}/texts",
            json={"revision": revision, "values": {"study_text_consent": None}},
            auth=ADMIN_AUTH,
        )
        assert cleared.status_code == 400, cleared.text
        assert "requires consent" in cleared.json()["detail"]

        disabled = await client.patch(
            settings_url,
            json={"require_consent": False},
            auth=ADMIN_AUTH,
        )
        assert disabled.status_code == 200, disabled.text

        texts = await client.get(
            f"{BASE_URL}/api/admin/studies/{name_short}/texts",
            auth=ADMIN_AUTH,
        )
        revision = texts.json()["revision"]
        cleared = await client.patch(
            f"{BASE_URL}/api/admin/studies/{name_short}/texts",
            json={"revision": revision, "values": {"study_text_consent": None}},
            auth=ADMIN_AUTH,
        )
        assert cleared.status_code == 200, cleared.text

        await _delete_study(client, name_short)


@pytest.mark.asyncio
async def test_runtime_settings_rejects_unknown_and_negative_values():
    name_short = f"it_runtime_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient() as client:
        await _import_study(client, _study_payload(name_short))
        url = f"{BASE_URL}/api/admin/studies/{name_short}/runtime-settings"

        unknown = await client.patch(
            url,
            json={"not_a_setting": 1},
            auth=ADMIN_AUTH,
        )
        assert unknown.status_code == 422

        negative = await client.patch(
            url,
            json={"num_recent_activities_shown": -1},
            auth=ADMIN_AUTH,
        )
        assert negative.status_code == 422

        empty = await client.patch(url, json={}, auth=ADMIN_AUTH)
        assert empty.status_code == 400

        await _delete_study(client, name_short)
