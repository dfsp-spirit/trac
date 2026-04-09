# TRAC -- Time-Use Research Activity Collector


[![Backend Unit Tests](https://github.com/dfsp-spirit/trac/actions/workflows/backend_unit_tests.yml/badge.svg)](https://github.com/dfsp-spirit/trac/actions/workflows/backend_unit_tests.yml)
[![Backend Integration Tests](https://github.com/dfsp-spirit/trac/actions/workflows/backend_integration_tests.yml/badge.svg)](https://github.com/dfsp-spirit/trac/actions/workflows/backend_integration_tests.yml)
[![E2E Tests](https://github.com/dfsp-spirit/trac/actions/workflows/e2e_tests.yml/badge.svg)](https://github.com/dfsp-spirit/trac/actions/workflows/e2e_tests.yml)


TRAC is a web-based research software for time-use research: users can report what they did during one or more days by selecting activities and placing them on one or more timelines per day. E.g., depending on the study, there may be one timeline for 'Primary Activity', and another one for 'Secondary Activity', allowing users to report things like listening to music while riding on the subway.

The frontend is based on [github.com/andreifoldes/o-timeusediary by Andrei Tamas Foldes et al.](https://github.com/andreifoldes/o-timeusediary) but heavily adapted, and the backend was written from scratch.

When using the software in this repo, please also cite [Andrei Tamas Foldes' paper](https://doi.org/10.32797/jtur-2020-1) `Time use diary design for our times - an overview, presenting a Click-and-Drag Diary Instrument (CaDDI) for online application`.


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



