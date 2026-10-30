"""Tests for the admin overview's "Admin Users" directory."""

from o_timeusediary_backend.admin_directory import build_admin_directory


def _directory(**overrides):
    kwargs = {
        "super_admin_usernames": ["zoe_super"],
        "scientist_accounts": [
            {"name": "alice", "password": "pw_alice", "studies": ["granted_study"]},
            {"name": "bob", "password": "pw_bob", "studies": []},
        ],
        "backup_usernames": ["backup_bot"],
        "study_owners": {
            "owned_study": ["alice"],
            "shared_study": ["bob"],
            "unowned_study": [],
        },
        "current_username": "zoe_super",
    }
    kwargs.update(overrides)
    return build_admin_directory(**kwargs)


def test_roles_are_listed_with_counts():
    directory = _directory()

    assert [row["username"] for row in directory["super_admins"]] == ["zoe_super"]
    assert [row["username"] for row in directory["scientists"]] == ["alice", "bob"]
    assert [row["username"] for row in directory["backup_accounts"]] == ["backup_bot"]
    assert directory["counts"] == {
        "super_admins": 1,
        "scientists": 2,
        "backup_accounts": 1,
    }


def test_a_scientist_manages_owned_and_granted_studies():
    directory = _directory()

    scopes = {row["username"]: row["manages"] for row in directory["scientists"]}
    assert scopes["alice"] == ["granted_study", "owned_study"]
    assert scopes["bob"] == ["shared_study"]


def test_a_scientist_without_any_study_stays_listed():
    directory = _directory(
        scientist_accounts=[{"name": "carol", "password": "pw_carol"}],
        study_owners={},
    )

    assert directory["scientists"] == [
        {"username": "carol", "manages": [], "is_current": False}
    ]
    assert directory["stale_owners"] == []


def test_overlapping_owner_and_grant_is_listed_once():
    directory = _directory(
        scientist_accounts=[
            {"name": "alice", "password": "pw", "studies": ["owned_study"]}
        ],
        study_owners={"owned_study": ["alice", "alice"]},
    )

    assert directory["scientists"][0]["manages"] == ["owned_study"]


def test_the_current_account_is_marked_per_role():
    assert _directory(current_username="zoe_super")["super_admins"][0]["is_current"]
    assert _directory(current_username="bob")["super_admins"][0]["is_current"] is False
    assert _directory(current_username="bob")["scientists"][1]["is_current"] is True
    assert _directory(current_username="backup_bot")["backup_accounts"][0]["is_current"]


def test_owners_that_are_not_configured_scientists_are_reported():
    directory = _directory(
        study_owners={
            "study_a": ["alice", "removed_scientist"],
            "study_b": ["removed_scientist", "backup_bot"],
        }
    )

    assert directory["stale_owners"] == [
        {"username": "backup_bot", "studies": ["study_b"]},
        {"username": "removed_scientist", "studies": ["study_a", "study_b"]},
    ]
    # A stale owner never counts as a managed study.
    scopes = {row["username"]: row["manages"] for row in directory["scientists"]}
    assert scopes["alice"] == ["granted_study", "study_a"]


def test_names_are_sorted_case_insensitively():
    directory = _directory(
        super_admin_usernames=["Zoe", "adam"],
        scientist_accounts=[
            {"name": "Bob", "password": "pw"},
            {"name": "alice", "password": "pw"},
        ],
        backup_usernames=["Backup", "archive"],
        study_owners={},
    )

    assert [row["username"] for row in directory["super_admins"]] == ["adam", "Zoe"]
    assert [row["username"] for row in directory["scientists"]] == ["alice", "Bob"]
    assert [row["username"] for row in directory["backup_accounts"]] == [
        "archive",
        "Backup",
    ]


def test_passwords_never_reach_the_view_model():
    directory = _directory()

    assert "pw_alice" not in repr(directory)
    assert "password" not in repr(directory)
