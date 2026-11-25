"""add server_message and study_messages

Revision ID: 0022_add_messages
Revises: 0021_add_recent_limit
Create Date: 2026-11-25 00:00:00.000000

One banner message per scope: a single server-wide row and at most one row per
study. Both are switched on and off manually (no scheduling), so the tables
carry no time window - ``is_active`` is the whole schedule.

``revision`` is bumped on every effective edit. The participant client
remembers which message version it dismissed, so an edited or re-activated
message has to look new to the client or nobody would see it again.

``server_message.id`` is fixed at 1 and not auto-incremented: that is what makes
"exactly one server message" true in the schema instead of in a convention.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0022_add_messages"
down_revision = "0021_add_recent_limit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "server_message",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("text", sa.JSON(), nullable=False),
        sa.Column("audience", sa.String(length=16), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False
        ),
    )

    op.create_table(
        "study_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "study_id",
            sa.Integer(),
            sa.ForeignKey("studies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("text", sa.JSON(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False
        ),
        sa.UniqueConstraint("study_id", name="uq_study_messages_study"),
    )


def downgrade() -> None:
    op.drop_table("study_messages")
    op.drop_table("server_message")
