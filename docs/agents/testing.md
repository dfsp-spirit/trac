# Testing & Environment Agent Documentation

## Test Suite Intent
- Backend unit tests (`backend/tests/unit/`) validate isolated backend logic.
- Backend integration tests (`backend/tests/integration/`) validate API/database behavior.
- Frontend E2E tests (`frontend/tests/e2e/`) validate complete user flows.

## Preferred Entry Commands
- `./test_backend_unit.sh`
- `./test_backend_integration.sh`
- `./test_e2e.sh`

## Environment Notes
- Recommended local integration topology uses Nginx/dev reverse proxy to mirror deployed routing.
- E2E tests require required app services to be running before invocation.
