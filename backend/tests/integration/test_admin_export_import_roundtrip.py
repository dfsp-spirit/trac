import json
import os
import uuid
import zipfile
from io import BytesIO
from pathlib import PurePosixPath

import httpx
import pytest

from o_timeusediary_backend.settings import settings


BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.strip("/")
ADMIN_AUTH = (settings.admin_username, settings.admin_password)


@pytest.mark.asyncio
async def test_runtime_export_import_roundtrip_embedded_and_split_zip():
    source_study_name_short = "default"
    embedded_clone_name_short = f"it_rt_emb_{uuid.uuid4().hex[:8]}"
    zip_clone_name_short = f"it_rt_zip_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient() as client:
        try:
            # Roundtrip 1: export embedded JSON -> import-config endpoint
            embedded_export_response = await client.get(
                f"{BASE_URL}/api/admin/export/studies-runtime-config",
                params={"study_name": source_study_name_short, "mode": "embedded_json"},
                auth=ADMIN_AUTH,
            )
            assert embedded_export_response.status_code == 200

            embedded_export_payload = embedded_export_response.json()
            exported_embedded_study = embedded_export_payload["studies_config"]["studies"][0]

            embedded_import_study = dict(exported_embedded_study)
            embedded_import_study["name_short"] = embedded_clone_name_short
            embedded_import_study["name"] = (
                f"{embedded_import_study['name']} (Roundtrip Embedded)"
            )

            embedded_import_response = await client.post(
                f"{BASE_URL}/api/admin/studies/import-config",
                auth=ADMIN_AUTH,
                json={
                    "mode": "create_only",
                    "transaction_mode": "all_or_nothing",
                    "studies": [embedded_import_study],
                },
            )
            assert embedded_import_response.status_code == 200
            embedded_import_result = embedded_import_response.json()
            assert embedded_import_result["summary"]["created"] == 1
            assert embedded_import_result["summary"]["failed"] == 0

            embedded_verify_response = await client.get(
                f"{BASE_URL}/api/studies/{embedded_clone_name_short}/activities-config"
            )
            assert embedded_verify_response.status_code == 200
            embedded_verify_payload = embedded_verify_response.json()
            assert "timeline" in embedded_verify_payload

            # Roundtrip 2: export split ZIP -> create-from-files endpoint
            split_export_response = await client.get(
                f"{BASE_URL}/api/admin/export/studies-runtime-config",
                params={"study_name": source_study_name_short, "mode": "split_zip"},
                auth=ADMIN_AUTH,
            )
            assert split_export_response.status_code == 200
            assert "application/zip" in split_export_response.headers.get(
                "Content-Type", ""
            )

            archive = zipfile.ZipFile(BytesIO(split_export_response.content))
            studies_config_in_zip = json.loads(
                archive.read("studies_config.json").decode("utf-8")
            )
            assert len(studies_config_in_zip["studies"]) == 1

            zip_import_study = dict(studies_config_in_zip["studies"][0])
            zip_import_study["name_short"] = zip_clone_name_short
            zip_import_study["name"] = f"{zip_import_study['name']} (Roundtrip ZIP)"

            zip_studies_config_bytes = json.dumps(
                {"studies": [zip_import_study]},
                indent=2,
                ensure_ascii=False,
            ).encode("utf-8")

            upload_files = [
                (
                    "studies_config_file",
                    ("studies_config.json", zip_studies_config_bytes, "application/json"),
                )
            ]

            for relative_path in sorted(
                set(zip_import_study["activities_json_files"].values())
            ):
                basename = PurePosixPath(relative_path).name
                upload_files.append(
                    (
                        "activities_files",
                        (
                            basename,
                            archive.read(relative_path),
                            "application/json",
                        ),
                    )
                )

            zip_import_response = await client.post(
                f"{BASE_URL}/api/admin/studies/create-from-files",
                auth=ADMIN_AUTH,
                data={"mode": "full_study"},
                files=upload_files,
            )
            assert zip_import_response.status_code == 200
            zip_import_result = zip_import_response.json()
            assert zip_import_result.get("ok") is True
            assert zip_import_result.get("summary", {}).get("study_name_short") == (
                zip_clone_name_short
            )

            zip_verify_response = await client.get(
                f"{BASE_URL}/api/studies/{zip_clone_name_short}/activities-config"
            )
            assert zip_verify_response.status_code == 200
            zip_verify_payload = zip_verify_response.json()
            assert "timeline" in zip_verify_payload
        finally:
            for study_name_short in [embedded_clone_name_short, zip_clone_name_short]:
                await client.delete(
                    f"{BASE_URL}/api/admin/studies/{study_name_short}",
                    auth=ADMIN_AUTH,
                )
