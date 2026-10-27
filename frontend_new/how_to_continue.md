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
- **Review + submit** (D32): two-step modal, per-day state, *Edit* back to a day, locked and read-only
  after submission, survives reload.
- **Stage machine** (D37): `unavailable | consent | instructions | diary | tasks | done`, computed
  server-side in `backend/src/o_timeusediary_backend/stages.py`, plus `done_reason`
  (`completed` / `noconsent`). Views in `src/js/ui/views/`, router in `src/js/{domain,ui}/router.js`,
  one guard redirect, hash routes, URL carries identity only.
- **Keyboard** (D31): `PageUp/PageDown`, `n`, `/`, `Esc`, `Enter`, `Delete`, `?`, confined to the
  diary region, with the list and its session-scoped switch under the menu.
- **i18n**: `diary.*` keys in en/de/sv only (D34/D35), markdown rendering for study text.
- **Deployment**: two nginx locations, one settings file per app, no duplicated scripts.

### Layers (the map)

```
src/js/
  config.js        deployment config (replaced per environment at deploy time)
  main.js          composition root, 297 lines, cap 300
  data/            api.js (only network), i18n.js (locales + translator)
  domain/          time, geometry, validation, diary, color, review, markdown, router  (pure)
  state/           store.js (one state object), diary.js (the only writers)
  ui/              components; views/ holds the five stage pages
tools/check-architecture.mjs   enforces D33: import direction, no globals, no device storage,
                               no network outside data/, CSS rules, file size caps
```

### Gates

| Command | Needs | Result now |
| --- | --- | --- |
| `sh test_frontend_new.sh` | nothing (Node 24, `npm ci` in `frontend_new/`) | 115 tests + architecture + typecheck |
| `sh test_frontend_unit.sh` | nothing | 115 old-frontend tests |
| `sh test_backend_unit.sh` | nothing | 255 tests |
| `sh test_backend_integration.sh` | **backend running on :8000**, `TUD_BASE_SCHEME=http://localhost:8000` | 162 passed, 2 skipped |
| `sh test_backend_migrations.sh` | **docker**, or `TUD_MIGRATION_TEST_DATABASE_URL` | 16 tests |
| `sh test_e2e.sh` | `./run_dev_nginx_both.bash` running | old app's suite + the new smoke spec |

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

### 3.1 Committed Playwright specs for the rewrite (D33 rule 8)

Only `frontend/tests/e2e/new_frontend_smoke.spec.js` exists, and it only pins deployment. Everything
else was verified with throwaway scripts that were deleted. The flows worth pinning, in one file each
under `frontend_new/tests/e2e/` (they can run through the existing runner in `frontend/` until the old
suite is gone):

- create an activity (catalogue → form → save), edit it, delete + undo;
- multi-day create ("Also on 2 days") and the gap prefill;
- review modal: day states, *Edit* jumps to the day, incomplete submit explains instead of advancing;
- submit → read-only, survives reload;
- stage walk: consent → instructions → diary → submit → thanks, including the deep-link guard
  (`#/thanks` for a `consent`-stage participant must be corrected to `#/consent`).

Two real bugs were found only by driving the browser, which is the argument for this list: `Esc`
stopped closing the review modal once the shortcut handler ran, and `Enter` in the activity form
reloaded the page.

### 3.2 Old-frontend behaviour the rewrite does not have yet

Check each against the old app before deciding to drop it:

- **Skip the diary** (`allow_skip_timeuse`). No UI, and no `skipped` done reason in `stages.py`. If it
  stays, `StudyParticipant` needs a field to record it — the old flow carried it in the URL.
- **Browser identification** (`save_browser_identification`). The backend endpoint exists; the
  rewrite never calls it.
- **Maintenance banner / footer links.** Backend settings exist (`footer_links`,
  `IS_MAINTENANCE_MODE` on the old app); the rewrite has neither.
- **"Used recently"** in the activity panel (D28) — never built.
- **Rail consolidation** (D28): the day rail should also carry submission state and *Submit*; today
  Submit is in the top bar.
- **Menu pages** (study information, data protection, contact): entries were removed until the pages
  exist. The old app renders footer links instead.

### 3.3 Cutover (plan step 5)

- Delete the second timeline and the `2xxx` activity codes from `studies_config.json` and the
  activities JSON files (Q6/Q7: confirmed).
- Delete the old whole-day save endpoint and the old diary JS/CSS/pages once nothing uses them (D25).
- `day_start_minutes = 240` stops being a legacy default and becomes ordinary study configuration.
- Port or retire the ~45 old E2E specs; they pin the old interaction model.
- Then `/report/` disappears and `/report-new/` becomes `/report/` (one nginx location block).

### 3.4 Open decisions

- **`copy_source_uuid`**: the column exists, the API echoes it, nothing sets it. Q5 answered "multi-day,
  no limits" without asking for provenance. Decide keep-or-drop **before** the first real data
  collection.
- **Keyboard switch persistence**: session-only today, because D33 forbids device storage and there is
  no participant profile. Needs a server-side preference or an explicit "session only is fine".
- **Idle timeout** ("prevent other family members from continuing in an open browser session"):
  recorded as open at priority Z in the plan. Do not build it with URL tricks; the honest form is a
  server-side expiring session token, and the participant's own return must keep working.

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

## 5. Local database state (not part of the repo)

The dev database on the machine where this was written contains throwaway studies from the sessions:
`it_rev_full_*`, `it_rev_part_*`, `it_stage_ui_*` and participants `rev-kb*`, `walk*`, `stage-walk-*`.
Nothing depends on them; delete or ignore. `adult_pilot_de` participants were reset where the work
touched them.
