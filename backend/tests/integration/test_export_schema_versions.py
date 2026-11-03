"""Schema versions travel with the files they describe.

The runtime-config export is re-importable, so the version must sit in the part
that gets parsed (``studies_config`` / ``studies_config.json`` inside the ZIP),
not only in a surrounding manifest that an importer may never read.

Requires a running backend (see ``./test_backend_integration.sh``).
"""

import json
import os
import uuid
import zipfile
from io import BytesIO

import httpx
import pytest

from o_timeusediary_backend.formats import (
    ACTIVITIES_SCHEMA_VERSION,
    EXPORT_SCHEMA_VERSION,
    EXPORT_SCHEMA_VERSION_HEADER,
    STUDIES_CONFIG_SCHEMA_VERSION,
)
from o_timeusediary_backend.settings import settings

BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.strip("/")
ADMIN_AUTH = (settings.admin_username, settings.admin_password)


@pytest.mark.asyncio
async def test_embedded_export_declares_its_schema_version():
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(
            f"{BASE_URL}/api/admin/export/studies-runtime-config",
            params={"study_name": "default", "mode": "embedded_json"},
            auth=ADMIN_AUTH,
        )

    assert response.status_code == 200, response.text
    payload = response.json()

    # Bundle level (describes the whole file) ...
    assert payload["schema_version"] == STUDIES_CONFIG_SCHEMA_VERSION
    # ... and with the part that is parsed back, so a bare studies_config is
    # self-describing too.
    assert payload["studies_config"]["schema_version"] == STUDIES_CONFIG_SCHEMA_VERSION

    activities = payload["activities"]["default"]
    for language, activities_payload in activities.items():
        assert activities_payload["general"]["schema_version"] == (
            ACTIVITIES_SCHEMA_VERSION
        ), language


@pytest.mark.asyncio
async def test_split_zip_export_declares_its_schema_version():
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(
            f"{BASE_URL}/api/admin/export/studies-runtime-config",
            params={"study_name": "default", "mode": "split_zip"},
            auth=ADMIN_AUTH,
        )

    assert response.status_code == 200, response.text
    archive = zipfile.ZipFile(BytesIO(response.content))

    studies_config = json.loads(archive.read("studies_config.json").decode("utf-8"))
    assert studies_config["schema_version"] == STUDIES_CONFIG_SCHEMA_VERSION

    manifest = json.loads(archive.read("export_manifest.json").decode("utf-8"))
    assert manifest["schema_version"] == STUDIES_CONFIG_SCHEMA_VERSION

    # Every split activities file carries its own version.
    activities_members = [
        name
        for name in archive.namelist()
        if "activities" in name and name.endswith(".json")
    ]
    assert activities_members, archive.namelist()
    for member in activities_members:
        activities_payload = json.loads(archive.read(member).decode("utf-8"))
        assert (
            activities_payload["general"]["schema_version"] == ACTIVITIES_SCHEMA_VERSION
        ), member


@pytest.mark.asyncio
async def test_versioned_export_imports_back_through_the_api():
    """An exported studies_config object can be posted back unchanged."""
    clone_name_short = f"it_ver_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        export_response = await client.get(
            f"{BASE_URL}/api/admin/export/studies-runtime-config",
            params={"study_name": "default", "mode": "embedded_json"},
            auth=ADMIN_AUTH,
        )
        assert export_response.status_code == 200, export_response.text
        studies_config = export_response.json()["studies_config"]

        import_study = dict(studies_config["studies"][0])
        import_study["name_short"] = clone_name_short
        import_study["name"] = f"{import_study['name']} (Versioned Import)"

        try:
            import_response = await client.post(
                f"{BASE_URL}/api/admin/studies/import-config",
                auth=ADMIN_AUTH,
                json={
                    "schema_version": studies_config["schema_version"],
                    "mode": "create_only",
                    "transaction_mode": "all_or_nothing",
                    "studies": [import_study],
                },
            )
            assert import_response.status_code == 200, import_response.text
            assert import_response.json()["summary"]["created"] == 1
        finally:
            await client.delete(
                f"{BASE_URL}/api/admin/studies/{clone_name_short}", auth=ADMIN_AUTH
            )


@pytest.mark.asyncio
async def test_a_newer_studies_config_is_rejected_by_file_validation():
    """A file from a future TRAC must fail loudly, not be parsed leniently."""
    studies_config = {
        "schema_version": STUDIES_CONFIG_SCHEMA_VERSION + 1,
        "studies": [
            {
                "name": "From The Future",
                "name_short": f"it_future_{uuid.uuid4().hex[:8]}",
                "day_labels": [
                    {
                        "name": "day1",
                        "display_order": 0,
                        "display_names": {"en": "Day 1"},
                    }
                ],
                "default_language": "en",
                "supported_languages": ["en"],
                "activities_json_data": {},
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ],
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{BASE_URL}/api/admin/validate/files",
            data={"mode": "full_study_embedded"},
            files={
                "studies_config_file": (
                    "studies_config.json",
                    json.dumps(studies_config),
                    "application/json",
                )
            },
            auth=ADMIN_AUTH,
        )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["ok"] is False
    messages = " ".join(error["message"] for error in payload["errors"])
    assert "newer TRAC" in messages
    assert str(STUDIES_CONFIG_SCHEMA_VERSION + 1) in messages


@pytest.mark.asyncio
async def test_csv_and_json_exports_report_their_schema_version():
    async with httpx.AsyncClient(timeout=60.0) as client:
        csv_response = await client.get(
            f"{BASE_URL}/api/admin/export/default/participants",
            params={"format": "csv", "only_with_client_info": False},
            auth=ADMIN_AUTH,
        )
        json_response = await client.get(
            f"{BASE_URL}/api/admin/export/default/participants",
            params={"format": "json", "only_with_client_info": False},
            auth=ADMIN_AUTH,
        )

    # The default study has participants in the integration database.
    assert csv_response.status_code == 200, csv_response.text
    csv_version = csv_response.headers[EXPORT_SCHEMA_VERSION_HEADER]
    assert csv_version

    assert json_response.status_code == 200, json_response.text
    metadata = json_response.json()["metadata"]
    assert metadata["schema_version"] == int(csv_version)
    assert metadata["schema_version"] == EXPORT_SCHEMA_VERSION
    # The legacy string key keeps its documented meaning: export schema version.
    assert metadata["version"] == str(metadata["schema_version"])
    assert metadata["tud_backend_version"]


@pytest.mark.asyncio
async def test_import_config_refuses_a_newer_schema_version():
    """The API must reject a newer payload, not interpret it with old field meanings."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            auth=ADMIN_AUTH,
            json={
                "schema_version": STUDIES_CONFIG_SCHEMA_VERSION + 1,
                "mode": "create_only",
                "transaction_mode": "all_or_nothing",
                "studies": [],
            },
        )

    assert response.status_code == 422, response.text
