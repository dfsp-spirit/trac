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
