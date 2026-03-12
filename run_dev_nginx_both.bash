#!/bin/bash
#
# Run this script to start nginx with the development configuration that serves both the frontend and backend.
# Also runs the FastAPI backend on port 8000. Make sure to have nginx installed.
#
# To use this script, simply run it from the terminal. It will start nginx in the background and then run the FastAPI backend in the foreground.
# However, you need to properly configure the frontend and backend paths in the o-timeusediary settings files to match the nginx configuration:
#
# - In the frontend, in file <frontend-repo>/settings/tud_settings.js, set the API_BASE_URL to http://localhost/tud_backend/api
# - In the backend, in file <backen-repo>/.env, make sure to:
#        * set the TUD_ROOTPATH to /tud_backend
#        * set the TUD_FRONTEND_URL to http://localhost:3000/report/
#        * make sure that TUD_ALLOWED_ORIGINS is set to '["http://localhost:3000", "http://127.0.0.1:3000"]', the default.
#
# You can access the frontend at http://localhost:3000/report/ and the backend API at http://localhost:3000/tud_backend/api.

GIT_FRONTEND_REPO_DEFAULT_PATH="$HOME/develop_mpiae/o-timeusediary"
GIT_BACKEND_REPO_DEFAULT_PATH="$HOME/develop_mpiae/o-timeusediary-backend"

GIT_FRONTEND_REPO_PATH="$1"
if [ -z "$GIT_FRONTEND_REPO_PATH" ]; then
    if [ -d "$GIT_FRONTEND_REPO_DEFAULT_PATH" ]; then
        GIT_FRONTEND_REPO_PATH="$GIT_FRONTEND_REPO_DEFAULT_PATH"
        echo "No frontend repository path provided, using default: $GIT_FRONTEND_REPO_PATH"
    else
        echo "Error: No repository path provided and default path '$GIT_FRONTEND_REPO_DEFAULT_PATH' does not exist."
        echo "Please provide the path to a checkout of the o-timeusediary git repository as the first argument."
        echo "Usage: $0 /path/to/o-timeusediary-frontend-repository /path/to/o-timeusediary-backend-repository"
        exit 1
    fi
fi

GIT_BACKEND_REPO_PATH="$2"
if [ -z "$GIT_BACKEND_REPO_PATH" ]; then
    if [ -d "$GIT_BACKEND_REPO_DEFAULT_PATH" ]; then
        GIT_BACKEND_REPO_PATH="$GIT_BACKEND_REPO_DEFAULT_PATH"
        echo "No backend repository path provided, using default: $GIT_BACKEND_REPO_PATH"
    else
        echo "Error: No backend repository path provided and default path '$GIT_BACKEND_REPO_DEFAULT_PATH' does not exist."
        echo "Please provide the path to a checkout of the o-timeusediary-backend git repository as the second argument."
        echo "Usage: $0 /path/to/o-timeusediary-frontend-repository /path/to/o-timeusediary-backend-repository"
        exit 1
    fi
fi

## Start nginx with the development configuration in background

## save current directory to return to it later
CURRENT_DIR=$(pwd)


cd "$GIT_BACKEND_REPO_PATH" || { echo -e "ERROR: Failed to change directory to backend repository at '$GIT_BACKEND_REPO_PATH'"; exit 1; }

NGINX_CONF_DIR="./dev_tools/local_nginx/webserver_config/"

if [ ! -d "$NGINX_CONF_DIR" ]; then
    echo -e "ERROR: nginx configuration directory not found at '$NGINX_CONF_DIR', did you set the correct backend repo root directory ('$GIT_BACKEND_REPO_PATH')? Current working directory: $(pwd)"
    exit 1
fi

cd "$NGINX_CONF_DIR" || { echo -e "ERROR: Failed to change directory to '$NGINX_CONF_DIR'"; exit 1; }



# Create the nginx configuration file from the template, replacing 'USERHOME' with the actual home directory
NGINX_CONF_FILE="./dev.nginx.conf"
./replace_home.sh dev.nginx.conf.template "$NGINX_CONF_FILE" "$GIT_FRONTEND_REPO_PATH" "$GIT_BACKEND_REPO_PATH" || { echo -e "ERROR: Failed to create nginx configuration file from template"; exit 1; }

sed -i '1i# THIS FILE IS AUTO-GENERATED FROM THE TEMPLATE ON EACH START. DO NOT EDIT!' "$NGINX_CONF_FILE"

if [ ! -f "$NGINX_CONF_FILE" ]; then
    echo -e "ERROR: nginx configuration file not found at $NGINX_CONF_FILE in current working directory $(pwd)"
    exit 1
fi

FULL_NGINX_CONF_PATH="$(pwd)/$NGINX_CONF_FILE" # nginx requires an absolute path to the configuration file, or changing its config dir.

nginx -c "$FULL_NGINX_CONF_PATH"

cleanup() {
    echo -e "\n Shutting down nginx service..."

    kill -QUIT $(cat $HOME/nginx-dev.pid) && echo "Cleanup complete. Goodbye!" || echo "WARNING: Failed to stop nginx. You may need to stop it manually with 'kill -QUIT \$(cat \$HOME/nginx-dev.pid)'"
}

# Set up trap for Ctrl+C
trap cleanup SIGINT SIGTERM

if [ $? -eq 0 ]; then
    echo -e "Started nginx successfully, frontend available at http://localhost:3000/report/"
    echo -e "Backend API available at http://localhost:3000/tud_backend/api"
    echo -e "INFO nginx is running in the background with configuration from $FULL_NGINX_CONF_PATH"
    echo -e "INFO Press CTRL+C to stop the FastAPI backend, and then run 'kill -QUIT \$(cat \$HOME/nginx-dev.pid)' to stop nginx"
else
    echo -e "ERROR: Failed to start nginx"
    exit 1
fi


## Start the FastAPI backend in the foreground (you can stop it with Ctrl+C)

cd "$CURRENT_DIR" && uv run uvicorn o_timeusediary_backend.api:app --reload --host 127.0.0.1 --port 8000 || { echo -e " Failed to start FastAPI backend"; exit 1; }


