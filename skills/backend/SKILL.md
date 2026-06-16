# Backend Skill

Use this skill to implement or modify TRAC backend behavior in FastAPI.

## Use When
- The request touches API endpoints, dependencies, admin templates, settings, or backend service logic.
- The request changes files under `backend/src/o_timeusediary_backend/`.

## Do Not Use For
- Frontend rendering/interaction changes.
- Pure database migration-only tasks.
- Running tests only (use dedicated test skills).

## Required Workflow
1. Identify impacted backend modules (`api.py`, `api_deps/`, `parsers/`, `templates/`, `settings.py`, `models.py`).
2. Implement changes using FastAPI patterns already present in the codebase.
3. Preserve request/response validation and explicit schema handling.
4. Ensure deployment path assumptions remain compatible with reverse proxy usage (`root_path` style deployments).
5. Keep startup behavior aligned with `TUD_STARTUP_MODE` (`serve` vs `bootstrap`), with `serve` as the default runtime path.
6. Prefer migration-first and explicit import workflows (`tud db upgrade`, optional `tud studies import`) over implicit startup bootstrap behavior.
7. Run the smallest relevant backend tests first, then broaden if needed.
8. Report changed endpoints/behavior and test coverage performed.

## Quality Checks
- Input validation is explicit and enforced.
- Sensitive admin functionality remains protected.
- No breaking change to environment-driven configuration.
