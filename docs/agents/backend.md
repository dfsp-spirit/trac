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
- **One layout, one stylesheet, one script:** every admin page does `{% extends "admin_base.html" %}` and sets `{% block nav %}{{ admin_nav('<page-id>', study) }}{% endblock %}` from `templates/partials/admin_nav.html`. Styling lives in `static/admin.css` and shared JS helpers (`switchTab`, `adminFetch`, `setStatus`, `copyToClipboard`) in `static/admin.js`; both are mounted at `/static`. Pages must not carry their own `<style>` block - add the rule to `admin.css` behind a page-specific class instead, so the admin area keeps one look. `tests/integration/test_admin_ui_shell.py` enforces this.
- Admin routes rely on HTTP Basic Auth and environment-driven credentials.
- Request validation and constrained response models are required.
- **HTML escaping:** admin pages are opened by authenticated administrators, so anything request- or store-controlled that reaches an HTML response must be escaped. Render a Jinja template (autoescaping is on) or escape explicitly with `html.escape()` - never interpolate values into HTML with an f-string (`HTMLResponse(content=f"...")`), and never add `|safe` to a template. `tests/unit/test_html_escaping_guards.py` fails on both shapes; `tests/integration/test_admin_html_escaping.py` verifies the behaviour of the admin study pages.
- **Scientist data exports:** `/api/admin/export/{study}/activities` is ordered by participant, `DayLabel.display_order`, then `start_minutes`, and every row carries `day_label_index` plus the two derived columns `start_minutes_since_diary_start` / `end_minutes_since_diary_start` (from `coverage.to_study_relative_minutes`): minutes since the start of the day label with display order 0, so the axis continues across days (day 0 22:00 -> 1320, 04:00 on day 1 -> 1440) instead of restarting every day. They are computed on read - never stored and never authoritative - and are part of the base record, not of the optional metadata columns; `study_day_start_minutes` (metadata only) documents the axis origin. CSV picks the columns up from the record keys, so a new derived field must be added to the shared `record` dict, not to `export_csv`.
- **Invitation-link export:** `/api/admin/studies/{s}/export-invitation-links-csv` returns one row per participant with exactly `pid,invitation_link` - no participant data, consent state or external-task tokens, because those belong to exports with a different audience. Links point into `frontend_new` by default and into the classic client with `?frontend=legacy`; reuse `_build_frontend_new_study_join_url` / `_build_frontend_study_join_url` rather than formatting URLs again. A `pid` link is a participant credential, so the response sets `Cache-Control: no-store` and the download is audited. It writes the CSV with `csv.writer` and not `export_csv()`, which sorts column names and would put the link before the `pid`.
- **Participant page pagination:** `/admin/participant-management` pages in SQL. `q` becomes a LIKE-escaped `ilike` on the participant id, `page`/`per_page` become `LIMIT`/`OFFSET`, an out-of-range `page` clamps to the last page, and the order is `created_at DESC, participant_id` so pages never overlap or skip tied rows. External-task assignments are loaded only for the visible page, so page cost does not grow with the study.

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
- The admin overview ends with an **Admin Users** section (`admin_directory.py`, super admins only): every account from the three env lists plus what each scientist manages (owned ∪ granted). It also reports *stale owners* - study owner entries naming an account that is no longer a configured scientist - because only a super admin can clean those up. The view model is built **only** when `identity.is_super_admin` and the template block is wrapped in `{% if admin_directory %}`, so a scientist's page has no markup and no data at all; passwords never leave `settings`.
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

## Usability signals (`save_ux_events`)

Opt-in per study, **off by default**, and unlinked by design: these rows exist to
answer "where do participants get stuck?" without observing *who* got stuck.

- **Endpoint:** `POST /api/studies/{s}/ux-events` — study-scoped, so there is no
  participant id in the path, body or storage. A study with the flag off answers
  `accepted: 0, reason: ux_events_disabled` and stores nothing.
- **Storage:** one `ux_events` table, migrated by 0016:
  `study_id`, `load_id`, `name`, `occurred_at`, `received_at`, `language`,
  `app_version`, `props` (JSON). `load_id` is a random UUID for one page load,
  kept in memory by the client, and only used for `COUNT(DISTINCT load_id)`; no
  view renders it. There is no participant id, IP, user agent, referrer or
  cookie in the table.
- **Vocabulary:** `ux_events.py` holds the complete catalogue (`EVENT_PROPS`)
  and the closed value sets (`ENUM_PROPS`). Seven events cover what the database
  cannot see: `session.started`, `activity.form.opened`/`.closed`,
  `diary.blocked` (validation refusals with their machine code),
  `search.no_result`, `api.error` (5xx and unmapped failures) and
  `client.error`. A coded 4xx is reported as a refusal, not as an error, so the
  two tables stay disjoint.
- **Filtering:** unknown event names are dropped, properties are filtered to the
  event's allow-list, enumerated properties refuse free text, `api.error` routes
  are rewritten so `/participants/<pid>/` becomes `/participants/:pid`, and the
  search term is folded and capped at 48 characters. Caps: 20 events per batch,
  32 KB body, 512 B of properties per event, 200 events per load per hour
  (in-memory, per worker).
- **Consent:** the client only reports when the study flag is on *and* — for a
  consent-requiring study — the participant consented (the same rule as
  `save_browser_identification`, D38). The server cannot check consent, because
  it never learns who is asking; that is the price of the rows staying
  unlinkable, and it belongs in the consent text.
- **Reading it:** `/admin/ux-signals` (aggregates per study and window) and
  `/admin/ux-signals/export.csv?study_name_short=…&dataset=queries|blocked|…`.
  The "searches that found nothing" table is the alias shortlist for
  `activities_*.json`.
- **Retention:** `TUD_UX_EVENT_RETENTION_DAYS` (default 90) and
  `tud ux-events purge [--days N] [--study S] [--dry-run]`.

## Skipping the diary (`allow_skip_timeuse`)

Opt-in per study (**off by default**: a diary-only study never offers it).
Participants who cannot fill the diary - typically because it is one part of a
longer protocol - can close it from the menu:

- **Endpoint:** `POST /api/studies/{s}/participants/{pid}/diary/skip`, body
  `{reason_code?, reason_note?}` (both optional). 400 when the study does not
  allow it (`diary.skip_not_allowed`) or the code is unknown
  (`diary.unknown_skip_reason`); idempotent once closed.
- **Storage:** `study_submitted_at` is set, so every existing lock, the admin
  completion view and the exports keep working, plus `skipped_at`,
  `skip_reason_code` and `skip_note` (migration 0015). The partial diary is kept.
- **Stage:** `resolve_placement` returns `done` with `done_reason="skipped"`; the
  client then renders the study's `study_text_end_skipped`.
- **External tasks:** a skip closes the diary but is **not** a filled diary. A
  study with `require_diary_before_external_tasks` keeps its tasks closed for a
  skipper - enforced both by the stage machine and by
  `_is_external_tasks_locked_by_diary_requirement` (whose payload signal is an
  empty `continuation_url`). Without that flag the participant continues to the
  tasks, which is the case the option exists for.
- **Export:** the participant export gains `participant_skipped_at`,
  `participant_skip_reason_code` and `participant_skip_note`, but only for studies
  that allow skipping. `study_submitted_at` alone cannot tell a skipped diary
  from a filled one; `participant_diary_completed_at` (coverage-based) stays empty
  for a skipper.
- **Old app:** still skips by redirect (`completion_status=skipped`) and records
  nothing. That goes away with the cutover; do not add a second code path.
