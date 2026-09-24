"""drop the unique constraint on studies.name

Revision ID: 0010_drop_unique_study_name
Revises: 0009_add_study_owner_usernames
Create Date: 2026-09-24 00:00:00.000000

The long study ``name`` is a display label, not an identifier: study lookups,
API paths, participant URLs, admin selectors and the CLI/importer all key off
``name_short`` (which stays unique). Nothing in the application resolves a study
by ``name``, so the unique constraint only forced copies of a study to invent
version suffixes in the label -- and produced confusing failures (e.g. an admin
create blocked by a study that is not visible in their ownership-scoped
overview, or a CLI import silently reporting "already exists in database" for a
duplicate label). Duplicate labels are now allowed and the admin interface only
warns about them.

The plain index ``ix_studies_name`` (created from the model's ``index=True``) is
left in place; only the unique constraint/index is dropped.
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "0010_drop_unique_study_name"
down_revision = "0009_add_study_owner_usernames"
branch_labels = None
depends_on = None

CONSTRAINT_NAME = "uq_studies_name"
TABLE_NAME = "studies"
# PostgreSQL and MSSQL treat a UNIQUE constraint as a named table constraint,
# MySQL/MariaDB implement it as a unique index. Alembic's create_unique_constraint
# in migration 0006 therefore ended up as a constraint in the former and as an
# index in the latter, so the drop has to match the dialect.
CONSTRAINT_DIALECTS = {"postgresql", "mssql"}
INDEX_DIALECTS = {"mysql", "mariadb"}


def _dialect_name() -> str:
    return op.get_bind().dialect.name


def upgrade() -> None:
    dialect_name = _dialect_name()
    if dialect_name in CONSTRAINT_DIALECTS:
        op.drop_constraint(CONSTRAINT_NAME, TABLE_NAME, type_="unique")
        return
    if dialect_name in INDEX_DIALECTS:
        op.drop_index(CONSTRAINT_NAME, table_name=TABLE_NAME)
        return
    raise NotImplementedError(
        f"Unsupported dialect '{dialect_name}' for dropping the unique constraint "
        f"'{CONSTRAINT_NAME}' on '{TABLE_NAME}'"
    )


def downgrade() -> None:
    dialect_name = _dialect_name()
    if dialect_name not in CONSTRAINT_DIALECTS | INDEX_DIALECTS:
        raise NotImplementedError(
            f"Unsupported dialect '{dialect_name}' for recreating the unique "
            f"constraint '{CONSTRAINT_NAME}' on '{TABLE_NAME}'"
        )
    # Works for both flavours: a named table constraint on PostgreSQL/MSSQL, a
    # unique index on MySQL/MariaDB.
    op.create_unique_constraint(CONSTRAINT_NAME, TABLE_NAME, ["name"])
