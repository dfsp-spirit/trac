"""add studies.day_groups

Revision ID: 0019_add_study_day_groups
Revises: 0018_drop_participants
Create Date: 2026-11-19 00:00:00.000000

Adds the optional shortcut groups for the copy dialog ("All work days",
"Weekend", ...). They are a JSON list of ``{key, names, days}`` on the study,
because the grouping is study content: a study may run a Mon-Fri week, a
Sun-Thu week or a school week, and the app must not guess. ``days`` refers to
``day_labels.name``; the groups are validated at import time and resolved to
day indexes when the diary is read.

Nullable, so every existing study starts without groups (and therefore without
shortcut buttons) until its configuration is re-imported.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0019_add_study_day_groups"
down_revision = "0018_drop_participants"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("studies", sa.Column("day_groups", sa.JSON(), nullable=True))


def downgrade() -> None:
    # Forward-only: the groups are study configuration, not research data, and
    # a rollback loses them until the config is re-imported.
    op.drop_column("studies", "day_groups")
