# Backend Agent Skills

## Tech Stack & Architecture
- **FastAPI**: Main REST API framework. High performance and structured dependency injection.
- **`uv` Workspace**: Built and managed with `uv` (`backend/pyproject.toml`). Recommended commands:
  - Run tests: `cd backend && uv run pytest`
  - Build backend: `cd backend && uv run build`
- **Reverse Proxy**: Backend endpoints are served in production behind Nginx at a nested path (such as `/api` or `/tud_backend`). Requires configuring the FastAPI `root_path`.

## Management & Administration
- **Admin Portal**: Generated dynamically via FastAPI templates (`backend/src/o_timeusediary_backend/templates/`). Protected via HTTP Basic Auth. Credentials are set securely via environment parameters.
- **Environment Settings**: Read at runtime via a `.env` file (see `backend/.env.example`).
- **Security Checkpoints**: Input validations (e.g., Pydantic schemas) must be enforced for all incoming requests. All data returned from API endpoints must be parsed strictly under secure, scoped models.
