"""add study owner_usernames for scoped scientist administration

Revision ID: 0009_add_study_owner_usernames
Revises: 0008_add_study_submitted_at
Create Date: 2026-09-17 00:00:00.000000

Adds a JSON column holding the list of scientist usernames that own (and may
fully administer) a study. `NULL` means the study is not owned by any scientist
and can only be managed by super admins (TUD_API_ADMIN_USERNAME). Existing
studies stay unowned, which preserves the previous behaviour of the admin
interface for them.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0009_add_study_owner_usernames"
down_revision = "0008_add_study_submitted_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "studies",
        sa.Column("owner_usernames", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("studies", "owner_usernames")
