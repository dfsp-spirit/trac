# TRAC -- Time-Use Research Activity Collector


[![Backend Unit Tests](https://github.com/dfsp-spirit/trac/actions/workflows/backend_unit_tests.yml/badge.svg)](https://github.com/dfsp-spirit/trac/actions/workflows/backend_unit_tests.yml)
[![Backend Integration Tests](https://github.com/dfsp-spirit/trac/actions/workflows/backend_integration_tests.yml/badge.svg)](https://github.com/dfsp-spirit/trac/actions/workflows/backend_integration_tests.yml)
[![E2E Tests](https://github.com/dfsp-spirit/trac/actions/workflows/e2e_tests.yml/badge.svg)](https://github.com/dfsp-spirit/trac/actions/workflows/e2e_tests.yml)


TRAC is a web-based research software for time-use research: users can report what they did during one or more days by selecting activities and placing them on one or more timelines per day. E.g., depending on the study, there may be one timeline for 'Primary Activity', and another one for 'Secondary Activity', allowing users to report things like listening to music while riding on the subway.

The frontend is based on [github.com/andreifoldes/o-timeusediary by Andrei Tamas Foldes et al.](https://github.com/andreifoldes/o-timeusediary) but heavily adapted, and the backend was written from scratch.

When using the software in this repo, please also cite [Andrei Tamas Foldes' paper](https://doi.org/10.32797/jtur-2020-1) `Time use diary design for our times - an overview, presenting a Click-and-Drag Diary Instrument (CaDDI) for online application`.


## Installation Instructions

TRAC consists of three components that must be set up together:

1. **PostgreSQL database** — stores participant data and study definitions
2. **Python/FastAPI backend** — serves the REST API and the admin interface
3. **Frontend** — a static JavaScript/HTML/CSS app served by any web server


### Prerequisites

- A **PostgreSQL** server (any recent version)
- **Python 3.10+** and [`uv`](https://github.com/astral-sh/uv) for the backend
- A **web server** (e.g., nginx, Apache, Caddy) to serve the frontend static files and optionally act as a reverse proxy in front of the backend
- For production: a domain name and TLS/HTTPS (strongly recommended — see [Security](#security) below)


### 1. Database Setup

Create a dedicated PostgreSQL database and user for the application. The database schema is created automatically by the backend on first startup. You need to provide the connection details in the backend configuration (see next step).


### 2. Backend Configuration

The backend is configured via a `.env` file placed in the directory from which the backend process is started. Copy `backend/.env.example` to `backend/.env` and adjust the values:

```ini
# Database connection
TUD_DATABASE_USER=<db_user>
TUD_DATABASE_PASSWORD=<db_password>     # use a strong password
TUD_DATABASE_HOST=<db_host>             # usually 'localhost'
TUD_DATABASE_PORT=5432
TUD_DATABASE_NAME=<db_name>
TUD_DATABASE_URL=postgresql://<db_user>:<db_password>@<db_host>:5432/<db_name>

# CORS: list all origins (scheme + host + port) from which the frontend will be served
TUD_ALLOWED_ORIGINS='["https://your.domain.example.com"]'

# Admin interface credentials — use strong, unique values
TUD_API_ADMIN_USERNAME=<admin_username>
TUD_API_ADMIN_PASSWORD=<admin_password>

# Root path: set this if the backend API is served under a sub-path via a reverse proxy
# e.g., TUD_ROOTPATH=/tud_backend  when proxied at https://your.domain.example.com/tud_backend/
TUD_ROOTPATH=/
```

Install the backend into a virtual environment and start it with a WSGI server such as `uvicorn` (development) or `gunicorn` (production). The backend will automatically create the database tables and load study configuration from `studies_config.json` on first startup.


### 3. Study Configuration

Studies are defined in `backend/studies_config.json`. Each entry specifies the study name, supported languages, the days to cover, participant handling (open or invite-only via `allow_unlisted_participants`), and references to one or more activity list files (`backend/activities_*.json`). When the backend starts it registers any new studies listed in this file; existing studies are left unchanged.

Each study uses `name_short` as its technical identifier. This short name is important because it is used by the frontend configuration and in participant invitation links via the `study_name` URL parameter.

TRAC also supports study-level internationalization. In `studies_config.json`, each study defines a `default_language` and a list of `supported_languages`. Study texts such as introductions, end messages, and day labels can be provided per language. Activity lists can also be language-specific via `activities_json_files`, which maps language codes to separate `activities_*.json` files. On the frontend, the language is chosen in this order: `lang` URL parameter if present, otherwise the browser language if supported, otherwise the study's default language.

Participants access the app via an invitation link containing their unique ID. For open studies any visitor is assigned an ID automatically.

#### Participant Invitation Links

TRAC identifies participants primarily through the `pid` URL parameter together with the target study in `study_name`. A minimal invitation link therefore looks like this:

```text
https://your.domain.example.com/report/index.html?study_name=default&pid=PARTICIPANT_ID
```

Supported URL parameters include:

- `study_name`: the study short name (`name_short` in `studies_config.json`)
- `pid`: the participant identifier
- `lang`: optional language override, for example `en`, `sv`, or `de`
- `template_user`: optional participant ID whose data should be used as a template when the link is first used
- `return_url`: optional encoded URL to which the user can be sent back after completion

Examples:

```text
# Select study and participant
https://your.domain.example.com/report/index.html?study_name=default&pid=c303282d

# Also force the language shown in the frontend
https://your.domain.example.com/report/index.html?study_name=default&pid=c303282d&lang=sv

# Use another participant as a template for first-time initialization
https://your.domain.example.com/report/index.html?study_name=study1&pid=c303282d&template_user=a5sf35gh

# Return to an external system after completion
https://your.domain.example.com/report/index.html?study_name=default&pid=c303282d&return_url=https%3A%2F%2Fexample.org%2Ffinish%3Ftoken%3Dabc123
```

The `template_user` parameter is intended for cases where one participant's entries should be copied as a starting point for another participant, for example when a parent enters similar data for siblings. The `return_url` parameter should be URL-encoded before being placed into the link.


### 4. Frontend Configuration

The frontend has a single settings file: `frontend/src/settings/tud_settings.js`. The most important setting is `API_BASE_URL`, which must point to the backend API:

```js
const TUD_SETTINGS = {
    // URL of the backend API as seen from the user's browser.
    // If the backend is proxied at a sub-path, include that path here.
    API_BASE_URL: 'https://your.domain.example.com/tud_backend/api',

    // Short name of the study to load by default (must match 'name_short' in studies_config.json)
    DEFAULT_STUDY_NAME: 'default',

    // Whether to show navigation buttons for previous days
    SHOW_PREVIOUS_DAYS_BUTTONS: true
};
```

No build step is required. Once this file is configured, the entire `frontend/src/` directory can be deployed as-is to any static file server.


### 5. Web Server and Reverse Proxy

In a typical production setup a single web server (or reverse proxy) handles all traffic:

- Static frontend files are served directly from the `frontend/src/` directory.
- Requests to the backend API path (e.g., `/tud_backend/`) are forwarded to the running backend process.

Make sure the proxy passes the correct `X-Forwarded-*` headers so that the backend can construct correct URLs, and configure `TUD_ROOTPATH` and `TUD_ALLOWED_ORIGINS` accordingly.


### 6. Admin Interface

TRAC includes a small server-rendered admin interface implemented in the backend using FastAPI templates. It is separate from the participant frontend and is intended for researchers or administrators who need to inspect studies, manage participants, and export collected data.

Access is protected with HTTP Basic Auth using the credentials configured in the backend `.env` file via `TUD_API_ADMIN_USERNAME` and `TUD_API_ADMIN_PASSWORD`.

The main entry point is:

```text
https://your.domain.example.com/<TUD_ROOTPATH>/admin
```

For example, if `TUD_ROOTPATH=/tud_backend`, the admin overview page will be available at:

```text
https://your.domain.example.com/tud_backend/admin
```

Because the admin interface is part of the backend application, it must be exposed through the same reverse-proxy setup as the API. As with the rest of the backend, it should only be made available over HTTPS.


### 7. API and Automation

The backend exposes a REST API and also serves FastAPI's live interactive API documentation. A convenient entry point is:

```text
https://your.domain.example.com/<TUD_ROOTPATH>/api/docs
```

This redirects to the automatically generated FastAPI docs for the running backend instance.

Some endpoints are especially useful for automation, monitoring, backup, and integration with other systems:

- `GET /api/health` checks that the backend is running and can reach the database. This is useful for uptime monitoring and health checks.
- `GET /api/admin/export/studies-runtime-config` exports the full runtime study configuration together with participant assignments and logged activities. This is useful for backups and server-to-server synchronization.
- `GET /api/admin/export/{study_name_short}/activities` exports all recorded activities for one study in CSV or JSON, which is useful for data pipelines and integration with external systems.
- `POST /api/admin/studies/{study_name_short}/assign-participants` assigns one or more participants to a study and can create participant records when needed, which is useful for automated invitation workflows.

The `/api/admin/...` endpoints are protected with the same admin authentication as the admin interface.


### Security

Because TRAC collects research data from study participants over the internet, you **must** secure the deployment:

- **Use HTTPS** for all traffic. Never run the app over plain HTTP in production.
- **Set strong, unique passwords** for the database user and the admin interface.
- **Restrict `TUD_ALLOWED_ORIGINS`** to only the exact origin(s) from which the frontend is served.
- **Protect the admin interface** — it is served at `<TUD_ROOTPATH>/admin/` and is protected by HTTP Basic Auth. Make sure the admin password is strong and that it is only transmitted over HTTPS.
- Follow general web-server hardening best practices (secure headers, rate limiting, firewall rules, etc.) appropriate for your server software and environment.


## Developer Documentation

### Development Setup

Make sure you have `git`, `uv`, `postgresql` and `nginx`. Python comes with every Linux distribution, so you should not need to install it. This will get you everything you need under Ubuntu 24 LTS:

```bash
sudo apt install nginx git postgresql
curl -LsSf https://astral.sh/uv/install.sh | sh  # get uv for your user
```

Clone repo and change into it:

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

You can now connect to [http://localhost:3000](http://localhost:3000) to access nginx. The default nginx page will show details on how to access the frontend, admin interface, and API.

### Running the tests locally

You also have everything installed run the backend unit and integration tests if you followed the development setup instructions above.

If you want to run the E2E tests, you will need to have [node.js](https://nodejs.org/en/download) installed. Then install playwright and headless browsers to run the tests in:

```bash
cd frontend/
npm install
npx playwright install --with-deps chromium firefox webkit
```

Now that you have all test dependencies, you can run the tests:

* Unit tests do not require the services to be running. To run them from the repo root: `./test_backend_unit.sh`
* Integration tests require the backend to be running. To run them from the repo root: `./test_backend_integration.sh`
* The E2E tests require the frontend and backend to be setup correctly, and all services to be running. To run them from the repo root: `./test_e2e.sh`



### Howto make a release

* record changes in `CHANGES` file
* bump version of backend in `backend/src/o-timeusediary_backend/__init__.py`
* bump version of frontend in `frontend/src/js/constants.js`
* create commit with the mentioned changes, with a commit message like 'Bump version to and log changes for v0.x.y'
* tag the commit with the new version_ `git tag v0.x.y <hash>`
* run `git push --tags` to publish
* in the `backend/` dir, run `uv build` to create the wheel artefact
* log into Github account, draft a new release based on the tag, copy change notes from CHANGES in there and attach the wheel artefact



