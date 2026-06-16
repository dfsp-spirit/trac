# Database Skill

Use this skill for database model, migration, schema-script, and seed-configuration changes.

## Use When
- The request affects SQLModel models, Alembic migrations, PostgreSQL schema scripts, or study/activity seed JSON.
- The request changes files under `database/` or backend model/seed config files.

## Do Not Use For
- Pure frontend or API-only behavior changes.
- Test execution-only requests.

## Required Workflow
1. Identify impacted artifacts: model definitions, Alembic migration files, create/drop scripts, and JSON seed/config files.
2. Preserve compatibility between `backend/src/o_timeusediary_backend/models.py` and migration/script artifacts.
3. When editing study/activity JSON, treat existing `name_short` studies as non-migrating records unless explicit migration/admin actions are requested.
4. Avoid destructive schema assumptions unless explicitly approved.
5. Prefer migration-first schema changes (`tud db upgrade`) and explicit import workflows (`tud studies import`) instead of relying on startup bootstrap.
6. Validate with relevant backend integration tests when database behavior changes.
7. Document data-impact risk (new rows only, schema change, or manual migration needed).

## Quality Checks
- JSON seed/config structure remains parseable and consistent.
- Model-to-schema alignment is preserved.
- No accidental data-loss path introduced.
