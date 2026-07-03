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
            exported_embedded_study = embedded_export_payload["studies_config"][
                "studies"
            ][0]

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
                    (
                        "studies_config.json",
                        zip_studies_config_bytes,
                        "application/json",
                    ),
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


@pytest.mark.asyncio
async def test_runtime_export_import_roundtrip_external_tasks_closed_study():
    """Export/import roundtrip for a closed study with external tasks + per-participant tokens."""
    source_study_name_short = "adult_pilot_de"
    embedded_clone_name_short = f"it_rt_ext_emb_{uuid.uuid4().hex[:8]}"
    zip_clone_name_short = f"it_rt_ext_zip_{uuid.uuid4().hex[:8]}"

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
            exported_embedded_study = embedded_export_payload["studies_config"][
                "studies"
            ][0]

            # Verify external_tasks are present in the export
            assert "external_tasks" in exported_embedded_study
            exported_ext_tasks = exported_embedded_study["external_tasks"]
            assert len(exported_ext_tasks) == 2
            task_keys_exported = sorted(t["task_key"] for t in exported_ext_tasks)
            assert task_keys_exported == ["depression_survey", "payment_info"]

            # Verify per-participant tokens are preserved
            for task in exported_ext_tasks:
                assert len(task.get("outbound_tokens", [])) > 0
                for token_def in task["outbound_tokens"]:
                    assert "by_participant" in token_def
                    assert len(token_def["by_participant"]) > 0

            embedded_import_study = dict(exported_embedded_study)
            embedded_import_study["name_short"] = embedded_clone_name_short
            embedded_import_study["name"] = (
                f"{embedded_import_study['name']} (Roundtrip Ext Embedded)"
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

            # Verify imported study has external_tasks via study-config API
            embedded_verify_response = await client.get(
                f"{BASE_URL}/api/studies/{embedded_clone_name_short}/study-config",
                params={"participant_id": "bernd", "lang": "de"},
            )
            assert embedded_verify_response.status_code == 200
            embedded_verify_payload = embedded_verify_response.json()
            assert "external_tasks" in embedded_verify_payload
            assert len(embedded_verify_payload["external_tasks"]) == 2
            assert (
                embedded_verify_payload["require_diary_before_external_tasks"] is True
            )

            # Also verify activities config is intact
            embedded_activities_response = await client.get(
                f"{BASE_URL}/api/studies/{embedded_clone_name_short}/activities-config",
                params={"participant_id": "bernd", "lang": "de"},
            )
            assert embedded_activities_response.status_code == 200
            assert "timeline" in embedded_activities_response.json()

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
            zip_study = studies_config_in_zip["studies"][0]

            # Verify external_tasks in ZIP export
            assert "external_tasks" in zip_study
            assert len(zip_study["external_tasks"]) == 2

            zip_import_study = dict(zip_study)
            zip_import_study["name_short"] = zip_clone_name_short
            zip_import_study["name"] = f"{zip_import_study['name']} (Roundtrip Ext ZIP)"

            zip_studies_config_bytes = json.dumps(
                {"studies": [zip_import_study]},
                indent=2,
                ensure_ascii=False,
            ).encode("utf-8")

            upload_files = [
                (
                    "studies_config_file",
                    (
                        "studies_config.json",
                        zip_studies_config_bytes,
                        "application/json",
                    ),
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
                f"{BASE_URL}/api/studies/{zip_clone_name_short}/study-config",
                params={"participant_id": "bernd", "lang": "de"},
            )
            assert zip_verify_response.status_code == 200
            zip_verify_payload = zip_verify_response.json()
            assert "external_tasks" in zip_verify_payload
            assert len(zip_verify_payload["external_tasks"]) == 2

            zip_activities_response = await client.get(
                f"{BASE_URL}/api/studies/{zip_clone_name_short}/activities-config",
                params={"participant_id": "bernd", "lang": "de"},
            )
            assert zip_activities_response.status_code == 200
            assert "timeline" in zip_activities_response.json()
        finally:
            for study_name_short in [embedded_clone_name_short, zip_clone_name_short]:
                await client.delete(
                    f"{BASE_URL}/api/admin/studies/{study_name_short}",
                    auth=ADMIN_AUTH,
                )


@pytest.mark.asyncio
async def test_runtime_export_import_roundtrip_external_tasks_open_study():
    """Export a closed study with external tasks, convert to open study, re-import and verify."""
    source_study_name_short = "adult_pilot_de"
    open_clone_name_short = f"it_rt_ext_open_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient() as client:
        try:
            export_response = await client.get(
                f"{BASE_URL}/api/admin/export/studies-runtime-config",
                params={"study_name": source_study_name_short, "mode": "embedded_json"},
                auth=ADMIN_AUTH,
            )
            assert export_response.status_code == 200

            export_payload = export_response.json()
            exported_study = export_payload["studies_config"]["studies"][0]

            # Verify external tasks exist in the source export
            assert "external_tasks" in exported_study
            assert len(exported_study["external_tasks"]) == 2

            # Convert to open study: allow unlisted participants, clear participant IDs,
            # and convert by_participant tokens to open_pool format required for open studies.
            open_study = dict(exported_study)
            open_study["name_short"] = open_clone_name_short
            open_study["name"] = f"{open_study['name']} (Roundtrip Open Ext)"
            open_study["allow_unlisted_participants"] = True
            open_study["study_participant_ids"] = []

            for task in open_study.get("external_tasks", []):
                for token_def in task.get("outbound_tokens", []):
                    by_participant = token_def.pop("by_participant", {})
                    all_tokens = list(by_participant.values())
                    token_def["open_pool"] = all_tokens

            import_response = await client.post(
                f"{BASE_URL}/api/admin/studies/import-config",
                auth=ADMIN_AUTH,
                json={
                    "mode": "create_only",
                    "transaction_mode": "all_or_nothing",
                    "studies": [open_study],
                },
            )
            assert import_response.status_code == 200
            import_result = import_response.json()
            assert import_result["summary"]["created"] == 1
            assert import_result["summary"]["failed"] == 0

            # Verify the imported open study via study-config (no participant_id for open studies)
            verify_response = await client.get(
                f"{BASE_URL}/api/studies/{open_clone_name_short}/study-config",
                params={"lang": "de"},
            )
            assert verify_response.status_code == 200
            verify_payload = verify_response.json()
            assert verify_payload["require_diary_before_external_tasks"] is True

            # Verify external tasks are preserved by re-exporting via admin API
            reopen_export_response = await client.get(
                f"{BASE_URL}/api/admin/export/studies-runtime-config",
                params={"study_name": open_clone_name_short, "mode": "embedded_json"},
                auth=ADMIN_AUTH,
            )
            assert reopen_export_response.status_code == 200
            reopen_payload = reopen_export_response.json()
            reopened_study = reopen_payload["studies_config"]["studies"][0]
            assert "external_tasks" in reopened_study
            assert len(reopened_study["external_tasks"]) == 2
            # Verify open_pool format was preserved
            for task in reopened_study["external_tasks"]:
                for token_def in task.get("outbound_tokens", []):
                    assert "open_pool" in token_def
                    assert len(token_def["open_pool"]) > 0

            # Verify activities config (open study, no participant_id needed)
            activities_response = await client.get(
                f"{BASE_URL}/api/studies/{open_clone_name_short}/activities-config",
                params={"lang": "de"},
            )
            assert activities_response.status_code == 200
            assert "timeline" in activities_response.json()
        finally:
            await client.delete(
                f"{BASE_URL}/api/admin/studies/{open_clone_name_short}",
                auth=ADMIN_AUTH,
            )
