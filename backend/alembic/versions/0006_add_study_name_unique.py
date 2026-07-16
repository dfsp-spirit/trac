"""add unique constraint to studies.name

Revision ID: 0006_add_study_name_unique
Revises: 0005_add_study_text_instructions
Create Date: 2026-07-16 00:00:00.000000
"""

from __future__ import annotations

from alembic import op


# revision identifiers, used by Alembic.
revision = "0006_add_study_name_unique"
down_revision = "0005_add_study_text_instructions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint("uq_studies_name", "studies", ["name"])


def downgrade() -> None:
    op.drop_constraint("uq_studies_name", "studies", type_="unique")
