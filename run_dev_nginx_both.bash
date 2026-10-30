#!/bin/bash
#
# Run this script to start nginx with the development configuration that serves both the frontend and backend.
# Also runs the FastAPI backend on port 8000. Make sure to have nginx installed.
#
# To use this script, simply run it from the terminal. It will start nginx in the background and then run the FastAPI backend in the foreground.


## Start nginx with the development configuration in background

## save current directory to return to it later
CURRENT_DIR=$(pwd)

# --test-db: serve a throwaway test database instead of the development one, so
# running the test suites does not leave studies and participants in the dev
# data. The test database is created, migrated and seeded on every start.
USE_TEST_DB=false
case "${1:-}" in
    --test-db) USE_TEST_DB=true ;;
    "") ;;
    *)
        echo "Unknown option '$1'."
        echo "Usage: $0 [--test-db]"
        exit 1
        ;;
esac

# ── Pre-flight: clean up leftover processes from previous runs ──
# Kill old nginx started by this script (user-level, no root needed)
if [ -f "$HOME/nginx-dev.pid" ]; then
    OLD_NGINX_PID=$(cat "$HOME/nginx-dev.pid" 2>/dev/null)
    if [ -n "$OLD_NGINX_PID" ] && kill -0 "$OLD_NGINX_PID" 2>/dev/null; then
        echo "  Stopping old nginx (PID $OLD_NGINX_PID)..."
        kill -QUIT "$OLD_NGINX_PID" 2>/dev/null
        sleep 1
    fi
    rm -f "$HOME/nginx-dev.pid"
fi

# Kill any process still holding port 8000 (stale gunicorn/uvicorn workers)
if ss -tlnp | grep -q ':8000 '; then
    echo "  Port 8000 in use — killing old backend process..."
    fuser -k 8000/tcp 2>/dev/null
    sleep 1
fi

# Kill any process still holding port 3000 (stale nginx not tracked by pidfile)
if ss -tlnp | grep -q ':3000 '; then
    echo "  Port 3000 in use — killing old nginx..."
    fuser -k 3000/tcp 2>/dev/null
    sleep 1
fi
# ── End pre-flight ──

NGINX_CONF_DIR="./dev_tools/local_nginx/webserver_config/"

if [ ! -d "$NGINX_CONF_DIR" ]; then
    echo -e "ERROR: nginx configuration directory not found at '$NGINX_CONF_DIR'. Current working directory: $(pwd)"
    exit 1
fi

cd "$NGINX_CONF_DIR" || { echo -e "ERROR: Failed to change directory to '$NGINX_CONF_DIR'"; exit 1; }


GIT_FRONTEND_REPO_PATH=$CURRENT_DIR/frontend
GIT_BACKEND_REPO_PATH=$CURRENT_DIR/backend

# Create the nginx configuration file from the template, replacing 'USERHOME' with the actual home directory
NGINX_CONF_FILE="./dev.nginx.conf"
./replace_home.sh dev.nginx.conf.template "$NGINX_CONF_FILE" "$GIT_FRONTEND_REPO_PATH" "$GIT_BACKEND_REPO_PATH" || { echo -e "ERROR: Failed to create nginx configuration file from template"; exit 1; }

sed -i '1i# THIS FILE IS AUTO-GENERATED FROM THE TEMPLATE ON EACH START. DO NOT EDIT!' "$NGINX_CONF_FILE"

if [ ! -f "$NGINX_CONF_FILE" ]; then
    echo -e "ERROR: nginx configuration file not found at $NGINX_CONF_FILE in current working directory $(pwd)"
    exit 1
fi

FULL_NGINX_CONF_PATH="$(pwd)/$NGINX_CONF_FILE" # nginx requires an absolute path to the configuration file, or changing its config dir.
mkdir -p "$HOME/nginx-client-body-temp" || { echo -e "ERROR: Failed to create nginx client body temp directory"; exit 1; }

# Copy frontend config files: the old app's settings and the rewrite's config.
# Both are tracked files, so they are restored from git when this script exits.
cp "$CURRENT_DIR/dev_tools/local_nginx/frontend_settings/tud_settings.dev-nginx.js" "$CURRENT_DIR/frontend/src/settings/tud_settings.js" || { echo -e "ERROR: Failed to copy frontend config file"; exit 1; }
cp "$CURRENT_DIR/dev_tools/local_nginx/frontend_settings/config.new.dev-nginx.js" "$CURRENT_DIR/frontend_new/src/js/config.js" || { echo -e "ERROR: Failed to copy the rewrite's config file"; exit 1; }

# Copy backend config .env file
cp "$CURRENT_DIR/dev_tools/local_nginx/backend_settings/.env.dev-nginx" "$CURRENT_DIR/backend/.env" || { echo -e "ERROR: Failed to copy backend config file"; exit 1; }

# ── Same-wifi testing: derive this machine's address into the backend config ──
# Two values cannot be host-agnostic. CORS has to allow the origin the phone
# uses, and the redirects the backend sends (thank-you page, inactivity timeout,
# tasks) have to lead somewhere the phone can reach - 'localhost' there means
# the phone itself. Both are derived here rather than committed, so the repo
# carries no address and another machine, or this one on another network, needs
# no edits. Override the detection with:
#   TUD_DEV_LAN_IP=10.0.0.5 ./run_dev_nginx_both.bash
LAN_IP="${TUD_DEV_LAN_IP:-$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')}"
if [ -z "$LAN_IP" ]; then
    # No default route (offline machine): take the first global address instead.
    LAN_IP=$(ip -4 -o addr show scope global 2>/dev/null | awk '{split($4, a, "/"); print a[1]}' | head -1)
fi

if [ -n "$LAN_IP" ]; then
    sed -i \
        -e "s|^TUD_ALLOWED_ORIGINS=.*|TUD_ALLOWED_ORIGINS='[\"http://localhost:3000\", \"http://127.0.0.1:3000\", \"http://$LAN_IP:3000\", \"http://$LAN_IP\"]'|" \
        -e "s|^TUD_FRONTEND_URL=.*|TUD_FRONTEND_URL=http://$LAN_IP:3000/report/|" \
        "$CURRENT_DIR/backend/.env" || { echo -e "ERROR: Failed to write the LAN address into backend/.env"; exit 1; }
    PHONE_URL="http://$LAN_IP:3000/report/index.html?study_name=default&lang=de"
else
    PHONE_URL=""
fi

# Point the backend at the disposable test database on request. The override has
# to come after the LAN rewrite above, and the last assignment wins in .env.
TEST_DATABASE_NAME=""
if [ "$USE_TEST_DB" = true ]; then
    TEST_DATABASE_URL=$(cd "$CURRENT_DIR/backend" && uv run python tests/support/database_tools.py url) \
        || { echo -e "ERROR: Failed to resolve the test database URL"; exit 1; }
    TEST_DATABASE_NAME=$(printf '%s' "$TEST_DATABASE_URL" | sed 's#.*/##')
    {
        echo ""
        echo "# --test-db: the throwaway database the test suites run against."
        echo "TUD_DATABASE_NAME=$TEST_DATABASE_NAME"
        echo "TUD_DATABASE_URL=$TEST_DATABASE_URL"
    } >> "$CURRENT_DIR/backend/.env" || { echo -e "ERROR: Failed to write the test database into backend/.env"; exit 1; }
    echo -e "INFO Using the test database '$TEST_DATABASE_NAME' instead of the development database."
fi

# Prepare backend DB state explicitly before starting the API server.
cd "$CURRENT_DIR/backend/" || { echo -e "ERROR: Failed to change to backend directory"; exit 1; }
if [ "$USE_TEST_DB" = true ]; then
    uv run python tests/support/database_tools.py reset || { echo -e "ERROR: Failed to prepare the test database. It must exist (or be creatable) - see the README section on running the tests."; exit 1; }
else
    uv run tud db upgrade || { echo -e "ERROR: Failed to apply DB migrations"; exit 1; }
    uv run tud studies import --config studies_config.json --config studies_config_new.json || { echo -e "ERROR: Failed to import studies config"; exit 1; }
fi

# The deployment configs above are copies over tracked files; put the repo
# versions back so a global `git add -A` cannot commit this machine's paths.
restore_tracked_configs() {
    if git -C "$CURRENT_DIR" rev-parse --is-inside-work-tree > /dev/null 2>&1; then
        git -C "$CURRENT_DIR" checkout -- \
            frontend/src/settings/tud_settings.js \
            frontend_new/src/js/config.js 2>/dev/null \
            && echo "Restored frontend/src/settings/tud_settings.js and frontend_new/src/js/config.js"
    fi
}

cleanup() {
    echo -e "\n Shutting down nginx service..."

    kill -QUIT $(cat $HOME/nginx-dev.pid) && echo "Cleanup complete. Goodbye!" || echo "WARNING: Failed to stop nginx. You may need to stop it manually with 'kill -QUIT \$(cat \$HOME/nginx-dev.pid)'"
    restore_tracked_configs
}

# Set up trap for Ctrl+C
trap cleanup SIGINT SIGTERM

nginx -c "$FULL_NGINX_CONF_PATH"

if [ $? -eq 0 ]; then
    echo -e "Started nginx successfully"
    echo -e "  old frontend:  http://localhost:3000/report/"
    echo -e "  rewrite:       http://localhost:3000/report-new/"
    echo -e "  pilot study:   http://localhost:3000/report-new/?study=pilot_mpiae_01_open&pid=test01"
    echo -e "  backend API:   http://localhost:3000/tud_backend/api"
    if [ "$USE_TEST_DB" = true ]; then
        echo -e "  database:      $TEST_DATABASE_NAME (throwaway test database)"
    fi
    if [ -n "$PHONE_URL" ]; then
        echo -e "INFO Testing from a phone on the same wifi: $PHONE_URL"
    else
        echo -e "INFO No LAN address detected - this machine's address only (http://localhost:3000/report/)."
    fi
    echo -e "INFO nginx is running in the background with configuration from $FULL_NGINX_CONF_PATH"
    echo -e "INFO Press CTRL+C to stop the FastAPI backend, and then run 'kill -QUIT \$(cat \$HOME/nginx-dev.pid)' to stop nginx"
else
    echo -e "ERROR: Failed to start nginx"
    exit 1
fi


## Start the FastAPI backend in the foreground
# note that --reload requires the python package 'watchdog' to be installed, which is included in the dev dependencies.

cd "$CURRENT_DIR/backend/" && uv run gunicorn --reload -c ../deployment/gunicorn_conf.dev.py o_timeusediary_backend.api:app || { echo -e " Failed to start FastAPI backend"; exit 1; }
restore_tracked_configs


