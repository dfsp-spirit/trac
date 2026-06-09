# TRAC -- AI System Instructions

TRAC (Time-use Research Activity Collector) is a research application for capturing structured time-use diaries.

## 1. High-Level Architecture
- **Frontend (`frontend/src/`)**: Pure, vanilla JS client (no SPA framework or bundler). Relies on `frontend/src/settings/tud_settings.js` to point to `/api`.
- **Backend (`backend/`)**: FastAPI/Python app managed with `uv`. Serves the REST API and the template-based Admin portal.
- **Database (`database/`)**: PostgreSQL schema mapped via SQLModel. Hydrated from `backend/studies_config.json` at startup.

---

## 2. Specialized Developer Agent Guidance

To minimize token usage and keep contexts separated, we divide development tasks among specialized **AI Developer Agents**. All agents must read and adhere to their respective rules and skills.

- **Central Agent Directory**: Read [.github/agents.md](agents.md) for details on role scopes.
- **Specialized Skills Directories**:
  - **Frontend Development**: Consult [Frontend Skills](skills/frontend.md) (timelines UI, dynamic JS).
  - **Backend API & Administration**: Consult [Backend Skills](skills/backend.md) (FastAPI, Python build).
  - **Database Architecture**: Consult [Database Skills](skills/database.md) (SQLModel, PostgreSQL seed rules).
  - **QA & CI Environments**: Consult [Testing & Environment Skills](skills/testing.md) (Pytest, Playwright, Nginx).
