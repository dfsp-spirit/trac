# Testing & Environment Agent Documentation

## Test Suite Intent
- Backend unit tests (`backend/tests/unit/`) validate isolated backend logic.
- Backend integration tests (`backend/tests/integration/`) validate API/database behavior.
- Frontend E2E tests (`frontend/tests/e2e/`) validate complete user flows.

## Guard Specs (cheap, non-flow checks)
- `frontend/tests/e2e/participant_pages.js` lists the participant pages; the static-asset, accessibility and mobile guards all sweep it.
- `no_broken_static_requests.spec.js` fails on any static request >= 400 (missing image, locale, settings, font).
- `accessibility.spec.js` runs axe-core via `@axe-core/playwright` (dev dependency) over each page plus the activity dialogs and fails on any WCAG A/AA violation; animations are frozen before analysis so colour is measured on a settled page.
- `keyboard_accessibility.spec.js` and `mobile_layout.spec.js` cover Tab/Escape focus behaviour and the 390x844 phone layout (no sideways scrolling, >= 24x24 targets, touch placement).
- When adding such a guard, prove it fails with the fix reverted before trusting it.

## Preferred Entry Commands
- `./test_backend_unit.sh`
- `./test_backend_integration.sh`
- `./test_e2e.sh`

## Environment Notes
- Recommended local integration topology uses Nginx/dev reverse proxy to mirror deployed routing.
- E2E tests require required app services to be running before invocation.
