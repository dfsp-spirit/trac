#!/bin/bash
#
# Run backend integration tests in Docker container.
# Assumes the selected Docker Compose stack is already running.
#

set -e

DBMS="${1:-postgres}"

case "$DBMS" in
    postgres)
        COMPOSE_FILES=("docker-compose.dev.yml")
        ;;
    mariadb)
        COMPOSE_FILES=("docker-compose.dev.yml" "docker-compose.dev.mariadb.yml")
        ;;
    mssql)
        COMPOSE_FILES=("docker-compose.dev.yml" "docker-compose.dev.mssql.yml")
        ;;
    *)
        echo "Usage: $0 [postgres|mariadb|mssql]"
        exit 1
        ;;
esac

COMPOSE_ARGS=()
for compose_file in "${COMPOSE_FILES[@]}"; do
    if [ ! -f "$compose_file" ]; then
        echo "Error: $compose_file not found"
        exit 1
    fi
    COMPOSE_ARGS+=("-f" "$compose_file")
done

echo "Running backend INTEGRATION tests in Docker..."
echo "Selected DBMS: $DBMS"
echo "Preparing backend schema and study data..."

echo "Ensuring required services are running..."
docker compose "${COMPOSE_ARGS[@]}" up -d db backend

BACKEND_CONTAINER_ID=$(docker compose "${COMPOSE_ARGS[@]}" ps -q backend)
if [ -z "$BACKEND_CONTAINER_ID" ]; then
    echo "Error: backend container could not be resolved for selected compose stack."
    exit 1
fi

BACKEND_RUNNING=$(docker inspect -f '{{.State.Running}}' "$BACKEND_CONTAINER_ID" 2>/dev/null || true)
if [ "$BACKEND_RUNNING" != "true" ]; then
    echo "Error: service 'backend' is not running for DBMS '$DBMS'."
    echo "Recent backend logs:"
    docker compose "${COMPOSE_ARGS[@]}" logs --tail=80 backend || true
    exit 1
fi

docker compose "${COMPOSE_ARGS[@]}" exec backend uv run tud db upgrade
docker compose "${COMPOSE_ARGS[@]}" exec backend uv run tud studies import --config studies_config.json
echo "Running integration tests against backend direct endpoint: http://localhost:8000"
docker compose "${COMPOSE_ARGS[@]}" exec -e TUD_BASE_SCHEME="http://localhost:8000" backend uv run pytest tests/integration -v
