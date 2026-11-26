# Database Agent Documentation

## Stack
- PostgreSQL persistence layer.
- SQLModel/SQLAlchemy ORM models in `backend/src/o_timeusediary_backend/models.py`.
- Schema helper scripts in `database/`.

## Backend portability (the DBMS matrix must stay green)
- The manual DBMS matrix workflow runs the integration suite against
  PostgreSQL, MariaDB and SQL Server. Write portable SQLAlchemy, not
  PostgreSQL SQL.
- **Boolean predicates:** compare with `== false()` / `== true()`, not
  `.is_(False)`. `.is_()` renders `IS 0` where the backend has no native
  boolean type (SQL Server), which is a syntax error there.
  `backend/tests/unit/test_sql_portability_guards.py` fails on that shape, so the
  regular unit suite catches it without the manual matrix.
- **Read order is stated, never inherited.** Add `order_by(...)` to every query
  whose row order reaches a response or a test; an unordered `SELECT` returns
  different orders on different backends.

## Seeding / Hydration
- Study config source: `backend/studies_config.json`.
- Activity source files: `backend/activities_*.json`.
- Startup hydration inserts missing records; it does not auto-migrate existing study schema/state.

## Participant-observation flags in the study config
- `save_browser_identification` (device snapshot, per participant) and
  `save_ux_events` (unlinked usability signals: refused saves, dead-end
  searches, client errors) are both **opt-in and off by default**. A study that
  wants them sets them in its entry in `studies_config.json`; re-importing the
  config applies the flag to an existing study (`create_config_file_studies_in_database`
  syncs it).
- `save_ux_events` writes to `ux_events` (migration 0016), which carries no
  participant id: study, random per-load id, event name, timestamps, language,
  app version and a bounded JSON `props`. Read it through `/admin/ux-signals`,
  never through a join to `activities`.
- Both flags are observation of participants, so they belong in the study's
  consent text. Suggested sentence for a consent-requiring study: *"To improve
  the diary, the app records anonymous usage signals (for example which
  validation message appeared, or that a search found nothing). These signals
  are not linked to your answers."*

## Participant sessions (migration 0024)
- `participant_sessions` backs the opt-in inactivity timeout. One row per
  browser session: `study_id` (FK, `ON DELETE CASCADE`), the study-scoped
  `participant_id`, a SHA-256 `token_hash` (unique), `created_at`,
  `last_seen_at`, and nullable `ended_at`. The raw cookie token is never stored.
- The table deliberately keys on `study_id` + the string participant id rather
  than `study_participants.id`: an open study creates a session before the first
  diary write materialises the association row.
- `study_cleanup.delete_study_data` and the participant deletion/reset endpoints
  delete sessions explicitly as well as relying on the FK, matching the existing
  pattern for SQLite test runs without FK enforcement.
- The old `studies.inactivity_timeout_stress_time_left` column remains in the
  schema but is no longer read, written or exported. Dropping it is a separate
  contract migration, per the additive rule above.

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
- The `tud db` CLI only offers `db upgrade` (and `db current`); there is no
  `db downgrade`. The Alembic CLI cannot be used directly either, because
  `alembic.ini` ships no URL - the URL is injected from `TUD_DATABASE_URL` in
  `database._alembic_config()`.

## Banner messages (migration 0022)
- `server_message` holds the single server-wide banner and has **no
  autoincrement**: `id` is fixed at 1, so "one server message" is enforced by the
  primary key (a unique index on a nullable column would not). Never insert a
  second row; `messages.get_server_message` uses `session.get(..., 1)`.
- `study_messages` is one row per study (unique `study_id`, `ON DELETE CASCADE`
  in the schema). `study_cleanup.delete_study_data` deletes it explicitly as
  well, so SQLite test runs without FK enforcement behave the same.
- Both tables are **additive** and belong in `TABLES_ADDED_AFTER_0003` in
  `tests/migrations/test_forward_only.py`; the pre-Alembic adoption test drops
  them to simulate an old database before stamping.

