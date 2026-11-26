import json
import os
import uuid
import zipfile
from io import BytesIO
from pathlib import Path, PurePosixPath

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
            # Shortcut groups are study configuration, so a backup without them
            # would silently remove the copy dialog's buttons on restore.
            exported_group_keys = [
                group["key"] for group in exported_embedded_study["day_groups"]
            ]
            assert exported_group_keys

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

            clone_diary_response = await client.get(
                f"{BASE_URL}/api/studies/{embedded_clone_name_short}"
                "/participants/p_roundtrip_diary/diary"
            )
            assert clone_diary_response.status_code == 200
            clone_groups = clone_diary_response.json()["day_groups"]
            assert [group["key"] for group in clone_groups] == exported_group_keys
            # The clone resolves the names to the same day indexes the export
            # listed them under.
            day_index_by_name = {
                label["name"]: label["display_order"]
                for label in exported_embedded_study["day_labels"]
            }
            assert [group["day_indexes"] for group in clone_groups] == [
                [day_index_by_name[name] for name in group["days"]]
                for group in exported_embedded_study["day_groups"]
            ]

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
            # Shortcut groups are study configuration, so a backup without them
            # would silently remove the copy dialog's buttons on restore.
            exported_group_keys = [
                group["key"] for group in exported_embedded_study["day_groups"]
            ]
            assert exported_group_keys

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


def _load_activities_for_language(language: str) -> dict:
    backend_root = Path(__file__).resolve().parents[2]
    filename = (
        "activities_ki_adults_en.json"
        if language == "en"
        else "activities_ki_adults_sv.json"
    )
    return json.loads((backend_root / filename).read_text(encoding="utf-8"))


def _kitchen_sink_study_payload(name_short: str, name: str) -> dict:
    """A study that sets every backup-relevant field to a non-default value."""
    languages = ["en", "sv"]
    return {
        "name": name,
        "name_short": name_short,
        "description": {
            "en": "Kitchen sink description (EN)",
            "sv": "Kitchen sink description (SV)",
        },
        "day_labels": [
            {
                "name": "monday",
                "display_order": 0,
                "display_names": {"en": "Monday", "sv": "Måndag"},
            },
            {
                "name": "tuesday",
                "display_order": 1,
                "display_names": {"en": "Tuesday", "sv": "Tisdag"},
            },
        ],
        "day_groups": [
            {
                "key": "workdays",
                "names": {"en": "All work days", "sv": "Alla arbetsdagar"},
                "days": ["monday", "tuesday"],
            }
        ],
        "study_participant_ids": ["p1", "p2"],
        "participant_display_names": {"p1": "Alice"},
        "allow_unlisted_participants": False,
        "is_listed_publicly": False,
        "require_consent": True,
        "allow_skip_timeuse": True,
        "is_paused": True,
        "require_diary_before_external_tasks": True,
        "save_browser_identification": True,
        "save_ux_events": True,
        "default_language": "en",
        "supported_languages": languages,
        "activities_json_data": {
            language: _load_activities_for_language(language) for language in languages
        },
        "study_text_intro": {
            "en": "Welcome (EN)",
            "sv": "Välkommen (SV)",
        },
        "study_text_instructions_title": {
            "en": "Instructions (EN)",
            "sv": "Instruktioner (SV)",
        },
        "study_text_instructions": {
            "en": "How to fill this out (EN)",
            "sv": "Så fyller du i (SV)",
        },
        "study_text_consent": {
            "en": "Please consent (EN)",
            "sv": "Samtyck (SV)",
        },
        "study_text_end_noconsent": {
            "en": "No consent (EN)",
            "sv": "Inget samtycke (SV)",
        },
        "study_text_end_completed": {
            "en": "Completed (EN)",
            "sv": "Klar (SV)",
        },
        "study_text_end_skipped": {
            "en": "Skipped (EN)",
            "sv": "Hoppade över (SV)",
        },
        "inactivity_page_custom_text": {
            "en": "Session timeout (EN)",
            "sv": "Sessionen löpte ut (SV)",
        },
        "data_collection_start": "2024-01-01T00:00:00Z",
        "data_collection_end": "2028-12-31T23:59:59Z",
        "day_start_minutes": 240,
        "num_recent_activities_shown": 2,
        "time_step_minutes": 5,
        "min_duration_minutes": 10,
        "inactivity_timeout_minutes": 20,
        "footer_links": [
            {
                "title": {
                    "en": "Study information",
                    "sv": "Studieinformation",
                },
                "target_url": "https://example.org/study-info",
            }
        ],
        "hide_server_wide_links": True,
        "external_tasks": [
            {
                "task_key": "payment",
                "name": {"en": "Payment survey", "sv": "Betalningsenkät"},
                "description": {
                    "en": "Complete the payment survey.",
                    "sv": "Fyll i betalningsenkäten.",
                },
                "outbound_url": (
                    "https://example.org/payment?pid={participant_id}"
                    "&study={study_name}&task={task_key}&survey_token={survey_token}"
                ),
                "confirmation_type": "none",
                "outbound_tokens": [
                    {
                        "name": "survey_token",
                        "by_participant": {"p1": "tok-1", "p2": "tok-2"},
                    }
                ],
            }
        ],
    }


def _without_identity_fields(exported_study: dict) -> dict:
    normalized = dict(exported_study)
    normalized["name"] = "<changed for roundtrip>"
    normalized["name_short"] = "<changed for roundtrip>"
    return normalized


@pytest.mark.asyncio
async def test_runtime_export_is_lossless_for_every_backup_field():
    """Exporting, re-importing and exporting again must preserve every setting.

    This is deliberately an equality test: the earlier roundtrip tests only
    checked that an import succeeded and that a handful of fields survived,
    which let missing fields default silently on import.
    """
    source_short = f"it_lossless_src_{uuid.uuid4().hex[:8]}"
    clone_short = f"it_lossless_clone_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            import_response = await client.post(
                f"{BASE_URL}/api/admin/studies/import-config",
                auth=ADMIN_AUTH,
                json={
                    "mode": "create_only",
                    "transaction_mode": "all_or_nothing",
                    "studies": [
                        _kitchen_sink_study_payload(
                            source_short, "Lossless Roundtrip Source"
                        )
                    ],
                },
            )
            assert import_response.status_code == 200, import_response.text
            assert import_response.json()["summary"]["created"] == 1

            source_export_response = await client.get(
                f"{BASE_URL}/api/admin/export/studies-runtime-config",
                params={"study_name": source_short, "mode": "embedded_json"},
                auth=ADMIN_AUTH,
            )
            assert source_export_response.status_code == 200
            source_export = source_export_response.json()
            source_study = source_export["studies_config"]["studies"][0]

            clone_payload = dict(source_study)
            clone_payload["name_short"] = clone_short
            clone_payload["name"] = "Lossless Roundtrip Clone"

            clone_import_response = await client.post(
                f"{BASE_URL}/api/admin/studies/import-config",
                auth=ADMIN_AUTH,
                json={
                    "schema_version": source_export["studies_config"]["schema_version"],
                    "mode": "create_only",
                    "transaction_mode": "all_or_nothing",
                    "studies": [clone_payload],
                },
            )
            assert clone_import_response.status_code == 200, clone_import_response.text
            assert clone_import_response.json()["summary"]["created"] == 1

            clone_export_response = await client.get(
                f"{BASE_URL}/api/admin/export/studies-runtime-config",
                params={"study_name": clone_short, "mode": "embedded_json"},
                auth=ADMIN_AUTH,
            )
            assert clone_export_response.status_code == 200
            clone_export = clone_export_response.json()
            clone_study = clone_export["studies_config"]["studies"][0]

            assert _without_identity_fields(clone_study) == _without_identity_fields(
                source_study
            )

            # The split ZIP is built from the same study dict, but assert the
            # previously missing fields are present there too.
            split_response = await client.get(
                f"{BASE_URL}/api/admin/export/studies-runtime-config",
                params={"study_name": source_short, "mode": "split_zip"},
                auth=ADMIN_AUTH,
            )
            assert split_response.status_code == 200
            archive = zipfile.ZipFile(BytesIO(split_response.content))
            split_study = json.loads(
                archive.read("studies_config.json").decode("utf-8")
            )["studies"][0]
            assert split_study["day_start_minutes"] == 240
            assert split_study["num_recent_activities_shown"] == 2
            assert split_study["time_step_minutes"] == 5
            assert split_study["min_duration_minutes"] == 10
            assert split_study["inactivity_timeout_minutes"] == 20
            assert split_study["inactivity_page_custom_text"] == {
                "en": "Session timeout (EN)",
                "sv": "Sessionen löpte ut (SV)",
            }
            assert split_study["footer_links"][0]["title"] == {
                "en": "Study information",
                "sv": "Studieinformation",
            }
            assert split_study["hide_server_wide_links"] is True
            assert split_study["day_labels"][0]["display_names"] == {
                "en": "Monday",
                "sv": "Måndag",
            }
        finally:
            for study_name_short in [source_short, clone_short]:
                await client.delete(
                    f"{BASE_URL}/api/admin/studies/{study_name_short}",
                    auth=ADMIN_AUTH,
                )
