"""add study_submitted_at timestamp to study_participants

Revision ID: 0008_add_study_submitted_at
Revises: 0007_add_day_label_display_names
Create Date: 2026-08-10 00:00:00.000000

Records the moment a participant explicitly submits their completed study.
NULL means not yet submitted.  Once set, the frontend redirects the
participant to the thank-you page on all subsequent visits.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0008_add_study_submitted_at"
down_revision = "0007_add_day_label_display_names"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "study_participants",
        sa.Column(
            "study_submitted_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("study_participants", "study_submitted_at")
