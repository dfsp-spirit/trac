# Backend Agent Documentation

## Tech Stack & Runtime
- FastAPI backend under `backend/src/o_timeusediary_backend/`.
- Project tooling managed via `uv` in `backend/pyproject.toml`.
- Typical local test command base: `cd backend && uv run pytest`.

## Deployment Shape
- Backend often served behind Nginx/reverse proxy under nested path prefixes.
- `root_path` assumptions must stay consistent with deployment config.

## Admin & Security
- Admin portal templates are under `backend/src/o_timeusediary_backend/templates/`.
- Admin routes rely on HTTP Basic Auth and environment-driven credentials.
- Request validation and constrained response models are required.
