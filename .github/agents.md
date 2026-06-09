# AI Developer Agents

This repository utilizes specialized AI Developer Agents to maintain and build features for TRAC. Each agent specializes in a distinct layer of the architecture, referencing targeted skills and rules.

---

## Agent Directory & Core Responsibilities

### 1. Frontend Agent
- **Domain**: UI, Client State, Interaction Logic, and Localizations.
- **Key Files**: `frontend/src/` (HTML, JS, CSS)
- **Skills Reference**: [Frontend Skills](skills/frontend.md)
- **Scope**: Manages the pure JavaScript frontend. Handles day switches, timeline drawing, client configuration (`tud_settings.js`), language files (`frontend/src/locales/`), and browser interaction.

### 2. Backend Agent
- **Domain**: REST API, Admin Portal, Security, and Configuration.
- **Key Files**: `backend/` (FastAPI, SQLAlchemy, Jinja templates, `uv.lock`, settings)
- **Skills Reference**: [Backend Skills](skills/backend.md)
- **Scope**: Implements business logic, API validation, study orchestration, secure credential check, participant status, basic authentication for administrators, and HTML reports.

### 3. Database Agent
- **Domain**: PostgreSQL Schema, Seeding/Hydration, and Data Models.
- **Key Files**: `database/` (Creation/Drop scripts), `backend/src/o_timeusediary_backend/models.py`
- **Skills Reference**: [Database Skills](skills/database.md)
- **Scope**: Structures SQLModel databases. Manages initial JSON ingestion (`backend/studies_config.json`, `backend/activities_*.json`), and database lifecycle constraints.

### 4. Integration & QA Agent
- **Domain**: End-to-End (E2E) testing, Unit/Integration tests, CI Pipelines, and Dev Nginx proxies.
- **Key Files**: `frontend/tests/`, `backend/tests/`, `.github/workflows/`, dev tools configuration templates
- **Skills Reference**: [Testing & Environment Skills](skills/testing.md)
- **Scope**: Drives test runners (`pytest`, Playwright), verifies client-server integrity, runs local Nginx development proxy pipelines, and manages GitHub Action files.
