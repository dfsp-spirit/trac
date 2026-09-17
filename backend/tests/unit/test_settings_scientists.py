"""Tests for the scientist configuration in `TUD_API_SCIENTISTS`."""

import pytest

from o_timeusediary_backend.settings import TUDBackendSettings


def _set_admin_env(monkeypatch):
    monkeypatch.setenv("TUD_API_ADMIN_USERNAME", "super_admin")
    monkeypatch.setenv("TUD_API_ADMIN_PASSWORD", "super_password")


def test_scientists_unset_yields_empty_configuration(monkeypatch):
    monkeypatch.delenv("TUD_API_SCIENTISTS", raising=False)
    _set_admin_env(monkeypatch)

    settings = TUDBackendSettings()

    assert settings.scientists == []
    assert settings.scientist_names == []
    assert settings.scientist_credentials == []
    assert settings.scientist_study_grants == {}

    # An empty scientist list is a valid configuration.
    settings.validate_auth_configuration()


def test_scientists_from_json_list(monkeypatch):
    monkeypatch.setenv(
        "TUD_API_SCIENTISTS",
        (
            '[{"name": "alice", "password": "pw_alice", "studies": ["study_a"]},'
            ' {"name": "bob", "password": "pw_bob"}]'
        ),
    )
    _set_admin_env(monkeypatch)

    settings = TUDBackendSettings()

    assert settings.scientist_names == ["alice", "bob"]
    assert settings.scientist_credentials == [
        ("alice", "pw_alice"),
        ("bob", "pw_bob"),
    ]
    # 'studies' is optional and defaults to "no extra grants".
    assert settings.scientist_study_grants == {"alice": ["study_a"], "bob": []}

    settings.validate_auth_configuration()


def test_scientists_reject_invalid_json(monkeypatch):
    monkeypatch.setenv("TUD_API_SCIENTISTS", "[not-json")
    _set_admin_env(monkeypatch)

    settings = TUDBackendSettings()

    with pytest.raises(ValueError, match="valid JSON list"):
        _ = settings.scientists


def test_scientists_reject_non_list_payload(monkeypatch):
    monkeypatch.setenv("TUD_API_SCIENTISTS", '{"name": "alice"}')
    _set_admin_env(monkeypatch)

    settings = TUDBackendSettings()

    with pytest.raises(ValueError, match="JSON list"):
        _ = settings.scientists


@pytest.mark.parametrize(
    "raw_value, expected_message",
    [
        ('["alice"]', "must be an object"),
        ('[{"password": "pw"}]', "non-empty string 'name'"),
        ('[{"name": "", "password": "pw"}]', "non-empty string 'name'"),
        ('[{"name": "alice"}]', "non-empty string 'password'"),
        ('[{"name": "alice", "password": ""}]', "non-empty string 'password'"),
        (
            '[{"name": "alice", "password": "pw", "studies": "study_a"}]',
            "must be a JSON list",
        ),
        (
            '[{"name": "alice", "password": "pw", "studies": [""]}]',
            "must be a JSON list",
        ),
        (
            '[{"name": "alice", "password": "pw"}, {"name": "alice", "password": "pw2"}]',
            "duplicate scientist names",
        ),
    ],
)
def test_scientists_reject_invalid_entries(monkeypatch, raw_value, expected_message):
    monkeypatch.setenv("TUD_API_SCIENTISTS", raw_value)
    _set_admin_env(monkeypatch)

    settings = TUDBackendSettings()

    with pytest.raises(ValueError, match=expected_message):
        _ = settings.scientists


def test_validate_auth_configuration_rejects_scientist_admin_name_overlap(monkeypatch):
    monkeypatch.setenv("TUD_API_ADMIN_USERNAME", "shared_name")
    monkeypatch.setenv("TUD_API_ADMIN_PASSWORD", "super_password")
    monkeypatch.setenv(
        "TUD_API_SCIENTISTS", '[{"name": "shared_name", "password": "pw"}]'
    )

    settings = TUDBackendSettings()

    with pytest.raises(ValueError, match="both as super admin .* and as scientist"):
        settings.validate_auth_configuration()


def test_validate_auth_configuration_rejects_mismatched_admin_lists(monkeypatch):
    monkeypatch.setenv("TUD_API_ADMIN_USERNAME", '["admin1", "admin2"]')
    monkeypatch.setenv("TUD_API_ADMIN_PASSWORD", '["pass1"]')
    monkeypatch.delenv("TUD_API_SCIENTISTS", raising=False)

    settings = TUDBackendSettings()

    with pytest.raises(ValueError, match="same number of entries"):
        settings.validate_auth_configuration()
