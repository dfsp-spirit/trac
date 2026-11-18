"""add participant display name

Revision ID: 0017_add_display_name
Revises: 0016_add_ux_events
Create Date: 2026-11-18 00:00:00.000000

Adds ``study_participants.display_name``: the human-readable label for the
person a diary is filled out for ("Tim", "Kind A"). It is display text, not a
key - the participant id stays the identity everywhere - and it is stored per
study so it disappears with the study and can differ between studies for the
same person.

Nullable on purpose: studies that do not use the feature (and every existing
row) keep a NULL, the frontend then renders no label, and study texts that do
not mention ``{display_name}`` are unaffected.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0017_add_display_name"
down_revision = "0016_add_ux_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "study_participants",
        sa.Column("display_name", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("study_participants", "display_name")
