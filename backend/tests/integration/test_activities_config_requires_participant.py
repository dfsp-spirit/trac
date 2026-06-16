import os

import httpx
import pytest

from o_timeusediary_backend.settings import settings


BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.strip("/")


@pytest.mark.asyncio
async def test_activities_config_requires_participant_for_restricted_study():
    """Ensure that requesting activities-config for a restricted study without
    a participant_id returns a 400 error, and succeeds when a valid pid is provided.
    """
    study_name_short = "adult_pilot_de2"
    async with httpx.AsyncClient() as client:
        # 1) Request WITHOUT participant_id -> should be rejected (400)
        resp_no_pid = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/activities-config"
        )
        assert resp_no_pid.status_code == 400, (
            f"Expected 400 when requesting activities-config without participant_id for restricted study, got {resp_no_pid.status_code}: {resp_no_pid.text}"
        )

        # Response body should include a helpful message
        try:
            payload = resp_no_pid.json()
        except Exception:
            payload = {"detail": resp_no_pid.text}

        assert "participant" in str(payload.get("detail", "")).lower() or "participant_id" in str(payload.get("detail", "")).lower()

        # 2) Request WITH a valid participant_id -> should succeed (200)
        resp_with_pid = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/activities-config",
            params={"participant_id": "bernd"},
        )
        assert resp_with_pid.status_code == 200, (
            f"Expected 200 when requesting activities-config with valid participant_id, got {resp_with_pid.status_code}: {resp_with_pid.text}"
        )
