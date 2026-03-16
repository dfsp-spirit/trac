import pytest
import httpx
import os

# import settings.py to get BASE_URL from environment variables
from o_timeusediary_backend.settings import settings


# Get the base URL from environment (default to CI Nginx port)
# In your CI, you will set BASE_URL=http://localhost:3000/tud_backend
BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.rstrip("/")  # Ensure no trailing slash


@pytest.mark.asyncio
async def test_api_root_through_proxy():
    """
    Test the root /api endpoint via the reverse proxy to verify
    root_path configuration and Nginx routing.
    """
    # Construct the full URL
    url = f"{BASE_URL}/api"
    print(f"Trying to reach backend at: {url} (rootpath is set to: '{settings.rootpath}')")

    async with httpx.AsyncClient() as client:
        response = await client.get(url)

    # Assertions
    assert response.status_code == 200
    data = response.json()
    assert "message" in data
    assert "is running" in data["message"]
    print(f"Successfully reached proxy at: {url} (rootpath is set to: '{settings.rootpath}')")