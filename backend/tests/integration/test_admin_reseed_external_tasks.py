import os

import httpx
import pytest

from o_timeusediary_backend.settings import settings


BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.strip("/")
ADMIN_AUTH = (settings.admin_username, settings.admin_password)


@pytest.mark.asyncio
async def test_admin_reseed_external_tasks_for_participant():
    study_name_short = "adult_pilot_de"
    participant_id = "bernd"

    async with httpx.AsyncClient() as client:
        reseed_response = await client.post(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/participants/{participant_id}/external-tasks/reseed",
            auth=ADMIN_AUTH,
        )
        assert reseed_response.status_code == 200
        reseed_data = reseed_response.json()
        assert reseed_data["study_name_short"] == study_name_short
        assert reseed_data["participant_id"] == participant_id
        assert reseed_data["assignment_count"] >= 2

        study_cfg_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/study-config",
            params={"participant_id": participant_id, "lang": "de"},
        )
        assert study_cfg_response.status_code == 200
        study_cfg = study_cfg_response.json()
        assert isinstance(study_cfg.get("external_tasks"), list)
        assert len(study_cfg.get("external_tasks") or []) >= 2
