"""Banner messages: participant delivery and admin editing.

Requires a running backend (see ``./test_backend_integration.sh``). The
server-wide message is deployment state, so every test that touches it clears it
again - a leftover "maintenance" banner would follow the next test run around.
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
    reason="Needs two scientists in TUD_API_SCIENTISTS to verify cross-study isolation.",
)


def _load_activities_template() -> dict:
    backend_root = Path(__file__).resolve().parents[2]
    return json.loads(
        (backend_root / "activities_default.json").read_text(encoding="utf-8")
    )


def _study_payload(study_name_short: str) -> dict:
    return {
        "mode": "create_only",
        "transaction_mode": "all_or_nothing",
        "studies": [
            {
                "name": f"Message Test Study {study_name_short}",
                "name_short": study_name_short,
                "description": "Study created by the banner-message integration tests",
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


def _clear_server_message(client: httpx.Client) -> None:
    response = client.put(
        f"{BASE_URL}/api/admin/messages/server",
        json={"text": {}, "audience": "participants", "is_active": False},
        auth=ADMIN_AUTH,
    )
    assert response.status_code == 200, response.text


@pytest.fixture
def clean_server_message():
    with httpx.Client(timeout=30.0) as client:
        _clear_server_message(client)
        try:
            yield client
        finally:
            _clear_server_message(client)


@pytest.fixture
def message_studies():
    """Two studies: one owned by scientist A, one by scientist B."""
    suffix = uuid.uuid4().hex[:8]
    study_a = f"it_msg_a_{suffix}"
    study_b = f"it_msg_b_{suffix}"

    with httpx.Client(timeout=60.0) as client:
        for name_short in (study_a, study_b):
            response = client.post(
                f"{BASE_URL}/api/admin/studies/import-config",
                json=_study_payload(name_short),
                auth=ADMIN_AUTH,
            )
            assert response.status_code == 200, response.text
            assert response.json()["summary"]["created"] == 1, response.text

    if SCIENTIST_A is not None and SCIENTIST_B is not None:
        with httpx.Client(timeout=60.0) as client:
            for name_short, owner in (
                (study_a, SCIENTIST_A["name"]),
                (study_b, SCIENTIST_B["name"]),
            ):
                response = client.patch(
                    f"{BASE_URL}/api/admin/studies/{name_short}/owners",
                    json={"owner_usernames": [owner]},
                    auth=ADMIN_AUTH,
                )
                assert response.status_code == 200, response.text

    try:
        yield {"study_a": study_a, "study_b": study_b}
    finally:
        with httpx.Client(timeout=60.0) as client:
            for name_short in (study_b, study_a):
                response = client.delete(
                    f"{BASE_URL}/api/admin/studies/{name_short}", auth=ADMIN_AUTH
                )
                assert response.status_code in (200, 404), response.text


def test_server_message_reaches_participants_but_not_the_admin_panel(
    clean_server_message,
):
    client = clean_server_message
    saved = client.put(
        f"{BASE_URL}/api/admin/messages/server",
        json={
            "text": {"de": "Wartung heute", "en": "Maintenance tonight"},
            "audience": "participants",
            "is_active": True,
        },
        auth=ADMIN_AUTH,
    )
    assert saved.status_code == 200, saved.text

    german = client.get(f"{BASE_URL}/api/messages", params={"lang": "de"})
    assert german.status_code == 200
    assert german.json()["server"]["text"] == "Wartung heute"

    english = client.get(f"{BASE_URL}/api/messages", params={"lang": "en"})
    assert english.json()["server"]["text"] == "Maintenance tonight"

    # The reader's language changes the text, not the identity of the message.
    assert german.json()["server"]["key"] == english.json()["server"]["key"]

    # audience=participants means the admin panel shows nothing.
    admin_banner = client.get(f"{BASE_URL}/api/admin/messages", auth=ADMIN_AUTH)
    assert admin_banner.status_code == 200
    assert admin_banner.json()["server"] is None


def test_server_message_for_both_audiences_appears_in_the_admin_panel(
    clean_server_message,
):
    client = clean_server_message
    saved = client.put(
        f"{BASE_URL}/api/admin/messages/server",
        json={
            "text": {"en": "Maintenance tonight"},
            "audience": "both",
            "is_active": True,
        },
        auth=ADMIN_AUTH,
    )
    assert saved.status_code == 200, saved.text

    participant = client.get(f"{BASE_URL}/api/messages")
    admin_banner = client.get(f"{BASE_URL}/api/admin/messages", auth=ADMIN_AUTH)
    assert participant.json()["server"]["text"] == "Maintenance tonight"
    assert admin_banner.json()["server"]["text"] == "Maintenance tonight"
    assert participant.json()["server"]["key"] == admin_banner.json()["server"]["key"]


def test_inactive_server_message_is_not_delivered(clean_server_message):
    client = clean_server_message
    saved = client.put(
        f"{BASE_URL}/api/admin/messages/server",
        json={
            "text": {"en": "Maintenance tonight"},
            "audience": "both",
            "is_active": False,
        },
        auth=ADMIN_AUTH,
    )
    assert saved.status_code == 200, saved.text

    assert client.get(f"{BASE_URL}/api/messages").json()["server"] is None
    assert (
        client.get(f"{BASE_URL}/api/admin/messages", auth=ADMIN_AUTH).json()["server"]
        is None
    )


def test_active_message_without_text_is_rejected(clean_server_message):
    response = clean_server_message.put(
        f"{BASE_URL}/api/admin/messages/server",
        json={"text": {}, "audience": "participants", "is_active": True},
        auth=ADMIN_AUTH,
    )
    assert response.status_code == 400, response.text


def test_study_message_reaches_only_its_own_study(message_studies):
    study_a = message_studies["study_a"]
    study_b = message_studies["study_b"]

    with httpx.Client(timeout=30.0) as client:
        saved = client.put(
            f"{BASE_URL}/api/admin/studies/{study_a}/message",
            json={"text": {"de": "Morgen keine Erhebung"}, "is_active": True},
            auth=ADMIN_AUTH,
        )
        assert saved.status_code == 200, saved.text

        own = client.get(
            f"{BASE_URL}/api/messages",
            params={"study_name_short": study_a, "lang": "de"},
        )
        assert own.json()["study"]["text"] == "Morgen keine Erhebung"

        # No translation for sv: fall back to whatever the study does have.
        fallback = client.get(
            f"{BASE_URL}/api/messages",
            params={"study_name_short": study_a, "lang": "sv"},
        )
        assert fallback.json()["study"]["text"] == "Morgen keine Erhebung"

        other = client.get(
            f"{BASE_URL}/api/messages", params={"study_name_short": study_b}
        )
        assert other.json()["study"] is None

        unknown = client.get(
            f"{BASE_URL}/api/messages", params={"study_name_short": "no_such_study"}
        )
        assert unknown.status_code == 200
        assert unknown.json()["study"] is None


@requires_two_scientists
def test_scientists_can_only_edit_their_own_study_message(message_studies):
    study_a = message_studies["study_a"]
    study_b = message_studies["study_b"]

    with httpx.Client(timeout=60.0) as client:
        # The server-wide message belongs to super admins.
        denied = client.put(
            f"{BASE_URL}/api/admin/messages/server",
            json={"text": {"en": "x"}, "audience": "both", "is_active": True},
            auth=SCIENTIST_A_AUTH,
        )
        assert denied.status_code == 403, denied.text

        own_page = client.get(
            f"{BASE_URL}/admin/study/{study_a}/message", auth=SCIENTIST_A_AUTH
        )
        assert own_page.status_code == 200, own_page.text

        own = client.put(
            f"{BASE_URL}/api/admin/studies/{study_a}/message",
            json={"text": {"en": "Pause tomorrow"}, "is_active": True},
            auth=SCIENTIST_A_AUTH,
        )
        assert own.status_code == 200, own.text

        foreign_page = client.get(
            f"{BASE_URL}/admin/study/{study_b}/message", auth=SCIENTIST_A_AUTH
        )
        assert foreign_page.status_code == 403

        foreign = client.put(
            f"{BASE_URL}/api/admin/studies/{study_b}/message",
            json={"text": {"en": "x"}, "is_active": True},
            auth=SCIENTIST_A_AUTH,
        )
        assert foreign.status_code == 403
