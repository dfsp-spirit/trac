import os
from types import SimpleNamespace

import pytest

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
        return [
            {
                "study_name_short": "demo",
                "created": True,
                "reason": "",
                "is_error": False,
            }
        ]

    monkeypatch.setattr(cli, "_get_db_counts", _fake_counts)
    monkeypatch.setattr(cli, "initialize_db_schema", _fake_initialize_schema)
    monkeypatch.setattr(cli, "create_config_file_studies_in_database", _fake_import)

    exit_code = cli.main(["studies", "import", "--config", str(config_path)])

    assert exit_code == 0
    assert calls[0] == "init"
    assert calls[1] == ("import", str(config_path.resolve()))
    assert cli.settings.studies_config_path == str(config_path.resolve())

    output = capsys.readouterr().out
    assert "Study import summary:" in output
    assert "Created studies:" in output
    assert "- demo" in output
    assert "studies 0->1" in output


def test_cli_studies_import_supports_multiple_config_files(monkeypatch, tmp_path):
    config_path_one = tmp_path / "studies_config_a.json"
    config_path_two = tmp_path / "studies_config_b.json"
    config_path_one.write_text('{"studies": []}', encoding="utf-8")
    config_path_two.write_text('{"studies": []}', encoding="utf-8")

    calls = []

    monkeypatch.setattr(
        cli,
        "_get_db_counts",
        lambda: {"studies": 0, "participants": 0, "activities": 0},
    )

    def _fake_initialize_schema():
        calls.append("init")

    def _fake_import(path: str):
        calls.append(("import", path))
        study_name = "a" if path == str(config_path_one.resolve()) else "b"
        return [
            {
                "study_name_short": study_name,
                "created": True,
                "reason": "",
                "is_error": False,
            }
        ]

    monkeypatch.setattr(cli, "initialize_db_schema", _fake_initialize_schema)
    monkeypatch.setattr(cli, "create_config_file_studies_in_database", _fake_import)

    exit_code = cli.main(
        [
            "studies",
            "import",
            "--config",
            str(config_path_one),
            "--config",
            str(config_path_two),
        ]
    )

    assert exit_code == 0
    assert calls == [
        "init",
        ("import", str(config_path_one.resolve())),
        ("import", str(config_path_two.resolve())),
    ]
    assert cli.settings.studies_config_path == str(config_path_two.resolve())


def test_cli_studies_import_fails_early_on_duplicate_short_names(monkeypatch, tmp_path):
    config_path_one = tmp_path / "study_alpha.json"
    config_path_two = tmp_path / "study_beta.json"
    config_path_one.write_text('{"studies": []}', encoding="utf-8")
    config_path_two.write_text('{"studies": []}', encoding="utf-8")

    def _fake_load(path: str):
        if path == str(config_path_one.resolve()):
            return SimpleNamespace(studies=[SimpleNamespace(name_short="pilot")])
        if path == str(config_path_two.resolve()):
            return SimpleNamespace(studies=[SimpleNamespace(name_short="pilot")])
        raise AssertionError(f"Unexpected config path: {path}")

    monkeypatch.setattr(cli, "load_studies_config", _fake_load)
    monkeypatch.setattr(
        cli,
        "_get_db_counts",
        lambda: pytest.fail(
            "DB counts should not be queried when duplicate short names exist"
        ),
    )
    monkeypatch.setattr(
        cli,
        "initialize_db_schema",
        lambda: pytest.fail(
            "Schema initialization should not run on duplicate short names"
        ),
    )
    monkeypatch.setattr(
        cli,
        "create_config_file_studies_in_database",
        lambda _: pytest.fail("Import should not start on duplicate short names"),
    )

    exit_code = cli.main(
        [
            "studies",
            "import",
            "--config",
            str(config_path_one),
            "--config",
            str(config_path_two),
        ]
    )
    assert exit_code == 1


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
        lambda path: (
            calls.append(("import", path))
            or [
                {
                    "study_name_short": "demo",
                    "created": True,
                    "reason": "",
                    "is_error": False,
                }
            ]
        ),
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


def test_cli_studies_import_reports_not_created_reason(monkeypatch, tmp_path, capsys):
    config_path = tmp_path / "studies_config.json"
    config_path.write_text('{"studies": []}', encoding="utf-8")

    monkeypatch.setattr(
        cli,
        "_get_db_counts",
        lambda: {"studies": 2, "participants": 5, "activities": 10},
    )
    monkeypatch.setattr(cli, "initialize_db_schema", lambda: None)
    monkeypatch.setattr(
        cli,
        "create_config_file_studies_in_database",
        lambda _path: [
            {
                "study_name_short": "existing_study",
                "created": False,
                "reason": "already exists in database",
                "is_error": False,
            }
        ],
    )

    exit_code = cli.main(["studies", "import", "--config", str(config_path)])
    assert exit_code == 0

    output = capsys.readouterr().out
    assert "Not created studies:" in output
    assert "- existing_study: already exists in database" in output


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


def test_cli_studies_export_runtime_config_writes_zip(monkeypatch, tmp_path, capsys):
    class _DummySession:
        def __init__(self, _engine):
            self._engine = _engine

        def __enter__(self):
            return object()

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(cli, "Session", _DummySession)

    fake_response = SimpleNamespace(
        status_code=200,
        body=b"zip-bytes",
        headers={
            "Content-Disposition": "attachment; filename=studies_config_2026-06-18.zip"
        },
    )
    monkeypatch.setattr(
        cli, "_build_runtime_export_response", lambda _session: fake_response
    )

    out_file = tmp_path / "backup.zip"
    exit_code = cli.main(
        [
            "studies",
            "export-runtime-config",
            "--output",
            str(out_file),
        ]
    )

    assert exit_code == 0
    assert out_file.read_bytes() == b"zip-bytes"
    output = capsys.readouterr().out
    assert "Runtime config backup written to:" in output


def test_extract_filename_from_content_disposition_parses_value():
    filename = cli._extract_filename_from_content_disposition(
        'attachment; filename="studies_config_2026-06-18.zip"',
        fallback="fallback.zip",
    )
    assert filename == "studies_config_2026-06-18.zip"


def test_cli_studies_export_runtime_config_uses_directory_output(monkeypatch, tmp_path):
    class _DummySession:
        def __init__(self, _engine):
            self._engine = _engine

        def __enter__(self):
            return object()

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(cli, "Session", _DummySession)
    fake_response = SimpleNamespace(
        status_code=200,
        body=b"zip-bytes",
        headers={"Content-Disposition": "attachment; filename=my_export.zip"},
    )
    monkeypatch.setattr(
        cli, "_build_runtime_export_response", lambda _session: fake_response
    )

    exit_code = cli.main(
        [
            "studies",
            "export-runtime-config",
            "--output",
            str(tmp_path),
        ]
    )

    assert exit_code == 0
    assert (tmp_path / "my_export.zip").read_bytes() == b"zip-bytes"


class _FakeStudyResult:
    def __init__(self, value):
        self._value = value

    def first(self):
        return self._value

    def one(self):
        return self._value


class _FakeDeleteSession:
    last_committed = False

    def __init__(self, _engine):
        _FakeDeleteSession.last_committed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def exec(self, _statement):
        return _FakeStudyResult(SimpleNamespace(id=1))

    def commit(self):
        _FakeDeleteSession.last_committed = True


class _MissingStudySession(_FakeDeleteSession):
    def exec(self, _statement):
        return _FakeStudyResult(None)


def _patch_studies_delete(monkeypatch, session_class):
    calls = []

    def _fake_delete_study_data(_session, study_name_short):
        calls.append(study_name_short)
        return True

    monkeypatch.setattr(cli, "Session", session_class)
    monkeypatch.setattr(cli, "delete_study_data", _fake_delete_study_data)
    monkeypatch.setattr(
        cli,
        "_study_row_counts",
        lambda _session, _study_id: {"participants": 2, "activities": 3},
    )
    return calls


def test_cli_studies_delete_requires_confirmation_without_yes(monkeypatch, capsys):
    calls = _patch_studies_delete(monkeypatch, _FakeDeleteSession)
    monkeypatch.setattr("sys.stdin", SimpleNamespace(isatty=lambda: False))

    exit_code = cli.main(["studies", "delete", "demo"])

    assert exit_code == 1
    assert calls == []
    assert "Refusing to delete without confirmation" in capsys.readouterr().out


def test_cli_studies_delete_aborts_on_negative_prompt(monkeypatch, capsys):
    calls = _patch_studies_delete(monkeypatch, _FakeDeleteSession)
    monkeypatch.setattr("sys.stdin", SimpleNamespace(isatty=lambda: True))
    monkeypatch.setattr("builtins.input", lambda _prompt: "n")

    exit_code = cli.main(["studies", "delete", "demo"])

    assert exit_code == 1
    assert calls == []
    assert "Aborted." in capsys.readouterr().out


def test_cli_studies_delete_with_yes_deletes_study(monkeypatch, capsys):
    calls = _patch_studies_delete(monkeypatch, _FakeDeleteSession)

    exit_code = cli.main(["studies", "delete", "demo", "--yes"])

    assert exit_code == 0
    assert calls == ["demo"]
    assert _FakeDeleteSession.last_committed is True
    assert "Deleted study 'demo'." in capsys.readouterr().out


def test_cli_studies_delete_dry_run_reports_without_deleting(monkeypatch, capsys):
    calls = _patch_studies_delete(monkeypatch, _FakeDeleteSession)

    exit_code = cli.main(["studies", "delete", "demo", "--dry-run"])

    assert exit_code == 0
    assert calls == []
    assert _FakeDeleteSession.last_committed is False
    output = capsys.readouterr().out
    assert "Would delete study 'demo'" in output
    assert "2 participants, 3 activities" in output


def test_cli_studies_delete_reports_missing_study(monkeypatch, capsys):
    calls = _patch_studies_delete(monkeypatch, _MissingStudySession)

    exit_code = cli.main(["studies", "delete", "missing", "--yes"])

    assert exit_code == 1
    assert calls == []
    assert "Study 'missing' not found." in capsys.readouterr().out
