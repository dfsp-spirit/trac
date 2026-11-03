"""The admin pages share one layout, one stylesheet and one script.

Every admin page extends ``templates/admin_base.html``; the visual definition and
the small JS helpers live in ``static/admin.css`` / ``static/admin.js``. This
guards the arrangement so a page cannot quietly grow its own copy again:

* no page may carry an inline ``<style>`` block,
* every page links the shared stylesheet and script,
* the shared navigation is rendered on every page,
* the static files are actually served.

Requires a running backend (see ``./test_backend_integration.sh``).
"""

import os

import httpx
import pytest

from o_timeusediary_backend.settings import settings

BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.strip("/")
ADMIN_AUTH = (settings.admin_username, settings.admin_password)

ADMIN_PAGES = [
    "/admin",
    "/admin/study/default",
    "/admin/participant-management",
    "/admin/file-validation",
    "/admin/tools",
]


@pytest.mark.asyncio
@pytest.mark.parametrize("page_path", ADMIN_PAGES)
async def test_admin_page_uses_the_shared_shell(page_path):
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(f"{BASE_URL}{page_path}", auth=ADMIN_AUTH)

    assert response.status_code == 200, response.text
    body = response.text

    assert "/static/admin.css" in body
    assert "/static/admin.js" in body
    # One stylesheet, no per-page <style> block.
    assert "<style" not in body

    # Shared navigation: the same four entries on every page.
    for label in ("Overview", "Participant Management", "File Validation", "Tools"):
        assert f">{label}</a>" in body.replace("\n", ""), label


@pytest.mark.asyncio
async def test_admin_static_assets_are_served():
    async with httpx.AsyncClient(timeout=60.0) as client:
        stylesheet = await client.get(f"{BASE_URL}/static/admin.css")
        script = await client.get(f"{BASE_URL}/static/admin.js")

    assert stylesheet.status_code == 200
    assert "text/css" in stylesheet.headers["content-type"]
    assert "--border-strong" in stylesheet.text

    assert script.status_code == 200
    assert "javascript" in script.headers["content-type"]
    assert "switchTab" in script.text


@pytest.mark.asyncio
async def test_file_validation_page_has_a_single_create_flow():
    """The old modes 3 and 4 are merged: one upload, auto-detection, then review."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(
            f"{BASE_URL}/admin/file-validation", auth=ADMIN_AUTH
        )

    assert response.status_code == 200, response.text
    body = response.text

    for element_id in (
        "studyForm",
        "studiesConfigFile",
        "validateStudyBtn",
        "validationResult",
        "reviewPanel",
        "reviewConfirmed",
        "createStudyBtn",
        "successPanel",
        "activityChecks",
    ):
        assert f'id="{element_id}"' in body, element_id

    # The second full-study mode form is gone; only the activity-only checks remain.
    assert 'data-mode="full_study"' not in body
    assert 'data-mode="full_study_embedded"' not in body


@pytest.mark.asyncio
async def test_participant_page_is_grouped_into_tabs():
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(
            f"{BASE_URL}/admin/participant-management",
            params={"study_name_short": "default"},
            auth=ADMIN_AUTH,
        )

    assert response.status_code == 200, response.text
    body = response.text

    assert "data-tab-group" in body
    for panel_id in ("pm-participants", "pm-tokens", "pm-danger"):
        assert f'id="{panel_id}"' in body, panel_id
    # Destructive actions live in the danger panel, not next to "Add participants".
    danger_start = body.index('id="pm-danger"')
    assert "Delete users (and their tokens)" in body[danger_start:]
