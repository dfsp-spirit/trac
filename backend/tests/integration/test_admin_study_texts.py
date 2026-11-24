"""Admin editing of localized study texts.

Requires a running backend (see ``./test_backend_integration.sh``).
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


def _load_activities(language: str) -> dict:
    backend_root = Path(__file__).resolve().parents[2]
    filename = (
        "activities_ki_adults_en.json"
        if language == "en"
        else "activities_ki_adults_sv.json"
    )
    return json.loads((backend_root / filename).read_text(encoding="utf-8"))


def _study_payload(
    name_short: str,
    *,
    intro_extra_de: str | None = None,
    legacy_description: str | None = None,
) -> dict:
    intro = {"en": "Welcome (EN)", "sv": "Välkommen (SV)"}
    if intro_extra_de:
        intro["de"] = intro_extra_de

    return {
        "name": f"Study texts integration {name_short}",
        "name_short": name_short,
        "description": (
            legacy_description
            if legacy_description is not None
            else {
                "en": "Description (EN)",
                "sv": "Beskrivning (SV)",
            }
        ),
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
            "en": _load_activities("en"),
            "sv": _load_activities("sv"),
        },
        "study_text_intro": intro,
        "study_text_instructions": {
            "en": "Instructions (EN)",
            "sv": "Instruktioner (SV)",
        },
        "study_text_consent": {
            "en": "Consent (EN)",
            "sv": "Samtycke (SV)",
        },
        "inactivity_page_custom_text": {
            "en": "Timeout (EN)",
            "sv": "Tidsgräns (SV)",
        },
        "data_collection_start": "2024-01-01T00:00:00Z",
        "data_collection_end": "2028-12-31T23:59:59Z",
    }


@pytest.fixture
def created_studies_for_cleanup():
    created = []
    yield created

    if not created:
        return

    with httpx.Client(timeout=60.0) as client:
        for name_short in reversed(list(dict.fromkeys(created))):
            response = client.delete(
                f"{BASE_URL}/api/admin/studies/{name_short}", auth=ADMIN_AUTH
            )
            if response.status_code not in (200, 404):
                raise AssertionError(
                    f"Unexpected cleanup status for '{name_short}': "
                    f"{response.status_code}"
                )


async def _create_study(
    client: httpx.AsyncClient,
    name_short: str,
    *,
    intro_extra_de: str | None = None,
    legacy_description: str | None = None,
) -> None:
    response = await client.post(
        f"{BASE_URL}/api/admin/studies/import-config",
        auth=ADMIN_AUTH,
        json={
            "mode": "create_only",
            "transaction_mode": "all_or_nothing",
            "studies": [
                _study_payload(
                    name_short,
                    intro_extra_de=intro_extra_de,
                    legacy_description=legacy_description,
                )
            ],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["summary"]["created"] == 1


def _texts_url(name_short: str) -> str:
    return f"{BASE_URL}/api/admin/studies/{name_short}/texts"


@pytest.mark.asyncio
async def test_get_study_texts_returns_values_and_field_metadata(
    created_studies_for_cleanup,
):
    name_short = f"it_texts_get_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        await _create_study(client, name_short)
        created_studies_for_cleanup.append(name_short)

        response = await client.get(_texts_url(name_short), auth=ADMIN_AUTH)

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["default_language"] == "en"
    assert payload["supported_languages"] == ["en", "sv"]
    assert payload["revision"]
    assert payload["values"]["study_text_intro"] == {
        "en": "Welcome (EN)",
        "sv": "Välkommen (SV)",
    }
    field_keys = {field["key"] for field in payload["fields"]}
    assert "description" in field_keys
    assert "study_text_consent" in field_keys
    assert "inactivity_page_custom_text" in field_keys


@pytest.mark.asyncio
async def test_patch_study_texts_updates_values_and_revision(
    created_studies_for_cleanup,
):
    name_short = f"it_texts_patch_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        await _create_study(client, name_short)
        created_studies_for_cleanup.append(name_short)

        before = (await client.get(_texts_url(name_short), auth=ADMIN_AUTH)).json()
        response = await client.patch(
            _texts_url(name_short),
            auth=ADMIN_AUTH,
            json={
                "revision": before["revision"],
                "values": {
                    "study_text_intro": {
                        "en": "New intro (EN)",
                        "sv": "Ny introduktion (SV)",
                    }
                },
            },
        )
        assert response.status_code == 200, response.text
        after = response.json()

        assert after["changed"] is True
        assert after["changed_fields"] == ["study_text_intro"]
        assert after["values"]["study_text_intro"] == {
            "en": "New intro (EN)",
            "sv": "Ny introduktion (SV)",
        }
        assert after["revision"] != before["revision"]

        persisted = (await client.get(_texts_url(name_short), auth=ADMIN_AUTH)).json()
        assert persisted["values"]["study_text_intro"] == {
            "en": "New intro (EN)",
            "sv": "Ny introduktion (SV)",
        }


@pytest.mark.asyncio
async def test_patch_study_texts_rejects_a_stale_revision(
    created_studies_for_cleanup,
):
    name_short = f"it_texts_stale_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        await _create_study(client, name_short)
        created_studies_for_cleanup.append(name_short)

        current = (await client.get(_texts_url(name_short), auth=ADMIN_AUTH)).json()
        first = await client.patch(
            _texts_url(name_short),
            auth=ADMIN_AUTH,
            json={
                "revision": current["revision"],
                "values": {
                    "study_text_instructions": {
                        "en": "First write (EN)",
                        "sv": "Första skrivningen (SV)",
                    }
                },
            },
        )
        assert first.status_code == 200, first.text

        stale = await client.patch(
            _texts_url(name_short),
            auth=ADMIN_AUTH,
            json={
                "revision": current["revision"],
                "values": {
                    "study_text_instructions": {
                        "en": "Stale write (EN)",
                        "sv": "Föråldrad skrivning (SV)",
                    }
                },
            },
        )

    assert stale.status_code == 409
    assert "changed since this page was loaded" in stale.json()["detail"]


@pytest.mark.asyncio
async def test_patch_study_texts_rejects_missing_translations(
    created_studies_for_cleanup,
):
    name_short = f"it_texts_partial_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        await _create_study(client, name_short)
        created_studies_for_cleanup.append(name_short)

        current = (await client.get(_texts_url(name_short), auth=ADMIN_AUTH)).json()
        response = await client.patch(
            _texts_url(name_short),
            auth=ADMIN_AUTH,
            json={
                "revision": current["revision"],
                "values": {
                    "study_text_instructions_title": {"en": "Only English"},
                },
            },
        )

    assert response.status_code == 400
    assert (
        "study_text_instructions_title is missing translations"
        in response.json()["detail"]
    )


@pytest.mark.asyncio
async def test_patch_study_texts_can_clear_and_preserves_extra_languages(
    created_studies_for_cleanup,
):
    name_short = f"it_texts_clear_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        await _create_study(client, name_short, intro_extra_de="Zusätzliche Einleitung")
        created_studies_for_cleanup.append(name_short)

        current = (await client.get(_texts_url(name_short), auth=ADMIN_AUTH)).json()
        assert current["values"]["study_text_intro"]["de"] == ("Zusätzliche Einleitung")

        # Editing a supported translation must not drop the existing extra
        # language, because the app ignores it but a backup should not lose it.
        updated = await client.patch(
            _texts_url(name_short),
            auth=ADMIN_AUTH,
            json={
                "revision": current["revision"],
                "values": {
                    "study_text_intro": {
                        "en": "Updated intro (EN)",
                        "sv": "Uppdaterad introduktion (SV)",
                    }
                },
            },
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["values"]["study_text_intro"] == {
            "en": "Updated intro (EN)",
            "sv": "Uppdaterad introduktion (SV)",
            "de": "Zusätzliche Einleitung",
        }

        cleared = await client.patch(
            _texts_url(name_short),
            auth=ADMIN_AUTH,
            json={
                "revision": updated.json()["revision"],
                "values": {"study_text_intro": None},
            },
        )
        assert cleared.status_code == 200, cleared.text
        assert cleared.json()["values"]["study_text_intro"] is None


@pytest.mark.asyncio
async def test_patch_study_texts_does_not_force_a_legacy_description_translation(
    created_studies_for_cleanup,
):
    """An untouched legacy string description must not block another text edit."""
    name_short = f"it_texts_legacy_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        await _create_study(client, name_short, legacy_description="Legacy description")
        created_studies_for_cleanup.append(name_short)

        current = (await client.get(_texts_url(name_short), auth=ADMIN_AUTH)).json()
        assert current["values"]["description"] == {"en": "Legacy description"}

        updated = await client.patch(
            _texts_url(name_short),
            auth=ADMIN_AUTH,
            json={
                "revision": current["revision"],
                "values": {
                    "study_text_intro": {
                        "en": "Updated intro (EN)",
                        "sv": "Uppdaterad introduktion (SV)",
                    }
                },
            },
        )
        assert updated.status_code == 200, updated.text

        # If the description itself is edited, the shared completeness rule
        # applies: a map must cover every supported language.
        incomplete = await client.patch(
            _texts_url(name_short),
            auth=ADMIN_AUTH,
            json={
                "revision": updated.json()["revision"],
                "values": {"description": {"en": "Only English"}},
            },
        )

    assert incomplete.status_code == 400
    assert "description is missing translations" in incomplete.json()["detail"]
