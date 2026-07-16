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


async def _create_study(
    client: httpx.AsyncClient, study_name_short: str, study_name: str
) -> None:
    activities_payload = _load_activities_template()
    payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": study_name,
                "name_short": study_name_short,
                "description": "Integration test study for rename",
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
                "activities_json_data": {"en": activities_payload},
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
    assert response.status_code == 200
    response_json = response.json()
    assert response_json["summary"]["created"] == 1
    assert response_json["summary"]["failed"] == 0


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


@pytest.mark.asyncio
async def test_admin_rename_study_name(created_studies_for_cleanup):
    """Rename the display name of a study."""
    study_short = f"it_rn_{uuid.uuid4().hex[:8]}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        await _create_study(client, study_short, f"Original Name {study_short}")
        created_studies_for_cleanup.append(study_short)

        response = await client.patch(
            f"{BASE_URL}/api/admin/studies/{study_short}/rename",
            json={"name": f"Renamed Study {study_short}"},
            auth=ADMIN_AUTH,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == f"Renamed Study {study_short}"
        assert data["name_short"] == study_short


@pytest.mark.asyncio
async def test_admin_rename_study_name_short(created_studies_for_cleanup):
    """Rename the short name of a study — the URL key that changes."""
    study_short = f"it_rns_{uuid.uuid4().hex[:8]}"
    new_short = f"{study_short}_new"
    async with httpx.AsyncClient(timeout=60.0) as client:
        await _create_study(client, study_short, f"Study {study_short}")
        created_studies_for_cleanup.append(study_short)
        created_studies_for_cleanup.append(new_short)

        response = await client.patch(
            f"{BASE_URL}/api/admin/studies/{study_short}/rename",
            json={"name_short": new_short},
            auth=ADMIN_AUTH,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["name_short"] == new_short

        # Old name_short should now be 404
        old_response = await client.get(
            f"{BASE_URL}/api/admin/studies/{study_short}/available-activities-summary",
            auth=ADMIN_AUTH,
        )
        assert old_response.status_code == 404

        # New name_short should resolve
        new_response = await client.get(
            f"{BASE_URL}/api/admin/studies/{new_short}/available-activities-summary",
            auth=ADMIN_AUTH,
        )
        assert new_response.status_code == 200


@pytest.mark.asyncio
async def test_admin_rename_both(created_studies_for_cleanup):
    """Rename both name and name_short at once."""
    study_short = f"it_rnb_{uuid.uuid4().hex[:8]}"
    new_short = f"{study_short}_v2"
    async with httpx.AsyncClient(timeout=60.0) as client:
        await _create_study(client, study_short, f"Old Name {study_short}")
        created_studies_for_cleanup.append(study_short)
        created_studies_for_cleanup.append(new_short)

        response = await client.patch(
            f"{BASE_URL}/api/admin/studies/{study_short}/rename",
            json={"name": f"New Name {study_short}", "name_short": new_short},
            auth=ADMIN_AUTH,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == f"New Name {study_short}"
        assert data["name_short"] == new_short


@pytest.mark.asyncio
async def test_admin_rename_unauthorized():
    """Rename requires admin auth."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.patch(
            f"{BASE_URL}/api/admin/studies/some_study/rename",
            json={"name": "X"},
        )
        assert response.status_code == 401


@pytest.mark.asyncio
async def test_admin_rename_not_found():
    """Renaming a non-existent study returns 404."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.patch(
            f"{BASE_URL}/api/admin/studies/nonexistent_xyz_123/rename",
            json={"name": "Nope"},
            auth=ADMIN_AUTH,
        )
        assert response.status_code == 404


@pytest.mark.asyncio
async def test_admin_rename_no_changes(created_studies_for_cleanup):
    """Sending the same values as current returns 400."""
    study_short = f"it_rnc_{uuid.uuid4().hex[:8]}"
    study_name = f"Static Name {study_short}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        await _create_study(client, study_short, study_name)
        created_studies_for_cleanup.append(study_short)

        response = await client.patch(
            f"{BASE_URL}/api/admin/studies/{study_short}/rename",
            json={"name": study_name, "name_short": study_short},
            auth=ADMIN_AUTH,
        )
        assert response.status_code == 400
        assert "No changes" in response.json()["detail"]


@pytest.mark.asyncio
async def test_admin_rename_empty_payload(created_studies_for_cleanup):
    """Sending an empty body returns 400."""
    study_short = f"it_rne_{uuid.uuid4().hex[:8]}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        await _create_study(client, study_short, f"Empty Payload Study {study_short}")
        created_studies_for_cleanup.append(study_short)

        response = await client.patch(
            f"{BASE_URL}/api/admin/studies/{study_short}/rename",
            json={},
            auth=ADMIN_AUTH,
        )
        assert response.status_code == 400
        assert "At least one" in response.json()["detail"]


@pytest.mark.asyncio
async def test_admin_rename_duplicate_name(created_studies_for_cleanup):
    """Renaming to a name that another study already uses returns 400."""
    short_a = f"it_rnd_a_{uuid.uuid4().hex[:6]}"
    short_b = f"it_rnd_b_{uuid.uuid4().hex[:6]}"
    name_a = f"Study A {short_a}"
    name_b = f"Study B {short_b}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        await _create_study(client, short_a, name_a)
        await _create_study(client, short_b, name_b)
        created_studies_for_cleanup.append(short_a)
        created_studies_for_cleanup.append(short_b)

        response = await client.patch(
            f"{BASE_URL}/api/admin/studies/{short_a}/rename",
            json={"name": name_b},
            auth=ADMIN_AUTH,
        )
        assert response.status_code == 400
        assert "already uses" in response.json()["detail"]


@pytest.mark.asyncio
async def test_admin_rename_duplicate_name_short(created_studies_for_cleanup):
    """Renaming to a short name that another study already uses returns 400."""
    short_a = f"it_rnsd_a_{uuid.uuid4().hex[:6]}"
    short_b = f"it_rnsd_b_{uuid.uuid4().hex[:6]}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        await _create_study(client, short_a, f"Study A {short_a}")
        await _create_study(client, short_b, f"Study B {short_b}")
        created_studies_for_cleanup.append(short_a)
        created_studies_for_cleanup.append(short_b)

        response = await client.patch(
            f"{BASE_URL}/api/admin/studies/{short_a}/rename",
            json={"name_short": short_b},
            auth=ADMIN_AUTH,
        )
        assert response.status_code == 400
        assert "already exists" in response.json()["detail"]


@pytest.mark.asyncio
async def test_copy_day_not_found_study():
    """Copy endpoint returns 404 for non-existent study."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{BASE_URL}/api/studies/nonexistent_xyz/participants/test_pid/day_labels/tuesday/copy-from/monday",
        )
        assert response.status_code == 404


@pytest.mark.asyncio
async def test_copy_day_not_found_target_day(created_studies_for_cleanup):
    """Copy endpoint returns 404 for non-existent target day."""
    study_short = f"it_cp_{uuid.uuid4().hex[:8]}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        await _create_study(client, study_short, f"Copy Study {study_short}")
        created_studies_for_cleanup.append(study_short)

        response = await client.post(
            f"{BASE_URL}/api/studies/{study_short}/participants/test_pid/day_labels/nonexistent_day/copy-from/monday",
        )
        assert response.status_code == 404


@pytest.mark.asyncio
async def test_copy_day_not_found_source_day(created_studies_for_cleanup):
    """Copy endpoint returns 404 for non-existent source day."""
    study_short = f"it_cps_{uuid.uuid4().hex[:8]}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        await _create_study(client, study_short, f"Copy Source Study {study_short}")
        created_studies_for_cleanup.append(study_short)

        response = await client.post(
            f"{BASE_URL}/api/studies/{study_short}/participants/test_pid/day_labels/monday/copy-from/nonexistent",
        )
        assert response.status_code == 404


@pytest.mark.asyncio
async def test_copy_day_same_day_rejected(created_studies_for_cleanup):
    """Copy endpoint returns 400 when source and target are the same."""
    study_short = f"it_cpss_{uuid.uuid4().hex[:8]}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        await _create_study(client, study_short, f"Same-Day Copy Study {study_short}")
        created_studies_for_cleanup.append(study_short)

        response = await client.post(
            f"{BASE_URL}/api/studies/{study_short}/participants/test_pid/day_labels/monday/copy-from/monday",
        )
        assert response.status_code == 400


@pytest.mark.asyncio
async def test_copy_day_empty_source(created_studies_for_cleanup):
    """Copy endpoint returns 404 when source day has no activities."""
    study_short = f"it_cpes_{uuid.uuid4().hex[:8]}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        activities_payload = _load_activities_template()
        payload = {
            "mode": "create_only",
            "transaction_mode": "all_or_nothing",
            "studies": [
                {
                    "name": f"Empty Source Study {study_short}",
                    "name_short": study_short,
                    "description": "Test",
                    "day_labels": [
                        {
                            "name": "monday",
                            "display_order": 0,
                            "display_names": {"en": "Monday"},
                        },
                        {
                            "name": "tuesday",
                            "display_order": 1,
                            "display_names": {"en": "Tuesday"},
                        },
                    ],
                    "study_participant_ids": [],
                    "allow_unlisted_participants": True,
                    "default_language": "en",
                    "supported_languages": ["en"],
                    "activities_json_data": {"en": activities_payload},
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
        assert response.status_code == 200
        created_studies_for_cleanup.append(study_short)

        response = await client.post(
            f"{BASE_URL}/api/studies/{study_short}/participants/test_pid/day_labels/tuesday/copy-from/monday",
        )
        assert response.status_code == 404
        assert "no activities" in response.json()["detail"].lower()
