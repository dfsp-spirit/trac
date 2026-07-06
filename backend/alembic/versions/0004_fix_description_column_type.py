"""fix studies.description column: migrate from VARCHAR/TEXT to JSON

Revision ID: 0004_fix_description_column_type
Revises: 0003_add_study_footer_links
Create Date: 2026-07-06 00:00:00.000000

On databases that pre-date Alembic (created by SQLModel's create_all() before
v0.16.0), the ``studies.description`` column may still be VARCHAR/TEXT even
though the model declares it as JSON.  This migration detects the column type
and, when it is not already JSON, converts it **and** its existing data using
DBMS-appropriate DDL:

* Values that already look like JSON objects/arrays (start with ``{`` or ``[``)
  are cast to ::json so they become proper dicts in Python.
* Plain-text legacy descriptions are wrapped with to_json() so they remain
  plain strings (the application code handles both forms).

The migration is a no-op when the column is already JSON (fresh databases
created from 0001_initial_schema onwards).
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision = "0004_fix_description_column_type"
down_revision = "0003_add_study_footer_links"
branch_labels = None
depends_on = None


def _column_is_json() -> bool:
    """Return True when studies.description is already a JSON/JSONB column."""
    conn = op.get_bind()
    # Detect the DBMS dialect
    dialect_name = conn.dialect.name

    if dialect_name == "postgresql":
        row = conn.execute(
            text(
                "SELECT data_type FROM information_schema.columns "
                "WHERE table_name = 'studies' AND column_name = 'description'"
            )
        ).fetchone()
        return row is not None and row[0] in ("json", "jsonb")

    if dialect_name == "mysql":
        # MariaDB returns "longtext" for JSON columns created by SQLAlchemy
        row = conn.execute(
            text(
                "SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_NAME = 'studies' AND COLUMN_NAME = 'description'"
            )
        ).fetchone()
        return row is not None and row[0].lower() == "json"

    if dialect_name == "mssql":
        row = conn.execute(
            text(
                "SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_NAME = 'studies' AND COLUMN_NAME = 'description'"
            )
        ).fetchone()
        return row is not None and row[0].lower() in ("nvarchar(max)", "varchar(max)")

    # Unknown dialect — assume the column is fine
    return True


def upgrade() -> None:
    if _column_is_json():
        # Column is already JSON — nothing to do (fresh DB created from 0001).
        return

    conn = op.get_bind()
    dialect_name = conn.dialect.name

    if dialect_name == "postgresql":
        # Safely convert VARCHAR/TEXT → JSON.
        # - NULL stays NULL
        # - Values starting with { or [ (JSON object/array) → ::json  (becomes dict)
        # - Plain strings → to_json()  (stays a JSON string, i.e. str in Python)
        op.execute(
            text(
                "ALTER TABLE studies ALTER COLUMN description TYPE json "
                "USING CASE "
                "  WHEN description IS NULL THEN NULL "
                "  WHEN description::text ~ '^\\s*[\\[{]' THEN description::text::json "
                "  ELSE to_json(description::text) "
                "END"
            )
        )

    elif dialect_name == "mysql":
        # MariaDB/MySQL: change column type to JSON.
        # First convert existing data: if a value is a JSON-looking string,
        # parse it and store back as JSON; otherwise wrap as JSON string.
        # We use a staging approach to avoid data loss.
        rows = conn.execute(
            text("SELECT id, description FROM studies WHERE description IS NOT NULL")
        ).fetchall()
        op.execute(
            text(
                "ALTER TABLE studies MODIFY COLUMN description JSON NULL"
            )
        )
        for study_id, desc in rows:
            if desc is None:
                continue
            desc_stripped = desc.strip() if isinstance(desc, str) else desc
            if isinstance(desc_stripped, str) and desc_stripped.startswith(
                ("{", "[")
            ):
                # Already looks like JSON — store as-is (MariaDB will parse it)
                conn.execute(
                    text("UPDATE studies SET description = :d WHERE id = :id"),
                    {"d": desc_stripped, "id": study_id},
                )
            else:
                # Plain text — wrap as JSON string value
                import json

                conn.execute(
                    text("UPDATE studies SET description = :d WHERE id = :id"),
                    {"d": json.dumps(desc), "id": study_id},
                )

    elif dialect_name == "mssql":
        # MS SQL: change from NVARCHAR to NVARCHAR(MAX) and store as JSON text.
        # SQLAlchemy JSON type on MSSQL uses NVARCHAR with JSON serialization.
        # The column likely is already NVARCHAR — just ensure the data format
        # is correct.
        rows = conn.execute(
            text("SELECT id, description FROM studies WHERE description IS NOT NULL")
        ).fetchall()
        for study_id, desc in rows:
            if desc is None:
                continue
            desc_stripped = desc.strip() if isinstance(desc, str) else desc
            if not (
                isinstance(desc_stripped, str) and desc_stripped.startswith(("{", "["))
            ):
                # Plain text — wrap as JSON string
                import json

                conn.execute(
                    text("UPDATE studies SET description = :d WHERE id = :id"),
                    {"d": json.dumps(desc), "id": study_id},
                )

    else:
        raise NotImplementedError(
            f"Unsupported dialect '{dialect_name}' for description column migration"
        )


def downgrade() -> None:
    # Converting JSON back to VARCHAR would lose the structured i18n map.
    # This downgrade is intentionally not supported — restore from a backup
    # if you need to roll back.
    pass
