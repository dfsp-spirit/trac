"""initial schema baseline

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-06-16 00:00:00.000000

This migration creates the initial schema explicitly, table by table,
matching the SQLModel model definitions as they existed at the time
this migration was authored.  It does *not* use SQLModel.metadata.create_all()
so that subsequent model changes (new columns, type refinements, etc.) do
not leak into this baseline.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── participants ──────────────────────────────────────────────────────
    op.create_table(
        "participants",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
    )

    # ── studies ───────────────────────────────────────────────────────────
    op.create_table(
        "studies",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(), index=True, nullable=False),
        sa.Column("name_short", sa.String(), index=True, unique=True, nullable=False),
        sa.Column("description", sa.JSON(), nullable=True),
        sa.Column("allow_unlisted_participants", sa.Boolean(), nullable=False),
        sa.Column("require_consent", sa.Boolean(), nullable=False),
        sa.Column("is_paused", sa.Boolean(), nullable=False),
        sa.Column("allow_skip_timeuse", sa.Boolean(), nullable=False),
        sa.Column("require_diary_before_external_tasks", sa.Boolean(), nullable=False),
        sa.Column("default_language", sa.String(), nullable=False),
        sa.Column("study_text_intro", sa.JSON(), nullable=True),
        sa.Column("study_text_end_completed", sa.JSON(), nullable=True),
        sa.Column("study_text_end_skipped", sa.JSON(), nullable=True),
        sa.Column("study_text_end_noconsent", sa.JSON(), nullable=True),
        sa.Column("study_text_consent", sa.JSON(), nullable=True),
        sa.Column("activities_json_url", sa.String(), nullable=False),
        sa.Column(
            "data_collection_start",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "data_collection_end",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
    )

    # ── day_labels ────────────────────────────────────────────────────────
    op.create_table(
        "day_labels",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "study_id",
            sa.Integer(),
            sa.ForeignKey("studies.id"),
            nullable=False,
        ),
        sa.Column("name", sa.String(), index=True, nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column("display_name", sa.String(), index=True, nullable=False),
        sa.UniqueConstraint("study_id", "name", name="uq_day_label_study_name"),
        sa.UniqueConstraint(
            "study_id", "display_order", name="uq_day_label_study_display_order"
        ),
    )

    # ── timelines ─────────────────────────────────────────────────────────
    op.create_table(
        "timelines",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "study_id",
            sa.Integer(),
            sa.ForeignKey("studies.id"),
            nullable=False,
        ),
        sa.Column("name", sa.String(), index=True, nullable=False),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("mode", sa.String(), index=True, nullable=False),
        sa.Column("min_coverage", sa.Integer(), nullable=True),
        sa.UniqueConstraint("study_id", "name", name="uq_timeline_study_name"),
    )

    # ── study_participants ────────────────────────────────────────────────
    op.create_table(
        "study_participants",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "study_id",
            sa.Integer(),
            sa.ForeignKey("studies.id"),
            nullable=False,
        ),
        sa.Column(
            "participant_id",
            sa.String(),
            sa.ForeignKey("participants.id"),
            nullable=False,
        ),
        sa.Column("consent_given", sa.Boolean(), nullable=True),
        sa.Column(
            "consent_decided_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column("instructions_completed", sa.Boolean(), nullable=False),
        sa.Column(
            "instructions_completed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "study_id", "participant_id", name="uq_study_participant"
        ),
    )

    # ── activities ────────────────────────────────────────────────────────
    op.create_table(
        "activities",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "study_id",
            sa.Integer(),
            sa.ForeignKey("studies.id"),
            nullable=False,
        ),
        sa.Column(
            "participant_id",
            sa.String(),
            sa.ForeignKey("participants.id"),
            nullable=False,
        ),
        sa.Column(
            "day_label_id",
            sa.Integer(),
            sa.ForeignKey("day_labels.id"),
            nullable=False,
        ),
        sa.Column(
            "timeline_id",
            sa.Integer(),
            sa.ForeignKey("timelines.id"),
            nullable=False,
        ),
        sa.Column("activity_code", sa.Integer(), index=True, nullable=False),
        sa.Column("start_minutes", sa.Integer(), nullable=False),
        sa.Column("end_minutes", sa.Integer(), nullable=False),
        sa.Column("activity_name", sa.String(), index=True, nullable=False),
        sa.Column("activity_path_frontend", sa.String(), nullable=False),
        sa.Column("color", sa.String(), nullable=True),
        sa.Column("category", sa.String(), nullable=True),
        sa.Column("frequency_key", sa.String(), index=True, nullable=True),
        sa.Column("parent_activity_code", sa.Integer(), index=True, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
    )

    # ── study_external_tasks ──────────────────────────────────────────────
    op.create_table(
        "study_external_tasks",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "study_id",
            sa.Integer(),
            sa.ForeignKey("studies.id"),
            index=True,
            nullable=False,
        ),
        sa.Column("task_key", sa.String(), index=True, nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("url", sa.String(), nullable=False),
        sa.Column("confirmation_type", sa.String(), index=True, nullable=False),
        sa.Column("task_level", sa.Integer(), index=True, nullable=False),
        sa.Column("tokens", sa.JSON(), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "study_id", "task_key", name="uq_study_external_task_key"
        ),
    )

    # ── study_external_task_assignments ───────────────────────────────────
    op.create_table(
        "study_external_task_assignments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "external_task_id",
            sa.Integer(),
            sa.ForeignKey("study_external_tasks.id"),
            index=True,
            nullable=False,
        ),
        sa.Column(
            "participant_id",
            sa.String(),
            sa.ForeignKey("participants.id"),
            index=True,
            nullable=False,
        ),
        sa.Column("assigned_token", sa.String(), index=True, nullable=False),
        sa.Column("assignment_order", sa.Integer(), index=True, nullable=False),
        sa.Column("is_confirmed", sa.Boolean(), index=True, nullable=False),
        sa.Column(
            "confirmed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "external_task_id",
            "participant_id",
            name="uq_external_task_assignment_task_participant",
        ),
        sa.UniqueConstraint(
            "external_task_id",
            "assigned_token",
            name="uq_external_task_assignment_task_token",
        ),
    )

    # ── study_activity_config_blobs ───────────────────────────────────────
    op.create_table(
        "study_activity_config_blobs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "study_id",
            sa.Integer(),
            sa.ForeignKey("studies.id"),
            index=True,
            nullable=False,
        ),
        sa.Column("language", sa.String(), index=True, nullable=False),
        sa.Column("activities_json_data", sa.JSON(), nullable=False),
        sa.Column("content_hash", sa.String(), index=True, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "study_id", "language", name="uq_study_activity_blob_study_lang"
        ),
    )

    # ── study_available_timelines ─────────────────────────────────────────
    op.create_table(
        "study_available_timelines",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "study_id",
            sa.Integer(),
            sa.ForeignKey("studies.id"),
            index=True,
            nullable=False,
        ),
        sa.Column("timeline_key", sa.String(), index=True, nullable=False),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("mode", sa.String(), index=True, nullable=False),
        sa.Column("min_coverage", sa.Integer(), nullable=True),
        sa.Column("sort_order", sa.Integer(), index=True, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "study_id",
            "timeline_key",
            name="uq_study_available_timeline_study_key",
        ),
    )

    # ── study_available_categories ────────────────────────────────────────
    op.create_table(
        "study_available_categories",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "study_id",
            sa.Integer(),
            sa.ForeignKey("studies.id"),
            index=True,
            nullable=False,
        ),
        sa.Column(
            "timeline_id",
            sa.Integer(),
            sa.ForeignKey("study_available_timelines.id"),
            index=True,
            nullable=False,
        ),
        sa.Column("category_name", sa.String(), index=True, nullable=False),
        sa.Column("sort_order", sa.Integer(), index=True, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "timeline_id",
            "category_name",
            name="uq_study_available_category_timeline_name",
        ),
    )

    # ── study_available_activities ────────────────────────────────────────
    op.create_table(
        "study_available_activities",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "study_id",
            sa.Integer(),
            sa.ForeignKey("studies.id"),
            index=True,
            nullable=False,
        ),
        sa.Column(
            "timeline_id",
            sa.Integer(),
            sa.ForeignKey("study_available_timelines.id"),
            index=True,
            nullable=False,
        ),
        sa.Column(
            "category_id",
            sa.Integer(),
            sa.ForeignKey("study_available_categories.id"),
            index=True,
            nullable=False,
        ),
        sa.Column("activity_code", sa.Integer(), index=True, nullable=False),
        sa.Column(
            "parent_activity_code", sa.Integer(), index=True, nullable=True
        ),
        sa.Column("is_custom_input", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), index=True, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "study_id",
            "activity_code",
            name="uq_study_available_activity_study_code",
        ),
    )

    # ── study_available_activity_i18n ─────────────────────────────────────
    op.create_table(
        "study_available_activity_i18n",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "activity_id",
            sa.Integer(),
            sa.ForeignKey("study_available_activities.id"),
            index=True,
            nullable=False,
        ),
        sa.Column("language", sa.String(), index=True, nullable=False),
        sa.Column("name", sa.String(), index=True, nullable=False),
        sa.Column("label", sa.String(), nullable=True),
        sa.Column("short", sa.String(), nullable=True),
        sa.Column("vshort", sa.String(), nullable=True),
        sa.Column("examples", sa.String(), nullable=True),
        sa.Column("color", sa.String(), nullable=True),
        sa.Column("frequency_options", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "activity_id",
            "language",
            name="uq_study_available_activity_i18n_activity_lang",
        ),
    )


def downgrade() -> None:
    op.drop_table("study_available_activity_i18n")
    op.drop_table("study_available_activities")
    op.drop_table("study_available_categories")
    op.drop_table("study_available_timelines")
    op.drop_table("study_activity_config_blobs")
    op.drop_table("study_external_task_assignments")
    op.drop_table("study_external_tasks")
    op.drop_table("activities")
    op.drop_table("study_participants")
    op.drop_table("timelines")
    op.drop_table("day_labels")
    op.drop_table("studies")
    op.drop_table("participants")
