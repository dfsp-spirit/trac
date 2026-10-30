#!/bin/sh
#
# Runs the backend integration tests against a disposable database.
#
# The tests create studies, participants and activities through the real API, so
# they must not run against the development database. This script prepares a
# database of its own, starts a throwaway backend that points at it and stops it
# again afterwards. Nothing has to be running beforehand and backend/.env is not
# modified.
#
# Where the database comes from, in this order:
#   1. TUD_TEST_DATABASE_URL, when set (that database is reset and reused and is
#      never dropped by this script),
#   2. "<development database>_test" on the server from backend/.env (created by
#      this script when missing and the role may CREATE DATABASE, otherwise it
#      must have been created once by an administrator - see
#      README_DEVELOPMENT.md. Only a database this run created is dropped again),
#   3. a throwaway PostgreSQL container, started and removed by this script
#      (needs docker; used automatically when 2. is not possible).
#
# Usage (from the repository root):
#
#   ./test_backend_integration.sh                   # all integration tests
#   ./test_backend_integration.sh -k diary          # extra arguments go to pytest
#
# Environment:
#   TUD_TEST_DATABASE_URL       database to use instead of creating one
#   TUD_INTEGRATION_TEST_PORT   port for the throwaway backend (default 8010)
#   TUD_TEST_DB_PORT            host port for the throwaway database (default 55433)
#   TUD_TEST_DB_IMAGE           container image (default postgres:18)

set -e

if [ ! -d "backend/tests/integration" ]; then
    echo "Error: This script must be run from the root directory of the project."
    exit 1
fi

PORT="${TUD_INTEGRATION_TEST_PORT:-8010}"
BASE_URL="http://127.0.0.1:${PORT}"
CONTAINER_NAME="${TUD_TEST_DB_CONTAINER:-tud_integration_test_db}"
DB_IMAGE="${TUD_TEST_DB_IMAGE:-postgres:18}"
DB_PORT="${TUD_TEST_DB_PORT:-55433}"
DB_TOOL="tests/support/database_tools.py"

STARTED_CONTAINER=false
DROP_TEST_DATABASE=false
BACKEND_PID=""
TEST_DATABASE_URL=""

cd backend

cleanup() {
    if [ -n "${BACKEND_PID}" ]; then
        kill "${BACKEND_PID}" 2>/dev/null || true
        wait "${BACKEND_PID}" 2>/dev/null || true
    fi
    if [ "${STARTED_CONTAINER}" = true ]; then
        echo "Removing the throwaway database container..."
        docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    elif [ "${DROP_TEST_DATABASE}" = true ]; then
        echo "Dropping the test database..."
        uv run python "${DB_TOOL}" drop || true
    fi
}
trap cleanup EXIT INT TERM

start_container() {
    command -v docker >/dev/null 2>&1 || return 1
    docker info >/dev/null 2>&1 || return 1
    docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    echo "Starting a throwaway ${DB_IMAGE} container for the tests..."
    docker run -d --name "${CONTAINER_NAME}" \
        -e POSTGRES_USER=tud \
        -e POSTGRES_PASSWORD=tud \
        -e POSTGRES_DB=tud_test \
        -p "127.0.0.1:${DB_PORT}:5432" \
        "${DB_IMAGE}" >/dev/null || return 1
    STARTED_CONTAINER=true
    echo "Waiting for the database to accept connections..."
    i=0
    while [ "${i}" -lt 60 ]; do
        if docker exec "${CONTAINER_NAME}" pg_isready -U tud -d tud_test >/dev/null 2>&1; then
            return 0
        fi
        i=$((i + 1))
        sleep 1
    done
    return 1
}

if [ -n "${TUD_TEST_DATABASE_URL:-}" ]; then
    echo "Using the test database from TUD_TEST_DATABASE_URL."
    TEST_DATABASE_URL="${TUD_TEST_DATABASE_URL}"
    uv run python "${DB_TOOL}" reset
elif CREATED=$(uv run python "${DB_TOOL}" create); then
    TEST_DATABASE_URL=$(uv run python "${DB_TOOL}" url)
    # Only drop what this run created. A database created by hand (the app role
    # usually may not CREATE DATABASE) has to survive, or the next run would
    # have to ask for the administrator again.
    if [ "${CREATED}" = "created" ]; then
        DROP_TEST_DATABASE=true
    fi
    uv run python "${DB_TOOL}" reset
else
    echo "Could not prepare a test database on the development server."
    if start_container; then
        TEST_DATABASE_URL="postgresql://tud:tud@127.0.0.1:${DB_PORT}/tud_test"
        TUD_TEST_DATABASE_URL="${TEST_DATABASE_URL}" uv run python "${DB_TOOL}" reset
    else
        echo "Error: no test database available."
        echo "Set TUD_TEST_DATABASE_URL to an existing throwaway database, or create"
        echo "'<development database>_test' once with an administrator account (see"
        echo "README_DEVELOPMENT.md, \"One-time setup: the test database\"), or install"
        echo "docker so a throwaway container can be started."
        exit 1
    fi
fi

echo "Starting a throwaway backend on ${BASE_URL}..."
TUD_DATABASE_URL="${TEST_DATABASE_URL}" uv run uvicorn o_timeusediary_backend.api:app \
    --host 127.0.0.1 --port "${PORT}" --log-level warning &
BACKEND_PID=$!

echo "Waiting for the backend to become healthy..."
i=0
while ! curl -fsS "${BASE_URL}/api/health" >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "${i}" -ge 60 ]; then
        echo "Error: the throwaway backend did not become healthy on ${BASE_URL}."
        exit 1
    fi
    sleep 1
done

echo "Running backend integration tests"
echo "IMPORTANT: the tests run against a disposable database, not backend/.env."
TUD_DATABASE_URL="${TEST_DATABASE_URL}" TUD_BASE_SCHEME="${BASE_URL}" \
    uv run pytest tests/integration "$@"