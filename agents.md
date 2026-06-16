# AI Developer Agents

This repository utilizes specialized AI Developer Agents to maintain and build features for TRAC. Each agent specializes in a distinct layer of the architecture, referencing targeted skills and rules.

The app is not in production yet and not v1.0, so there is no need to add extra code for backwards compatibility or migrating the database, so do not do that. It just bloats code base and leads to more complexity. We can change cfg file syntax or DB schema at will.

---

## Agent Directory & Core Responsibilities

### 1. Frontend Agent
- **Domain**: UI, Client State, Interaction Logic, and Localizations.
- **Key Files**: `frontend/src/` (HTML, JS, CSS)
- **Operational Skill**: [Frontend Skill](skills/frontend/SKILL.md)
- **Documentation**: [Frontend Agent Documentation](docs/agents/frontend.md)
- **Scope**: Manages the pure JavaScript frontend. Handles day switches, timeline drawing, client configuration (`tud_settings.js`), language files (`frontend/src/locales/`), and browser interaction.

### 2. Backend Agent
- **Domain**: REST API, Admin Portal, Security, and Configuration.
- **Key Files**: `backend/` (FastAPI, SQLAlchemy, Jinja templates, `uv.lock`, settings)
- **Operational Skill**: [Backend Skill](skills/backend/SKILL.md)
- **Documentation**: [Backend Agent Documentation](docs/agents/backend.md)
- **Scope**: Implements business logic, API validation, study orchestration, secure credential check, participant status, basic authentication for administrators, and HTML reports.

### 3. Database Agent
- **Domain**: PostgreSQL Schema, Alembic Migrations, Explicit Study Import, and Data Models.
- **Key Files**: `database/` (Creation/Drop scripts), `backend/src/o_timeusediary_backend/models.py`
- **Operational Skill**: [Database Skill](skills/database/SKILL.md)
- **Documentation**: [Database Agent Documentation](docs/agents/database.md)
- **Scope**: Structures SQLModel databases and migration lifecycle. Manages explicit JSON ingestion (`backend/studies_config.json`, `backend/activities_*.json`) via CLI/admin workflows, and database lifecycle constraints.

### 4. Integration & QA Agent
- **Domain**: End-to-End (E2E) testing, Unit/Integration tests, CI Pipelines, and Dev Nginx proxies.
- **Key Files**: `frontend/tests/`, `backend/tests/`, `.github/workflows/`, dev tools configuration templates
- **Operational Skill**: [Testing Orchestration Skill](skills/testing/SKILL.md)
- **Operational Skill**: [Run Backend Unit Tests Skill](skills/run-backend-unit-tests/SKILL.md)
- **Operational Skill**: [Run Backend Integration Tests Skill](skills/run-backend-integration-tests/SKILL.md)
- **Operational Skill**: [Run Frontend E2E Tests Skill](skills/run-frontend-e2e-tests/SKILL.md)
- **Documentation**: [Testing & Environment Agent Documentation](docs/agents/testing.md)
- **Scope**: Drives test runners (`pytest`, Playwright), verifies client-server integrity, runs local Nginx development proxy pipelines, and manages GitHub Action files.
