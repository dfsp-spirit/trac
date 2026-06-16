import os

os.environ.setdefault("TUD_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("TUD_ALLOWED_ORIGINS", '["http://localhost:3000"]')
os.environ.setdefault("TUD_API_ADMIN_USERNAME", "admin")
os.environ.setdefault("TUD_API_ADMIN_PASSWORD", "admin")

from o_timeusediary_backend import cli


def test_cli_studies_import_runs_schema_then_import(monkeypatch, tmp_path, capsys):
    config_path = tmp_path / "studies_config.json"
    config_path.write_text('{"studies": []}', encoding="utf-8")

    calls = []

    def _fake_counts():
        if not calls:
            return {"studies": 0, "participants": 0, "activities": 0}
        return {"studies": 1, "participants": 2, "activities": 3}

    def _fake_initialize_schema():
        calls.append("init")

    def _fake_import(path: str):
        calls.append(("import", path))

    monkeypatch.setattr(cli, "_get_db_counts", _fake_counts)
    monkeypatch.setattr(cli, "initialize_db_schema", _fake_initialize_schema)
    monkeypatch.setattr(cli, "create_config_file_studies_in_database", _fake_import)

    exit_code = cli.main(["studies", "import", "--config", str(config_path)])

    assert exit_code == 0
    assert calls[0] == "init"
    assert calls[1] == ("import", str(config_path.resolve()))
    assert cli.settings.studies_config_path == str(config_path.resolve())

    output = capsys.readouterr().out
    assert "Studies import completed successfully." in output
    assert "studies 0->1" in output


def test_cli_studies_import_no_ensure_schema(monkeypatch, tmp_path):
    config_path = tmp_path / "studies_config.json"
    config_path.write_text('{"studies": []}', encoding="utf-8")

    calls = []

    monkeypatch.setattr(
        cli,
        "_get_db_counts",
        lambda: {"studies": 0, "participants": 0, "activities": 0},
    )
    monkeypatch.setattr(
        cli,
        "initialize_db_schema",
        lambda: calls.append("init"),
    )
    monkeypatch.setattr(
        cli,
        "create_config_file_studies_in_database",
        lambda path: calls.append(("import", path)),
    )

    exit_code = cli.main(
        [
            "studies",
            "import",
            "--config",
            str(config_path),
            "--no-ensure-schema",
        ]
    )

    assert exit_code == 0
    assert calls == [("import", str(config_path.resolve()))]


def test_cli_db_upgrade_dispatch(monkeypatch):
    called = {"revision": None}

    def _fake_run_db_upgrade(revision: str):
        called["revision"] = revision
        return 0

    monkeypatch.setattr(cli, "_run_db_upgrade", _fake_run_db_upgrade)

    exit_code = cli.main(["db", "upgrade", "--revision", "head"])

    assert exit_code == 0
    assert called["revision"] == "head"


def test_cli_db_current_dispatch(monkeypatch):
    called = {"value": False}

    def _fake_run_db_current():
        called["value"] = True
        return 0

    monkeypatch.setattr(cli, "_run_db_current", _fake_run_db_current)

    exit_code = cli.main(["db", "current"])

    assert exit_code == 0
    assert called["value"] is True
