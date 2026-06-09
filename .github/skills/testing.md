# Testing & Environment Agent Skills

## Testing Suites & Guidelines
- **Backend pytest Suites**:
  - *Unit Tests* (`backend/tests/unit/`): Lightweight validations. Must **never** require a running database, backend, or frontend server.
  - *Integration Tests* (`backend/tests/integration/`): Tests database, models, and endpoints. Must **never** require a running frontend.
- **Frontend Playwright E2E**:
  - *E2E Tests* (`frontend/tests/e2e/`): Verifies end-to-end flows. Requires both a running backend server and frontend static instance.
- **Test Runners**: Utility scripts at the repository root speed up execution (e.g. `test_backend_unit.sh`, `test_backend_integration.sh`, `test_e2e.sh`).

## Development Environments
- **Local Nginx Setup (Recommended)**: Utilizes `run_dev_nginx_both.bash` to load Nginx as a local reverse proxy on port 3000. Mimics production path configurations seamlessly and helps catch link or template address errors early.
- **Minimal Dev Setup (Alternative)**: Running standalone `run_backend_dev_minimal.sh` (FastAPI at `localhost:8000`) and `run_frontend_dev_minimal.sh` (Python HTTP server at `localhost:3000`). Not recommended for staging-replica checks.
