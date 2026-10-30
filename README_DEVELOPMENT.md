
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

The test suites run against a *second*, disposable database next to it, which has
to be created once as well (your app role may not create databases). Skip this
if you only want to run unit tests:

```bash
sudo -u postgres createdb -O timeusediary_user timeusediary_db_test
```

See [Running Tests Locally](#running-tests-locally-without-docker) for what that
database is for and how the test scripts keep it separate from your dev data.

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

You can verify that all services are operational by opening the frontend URLs below, or by running the E2E tests in a new terminal:
```bash
# in the repo root (`trac` directory)
./test_e2e.sh
```

`./test_backend_integration.sh` is *not* a check of the running stack: it starts a
backend of its own against a disposable database (see "Running Tests Locally").

We recommend to also run the E2E tests, see next section.

You can now connect to [http://localhost:3000](http://localhost:3000) to access nginx. The default nginx page will show details on how to access the frontend, admin interface, and API. If you did not change the default configuration, the URLs are:

* frontend for default study: [/report/index.html](http://localhost:3000/report/index.html)
* backend (requires admin credentials from your backend/.env file): [/tud_backend/admin](http://localhost:3000/tud_backend/admin)
* API: [/tud_backend/api](http://localhost:3000/tud_backend/api)
* API docs: [/tud_backend/docs](http://localhost:3000/tud_backend/docs)

#### Testing from a Phone (Same Wifi)

`localhost` is useless on a phone - there it means the phone itself. Use this
machine's address on your wifi instead (`ip -br -4 addr show` shows it; on this
box it is `192.168.178.47`):

    http://192.168.178.47:3000/report/index.html?study_name=default&lang=de

That works as it is, for four reasons:

* The dev nginx `listen 3000;` has no host part, so it accepts connections on
  every interface, not just loopback.
* The API is reached **same-origin**: `tud_settings.dev-nginx.js` uses the
  relative base `/tud_backend/api`, so the page talks to whichever host it was
  loaded from and nginx proxies `/tud_backend/` to `127.0.0.1:8000`. (An
  absolute `http://localhost:8000/...` would point the phone at itself.) The
  backend itself keeps listening on loopback only, which is why nginx is the
  single entry point.
* `run_dev_nginx_both.bash` derives this machine's LAN address on every start and
  writes it into the generated `backend/.env`: it is added to
  `TUD_ALLOWED_ORIGINS` (so direct API use from that origin is allowed) and it
  becomes `TUD_FRONTEND_URL`, because the backend's redirects (thank-you page,
  inactivity timeout, external tasks) have to lead somewhere the phone can
  reach. The script prints the phone URL when it starts.

The address is not stored in the repo. `run_dev_nginx_both.bash` detects it on
every start (the interface of the default route, falling back to the first global
address when offline) and writes it into the generated `backend/.env`, then
prints the phone URL. Another machine, or this one on a different network, needs
no edits at all. If the detection picks the wrong interface, override it:

```bash
TUD_DEV_LAN_IP=10.0.0.5 ./run_dev_nginx_both.bash
```

Note that `frontend/src/settings/tud_settings.js` and `backend/.env` are copies
of the files in `dev_tools/local_nginx/`: `run_dev_nginx_both.bash` overwrites
them on every start, so edit the sources there, not the copies. Everything that
is *not* host-specific - the frontend settings, the nginx template - stays
committed and unchanged across networks, so a second configuration directory is
not needed.

The test suite can be pointed at the same origin, which checks a flow exactly as
a phone would see it (relative URLs, real host names, no localhost shortcut):

```bash
cd frontend/
PLAYWRIGHT_BASE_URL=http://192.168.178.47:3000/report/ npx playwright test --project=chromium tests/e2e/mobile_context_bar.spec.js
```

The page answering on port 80 is **not** TRAC. The nginx package installs a
system service (`systemctl status nginx`, `/etc/nginx/sites-enabled/default`)
that serves the distribution's default "Welcome to nginx" page on port 80; the
dev nginx is a second, user-level instance started by `run_dev_nginx_both.bash`
on port 3000. To serve TRAC on the bare address instead - no `:3000`, and no
separate server for it - run the following yourself (it needs root):

```bash
sudo tee /etc/nginx/sites-available/trac-dev >/dev/null <<'EOF'
server {
    listen 80;
    server_name 192.168.178.47;

    location /report/      { proxy_pass http://127.0.0.1:3000; }
    location /tud_backend/ { proxy_pass http://127.0.0.1:3000; }
}
EOF
sudo ln -sf /etc/nginx/sites-available/trac-dev /etc/nginx/sites-enabled/trac-dev
sudo rm -f /etc/nginx/sites-enabled/default     # this is the "Welcome to nginx" page
sudo nginx -t && sudo systemctl reload nginx
```

After that `http://192.168.178.47/report/index.html` works without the port, and
the two LAN entries *without* `:3000` in `TUD_ALLOWED_ORIGINS` and
`TUD_FRONTEND_URL` become the relevant ones.

A study whose data-collection window has passed answers with 403
(`study_unavailable`) and the participant sees the "study paused" message, which
is easy to mistake for a broken phone setup. Worth knowing: `tud studies import`
(part of the dev script) only *creates* studies, so a study whose window changed
after the first import keeps its old dates in the `studies` table - the config
file is not the only source of truth.

#### Running Tests Locally (Without Docker)

Now that you have all local test dependencies, you can run tests directly from your host machine:

- Unit tests do not require services to be running: `./test_backend_unit.sh`
- Integration tests bring their own disposable database (see below): `./test_backend_integration.sh`
- Migration tests run the real Alembic migrations on a throwaway database (drops it again) or on `TUD_MIGRATION_TEST_DATABASE_URL`: `./test_backend_migrations.sh`
- E2E tests require frontend and backend to be running, started against the test database: `./test_e2e.sh`
- The rewrite's own E2E suite has a separate runner and needs the same stack: `cd frontend_new && npm run test:e2e`

##### One-time setup: the test database

The integration and E2E tests create studies, participants and activities through
the real API. They must not run against your development database, or every run
leaves that data behind. Instead they use a separate database,
`<TUD_DATABASE_NAME>_test` (i.e. `timeusediary_db_test` for the default setup),
on the same server.

The app's database role is not allowed to create databases, so create it **once**
as a PostgreSQL administrator. From the repo root:

```bash
sudo -u postgres createdb -O timeusediary_user timeusediary_db_test
```

Replace the owner with your `TUD_DATABASE_USER` (see `backend/.env`) if you
changed it. Creating the schema, wiping it and importing the fixture studies
happens automatically on every test run, so you never have to touch this
database again.

Check that it is set up correctly:

```bash
cd backend/
uv run python tests/support/database_tools.py url      # prints the test database URL
uv run python tests/support/database_tools.py reset    # create schema + fixture studies
```

The tool refuses to operate on the database in `TUD_DATABASE_URL`, and on any
name that does not contain `test` (override with `--force`). Set
`TUD_TEST_DATABASE_URL` to use a different, existing throwaway database; it is
then never created or dropped by the tooling.

`./test_backend_integration.sh` uses that database; it only drops a database it
created itself in the same run, so the one you created by hand stays for the next
run. Without a usable local database it falls back to a throwaway PostgreSQL
container (needs docker). For E2E tests, start the dev stack with the test
database instead of the development one:

```bash
./run_dev_nginx_both.bash --test-db     # serves <TUD_DATABASE_NAME>_test
./test_e2e.sh                           # in a second terminal
```

`./test_e2e.sh` warns if the running stack uses a database whose name does not
contain `test`.

If you want to run E2E tests, install Node.js and Playwright once:

```bash
cd frontend/
npm install
npx playwright install --with-deps chromium firefox webkit
```

The rewrite (`frontend_new/`) has its own Playwright runner, chromium-only for now:

```bash
cd frontend_new/
npm ci
npx playwright install --with-deps chromium
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
* bump version of backend in `backend/src/o_timeusediary_backend/__init__.py`
* bump version of frontend in `frontend/src/js/constants.js`
* create commit with the mentioned changes, with a commit message like 'Bump version to and log changes for v0.x.y'
* manually run the GitHub Actions workflow `TUD Backend Integration Tests (DBMS Matrix, Manual)` and confirm postgres, mariadb, and mssql jobs pass
* tag the commit with the new version_ `git tag v0.x.y <hash>`
* run `git push --tags` to publish
* in the `backend/` dir, run `uv build` to create the wheel artefact
* log into Github account, draft/publish a new release based on the tag, copy change notes from CHANGES in there and attach the wheel artefact
* API docs are attached automatically on release publish via GitHub Actions as release assets (`openapi.json`, `index.html`, and a tar.gz bundle), no manual docs upload needed

