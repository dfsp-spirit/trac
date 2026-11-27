"""Parent -> child resolution for proxy studies.

The sequence the parent walks through (`dev_tools/plans/proxy_studies.md` §0)
depends entirely on two answers: which children belong to this parent, and which
of them is the first one that is not finished. Both are decided here, so these
tests are the specification the context dependency and the stage machine rely
on.
"""

import os
from datetime import UTC, datetime

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

os.environ.setdefault("TUD_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("TUD_ALLOWED_ORIGINS", '["http://localhost:3000"]')

from o_timeusediary_backend import encrypted_fields as ef  # noqa: E402
from o_timeusediary_backend.api_deps.participant_context import (  # noqa: E402
    CredentialDenied,
    require_credential_link,
)
from o_timeusediary_backend.display_names import participant_display_name  # noqa: E402
from o_timeusediary_backend.models import (  # noqa: E402
    REPORT_MODE_PROXY,
    REPORT_MODE_SELF,
    Study,
    StudyParticipant,
)
from o_timeusediary_backend.proxy_families import (  # noqa: E402
    ProxyResolutionError,
    family_children,
    is_proxy_study,
    resolve_family,
)

TEST_KEY = "dHJhYy11bml0LXRlc3Qta2V5LTMyYnl0ZXMtcGFkISE="


@pytest.fixture
def session():
    # StaticPool keeps the in-memory database alive across connections.
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as open_session:
        yield open_session


def _study(session: Session, name_short: str = "proxy", report_mode=REPORT_MODE_PROXY):
    study = Study(
        name=f"Study {name_short}",
        name_short=name_short,
        report_mode=report_mode,
        allow_unlisted_participants=False,
        activities_json_url=f"db_blob://{name_short}/en",
        data_collection_start=datetime(2024, 1, 1, tzinfo=UTC),
        data_collection_end=datetime(2028, 1, 1, tzinfo=UTC),
    )
    session.add(study)
    session.commit()
    session.refresh(study)
    return study


def _participant(
    session: Session,
    study: Study,
    participant_id: str,
    *,
    parent: str | None = None,
    submitted: bool = False,
    skipped: bool = False,
    display_name: str | None = None,
    encrypted_name: str | None = None,
) -> StudyParticipant:
    row = StudyParticipant(
        study_id=study.id,
        participant_id=participant_id,
        proxy_participant_id=parent,
        display_name=display_name,
        subject_name_encrypted=encrypted_name,
        study_submitted_at=datetime(2024, 6, 1, tzinfo=UTC) if submitted else None,
        skipped_at=datetime(2024, 6, 1, tzinfo=UTC) if skipped else None,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def _family_with_children(session: Session, count: int = 2):
    study = _study(session)
    parent = _participant(session, study, "parent")
    children = [
        _participant(session, study, f"child_{index + 1}", parent="parent")
        for index in range(count)
    ]
    return study, parent, children


# ── shape and ordering ─────────────────────────────────────────────────────
def test_study_mode_is_read_from_the_column(session):
    assert is_proxy_study(_study(session, "proxy", REPORT_MODE_PROXY))
    assert not is_proxy_study(_study(session, "self", REPORT_MODE_SELF))


def test_children_come_back_in_roster_order(session):
    study, parent, children = _family_with_children(session, count=3)

    found = family_children(session, study, parent.participant_id)

    assert [row.participant_id for row in found] == [
        "child_1",
        "child_2",
        "child_3",
    ]


def test_families_do_not_leak_into_each_other(session):
    study, parent_a, _ = _family_with_children(session, count=2)
    _participant(session, study, "parent_b")
    _participant(session, study, "child_b1", parent="parent_b")

    family_a = resolve_family(session, study, parent_a)

    assert [row.participant_id for row in family_a.children] == [
        "child_1",
        "child_2",
    ]


# ── the sequence (§0) ──────────────────────────────────────────────────────
def test_the_active_child_is_the_first_unfinished_one(session):
    study, parent, children = _family_with_children(session, count=3)

    family = resolve_family(session, study, parent)
    assert family.active.participant_id == "child_1"
    assert not family.finished

    children[0].study_submitted_at = datetime(2024, 6, 1, tzinfo=UTC)
    session.add(children[0])
    session.commit()

    family = resolve_family(session, study, parent)
    assert family.active.participant_id == "child_2"


def test_a_skipped_child_counts_as_finished(session):
    """Decision 17: submitting and skipping both close a questionnaire."""
    study, parent, children = _family_with_children(session, count=2)
    children[0].study_submitted_at = datetime(2024, 6, 1, tzinfo=UTC)
    children[0].skipped_at = datetime(2024, 6, 1, tzinfo=UTC)
    session.add(children[0])
    session.commit()

    family = resolve_family(session, study, parent)

    assert family.active.participant_id == "child_2"
    assert not family.finished


def test_a_finished_family_has_no_active_child_and_stands_in_with_the_last(session):
    study, parent, children = _family_with_children(session, count=2)
    for child in children:
        child.study_submitted_at = datetime(2024, 6, 1, tzinfo=UTC)
        session.add(child)
    session.commit()

    family = resolve_family(session, study, parent)

    assert family.finished
    assert family.active is None
    assert family.subject.participant_id == "child_2"


# ── denials ────────────────────────────────────────────────────────────────
def test_a_child_cannot_act_as_a_parent(session):
    study, _, children = _family_with_children(session, count=2)

    with pytest.raises(ProxyResolutionError, match="filled in by someone else"):
        resolve_family(session, study, children[0])


def test_a_parent_without_children_is_refused(session):
    study = _study(session)
    stranger = _participant(session, study, "not_in_roster")

    with pytest.raises(ProxyResolutionError, match="not listed as a parent"):
        resolve_family(session, study, stranger)


def test_the_query_parameter_path_refuses_a_child_too(session):
    """study-config/activities-config authorize inline; the rule must hold there."""
    study, parent, children = _family_with_children(session, count=2)

    assert (
        require_credential_link(session, study, parent.participant_id).participant_id
        == "parent"
    )

    with pytest.raises(CredentialDenied) as error:
        require_credential_link(session, study, children[0].participant_id)
    assert error.value.reason == CredentialDenied.IS_CHILD


def test_an_unknown_id_is_not_authorized(session):
    study, _, _ = _family_with_children(session)

    with pytest.raises(CredentialDenied) as error:
        require_credential_link(session, study, "nobody")

    assert error.value.reason == CredentialDenied.NOT_AUTHORIZED


# ── the name the parent sees ───────────────────────────────────────────────
def test_display_name_falls_back_to_the_plaintext_column(session):
    study, parent, _ = _family_with_children(session)
    self_report = _participant(session, study, "self_row", display_name="Tim")

    assert participant_display_name(self_report) == "Tim"
    assert participant_display_name(parent) is None


def test_display_name_decrypts_the_child_name(session, monkeypatch):
    monkeypatch.setenv(ef.KEY_ENV, TEST_KEY)
    study, _, children = _family_with_children(session)
    children[0].subject_name_encrypted = ef.encrypt_text("Tom")
    session.add(children[0])
    session.commit()

    assert participant_display_name(children[0]) == "Tom"
    # The ciphertext is what is stored, and it is not the name.
    assert children[0].subject_name_encrypted != "Tom"
