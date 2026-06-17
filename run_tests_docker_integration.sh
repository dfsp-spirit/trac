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
    *)
        echo "Usage: $0 [postgres|mariadb]"
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

if [ "$DBMS" = "mariadb" ]; then
    echo "Installing MariaDB driver inside backend container (.venv)..."
    docker compose "${COMPOSE_ARGS[@]}" exec backend uv pip install "pymysql>=1.1.0"
fi

docker compose "${COMPOSE_ARGS[@]}" exec backend uv run tud db upgrade
docker compose "${COMPOSE_ARGS[@]}" exec backend uv run tud studies import --config studies_config.json
docker compose "${COMPOSE_ARGS[@]}" exec backend uv run pytest tests/integration -v
