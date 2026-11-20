"""The public study list the entry page shows (``/api/listed_public_studies``).

A study appears there only when it is *listed* (opt-in), open, running and not
paused, so these tests build their own studies instead of relying on the seeded
fixtures: the answer must not depend on what the dev database happens to hold.
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


def _activities_payload(language: str) -> dict:
    """The shipped sample activities, declared as the language they are mapped to.

    The import insists that the mapping and the file's own ``general.language``
    agree, so each language gets its own copy instead of one shared one.
    """
    backend_root = Path(__file__).resolve().parents[2]
    activities_file = backend_root / "activities_default.json"
    payload = json.loads(activities_file.read_text(encoding="utf-8"))
    payload["general"]["language"] = language
    return payload


def _study_payload(
    *,
    name_short: str,
    description: dict | str,
    allow_unlisted_participants: bool,
    is_listed_publicly: bool | None,
) -> dict:
    payload = {
        "name": f"Public list test {name_short}",
        "name_short": name_short,
        "description": description,
        "day_labels": [
            {
                "name": "monday",
                "display_order": 0,
                "display_names": {"en": "Monday", "de": "Montag"},
            }
        ],
        "study_participant_ids": [],
        "allow_unlisted_participants": allow_unlisted_participants,
        "default_language": "en",
        "supported_languages": ["en", "de"],
        "activities_json_data": {
            "en": _activities_payload("en"),
            "de": _activities_payload("de"),
        },
        "data_collection_start": "2024-01-01T00:00:00Z",
        "data_collection_end": "2099-12-31T23:59:59Z",
    }
    if is_listed_publicly is not None:
        payload["is_listed_publicly"] = is_listed_publicly
    return payload


def _import_payload(studies: list[dict]) -> dict:
    return {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": studies,
    }


@pytest.fixture
def created_studies_for_cleanup():
    created_studies: list[str] = []
    yield created_studies

    if not created_studies:
        return

    with httpx.Client(timeout=60.0) as client:
        for study_name_short in reversed(list(dict.fromkeys(created_studies))):
            delete_response = client.delete(
                f"{BASE_URL}/api/admin/studies/{study_name_short}",
                auth=ADMIN_AUTH,
            )
            if delete_response.status_code not in (200, 404):
                raise AssertionError(
                    f"Unexpected cleanup status for study '{study_name_short}': "
                    f"{delete_response.status_code}"
                )


@pytest.mark.asyncio
async def test_public_list_contains_only_listed_open_studies(
    created_studies_for_cleanup,
):
    suffix = uuid.uuid4().hex[:8]
    listed_name = f"it_listed_{suffix}"
    unlisted_name = f"it_unlisted_{suffix}"

    listed_study = _study_payload(
        name_short=listed_name,
        description={
            "de": "Öffentlich gelistete Studie",
            "en": "Publicly listed study",
        },
        allow_unlisted_participants=True,
        is_listed_publicly=True,
    )
    # Same shape, same window, open as well - only the flag differs, so the list
    # has exactly one reason to include one and not the other.
    unlisted_study = _study_payload(
        name_short=unlisted_name,
        description="Not listed",
        allow_unlisted_participants=True,
        is_listed_publicly=None,
    )

    async with httpx.AsyncClient(timeout=60.0) as client:
        import_response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=_import_payload([listed_study, unlisted_study]),
            auth=ADMIN_AUTH,
        )
        assert import_response.status_code == 200, import_response.text
        import_summary = import_response.json()["summary"]
        assert import_summary["created"] == 2, import_summary
        created_studies_for_cleanup.extend([listed_name, unlisted_name])

        list_response = await client.get(
            f"{BASE_URL}/api/listed_public_studies",
            params={"lang": "en"},
        )
        assert list_response.status_code == 200
        listed_names = [entry["name_short"] for entry in list_response.json()]
        assert listed_name in listed_names
        assert unlisted_name not in listed_names

        entry = next(
            item for item in list_response.json() if item["name_short"] == listed_name
        )
        assert entry["description"] == "Publicly listed study"

        # The description follows the requested interface language.
        german_response = await client.get(
            f"{BASE_URL}/api/listed_public_studies",
            params={"lang": "de"},
        )
        assert german_response.status_code == 200
        german_entry = next(
            item
            for item in german_response.json()
            if item["name_short"] == listed_name
        )
        assert german_entry["description"] == "Öffentlich gelistete Studie"


@pytest.mark.asyncio
async def test_public_list_rejects_a_listed_invitation_only_study(
    created_studies_for_cleanup,
):
    """A closed study cannot be joined from the list, so listing it is refused.

    The error names the flag and the fix, because a config that silently kept
    "listed" while never appearing is the confusing outcome this prevents.
    """
    study_name = f"it_closed_listed_{uuid.uuid4().hex[:8]}"
    closed_study = _study_payload(
        name_short=study_name,
        description="Closed but listed",
        allow_unlisted_participants=False,
        is_listed_publicly=True,
    )

    async with httpx.AsyncClient(timeout=60.0) as client:
        import_response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=_import_payload([closed_study]),
            auth=ADMIN_AUTH,
        )
        assert import_response.status_code == 200, import_response.text
        import_data = import_response.json()
        assert import_data["summary"]["created"] == 0
        assert import_data["summary"]["failed"] == 1
        errors = import_data["results"][0]["errors"]
        assert any("is_listed_publicly requires an open study" in e for e in errors), errors

        # The rejected study must not exist, listed or otherwise.
        list_response = await client.get(f"{BASE_URL}/api/listed_public_studies")
        assert list_response.status_code == 200
        assert study_name not in [
            entry["name_short"] for entry in list_response.json()
        ]
