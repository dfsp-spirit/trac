"""Banner messages: text validation, resolution, activation and keys."""

import os
from datetime import UTC, datetime

from sqlmodel import Session, SQLModel, create_engine

os.environ.setdefault("TUD_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("TUD_ALLOWED_ORIGINS", '["http://localhost:3000"]')

import pytest

from o_timeusediary_backend.messages import (
    AUDIENCE_BOTH,
    AUDIENCE_PARTICIPANTS,
    MESSAGE_TEXT_MAX_LENGTH,
    MessageValidationError,
    active_admin_server_message,
    active_participant_server_message,
    active_study_message,
    get_server_message,
    get_study_message,
    localized_message_text,
    message_key,
    normalize_message_text,
    save_server_message,
    save_study_message,
    server_message_languages,
)
from o_timeusediary_backend.models import Study, StudyActivityConfigBlob


@pytest.fixture
def session():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as open_session:
        yield open_session


def _study(session: Session, name_short: str, *, default_language: str = "en") -> Study:
    study = Study(
        name=f"Study {name_short}",
        name_short=name_short,
        activities_json_url=f"db_blob://{name_short}/en",
        default_language=default_language,
        data_collection_start=datetime(2024, 1, 1, tzinfo=UTC),
        data_collection_end=datetime(2028, 1, 1, tzinfo=UTC),
    )
    session.add(study)
    session.commit()
    session.refresh(study)
    return study


# --------------------------------------------------------------------------- #
# Text validation and resolution
# --------------------------------------------------------------------------- #
def test_normalize_text_trims_drops_blanks_and_sorts():
    text = normalize_message_text({"de-DE": "  Wartung heute  ", "en": " ", "sv": "Underhåll"})
    assert text == {"de": "Wartung heute", "sv": "Underhåll"}


def test_normalize_text_rejects_non_maps_and_non_strings():
    with pytest.raises(MessageValidationError):
        normalize_message_text(["Wartung"])  # type: ignore[arg-type]
    with pytest.raises(MessageValidationError):
        normalize_message_text({"de": 42})  # type: ignore[dict-item]


def test_normalize_text_rejects_overlong_text():
    with pytest.raises(MessageValidationError):
        normalize_message_text({"en": "x" * (MESSAGE_TEXT_MAX_LENGTH + 1)})


def test_localized_text_prefers_requested_then_fallback_then_english():
    text = {"de": "Wartung", "en": "Maintenance", "sv": "Underhåll"}
    assert localized_message_text(text, "de", "en") == "Wartung"
    assert localized_message_text(text, "de-DE", "en") == "Wartung"
    assert localized_message_text(text, "fr", "sv") == "Underhåll"
    assert localized_message_text(text, "fr", "it") == "Maintenance"
    assert localized_message_text(text, None, None) == "Maintenance"


def test_localized_text_falls_back_to_whatever_language_exists():
    # A maintenance warning in the wrong language beats no warning.
    assert localized_message_text({"sv": "Underhåll"}, "de", "en") == "Underhåll"
    assert localized_message_text({}, "de", "en") is None


# --------------------------------------------------------------------------- #
# Server message
# --------------------------------------------------------------------------- #
def test_server_message_is_created_once_and_switched(session):
    row = save_server_message(
        session, text={"en": "Maintenance tonight"}, audience=AUDIENCE_PARTICIPANTS, is_active=True
    )
    session.commit()

    assert row.id == 1
    assert row.revision == 1
    assert active_participant_server_message(session) is not None
    assert active_admin_server_message(session) is None

    again = save_server_message(
        session, text={"en": "Maintenance tonight"}, audience=AUDIENCE_BOTH, is_active=True
    )
    session.commit()
    assert again.id == 1
    assert get_server_message(session).id == 1
    assert active_admin_server_message(session) is not None


def test_saving_unchanged_content_keeps_the_key_stable(session):
    first = save_server_message(
        session, text={"en": "Maintenance"}, audience=AUDIENCE_PARTICIPANTS, is_active=True
    )
    session.commit()
    key = message_key(first)
    revision = first.revision

    save_server_message(
        session, text={"en": "Maintenance"}, audience=AUDIENCE_PARTICIPANTS, is_active=True
    )
    session.commit()

    assert first.revision == revision
    assert message_key(first) == key


def test_editing_or_reactivating_changes_the_key(session):
    row = save_server_message(
        session, text={"en": "Maintenance"}, audience=AUDIENCE_PARTICIPANTS, is_active=True
    )
    session.commit()
    original_key = message_key(row)

    save_server_message(
        session, text={"en": "Maintenance moved to 22:00"}, audience=AUDIENCE_PARTICIPANTS, is_active=True
    )
    session.commit()
    assert message_key(row) != original_key

    edited_key = message_key(row)
    save_server_message(
        session, text={"en": "Maintenance moved to 22:00"}, audience=AUDIENCE_PARTICIPANTS, is_active=False
    )
    session.commit()
    save_server_message(
        session, text={"en": "Maintenance moved to 22:00"}, audience=AUDIENCE_PARTICIPANTS, is_active=True
    )
    session.commit()
    assert message_key(row) != edited_key


def test_key_does_not_depend_on_the_readers_language(session):
    row = save_server_message(
        session,
        text={"de": "Wartung", "en": "Maintenance"},
        audience=AUDIENCE_PARTICIPANTS,
        is_active=True,
    )
    session.commit()
    assert message_key(row) == message_key(get_server_message(session))


def test_inactive_message_is_not_delivered(session):
    save_server_message(
        session, text={"en": "Maintenance"}, audience=AUDIENCE_BOTH, is_active=False
    )
    session.commit()
    assert active_participant_server_message(session) is None
    assert active_admin_server_message(session) is None


def test_active_message_needs_text_and_a_valid_audience(session):
    with pytest.raises(MessageValidationError):
        save_server_message(session, text={}, audience=AUDIENCE_PARTICIPANTS, is_active=True)
    with pytest.raises(MessageValidationError):
        save_server_message(session, text={"en": "x"}, audience="everyone", is_active=True)


def test_switching_a_message_off_keeps_its_text(session):
    save_server_message(
        session, text={"en": "Maintenance"}, audience=AUDIENCE_PARTICIPANTS, is_active=True
    )
    session.commit()
    save_server_message(
        session, text={"en": "Maintenance"}, audience=AUDIENCE_PARTICIPANTS, is_active=False
    )
    session.commit()
    row = get_server_message(session)
    assert row.text == {"en": "Maintenance"}
    assert row.is_active is False


# --------------------------------------------------------------------------- #
# Study message
# --------------------------------------------------------------------------- #
def test_study_message_is_one_row_per_study(session):
    study = _study(session, "messages_one")
    other = _study(session, "messages_two")

    save_study_message(session, study.id, text={"en": "Pause tomorrow"}, is_active=True)
    session.commit()
    save_study_message(session, study.id, text={"en": "Pause moved"}, is_active=True)
    session.commit()

    row = get_study_message(session, study.id)
    assert row.text == {"en": "Pause moved"}
    assert get_study_message(session, other.id) is None
    assert active_study_message(session, study.id) is not None
    assert active_study_message(session, other.id) is None


def test_study_message_off_is_not_delivered(session):
    study = _study(session, "messages_off")
    save_study_message(session, study.id, text={"en": "Pause"}, is_active=False)
    session.commit()
    assert active_study_message(session, study.id) is None


# --------------------------------------------------------------------------- #
# Form metadata
# --------------------------------------------------------------------------- #
def test_server_message_languages_follow_the_studies_and_the_stored_text(session):
    study = _study(session, "messages_lang")
    session.add(
        StudyActivityConfigBlob(
            study_id=study.id, language="de", activities_json_data={"general": {}}
        )
    )
    session.commit()
    assert server_message_languages(session) == ["de", "en"]

    save_server_message(
        session, text={"fi": "Huolto"}, audience=AUDIENCE_PARTICIPANTS, is_active=True
    )
    session.commit()
    assert "fi" in server_message_languages(session)
