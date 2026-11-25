"""add studies.time_step_minutes and studies.min_duration_minutes

Revision ID: 0023_add_time_grid
Revises: 0022_add_messages
Create Date: 2026-11-25 00:00:00.000000

The study's time grid, split in two (see ``timing.py``):

* ``time_step_minutes`` - how precisely a time can be typed, i.e. what the
  native time picker offers. 10 keeps the historical grid; 5 makes the quarter
  hours people type (06:15) survive instead of snapping to 06:10.
* ``min_duration_minutes`` - the shortest activity. This is what keeps a block
  big enough to see and tap when the step is fine; with a 10-minute step it
  equals today's smallest block, so existing studies behave unchanged.

Both default to 10, which is exactly what every existing study does. The
backend does not enforce the grid on writes (it never did); the participant
client does.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0023_add_time_grid"
down_revision = "0022_add_messages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for column in ("time_step_minutes", "min_duration_minutes"):
        op.add_column(
            "studies",
            sa.Column(
                column,
                sa.Integer(),
                nullable=False,
                # The grid every existing study already uses.
                server_default=sa.text("10"),
            ),
        )


def downgrade() -> None:
    op.drop_column("studies", "min_duration_minutes")
    op.drop_column("studies", "time_step_minutes")
