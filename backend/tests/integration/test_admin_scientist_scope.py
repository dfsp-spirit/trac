"""Integration tests for scoped scientist administration.

Requires at least two scientists configured through ``TUD_API_SCIENTISTS``
(see ``dev_tools/ci/backend_settings/.env.ci`` and
``dev_tools/local_nginx/backend_settings/.env.dev-nginx``). Run against a server
started with that configuration, e.g.::

    TUD_BASE_SCHEME=http://localhost:8001 uv run pytest tests/integration/test_admin_scientist_scope.py

The tests document the intended isolation: a scientist may fully manage the
studies she owns (or that are granted to her via the env config), and gets HTTP
403 for every other study. Super admins keep unrestricted access.
"""

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

SCIENTISTS = settings.scientists
SCIENTIST_A = SCIENTISTS[0] if len(SCIENTISTS) >= 1 else None
SCIENTIST_B = SCIENTISTS[1] if len(SCIENTISTS) >= 2 else None

SCIENTIST_A_AUTH = (
    (SCIENTIST_A["name"], SCIENTIST_A["password"]) if SCIENTIST_A else None
)
SCIENTIST_B_AUTH = (
    (SCIENTIST_B["name"], SCIENTIST_B["password"]) if SCIENTIST_B else None
)

requires_two_scientists = pytest.mark.skipif(
    SCIENTIST_A is None or SCIENTIST_B is None,
    reason=(
        "Needs two scientists in TUD_API_SCIENTISTS to verify cross-study isolation."
    ),
)


def _require_authenticated(response: httpx.Response, auth) -> None:
    """Fail with an actionable message when the server does not know the account.

    A 401 here means the *server* was started without the scientist configuration
    (for example an older `.env`), not that the scope logic is broken.
    """
    if response.status_code == 401:
        raise AssertionError(
            f"Server rejected credentials {auth[0]!r} (401). Make sure the running "
            "backend was started with TUD_API_SCIENTISTS including this account."
        )


def _load_activities_template() -> dict:
    backend_root = Path(__file__).resolve().parents[2]
    return json.loads(
        (backend_root / "activities_default.json").read_text(encoding="utf-8")
    )


def _build_study_payload(study_name_short: str) -> dict:
    return {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"Scope Test Study {study_name_short}",
                "name_short": study_name_short,
                "description": "Study created by integration tests for scientist scoping",
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
                "activities_json_data": {"en": _load_activities_template()},
                "data_collection_start": "2024-01-01T00:00:00Z",
                "data_collection_end": "2028-12-31T23:59:59Z",
            }
        ],
    }


def _set_owners(study_name_short: str, owners) -> httpx.Response:
    with httpx.Client(timeout=60.0) as client:
        return client.patch(
            f"{BASE_URL}/api/admin/studies/{study_name_short}/owners",
            json={"owner_usernames": owners},
            auth=ADMIN_AUTH,
        )


@pytest.fixture
def scoped_studies():
    """Create one study owned by scientist A and one owned by scientist B."""
    suffix = uuid.uuid4().hex[:8]
    study_a = f"it_scope_a_{suffix}"
    study_b = f"it_scope_b_{suffix}"

    with httpx.Client(timeout=60.0) as client:
        for name_short in (study_a, study_b):
            response = client.post(
                f"{BASE_URL}/api/admin/studies/import-config",
                json=_build_study_payload(name_short),
                auth=ADMIN_AUTH,
            )
            assert response.status_code == 200, response.text
            assert response.json()["summary"]["created"] == 1, response.text

    for name_short, owner in (
        (study_a, SCIENTIST_A["name"]),
        (study_b, SCIENTIST_B["name"]),
    ):
        response = _set_owners(name_short, [owner])
        assert response.status_code == 200, response.text

    try:
        yield {
            "study_a": study_a,
            "study_b": study_b,
            "scientist_a": SCIENTIST_A["name"],
            "scientist_b": SCIENTIST_B["name"],
        }
    finally:
        with httpx.Client(timeout=60.0) as client:
            for name_short in (study_b, study_a):
                response = client.delete(
                    f"{BASE_URL}/api/admin/studies/{name_short}", auth=ADMIN_AUTH
                )
                assert response.status_code in (200, 404), response.text


@requires_two_scientists
def test_scientist_authentication_and_role_separation(scoped_studies):
    """Scientists authenticate with their own credentials; wrong secrets fail."""
    with httpx.Client(timeout=30.0) as client:
        no_auth = client.get(f"{BASE_URL}/admin")
        assert no_auth.status_code == 401

        wrong_password = client.get(
            f"{BASE_URL}/admin",
            auth=(scoped_studies["scientist_a"], "definitely-the-wrong-password"),
        )
        assert wrong_password.status_code == 401

        scientist_a = client.get(f"{BASE_URL}/admin", auth=SCIENTIST_A_AUTH)
        _require_authenticated(scientist_a, SCIENTIST_A_AUTH)
        assert scientist_a.status_code == 200

        super_admin = client.get(f"{BASE_URL}/admin", auth=ADMIN_AUTH)
        assert super_admin.status_code == 200


@requires_two_scientists
def test_scientist_can_fully_manage_owned_study_but_not_foreign_study(scoped_studies):
    study_a = scoped_studies["study_a"]
    study_b = scoped_studies["study_b"]

    with httpx.Client(timeout=60.0) as client:
        # Owned study: full access.
        owned_detail = client.get(
            f"{BASE_URL}/admin/study/{study_a}", auth=SCIENTIST_A_AUTH
        )
        _require_authenticated(owned_detail, SCIENTIST_A_AUTH)
        assert owned_detail.status_code == 200

        owned_summary = client.get(
            f"{BASE_URL}/api/admin/studies/{study_a}/available-activities-summary",
            auth=SCIENTIST_A_AUTH,
        )
        assert owned_summary.status_code == 200

        # Foreign study: denied on read, write and destructive endpoints.
        foreign_detail = client.get(
            f"{BASE_URL}/admin/study/{study_b}", auth=SCIENTIST_A_AUTH
        )
        assert foreign_detail.status_code == 403
        assert foreign_detail.json()["detail"]["code"] == "study_access_denied"

        assert (
            client.get(
                f"{BASE_URL}/api/admin/studies/{study_b}/available-activities-summary",
                auth=SCIENTIST_A_AUTH,
            ).status_code
            == 403
        )
        assert (
            client.patch(
                f"{BASE_URL}/api/admin/studies/{study_b}/pause", auth=SCIENTIST_A_AUTH
            ).status_code
            == 403
        )
        assert (
            client.delete(
                f"{BASE_URL}/api/admin/studies/{study_b}", auth=SCIENTIST_A_AUTH
            ).status_code
            == 403
        )

        # The owner of the foreign study keeps access.
        assert (
            client.get(
                f"{BASE_URL}/admin/study/{study_b}", auth=SCIENTIST_B_AUTH
            ).status_code
            == 200
        )

        # Pause/unpause round trip on the owned study still works.
        pause = client.patch(
            f"{BASE_URL}/api/admin/studies/{study_a}/pause", auth=SCIENTIST_A_AUTH
        )
        assert pause.status_code == 200, pause.text
        unpause = client.patch(
            f"{BASE_URL}/api/admin/studies/{study_a}/unpause", auth=SCIENTIST_A_AUTH
        )
        assert unpause.status_code == 200, unpause.text


@requires_two_scientists
def test_scientist_cannot_bulk_import_or_export_all_studies(scoped_studies):
    study_a = scoped_studies["study_a"]
    study_b = scoped_studies["study_b"]

    with httpx.Client(timeout=60.0) as client:
        import_response = client.post(
            f"{BASE_URL}/api/admin/studies/import-config",
            json=_build_study_payload(f"it_scope_forbidden_{uuid.uuid4().hex[:8]}"),
            auth=SCIENTIST_A_AUTH,
        )
        _require_authenticated(import_response, SCIENTIST_A_AUTH)
        assert import_response.status_code == 403
        assert import_response.json()["detail"]["code"] == "super_admin_required"

        export_all = client.get(
            f"{BASE_URL}/api/admin/export/studies-runtime-config", auth=SCIENTIST_A_AUTH
        )
        assert export_all.status_code == 403

        export_own = client.get(
            f"{BASE_URL}/api/admin/export/studies-runtime-config",
            params={"study_name": study_a},
            auth=SCIENTIST_A_AUTH,
        )
        assert export_own.status_code == 200

        export_foreign = client.get(
            f"{BASE_URL}/api/admin/export/studies-runtime-config",
            params={"study_name": study_b},
            auth=SCIENTIST_A_AUTH,
        )
        assert export_foreign.status_code == 403

        # Super admins keep full access, including the all-studies export.
        assert (
            client.get(
                f"{BASE_URL}/api/admin/export/studies-runtime-config", auth=ADMIN_AUTH
            ).status_code
            == 200
        )


@requires_two_scientists
def test_participant_management_page_is_scoped(scoped_studies):
    study_a = scoped_studies["study_a"]
    study_b = scoped_studies["study_b"]

    with httpx.Client(timeout=60.0) as client:
        own_page = client.get(
            f"{BASE_URL}/admin/participant-management",
            params={"study_name_short": study_a},
            auth=SCIENTIST_A_AUTH,
        )
        _require_authenticated(own_page, SCIENTIST_A_AUTH)
        assert own_page.status_code == 200

        foreign_page = client.get(
            f"{BASE_URL}/admin/participant-management",
            params={"study_name_short": study_b},
            auth=SCIENTIST_A_AUTH,
        )
        assert foreign_page.status_code == 403


@requires_two_scientists
def test_admin_overview_lists_only_accessible_studies(scoped_studies):
    study_a = scoped_studies["study_a"]
    study_b = scoped_studies["study_b"]

    with httpx.Client(timeout=60.0) as client:
        scientist_overview = client.get(f"{BASE_URL}/admin", auth=SCIENTIST_A_AUTH)
        _require_authenticated(scientist_overview, SCIENTIST_A_AUTH)
        assert scientist_overview.status_code == 200
        body = scientist_overview.text
        assert study_a in body
        assert study_b not in body

        admin_overview = client.get(f"{BASE_URL}/admin", auth=ADMIN_AUTH)
        assert admin_overview.status_code == 200
        assert study_a in admin_overview.text
        assert study_b in admin_overview.text


@requires_two_scientists
def test_owner_management_rules(scoped_studies):
    study_a = scoped_studies["study_a"]

    with httpx.Client(timeout=60.0) as client:
        # An owner may add another scientist as co-owner.
        add_co_owner = client.patch(
            f"{BASE_URL}/api/admin/studies/{study_a}/owners",
            json={"owner_usernames": [SCIENTIST_A["name"], SCIENTIST_B["name"]]},
            auth=SCIENTIST_A_AUTH,
        )
        assert add_co_owner.status_code == 200, add_co_owner.text
        assert sorted(add_co_owner.json()["owner_usernames"]) == sorted(
            [SCIENTIST_A["name"], SCIENTIST_B["name"]]
        )

        # The co-owner now has access.
        assert (
            client.get(
                f"{BASE_URL}/admin/study/{study_a}", auth=SCIENTIST_B_AUTH
            ).status_code
            == 200
        )

        # Scientists cannot remove themselves.
        self_removal = client.patch(
            f"{BASE_URL}/api/admin/studies/{study_a}/owners",
            json={"owner_usernames": [SCIENTIST_A["name"]]},
            auth=SCIENTIST_B_AUTH,
        )
        assert self_removal.status_code == 403
        assert self_removal.json()["detail"]["code"] == "cannot_remove_self"

        # Unknown scientists are rejected.
        unknown = client.patch(
            f"{BASE_URL}/api/admin/studies/{study_a}/owners",
            json={
                "owner_usernames": [SCIENTIST_A["name"], "not_a_configured_scientist"]
            },
            auth=SCIENTIST_A_AUTH,
        )
        assert unknown.status_code == 400
        assert unknown.json()["detail"]["code"] == "unknown_scientist"

        # A super admin can remove the co-owner again.
        remove_co_owner = client.patch(
            f"{BASE_URL}/api/admin/studies/{study_a}/owners",
            json={"owner_usernames": [SCIENTIST_A["name"]]},
            auth=ADMIN_AUTH,
        )
        assert remove_co_owner.status_code == 200, remove_co_owner.text
        assert (
            client.get(
                f"{BASE_URL}/admin/study/{study_a}", auth=SCIENTIST_B_AUTH
            ).status_code
            == 403
        )

        # A super admin can also make a study unowned (super admins only).
        unowned = client.patch(
            f"{BASE_URL}/api/admin/studies/{study_a}/owners",
            json={"owner_usernames": []},
            auth=ADMIN_AUTH,
        )
        assert unowned.status_code == 200, unowned.text
        assert unowned.json()["owner_usernames"] == []
        assert (
            client.get(
                f"{BASE_URL}/admin/study/{study_a}", auth=SCIENTIST_A_AUTH
            ).status_code
            == 403
        )
        assert (
            client.get(f"{BASE_URL}/admin/study/{study_a}", auth=ADMIN_AUTH).status_code
            == 200
        )

        # Restore the owner so the fixture cleanup keeps working as expected.
        restored = _set_owners(study_a, [SCIENTIST_A["name"]])
        assert restored.status_code == 200, restored.text


# Every admin route whose path contains a study short name must deny a scientist
# without access. Adding a new study-scoped route without protection makes this
# matrix fail, which is the point: it is an exhaustive guard.
STUDY_SCOPED_ADMIN_ENDPOINTS = [
    ("GET", "/admin/study/{study}", None),
    ("GET", "/api/admin/studies/{study}/available-activities-summary", None),
    (
        "PATCH",
        "/api/admin/studies/{study}/collection-window",
        {"data_collection_start": None},
    ),
    ("PATCH", "/api/admin/studies/{study}/pause", None),
    ("PATCH", "/api/admin/studies/{study}/unpause", None),
    ("PATCH", "/api/admin/studies/{study}/rename", {"name_short": "{study}"}),
    ("PATCH", "/api/admin/studies/{study}/owners", {"owner_usernames": []}),
    ("POST", "/api/admin/studies/{study}/import-external-tokens", "upload"),
    ("POST", "/api/admin/studies/{study}/import-pool-tokens", "upload"),
    ("POST", "/api/admin/studies/{study}/generate-tokens", None),
    (
        "POST",
        "/api/admin/studies/{study}/external-tasks/{task_key}/pool/add-tokens",
        {"tokens": ["abc"], "token_group_name": "pool"},
    ),
    (
        "POST",
        "/api/admin/studies/{study}/external-tasks/{task_key}/pool/generate",
        {"count": 1, "token_group_name": "pool"},
    ),
    (
        "GET",
        "/api/admin/studies/{study}/external-tasks/{task_key}/pool/status",
        None,
    ),
    ("GET", "/api/admin/studies/{study}/export-tokens-csv", None),
    ("POST", "/api/admin/studies/{study}/generate-pool-tokens", None),
    ("GET", "/api/admin/studies/{study}/export-pool-tokens-csv", None),
    ("POST", "/api/admin/studies/{study}/assign-participants", {"participant_ids": []}),
    (
        "DELETE",
        "/api/admin/studies/{study}/participants/{participant_id}",
        None,
    ),
    ("POST", "/api/admin/studies/{study}/delete-participants", {"participant_ids": []}),
    (
        "DELETE",
        "/api/admin/studies/{study}/participants/{participant_id}/data",
        None,
    ),
    (
        "POST",
        "/api/admin/studies/{study}/participants/{participant_id}/external-tasks/reseed",
        None,
    ),
    (
        "POST",
        "/api/admin/studies/{study}/delete-tokens/by-pid/preview",
        {"task_key": "missing_task", "participant_ids": []},
    ),
    (
        "POST",
        "/api/admin/studies/{study}/delete-tokens/by-token/preview",
        {"task_key": "missing_task", "tokens": []},
    ),
    (
        "POST",
        "/api/admin/studies/{study}/delete-tokens/by-pid/commit",
        {"task_key": "missing_task", "participant_ids": []},
    ),
    (
        "POST",
        "/api/admin/studies/{study}/delete-tokens/by-token/commit",
        {"task_key": "missing_task", "tokens": []},
    ),
    ("POST", "/api/admin/studies/{study}/delete-all-tokens/assigned", None),
    ("POST", "/api/admin/studies/{study}/delete-all-tokens/pool", None),
    ("DELETE", "/api/admin/studies/{study}/participant-data", None),
    ("DELETE", "/api/admin/studies/{study}", None),
    ("GET", "/api/admin/export/{study}/activities", None),
]


@requires_two_scientists
@pytest.mark.parametrize(
    "method, path_template, json_body",
    STUDY_SCOPED_ADMIN_ENDPOINTS,
    ids=[f"{method} {path}" for method, path, _ in STUDY_SCOPED_ADMIN_ENDPOINTS],
)
def test_every_study_scoped_endpoint_denies_foreign_scientist(
    scoped_studies, method, path_template, json_body
):
    path = (
        path_template.replace("{study}", scoped_studies["study_b"])
        .replace("{task_key}", "missing_task")
        .replace("{participant_id}", "missing_participant")
    )

    request_kwargs = {"auth": SCIENTIST_A_AUTH}
    if json_body == "upload":
        request_kwargs["files"] = {"file": ("tokens.csv", b"pid\n", "text/csv")}
    elif json_body is not None:
        request_kwargs["json"] = {
            key: (
                value.replace("{study}", scoped_studies["study_b"])
                if isinstance(value, str)
                else value
            )
            for key, value in json_body.items()
        }

    with httpx.Client(timeout=60.0) as client:
        response = client.request(method, f"{BASE_URL}{path}", **request_kwargs)

    _require_authenticated(response, SCIENTIST_A_AUTH)
    assert response.status_code == 403, (
        f"{method} {path} returned {response.status_code} instead of 403 for a "
        f"scientist without access to the study: {response.text[:300]}"
    )
