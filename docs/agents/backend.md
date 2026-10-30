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
- **HTML escaping:** admin pages are opened by authenticated administrators, so anything request- or store-controlled that reaches an HTML response must be escaped. Render a Jinja template (autoescaping is on) or escape explicitly with `html.escape()` - never interpolate values into HTML with an f-string (`HTMLResponse(content=f"...")`), and never add `|safe` to a template. `tests/unit/test_html_escaping_guards.py` fails on both shapes; `tests/integration/test_admin_html_escaping.py` verifies the behaviour of the admin study pages.

### Admin roles and study scope
- Three roles exist: **super admins** (`TUD_API_ADMIN_USERNAME`/`TUD_API_ADMIN_PASSWORD`, all studies), **scientists** (`TUD_API_SCIENTISTS`, only studies they own plus env-granted ones), and **backup accounts** (`TUD_API_BACKUP_USERS`, read-only and server-wide, restricted to the three `/api/admin/{studies,participants,activities}` extraction endpoints).
- `require_admin_identity` (not study scope) is what denies backup accounts: study scope only fires for paths containing a study name, so a backup account would otherwise reach the admin overview, the file-validation tools and study creation. Keep the denial in that one dependency - never re-implement it per route.
- **Never** let a backup account become a study owner (`AdminIdentity.can_access_study` returns False for the role) and never accept a `studies` list in `TUD_API_BACKUP_USERS`; both would create a false sense of restriction (`validate_auth_configuration()` rejects the username overlaps at startup).
- All authentication, identity and study-scope logic lives in `api_deps/admin_auth.py`. Admin routes depend on `verify_admin` (returns the username for logging) or `require_admin_identity` / `require_super_admin`.
- Study scope is enforced **centrally** in `require_admin_identity`: for admin paths containing a study name (see `_STUDY_SCOPED_PATH_PATTERNS`) the study is looked up and HTTP 403 is returned when a scientist may not manage it. New study-scoped admin routes are therefore protected automatically - do not add per-route access checks, and do not bypass the dependency.
- Routes that identify their study outside the URL path (query parameter or body) must check explicitly with `ensure_can_access_study` / `ensure_study_scope` (see `admin_participant_management` and `export_runtime_studies_config`).
- Study ownership is stored in `Study.owner_usernames` (JSON list of scientist usernames, `NULL` = super-admin-only). Studies created by a scientist get that scientist as owner (`_create_study_from_import_payload`).
- Owner management endpoints: `PATCH /api/admin/studies/{s}/owners` (replace the list; used for "make unowned") and `POST`/`DELETE /api/admin/studies/{s}/owners/{username}` (per-owner, idempotent, one audit entry per change). `DELETE` intentionally does not require a configured scientist, so stale entries can be cleaned up; scientists cannot remove themselves.
- The owner UI is the "Study Owners" block in the danger zone of the study detail page (inside the locked `edit-section-body`; `toggleEditSection()` re-renders it so the self-lock survives unlocking). JS entry points: `addStudyOwner`, `removeStudyOwner`, `makeStudyUnowned`. Super admins cannot be owners (they already have full access), so only the configured scientists are offered.
- `tests/integration/test_admin_scientist_scope.py` contains an exhaustive endpoint matrix that fails when a study-scoped route is added without protection.
- See README.md, section "Study ownership and scientist accounts", for the user-facing behaviour and the explicit non-goals of this isolation.

## Participant diary API (incremental)

`backend/src/o_timeusediary_backend/api_diary.py` is the participant-facing write
path of the frontend rewrite. It replaces "delete the whole day, insert a
snapshot" with one row per activity, addressed by `client_uuid`.

| Method | Path (under `/api/studies/{study}/participants/{participant}`) | Purpose |
| --- | --- | --- |
| `GET` | `/diary` | Days, per-day coverage, activities and limits in one request |
| `POST` | `/activities` | Create one activity on one or more days (`day_label_indexes`) |
| `PATCH` | `/activities/{client_uuid}` | Change one row |
| `DELETE` | `/activities/{client_uuid}` | Remove one row |
| `DELETE` | `/activity-groups/{group_id}` | Remove every row one create produced |
| `POST` | `/diary/submit` | Lock the diary; idempotent |

Rules that must not drift:

- **Row identity** is `"<client_uuid>:<day_index>"`, so a retried create finds its
  own rows instead of duplicating them.
- **Coverage** comes from `coverage.py` only. The submit gate, the admin progress
  view and `GET /diary` all call it, so the day rail cannot promise something the
  gate then rejects.
- **Access** is decided once, in `api_deps/diary_access.py`: open studies create
  the participant row on first write, and a submitted diary is readable but not
  writable (`study_already_submitted`).
- **`POST /diary/submit` is not `POST .../submit`.** The latter is the old
  whole-day writer's route and stays until cutover; the new one sits under
  `/diary` so the two cannot shadow each other.
- Errors carry a machine-readable `detail.code` (`overlap.limit_reached`,
  `activity.duplicate`, `day.ends_at_midnight`, `days.incomplete`, ...); the
  frontend maps those codes to translations and never parses message text.

## Participant-facing links (imprint, data protection, study pages)

`GET /api/studies/{study}/study-config` is the only place the participant UI
learns which pages it may link, so no deployment value has to live in a served
JavaScript file:

| Field | Source | Shown |
| --- | --- | --- |
| `imprint_url` | `TUD_IMPRINT_URL` (deployment) | menu, desktop footer |
| `privacy_url` | `TUD_PRIVACY_URL` (deployment) | menu, desktop footer |
| `footer_links` | `studies.footer_links` (per study) | menu only |
| `hide_server_wide_links` | `studies.hide_server_wide_links` (per study) | hides the two deployment links |

- Both env values are optional; empty or whitespace-only means "not configured"
  and the field is `null` (see `settings.imprint_url`). A study with no links at
  all produces no footer and no menu section.
- `hide_server_wide_links` hides the deployment pair for that study only; the
  study's own `footer_links` are unaffected.
- The old frontend still reads the same two URLs from its
  `frontend/src/settings/tud_settings.js`; that duplication goes away with the
  cutover. Do not add a third source.

## Browser/device identification (`save_browser_identification`)

Opt-in per study, **off by default**. The participant UI reports the device through
`POST /api/studies/{s}/participants/{pid}/client-info`; the endpoint ignores the
call entirely when the study has the flag off (it answers `saved: false`).

- **Storage:** one prefixed column pair on `study_participants`, migrated by 0011:
  `client_info` (JSON) and `client_info_captured_at`. The blob holds the client
  signals plus the server-owned `schema_version`, `user_agent`,
  `capture_count` and `first_captured_at`, so no second column can disagree with
  it. There is exactly **one** user agent: the `User-Agent` header when present
  (nothing in the page can rewrite it in flight), the reported value as fallback.
- **Whitelist:** `CLIENT_INFO_CLIENT_KEYS` decides what a client may store
  (`platform`, `language`, `timezone`, `screen`, `viewport`,
  `device_pixel_ratio`, `max_touch_points`). Anything else is dropped, which is
  what removed the client-side `ua-parser-js` snapshot — parsing rules improve,
  so the raw values are stored and interpreted later.
- **Idempotent by design:** the rewrite has no device storage (D33) and posts on
  every load. An unchanged snapshot is not a capture: the endpoint returns
  `unchanged: true` and leaves `capture_count`/`first_captured_at` alone.
- **Exports:** only the participant export carries it (`client_*` columns, 15 of
  them, plus `client_info_json`), and only when the study collects it — a study
  with the flag off produces no `client_*` columns at all, rather than a block of
  nulls. The activities export carries none of it: the values are per
  participant, so join on `participant_id`. `only_with_client_info=true` is a 400
  on a study that does not collect the data.
