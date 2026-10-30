"""record a skipped diary

Revision ID: 0015_add_diary_skip
Revises: 0014_drop_copy_source_uuid
Create Date: 2026-10-30 00:00:00.000000

Skipping the diary is a server action, not a redirect (D41). The diary closes
via ``study_participants.study_submitted_at`` - the field every existing lock,
the admin completion view and the exports already key off - and these three
columns record that it was skipped rather than filled, and why:

* ``skipped_at`` - set together with ``study_submitted_at``; its presence is what
  makes the done reason ``skipped`` and what keeps a study that requires the
  diary before its external tasks from unlocking those tasks.
* ``skip_reason_code`` / ``skip_note`` - optional, chosen by the participant; a
  free text note is capped at 500 characters so one row cannot hold an essay.

All three are nullable and additive; existing rows keep meaning "submitted" or
"not finished yet".
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0015_add_diary_skip"
down_revision = "0014_drop_copy_source_uuid"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "study_participants",
        sa.Column("skipped_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "study_participants",
        sa.Column("skip_reason_code", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "study_participants",
        sa.Column("skip_note", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("study_participants", "skip_note")
    op.drop_column("study_participants", "skip_reason_code")
    op.drop_column("study_participants", "skipped_at")
