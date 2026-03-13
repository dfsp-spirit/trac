# o-timeusediary-backend
The fastpi backend for the custom o-timeusediary (TUD) fork of MPIAE.

[![Backend Tests](https://github.com/dfsp-spirit/o-timeusediary-backend/actions/workflows/backend_tests.yml/badge.svg)](https://github.com/dfsp-spirit/o-timeusediary-backend/actions/workflows/backend_tests.yml)

See the [mpiae_adapt branch here](https://github.com/dfsp-spirit/o-timeusediary/tree/mpiae_adapt) for the frontend.

Releases of the frontend and backend that are compatible with each other are tagged with the same version in git.


## About

This is a Python/FastAPI backend that stores data submitted by participants who filled out our adapted version of o-timeusediary. The o-timeusediary is basically a web form that allows users how, with whom, where, etc, they spend their time on a specific day.

By default, o-timeusediary supports download the data as a CSV file onto the client (participant) computer, or sending it to a datapipe/Open Science Foundataion account, so it works without the need to run a backend server. That is a great thing in general, but for our usecase however, we need to store the data on institute servers. This is where this backend comes in.

What we did is we modified the frontend to also support:

* sending the data as JSON to this backend
* loading and displaying data from the backend, e.g., to support editing existing data or reduce the amount of work required to fill in the diary for many days.

## Development Setup

```bash
git clone https://github.com/dfsp-spirit/o-timeusediary-backend
cd o-timeusediary-backend/

# Create virtual environment and install dependencies
uv venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
uv sync --dev

# Run tests to verify setup
uv run pytest
```

Then run the backend:

```bash
./run_dev_backend_minimal.sh        # will use Python's built-in web server, nothing else required.
```

To run both the frontend and backend, check out the frontend on the same file system level and run [./run_dev_nginx_both.bash](./run_dev_nginx_both.bash) if you have nginx installed.

Now connect via curl, e.g., `curl http://localhost:8000/entries/`, or setup and run the frontend: see the [frontend repo](https://github.com/dfsp-spirit/o-timeusediary/tree/mpiae_adapt), and make sure you use the `mpiae_adapt` branch.

