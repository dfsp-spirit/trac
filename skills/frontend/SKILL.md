# Frontend Skill

Use this skill to implement or change user-facing behavior in the TRAC participant frontend.

## Use When
- The request touches UI behavior, timeline interactions, locale rendering, or frontend API calls.
- The request changes files under `frontend/src/`.

## Do Not Use For
- Backend API logic, database schema/model work, or CI workflow changes.
- Running tests only (use dedicated test skills).

## Required Workflow
1. Locate impacted files in `frontend/src/` (`js/data/`, `js/domain/`, `js/state/`, `js/ui/`, `styles/`, `locales/`).
2. Keep implementation in plain ES modules and CSS. Do not add React/Vite/Webpack or a runtime build step.
3. Respect the layer rules enforced by `frontend/tools/check-architecture.mjs`: only `js/data` may call `fetch`, and imports may only point downwards.
4. If changing visible text, update all three locale files in `frontend/src/locales/`.
5. Use `frontend/src/js/config.js` for deployment values (`apiBaseUrl`, locale URL, study defaults); never hard-code a host.
6. Validate with `./test_frontend.sh` (unit tests, architecture check, type check) and, for flows, `./test_e2e.sh` against the dev stack.

## Quality Checks
- Time entries stay on the study's `time_step_minutes` grid and respect `min_duration_minutes`.
- Language fallback and locale keys remain intact.
- No bundler or tooling change is introduced into the delivery path.
