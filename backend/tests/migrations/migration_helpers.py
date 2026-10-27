"""Helpers for the schema-migration tests (see test_forward_only.py).

The tests execute the real Alembic migrations, which nothing else does:
`backend/tests/integration` builds its schema with
`SQLModel.metadata.create_all()`, so a migration that cannot run, or that
silently drops data, is invisible to the rest of the suite.

The policy these tests encode is forward-only (see README, "Database schema
policy").
"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from typing import Any

import pytest
from alembic.config import Config as AlembicConfig
from sqlalchemy import Index, MetaData, create_engine, insert, inspect, text
from sqlalchemy.schema import DropConstraint, DropIndex


BACKEND_ROOT = Path(__file__).resolve().parents[2]

# Set by conftest.py when pytest runs with --require-database: a missing scratch
# database server then fails the run instead of skipping every test (the test
# script and CI use that, so a broken database setup cannot look like success).
REQUIRE_DATABASE = False


def unusable_database(reason: str) -> None:
    if REQUIRE_DATABASE:
        pytest.fail(reason)
    pytest.skip(reason)


def all_revisions() -> list[str]:
    """Every revision in the project, head first.

    Reads the migration scripts only, so it works without a database connection
    (which is what `pytest.mark.parametrize` needs).
    """
    from alembic.script import ScriptDirectory

    # Imported here (not at module level): importing the app constructs its
    # engine, which needs TUD_DATABASE_URL, and listing revisions does not.
    from o_timeusediary_backend import database

    ini_path = database._resolve_alembic_ini_path()
    config = AlembicConfig(str(ini_path))
    config.set_main_option("script_location", str(ini_path.parent / "alembic"))
    return [
        rev.revision for rev in ScriptDirectory.from_config(config).walk_revisions()
    ]


def server_url() -> str:
    """The database server the tests may create scratch databases on."""
    url = os.getenv("TUD_MIGRATION_TEST_DATABASE_URL") or os.getenv("TUD_DATABASE_URL")
    if not url:
        unusable_database(
            "no scratch database server configured: set TUD_MIGRATION_TEST_DATABASE_URL "
            "or run ./test_backend_migrations.sh"
        )
    return url


def url_with_database(url: str, name: str) -> str:
    prefix, _, _ = url.rpartition("/")
    return f"{prefix}/{name}"


def quote_identifier(identifier: str, dialect: str) -> str:
    """Quote an identifier the way the dialect expects (MariaDB has no ANSI quotes by default)."""
    if dialect == "mssql":
        return f"[{identifier}]"
    if dialect in {"mysql", "mariadb"}:
        return f"`{identifier}`"
    return f'"{identifier}"'


def _sample_value(column: Any) -> Any:
    """A value a column of this type accepts.

    The required columns differ per revision, so the tests must not hard-code
    them; they only need *some* legacy row that has to survive the upgrade.
    The checks go by SQLAlchemy's generic types, so they work for every dialect
    (a reflected BOOLEAN, INTEGER or TIMESTAMP still is one of those).
    """
    from sqlalchemy import types as sa_types

    column_type = column.type
    if isinstance(column_type, sa_types.Enum) and column_type.enums:
        return column_type.enums[0]
    if isinstance(column_type, sa_types.Boolean):
        return True
    if isinstance(column_type, sa_types.Integer):
        return 7
    if isinstance(column_type, (sa_types.Numeric, sa_types.Float)):
        return 1.5
    if isinstance(column_type, sa_types.DateTime):
        # A column without a timezone needs a naive value, so build one and only
        # attach UTC when the column actually stores it.
        value = datetime(2026, 1, 2, 3, 4, 5)  # noqa: DTZ001
        return (
            value.replace(tzinfo=UTC)
            if getattr(column_type, "timezone", False)
            else value
        )
    if isinstance(column_type, sa_types.Date):
        return date(2026, 1, 2)
    if isinstance(column_type, sa_types.Time):
        return time(3, 4, 5)
    if isinstance(column_type, sa_types.Interval):
        return timedelta(days=1)
    if isinstance(column_type, sa_types.LargeBinary):
        return b"probe"
    if isinstance(column_type, sa_types.JSON):
        return {"probe": True}
    # String/Text/Unicode and anything else that accepts a short string.
    return "probe"


class ScratchDatabase:
    """An empty database a test may migrate, seed and query freely."""

    def __init__(self, url: str, name: str, dialect: str, admin_engine) -> None:
        self.url = url
        self.name = name
        self.dialect = dialect
        self.engine = create_engine(url)
        # Connection to the server itself, used to drop this database again.
        self.admin_engine = admin_engine

    # ── Alembic ────────────────────────────────────────────────────────────
    def alembic_config(self) -> AlembicConfig:
        """The app's Alembic setup, pointed at this scratch database."""
        from o_timeusediary_backend import database

        config = database._alembic_config()
        config.set_main_option("sqlalchemy.url", self.url)
        return config

    def head(self) -> str:
        return all_revisions()[0]

    def upgrade(self, revision: str = "head") -> None:
        from alembic import command

        command.upgrade(self.alembic_config(), revision)

    def stamp(self, revision: str) -> None:
        from alembic import command

        command.stamp(self.alembic_config(), revision)

    def assert_no_model_drift(self) -> None:
        """Fail when models.py describes something the migrations never created."""
        from alembic import command

        command.check(self.alembic_config())

    # ── Queries ────────────────────────────────────────────────────────────
    def current(self) -> str | None:
        with self.engine.connect() as conn:
            return conn.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar()

    def tables(self) -> list[str]:
        return inspect(self.engine).get_table_names()

    def columns(self, table: str) -> list[str]:
        return [column["name"] for column in inspect(self.engine).get_columns(table)]

    def scalar(self, sql: str) -> Any:
        with self.engine.connect() as conn:
            return conn.execute(text(sql)).scalar()

    def execute(self, sql: str) -> None:
        with self.engine.begin() as conn:
            conn.execute(text(sql))

    def drop_constraint(self, table: str, name: str) -> None:
        """Drop a named constraint or index, spelled the way this dialect does.

        PostgreSQL wants ``DROP CONSTRAINT``, MySQL/MariaDB want ``DROP INDEX``
        for a unique constraint and ``DROP CHECK`` for a check. Reflecting the
        table and letting SQLAlchemy render the drop keeps the caller free of
        three hand-written statements per object.
        """
        metadata = MetaData()
        metadata.reflect(bind=self.engine, only=[table])
        target = metadata.tables[table]
        candidates = list(target.constraints) + list(target.indexes)
        match = next((item for item in candidates if item.name == name), None)
        if match is None:
            raise AssertionError(f"{table} has no constraint or index named {name}")
        ddl = DropIndex(match) if isinstance(match, Index) else DropConstraint(match)
        with self.engine.begin() as conn:
            conn.execute(ddl)

    # ── Data ───────────────────────────────────────────────────────────────
    def seed(self, table: str, **overrides: Any) -> dict[str, Any]:
        """Insert one row into `table`, filling in its required columns.

        The values come from the *reflected* table, because the required columns
        differ per revision.
        """
        metadata = MetaData()
        metadata.reflect(bind=self.engine, only=[table])
        table_object = metadata.tables[table]
        values: dict[str, Any] = {}
        for column in table_object.columns:
            if column.name in overrides:
                continue
            if (
                column.nullable
                or column.default is not None
                or column.server_default is not None
            ):
                continue
            values[column.name] = _sample_value(column)
        values.update(overrides)
        with self.engine.begin() as conn:
            conn.execute(insert(table_object).values(**values))
        return values

    # ── The app's own CLI ──────────────────────────────────────────────────
    def run_cli(self, *args: str) -> subprocess.CompletedProcess:
        """Run `tud <args>` against this database, the way a deployment would."""
        env = {
            **os.environ,
            "TUD_DATABASE_URL": self.url,
            "TUD_MIGRATION_TEST_DATABASE_URL": self.url,
        }
        return subprocess.run(
            [
                sys.executable,
                "-c",
                (
                    "import sys; from o_timeusediary_backend.cli import main; "
                    "sys.exit(main(sys.argv[1:]))"
                ),
                *args,
            ],
            cwd=BACKEND_ROOT,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )


def create_scratch_database(server: str) -> ScratchDatabase:
    """Create an empty database next to `server`, or skip if that is not allowed."""
    name = f"tud_migration_test_{uuid.uuid4().hex[:10]}"
    admin_engine = create_engine(server, isolation_level="AUTOCOMMIT")
    dialect = admin_engine.dialect.name
    try:
        with admin_engine.connect() as conn:
            conn.execute(text(f"CREATE DATABASE {quote_identifier(name, dialect)}"))
    except Exception as exc:  # noqa: BLE001 - report the reason instead of failing obscurely
        admin_engine.dispose()
        unusable_database(
            f"cannot create scratch databases on this server ({type(exc).__name__}: {exc})"
        )

    scratch = ScratchDatabase(
        url_with_database(server, name), name, dialect, admin_engine
    )
    return scratch


def drop_scratch_database(scratch: ScratchDatabase) -> None:
    scratch.engine.dispose()
    force = " WITH (FORCE)" if scratch.dialect == "postgresql" else ""
    admin_engine = scratch.admin_engine
    try:
        with admin_engine.connect() as conn:
            conn.execute(
                text(
                    f"DROP DATABASE IF EXISTS {quote_identifier(scratch.name, scratch.dialect)}{force}"
                )
            )
    finally:
        admin_engine.dispose()
