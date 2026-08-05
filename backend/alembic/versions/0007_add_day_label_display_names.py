"""add display_names JSON column to day_labels

Revision ID: 0007_add_day_label_display_names
Revises: 0006_add_study_name_unique
Create Date: 2026-08-05 00:00:00.000000

Adds a JSON column holding the full per-language display names map for each
day label (e.g. {"en": "Monday", "sv": "Måndag"}). The single-language
`display_name` column remains and stores the study default-language value.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0007_add_day_label_display_names"
down_revision = "0006_add_study_name_unique"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "day_labels",
        sa.Column("display_names", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("day_labels", "display_names")
