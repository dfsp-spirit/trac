"""add study_text_instructions field to studies table

Revision ID: 0005_add_study_text_instructions
Revises: 0004_fix_description_column_type
Create Date: 2026-07-09 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0005_add_study_text_instructions"
down_revision = "0004_fix_description_column_type"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "studies",
        sa.Column(
            "study_text_instructions",
            sa.JSON(),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("studies", "study_text_instructions")
