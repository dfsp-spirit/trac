"""add participant sessions for the opt-in inactivity timeout

Revision ID: 0024_add_participant_sessions
Revises: 0023_add_time_grid
Create Date: 2026-11-26 00:00:00.000000

A study with ``inactivity_timeout_minutes > 0`` requires a server-side session
for participant data endpoints. Only the hash of the random cookie token is
stored; the token itself never reaches the database.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0024_add_participant_sessions"
down_revision = "0023_add_time_grid"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "participant_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("study_id", sa.Integer(), nullable=False),
        sa.Column("participant_id", sa.String(length=255), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["study_id"], ["studies.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_participant_sessions_study_participant",
        "participant_sessions",
        ["study_id", "participant_id"],
    )
    op.create_index(
        "ix_participant_sessions_token_hash",
        "participant_sessions",
        ["token_hash"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_participant_sessions_token_hash", table_name="participant_sessions"
    )
    op.drop_index(
        "ix_participant_sessions_study_participant",
        table_name="participant_sessions",
    )
    op.drop_table("participant_sessions")
