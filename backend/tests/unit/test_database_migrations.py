import os

os.environ.setdefault("TUD_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("TUD_ALLOWED_ORIGINS", '["http://localhost:3000"]')
os.environ.setdefault("TUD_API_ADMIN_USERNAME", "admin")
os.environ.setdefault("TUD_API_ADMIN_PASSWORD", "admin")

from o_timeusediary_backend import database


def test_initialize_db_schema_uses_alembic_upgrade(monkeypatch):
    called = {"revision": None}

    def _fake_upgrade_db_schema(revision: str = "head"):
        called["revision"] = revision

    monkeypatch.setattr(database, "upgrade_db_schema", _fake_upgrade_db_schema)

    database.initialize_db_schema()

    assert called["revision"] == "head"
