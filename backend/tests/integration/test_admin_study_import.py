import json
import os
import uuid
import asyncio
import copy
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
            # Ignore already-deleted studies, but fail on unexpected server errors.
            if delete_response.status_code not in (200, 404):
                raise AssertionError(
                    f"Unexpected cleanup status for study '{study_name_short}': "
                    f"{delete_response.status_code}"
                )


@pytest.mark.asyncio
async def test_admin_import_study_config_with_embedded_activities_data(
    created_studies_for_cleanup,
):
    study_name_short = f"it_blob_{uuid.uuid4().hex[:8]}"
    activities_payload = _load_activities_template()

    payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"Integration Import Study {study_name_short}",
                "name_short": study_name_short,
                "description": "Integration test study created through admin import-config endpoint",
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
                "activities_json_data": {
                    "en": activities_payload,
                },
                "study_text_intro": {"en": "Intro"},
                "study_text_end_completed": {"en": "Done"},
                "study_text_end_skipped": {"en": "Skipped"},
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ],
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        unauthorized_response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=payload,
        )
        assert unauthorized_response.status_code == 401

        import_response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=payload,
            auth=ADMIN_AUTH,
        )
        assert import_response.status_code == 200
        import_data = import_response.json()
        assert import_data["summary"]["created"] == 1
        assert import_data["summary"]["failed"] == 0
        created_studies_for_cleanup.append(study_name_short)

        study_config_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/study-config"
        )
        assert study_config_response.status_code == 200
        study_config_data = study_config_response.json()
        assert study_config_data["study_text_intro"] == "Intro"
        assert study_config_data["study_text_end_completed"] == "Done"
        assert study_config_data["study_text_end_skipped"] == "Skipped"

        # Small retry loop for environments where API and DB commits are slightly delayed.
        activities_config_response = None
        for _ in range(5):
            activities_config_response = await client.get(
                f"{BASE_URL}/api/studies/{study_name_short}/activities-config",
                params={"lang": "en"},
            )
            if activities_config_response.status_code == 200:
                break
            await asyncio.sleep(0.2)

        assert activities_config_response is not None
        assert activities_config_response.status_code == 200
        activities_data = activities_config_response.json()

        assert "timeline" in activities_data
        assert set(activities_data["timeline"].keys()) == set(
            activities_payload["timeline"].keys()
        )

        summary_response = await client.get(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/available-activities-summary",
            auth=ADMIN_AUTH,
        )
        assert summary_response.status_code == 200
        summary_data = summary_response.json()
        assert summary_data["available_timeline_count"] > 0
        assert summary_data["available_category_count"] > 0
        assert summary_data["available_activity_count"] > 0
        assert summary_data["available_activity_i18n_count"] > 0

        duplicate_response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=payload,
            auth=ADMIN_AUTH,
        )
        assert duplicate_response.status_code == 200
        duplicate_data = duplicate_response.json()
        assert duplicate_data["summary"]["failed"] == 1
        assert any(result["status"] == "failed" for result in duplicate_data["results"])


@pytest.mark.asyncio
async def test_admin_import_roundtrip_from_runtime_config_export_uses_embedded_activities_data(
    created_studies_for_cleanup,
):
    roundtrip_study_name_short = f"it_roundtrip_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        export_response = await client.get(
            f"{BASE_URL}/api/admin/export/studies-runtime-config",
            params={"study_name": "default"},
            auth=ADMIN_AUTH,
        )
        assert export_response.status_code == 200

        export_data = export_response.json()
        assert "studies_config" in export_data
        assert export_data["studies_config"]["studies"]

        exported_study = copy.deepcopy(export_data["studies_config"]["studies"][0])
        exported_activities_json_data = exported_study.get("activities_json_data")
        if not exported_activities_json_data:
            exported_activities_json_data = export_data.get("activities", {}).get(
                exported_study["name_short"]
            )
        assert exported_activities_json_data
        exported_study["activities_json_data"] = exported_activities_json_data

        exported_study["name"] = f"Roundtrip Import {roundtrip_study_name_short}"
        exported_study["name_short"] = roundtrip_study_name_short
        exported_study.pop("activities_json_files", None)
        exported_study.pop("activities_logged_by_userid", None)

        import_payload = {
            "mode": "create_only",
            "transaction_mode": "all_or_nothing",
            "studies": [exported_study],
        }

        import_response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=import_payload,
            auth=ADMIN_AUTH,
        )
        assert import_response.status_code == 200
        import_data = import_response.json()
        assert import_data["summary"]["created"] == 1
        assert import_data["summary"]["failed"] == 0
        created_studies_for_cleanup.append(roundtrip_study_name_short)

        activities_config_response = None
        for _ in range(5):
            activities_config_response = await client.get(
                f"{BASE_URL}/api/studies/{roundtrip_study_name_short}/activities-config",
                params={"lang": exported_study["default_language"]},
            )
            if activities_config_response.status_code == 200:
                break
            await asyncio.sleep(0.2)

        assert activities_config_response is not None
        assert activities_config_response.status_code == 200
        imported_activities_data = activities_config_response.json()

        exported_default_language_data = exported_study["activities_json_data"][
            exported_study["default_language"]
        ]
        assert set(imported_activities_data["timeline"].keys()) == set(
            exported_default_language_data["timeline"].keys()
        )

        summary_response = await client.get(
            f"{BASE_URL}/api/admin/studies/{roundtrip_study_name_short}/available-activities-summary",
            auth=ADMIN_AUTH,
        )
        assert summary_response.status_code == 200
        summary_data = summary_response.json()
        assert summary_data["available_timeline_count"] > 0
        assert summary_data["available_category_count"] > 0
        assert summary_data["available_activity_count"] > 0
        assert summary_data["available_activity_i18n_count"] > 0


@pytest.mark.asyncio
async def test_admin_can_delete_study_and_study_config_returns_not_found():
    study_name_short = f"it_delete_{uuid.uuid4().hex[:8]}"
    activities_payload = _load_activities_template()

    payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"Delete Study {study_name_short}",
                "name_short": study_name_short,
                "description": "Study deletion integration test",
                "day_labels": [
                    {
                        "name": "monday",
                        "display_order": 0,
                        "display_names": {"en": "Monday"},
                    }
                ],
                "study_participant_ids": ["p1"],
                "allow_unlisted_participants": True,
                "default_language": "en",
                "supported_languages": ["en"],
                "activities_json_data": {"en": activities_payload},
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ],
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        import_response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=payload,
            auth=ADMIN_AUTH,
        )
        assert import_response.status_code == 200
        assert import_response.json()["summary"]["created"] == 1

        unauthorized_delete_response = await client.delete(
            f"{BASE_URL}/api/admin/studies/{study_name_short}"
        )
        assert unauthorized_delete_response.status_code == 401

        delete_response = await client.delete(
            f"{BASE_URL}/api/admin/studies/{study_name_short}",
            auth=ADMIN_AUTH,
        )
        assert delete_response.status_code == 200
        assert delete_response.json()["study_name_short"] == study_name_short

        missing_study_config_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/study-config"
        )
        assert missing_study_config_response.status_code == 404

        second_delete_response = await client.delete(
            f"{BASE_URL}/api/admin/studies/{study_name_short}",
            auth=ADMIN_AUTH,
        )
        assert second_delete_response.status_code == 404


@pytest.mark.asyncio
async def test_admin_import_rejects_payload_with_both_activity_sources():
    study_name_short = f"it_both_sources_{uuid.uuid4().hex[:8]}"
    activities_payload = _load_activities_template()

    payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"Integration Import Study {study_name_short}",
                "name_short": study_name_short,
                "description": "Integration test study with conflicting activity sources",
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
                "activities_json_data": {
                    "en": activities_payload,
                },
                "activities_json_files": {
                    "en": "activities_default.json",
                },
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ],
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        import_response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=payload,
            auth=ADMIN_AUTH,
        )
        assert import_response.status_code == 200
        import_data = import_response.json()
        assert import_data["summary"]["created"] == 0
        assert import_data["summary"]["failed"] == 1
        assert any(
            "Provide exactly one of activities_json_data or activities_json_files, not both"
            in error
            for result in import_data["results"]
            for error in result.get("errors", [])
        )


@pytest.mark.asyncio
async def test_admin_import_accepts_activities_json_files_only(
    created_studies_for_cleanup,
):
    study_name_short = f"it_file_source_{uuid.uuid4().hex[:8]}"

    payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"Integration Import Study {study_name_short}",
                "name_short": study_name_short,
                "description": "Integration test study using file-based activities references",
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
                "activities_json_files": {
                    "en": "activities_default.json",
                },
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ],
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        import_response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=payload,
            auth=ADMIN_AUTH,
        )
        assert import_response.status_code == 200
        import_data = import_response.json()
        assert import_data["summary"]["created"] == 1
        assert import_data["summary"]["failed"] == 0
        created_studies_for_cleanup.append(study_name_short)

        activities_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/activities-config",
            params={"lang": "en"},
        )
        assert activities_response.status_code == 200
        assert "timeline" in activities_response.json()


@pytest.mark.asyncio
async def test_admin_export_includes_require_consent_and_consent_texts():
    """Export of the 'default' study (which has require_consent=True in studies_config.json)
    must include require_consent, study_text_consent, and study_text_end_noconsent."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        export_response = await client.get(
            f"{BASE_URL}/api/admin/export/studies-runtime-config",
            params={"study_name": "default"},
            auth=ADMIN_AUTH,
        )
        assert export_response.status_code == 200
        export_data = export_response.json()
        studies = export_data["studies_config"]["studies"]
        assert studies, "Expected at least one study in export"

        exported_study = studies[0]
        assert "require_consent" in exported_study
        assert exported_study["require_consent"] is True
        assert "study_text_consent" in exported_study
        assert exported_study["study_text_consent"] is not None
        assert "study_text_end_noconsent" in exported_study


@pytest.mark.asyncio
async def test_admin_export_require_consent_roundtrip(created_studies_for_cleanup):
    """Import a study with require_consent=True and consent texts, then verify the
    export reflects require_consent correctly from the database."""
    study_name_short = f"it_consent_{uuid.uuid4().hex[:8]}"
    activities_payload = _load_activities_template()

    payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"Consent Roundtrip Study {study_name_short}",
                "name_short": study_name_short,
                "description": "Study with consent for roundtrip test",
                "day_labels": [
                    {
                        "name": "monday",
                        "display_order": 0,
                        "display_names": {"en": "Monday"},
                    }
                ],
                "study_participant_ids": [],
                "allow_unlisted_participants": True,
                "require_consent": True,
                "study_text_consent": {"en": "Please consent to participate."},
                "study_text_end_noconsent": {"en": "You did not consent."},
                "default_language": "en",
                "supported_languages": ["en"],
                "activities_json_data": {"en": activities_payload},
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ],
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        import_response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=payload,
            auth=ADMIN_AUTH,
        )
        assert import_response.status_code == 200
        import_data = import_response.json()
        assert import_data["summary"]["created"] == 1
        created_studies_for_cleanup.append(study_name_short)

        export_response = await client.get(
            f"{BASE_URL}/api/admin/export/studies-runtime-config",
            params={"study_name": study_name_short},
            auth=ADMIN_AUTH,
        )
        assert export_response.status_code == 200
        export_data = export_response.json()
        exported_study = export_data["studies_config"]["studies"][0]

        assert exported_study["require_consent"] is True
        assert exported_study["study_text_consent"] == {
            "en": "Please consent to participate."
        }
        assert exported_study["study_text_end_noconsent"] == {
            "en": "You did not consent."
        }

        study_config_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/study-config"
        )
        assert study_config_response.status_code == 200
        study_config_data = study_config_response.json()
        assert study_config_data["require_consent"] is True
        assert study_config_data["study_text_consent"] == "Please consent to participate."
        assert study_config_data["study_text_end_noconsent"] == "You did not consent."


@pytest.mark.asyncio
async def test_admin_export_external_tasks_roundtrip(created_studies_for_cleanup):
    study_name_short = f"it_external_{uuid.uuid4().hex[:8]}"
    activities_payload = _load_activities_template()

    payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"External Task Roundtrip Study {study_name_short}",
                "name_short": study_name_short,
                "description": "Study with external task metadata",
                "day_labels": [
                    {
                        "name": "monday",
                        "display_order": 0,
                        "display_names": {"en": "Monday"},
                    }
                ],
                "study_participant_ids": ["p1", "p2"],
                "allow_unlisted_participants": False,
                "external_tasks": [
                    {
                        "task_key": "payment",
                        "name": "Payment Survey",
                        "description": "Complete payment handoff.",
                        "url": "https://example.org/payment",
                        "confirmation_type": "none",
                        "tokens": ["tok-1", "tok-2"],
                        "config": {"provider": "example"},
                    }
                ],
                "default_language": "en",
                "supported_languages": ["en"],
                "activities_json_data": {"en": activities_payload},
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ],
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        import_response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=payload,
            auth=ADMIN_AUTH,
        )
        assert import_response.status_code == 200
        created_studies_for_cleanup.append(study_name_short)

        export_response = await client.get(
            f"{BASE_URL}/api/admin/export/studies-runtime-config",
            params={"study_name": study_name_short},
            auth=ADMIN_AUTH,
        )
        assert export_response.status_code == 200

        exported_study = export_response.json()["studies_config"]["studies"][0]
        assert exported_study["external_tasks"] == [
            {
                "task_key": "payment",
                "name": "Payment Survey",
                "description": "Complete payment handoff.",
                "url": "https://example.org/payment",
                "confirmation_type": "none",
                "tokens": ["tok-1", "tok-2"],
                "config": {"provider": "example"},
                "participant_assignments": [
                    {
                        "participant_id": "p1",
                        "assigned_token": "tok-1",
                        "assignment_order": 0,
                        "is_confirmed": False,
                        "confirmed_at": None,
                    },
                    {
                        "participant_id": "p2",
                        "assigned_token": "tok-2",
                        "assignment_order": 1,
                        "is_confirmed": False,
                        "confirmed_at": None,
                    },
                ],
            }
        ]

        admin_page_response = await client.get(
            f"{BASE_URL}/admin",
            auth=ADMIN_AUTH,
        )
        assert admin_page_response.status_code == 200
        assert "External Tasks" in admin_page_response.text
        assert "Payment Survey" in admin_page_response.text
        assert "tok-1" in admin_page_response.text
        assert "tok-2" in admin_page_response.text


@pytest.mark.asyncio
async def test_study_config_returns_participant_external_tasks_for_none_confirmation(
    created_studies_for_cleanup,
):
    study_name_short = f"it_external_cfg_{uuid.uuid4().hex[:8]}"
    activities_payload = _load_activities_template()

    payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"External Task Study Config {study_name_short}",
                "name_short": study_name_short,
                "description": "Study with participant-facing external task links",
                "day_labels": [
                    {
                        "name": "monday",
                        "display_order": 0,
                        "display_names": {"en": "Monday"},
                    }
                ],
                "study_participant_ids": ["p1", "p2"],
                "allow_unlisted_participants": False,
                "external_tasks": [
                    {
                        "task_key": "payment",
                        "name": "Payment Survey",
                        "description": "Complete payment handoff.",
                        "url": "https://example.org/payment?src=trac",
                        "confirmation_type": "none",
                        "tokens": ["tok-1", "tok-2"],
                        "send_pid": True,
                        "pid_query_param": "participant_id",
                        "config": {"token_query_param": "survey_token"},
                    },
                    {
                        "task_key": "callback_only",
                        "name": "Callback Task",
                        "description": "Should not be shown yet.",
                        "url": "https://example.org/callback",
                        "confirmation_type": "callback",
                        "tokens": ["cb-1", "cb-2"],
                        "config": {},
                    },
                ],
                "default_language": "en",
                "supported_languages": ["en"],
                "activities_json_data": {"en": activities_payload},
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ],
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        import_response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=payload,
            auth=ADMIN_AUTH,
        )
        assert import_response.status_code == 200
        created_studies_for_cleanup.append(study_name_short)

        study_config_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/study-config",
            params={"participant_id": "p1"},
        )
        assert study_config_response.status_code == 200

        study_config_data = study_config_response.json()
        external_tasks_by_key = {
            task["task_key"]: task for task in study_config_data["external_tasks"]
        }

        assert set(external_tasks_by_key.keys()) == {"payment", "callback_only"}

        assert external_tasks_by_key["payment"] == {
            "task_key": "payment",
            "name": "Payment Survey",
            "description": "Complete payment handoff.",
            "confirmation_type": "none",
            "assigned_token": "tok-1",
            "continuation_url": f"{settings.rootpath}/api/studies/{study_name_short}/participants/p1/external-tasks/payment/launch?assigned_token=tok-1",
            "is_confirmed": False,
            "confirmed_at": None,
        }

        assert external_tasks_by_key["callback_only"] == {
            "task_key": "callback_only",
            "name": "Callback Task",
            "description": "Should not be shown yet.",
            "confirmation_type": "callback",
            "assigned_token": "cb-1",
            "continuation_url": f"{settings.rootpath}/api/studies/{study_name_short}/participants/p1/external-tasks/callback_only/launch?assigned_token=cb-1",
            "is_confirmed": False,
            "confirmed_at": None,
        }


@pytest.mark.asyncio
async def test_callback_external_task_confirmation_updates_assignment_state(
    created_studies_for_cleanup,
):
    study_name_short = f"it_external_cb_{uuid.uuid4().hex[:8]}"
    activities_payload = _load_activities_template()

    payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"Callback External Task Study {study_name_short}",
                "name_short": study_name_short,
                "description": "Study with callback external task confirmation",
                "day_labels": [
                    {
                        "name": "monday",
                        "display_order": 0,
                        "display_names": {"en": "Monday"},
                    }
                ],
                "study_participant_ids": ["p1"],
                "allow_unlisted_participants": False,
                "external_tasks": [
                    {
                        "task_key": "callback_payment",
                        "name": "Callback Payment",
                        "description": "Return here after payment.",
                        "url": "https://example.org/payment-callback?src=trac",
                        "confirmation_type": "callback",
                        "tokens": ["cb-1"],
                        "config": {},
                    }
                ],
                "default_language": "en",
                "supported_languages": ["en"],
                "activities_json_data": {"en": activities_payload},
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ],
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        import_response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=payload,
            auth=ADMIN_AUTH,
        )
        assert import_response.status_code == 200
        created_studies_for_cleanup.append(study_name_short)

        study_config_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/study-config",
            params={"participant_id": "p1"},
        )
        assert study_config_response.status_code == 200
        callback_task = study_config_response.json()["external_tasks"][0]
        assert callback_task["is_confirmed"] is False

        confirm_response = await client.post(
            f"{BASE_URL}/api/studies/{study_name_short}/participants/p1/external-tasks/confirm",
            json={
                "task_key": "callback_payment",
                "assigned_token": "cb-1",
            },
        )
        assert confirm_response.status_code == 200
        confirm_data = confirm_response.json()
        assert confirm_data["is_confirmed"] is True
        assert confirm_data["confirmed_at"] is not None

        refreshed_study_config_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/study-config",
            params={"participant_id": "p1"},
        )
        assert refreshed_study_config_response.status_code == 200
        refreshed_task = refreshed_study_config_response.json()["external_tasks"][0]
        assert refreshed_task["is_confirmed"] is True
        assert refreshed_task["confirmed_at"] is not None


@pytest.mark.asyncio
async def test_study_config_tracks_instruction_completion_and_study_completion_state(
    created_studies_for_cleanup,
):
    study_name_short = f"it_completion_{uuid.uuid4().hex[:8]}"
    activities_payload = _load_activities_template()

    timeline_key = next(iter(activities_payload["timeline"].keys()))
    timeline_cfg = activities_payload["timeline"][timeline_key]
    first_category = timeline_cfg["categories"][0]
    first_activity = first_category["activities"][0]

    payload = {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"Completion State Study {study_name_short}",
                "name_short": study_name_short,
                "description": "Study completion state integration test",
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
                "study_participant_ids": ["p1"],
                "allow_unlisted_participants": False,
                "default_language": "en",
                "supported_languages": ["en"],
                "activities_json_data": {"en": activities_payload},
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ],
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        import_response = await client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=payload,
            auth=ADMIN_AUTH,
        )
        assert import_response.status_code == 200
        created_studies_for_cleanup.append(study_name_short)

        initial_study_config_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/study-config",
            params={"participant_id": "p1"},
        )
        assert initial_study_config_response.status_code == 200
        initial_study_config = initial_study_config_response.json()
        assert initial_study_config["instructions_completed"] is False
        assert initial_study_config["instructions_completed_at"] is None
        assert initial_study_config["participant_has_completed_study"] is False

        instructions_response = await client.post(
            f"{BASE_URL}/api/studies/{study_name_short}/participants/p1/instructions/complete",
            json={"completed": True},
        )
        assert instructions_response.status_code == 200
        instructions_data = instructions_response.json()
        assert instructions_data["instructions_completed"] is True
        assert instructions_data["instructions_completed_at"] is not None

        for day_label in ["monday", "tuesday"]:
            submit_response = await client.post(
                f"{BASE_URL}/api/studies/{study_name_short}/participants/p1/day_labels/{day_label}/activities",
                json={
                    "activities": [
                        {
                            "timeline_key": timeline_key,
                            "activity": first_activity["name"],
                            "category": first_category["name"],
                            "start_minutes": 0,
                            "end_minutes": 10,
                            "mode": timeline_cfg["mode"],
                            "code": first_activity["code"],
                        }
                    ]
                },
            )
            assert submit_response.status_code == 200

        completed_study_config_response = await client.get(
            f"{BASE_URL}/api/studies/{study_name_short}/study-config",
            params={"participant_id": "p1"},
        )
        assert completed_study_config_response.status_code == 200
        completed_study_config = completed_study_config_response.json()
        assert completed_study_config["instructions_completed"] is True
        assert completed_study_config["instructions_completed_at"] is not None
        assert completed_study_config["participant_has_completed_study"] is True

