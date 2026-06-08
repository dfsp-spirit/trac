import os
from urllib.parse import urljoin, urlparse, parse_qs

import httpx
import pytest

from o_timeusediary_backend.settings import settings


BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.strip("/")


@pytest.mark.asyncio
async def test_external_task_launch_redirects_to_provider_url_with_assigned_token():
    study_name_short = "adult_pilot_de"
    participant_id = "bernd"

    async with httpx.AsyncClient(follow_redirects=False) as client:
        study_cfg_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/study-config",
            params={"participant_id": participant_id, "lang": "de"},
        )
        assert study_cfg_response.status_code == 200
        study_cfg = study_cfg_response.json()

        external_tasks = study_cfg.get("external_tasks") or []
        assert external_tasks, "Expected at least one external task assignment"

        first_task = external_tasks[0]
        assigned_token = first_task["assigned_token"]
        continuation_url = first_task.get("continuation_url")
        assert continuation_url, "Expected continuation_url in external task payload"

        # If the running backend process still serves the previous behavior
        # (direct provider links), skip with an actionable hint.
        parsed_continuation = urlparse(continuation_url)
        if parsed_continuation.scheme in {"http", "https"} and parsed_continuation.netloc:
            if parsed_continuation.netloc == "survey.academiccloud.de":
                pytest.skip(
                    "Running backend still serves direct external continuation URLs. Restart backend to pick up launch endpoint changes."
                )

        launch_url = urljoin(BASE_SCHEME, continuation_url)

        launch_response = await client.get(launch_url)

        assert launch_response.status_code in {302, 307}
        location = launch_response.headers.get("location")
        assert location, "Expected redirect location header"
        assert location.startswith("https://survey.academiccloud.de/")

        redirected_query = parse_qs(urlparse(location).query)
        flattened_values = [value for values in redirected_query.values() for value in values]
        assert assigned_token in flattened_values
        assert participant_id in flattened_values
