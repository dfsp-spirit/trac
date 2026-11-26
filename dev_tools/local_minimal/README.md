## dev_tools/local_minimal -- Configuration and helpers to run in a Python web server

The files in this directory allow you to run this app locally with Python's built-in
web server (frontend) and direct access to the uvicorn WSGI server. This setup uses:

* direct backend access (no reverse proxy), so not very secure and not suitable for production (no SSL!)
* runs the frontend at http://localhost:3000/
* runs the backend at http://localhost:8000/, which is accessed directly by the frontend
* this means FastAPI has an empty root path in this setup.

This setup is further away from what you will get in production compared to the local nginx dev setup, so it is harder to find path issues early.
It is less complex to set up though, as it does not require a locally running nginx, only Python.

### Usage

```sh
# from repo root
cp dev_tools/local_minimal/frontend_settings/config.dev-minimal.js frontend/src/js/config.js
cp dev_tools/local_minimal/backend_settings/.env.dev-minimal backend/.env

# run frontend (start Python's built-in HTTP server):
cd frontend/src
python3 -m http.server 3000

# in another terminal from the repo root, run the backend (start uvicorn):
cd backend
uv run uvicorn o_timeusediary_backend.api:app --host 127.0.0.1 --port 8000
```
