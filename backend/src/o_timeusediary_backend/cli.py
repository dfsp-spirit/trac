import argparse
import sys
from pathlib import Path

from sqlalchemy import func
from sqlmodel import Session, select

from .database import (
    create_config_file_studies_in_database,
    engine,
    initialize_db_schema,
    show_db_current_revision,
    upgrade_db_schema,
)
from .models import Activity, Participant, Study
from .settings import settings


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="tud",
        description="TRAC backend utility commands",
    )

    subparsers = parser.add_subparsers(dest="command")

    db_parser = subparsers.add_parser("db", help="Database schema migration commands")
    db_subparsers = db_parser.add_subparsers(dest="db_command")

    db_upgrade_parser = db_subparsers.add_parser(
        "upgrade", help="Upgrade database schema to target Alembic revision"
    )
    db_upgrade_parser.add_argument(
        "--revision",
        default="head",
        help="Alembic target revision (default: head)",
    )

    db_subparsers.add_parser(
        "current", help="Show current database schema revision"
    )

    studies_parser = subparsers.add_parser("studies", help="Study management commands")
    studies_subparsers = studies_parser.add_subparsers(dest="studies_command")

    import_parser = studies_subparsers.add_parser(
        "import",
        help="Import studies from a studies_config JSON/YAML file",
    )
    import_parser.add_argument(
        "--config",
        required=True,
        help="Path to studies config file (JSON/YAML)",
    )
    import_parser.add_argument(
        "--no-ensure-schema",
        action="store_true",
        help="Skip schema initialization before import",
    )

    return parser


def _get_db_counts() -> dict[str, int]:
    with Session(engine) as session:
        studies_count = session.exec(select(func.count(Study.id))).one()
        participants_count = session.exec(select(func.count(Participant.id))).one()
        activities_count = session.exec(select(func.count(Activity.id))).one()

    return {
        "studies": int(studies_count or 0),
        "participants": int(participants_count or 0),
        "activities": int(activities_count or 0),
    }


def _run_studies_import(config: str, ensure_schema: bool) -> int:
    config_path = str(Path(config).expanduser().resolve())

    # Keep relative activity path resolution aligned with the selected import file.
    settings.studies_config_path = config_path

    before = _get_db_counts()

    if ensure_schema:
        initialize_db_schema()

    create_config_file_studies_in_database(config_path)

    after = _get_db_counts()

    print("Studies import completed successfully.")
    print(f"Config file: {config_path}")
    print(
        "Counts before/after: "
        f"studies {before['studies']}->{after['studies']}, "
        f"participants {before['participants']}->{after['participants']}, "
        f"activities {before['activities']}->{after['activities']}"
    )
    return 0


def _run_db_upgrade(revision: str) -> int:
    upgrade_db_schema(revision)
    print(f"Database schema upgraded to revision '{revision}'.")
    return 0


def _run_db_current() -> int:
    show_db_current_revision()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.command == "db" and args.db_command == "upgrade":
        return _run_db_upgrade(args.revision)

    if args.command == "db" and args.db_command == "current":
        return _run_db_current()

    if args.command == "studies" and args.studies_command == "import":
        ensure_schema = not args.no_ensure_schema
        return _run_studies_import(args.config, ensure_schema=ensure_schema)

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
