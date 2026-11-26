# Testing & Environment Agent Documentation

## Test Suite Intent
- Backend unit tests (`backend/tests/unit/`) validate isolated backend logic.
- Backend integration tests (`backend/tests/integration/`) validate API/database behavior.
- Frontend unit tests (`frontend/tests/unit/`) cover the pure domain/data modules with `node:test`.
- Frontend component tests (`frontend/tests/components/`) mount one view per fixture page with a
  static file server and a single browser.
- Frontend E2E tests (`frontend/tests/e2e/`) validate complete participant flows against nginx,
  the API and a seeded database.
- Admin E2E tests (`frontend/tests/e2e/admin/`) validate the backend's Jinja admin portal. They run
  as the `admin-chromium` Playwright project, once per CI run. `admin_runtime_settings.spec.js`
  covers the locked runtime-settings form, the consent-text activation gate and the time-grid
  confirmation.

## Guard Specs (cheap, non-flow checks)
- `deployment.spec.js` proves the app is served, reaches the API, routes to the stage the server
  reports, and finds its own locale files.
- `a11y.spec.js` runs axe-core via `@axe-core/playwright` (dev dependency) over the app and its
  views and fails on any WCAG A/AA violation.
- `touch-targets.spec.js` checks the phone layout (no sideways scrolling, >= 24x24 controls).
- `timeout.spec.js` uses Playwright's clock to prove the opt-in inactivity timeout redirects after the configured period, that the timeout page carries no invitation identity, that a study with the default `0` never redirects, and that a blocked session cookie shows the "Cookies required" failure instead of looping. Direct participant API helpers call `ensureParticipantSession` first, so a future timed fixture does not need a per-test cookie setup.
- `tests/unit/architecture.test.js` runs `tools/check-architecture.mjs` (D33): layer imports, no
  network outside `js/data`, no device storage outside the allow-list, file-size caps.
- `tests/unit/page_i18n_keys.test.js` fails when the app requests a locale key that is missing from
  any locale file.

## Preferred Entry Commands
- `./test_backend_unit.sh`
- `./test_backend_integration.sh` (self-contained: prepares a disposable database, starts a backend
  for it, stops it again; a database it created itself is also dropped, one that already existed is
  left in place)
- `./test_backend_migrations.sh` (real migrations; starts a throwaway database or uses
  `TUD_MIGRATION_TEST_DATABASE_URL`)
- `./test_frontend.sh` (unit tests, architecture check and type check; no services)
- `./test_e2e.sh` (requires the dev stack started with `./run_dev_nginx_both.bash --test-db`)
- `cd frontend && npm run test:components` (static server, no backend)
- `cd frontend && npx playwright test --project=admin-chromium` (admin portal, same stack as E2E)

## Test Data Hygiene
- Integration and E2E tests create studies, participants and activities through the real API. They
  must not use the development database.
- `backend/tests/support/database_tools.py` manages the disposable test database (`url`, `reset`,
  `drop`). It derives `<development database>_test` from `TUD_DATABASE_URL`, refuses to touch the
  development database, and refuses names without "test" unless `--force` is given.
- `./test_backend_integration.sh` uses `TUD_TEST_DATABASE_URL` when set, otherwise the local
  `<development database>_test`, otherwise a throwaway PostgreSQL container.
- `./run_dev_nginx_both.bash --test-db` serves that test database; it is created, migrated and
  seeded on every start.

## Environment Notes
- Recommended local integration topology uses nginx/dev reverse proxy to mirror deployed routing.
- E2E tests require the app services to be running before invocation, started with `--test-db`.
- **Pages deploy:** `deploy_frontend_ghpages.yml` copies `frontend/src/` and `docs/` to the
  `gh-pages` branch, where GitHub Pages builds the site with Jekyll. Jekyll runs Liquid over every
  markdown file first, so a doc must wrap Liquid-looking snippets (Jinja {% raw %}`{% block %}`{% endraw %} tags, locale {% raw %}`{{placeholders}}`{% endraw %}) in Jekyll's `raw` / `endraw` tags;
  otherwise the build fails with `Liquid syntax error: Unknown tag` or the snippet silently vanishes.
  The workflow validates `docs/` before pushing, so a broken doc never reaches `gh-pages`.
