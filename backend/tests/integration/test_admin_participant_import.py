"""Uploading a participant roster as CSV or TSV.

The upload shares its assignment logic with the paste box, so these tests focus on
what is specific to a file: delimiter detection, the header contract, the
reported counts and the refusal to import anything from a file with a bad id.
"""

import os
import uuid

import httpx
import pytest

from o_timeusediary_backend.settings import settings


BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.strip("/")
ADMIN_AUTH = (settings.admin_username, settings.admin_password)


def _require_authenticated(response: httpx.Response) -> None:
    if response.status_code == 401:
        raise AssertionError(
            f"Server rejected administrator credentials {ADMIN_AUTH[0]!r} (401). "
            "Make sure the running backend was started with TUD_API_ADMIN_USERNAME / "
            "TUD_API_ADMIN_PASSWORD."
        )


def _prefix() -> str:
    return f"it_upload_{uuid.uuid4().hex[:8]}"


async def _page_containing(client: httpx.AsyncClient, study: str, query: str) -> str:
    response = await client.get(
        f"{BASE_URL}/admin/participant-management",
        params={"study_name_short": study, "q": query},
        auth=ADMIN_AUTH,
    )
    _require_authenticated(response)
    assert response.status_code == 200, response.text
    return response.text


async def _upload(
    client: httpx.AsyncClient,
    study: str,
    content: bytes,
    *,
    filename: str = "participants.csv",
    dry_run: bool = False,
    auth=ADMIN_AUTH,
) -> httpx.Response:
    return await client.post(
        f"{BASE_URL}/api/admin/studies/{study}/import-participants",
        params={"dry_run": "true" if dry_run else "false"},
        files={"file": (filename, content, "text/plain")},
        auth=auth,
    )


async def _remove(client: httpx.AsyncClient, study: str, participant_ids) -> None:
    for participant_id in participant_ids:
        await client.delete(
            f"{BASE_URL}/api/admin/studies/{study}/participants/{participant_id}",
            auth=ADMIN_AUTH,
        )


@pytest.mark.asyncio
async def test_csv_upload_adds_participants_and_reports_ignored_columns():
    study = "default"
    prefix = _prefix()
    participant_ids = [f"{prefix}_a", f"{prefix}_b"]
    csv_text = (
        "pid,name,group\n"
        f"{participant_ids[0]},Alice,A\n"
        f"{participant_ids[1]},Bob,B\n"
    )

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await _upload(client, study, csv_text.encode("utf-8"))
            page = await _page_containing(client, study, prefix)
        finally:
            await _remove(client, study, participant_ids)

    _require_authenticated(response)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["dry_run"] is False
    assert body["format"] == "csv"
    assert body["summary"]["rows_in_file"] == 2
    assert body["summary"]["created_and_assigned"] == 2
    assert body["summary"]["duplicates_in_file"] == 0
    assert body["columns"] == {
        "used": ["pid"],
        "ignored": ["name", "group"],
        "ignored_count": 2,
    }
    assert all(participant_id in page for participant_id in participant_ids)


@pytest.mark.asyncio
async def test_tsv_upload_is_detected_from_the_content():
    study = "default"
    prefix = _prefix()
    participant_id = f"{prefix}_tsv"
    tsv_text = f"PID\tname\n{participant_id}\tAlice\n"

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await _upload(
                client, study, tsv_text.encode("utf-8"), filename="participants.tsv"
            )
            page = await _page_containing(client, study, prefix)
        finally:
            await _remove(client, study, [participant_id])

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["format"] == "tsv"
    assert body["summary"]["created_and_assigned"] == 1
    assert body["columns"]["used"] == ["PID"]
    assert participant_id in page


@pytest.mark.asyncio
async def test_dry_run_creates_nothing():
    study = "default"
    prefix = _prefix()
    participant_id = f"{prefix}_dry"

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await _upload(
            client,
            study,
            f"pid\n{participant_id}\n".encode("utf-8"),
            dry_run=True,
        )
        page = await _page_containing(client, study, prefix)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["dry_run"] is True
    assert body["summary"]["created_and_assigned"] == 1
    assert participant_id not in page


@pytest.mark.asyncio
async def test_duplicate_rows_in_the_file_are_counted_once():
    study = "default"
    prefix = _prefix()
    participant_id = f"{prefix}_dup"

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await _upload(
                client,
                study,
                f"pid\n{participant_id}\n{participant_id}\n".encode("utf-8"),
            )
        finally:
            await _remove(client, study, [participant_id])

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["summary"]["rows_in_file"] == 2
    assert body["summary"]["duplicates_in_file"] == 1
    assert body["summary"]["created_and_assigned"] == 1


@pytest.mark.asyncio
async def test_a_file_without_a_pid_column_is_rejected():
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await _upload(client, "default", b"name,group\nAlice,A\n")

    _require_authenticated(response)
    assert response.status_code == 400
    assert "no 'pid' column" in response.json()["detail"]


@pytest.mark.asyncio
async def test_one_invalid_pid_rejects_the_whole_file():
    study = "default"
    prefix = _prefix()
    good_id = f"{prefix}_good"
    csv_text = f"pid\n{good_id}\nbad id\n"

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await _upload(client, study, csv_text.encode("utf-8"))
        page = await _page_containing(client, study, prefix)

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "Nothing was imported" in detail
    assert "Line 3" in detail
    assert "bad id" in detail
    # All or nothing: the valid sibling row must not have been created either.
    assert good_id not in page


@pytest.mark.asyncio
async def test_upload_requires_admin():
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await _upload(client, "default", b"pid\nsomeone\n", auth=None)

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_participant_urls_with_an_invalid_pid_are_rejected():
    async with httpx.AsyncClient(timeout=60.0) as client:
        diary_response = await client.get(
            f"{BASE_URL}/api/studies/default/participants/bad%20id/diary"
        )
        legacy_response = await client.get(
            f"{BASE_URL}/api/studies/default/participants/bad%20id/activities"
        )
        valid_response = await client.get(
            f"{BASE_URL}/api/studies/default/participants/it_valid_pid/diary"
        )

    assert diary_response.status_code == 400
    assert "letters, digits" in diary_response.json()["detail"]
    assert legacy_response.status_code == 400
    assert "letters, digits" in legacy_response.json()["detail"]
    # A well-formed id still reaches the normal flow.
    assert valid_response.status_code == 200, valid_response.text


@pytest.mark.asyncio
async def test_page_offers_the_upload_section_with_the_id_rule():
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(
            f"{BASE_URL}/admin/participant-management",
            params={"study_name_short": "default"},
            auth=ADMIN_AUTH,
        )

    _require_authenticated(response)
    assert response.status_code == 200
    assert "Upload participants for study default" in response.text
    assert 'id="participantsFile"' in response.text
    # The rule text and the client-side pattern come from participant_ids.py.
    assert "letters, digits" in response.text
    assert "[A-Za-z0-9_-]+" in response.text


@pytest.mark.asyncio
async def test_paste_box_rejects_invalid_ids_too():
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{BASE_URL}/api/admin/studies/default/assign-participants",
            json={"participant_ids": ["fine_id", "bad id"]},
            auth=ADMIN_AUTH,
        )

    _require_authenticated(response)
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "'bad id'" in detail
    assert "letters, digits" in detail
