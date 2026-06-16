#!/bin/sh
#
# How to run this script reliably:
# 1) From repo root, start services in another terminal:
#      ./run_dev_nginx_both.bash
#    This starts nginx + backend and serves frontend at http://localhost:3000/report/.
# 2) Keep that terminal open while tests run.
# 3) In a second terminal, from repo root, run:
#      ./test_e2e.sh
#
# E2E tests expect frontend + backend + proxy to be available on the dev-nginx URLs.
#
# You can run individual tests via:
#
#  cd frontend/
#  npx playwright test tests/e2e/your_test_file.spec.ts
#
# and do things like run one test several times via:
#
#  npx playwright test --repeat-each=5 tests/e2e/your_test_file.spec.ts

echo "Running E2E tests"
echo "IMPORTANT: Make sure all services are running via './run_dev_nginx_both.bash' in another terminal before starting this..."

if [ ! -d "frontend/tests/e2e" ]; then
    echo "Error: This script must be run from the root directory of the project."
    exit 1
fi

cd frontend && npm run test:e2e
