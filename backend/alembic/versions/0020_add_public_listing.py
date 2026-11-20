"""add studies.is_listed_publicly

Revision ID: 0020_add_public_listing
Revises: 0019_add_study_day_groups
Create Date: 2026-11-20 00:00:00.000000

Adds the opt-in flag that puts a study on the entry page's public list, which is
what a visitor without an invitation link sees. Defaults to false, so no existing
study starts advertising itself: the list is a deliberate choice by the study
owner, not a side effect of being open to unlisted participants.

Only open studies (``allow_unlisted_participants``) can be joined from that list,
so the configuration parser rejects ``is_listed_publicly: true`` on an
invitation-only study. The column itself is a plain flag: the public list
endpoint also filters on the open flag, so a study that was closed after it was
listed simply stops appearing.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0020_add_public_listing"
down_revision = "0019_add_study_day_groups"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "studies",
        sa.Column(
            "is_listed_publicly",
            sa.Boolean(),
            nullable=False,
            # Real boolean literal so SQLAlchemy compiles it per dialect (see
            # 0011): PostgreSQL needs DEFAULT false, not an integer.
            #
            # Opt-in: existing studies stay unlisted until their configuration
            # is re-imported with the flag set.
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("studies", "is_listed_publicly")
