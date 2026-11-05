"""add unlinked usability signals

Revision ID: 0016_add_ux_events
Revises: 0015_add_diary_skip
Create Date: 2026-11-05 00:00:00.000000

Adds the opt-in usability signal channel used to find out where participants get
stuck, without joining anything to a person:

* ``studies.save_ux_events`` -- opt-in flag, default false, so no study starts
  observing participants without a deliberate choice (the same shape as
  ``save_browser_identification``).
* ``ux_events`` -- one row per signal (a refused save, a search that found
  nothing, a client error). Deliberately unlinked: no participant id, no IP, no
  user agent, no cookie. ``load_id`` is a random id for one page load, kept in
  memory by the client, and is only ever used to count distinct visits.

Rows are aggregate input for the admin page; no view may list a ``load_id``.
``props`` holds machine codes, counts and coarse buckets only - the API filters
unknown keys, so a row can never carry activity codes or free text.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0016_add_ux_events"
down_revision = "0015_add_diary_skip"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "studies",
        sa.Column(
            "save_ux_events",
            sa.Boolean(),
            nullable=False,
            # Opt-in, exactly like `save_browser_identification`: existing and
            # new studies both start with the channel closed.
            server_default=sa.false(),
        ),
    )

    op.create_table(
        "ux_events",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column(
            "study_id",
            sa.Integer(),
            sa.ForeignKey("studies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("load_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=48), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("language", sa.String(length=8), nullable=True),
        sa.Column("app_version", sa.String(length=32), nullable=True),
        sa.Column("props", sa.JSON(), nullable=True),
    )
    op.create_index("ix_ux_events_load_id", "ux_events", ["load_id"])
    op.create_index("ix_ux_events_name", "ux_events", ["name"])
    op.create_index(
        "ix_ux_events_study_received", "ux_events", ["study_id", "received_at"]
    )
    op.create_index(
        "ix_ux_events_study_name_received",
        "ux_events",
        ["study_id", "name", "received_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_ux_events_study_name_received", table_name="ux_events")
    op.drop_index("ix_ux_events_study_received", table_name="ux_events")
    op.drop_index("ix_ux_events_name", table_name="ux_events")
    op.drop_index("ix_ux_events_load_id", table_name="ux_events")
    op.drop_table("ux_events")
    op.drop_column("studies", "save_ux_events")
