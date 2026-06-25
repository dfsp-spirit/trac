"""add inactivity timeout fields to studies

Revision ID: 0002_add_inactivity_timeout
Revises: 0001_initial_schema
Create Date: 2026-06-25 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0002_add_inactivity_timeout"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "studies",
        sa.Column(
            "inactivity_timeout_minutes",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "studies",
        sa.Column(
            "inactivity_timeout_stress_time_left",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("5"),
        ),
    )
    op.add_column(
        "studies",
        sa.Column(
            "inactivity_page_custom_text",
            sa.JSON(),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("studies", "inactivity_page_custom_text")
    op.drop_column("studies", "inactivity_timeout_stress_time_left")
    op.drop_column("studies", "inactivity_timeout_minutes")
