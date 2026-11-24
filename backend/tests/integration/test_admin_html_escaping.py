"""Admin pages must not reflect request-controlled values as raw HTML.

Requires a running backend (see ``./test_backend_integration.sh``)::

    TUD_BASE_SCHEME=http://localhost:3001 uv run pytest tests/integration/test_admin_html_escaping.py

The admin portal is only reachable with administrator credentials, but the
*administrator* opens the crafted link (or a stored value arrives through a
study created with a hostile name), so everything that ends up in the response
body has to be escaped - otherwise the payload runs inside the admin's
authenticated browser session.
"""

import html as html_lib
import json
import os
import uuid
from pathlib import Path
from urllib.parse import quote

import httpx
import pytest

from o_timeusediary_backend.settings import settings

BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.strip("/")
ADMIN_AUTH = (settings.admin_username, settings.admin_password)

# A path-safe XSS payload: no '/', '?' or '#', so it stays a single path
# segment of /admin/study/{name_short}.
XSS_PAYLOAD = "<img src=x onerror=alert(1)>"


def _require_authenticated(response: httpx.Response, auth) -> None:
    """Fail with an actionable message when the server rejects the admin creds."""
    if response.status_code == 401:
        raise AssertionError(
            f"Server rejected administrator credentials {auth[0]!r} (401). Make "
            "sure the running backend was started with TUD_API_ADMIN_USERNAME / "
            "TUD_API_ADMIN_PASSWORD."
        )


def _load_activities_template() -> dict:
    backend_root = Path(__file__).resolve().parents[2]
    return json.loads(
        (backend_root / "activities_default.json").read_text(encoding="utf-8")
    )


async def _create_study(client: httpx.AsyncClient, name_short: str, name: str) -> None:
    payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": name,
                "name_short": name_short,
                "description": "Integration test study for HTML escaping",
                "day_labels": [
                    {
                        "name": "monday",
                        "display_order": 0,
                        "display_names": {"en": "Monday"},
                    }
                ],
                "study_participant_ids": [],
                "allow_unlisted_participants": True,
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
    summary = response.json()["summary"]
    assert summary["created"] == 1, response.text


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


@pytest.mark.asyncio
async def test_unknown_study_page_escapes_name_from_url():
    """The 404 page for an unknown study must escape the path value."""
    url = f"{BASE_URL}/admin/study/{quote(XSS_PAYLOAD, safe='')}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(url, auth=ADMIN_AUTH)

    _require_authenticated(response, ADMIN_AUTH)
    assert response.status_code == 404
    assert "Back to overview" in response.text

    escaped = html_lib.escape(XSS_PAYLOAD)
    assert "<img" not in response.text, "payload reflected as raw HTML"
    assert escaped in response.text, f"expected escaped payload {escaped!r} in body"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "page_suffix",
    ["", "/texts"],
    ids=["study-detail", "study-texts"],
)
async def test_study_pages_escape_stored_study_name(
    created_studies_for_cleanup, page_suffix
):
    """A study whose display name contains HTML must render escaped (Jinja)."""
    study_short = f"it_xss_{uuid.uuid4().hex[:8]}"
    hostile_name = "<script>alert('study')</script>"

    async with httpx.AsyncClient(timeout=60.0) as client:
        await _create_study(client, study_short, hostile_name)
        created_studies_for_cleanup.append(study_short)

        response = await client.get(
            f"{BASE_URL}/admin/study/{study_short}{page_suffix}", auth=ADMIN_AUTH
        )

    _require_authenticated(response, ADMIN_AUTH)
    assert response.status_code == 200
    assert (
        "<script>alert('study')</script>" not in response.text
    ), "stored study name rendered as raw HTML"
    assert "&lt;script&gt;" in response.text
