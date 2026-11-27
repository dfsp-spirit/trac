"""The KI's parent/child roster: grouping, encryption and re-upload behaviour."""

import os
from datetime import UTC, datetime

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

os.environ.setdefault("TUD_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("TUD_ALLOWED_ORIGINS", '["http://localhost:3000"]')

from o_timeusediary_backend import encrypted_fields as ef  # noqa: E402
from o_timeusediary_backend.models import (  # noqa: E402
    REPORT_MODE_PROXY,
    Study,
    StudyParticipant,
)
from o_timeusediary_backend.proxy_roster import (  # noqa: E402
    ProxyRosterError,
    apply_proxy_roster,
    parse_proxy_roster,
)
from o_timeusediary_backend.tabular_files import ParsedDelimitedFile  # noqa: E402

TEST_KEY = "dHJhYy11bml0LXRlc3Qta2V5LTMyYnl0ZXMtcGFkISE="
# The parametrized cases below seal values at import time, so the key has to
# exist then; the autouse fixture re-applies it for the test bodies.
os.environ.setdefault(ef.KEY_ENV, TEST_KEY)

HEADERS = [
    "parent_id",
    "subject_id",
    "subject_name_encrypted",
    "latest_possible_submission_at_encrypted",
]

STUDY_END = datetime(2028, 1, 1, tzinfo=UTC)


@pytest.fixture(autouse=True)
def key(monkeypatch):
    monkeypatch.setenv(ef.KEY_ENV, TEST_KEY)


@pytest.fixture
def session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as open_session:
        yield open_session


def _study(session: Session, name_short: str = "proxy") -> Study:
    study = Study(
        name="Proxy Study",
        name_short=name_short,
        report_mode=REPORT_MODE_PROXY,
        allow_unlisted_participants=False,
        activities_json_url=f"db_blob://{name_short}/en",
        data_collection_start=datetime(2024, 1, 1, tzinfo=UTC),
        data_collection_end=STUDY_END,
    )
    session.add(study)
    session.commit()
    session.refresh(study)
    return study


def _roster(*rows: dict) -> ParsedDelimitedFile:
    return ParsedDelimitedFile(
        headers=HEADERS,
        rows=[(index + 2, row) for index, row in enumerate(rows)],
        delimiter=",",
    )


def _row(parent: str, subject: str, name: str = "", deadline: str = "") -> dict:
    return {
        "parent_id": parent,
        "subject_id": subject,
        "subject_name_encrypted": ef.encrypt_text(name) if name else "",
        "latest_possible_submission_at_encrypted": (
            ef.encrypt_text(deadline) if deadline else ""
        ),
    }


# ── parsing ────────────────────────────────────────────────────────────────
def test_a_roster_is_grouped_into_families(session):
    study = _study(session)
    parsed = _roster(
        _row("parent_a", "child_a1", "Tim", "2027-06-01T12:00:00+02:00"),
        _row("parent_a", "child_a2", "Tom", "2027-06-01T12:00:00+02:00"),
        _row("parent_b", "child_b1", "Ada", "2027-07-01T00:00:00Z"),
    )

    families, warnings = parse_proxy_roster(parsed, study)

    assert warnings == []
    assert [family.parent_id for family in families] == ["parent_a", "parent_b"]
    assert [child.participant_id for child in families[0].children] == [
        "child_a1",
        "child_a2",
    ]
    assert families[0].deadline_at == datetime(2027, 6, 1, 10, 0, tzinfo=UTC)


def test_the_name_is_decrypted_validated_and_sealed_again(session):
    study = _study(session)
    families, _ = parse_proxy_roster(_roster(_row("p", "c", "  Tim  ")), study)

    child = families[0].children[0]

    assert child.display_name == "Tim"
    assert child.name_encoded != "Tim"
    assert ef.decode_incoming(child.name_encoded) == "Tim"


def test_a_deadline_without_an_offset_is_utc(session):
    study = _study(session)
    families, _ = parse_proxy_roster(
        _roster(_row("p", "c", deadline="2027-06-01T12:00:00")), study
    )

    assert families[0].deadline_at == datetime(2027, 6, 1, 12, 0, tzinfo=UTC)


def test_a_deadline_in_the_past_is_a_warning_not_an_error(session):
    study = _study(session)
    families, warnings = parse_proxy_roster(
        _roster(_row("p", "c", deadline="2024-02-01T00:00:00Z")), study
    )

    assert families  # still parseable
    assert any("past" in warning for warning in warnings)


# ── whole-file refusals ────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "rows, expected",
    [
        ([_row("p", "c 1")], "Invalid participant id"),
        ([_row("p", "c"), _row("q", "c")], "more than once"),
        ([_row("p", "p")], "its own parent"),
        ([_row("a", "b"), _row("b", "c")], "parent in one row and a child"),
        (
            [
                _row("p", "c1", deadline="2027-01-01T00:00:00Z"),
                _row("p", "c2", deadline="2027-02-01T00:00:00Z"),
            ],
            "two different deadlines",
        ),
        (
            [
                {
                    "parent_id": "p",
                    "subject_id": "c",
                    "subject_name_encrypted": "v1.bm90LWEtdG9rZW4",
                    "latest_possible_submission_at_encrypted": "",
                }
            ],
            "could not be decrypted",
        ),
        (
            [_row("p", "c", deadline="not-a-date")],
            "not an ISO 8601",
        ),
    ],
)
def test_a_bad_file_is_refused_as_a_whole(session, rows, expected):
    study = _study(session)

    with pytest.raises(ProxyRosterError, match=expected):
        parse_proxy_roster(_roster(*rows), study)


def test_an_undecryptable_name_does_not_echo_the_token(session):
    study = _study(session)
    token = "v1.bm90LWEtdG9rZW4"
    parsed = _roster(
        {
            "parent_id": "p",
            "subject_id": "c",
            "subject_name_encrypted": token,
            "latest_possible_submission_at_encrypted": "",
        }
    )

    with pytest.raises(ProxyRosterError) as error:
        parse_proxy_roster(parsed, study)

    assert token not in str(error.value)


# ── applying ───────────────────────────────────────────────────────────────
def _by_id(session, study) -> dict:
    rows = session.exec(
        select(StudyParticipant).where(StudyParticipant.study_id == study.id)
    ).all()
    return {row.participant_id: row for row in rows}


def test_applying_creates_parents_children_and_links(session):
    study = _study(session)
    families, _ = parse_proxy_roster(
        _roster(_row("p", "c1", "Tim"), _row("p", "c2", "Tom")), study
    )

    summary = apply_proxy_roster(session, study, families)
    session.commit()

    assert summary == {
        "families": 1,
        "parents_created": 1,
        "children_created": 2,
        "children_updated": 0,
        "children_unlinked": 0,
    }
    rows = _by_id(session, study)
    assert rows["p"].proxy_participant_id is None
    assert rows["c1"].proxy_participant_id == "p"
    assert rows["c1"].display_name is None
    assert rows["c1"].subject_name_encrypted is not None


def test_re_uploading_updates_the_name(session):
    study = _study(session)
    families, _ = parse_proxy_roster(_roster(_row("p", "c1", "Tim")), study)
    apply_proxy_roster(session, study, families)
    session.commit()

    families, _ = parse_proxy_roster(_roster(_row("p", "c1", "Timo")), study)
    summary = apply_proxy_roster(session, study, families)
    session.commit()

    assert summary["children_updated"] == 1
    child = _by_id(session, study)["c1"]
    assert ef.decode_incoming(child.subject_name_encrypted) == "Timo"


def test_a_child_leaving_the_file_is_unlinked_but_keeps_its_row(session):
    study = _study(session)
    families, _ = parse_proxy_roster(_roster(_row("p", "c1"), _row("p", "c2")), study)
    apply_proxy_roster(session, study, families)
    session.commit()

    families, _ = parse_proxy_roster(_roster(_row("p", "c1")), study)
    summary = apply_proxy_roster(session, study, families)
    session.commit()

    assert summary["children_unlinked"] == 1
    rows = _by_id(session, study)
    assert "c2" in rows, "the row and its diary must survive an unlink"
    assert rows["c2"].proxy_participant_id is None


def test_dry_run_writes_nothing(session):
    study = _study(session)
    families, _ = parse_proxy_roster(_roster(_row("p", "c1")), study)

    summary = apply_proxy_roster(session, study, families, dry_run=True)

    assert summary["parents_created"] == 1
    assert summary["children_created"] == 1
    assert _by_id(session, study) == {}
