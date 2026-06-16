# TRAC -- AI System Instructions

TRAC (Time-use Research Activity Collector) is a research application for capturing structured time-use diaries.

## 1. High-Level Architecture
- **Frontend (`frontend/src/`)**: Pure, vanilla JS client (no SPA framework or bundler). Relies on `frontend/src/settings/tud_settings.js` to point to `/api`.
- **Backend (`backend/`)**: FastAPI/Python app managed with `uv`. Serves the REST API and the template-based Admin portal.
- **Database (`database/`)**: PostgreSQL schema mapped via SQLModel and managed via Alembic migrations. Preferred flow is explicit `tud db upgrade` and optional explicit `tud studies import`; startup bootstrap import exists only in compatibility mode (`TUD_STARTUP_MODE=bootstrap`).

---

## 2. Specialized Developer Agent Guidance

To minimize token usage and keep contexts separated, we divide development tasks among specialized **AI Developer Agents**. All agents must read and adhere to their respective rules and skills.

- **Central Agent Directory**: Read [agents.md](../agents.md) for details on role scopes.
- **Agent Documentation**: Use `docs/agents/` for architecture and operational background by domain.
- **Specialized Skills Directories**:
  - **Frontend Development**: Consult [Frontend Skill](../skills/frontend/SKILL.md).
  - **Backend API & Administration**: Consult [Backend Skill](../skills/backend/SKILL.md).
  - **Database Architecture**: Consult [Database Skill](../skills/database/SKILL.md).
  - **QA & CI Environments**: Consult [Testing Orchestration Skill](../skills/testing/SKILL.md).
  - **Direct Test Execution**: Use [Run Backend Unit Tests Skill](../skills/run-backend-unit-tests/SKILL.md), [Run Backend Integration Tests Skill](../skills/run-backend-integration-tests/SKILL.md), and [Run Frontend E2E Tests Skill](../skills/run-frontend-e2e-tests/SKILL.md).
