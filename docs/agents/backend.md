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
- **One layout, one stylesheet, one script:** every admin page does {% raw %}`{% extends "admin_base.html" %}`{% endraw %} and sets {% raw %}`{% block nav %}{{ admin_nav('<page-id>', study) }}{% endblock %}`{% endraw %} from `templates/partials/admin_nav.html`. Styling lives in `static/admin.css` and shared JS helpers (`switchTab`, `adminFetch`, `setStatus`, `copyToClipboard`) in `static/admin.js`; both are mounted at `/static`. Pages must not carry their own `<style>` block - add the rule to `admin.css` behind a page-specific class instead, so the admin area keeps one look. `tests/integration/test_admin_ui_shell.py` enforces this.
- **Shared brand layer:** `static/tokens.css` is a generated copy of `frontend/src/styles/tokens.css` (colour, type, spacing, radii, shadows) and is loaded before `admin.css`, so the portal and the participant app read as one product. Never edit the backend copy: change the source and run `npm run sync:admin-tokens` in `frontend/`; `tests/unit/admin_tokens_sync.test.js` fails on drift. Component styles and the semantic status colours stay in `admin.css`, which maps its legacy names (`--surface`, `--text`, `--muted`, `--border`) onto the tokens. Use `.text-ok` / `.text-warn` / `.text-danger` instead of inline colours, and `class="num"` on numeric `th`/`td` so counts align.
- **Mobile layout:** the portal is desktop-first but has to stay usable on a phone, so all phone rules live in the single `@media (max-width: 768px)` block in `admin.css`. Use `class="table-container"` around every `<table>` (it owns the horizontal scroll and its edge shadow; a bare table inside `.study-section` is clipped by its `overflow: hidden`), `class="col-md-hide"` on `th`/`td` pairs for columns that only matter on a desktop (the value must remain reachable on the corresponding detail page), and `class="table-sticky-first"` when the first column identifies the row. Do not shrink form fields with inline `min-width`; give them a class and drop the minimum in the mobile block, because inline styles win over the stylesheet.
- Admin routes rely on HTTP Basic Auth and environment-driven credentials.
- Request validation and constrained response models are required.
- **HTML escaping:** admin pages are opened by authenticated administrators, so anything request- or store-controlled that reaches an HTML response must be escaped. Render a Jinja template (autoescaping is on) or escape explicitly with `html.escape()` - never interpolate values into HTML with an f-string (`HTMLResponse(content=f"...")`), and never add `|safe` to a template. `tests/unit/test_html_escaping_guards.py` fails on both shapes; `tests/integration/test_admin_html_escaping.py` verifies the behaviour of the admin study pages.
- **Scientist data exports:** `/api/admin/export/{study}/activities` is ordered by participant, `DayLabel.display_order`, then `start_minutes`, and every row carries `day_label_index` plus the two derived columns `start_minutes_since_diary_start` / `end_minutes_since_diary_start` (from `coverage.to_study_relative_minutes`): minutes since the start of the day label with display order 0, so the axis continues across days (day 0 22:00 -> 1320, 04:00 on day 1 -> 1440) instead of restarting every day. They are computed on read - never stored and never authoritative - and are part of the base record, not of the optional metadata columns; `study_day_start_minutes` (metadata only) documents the axis origin. CSV picks the columns up from the record keys, so a new derived field must be added to the shared `record` dict, not to `export_csv`.
- **Invitation-link export:** `/api/admin/studies/{s}/export-invitation-links` returns one row per participant with exactly `pid,invitation_link` - no participant data, consent state or external-task tokens, because those belong to exports with a different audience. Links point into the participant frontend; reuse `_build_frontend_study_join_url` rather than formatting URLs again. A `pid` link is a participant credential, so the response sets `Cache-Control: no-store` and the download is audited. It passes explicit rows to `tabular_export()` and not `export_csv()`, which sorts column names and would put the link before the `pid`.
- **Participant ids:** `participant_ids.py` is the only place that defines what an id may look like (`[A-Za-z0-9_-]+`, at most 100 characters). Never write a second regex or a local `strip()` loop: import `normalize_participant_ids` (bulk input) or `validate_participant_id` (single value) and let it raise. `api_deps/participant_identity.py` wraps the rule into a 400 with the offending value, because the global validation handler deliberately reduces pydantic errors to "Invalid request data". Enforced in the paste box, `/import-participants`, the token imports, the study-config import (`_validate_import_study_payload`, the CLI model `CfgFileStudy`), and every participant-facing route, so an open study cannot store an arbitrary string from a URL.
- **Study texts:** `study_texts.py` owns the editable text registry (`STUDY_TEXT_FIELD_SPECS`), the per-language completeness rules, canonicalization of the legacy string `description`, and the content-hash revision used by the admin editor. The CLI parser (`CfgFileStudy`), the admin upload/import path (`_validate_import_study_payload`) and the text PATCH endpoint must all call `validate_study_text_values`; do not add a fourth text policy. The editor is the **Texts** page per study (`templates/admin_study_texts.html` + `static/admin_study_texts.js`), and its field list comes from `study_text_specs_payload()`. The CLI and editor keep `require_complete_translations=True`; the admin upload/create helpers pass `False` because they also restore exports of legacy rows with partial maps. In that mode missing translations become `text_warnings` (surfaced as `text_translation_warning`) instead of errors.
- **Runtime config export:** treat the runtime-config export as a backup contract, including its outer envelope (`{studies_config, activities, ...}`). The admin file-validation upload accepts that envelope and unwraps it; the inner `studies_config` is the bare importable shape. `tests/integration/test_admin_export_import_roundtrip.py::test_runtime_export_is_lossless_for_every_backup_field` exports, imports with only `name`/`name_short` changed, exports again and asserts full equality. When adding a backup-relevant `Study` field, add it to `export_runtime_studies_config` and to that kitchen-sink test. `owner_usernames`, ids/timestamps and recorded participant data are intentionally excluded.
- **Study `name_short`:** `study_names.py` is the only place that defines the technical study identifier (`[a-z0-9_]{2,50}`, trimmed). It is enforced in `CfgFileStudy` (CLI/config), in `_validate_import_study_payload` (which normalizes the payload in place, covering `import-config` and the file-validation create flow) and in `rename_study` via `api_deps/study_identity.py`. Do not re-derive it: the admin rename form and the file-validation clash resolver render the same rule text and pattern from this module. Note it is *not* the pid rule - pids allow `-` and mixed case, study names must not, so a value that is a valid pid can still be an invalid `name_short`. The file-validation flow accepts `study_name_short_override`; it is applied after the uploaded study is selected and overrides only `name_short`, so the rest of the file remains authoritative.
- **Roster upload:** `POST /api/admin/studies/{s}/import-participants` reads a CSV/TSV file, uses only the `pid` column (case-insensitive header match; other columns are reported as ignored) and rejects the whole file when one id is invalid. `tabular_files.parse_delimited_upload` detects tab/semicolon/comma from the header line, tolerates a UTF-8 BOM and CRLF, and is the place to extend if another delimited format appears. Assignment itself goes through `apply_participant_assignment`, shared with `assign-participants`, so counts cannot drift between paste and upload; `dry_run=true` reports the counts without writing.
- **Download formats:** every admin table download takes `?format=csv` (default) or `?format=tsv`, typed as `ExportFormat` so FastAPI rejects anything else and documents the values. `tabular_export()` owns the dialect: delimiter, media type (`text/csv` / `text/tab-separated-values`), filename extension and the `X-Export-Schema-Version` header. Add a format to `EXPORT_DIALECTS` rather than branching on it at a call site, and never hard-code `text/csv` or a `.csv` filename in a route.
- **Participant page pagination:** `/admin/participant-management` pages in SQL. `q` becomes a LIKE-escaped `ilike` on the participant id, `page`/`per_page` become `LIMIT`/`OFFSET`, an out-of-range `page` clamps to the last page, and the order is `COALESCE(last activity, created_at) DESC, participant_id` so the most recently active rows come first and pages never overlap or skip tied rows. External-task assignments, participant records, activity counts and min-coverage day counts are loaded only for the visible page - in a fixed number of queries, never one per row (`_get_days_meeting_min_coverage_bulk`). The table also carries the per-participant join links (`?pid=...`) into the frontend.
- **One participant roster:** this table is the only per-participant view. The study detail page shows aggregate counters (total / in progress / submitted / skipped / consent denied) plus a link here; it must not grow a second roster or a second copy of the join links.
- **Deleting a study:** `study_cleanup.delete_study_data(session, name_short)` is the single cascade implementation (activities, participants, config blobs, available catalog + i18n, external tasks + assignments, timelines, day labels, the study row). Both `DELETE /api/admin/studies/{s}` and `tud studies delete <name_short>` call it and own the commit; a second deletion path would leave orphaned catalog rows behind. The CLI asks for confirmation unless `--yes` is passed (and refuses on a non-interactive stdin) and reports the affected participant/activity counts with `--dry-run`.

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
- The admin overview ends with an **Admin Users** section (`admin_directory.py`, super admins only): every account from the three env lists plus what each scientist manages (owned ∪ granted). It also reports *stale owners* - study owner entries naming an account that is no longer a configured scientist - because only a super admin can clean those up. The view model is built **only** when `identity.is_super_admin` and the template block is wrapped in {% raw %}`{% if admin_directory %}`{% endraw %}, so a scientist's page has no markup and no data at all; passwords never leave `settings`.
- `tests/integration/test_admin_scientist_scope.py` contains an exhaustive endpoint matrix that fails when a study-scoped route is added without protection.
- See README.md, section "Study ownership and scientist accounts", for the user-facing behaviour and the explicit non-goals of this isolation.

## Participant diary API (incremental)

`backend/src/o_timeusediary_backend/api_diary.py` is the participant-facing write
path. It replaces "delete the whole day, insert a snapshot" with one row per
activity, addressed by `client_uuid`.

| Method | Path (under `/api/studies/{study}/participants/{participant}`) | Purpose |
| --- | --- | --- |
| `GET` | `/diary` | Days, per-day coverage, activities and limits in one request |
| `POST` | `/activities` | Create one activity on one or more days (`day_label_indexes`) |
| `PATCH` | `/activities/{client_uuid}` | Change one row |
| `DELETE` | `/activities/{client_uuid}` | Remove one row |
| `DELETE` | `/activity-groups/{group_id}` | Remove every row one create produced |
| `POST` | `/day-copies` | Copy one day onto one or more other days (overwrite) |
| `POST` | `/diary/submit` | Lock the diary; idempotent |

Rules that must not drift:

- **Row identity** is `"<client_uuid>:<day_index>"`, so a retried create finds its
  own rows instead of duplicating them.
- **Coverage** comes from `coverage.py` only. The submit gate, the admin progress
  view and `GET /diary` all call it, so the day rail cannot promise something the
  gate then rejects.
- **Read order is stated, never inherited.** `GET /diary` lists activities by
  `DayLabel.display_order`, then `start_minutes`, then row id
  (`_activity_rows`). An unordered `SELECT` returns whatever the backend
  prefers, which is how MariaDB and PostgreSQL came to disagree.
- **Access** is decided once, in `api_deps/diary_access.py`: open studies create
  the participant row on first write, and a submitted diary is readable but not
  writable (`study_already_submitted`).
- **`POST /diary/submit` sits under `/diary`**, not on the participant root, so
  it does not shadow the other participant routes.
- Errors carry a machine-readable `detail.code` (`overlap.limit_reached`,
  `activity.duplicate`, `day.ends_at_midnight`, `days.incomplete`, ...); the
  frontend maps those codes to translations and never parses message text.
- **`POST /day-copies` overwrites**: a target day's own rows are deleted first.
  Every target gets its own outcome (`copied`, or `skipped` with a code), all of
  them land in one transaction and share one `group_id`, and the response carries
  the replaced rows so the client can offer an undo that restores them (D9). The
  last day still refuses a row that runs past its end (`day.ends_at_midnight`),
  and a neighbour's cross-midnight tail counts towards `max_overlap` like any
  other row. The day window test is day-relative, so a 23:00-01:00 entry is
  intra-day for a study whose day starts at 04:00.

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
- Do not add a second source for these URLs: `study-config` is the only place the
  participant app learns them.

## Participant inactivity sessions (opt-in)

`studies.inactivity_timeout_minutes` defaults to **0 (off)** for every study.
When it is greater than zero, participant data routes require a server-side
session; with the default 0 they behave exactly as before.

- **Storage / migration:** `participant_sessions` (0024) stores the study,
  participant id, SHA-256 of the cookie token, `created_at`, `last_seen_at` and
  `ended_at`. The raw token exists only in the browser cookie.
- **Cookie:** `trac_session`, `HttpOnly`, `SameSite=Lax`, `Secure` when the
  frontend URL is HTTPS, path-scoped to
  `.../participants/<pid>/`. Cookies are required: participants who block them
  cannot use a timed study. This is documented for study authors.
- **Endpoints:** `api_session.py` provides `POST .../session` (start/resume on a
  page load; replaces an expired cookie), `POST .../session/touch` (refresh from
  user activity; 401 when already expired), `GET .../session`, and
  `DELETE .../session`.
- **Enforcement:** `api_deps/participant_session.py` wraps `get_participant_context`
  and is used by `get_readable_diary_context` (and therefore all diary writes),
  consent, instructions, client-info, and external-task launch/confirm. It is
  deliberately absent from `study-config`, `activities-config`, the public study
  list and `ux-events`, so the app can bootstrap and telemetry cannot keep a
  session alive.
- **Errors:** 401 with `detail.code` `session.required`, `session.expired` or
  `session.invalid`. The frontend redirects to the timeout page for all three.
- **Sliding window:** valid protected requests refresh `last_seen_at` (throttled
  to 5 s); `/session/touch` refreshes it from non-API activity. Expiry is
  `now >= last_seen_at + timeout`, so exactly the configured duration counts as
  expired.
- **Cleanup:** participant removal, participant data reset, all-participant-data
  deletion and study deletion remove the corresponding session rows.
- **Not authentication:** the invitation link remains the credential. Reopening
  it starts a new session; the timeout protects an idle tab and rejects direct
  API use after inactivity. It does not prove who is at the keyboard.

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
- **Idempotent by design:** the app has no device storage (D33) and posts on
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
  `_is_external_tasks_locked_by_diary_requirement`. Without that flag the
  participant continues to the tasks, which is the case the option exists for.
  `study-config` reports the gate per task as `locked_reason` (`diary` or
  `task_level`, `null` when open) next to `task_level`, so a client renders the
  lock instead of guessing from an empty `continuation_url`. Level locks come
  from `_build_participant_external_task_unlock_map` and nowhere else.
- **External-task return URL:** `_build_external_task_expected_return_url_template`
  builds the one shape: `{TUD_FRONTEND_URL}/index.html?study=...&pid={participant_id}&callback_task_key=...&callback_token={assigned_token}#/tasks`.
  It is shown in the admin study card; reuse it rather than formatting a return URL again, and
  remember the HMAC message itself does not depend on the URL shape.
- **Export:** the participant export gains `participant_skipped_at`,
  `participant_skip_reason_code` and `participant_skip_note`, but only for studies
  that allow skipping. `study_submitted_at` alone cannot tell a skipped diary
  from a filled one; `participant_diary_completed_at` (coverage-based) stays empty
  for a skipper.

## Banner messages (issue #153)

Two messages exist, each with exactly one row and each switched on/off manually
(`is_active` is the whole "schedule"; there is no start/end time):

- **server message** - `server_message`, a singleton row (`id = 1`, no
  autoincrement). Audience is `participants`, `admins` or `both`.
- **study message** - `study_messages`, one row per study (unique `study_id`),
  read by that study's participants.

`messages.py` owns the rules; do not read the tables directly from a route:
`resolve` (`localized_message_text`), `message_key` (the opaque dismissal key),
`active_*` (the `is_active` + audience filter) and the upserts that bump
`revision` only when something actually changed. An active message with no text
is rejected (400).

- `GET /api/messages?study_name_short=&lang=` - unauthenticated participant
  payload `{server: {text, key} | null, study: ...}`. Unknown study = no study
  message, not a 404: a banner is never worth an error page. It also serves the
  entry page, where no study is known.
- `GET /api/admin/messages` - the server message for audience `admins`; read by
  `admin.js`, which injects the dismissible banner on every admin page.
- `GET|PUT /api/admin/messages/server` - `require_super_admin`.
- `GET|PUT /api/admin/studies/{name}/message` - study-scoped automatically
  through `_STUDY_SCOPED_PATH_PATTERNS`; super admins pass everywhere. Last
  write wins (one field, no revision conflict).

The admin UI is the `Message` page per study (`admin_message.html`) and a card on
the overview for super admins; both are plain `<textarea data-message-language>`
markup driven by `static/admin_messages.js`. Texts are rendered as plain text
(`white-space: pre-line`), never as HTML.

## The study's time grid (`time_step_minutes`, `min_duration_minutes`)
- Both live on `Study` (migration `0023_add_time_grid`), are part of
  `studies_config.json`, the admin import payload and the runtime-config export,
  and travel in the daily diary payload (`diary.study.*`) next to
  `day_start_minutes`.
- The rules are in `timing.py`: the step is one of 5/10/15/20/30/60 (multiples
  of five that divide 1440, so a midnight end stays on the grid) and the minimum
  must be a multiple of the step. The config parser and the admin import model
  both call `validate_timing_settings`, so the two entry points cannot accept
  different grids.
- **The backend does not validate data against them.** It stores the integer
  minutes a client sends (it always has; there is no server-side rounding or
  step check). The participant client enforces the grid and the minimum, and the
  only reason it can do that safely is the client-side exemption for unchanged
  times (see `docs/agents/frontend.md`).

