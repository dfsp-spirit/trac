# Backend Agent Documentation

## Tech Stack & Runtime
- FastAPI backend under `backend/src/o_timeusediary_backend/`.
- Project tooling managed via `uv` in `backend/pyproject.toml`.
- Typical local test command base: `cd backend && uv run pytest`.

## Deployment Shape
- Backend often served behind Nginx/reverse proxy under nested path prefixes.
- `root_path` assumptions must stay consistent with deployment config.

## Admin & Security
- Admin portal templates are under `backend/src/o_timeusediary_backend/templates/`.
- Admin routes rely on HTTP Basic Auth and environment-driven credentials.
- Request validation and constrained response models are required.

### Admin roles and study scope
- Two roles exist: **super admins** (`TUD_API_ADMIN_USERNAME`/`TUD_API_ADMIN_PASSWORD`, all studies) and **scientists** (`TUD_API_SCIENTISTS`, only studies they own plus env-granted ones).
- All authentication, identity and study-scope logic lives in `api_deps/admin_auth.py`. Admin routes depend on `verify_admin` (returns the username for logging) or `require_admin_identity` / `require_super_admin`.
- Study scope is enforced **centrally** in `require_admin_identity`: for admin paths containing a study name (see `_STUDY_SCOPED_PATH_PATTERNS`) the study is looked up and HTTP 403 is returned when a scientist may not manage it. New study-scoped admin routes are therefore protected automatically - do not add per-route access checks, and do not bypass the dependency.
- Routes that identify their study outside the URL path (query parameter or body) must check explicitly with `ensure_can_access_study` / `ensure_study_scope` (see `admin_participant_management` and `export_runtime_studies_config`).
- Study ownership is stored in `Study.owner_usernames` (JSON list of scientist usernames, `NULL` = super-admin-only). Studies created by a scientist get that scientist as owner (`_create_study_from_import_payload`).
- Owner management endpoints: `PATCH /api/admin/studies/{s}/owners` (replace the list; used for "make unowned") and `POST`/`DELETE /api/admin/studies/{s}/owners/{username}` (per-owner, idempotent, one audit entry per change). `DELETE` intentionally does not require a configured scientist, so stale entries can be cleaned up; scientists cannot remove themselves.
- The owner UI is the "Study Owners" block in the danger zone of the study detail page (inside the locked `edit-section-body`; `toggleEditSection()` re-renders it so the self-lock survives unlocking). JS entry points: `addStudyOwner`, `removeStudyOwner`, `makeStudyUnowned`. Super admins cannot be owners (they already have full access), so only the configured scientists are offered.
- `tests/integration/test_admin_scientist_scope.py` contains an exhaustive endpoint matrix that fails when a study-scoped route is added without protection.
- See README.md, section "Study ownership and scientist accounts", for the user-facing behaviour and the explicit non-goals of this isolation.
