# Database Agent Skills

## Database Tech Stack
- **PostgreSQL**: Production-grade relational database storing participant profiles, study setups, and logging details.
- **SQLModel / SQLAlchemy**: ORM mapping layer utilized in python models (`backend/src/o_timeusediary_backend/models.py`).
- **Database Scripts**: Schema creation and deletion scripts reside in the `database/` folder (e.g. `create_tud_db.sh`).

## Orchestration & Seeding Flow
- **JSON Configuration**: Configuration data parses from `backend/studies_config.json` and language-specific activities lists (e.g., `backend/activities_*.json`).
- **Auto-Hydration**: At backend startup, the system scans `studies_config.json` and inserts any *new* study records or activity profiles into PostgreSQL automatically.
- **Migration & Admin Limitations**:
  - *No Automatic Schema Alteration*: If a study with the exact technical identifier (`name_short`) already exists in the database, the backend **does not** automatically sync or migrate schema alterations from JSON definitions (to prevent accidental data loss). Alterations must be done manually or via direct administrative overrides inside the protected web console interface.
