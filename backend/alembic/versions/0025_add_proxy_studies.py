"""add proxy studies: report mode, parent link, encrypted child name, deadline

Revision ID: 0025_add_proxy_studies
Revises: 0024_add_participant_sessions
Create Date: 2026-11-27 00:00:00.000000

A proxy study is filled in by a parent, one questionnaire per child (see
``dev_tools/plans/proxy_studies.md``). Nothing in the existing schema could hold
that: ``activities.participant_id`` is the identity, and the participant id is
also the credential, so the parent -> child relation has to live on the server.

* ``studies.report_mode`` -- ``self`` (the default, every existing study) or
  ``proxy``. A mode, not a flag: a study is never both, and a third report type
  would need a value rather than a second boolean. The CHECK is what makes
  "never mixed" a database fact.
* ``study_participants.proxy_participant_id`` -- on a *child* row, the parent's
  ``participant_id``. The composite foreign key reuses ``uq_study_participant``
  and therefore keeps a link inside one study; the CHECK keeps a row from
  pointing at itself. NULL on every row that exists today, so this migration
  rewrites no data.
* ``study_participants.subject_name_encrypted`` -- the child's first name,
  sealed by ``encrypted_fields.py``. ``String(512)``, not 256: the name rule
  allows 50 *code points*, and 50 four-byte UTF-8 characters seal to ~304
  base64 characters. The plaintext column ``display_name`` stays untouched and
  keeps serving self-report studies.
* ``study_participants.proxy_deadline_at`` -- the family's hard cut-off, stored
  once on the parent row. A plain timestamp on purpose: it identifies nobody and
  has to be compared on every write, which ciphertext cannot do.

All four columns are nullable or defaulted, so an existing deployment upgrades
without a backfill and every current study keeps behaving exactly as before.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0025_add_proxy_studies"
down_revision = "0024_add_participant_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "studies",
        sa.Column(
            "report_mode",
            sa.String(length=16),
            nullable=False,
            # Every study that exists is a self-report study.
            server_default=sa.text("'self'"),
        ),
    )
    op.create_check_constraint(
        "ck_studies_report_mode",
        "studies",
        "report_mode IN ('self', 'proxy')",
    )

    op.add_column(
        "study_participants",
        sa.Column("proxy_participant_id", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "study_participants",
        sa.Column("subject_name_encrypted", sa.String(length=512), nullable=True),
    )
    op.add_column(
        "study_participants",
        sa.Column(
            "proxy_deadline_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )

    # Self-referential, so it has to be created after the column exists. No
    # ON DELETE action: removing a parent that still has children must be an
    # explicit decision, not a silent cascade.
    op.create_foreign_key(
        "fk_study_participant_proxy",
        "study_participants",
        "study_participants",
        ["study_id", "proxy_participant_id"],
        ["study_id", "participant_id"],
    )
    op.create_check_constraint(
        "ck_study_participant_proxy_not_self",
        "study_participants",
        "proxy_participant_id IS NULL OR proxy_participant_id <> participant_id",
    )
    op.create_index(
        "ix_study_participants_proxy",
        "study_participants",
        ["study_id", "proxy_participant_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_study_participants_proxy", table_name="study_participants")
    op.drop_constraint(
        "ck_study_participant_proxy_not_self",
        "study_participants",
        type_="check",
    )
    op.drop_constraint(
        "fk_study_participant_proxy",
        "study_participants",
        type_="foreignkey",
    )
    op.drop_column("study_participants", "proxy_deadline_at")
    op.drop_column("study_participants", "subject_name_encrypted")
    op.drop_column("study_participants", "proxy_participant_id")

    op.drop_constraint("ck_studies_report_mode", "studies", type_="check")
    op.drop_column("studies", "report_mode")
