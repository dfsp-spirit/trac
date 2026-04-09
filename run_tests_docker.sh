#!/bin/bash
#
# Run tests in Docker containers against the running docker-compose stack.
# Assumes docker-compose.dev.yml is already running with: docker compose -f docker-compose.dev.yml up -d --build
#
# Usage:
#   ./run_tests_docker.sh              # run all tests
#   ./run_tests_docker.sh unit         # run backend unit tests only
#   ./run_tests_docker.sh integration  # run backend integration tests only
#   ./run_tests_docker.sh e2e          # run E2E tests only (inside Docker)
#

set -e

COMPOSE_FILE="docker-compose.dev.yml"
BACKEND_SERVICE="backend"

# Check if compose file exists
if [ ! -f "$COMPOSE_FILE" ]; then
    echo "Error: $COMPOSE_FILE not found in current directory"
    exit 1
fi

# Determine which tests to run
TEST_TYPE="${1:-all}"

echo "======================================"
echo "Running TRAC tests in Docker containers"
echo "======================================"
echo ""

# Function to check if containers are running
check_containers() {
    BACKEND_STATE=$(docker compose -f "$COMPOSE_FILE" ps "$BACKEND_SERVICE" -q 2>/dev/null || echo "")
    if [ -z "$BACKEND_STATE" ]; then
        echo "❌ Docker containers are not running!"
        echo ""
        echo "Start the containers with:"
        echo "  docker compose -f $COMPOSE_FILE up -d --build"
        exit 1
    fi
}

# Run backend unit tests
run_unit_tests() {
    echo "Running backend UNIT tests..."
    echo "---"
    check_containers
    docker compose -f "$COMPOSE_FILE" exec "$BACKEND_SERVICE" uv run pytest tests/unit -v
    echo ""
}

# Run backend integration tests
run_integration_tests() {
    echo "Running backend INTEGRATION tests..."
    echo "---"
    check_containers
    docker compose -f "$COMPOSE_FILE" exec "$BACKEND_SERVICE" uv run pytest tests/integration -v
    echo ""
}

# Run E2E tests
run_e2e_tests() {
    echo "Running E2E tests..."
    echo "---"
    check_containers
    docker compose --profile e2e -f "$COMPOSE_FILE" run --rm e2e
    echo ""
}

case "$TEST_TYPE" in
    unit)
        run_unit_tests
        ;;
    integration)
        run_integration_tests
        ;;
    e2e)
        run_e2e_tests
        ;;
    all)
        run_unit_tests
        run_integration_tests
        echo "⚠️  Skipping E2E tests (run with 'run_tests_docker.sh e2e' separately)"
        echo "   This keeps backend test runs fast while still supporting full Docker E2E runs"
        ;;
    *)
        echo "Usage: $0 [unit|integration|e2e|all]"
        echo ""
        echo "Examples:"
        echo "  $0 unit          # Backend unit tests"
        echo "  $0 integration   # Backend integration tests"
        echo "  $0 e2e           # E2E tests"
        echo "  $0 all           # All backend tests (not E2E)"
        echo "  $0               # All backend tests (default)"
        exit 1
        ;;
esac

echo "✅ Tests completed successfully!"
