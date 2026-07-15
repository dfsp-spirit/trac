import os
import uuid

import httpx
import pytest

from o_timeusediary_backend.settings import settings


BASE_SCHEME = os.getenv("TUD_BASE_SCHEME", "http://localhost:3000")
BASE_URL = f"{BASE_SCHEME}/" + settings.rootpath.strip("/")
ADMIN_AUTH = (settings.admin_username, settings.admin_password)


@pytest.mark.asyncio
async def test_admin_participant_management_page_and_actions_work():
    study_name_short = "default"
    participant_keep = f"it_pm_keep_{uuid.uuid4().hex[:8]}"
    participant_remove = f"it_pm_remove_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient() as client:
        unauthorized_page = await client.get(f"{BASE_URL}/admin/participant-management")
        assert unauthorized_page.status_code == 401

        page_response = await client.get(
            f"{BASE_URL}/admin/participant-management",
            auth=ADMIN_AUTH,
        )
        assert page_response.status_code == 200
        assert "Participant Management" in page_response.text

        selected_page = await client.get(
            f"{BASE_URL}/admin/participant-management",
            params={"study_name_short": study_name_short},
            auth=ADMIN_AUTH,
        )
        assert selected_page.status_code == 200
        assert f'Participants in study {study_name_short}' in selected_page.text

        assign_response = await client.post(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/assign-participants",
            json={"participant_ids": [participant_keep, participant_remove]},
            auth=ADMIN_AUTH,
        )
        assert assign_response.status_code == 200
        assign_data = assign_response.json()
        assert "summary" in assign_data
        assert (
            assign_data["summary"]["created_and_assigned"]
            + assign_data["summary"]["already_existed_and_assigned"]
            >= 2
        )

        after_assign_page = await client.get(
            f"{BASE_URL}/admin/participant-management",
            params={"study_name_short": study_name_short},
            auth=ADMIN_AUTH,
        )
        assert after_assign_page.status_code == 200
        assert participant_keep in after_assign_page.text
        assert participant_remove in after_assign_page.text

        remove_response = await client.delete(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/participants/{participant_remove}",
            auth=ADMIN_AUTH,
        )
        assert remove_response.status_code == 200
        remove_data = remove_response.json()
        assert remove_data["participant_id"] == participant_remove

        after_remove_page = await client.get(
            f"{BASE_URL}/admin/participant-management",
            params={"study_name_short": study_name_short},
            auth=ADMIN_AUTH,
        )
        assert after_remove_page.status_code == 200
        assert participant_keep in after_remove_page.text
        assert participant_remove not in after_remove_page.text


    @pytest.mark.asyncio
    async def test_admin_participant_management_external_tasks_ui():
        study_name_short = "adult_pilot_de2"

        async with httpx.AsyncClient() as client:
            page_response = await client.get(
                f"{BASE_URL}/admin/participant-management",
                params={"study_name_short": study_name_short},
                auth=ADMIN_AUTH,
            )
            assert page_response.status_code == 200
            # The CSV upload card title should be present
            assert "Add participants and task tokens" in page_response.text
            # The configured external task keys should be visible
            assert "depression_survey" in page_response.text
            assert "payment_info" in page_response.text


    @pytest.mark.asyncio
    async def test_admin_delete_tokens_preview_and_commit_scoped():
        study_name_short = "adult_pilot_de2"
        # Use values unlikely to exist to exercise 'not found' branch
        sample_pids = [f"it_del_preview_{uuid.uuid4().hex[:6]}"]
        sample_tokens = [f"tok_del_preview_{uuid.uuid4().hex[:6]}"]

        async with httpx.AsyncClient() as client:
            # Preview by pid
            resp = await client.post(
                f"{BASE_URL}/api/admin/studies/{study_name_short}/delete-tokens/by-pid/preview",
                json={"task_key": "depression_survey", "participant_ids": sample_pids},
                auth=ADMIN_AUTH,
            )
            assert resp.status_code == 200
            data = resp.json()
            assert "total_input" in data

            # Commit by pid (should be harmless, 0 deleted)
            resp2 = await client.post(
                f"{BASE_URL}/api/admin/studies/{study_name_short}/delete-tokens/by-pid/commit",
                json={"task_key": "depression_survey", "participant_ids": sample_pids},
                auth=ADMIN_AUTH,
            )
            assert resp2.status_code == 200
            data2 = resp2.json()
            assert "deleted" in data2

            # Preview by token
            resp3 = await client.post(
                f"{BASE_URL}/api/admin/studies/{study_name_short}/delete-tokens/by-token/preview",
                json={"task_key": "depression_survey", "tokens": sample_tokens},
                auth=ADMIN_AUTH,
            )
            assert resp3.status_code == 200
            data3 = resp3.json()
            assert "total_input" in data3

            # Commit by token
            resp4 = await client.post(
                f"{BASE_URL}/api/admin/studies/{study_name_short}/delete-tokens/by-token/commit",
                json={"task_key": "depression_survey", "tokens": sample_tokens},
                auth=ADMIN_AUTH,
            )
            assert resp4.status_code == 200
            data4 = resp4.json()
            assert "deleted" in data4


@pytest.mark.asyncio
async def test_admin_generate_tokens_creates_assignments():
    """Generate tokens for a study with external tasks and verify assignments."""
    study_name_short = "adult_pilot_de2"
    # Use a unique participant that won't collide with other tests
    pid = f"it_gen_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient() as client:
        # First assign a participant to the study
        assign_resp = await client.post(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/assign-participants",
            json={"participant_ids": [pid]},
            auth=ADMIN_AUTH,
        )
        assert assign_resp.status_code == 200

        # Now generate tokens
        gen_resp = await client.post(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/generate-tokens",
            auth=ADMIN_AUTH,
        )
        assert gen_resp.status_code == 200
        gen_data = gen_resp.json()
        assert gen_data["ok"] is True
        summary = gen_data["summary"]
        assert summary["tokens_generated"] >= 1
        assert summary["participants_in_study"] >= 1

        # Second call should skip (participant already has tokens)
        gen_resp2 = await client.post(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/generate-tokens",
            auth=ADMIN_AUTH,
        )
        assert gen_resp2.status_code == 200
        gen_data2 = gen_resp2.json()
        assert gen_data2["summary"]["tokens_generated"] == 0
        assert gen_data2["summary"]["tokens_skipped_existing"] >= 1


@pytest.mark.asyncio
async def test_admin_generate_tokens_study_not_found():
    """Call generate-tokens for a non-existent study."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE_URL}/api/admin/studies/nonexistent_study/generate-tokens",
            auth=ADMIN_AUTH,
        )
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_admin_generate_tokens_no_external_tasks():
    """Call generate-tokens for a study without external tasks."""
    study_name_short = "default"

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/generate-tokens",
            auth=ADMIN_AUTH,
        )
        assert resp.status_code == 400


@pytest.mark.asyncio
async def test_admin_export_tokens_csv_includes_participants():
    """Export tokens CSV for a study with external tasks and verify content."""
    study_name_short = "adult_pilot_de2"
    pid = f"it_exp_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient() as client:
        # Assign participant and generate tokens first
        await client.post(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/assign-participants",
            json={"participant_ids": [pid]},
            auth=ADMIN_AUTH,
        )
        await client.post(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/generate-tokens",
            auth=ADMIN_AUTH,
        )

        # Export CSV
        csv_resp = await client.get(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/export-tokens-csv",
            auth=ADMIN_AUTH,
        )
        assert csv_resp.status_code == 200
        assert csv_resp.headers["content-type"].startswith("text/csv")
        assert "attachment" in csv_resp.headers.get("content-disposition", "")

        text = csv_resp.text
        assert "pid" in text
        assert pid in text
        # Should have at least depression_survey and payment_info columns
        assert "depression_survey" in text
        assert "payment_info" in text


@pytest.mark.asyncio
async def test_admin_export_tokens_csv_no_external_tasks():
    """Export CSV for a study without external tasks — only pid column."""
    study_name_short = "default"

    async with httpx.AsyncClient() as client:
        csv_resp = await client.get(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/export-tokens-csv",
            auth=ADMIN_AUTH,
        )
        assert csv_resp.status_code == 200
        text = csv_resp.text
        lines = text.strip().split("\n")
        header = lines[0].strip()
        # Only pid column, no task columns
        assert header == "pid"
        assert len(lines) >= 1


@pytest.mark.asyncio
async def test_admin_export_tokens_csv_unauthorized():
    """CSV export should require authentication."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{BASE_URL}/api/admin/studies/default/export-tokens-csv",
        )
        assert resp.status_code == 401


# ── Pool token tests (open study: adult_pilot_de3) ──


@pytest.mark.asyncio
async def test_pool_tokens_import_csv_adds_tokens():
    """Import pool tokens via CSV for an open study and verify they are added."""
    study_name_short = "adult_pilot_de3"
    unique_tag = uuid.uuid4().hex[:8]
    new_token_dep = f"it-pool-dep-{unique_tag}"
    new_token_pay = f"it-pool-pay-{unique_tag}"

    # Build CSV in-memory: one row with both task columns (no pid)
    csv_content = "depression_survey,payment_info\r\n" + f"{new_token_dep},{new_token_pay}\r\n"

    async with httpx.AsyncClient() as client:
        # Import pool tokens
        import_resp = await client.post(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/import-pool-tokens",
            files={"file": ("tokens.csv", csv_content.encode("utf-8"), "text/csv")},
            auth=ADMIN_AUTH,
        )
        assert import_resp.status_code == 200
        data = import_resp.json()
        assert data["ok"] is True
        assert data["summary"]["tokens_added"] == 2
        assert data["summary"]["duplicates_skipped"] == 0

        # Verify tokens are now in the pool by exporting and checking content
        export_resp = await client.get(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/export-pool-tokens-csv",
            auth=ADMIN_AUTH,
        )
        assert export_resp.status_code == 200
        csv_text = export_resp.text
        assert new_token_dep in csv_text
        assert new_token_pay in csv_text

        # Clean up: delete the tokens we just added via delete-by-token
        for task_key, token in [
            ("depression_survey", new_token_dep),
            ("payment_info", new_token_pay),
        ]:
            del_resp = await client.post(
                f"{BASE_URL}/api/admin/studies/{study_name_short}/delete-tokens/by-token/commit",
                json={"task_key": task_key, "tokens": [token]},
                auth=ADMIN_AUTH,
            )
            assert del_resp.status_code == 200
            assert del_resp.json()["deleted"] >= 1

        # Verify tokens are gone
        export_resp2 = await client.get(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/export-pool-tokens-csv",
            auth=ADMIN_AUTH,
        )
        assert export_resp2.status_code == 200
        assert new_token_dep not in export_resp2.text
        assert new_token_pay not in export_resp2.text


@pytest.mark.asyncio
async def test_pool_tokens_import_rejects_pid_column():
    """Importing a CSV with a pid column should be rejected."""
    study_name_short = "adult_pilot_de3"
    csv_content = "pid,depression_survey,payment_info\r\n" + "someone,tok1,tok2\r\n"

    async with httpx.AsyncClient() as client:
        import_resp = await client.post(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/import-pool-tokens",
            files={"file": ("tokens.csv", csv_content.encode("utf-8"), "text/csv")},
            auth=ADMIN_AUTH,
        )
        assert import_resp.status_code == 400
        detail = import_resp.json()["detail"]
        assert "pid" in detail.lower()


@pytest.mark.asyncio
async def test_pool_tokens_import_skips_duplicates():
    """Duplicates already in the pool should be skipped, not added twice."""
    study_name_short = "adult_pilot_de3"
    unique_tag = uuid.uuid4().hex[:8]
    token_a = f"it-pool-dup-a-{unique_tag}"
    token_b = f"it-pool-dup-b-{unique_tag}"

    csv_content = f"depression_survey,payment_info\r\n{token_a},{token_b}\r\n"

    async with httpx.AsyncClient() as client:
        # First import: both tokens should be added
        resp1 = await client.post(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/import-pool-tokens",
            files={"file": ("tokens.csv", csv_content.encode("utf-8"), "text/csv")},
            auth=ADMIN_AUTH,
        )
        assert resp1.status_code == 200
        data1 = resp1.json()
        assert data1["ok"] is True
        assert data1["summary"]["tokens_added"] == 2
        assert data1["summary"]["duplicates_skipped"] == 0

        # Second import of the same CSV: both should be skipped as duplicates
        resp2 = await client.post(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/import-pool-tokens",
            files={"file": ("tokens.csv", csv_content.encode("utf-8"), "text/csv")},
            auth=ADMIN_AUTH,
        )
        assert resp2.status_code == 200
        data2 = resp2.json()
        assert data2["ok"] is True
        assert data2["summary"]["tokens_added"] == 0
        assert data2["summary"]["duplicates_skipped"] == 2

        # Clean up: delete both tokens
        for task_key, token in [
            ("depression_survey", token_a),
            ("payment_info", token_b),
        ]:
            del_resp = await client.post(
                f"{BASE_URL}/api/admin/studies/{study_name_short}/delete-tokens/by-token/commit",
                json={"task_key": task_key, "tokens": [token]},
                auth=ADMIN_AUTH,
            )
            assert del_resp.status_code == 200
            assert del_resp.json()["deleted"] >= 1


@pytest.mark.asyncio
async def test_pool_tokens_generate_and_export():
    """Generate pool tokens via the API and verify they appear in the export."""
    study_name_short = "adult_pilot_de3"

    async with httpx.AsyncClient() as client:
        # Capture pool tokens BEFORE generating, so we only clean up new ones
        pre_export = await client.get(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/export-pool-tokens-csv",
            auth=ADMIN_AUTH,
        )
        assert pre_export.status_code == 200
        pre_tokens: set[tuple[str, str]] = set()
        for line in pre_export.text.strip().split("\n")[1:]:
            cols = line.split(",")
            if len(cols) >= 2:
                d = cols[0].strip()
                p = cols[1].strip()
                if d or p:
                    pre_tokens.add((d, p))

        # Generate 2 tokens per task
        gen_resp = await client.post(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/generate-pool-tokens",
            json={"count": 2},
            auth=ADMIN_AUTH,
        )
        assert gen_resp.status_code == 200
        gen_data = gen_resp.json()
        assert gen_data["ok"] is True
        assert gen_data["summary"]["total_generated"] >= 4  # 2 per task × 2 tasks

        # Export pool tokens CSV
        export_resp = await client.get(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/export-pool-tokens-csv",
            auth=ADMIN_AUTH,
        )
        assert export_resp.status_code == 200
        assert export_resp.headers["content-type"].startswith("text/csv")
        csv_text = export_resp.text

        # Header should have task keys only (no pid)
        header = csv_text.strip().split("\n")[0]
        assert "pid" not in header.lower()
        assert "depression_survey" in header
        assert "payment_info" in header

        # Clean up: only delete tokens that were NOT in the pre-export
        for line in csv_text.strip().split("\n")[1:]:
            cols = line.split(",")
            if len(cols) < 2:
                continue
            dep_token = cols[0].strip()
            pay_token = cols[1].strip()
            if (dep_token, pay_token) in pre_tokens:
                continue
            for task_key, token in [
                ("depression_survey", dep_token),
                ("payment_info", pay_token),
            ]:
                if token:
                    del_resp = await client.post(
                        f"{BASE_URL}/api/admin/studies/{study_name_short}/delete-tokens/by-token/commit",
                        json={"task_key": task_key, "tokens": [token]},
                        auth=ADMIN_AUTH,
                    )
                    assert del_resp.status_code == 200


@pytest.mark.asyncio
async def test_pool_tokens_export_csv_no_pid():
    """Pool token CSV export must not contain a pid column."""
    study_name_short = "adult_pilot_de3"

    async with httpx.AsyncClient() as client:
        export_resp = await client.get(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/export-pool-tokens-csv",
            auth=ADMIN_AUTH,
        )
        assert export_resp.status_code == 200
        csv_text = export_resp.text
        lines = csv_text.strip().split("\n")
        header = lines[0].strip().split(",")
        assert "pid" not in [h.strip().lower() for h in header]
        # Should have depression_survey and payment_info
        assert "depression_survey" in [h.strip() for h in header]
        assert "payment_info" in [h.strip() for h in header]


@pytest.mark.asyncio
async def test_pool_tokens_page_shows_correct_sections():
    """Open study page should show pool sections, closed should not."""
    open_study = "adult_pilot_de3"
    closed_study = "adult_pilot_de2"

    async with httpx.AsyncClient() as client:
        # Open study: pool sections visible
        open_page = await client.get(
            f"{BASE_URL}/admin/participant-management",
            params={"study_name_short": open_study},
            auth=ADMIN_AUTH,
        )
        assert open_page.status_code == 200
        assert "Add pool tokens to study" in open_page.text
        assert "Export pool tokens" in open_page.text
        # Closed-study import should NOT be visible
        assert "Add participants and task tokens" not in open_page.text

        # Closed study: assigned sections visible
        closed_page = await client.get(
            f"{BASE_URL}/admin/participant-management",
            params={"study_name_short": closed_study},
            auth=ADMIN_AUTH,
        )
        assert closed_page.status_code == 200
        assert "Add participants and task tokens" in closed_page.text
        assert "Export participants and assigned tokens" in closed_page.text
        # Pool sections should NOT be visible
        assert "Add pool tokens to study" not in closed_page.text
        assert "Export pool tokens" not in closed_page.text


@pytest.mark.asyncio
async def test_pool_tokens_import_study_not_found():
    """Import pool tokens for a non-existent study returns 404."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE_URL}/api/admin/studies/nonexistent/import-pool-tokens",
            files={"file": ("tokens.csv", b"depression_survey\ntoken1\n", "text/csv")},
            auth=ADMIN_AUTH,
        )
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_pool_tokens_import_missing_column():
    """Import pool tokens CSV missing a required column returns 400."""
    study_name_short = "adult_pilot_de3"
    csv_content = "depression_survey\r\ntoken1\r\n"  # missing payment_info

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/import-pool-tokens",
            files={"file": ("tokens.csv", csv_content.encode("utf-8"), "text/csv")},
            auth=ADMIN_AUTH,
        )
        assert resp.status_code == 400
@pytest.mark.asyncio
async def test_delete_multiple_participants_basic():
    """Delete multiple participants from a study via the batch endpoint."""
    study_name_short = "default"
    pids = [f"it_batch_del_{uuid.uuid4().hex[:8]}" for _ in range(3)]

    async with httpx.AsyncClient() as client:
        assign_resp = await client.post(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/assign-participants",
            json={"participant_ids": pids},
            auth=ADMIN_AUTH,
        )
        assert assign_resp.status_code == 200

        page = await client.get(
            f"{BASE_URL}/admin/participant-management",
            params={"study_name_short": study_name_short},
            auth=ADMIN_AUTH,
        )
        assert page.status_code == 200
        for pid in pids:
            assert pid in page.text

        del_resp = await client.post(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/delete-participants",
            json={"participant_ids": pids},
            auth=ADMIN_AUTH,
        )
        assert del_resp.status_code == 200
        data = del_resp.json()
        assert data["deleted_participants"] == 3
        assert data["not_found"] == 0

        page2 = await client.get(
            f"{BASE_URL}/admin/participant-management",
            params={"study_name_short": study_name_short},
            auth=ADMIN_AUTH,
        )
        assert page2.status_code == 200
        for pid in pids:
            assert pid not in page2.text


@pytest.mark.asyncio
async def test_delete_multiple_participants_idempotent():
    """Deleting already-deleted participants reports not_found."""
    study_name_short = "default"
    pid = f"it_idem_del_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient() as client:
        await client.post(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/assign-participants",
            json={"participant_ids": [pid]},
            auth=ADMIN_AUTH,
        )

        del1 = await client.post(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/delete-participants",
            json={"participant_ids": [pid]},
            auth=ADMIN_AUTH,
        )
        assert del1.status_code == 200
        assert del1.json()["deleted_participants"] == 1

        del2 = await client.post(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/delete-participants",
            json={"participant_ids": [pid]},
            auth=ADMIN_AUTH,
        )
        assert del2.status_code == 200
        data2 = del2.json()
        assert data2["deleted_participants"] == 0
        assert data2["not_found"] == 1
        assert pid in data2["not_found_pids"]


@pytest.mark.asyncio
async def test_delete_multiple_participants_study_not_found():
    """Batch delete for non-existent study returns 404."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE_URL}/api/admin/studies/nonexistent/delete-participants",
            json={"participant_ids": ["some_pid"]},
            auth=ADMIN_AUTH,
        )
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_multiple_participants_empty_list():
    """Batch delete with empty participant list returns 400."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE_URL}/api/admin/studies/default/delete-participants",
            json={"participant_ids": []},
            auth=ADMIN_AUTH,
        )
        assert resp.status_code == 400


@pytest.mark.asyncio
async def test_delete_multiple_participants_unauthorized():
    """Batch delete requires authentication."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE_URL}/api/admin/studies/default/delete-participants",
            json={"participant_ids": ["some_pid"]},
        )
        assert resp.status_code == 401


@pytest.mark.asyncio
async def test_delete_multiple_participants_cascades_token_assignments():
    """Deleting participants cascades deletes their external task assignments."""
    study_name_short = "adult_pilot_de2"
    pid = f"it_cascade_{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient() as client:
        await client.post(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/assign-participants",
            json={"participant_ids": [pid]},
            auth=ADMIN_AUTH,
        )

        gen_resp = await client.post(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/generate-tokens",
            auth=ADMIN_AUTH,
        )
        assert gen_resp.status_code == 200

        csv_resp = await client.get(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/export-tokens-csv",
            auth=ADMIN_AUTH,
        )
        assert pid in csv_resp.text

        del_resp = await client.post(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/delete-participants",
            json={"participant_ids": [pid]},
            auth=ADMIN_AUTH,
        )
        assert del_resp.status_code == 200
        data = del_resp.json()
        assert data["deleted_participants"] == 1
        assert data["deleted_assignments"] >= 1

        csv_resp2 = await client.get(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/export-tokens-csv",
            auth=ADMIN_AUTH,
        )
        assert pid not in csv_resp2.text


@pytest.mark.asyncio
async def test_delete_users_section_visible_on_page():
    """The 'Delete users (and their tokens)' section appears for a selected study."""
    async with httpx.AsyncClient() as client:
        page = await client.get(
            f"{BASE_URL}/admin/participant-management",
            params={"study_name_short": "default"},
            auth=ADMIN_AUTH,
        )
        assert page.status_code == 200
        assert "Delete users (and their tokens)" in page.text
        assert 'id="deleteUsersInput"' in page.text
        assert 'id="deleteUsersBtn"' in page.text
