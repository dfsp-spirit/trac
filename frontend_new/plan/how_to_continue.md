# Continuing the frontend rewrite

Written 2026-10-27, at the end of the session that built the stage machine, the review/submit flow and
the deployment wiring. Branch `new_frontend`, last commit `a79cba9`, **CI fully green** (unit tests,
backend integration, migrations, Playwright E2E in four browser/timezone legs).

`PLAN_frontend_new.md` in this directory is the binding decision record (D23–D38). Read it before
changing behaviour; this file is the "where am I, what next" companion.

---

## 1. Where things stand

The rewrite runs **next to** the old app, not instead of it. Both are deployed in dev and CI:

| Path | Serves |
| --- | --- |
| `/report/` | the old app (`frontend/src`) |
| `/report-new/` | the rewrite (`frontend_new/src`) |
| `/locales/` | shared locale files (`frontend/src/locales`, D35) |
| `/tud_backend/` | the API |

What works end to end (browser-verified, and in CI where noted):

- **Diary**: continuous multi-day timeline, lanes, gaps, day rail, day navigation, activity panel with
  pinned search, add/edit/delete with undo, multi-day create, coverage against `min_coverage`.
  Searching also matches **sub-activities** by their own name: a matching child becomes its own row
  (child name as the title, parent as the hint) and opens the form with that child preselected, so
  "Joggen" finds "Joggen: Draußen alleine" in one click instead of the parent plus a second choice.
- **Review + submit** (D32): two-step modal, per-day state, *Edit* back to a day, locked and read-only
  after submission, survives reload.
- **Stage machine** (D37): `unavailable | consent | instructions | diary | tasks | done`, computed
  server-side in `backend/src/o_timeusediary_backend/stages.py`, plus `done_reason`
  (`completed` / `noconsent`). Views in `src/js/ui/views/`, router in `src/js/{domain,ui}/router.js`,
  one guard redirect, hash routes, URL carries identity only.
- **Keyboard** (D31): `PageUp/PageDown`, `n`, `/`, `Esc`, `Enter`, `Delete`, `?`, confined to the
  diary region, with the list and its session-scoped switch under the menu.
- **Stage pages** (D40): one `Page` component (eyebrow = study name, one `h1` = stage purpose, lead,
  body, actions), a full-width header aligned to the shell, study Markdown demoted and level-normalised
  under the page heading, reason-aware `unavailable` copy with dates, one notice component, and a real
  failure page with *Try again*. Verified with axe: five pages, zero violations, one `h1` each.
- **i18n**: `diary.*` keys in en/de/sv only (D34/D35), markdown rendering for study text. The UI
  language follows `?lang`, then the browser, then the study's `selected_language`, and the menu only
  offers the study's `supported_languages`.
- **Deployment**: two nginx locations, one settings file per app, no duplicated scripts.

### Layers (the map)

```
src/js/
  config.js        deployment config (replaced per environment at deploy time)
  main.js          composition root, 297 lines, cap 300
  data/            api.js (only network), i18n.js (locales + translator)
  domain/          time, geometry, validation, diary, color, review, markdown, router,
                   dates, language  (pure)
  state/           store.js (one state object + the initial state), diary.js (the only writers)
  ui/              components; page.js/notice.js are the stage-page frame, reviewFlow.js the
                   review-then-submit seam, views/ holds the five stage pages
  styles/          tokens, base, components (kit), page, topbar, layout (shell), stage, panel, dialogs
tools/check-architecture.mjs   enforces D33: import direction, no globals, no device storage,
                               no network outside data/, CSS rules, file size caps
```

### Gates

| Command | Needs | Result now |
| --- | --- | --- |
| `sh test_frontend_new.sh` | nothing (Node 24, `npm ci` in `frontend_new/`) | 142 tests + architecture + typecheck |
| `sh test_frontend_unit.sh` | nothing | 115 old-frontend tests |
| `sh test_backend_unit.sh` | nothing | 255 tests |
| `sh test_backend_integration.sh` | **backend running on :8000**, `TUD_BASE_SCHEME=http://localhost:8000` | 162 passed, 2 skipped |
| `sh test_backend_migrations.sh` | **docker**, or `TUD_MIGRATION_TEST_DATABASE_URL` | 16 tests |
| `sh test_e2e.sh` | `./run_dev_nginx_both.bash` running | old app's suite |
| `cd frontend_new && npm run test:e2e` | `./run_dev_nginx_both.bash` running | 11 rewrite specs (chromium) |

---

## 2. Fresh machine: getting to a green run

```sh
# 1. Backend settings and schema (the API does no bootstrap of its own any more)
cp dev_tools/local_nginx/backend_settings/.env.dev-nginx backend/.env   # or write your own
cd backend && uv sync --frozen
uv run tud db upgrade
uv run tud studies import --config studies_config.json
uv run uvicorn o_timeusediary_backend.api:app --host 127.0.0.1 --port 8000   # keep running
```

```sh
# 2a. Quick look at the rewrite without nginx (serves the repo root, so the
#     repo-default config.js resolves its locale path)
python3 -m http.server 8765 --bind 127.0.0.1
#   http://127.0.0.1:8765/frontend_new/src/index.html?study=<study>&pid=<participant>

# 2b. The real deployment shape (what CI does)
./run_dev_nginx_both.bash
#   http://localhost:3000/report/           old app
#   http://localhost:3000/report-new/       rewrite
```

### Traps that cost time last session

- **A stale uvicorn silently keeps serving old code.** If port 8000 is in use, the new process dies
  and you debug code that is not running. Check `ps -eo pid,args | grep [u]vicorn` and kill by PID.
- **`run_dev_nginx_both.bash` overwrites a tracked file**: it copies
  `dev_tools/local_nginx/frontend_settings/tud_settings.dev-nginx.js` over
  `frontend/src/settings/tud_settings.js`. Run `git checkout -- frontend/src/settings/tud_settings.js`
  before committing.
- **Deployment copies over the rewrite's config too**: `config.new*.js` →
  `frontend_new/src/js/config.js`. Restore it the same way
  (`git checkout -- frontend_new/src/js/config.js`) after running the nginx stack locally, or the repo
  default (`localesUrl: '../../frontend/src/locales'`) is gone.
- **`nginx` needs a writable prefix**: use `-p /tmp/` and `client_body_temp_path` (already in the
  template). `nginx -t -c /tmp/nginx.conf -p /tmp/` first — an unsubstituted `$VARIABLE` is the usual
  failure.
- **Integration tests** use the root path `/tud_backend`; Starlette strips it. Start the backend and
  set `TUD_BASE_SCHEME=http://localhost:8000`.
- **Study import** rejects languages whose activities JSON is missing, and per-participant task tokens
  require a closed study (`study_participant_ids` set); open studies need `open_pool` tokens.
- **Pre-commit hooks** run ruff/ruff-format/prettier. `ruff-format` reformats *the whole staged file*,
  so touching an old file can pull in unrelated whitespace changes — acceptable, but expect it.

---

## 3. What is left, in the order I would do it

**Pilot data.** `backend/studies_config_new.json` + `backend/activities_newui_main.json` are the study
the rewrite is piloted on (`pilot_mpiae_01_open`). Import with a second `--config`
(`tud studies import --config studies_config.json --config studies_config_new.json`; `--config`
repeats and the import creates the `Participant`/`StudyParticipant` rows for every
`study_participant_ids` entry, so e2e participants are seeded by the import instead of by test code).

**Fixture studies** live in the same file, all closed (fixed participant ids) and all pointing at
`activities_newui_main.json`, so a spec can start in any stage after a plain import:

| `name_short` | lands in | ids | note |
| --- | --- | --- | --- |
| `pilot_mpiae_01_open` | `consent` | any (`open`) | the real pilot study, open enrolment |
| `newui_02_paused` | `unavailable` (`paused`) | `paused_01` | `is_paused`; the page says the study is paused |
| `newui_03_ended` | `unavailable` (`ended`) | `ended_01` | window over; the page names the end date |
| `newui_04_not_started` | `unavailable` (`not_started`) | `notstarted_01` | window opens in 2030; the page names the start date |
| `newui_05_instructions` | `instructions` | `instructions_01/02` | `require_consent: false` + instructions text |
| `newui_06_diary` | `diary` | `diary_01/02` | no consent, no instructions |
| `newui_07_consent` | `consent` | `consent_01/02` | consent only, no instructions |
| `newui_08_prefilled` | `diary` | `ready_01` 7/7 days complete, `ready_02` 2 partial days, `ready_03` empty | review, coverage, incomplete-submit |
| `newui_09_tasks` | `diary` | `tasks_01/02` 7/7 days complete | one callback task (`fixture_survey`, tokens `fixture-token-tasks-0N`) |
| `newui_10_walkthrough` | `consent` | `walk_01/02` | consent **and** instructions, so the full stage walk is possible |

What the config cannot express: **a submitted participant**. `study_submitted_at` is participant
state, not config, so `done` is one call away from a prefilled fixture — `POST
/api/studies/{study}/participants/ready_01/diary/submit` → `done` (reason `completed`), and the same
call for `tasks_01` → `tasks` → confirm with the token → `done`. Seeds and `study_participant_ids`
apply when the study is **created**, so reseeding means deleting the study and re-importing; the
fixtures expect a fresh database (as CI has) or a manual reset. The same is true after
`stage-walk.spec.js` submits `walk_01`.

The three `unavailable` fixtures only reach the page because the rewrite asks for
`GET …/study-config?include_unavailable=true` (D39). Without the flag the endpoint answers 403 — that
is the old frontend's signal — and the client would show its generic failure text instead of the
reason.

### 3.1 Committed Playwright specs for the rewrite (D33 rule 8)

The rewrite has its **own** runner and CI job now: `frontend_new/playwright.config.js`, specs under
`frontend_new/tests/e2e/`, and `.github/workflows/frontend_new_e2e.yml`. The runner is chromium-only
until the suite grows, so a new spec gives a fast signal without waiting for the old app's E2E job.
`deployment.spec.js` pins deployment, `activity-lifecycle.spec.js` covers create → edit → reload →
delete + undo on the `newui_06_diary` fixture, `activity-multiday-gap.spec.js` covers the
"also on other days" chips and opening the form from a gap, and `review-modal.spec.js` covers the
complete/incomplete day states, *Edit* back to a day, and the confirmation step, and
`stage-walk.spec.js` covers the deep-link guard plus consent → instructions → diary → submit → thanks.
All clear their activities through the public diary API, so repeated local runs start from the same
state.

`submit-readonly.spec.js` submits `newui_08_prefilled/ready_01`, and `stage-walk.spec.js` submits
`newui_10_walkthrough/walk_01`; both check the thanks page, hidden editor controls, and the same state
after reload. Those participants are one-way: after the first local run the specs skip with a reset
message. To restore the fixtures, delete the studies and re-import them:

```sh
for study in newui_08_prefilled newui_10_walkthrough; do
  curl -u "$TUD_API_ADMIN_USERNAME:$TUD_API_ADMIN_PASSWORD" -X DELETE \
    "http://localhost:3000/tud_backend/api/admin/studies/$study"
done
cd backend && uv run tud studies import --config studies_config.json --config studies_config_new.json
```

That lifecycle spec also pins the plain-http LAN case: `crypto.randomUUID()` only exists in secure
contexts, and participants reached the dev stack at `http://192.168.x.x:3000`, where saving failed
with "Nicht gespeichert" before any request was sent. `domain/uuid.js` now falls back to
`crypto.getRandomValues()`; the spec removes `randomUUID` and asserts the POST still happens.

Run it with `./run_dev_nginx_both.bash` up, then:

```sh
cd frontend_new && npm run test:e2e
```

The CI job imports **both** study configs (`studies_config.json` and `studies_config_new.json`), so the
fixtures and their participant ids exist. Everything else was verified with throwaway scripts that
were deleted. All five flows from the original list are now pinned:
`deployment`, `activity-lifecycle`, `activity-multiday-gap`, `review-modal`, `submit-readonly`, plus
the `stage-walk` deep-link guard.

Fixtures are seeded only when a study is created, so a local run that submits or edits leaves state
behind: delete and re-import the fixture study (or use a fresh database) before repeating it. CI gets
a fresh database per run.

Three real bugs were found only by driving the browser, which is the argument for this list: `Esc`
stopped closing the review modal once the shortcut handler ran, `Enter` in the activity form
reloaded the page, and the stage guard compared its cached route instead of the URL, so a same-page
hash change stayed on `#/diary` while the consent page was shown.

### 3.2 Old-frontend behaviour the rewrite does not have yet

Check each against the old app before deciding to drop it:
- **"Used recently"** in the activity panel (D28): built. It is derived from the diary the client
  already holds — `recentEntries()` in `ui/activitySearch.js` folds the loaded activities onto
  catalogue entries and keeps the 4 most recently touched, newest first (deduplicated across days,
  keyed by the picked row so a sub-activity surfaces its parent, `updated_at` falling back to
  `created_at`). Entries that are no longer in the catalogue and custom-input rows are dropped, so a
  shortcut can never open a dead or empty form. No endpoint and no device storage: the shortcut is a
  shortcut into the same `onChoose` path as the catalogue, rendered by `ui/activityList.js` as an
  extra "Used recently" group (`diary.panel.recent`) above the categories — and only while the
  search box is empty, because with a query the matches are the whole answer. Pinned by
  `frontend_new/tests/unit/activity-search.test.js`.

- **Menu pages** (study information, data protection, contact): built. `ui/legalLinks.js` turns the
  study config into links; `ui/shellChrome.js` renders them and owns the language select, both
  re-rendered when the language changes. Phones get them **only** in the menu (a footer under a
  week-long timeline is a misclick target), desktop (≥1200px) gets a small footer at the end of the
  document *and* the menu. The footer shows only the deployment's legal pair (`TUD_IMPRINT_URL`,
  `TUD_PRIVACY_URL`, now sent in study-config as `imprint_url`/`privacy_url`); the menu adds the
  study's own `footer_links` and respects `hide_server_wide_links`. Entries without a URL are not
  rendered (D28). External targets open in a new tab with `rel=noopener` and the
  `footer.opensInNewTab` hint. The old app's iframe-dialog behaviour for *same-origin* links is not
  ported: nothing is hosted locally today. Pinned by `frontend_new/tests/unit/legal-links.test.js`
  and `backend/tests/{unit/test_settings_legal_links.py,integration/test_study_footer_links.py}`, plus
  a browser check of both viewports (phone: no footer, menu only; desktop: footer + menu; nothing
  configured: no footer).

### 3.3 Cutover (plan step 5) - DO NOT DO THIS WITHOUT EXPLICITELY BEING TOLD TO DO IT!

DO NOT DO THIS WITHOUT EXPLICITELY BEING TOLD TO DO IT! We may want to green/blue test both!

Only once we explcitiely request to delete, this is what we will need to do:

- Delete the second timeline and the `2xxx` activity codes from `studies_config.json` and the
  activities JSON files (Q6/Q7: confirmed).
- Delete the old whole-day save endpoint and the old diary JS/CSS/pages once nothing uses them (D25).
- `day_start_minutes = 240` stops being a legacy default and becomes ordinary study configuration.
- Port or retire the ~45 old E2E specs; they pin the old interaction model.
- Then `/report/` disappears and `/report-new/` becomes `/report/` (one nginx location block).

Until then, we need to add new studies to studies_config.json that are suitable for the frontend_new. The old frontend supported 2 or more timelines, the new ones has one timeline which can show several things in parallel (and a setting for max_parallel). We need to decide whether we want to simply display stuff from old studies, intended for several timeslines, in one as a sort of backwards-compatibility fallback. Would be limited by max_parallel setting, but no study has more than 2 timeliens, it gets too confusing for the user.

### 3.4 Open decisions, answered now (oct 28)

- **Idle timeout** ("prevent other family members from continuing in an open browser session"):
  recorded as open at priority Z in the plan. Do not build it with URL tricks; the honest form is a
  server-side expiring session token, and the participant's own return (invitation link to study) must keep working.


Related, one layer up: the new frontend reads **one** timeline, but `flattenCatalogue`
(`src/js/ui/activitySearch.js`) still merges every key under `timeline`, so a legacy file with
`primary` + `secondary` shows duplicate activity names (8 of them in the pilot file: `1200` and
`2200`, …). Settle that with the same cleanup: one timeline key per activities file for the rewrite,
and the client either honours the resolved timeline (`diary.timeline.key`) or the server returns a
single merged timeline.

---

## 4. Rules that are easy to break (the checks will fail)

- `frontend_new` may not import `frontend` (and vice versa) — the locale files are the only shared
  artefact.
- No globals, no `document.documentElement` outside `main.js` (`<html lang>`), no
  `localStorage`/`indexedDB`, no `fetch` outside `js/data/`.
- File caps: 300 lines JS, 150 CSS (`components.css` excepted). Hitting the cap has been a reliable
  signal that something belongs in its own module — `main.js` was split three times this way
  (`diaryView`, `panelController`, `stageMachine`/`boot`).
- CSS: tokens only, no colour literals, no id selectors, no `!important` (except `base.css`).
- Locale keys: `diary.*` plus a small shell allowlist; values are plain text; `_one`/`_other` for
  plurals. `tests/unit/page_i18n_keys.test.js` enforces all of it across de/en/sv.

