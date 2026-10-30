#!/bin/sh
#
# How to run this script reliably:
# 1) From repo root, start services in another terminal, using the throwaway test
#    database so that the run leaves nothing behind in the development data:
#      ./run_dev_nginx_both.bash --test-db
#    This starts nginx + backend and serves the frontend at http://localhost:3000/report/.
#    The script creates/migrates/seeds the test database before launching the backend.
# 2) Keep that terminal open while tests run.
# 3) In a second terminal, from repo root, run:
#      ./test_e2e.sh
#
# E2E tests expect frontend + backend + proxy to be available on the dev-nginx URLs.
# Without --test-db they run against the development database and leave studies and
# participants behind; this script warns when that is the case.
#
# You can run individual tests via:
#
#    cd frontend/
#    npx playwright test tests/e2e/your_test_file.spec.ts
#
# and do things like run one test several times via:
#
#    npx playwright test --repeat-each=5 tests/e2e/your_test_file.spec.ts
#
# or you can run all tests, but only in one specific browser (as opposed to all browsers configured in playwright.config.ts):
#
#    npx playwright test --project=chromium

echo "Running E2E tests"

if [ ! -d "frontend/tests/e2e" ]; then
    echo "Error: This script must be run from the root directory of the project."
    exit 1
fi

# The running stack writes its settings to backend/.env; report which database it uses.
if [ -f "backend/.env" ]; then
    ACTIVE_DB=$(grep -E '^TUD_DATABASE_NAME=' backend/.env | tail -1 | cut -d= -f2-)
    case "$ACTIVE_DB" in
        *test*)
            echo "Using database '$ACTIVE_DB'."
            ;;
        *)
            echo "WARNING: the running stack uses database '$ACTIVE_DB', which is not a test database."
            echo "         Start it with './run_dev_nginx_both.bash --test-db' to keep test data"
            echo "         out of the development database."
            ;;
    esac
fi

cd frontend && npm run test:e2e
