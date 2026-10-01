"""The database schema is forward-only, so the forward path is what is tested.

Every scenario below is a deployment that really happens:

* a fresh server (`upgrade head` on an empty database),
* an existing server that already holds participant data and is migrated from
  whatever revision it is at to head - the scenario that was never exercised
  before, and the only thing that runs the data-rewriting code in migration 0004,
* a server whose database was created before Alembic existed and is adopted with
  `alembic stamp` (that is how the running MPIAE servers were moved over),
* a repeated `upgrade head`, because a startup script cannot know whether the
  schema is current.

There is deliberately no downgrade test: reverting a migration that dropped a
column cannot bring the data back, and the project decided not to pretend
otherwise (see README, "Database schema policy").
"""

from __future__ import annotations

import json

import pytest
from migration_helpers import all_revisions
from sqlalchemy import text

# Tables that the baseline migration (0001) creates and that every later revision
# keeps. A migration that loses one of these is a bug in every scenario.
BASELINE_TABLES = (
    "studies",
    "participants",
    "study_participants",
    "timelines",
    "day_labels",
    "activities",
)

REVISIONS = all_revisions()  # head first
HEAD = REVISIONS[0]

# Columns that migrations 0005-0011 add, i.e. the difference between a database
# created by create_all() before Alembic existed (which is what `stamp
# 0003_add_study_footer_links` assumes) and the current models.
COLUMNS_ADDED_AFTER_0003 = (
    ("studies", "study_text_instructions"),
    ("studies", "study_text_instructions_title"),
    ("studies", "owner_usernames"),
    ("studies", "save_browser_identification"),
    ("day_labels", "display_names"),
    ("study_participants", "study_submitted_at"),
    ("study_participants", "user_agent"),
    ("study_participants", "client_info"),
    ("study_participants", "client_info_captured_at"),
)


def test_upgrade_head_from_empty_database(scratch_database):
    scratch_database.upgrade("head")

    assert scratch_database.current() == HEAD
    missing = [
        table for table in BASELINE_TABLES if table not in scratch_database.tables()
    ]
    assert not missing, f"after `upgrade head` these tables are missing: {missing}"


def test_models_match_the_migrated_schema(scratch_database):
    """A model change without a migration is invisible everywhere else.

    The integration tests build their schema from the models themselves
    (`create_all`), so they cannot notice it, and the failure only appears at
    runtime as "column ... does not exist" on a server that ran the migrations.
    """
    scratch_database.upgrade("head")

    try:
        scratch_database.assert_no_model_drift()
    except Exception as exc:  # noqa: BLE001 - report what Alembic wants to change
        pytest.fail(
            "models.py and alembic/versions disagree - add a migration for the "
            f"model change:\n{exc}"
        )


def test_upgrading_twice_is_a_no_op(scratch_database):
    scratch_database.upgrade("head")
    tables_before = sorted(scratch_database.tables())

    scratch_database.upgrade("head")  # deployment scripts may just call this again

    assert scratch_database.current() == HEAD
    assert sorted(scratch_database.tables()) == tables_before


@pytest.mark.parametrize("revision", REVISIONS[1:])
def test_upgrade_from_every_revision_keeps_the_data(scratch_database, revision):
    """Migrate an existing database that already holds data."""
    scratch_database.upgrade(revision)
    assert scratch_database.current() == revision

    study = scratch_database.seed(
        "studies", name="Legacy study", name_short=f"legacy_{revision[:4]}"
    )
    participant = scratch_database.seed(
        "participants", id=f"legacy_participant_{revision[:4]}"
    )

    scratch_database.upgrade("head")

    assert scratch_database.current() == HEAD, f"did not reach head from {revision}"
    for table in BASELINE_TABLES:
        assert (
            table in scratch_database.tables()
        ), f"{table} disappeared while upgrading from {revision}"
    assert (
        scratch_database.scalar(
            f"SELECT count(*) FROM studies WHERE name_short = '{study['name_short']}'"
        )
        == 1
    ), f"the study that existed at {revision} was lost by the upgrade"
    assert (
        scratch_database.scalar(
            f"SELECT count(*) FROM participants WHERE id = '{participant['id']}'"
        )
        == 1
    ), f"the participant that existed at {revision} was lost by the upgrade"

    # The deployment is only finished when the app's own command still works on
    # the migrated database.
    result = scratch_database.run_cli(
        "studies", "import", "--config", "studies_config.json"
    )
    assert result.returncode == 0, (
        f"`tud studies import` failed after upgrading {revision} -> head:\n"
        f"{result.stdout[-2000:]}\n{result.stderr[-2000:]}"
    )
    assert (
        scratch_database.scalar(
            f"SELECT count(*) FROM studies WHERE name_short = '{study['name_short']}'"
        )
        == 1
    ), "the import replaced the data that was already in the database"


def test_pre_alembic_database_can_be_adopted(scratch_database):
    """A database created by create_all() before Alembic existed.

    Such a database has no `alembic_version` row, and older models kept
    `studies.description` as plain text, so it is adopted with `stamp <last known
    revision>` and then upgraded. This is the path the running servers took, and
    the only test that executes 0004's conversion of existing values.
    """
    if scratch_database.dialect not in {"postgresql", "mysql", "mariadb"}:
        pytest.skip(
            f"legacy description conversion is not emulated for {scratch_database.dialect}"
        )

    from sqlmodel import SQLModel

    import o_timeusediary_backend.models  # noqa: F401 - registers the tables

    SQLModel.metadata.create_all(scratch_database.engine)

    # Turn that database into a 0003-era one: drop what the later migrations
    # added, and give description the legacy text type.
    for table, column in COLUMNS_ADDED_AFTER_0003:
        if column in scratch_database.columns(table):
            scratch_database.execute(f"ALTER TABLE {table} DROP COLUMN {column}")
    if scratch_database.dialect == "postgresql":
        scratch_database.execute(
            "ALTER TABLE studies ALTER COLUMN description TYPE text USING description::text"
        )
    else:
        # MariaDB stores JSON as LONGTEXT plus a json_valid() check; modifying
        # the column to TEXT replaces both.
        scratch_database.execute("ALTER TABLE studies MODIFY COLUMN description TEXT")

    scratch_database.seed(
        "studies",
        name="Adopted study",
        name_short="adopted",
        description="Plain text description",
    )
    scratch_database.stamp("0003_add_study_footer_links")

    scratch_database.upgrade("head")

    with scratch_database.engine.connect() as conn:
        raw = conn.execute(
            text("SELECT description FROM studies WHERE name_short = 'adopted'")
        ).scalar()
    assert raw is not None, "the adopted study was lost by the upgrade"
    # Depending on the dialect the column comes back decoded or as JSON text.
    value = raw.decode() if isinstance(raw, (bytes, bytearray)) else raw
    if isinstance(value, str) and value.startswith('"'):
        value = json.loads(value)
    assert value == "Plain text description", (
        "0004 has to keep a legacy plain-text description readable (it becomes a "
        f"JSON string), got {value!r}"
    )

    # Afterwards the adopted database is an ordinary head database.
    scratch_database.assert_no_model_drift()
