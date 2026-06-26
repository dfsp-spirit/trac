import os

import httpx
import pytest

from o_timeusediary_backend.settings import settings


BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.strip("/")


@pytest.mark.asyncio
async def test_study_config_includes_footer_links():
    """Verify the study-config endpoint returns footer_links for the default study."""
    url = f"{BASE_URL}/api/studies/default/study-config?lang=en"

    async with httpx.AsyncClient() as client:
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
async def test_study_config_includes_hide_server_wide_links():
    """Verify hide_server_wide_links is present and defaults to false."""
    url = f"{BASE_URL}/api/studies/default/study-config?lang=en"

    async with httpx.AsyncClient() as client:
        response = await client.get(url)

    assert response.status_code == 200

    data = response.json()
    assert "hide_server_wide_links" in data, (
        "study-config response missing 'hide_server_wide_links' key"
    )
    assert data["hide_server_wide_links"] is False, (
        f"Expected hide_server_wide_links=False, got {data['hide_server_wide_links']}"
    )
