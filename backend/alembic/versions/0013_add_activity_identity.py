"""activity row identity, overlap limit and study day window

Revision ID: 0013_add_activity_identity
Revises: 0012_add_instructions_title
Create Date: 2026-10-27 00:00:00.000000

The schema the incremental write path needs (D17, D19, D21, D26, D27). All of it
is additive: the existing whole-day save keeps working (D25), because

* every new column is either nullable or has a server default,
* ``client_uuid`` and ``updated_at`` are backfilled here and then made NOT NULL,
  and the old writer supplies both through the model's defaults.

Three constraints carry rules that used to live only in endpoint code:

* ``uq_activity_client_uuid`` makes a retried save idempotent instead of
  duplicating a row,
* ``uq_activity_slot`` rejects "same activity, same day, same times" (D8) in the
  database, not just in a check that two concurrent requests can both pass,
* ``ck_activity_end_after_start`` / ``ck_activity_duration_max`` make
  cross-midnight explicit and cap one record at 24 hours (D21).

Cross-dialect notes: the backfill is done in Python rather than with
``gen_random_uuid()``, which not every supported DBMS has, and
``updated_at = created_at`` is plain SQL. Existing rows that already violate
``uq_activity_slot`` would make the constraint fail; there is no production data
yet, and silently deleting rows in a migration is not something this project
does.
"""

from __future__ import annotations

import uuid

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0013_add_activity_identity"
down_revision = "0012_add_instructions_title"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- activities: row identity -------------------------------------------
    op.add_column(
        "activities", sa.Column("client_uuid", sa.String(length=64), nullable=True)
    )
    op.add_column(
        "activities", sa.Column("group_id", sa.String(length=64), nullable=True)
    )
    op.add_column(
        "activities",
        sa.Column("catalogue_version", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "activities",
        sa.Column("copy_source_uuid", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "activities",
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    connection = op.get_bind()
    existing_ids = [
        row[0] for row in connection.execute(sa.text("SELECT id FROM activities"))
    ]
    for activity_id in existing_ids:
        connection.execute(
            sa.text("UPDATE activities SET client_uuid = :client_uuid WHERE id = :id"),
            {"client_uuid": str(uuid.uuid4()), "id": activity_id},
        )
    connection.execute(
        sa.text(
            "UPDATE activities SET updated_at = created_at WHERE updated_at IS NULL"
        )
    )

    op.alter_column(
        "activities",
        "client_uuid",
        existing_type=sa.String(length=64),
        nullable=False,
    )
    op.alter_column(
        "activities",
        "updated_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
    )

    op.create_index("ix_activities_group_id", "activities", ["group_id"])
    op.create_unique_constraint(
        "uq_activity_client_uuid",
        "activities",
        ["study_id", "participant_id", "client_uuid"],
    )
    op.create_unique_constraint(
        "uq_activity_slot",
        "activities",
        [
            "study_id",
            "participant_id",
            "day_label_id",
            "activity_code",
            "start_minutes",
            "end_minutes",
        ],
    )
    op.create_check_constraint(
        "ck_activity_end_after_start", "activities", "end_minutes > start_minutes"
    )
    op.create_check_constraint(
        "ck_activity_duration_max", "activities", "end_minutes - start_minutes <= 1440"
    )

    # --- timelines: how many activities may cover the same minute ------------
    op.add_column(
        "timelines",
        sa.Column("max_overlap", sa.Integer(), nullable=False, server_default="2"),
    )

    # --- studies: where the reporting day starts -----------------------------
    op.add_column(
        "studies",
        sa.Column(
            "day_start_minutes", sa.Integer(), nullable=False, server_default="0"
        ),
    )
    # Every study that exists at this point was filled in through the old
    # frontend, whose reporting day runs 04:00-04:00. Recording that keeps their
    # coverage numbers exactly as they were; new studies get 0 (D26).
    connection.execute(sa.text("UPDATE studies SET day_start_minutes = 240"))


def downgrade() -> None:
    op.drop_column("studies", "day_start_minutes")
    op.drop_column("timelines", "max_overlap")

    op.drop_constraint("ck_activity_duration_max", "activities", type_="check")
    op.drop_constraint("ck_activity_end_after_start", "activities", type_="check")
    op.drop_constraint("uq_activity_slot", "activities", type_="unique")
    op.drop_constraint("uq_activity_client_uuid", "activities", type_="unique")
    op.drop_index("ix_activities_group_id", table_name="activities")

    op.drop_column("activities", "updated_at")
    op.drop_column("activities", "copy_source_uuid")
    op.drop_column("activities", "catalogue_version")
    op.drop_column("activities", "group_id")
    op.drop_column("activities", "client_uuid")
