"""drop activities.copy_source_uuid

Revision ID: 0014_drop_copy_source_uuid
Revises: 0013_add_activity_identity
Create Date: 2026-10-30 00:00:00.000000

Migration 0013 added ``copy_source_uuid`` as an optional provenance marker for
rows created by copying another one. The PI decided that provenance is not
recorded: a copied activity is simply an activity the participant placed, and
nothing should distinguish it from one entered by hand. No code path ever set
the column, so dropping it loses no data.

This drops the column in the same release that stops using it, which README
"Database schema policy" otherwise only allows a release later. That rule
protects code that is already deployed; 0013 was never part of a release tag, so
no deployed code reads this column.

The revision id stays within the 32 characters of alembic's `version_num`
column.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0014_drop_copy_source_uuid"
down_revision = "0013_add_activity_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("activities", "copy_source_uuid")


def downgrade() -> None:
    # The column comes back empty: the values it might have held are gone.
    op.add_column(
        "activities",
        sa.Column("copy_source_uuid", sa.String(length=64), nullable=True),
    )
