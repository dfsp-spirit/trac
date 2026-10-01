"""add browser identification capture

Revision ID: 0011_add_browser_identification
Revises: 0010_drop_unique_study_name
Create Date: 2026-10-01 00:00:00.000000

Adds per-study opt-out and per-participant storage for browser/device
identification data:

* ``studies.save_browser_identification`` -- when true (the server default, so
  existing studies get it enabled), the frontend captures the raw user agent
  plus a parsed ``ua-parser-js`` snapshot and posts it once per participant.
* ``study_participants.user_agent`` / ``client_info`` / ``client_info_captured_at``
  -- the captured data itself, stored on the study-participant association so the
  existing activities export can reuse the rows it already loads.

The raw user agent string is stored verbatim so the data can be re-parsed later
with improved parsing rules; ``client_info`` keeps the parsed snapshot plus extra
environment signals (screen size, client hints, ...) as a JSON blob, so the
schema stays stable across ua-parser-js versions.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0011_add_browser_identification"
down_revision = "0010_drop_unique_study_name"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "studies",
        sa.Column(
            "save_browser_identification",
            sa.Boolean(),
            nullable=False,
            # Real boolean literal so SQLAlchemy compiles it per dialect:
            # PostgreSQL/SQLite -> DEFAULT true / 1, MSSQL (BIT) -> DEFAULT 1,
            # MySQL/MariaDB -> DEFAULT true. A raw text "1" breaks PostgreSQL,
            # where BOOLEAN DEFAULT must be a boolean, not an integer.
            server_default=sa.true(),
        ),
    )
    op.add_column(
        "study_participants",
        sa.Column("user_agent", sa.String(length=2048), nullable=True),
    )
    op.add_column(
        "study_participants",
        sa.Column("client_info", sa.JSON(), nullable=True),
    )
    op.add_column(
        "study_participants",
        sa.Column(
            "client_info_captured_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("study_participants", "client_info_captured_at")
    op.drop_column("study_participants", "client_info")
    op.drop_column("study_participants", "user_agent")
    op.drop_column("studies", "save_browser_identification")
