"""add browser identification capture

Revision ID: 0011_add_browser_identification
Revises: 0010_drop_unique_study_name
Create Date: 2026-10-01 00:00:00.000000

Adds per-study opt-out and per-participant storage for browser/device
identification data:

* ``studies.save_browser_identification`` -- opt-in flag; when true the frontend
  sends the raw user agent plus a few environment signals once per participant.
  It defaults to false (the server default), so neither existing nor new studies
  start collecting this data without an explicit choice.
* ``study_participants.client_info`` / ``client_info_captured_at`` -- the
  captured data itself, stored on the study-participant association so the
  participant export has it without loading activity rows.

The blob is owned by the server: ``user_agent`` and ``schema_version`` follow the
client's signals, while ``capture_count`` and ``first_captured_at`` are written
by the endpoint, so one column pair describes a whole capture and no separate
column can disagree with it. The raw user agent is kept verbatim so it can be
re-parsed later with better rules; the browser never parses it itself, so there
is no client-side parser (and no stored parsing result that goes stale).

This revision was never released; the column layout was changed in place before
the first deployment instead of carrying a migration that only reshapes empty
columns.
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
            # PostgreSQL/SQLite -> DEFAULT false / 0, MSSQL (BIT) -> DEFAULT 0,
            # MySQL/MariaDB -> DEFAULT false. A raw text "0" breaks PostgreSQL,
            # where BOOLEAN DEFAULT must be a boolean, not an integer.
            #
            # Opt-in: existing studies are left with the feature off, exactly
            # like newly created ones, so nothing starts collecting device data
            # without an explicit decision.
            server_default=sa.false(),
        ),
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
    op.drop_column("studies", "save_browser_identification")
