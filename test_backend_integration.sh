#!/bin/sh
#
# How to run this script reliably:
# 1) From repo root, start services in another terminal:
#      ./run_dev_nginx_both.bash
#    This starts nginx + backend (dev config) and keeps backend running in foreground.
# 2) Keep that terminal open while tests run.
# 3) In a second terminal, from repo root, run:
#      ./test_backend_integration.sh
#
# Alternative (without nginx helper): start the backend manually from backend/ with a valid .env,
# then run this script from repo root.

echo "Running backend integration tests"
echo "IMPORTANT: Make sure the backend is running via './run_dev_nginx_both.bash' in another terminal before starting this..."

if [ ! -d "backend/tests/integration" ]; then
    echo "Error: This script must be run from the root directory of the project."
    exit 1
fi

cd backend && uv run pytest tests/integration