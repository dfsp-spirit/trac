"""Proxy studies end to end: the roster, the sequence and the refusals.

These are the acceptance scenarios from
``dev_tools/plans/proxy_studies_implementation.md`` §7. They need a running
backend (``./test_backend_integration.sh``) and the field-encryption key set, and
they create everything through the real admin and participant endpoints - the
roster upload is the only way a proxy study gets participants, so using it is
part of what is under test.
"""

import json
import os
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from o_timeusediary_backend import encrypted_fields as ef
from o_timeusediary_backend.settings import settings

BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.strip("/")
ADMIN_AUTH = (settings.admin_username, settings.admin_password)


def _activities_payload() -> dict:
    return {
        "general": {"app_name": "TRAC", "version": "1.0", "language": "en"},
        "timeline": {
            "primary": {
                "name": "Primary",
                "description": "",
                "mode": "single-choice",
                "min_coverage": 0,
                "categories": [
                    {
                        "name": "General",
                        "activities": [
                            {
                                "name": "Activity 100",
                                "code": 100,
                                "label": "activity-100",
                                "color": "#000000",
                                "childItems": [],
                            }
                        ],
                    }
                ],
            }
        },
    }


def _study_config(name_short: str) -> dict:
    return {
        "studies": [
            {
                "name": f"Proxy {name_short}",
                "name_short": name_short,
                "report_mode": "proxy",
                "allow_unlisted_participants": False,
                "is_listed_publicly": False,
                "allow_skip_timeuse": True,
                "default_language": "en",
                "supported_languages": ["en"],
                "day_labels": [
                    {
                        "name": "day1",
                        "display_order": 0,
                        "display_names": {"en": "Day 1"},
                    }
                ],
                "study_participant_ids": [],
                "activities_json_data": {"en": _activities_payload()},
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2030-12-31T23:59:59Z",
            }
        ]
    }


async def _create_proxy_study(client: httpx.AsyncClient) -> str:
    name_short = f"it_proxy_{uuid.uuid4().hex[:8]}"
    response = await client.post(
        f"{BASE_URL}/api/admin/studies/create-from-files",
        auth=ADMIN_AUTH,
        data={"mode": "full_study_embedded"},
        files={
            "studies_config_file": (
                "studies_config.json",
                json.dumps(_study_config(name_short)).encode("utf-8"),
                "application/json",
            )
        },
    )
    assert response.status_code == 200, response.text
    return name_short


def _roster(parent: str, children: list[tuple[str, str]], deadline: str) -> bytes:
    lines = [
        "parent_id,subject_id,subject_name_encrypted,"
        "latest_possible_submission_at_encrypted"
    ]
    for child_id, name in children:
        lines.append(
            ",".join(
                [
                    parent,
                    child_id,
                    ef.encrypt_text(name) or "",
                    ef.encrypt_text(deadline) or "",
                ]
            )
        )
    return ("\n".join(lines) + "\n").encode("utf-8")


async def _upload_roster(
    client: httpx.AsyncClient, study: str, content: bytes
) -> httpx.Response:
    return await client.post(
        f"{BASE_URL}/api/admin/studies/{study}/import-participants",
        auth=ADMIN_AUTH,
        files={"file": ("roster.csv", content, "text/csv")},
    )


async def _study_config_payload(
    client: httpx.AsyncClient, study: str, participant_id: str
) -> httpx.Response:
    return await client.get(
        f"{BASE_URL}/api/studies/{study}/study-config",
        params={"participant_id": participant_id},
    )


async def _fill_one_day(client: httpx.AsyncClient, study: str, parent: str) -> None:
    """Give the active child's questionnaire one entry, so it can be submitted.

    The study has a single day label and a coverage requirement, so submitting
    without an entry is refused - exactly as for a self-report participant.
    """
    response = await client.post(
        f"{BASE_URL}/api/studies/{study}/participants/{parent}/activities",
        json={
            "items": [
                {
                    "activity_code": 100,
                    "activity_name": "Activity 100",
                    "start_minutes": 600,
                    "end_minutes": 660,
                    "day_label_indexes": [0],
                }
            ]
        },
    )
    assert response.status_code == 201, response.text


def _deadline() -> str:
    return (datetime.now(UTC) + timedelta(days=30)).isoformat()


@pytest.mark.asyncio
async def test_roster_import_creates_families_and_refuses_child_credentials():
    async with httpx.AsyncClient() as client:
        study = await _create_proxy_study(client)
        upload = await _upload_roster(
            client,
            study,
            _roster("p1", [("c1", "Ada"), ("c2", "Bo")], _deadline()),
        )
        assert upload.status_code == 200, upload.text
        summary = upload.json()["summary"]
        assert summary["families"] == 1
        assert summary["children_created"] == 2

        # The parent sees the first child's name.
        parent_view = await _study_config_payload(client, study, "p1")
        assert parent_view.status_code == 200, parent_view.text
        payload = parent_view.json()
        assert payload["participant_display_name"] == "Ada"
        assert payload["proxy"]["active"]["participant_id"] == "c1"
        assert payload["proxy"]["active"]["index"] == 1
        assert payload["proxy"]["total"] == 2

        # A child's id is not a credential (the acceptance criterion).
        for path in ("study-config", "activities-config"):
            refused = await client.get(
                f"{BASE_URL}/api/studies/{study}/{path}",
                params={"participant_id": "c1"},
            )
            assert refused.status_code == 403, (path, refused.text)
            assert refused.json()["detail"]["code"] == "proxy_not_allowed"

        refused_diary = await client.get(
            f"{BASE_URL}/api/studies/{study}/participants/c1/diary"
        )
        assert refused_diary.status_code == 403


@pytest.mark.asyncio
async def test_submitting_one_child_moves_the_family_to_the_next():
    async with httpx.AsyncClient() as client:
        study = await _create_proxy_study(client)
        await _upload_roster(
            client,
            study,
            _roster("p1", [("c1", "Ada"), ("c2", "Bo")], _deadline()),
        )

        await _fill_one_day(client, study, "p1")
        first = await client.post(
            f"{BASE_URL}/api/studies/{study}/participants/p1/diary/submit"
        )
        assert first.status_code == 200, first.text
        assert first.json()["stage"] == "diary"

        after = (await _study_config_payload(client, study, "p1")).json()
        assert after["proxy"]["active"]["participant_id"] == "c2"
        assert after["participant_display_name"] == "Bo"

        await _fill_one_day(client, study, "p1")
        second = await client.post(
            f"{BASE_URL}/api/studies/{study}/participants/p1/diary/submit"
        )
        assert second.status_code == 200, second.text
        assert second.json()["stage"] == "done"


@pytest.mark.asyncio
async def test_skipping_closes_every_unfinished_child():
    async with httpx.AsyncClient() as client:
        study = await _create_proxy_study(client)
        await _upload_roster(
            client,
            study,
            _roster("p1", [("c1", "Ada"), ("c2", "Bo")], _deadline()),
        )
        await _fill_one_day(client, study, "p1")
        await client.post(
            f"{BASE_URL}/api/studies/{study}/participants/p1/diary/submit"
        )

        skipped = await client.post(
            f"{BASE_URL}/api/studies/{study}/participants/p1/diary/skip",
            json={"reason_code": "no_time_and_effort"},
        )
        assert skipped.status_code == 200, skipped.text
        assert skipped.json()["skipped_children"] == ["c2"]
        assert skipped.json()["stage"] == "done"

        export = await client.get(
            f"{BASE_URL}/api/admin/export/{study}/participants",
            params={"format": "json"},
            auth=ADMIN_AUTH,
        )
        assert export.status_code == 200, export.text
        roles = {
            row["participant_id"]: row["participant_role"]
            for row in export.json()["data"]
        }
        assert roles == {"p1": "parent", "c1": "child", "c2": "child"}


@pytest.mark.asyncio
async def test_a_passed_deadline_stops_every_write():
    async with httpx.AsyncClient() as client:
        study = await _create_proxy_study(client)
        deadline = (datetime.now(UTC) - timedelta(minutes=1)).isoformat()
        await _upload_roster(client, study, _roster("p1", [("c1", "Ada")], deadline))

        save = await client.post(
            f"{BASE_URL}/api/studies/{study}/participants/p1/activities",
            json={
                "items": [
                    {
                        "activity_code": 100,
                        "activity_name": "Activity 100",
                        "start_minutes": 600,
                        "end_minutes": 660,
                        "day_label_indexes": [0],
                    }
                ]
            },
        )
        assert save.status_code == 403, save.text
        assert save.json()["detail"]["code"] == "deadline_passed"

        submit = await client.post(
            f"{BASE_URL}/api/studies/{study}/participants/p1/diary/submit"
        )
        assert submit.status_code == 403


@pytest.mark.asyncio
async def test_template_copy_needs_an_empty_target_and_a_finished_sibling():
    async with httpx.AsyncClient() as client:
        study = await _create_proxy_study(client)
        await _upload_roster(
            client,
            study,
            _roster("p1", [("c1", "Ada"), ("c2", "Bo")], _deadline()),
        )

        # Nothing to copy from yet.
        too_early = await client.post(
            f"{BASE_URL}/api/studies/{study}/participants/p1/template-copy"
        )
        assert too_early.status_code == 400

        await _fill_one_day(client, study, "p1")
        await client.post(
            f"{BASE_URL}/api/studies/{study}/participants/p1/diary/submit"
        )

        copied = await client.post(
            f"{BASE_URL}/api/studies/{study}/participants/p1/template-copy"
        )
        assert copied.status_code == 201, copied.text
        assert copied.json()["copied"] == 1
        assert copied.json()["source_participant_id"] == "c1"

        again = await client.post(
            f"{BASE_URL}/api/studies/{study}/participants/p1/template-copy"
        )
        assert again.status_code == 400, "a non-empty target must be refused"


@pytest.mark.asyncio
async def test_invitation_links_never_include_a_child():
    async with httpx.AsyncClient() as client:
        study = await _create_proxy_study(client)
        await _upload_roster(
            client,
            study,
            _roster("p1", [("c1", "Ada"), ("c2", "Bo")], _deadline()),
        )

        links = await client.get(
            f"{BASE_URL}/api/admin/studies/{study}/export-invitation-links",
            auth=ADMIN_AUTH,
        )
        assert links.status_code == 200, links.text
        assert "pid=p1" in links.text
        assert "pid=c1" not in links.text
        assert "pid=c2" not in links.text


@pytest.mark.asyncio
async def test_encryption_diagnostics_report_a_readable_key():
    async with httpx.AsyncClient() as client:
        study = await _create_proxy_study(client)
        await _upload_roster(client, study, _roster("p1", [("c1", "Ada")], _deadline()))

        response = await client.get(
            f"{BASE_URL}/api/admin/diagnostics/encryption", auth=ADMIN_AUTH
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "ok"
        assert body["failed"] == 0
        assert "Ada" not in response.text
