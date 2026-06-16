import os

os.environ.setdefault("TUD_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("TUD_ALLOWED_ORIGINS", '["http://localhost:3000"]')
os.environ.setdefault("TUD_API_ADMIN_USERNAME", "admin")
os.environ.setdefault("TUD_API_ADMIN_PASSWORD", "admin")

import pytest

from o_timeusediary_backend import api
from o_timeusediary_backend.settings import TUDBackendSettings


@pytest.mark.asyncio
async def test_lifespan_serve_mode_skips_create_db(monkeypatch):
    monkeypatch.setattr(api.settings, "startup_mode", "serve")

    called = {"value": False}

    def _fake_create_db_and_tables(do_report_contents: bool = False):
        called["value"] = True

    monkeypatch.setattr(api, "create_db_and_tables", _fake_create_db_and_tables)

    async with api.lifespan(api.app):
        pass

    assert called["value"] is False


@pytest.mark.asyncio
async def test_lifespan_bootstrap_mode_runs_create_db(monkeypatch):
    monkeypatch.setattr(api.settings, "startup_mode", "bootstrap")

    called = {"value": False, "arg": None}

    def _fake_create_db_and_tables(do_report_contents: bool = False):
        called["value"] = True
        called["arg"] = do_report_contents

    monkeypatch.setattr(api, "create_db_and_tables", _fake_create_db_and_tables)
    monkeypatch.setattr(api.settings, "print_db_contents_on_startup", True)

    async with api.lifespan(api.app):
        pass

    assert called["value"] is True
    assert called["arg"] is True


def test_settings_reject_invalid_startup_mode(monkeypatch):
    monkeypatch.setenv("TUD_STARTUP_MODE", "invalid_mode")

    with pytest.raises(ValueError, match="TUD_STARTUP_MODE"):
        TUDBackendSettings()
