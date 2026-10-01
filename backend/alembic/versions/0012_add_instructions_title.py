"""add study_text_instructions_title field to studies table

Revision ID: 0012_add_instructions_title
Revises: 0011_add_browser_identification
Create Date: 2026-10-01 00:00:00.000000

Adds the optional per-study override for the title at the top of the
instructions page. It is nullable with no server default, so studies that do not
set it keep the frontend's localized `instructions.welcomeTitle` fallback.

The revision id stays within the 32 characters of alembic's `version_num`
column; the longer field name lives in the migration body and file name only.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0012_add_instructions_title"
down_revision = "0011_add_browser_identification"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "studies",
        sa.Column(
            "study_text_instructions_title",
            sa.JSON(),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("studies", "study_text_instructions_title")
