"""add study-specific footer links and hide_server_wide_links fields

Revision ID: 0003_add_study_footer_links
Revises: 0002_add_inactivity_timeout
Create Date: 2026-06-25 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0003_add_study_footer_links"
down_revision = "0002_add_inactivity_timeout"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "studies",
        sa.Column(
            "footer_links",
            sa.JSON(),
            nullable=True,
        ),
    )
    op.add_column(
        "studies",
        sa.Column(
            "hide_server_wide_links",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("studies", "hide_server_wide_links")
    op.drop_column("studies", "footer_links")
