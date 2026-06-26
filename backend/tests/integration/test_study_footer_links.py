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


def _load_activities_template() -> dict:
    backend_root = Path(__file__).resolve().parents[2]
    activities_file = backend_root / "activities_default.json"
    return json.loads(activities_file.read_text(encoding="utf-8"))


@pytest.fixture
def created_studies_for_cleanup():
    created_studies = []
    yield created_studies

    if not created_studies:
        return

    unique_names = list(dict.fromkeys(created_studies))
    with httpx.Client(timeout=60.0) as client:
        for study_name_short in reversed(unique_names):
            delete_response = client.delete(
                f"{BASE_URL}/api/admin/studies/{study_name_short}",
                auth=ADMIN_AUTH,
            )
            if delete_response.status_code not in (200, 404):
                raise AssertionError(
                    f"Unexpected cleanup status for study '{study_name_short}': "
                    f"{delete_response.status_code}"
                )


async def _import_footer_links_study(client: httpx.AsyncClient, study_name_short: str) -> None:
    """Import a minimal study with footer_links via the admin API."""
    activities_payload = _load_activities_template()

    payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"Footer Links Test Study {study_name_short}",
                "name_short": study_name_short,
                "description": "Integration test for footer_links in study-config",
                "day_labels": [
                    {
                        "name": "monday",
                        "display_order": 0,
                        "display_names": {"en": "Monday"},
                    },
                ],
                "study_participant_ids": [],
                "allow_unlisted_participants": True,
                "default_language": "en",
                "supported_languages": ["en"],
                "activities_json_data": {"en": activities_payload},
                "study_text_intro": {"en": "Intro"},
                "study_text_end_completed": {"en": "Done"},
                "study_text_end_skipped": {"en": "Skipped"},
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
                "footer_links": [
                    {
                        "title": {
                            "en": "Study Information",
                            "sv": "Studieinformation",
                            "de": "Studieninformation",
                        },
                        "target_url": "https://example.com/study-info",
                        "in_new_tab": True,
                    },
                    {
                        "title": {
                            "en": "Contact",
                            "sv": "Kontakt",
                            "de": "Kontakt",
                        },
                        "target_url": "https://example.com/contact",
                        "in_new_tab": False,
                    },
                ],
            }
        ],
    }

    import_response = await client.post(
        f"{BASE_URL}/api/admin/studies/import-config",
        json=payload,
        auth=ADMIN_AUTH,
    )
    assert import_response.status_code == 200, (
        f"Import failed: {import_response.status_code} {import_response.text}"
    )
    import_data = import_response.json()
    assert import_data["summary"]["created"] == 1
    assert import_data["summary"]["failed"] == 0


@pytest.mark.asyncio
async def test_study_config_includes_footer_links(created_studies_for_cleanup):
    """Verify the study-config endpoint returns footer_links for a study that has them."""
    study_name_short = f"it_fl_{uuid.uuid4().hex[:8]}"
    created_studies_for_cleanup.append(study_name_short)

    async with httpx.AsyncClient(timeout=30.0) as client:
        await _import_footer_links_study(client, study_name_short)

        url = f"{BASE_URL}/api/studies/{study_name_short}/study-config?lang=en"
        response = await client.get(url)

    assert response.status_code == 200, (
        f"Expected 200, got {response.status_code}: {response.text}"
    )

    data = response.json()
    assert "footer_links" in data, (
        f"study-config response missing 'footer_links' key. Keys: {list(data.keys())}"
    )

    footer_links = data["footer_links"]
    assert isinstance(footer_links, list), (
        f"footer_links should be a list, got {type(footer_links)}"
    )
    assert len(footer_links) == 2, (
        f"Expected 2 footer links, got {len(footer_links)}: {footer_links}"
    )

    # Verify first link: Study Information (opens in new tab)
    link1 = footer_links[0]
    assert link1["target_url"] == "https://example.com/study-info"
    assert link1["in_new_tab"] is True
    assert isinstance(link1["title"], dict)
    assert link1["title"]["en"] == "Study Information"
    assert link1["title"]["sv"] == "Studieinformation"
    assert link1["title"]["de"] == "Studieninformation"

    # Verify second link: Contact (same tab)
    link2 = footer_links[1]
    assert link2["target_url"] == "https://example.com/contact"
    assert link2["in_new_tab"] is False
    assert isinstance(link2["title"], dict)
    assert link2["title"]["en"] == "Contact"
    assert link2["title"]["sv"] == "Kontakt"
    assert link2["title"]["de"] == "Kontakt"


@pytest.mark.asyncio
async def test_study_config_includes_hide_server_wide_links(created_studies_for_cleanup):
    """Verify hide_server_wide_links is present and defaults to false."""
    study_name_short = f"it_fl_{uuid.uuid4().hex[:8]}"
    created_studies_for_cleanup.append(study_name_short)

    async with httpx.AsyncClient(timeout=30.0) as client:
        await _import_footer_links_study(client, study_name_short)

        url = f"{BASE_URL}/api/studies/{study_name_short}/study-config?lang=en"
        response = await client.get(url)

    assert response.status_code == 200

    data = response.json()
    assert "hide_server_wide_links" in data, (
        "study-config response missing 'hide_server_wide_links' key"
    )
    assert data["hide_server_wide_links"] is False, (
        f"Expected hide_server_wide_links=False, got {data['hide_server_wide_links']}"
    )
