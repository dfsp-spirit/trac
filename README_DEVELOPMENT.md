
## TRAC Developer Documentation

### Development Without Docker

Make sure you have `git`, `uv`, `postgresql` and `nginx`. Python comes with every Linux distribution, so you should not need to install it. This will get you everything you need under Ubuntu 24 LTS:

```bash
sudo apt install nginx git postgresql
curl -LsSf https://astral.sh/uv/install.sh | sh  # get uv for your user
```



#### Important: Large Request Handling for non-root users in local development

TRAC supports exporting and importing study configurations with embedded activity definitions, which can result in large HTTP POST request bodies (typically 10-50 KB depending on the number of activities and languages supported).

For nginx, the size can become so large that it writes requests to a temp dir instead of relying on in-memory handling. This is no problem in production, as a dir for that is configured by default, but for the dev scripts, where you run nginx without root priviledges as your own user, that system directory is not writeable by your user. You will therefor need to:

- **nginx**: Configure a `client_body_temp_path` directive in your nginx configuration to a directory where the nginx process has write permissions. See the [developer documentation](dev_tools/local_nginx/README.md) for details.
- **Apache**: Ensure the `LimitRequestBody` directive is set high enough (default 10 MB should be sufficient).
- **Other web servers**: Verify that large POST body handling is configured appropriately for your setup.

If you encounter HTTP 413 (Payload Too Large) or 500 errors when importing study configurations, the root cause is typically insufficient request body handling configuration in your web server.

As mentioned before, this should NOT be need for production.

Okay, let us continue:

Clone the repo and change into it:

```bash
git clone https://github.com/dfsp-spirit/trac
cd trac/
```

There is no need to do anything for the frontend, it is ready to run. So let's create an empty, new database for the app:

```bash
cp dev_tools/local_nginx/backend_settings/.env.dev-nginx backend/.env
./database/create_tud_db.sh backend/.env
```

Now let's install the backend dependencies first and run the unit tests:

```bash
cd backend/

# Create virtual environment and install dependencies
uv sync --dev

# Run backend unit tests to verify setup
uv run pytest
```

Great, now it is time to run everything:

```bash
cd ..     # back to repo root (`trac` directory)
./run_dev_nginx_both.bash
```

The web server is configured for hot reload, so you are good to edit away and instantly see the changes. You only need to restart the backend if you add a new endpoint or after database schema changes.

You can verify that all services are operational by running the integration tests in a new terminal:
```bash
# in the repo root (`trac` directory)
./test_backend_integration.sh
```

We recommend to also run the E2E tests, see next section.

You can now connect to [http://localhost:3000](http://localhost:3000) to access nginx. The default nginx page will show details on how to access the frontend, admin interface, and API. If you did not change the default configuration, the URLs are:

* frontend for default study: [/report/index.html](http://localhost:3000/report/index.html)
* backend (requires admin credentials from your backend/.env file): [/tud_backend/admin](http://localhost:3000/tud_backend/admin)
* API: [/tud_backend/api](http://localhost:3000/tud_backend/api)
* API docs: [/tud_backend/docs](http://localhost:3000/tud_backend/docs)

#### Running Tests Locally (Without Docker)

Now that you have all local test dependencies, you can run tests directly from your host machine:

- Unit tests do not require services to be running: `./test_backend_unit.sh`
- Integration tests require the backend and database to be running: `./test_backend_integration.sh`
- E2E tests require frontend and backend to be running: `./test_e2e.sh`

If you want to run E2E tests, install Node.js and Playwright once:

```bash
cd frontend/
npm install
npx playwright install --with-deps chromium firefox webkit
```

Note: If you get errors on `npm install`, e.g. about unsupported engine, the most likely reason is an outdated `npm` installation. We highly recommend to install [nvm](https://github.com/nvm-sh/nvm), then run `nvm install node` to get the latest stable node/npm version.

### Development With Docker Compose

If you prefer a container-based development setup, this repo also includes `docker-compose.dev.yml`. It starts three services:

- PostgreSQL database
- backend container with the local `backend/` directory mounted for live code reload
- nginx container with the local `frontend/src/` directory mounted and proxied under `/report/`

This setup mirrors the normal local nginx development layout:

- frontend: `http://localhost:3000/report/`
- backend via reverse proxy: `http://localhost:3000/tud_backend/`
- backend direct port: `http://localhost:8000/`
- admin interface: `http://localhost:3000/tud_backend/admin`
- API docs: `http://localhost:3000/tud_backend/api/docs`

Start the stack from the repo root:

```bash
docker compose -f docker-compose.dev.yml up --build
```

Stop it again with:

```bash
docker compose -f docker-compose.dev.yml down
```

If you also want to delete the Docker volumes, including the PostgreSQL data volume, use:

```bash
docker compose -f docker-compose.dev.yml down -v
```

The compose setup uses Docker-specific config overlays from `dev_tools/docker/` and does not require you to overwrite your normal local development settings files manually.

#### Running Tests with Docker

Helper scripts are provided to run tests against the containerized stack:

```bash
# Run all backend tests (unit + integration) in Docker
./run_tests_docker.sh

# Or run specific test suites
./run_tests_docker_unit.sh          # backend unit tests only
./run_tests_docker_integration.sh   # backend integration tests only (PostgreSQL default)
./run_tests_docker_integration.sh postgres
./run_tests_docker_integration.sh mariadb
./run_tests_docker_integration.sh mssql

# Run E2E tests fully inside Docker (Playwright container)
./run_tests_docker.sh e2e
./run_tests_docker_e2e.sh
```

These scripts assume the docker-compose stack is already running.

For PostgreSQL (default):

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

For MariaDB:

```bash
docker compose -f docker-compose.dev.yml -f docker-compose.dev.mariadb.yml up -d --build
```

For Microsoft SQL Server:

```bash
docker compose -f docker-compose.dev.yml -f docker-compose.dev.mssql.yml up -d --build
```

The E2E test command uses the `e2e` service in `docker-compose.dev.yml`, which installs frontend test dependencies inside the container and runs Playwright there. This is useful when you want to avoid installing Node.js/Playwright on the host.



### How to make a Release

* record changes in `CHANGES` file
* bump version of backend in `backend/src/o-timeusediary_backend/__init__.py`
* bump version of frontend in `frontend/src/js/constants.js`
* create commit with the mentioned changes, with a commit message like 'Bump version to and log changes for v0.x.y'
* tag the commit with the new version_ `git tag v0.x.y <hash>`
* run `git push --tags` to publish
* manually run the GitHub Actions workflow `TUD Backend Integration Tests (DBMS Matrix, Manual)` and confirm postgres, mariadb, and mssql jobs pass
* in the `backend/` dir, run `uv build` to create the wheel artefact
* log into Github account, draft/publish a new release based on the tag, copy change notes from CHANGES in there and attach the wheel artefact
* API docs are attached automatically on release publish via GitHub Actions as release assets (`openapi.json`, `index.html`, and a tar.gz bundle), no manual docs upload needed

