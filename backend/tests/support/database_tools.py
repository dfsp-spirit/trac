"""Create, reset and drop the disposable database the test suites run against.

The integration and end-to-end tests talk to a real server and create studies,
participants and activities through the real API. Run against the development
database, they leave that data behind. This tool manages a separate database
next to it instead:

    cd backend
    uv run python tests/support/database_tools.py reset   # create, migrate, seed
    uv run python tests/support/database_tools.py drop    # remove it again

The URL comes from ``TUD_TEST_DATABASE_URL`` when it is set. Otherwise the
database name in ``TUD_DATABASE_URL`` (environment or ``backend/.env``) is
replaced by ``--name``, which defaults to ``<dev database>_test``; server, port,
credentials and dialect therefore stay the same as the development database's.

Safety: ``reset`` deletes every row of the target database, so the tool refuses
to work on the database ``TUD_DATABASE_URL`` points at, and on any name that
does not contain "test" unless ``--force`` is given. A database named through
``TUD_TEST_DATABASE_URL`` must already exist and is never dropped by this tool.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]

# The fixture studies the API tests rely on ("default", "adult_pilot_de*", ...).
STUDIES_CONFIGS = ("studies_config.json", "studies_config_new.json")


# --------------------------------------------------------------------------- #
# URL helpers
# --------------------------------------------------------------------------- #
def _database_name(url: str) -> str:
    return url.rpartition("/")[2].split("?")[0].split("#")[0]


def _with_database(url: str, name: str) -> str:
    prefix, _, tail = url.rpartition("/")
    suffix = ""
    for separator in ("?", "#"):
        if separator in tail:
            suffix = separator + tail.split(separator, 1)[1]
            break
    return f"{prefix}/{name}{suffix}"


def _quote_identifier(identifier: str, dialect: str) -> str:
    """Quote an identifier the way the dialect expects (MariaDB has no ANSI quotes by default)."""
    if dialect == "mssql":
        return f"[{identifier}]"
    if dialect in {"mysql", "mariadb"}:
        return f"`{identifier}`"
    return f'"{identifier}"'


def _environment_url() -> str:
    """The development database URL, from the environment or backend/.env."""
    url = os.getenv("TUD_DATABASE_URL")
    if url:
        return url

    from dotenv import dotenv_values

    url = dotenv_values(BACKEND_ROOT / ".env").get("TUD_DATABASE_URL")
    if not url:
        raise SystemExit(
            "TUD_DATABASE_URL is not set. Export it, or run this from a backend "
            "directory that has a .env file."
        )
    return url


def resolve(name: str | None, *, force: bool) -> tuple[str, str, bool]:
    """Return ``(development_url, test_url, managed)``, refusing anything that looks unsafe.

    ``managed`` is False when the caller named the test database explicitly via
    ``TUD_TEST_DATABASE_URL``: such a database must already exist and is never
    created or dropped by this tool, because we cannot know its server.
    """
    development_url = _environment_url()
    explicit_url = os.getenv("TUD_TEST_DATABASE_URL")
    test_url = explicit_url or _with_database(
        development_url,
        name
        or os.getenv("TUD_TEST_DATABASE_NAME")
        or f"{_database_name(development_url)}_test",
    )

    test_name = _database_name(test_url)
    if test_name == _database_name(development_url) and not explicit_url:
        raise SystemExit(
            f"Refusing to operate on '{test_name}': that is the database "
            "TUD_DATABASE_URL points at."
        )
    if "test" not in test_name.lower() and not force:
        raise SystemExit(
            f"Refusing to operate on '{test_name}': the name does not contain "
            "'test'. Pass --force if this really is a throwaway database."
        )
    return development_url, test_url, explicit_url is None


# --------------------------------------------------------------------------- #
# Database lifecycle
# --------------------------------------------------------------------------- #
def _can_connect(url: str) -> bool:
    from sqlalchemy import create_engine, text

    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except Exception:  # noqa: BLE001 - "does the database exist?" is a yes/no question
        return False
    finally:
        engine.dispose()


def _create_database_if_missing(development_url: str, test_url: str) -> None:
    if _can_connect(test_url):
        return

    from sqlalchemy import create_engine, text

    name = _database_name(test_url)
    admin_engine = create_engine(development_url, isolation_level="AUTOCOMMIT")
    database_user = admin_engine.url.username or os.getenv(
        "TUD_DATABASE_USER", "<db user>"
    )
    try:
        with admin_engine.connect() as connection:
            connection.execute(
                text(
                    f"CREATE DATABASE {_quote_identifier(name, admin_engine.dialect.name)}"
                )
            )
    except Exception as exc:  # noqa: BLE001 - report the reason instead of a traceback
        raise SystemExit(
            f"Cannot create the test database '{name}': {exc}\n"
            "Create it once with an administrator account, for example:\n"
            f"  sudo -u postgres createdb -O {database_user} {name}\n"
            "or point TUD_TEST_DATABASE_URL at an existing throwaway database."
        ) from exc
    finally:
        admin_engine.dispose()


def reset(test_url: str) -> None:
    """Create the schema, wipe every row and import the fixture studies."""
    # The imports below have to happen after this point: database.py builds its
    # engine from TUD_DATABASE_URL when the module is imported.
    os.environ["TUD_DATABASE_URL"] = test_url
    os.environ["TUD_DATABASE_NAME"] = _database_name(test_url)

    import o_timeusediary_backend.models  # noqa: F401 - registers the tables
    from o_timeusediary_backend import cli, database
    from sqlmodel import SQLModel

    if cli.main(["db", "upgrade"]) != 0:
        raise SystemExit("Applying the schema migrations failed.")

    with database.engine.begin() as connection:
        for table in reversed(SQLModel.metadata.sorted_tables):
            connection.execute(table.delete())

    configs = [
        str(BACKEND_ROOT / name)
        for name in STUDIES_CONFIGS
        if (BACKEND_ROOT / name).is_file()
    ]
    argv = ["studies", "import", "--no-ensure-schema"]
    for config in configs:
        argv += ["--config", config]
    if cli.main(argv) != 0:
        raise SystemExit("Importing the fixture studies failed.")

    print(f"Test database '{_database_name(test_url)}' is ready.")


def drop(development_url: str, test_url: str) -> None:
    from sqlalchemy import create_engine, text

    name = _database_name(test_url)
    admin_engine = create_engine(development_url, isolation_level="AUTOCOMMIT")
    dialect = admin_engine.dialect.name
    # PostgreSQL refuses to drop a database that still has connections.
    force = " WITH (FORCE)" if dialect == "postgresql" else ""
    try:
        with admin_engine.connect() as connection:
            connection.execute(
                text(
                    f"DROP DATABASE IF EXISTS {_quote_identifier(name, dialect)}{force}"
                )
            )
    except Exception as exc:  # noqa: BLE001 - report the reason instead of a traceback
        raise SystemExit(f"Cannot drop the test database '{name}': {exc}") from exc
    finally:
        admin_engine.dispose()

    print(f"Dropped test database '{name}'.")


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="database_tools",
        description=(
            "Manage the disposable database the integration and E2E tests run "
            "against. Never points at the development database."
        ),
    )
    parser.add_argument(
        "command",
        choices=("url", "reset", "drop"),
        help=(
            "url: print the test database URL; "
            "reset: create it if needed, migrate, wipe, import the fixture studies; "
            "drop: remove it"
        ),
    )
    parser.add_argument(
        "--name",
        help="Test database name (default: <development database>_test)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Allow a target database whose name does not contain 'test'",
    )
    args = parser.parse_args(argv)

    development_url, test_url, managed = resolve(args.name, force=args.force)

    if args.command == "url":
        print(test_url)
        return 0

    if args.command == "reset":
        if managed:
            _create_database_if_missing(development_url, test_url)
        elif not _can_connect(test_url):
            raise SystemExit(
                f"The database from TUD_TEST_DATABASE_URL does not exist: {test_url}"
            )
        reset(test_url)
        return 0

    if not managed:
        print(
            "Not dropping the database from TUD_TEST_DATABASE_URL; "
            "remove it with the tooling that created it."
        )
        return 0

    drop(development_url, test_url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
