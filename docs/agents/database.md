# Database Agent Documentation

## Stack
- PostgreSQL persistence layer.
- SQLModel/SQLAlchemy ORM models in `backend/src/o_timeusediary_backend/models.py`.
- Schema helper scripts in `database/`.

## Seeding / Hydration
- Study config source: `backend/studies_config.json`.
- Activity source files: `backend/activities_*.json`.
- Startup hydration inserts missing records; it does not auto-migrate existing study schema/state.

## Migration Guardrail
- Existing studies keyed by `name_short` are not auto-synchronized from JSON edits.
- Non-trivial changes require explicit migration/admin intervention.
- **Forward-only**: migrations only go forwards. `downgrade()` bodies are not a
  supported operation (most drop columns, so the data is gone anyway; 0004 cannot
  reverse its type change). Rolling back a release means redeploying the previous
  release - which only works while migrations stay additive - or restoring a backup.
- **Additive for the deployed code**: add columns as nullable or with a server
  default, never drop/rename a column in the same release that stops using it, and
  change data in its own step. The contract migration (dropping the old column)
  comes a release later.
- Every model change needs a migration in the same commit; `models.py` and
  `alembic/versions/` drifting apart is caught by `alembic check` in CI, because
  the integration tests build their schema with `create_all()` and never run the
  migrations.
- Validate schema work with `./test_backend_migrations.sh` (starts a throwaway
  database, or uses `TUD_MIGRATION_TEST_DATABASE_URL`). It upgrades a database from
  every revision to head with data present, adopts a pre-Alembic database with
  `stamp`, and checks the drift. MariaDB/MSSQL are covered by the same test on
  demand (`gh workflow run migrations.yml -f run_dbms_matrix=true`) - their drivers
  are not part of the package, so the workflow installs them.
- The `tud` CLI only offers `db upgrade` (and `db current`); there is no
  `db downgrade`. The Alembic CLI cannot be used directly either, because
  `alembic.ini` ships no URL - the URL is injected from `TUD_DATABASE_URL` in
  `database._alembic_config()`.
