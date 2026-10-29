"""The study detail page links into both participant frontends.

Requires a running backend (see ``./test_backend_integration.sh``)::

    TUD_BASE_SCHEME=http://localhost:3000 uv run pytest tests/integration/test_admin_study_join_links.py

An open study offers a join link for new participants in the classic frontend
and in the rewrite; a closed study links every listed participant into both.
"""

import html
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
PARTICIPANT_ID = "join_link_participant"


def _load_activities_template() -> dict:
    backend_root = Path(__file__).resolve().parents[2]
    return json.loads(
        (backend_root / "activities_default.json").read_text(encoding="utf-8")
    )


def _require_authenticated(response: httpx.Response) -> None:
    if response.status_code == 401:
        raise AssertionError(
            f"Server rejected administrator credentials {ADMIN_AUTH[0]!r} (401). "
            "Make sure the running backend was started with TUD_API_ADMIN_USERNAME / "
            "TUD_API_ADMIN_PASSWORD."
        )


async def _create_study(
    client: httpx.AsyncClient,
    name_short: str,
    *,
    allow_unlisted: bool,
    participant_ids: list[str],
) -> None:
    payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"Integration Join Link Study {name_short}",
                "name_short": name_short,
                "description": "Integration test study for join links",
                "day_labels": [
                    {
                        "name": "monday",
                        "display_order": 0,
                        "display_names": {"en": "Monday"},
                    }
                ],
                "study_participant_ids": participant_ids,
                "allow_unlisted_participants": allow_unlisted,
                "default_language": "en",
                "supported_languages": ["en"],
                "activities_json_data": {"en": _load_activities_template()},
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
    assert response.json()["summary"]["created"] == 1, response.text


@pytest.fixture
def created_studies_for_cleanup():
    created: list[str] = []
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


@pytest.mark.asyncio
async def test_open_study_offers_new_participant_links_in_both_frontends(
    created_studies_for_cleanup,
):
    study_short = f"it_join_open_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        await _create_study(
            client,
            study_short,
            allow_unlisted=True,
            participant_ids=[],
        )
        created_studies_for_cleanup.append(study_short)

        response = await client.get(
            f"{BASE_URL}/admin/study/{study_short}", auth=ADMIN_AUTH
        )

    _require_authenticated(response)
    assert response.status_code == 200, response.text
    assert (
        f"{settings.frontend_url}/index.html?study_name={study_short}" in response.text
    )
    assert (
        f"{settings.frontend_new_url}/index.html?study={study_short}" in response.text
    )


@pytest.mark.asyncio
async def test_closed_study_links_each_participant_into_both_frontends(
    created_studies_for_cleanup,
):
    study_short = f"it_join_closed_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        await _create_study(
            client,
            study_short,
            allow_unlisted=False,
            participant_ids=[PARTICIPANT_ID],
        )
        created_studies_for_cleanup.append(study_short)

        response = await client.get(
            f"{BASE_URL}/admin/study/{study_short}", auth=ADMIN_AUTH
        )

    _require_authenticated(response)
    assert response.status_code == 200, response.text
    body = html.unescape(response.text)
    assert "Join as new user" not in body
    assert (
        f"{settings.frontend_url}/index.html?pid={PARTICIPANT_ID}"
        f"&study_name={study_short}"
    ) in body
    assert (
        f"{settings.frontend_new_url}/index.html?study={study_short}"
        f"&pid={PARTICIPANT_ID}"
    ) in body
