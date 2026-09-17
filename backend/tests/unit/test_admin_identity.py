"""Tests for admin identity resolution and study-scope authorization."""

import os
from types import SimpleNamespace

# Must be set before importing modules that build the DB engine at import time.
os.environ.setdefault("TUD_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("TUD_ALLOWED_ORIGINS", '["http://localhost:3000"]')

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPBasicCredentials

from o_timeusediary_backend.api_deps.admin_auth import (
    ROLE_SCIENTIST,
    ROLE_SUPER_ADMIN,
    AdminIdentity,
    _study_name_from_request_path,
    enforce_admin_study_scope,
    resolve_admin_identity,
)
from o_timeusediary_backend.models import Study


def _set_admin_env(monkeypatch):
    monkeypatch.setenv("TUD_API_ADMIN_USERNAME", "super_admin")
    monkeypatch.setenv("TUD_API_ADMIN_PASSWORD", "super_password")
    monkeypatch.setenv(
        "TUD_API_SCIENTISTS",
        (
            '[{"name": "alice", "password": "pw_alice", "studies": ["granted_study"]},'
            ' {"name": "bob", "password": "pw_bob"}]'
        ),
    )


def _credentials(username: str, password: str) -> HTTPBasicCredentials:
    return HTTPBasicCredentials(username=username, password=password)


def _study(name_short: str, owner_usernames=None) -> Study:
    return Study(
        id=1,
        name=f"Study {name_short}",
        name_short=name_short,
        activities_json_url=f"db_blob://{name_short}/en",
        data_collection_start="2024-01-01T00:00:00Z",
        data_collection_end="2030-01-01T00:00:00Z",
        owner_usernames=owner_usernames,
    )


def test_resolve_super_admin_identity(monkeypatch):
    _set_admin_env(monkeypatch)

    identity = resolve_admin_identity(_credentials("super_admin", "super_password"))

    assert identity.username == "super_admin"
    assert identity.role == ROLE_SUPER_ADMIN
    assert identity.is_super_admin is True


def test_resolve_scientist_identity_includes_env_grants(monkeypatch):
    _set_admin_env(monkeypatch)

    identity = resolve_admin_identity(_credentials("alice", "pw_alice"))

    assert identity.username == "alice"
    assert identity.role == ROLE_SCIENTIST
    assert identity.is_super_admin is False
    assert identity.granted_study_names == frozenset({"granted_study"})


@pytest.mark.parametrize(
    "username, password",
    [
        ("super_admin", "wrong"),
        ("nobody", "whatever"),
        ("alice", "super_password"),
    ],
)
def test_resolve_admin_identity_rejects_invalid_credentials(
    monkeypatch, username, password
):
    _set_admin_env(monkeypatch)

    with pytest.raises(HTTPException) as exc_info:
        resolve_admin_identity(_credentials(username, password))

    assert exc_info.value.status_code == 401


def test_super_admin_can_access_every_study():
    identity = AdminIdentity(username="super_admin", role=ROLE_SUPER_ADMIN)

    assert identity.can_access_study(_study("any_study")) is True
    assert identity.can_access_study(_study("any_study", ["someone_else"])) is True


def test_scientist_access_via_ownership_and_env_grant():
    identity = AdminIdentity(
        username="alice",
        role=ROLE_SCIENTIST,
        granted_study_names=frozenset({"granted_study"}),
    )

    assert identity.can_access_study(_study("owned_study", ["alice"])) is True
    assert identity.can_access_study(_study("shared_study", ["bob", "alice"])) is True
    assert identity.can_access_study(_study("granted_study")) is True
    assert identity.can_access_study(_study("foreign_study", ["bob"])) is False
    assert identity.can_access_study(_study("unowned_study")) is False


@pytest.mark.parametrize(
    "path, expected",
    [
        ("/admin/study/default", "default"),
        ("/api/admin/studies/default", "default"),
        ("/api/admin/studies/default/pause", "default"),
        (
            "/api/admin/studies/default/external-tasks/task1/pool/status",
            "default",
        ),
        ("/api/admin/export/default/activities", "default"),
        # Creating studies is not study scoped.
        ("/api/admin/studies/import-config", None),
        ("/api/admin/studies/create-from-files", None),
        ("/api/admin/validate/files", None),
        ("/api/admin/export/studies-runtime-config", None),
        ("/admin", None),
        ("/admin/participant-management", None),
    ],
)
def test_study_name_from_request_path(path, expected):
    request = SimpleNamespace(scope={"path": path})

    assert _study_name_from_request_path(request) == expected


def test_study_name_from_request_path_strips_root_path(monkeypatch):
    _set_admin_env(monkeypatch)
    monkeypatch.setenv("TUD_ROOTPATH", "/tud_backend")
    request = SimpleNamespace(scope={"path": "/tud_backend/api/admin/studies/default"})

    assert _study_name_from_request_path(request) == "default"


class _FakeSession:
    """Minimal session stub returning a fixed study for the name_short lookup."""

    def __init__(self, study):
        self.study = study

    def exec(self, _statement):
        study = self.study

        class _Result:
            def first(self_inner):
                return study

        return _Result()


def test_enforce_scope_denies_foreign_study_for_scientist(monkeypatch):
    _set_admin_env(monkeypatch)
    identity = AdminIdentity(username="alice", role=ROLE_SCIENTIST)
    request = SimpleNamespace(scope={"path": "/api/admin/studies/foreign_study/pause"})

    with pytest.raises(HTTPException) as exc_info:
        enforce_admin_study_scope(
            request, identity, _FakeSession(_study("foreign_study", ["bob"]))
        )

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail["code"] == "study_access_denied"


def test_enforce_scope_allows_owned_study_and_unknown_study(monkeypatch):
    _set_admin_env(monkeypatch)
    identity = AdminIdentity(username="alice", role=ROLE_SCIENTIST)

    # Owned study: allowed.
    enforce_admin_study_scope(
        SimpleNamespace(scope={"path": "/api/admin/studies/owned/pause"}),
        identity,
        _FakeSession(_study("owned", ["alice"])),
    )

    # Unknown study: left to the route handler, which reports the 404.
    enforce_admin_study_scope(
        SimpleNamespace(scope={"path": "/api/admin/studies/missing/pause"}),
        identity,
        _FakeSession(None),
    )


def test_enforce_scope_never_blocks_super_admin(monkeypatch):
    _set_admin_env(monkeypatch)
    identity = AdminIdentity(username="super_admin", role=ROLE_SUPER_ADMIN)

    enforce_admin_study_scope(
        SimpleNamespace(scope={"path": "/api/admin/studies/foreign_study"}),
        identity,
        _FakeSession(_study("foreign_study", ["bob"])),
    )
