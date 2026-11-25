"""add studies.num_recent_activities_shown

Revision ID: 0021_add_recent_limit
Revises: 0020_add_public_listing
Create Date: 2026-11-25 00:00:00.000000

How many "Used recently" shortcuts the participant's activity panel shows above
the catalogue. The client used to hard-code five; a study with a crowded
catalogue may want fewer, and 0 hides the section so the catalogue gets the
room. Defaults to 5, which is what every existing study showed.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0021_add_recent_limit"
down_revision = "0020_add_public_listing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "studies",
        sa.Column(
            "num_recent_activities_shown",
            sa.Integer(),
            nullable=False,
            # The value the client hard-coded before this setting existed, so
            # existing studies keep the panel they had.
            server_default=sa.text("5"),
        ),
    )


def downgrade() -> None:
    op.drop_column("studies", "num_recent_activities_shown")
