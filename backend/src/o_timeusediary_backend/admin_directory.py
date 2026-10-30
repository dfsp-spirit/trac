"""Who may administer this instance, derived from the runtime configuration.

There is no admin table in the database: accounts live in the environment
(``TUD_API_ADMIN_USERNAME``, ``TUD_API_SCIENTISTS``, ``TUD_API_BACKUP_USERS``),
so this module turns that configuration plus the studies' owner lists into a
small view model for the admin overview page.

``settings.validate_auth_configuration`` already guarantees that the three
account lists are disjoint, so no deduplication across roles is needed here.
Passwords are never part of the result - only usernames and their scope.
"""

from __future__ import annotations

from collections.abc import Iterable


def _sort_key(username: str) -> tuple[str, str]:
    """Sort case-insensitively, but deterministically for names differing in case."""
    return (username.lower(), username)


def build_admin_directory(
    *,
    super_admin_usernames: Iterable[str],
    scientist_accounts: Iterable[dict],
    backup_usernames: Iterable[str],
    study_owners: dict[str, Iterable[str]],
    current_username: str | None = None,
) -> dict:
    """Build the "Admin Users" view model for the admin overview page.

    @param super_admin_usernames Configured super admin usernames.
    @param scientist_accounts Configured scientist entries (``name`` + ``studies``).
    @param backup_usernames Configured read-only extraction account usernames.
    @param study_owners Study ``name_short`` -> usernames listed as its owners.
    @param current_username The authenticated account, marked as "(you)".
    @returns Role groups, per-scientist scope, stale owner entries and counts.
    """
    scientists = list(scientist_accounts)
    scientist_names = {scientist["name"] for scientist in scientists}

    # A scientist's scope is the union of the studies it owns and the studies
    # granted in the environment, because both grant exactly the same access.
    owned: dict[str, list[str]] = {}
    for name_short, owners in study_owners.items():
        for owner in owners:
            if owner in scientist_names:
                owned.setdefault(owner, []).append(name_short)

    scientist_rows = []
    for scientist in scientists:
        username = scientist["name"]
        manages = set(owned.get(username, [])) | set(scientist.get("studies") or [])
        scientist_rows.append(
            {
                "username": username,
                "manages": sorted(manages, key=_sort_key),
                "is_current": username == current_username,
            }
        )

    # Owners that are no longer configured as scientists grant access to nobody,
    # but they still sit in the study's owner list and only a super admin can
    # clean them up. This listing is the only place where they surface.
    stale: dict[str, list[str]] = {}
    for name_short, owners in study_owners.items():
        for owner in owners:
            if owner not in scientist_names:
                stale.setdefault(owner, []).append(name_short)

    super_admins = [
        {"username": username, "is_current": username == current_username}
        for username in sorted(set(super_admin_usernames), key=_sort_key)
    ]
    backup_accounts = [
        {"username": username, "is_current": username == current_username}
        for username in sorted(set(backup_usernames), key=_sort_key)
    ]

    return {
        "super_admins": super_admins,
        "scientists": sorted(
            scientist_rows, key=lambda row: _sort_key(row["username"])
        ),
        "backup_accounts": backup_accounts,
        "stale_owners": [
            {"username": username, "studies": sorted(studies, key=_sort_key)}
            for username, studies in sorted(
                stale.items(), key=lambda item: _sort_key(item[0])
            )
        ],
        "counts": {
            "super_admins": len(super_admins),
            "scientists": len(scientist_rows),
            "backup_accounts": len(backup_accounts),
        },
    }
