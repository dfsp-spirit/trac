from types import SimpleNamespace
import os

os.environ.setdefault("TUD_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("TUD_ALLOWED_ORIGINS", '["http://localhost:3000"]')

from o_timeusediary_backend import api


def test_diary_requirement_lock_disabled_returns_false():
    study = SimpleNamespace(require_diary_before_external_tasks=False)

    is_locked = api._is_external_tasks_locked_by_diary_requirement(
        session=None,
        study=study,
        participant_id="p1",
        study_days_count=7,
    )

    assert is_locked is False


def test_diary_requirement_lock_enabled_returns_true_when_study_incomplete(monkeypatch):
    study = SimpleNamespace(require_diary_before_external_tasks=True)

    monkeypatch.setattr(api, "_is_participant_study_complete", lambda **_: False)

    is_locked = api._is_external_tasks_locked_by_diary_requirement(
        session=None,
        study=study,
        participant_id="p1",
        study_days_count=7,
    )

    assert is_locked is True


def test_diary_requirement_lock_enabled_returns_false_when_study_complete(monkeypatch):
    study = SimpleNamespace(require_diary_before_external_tasks=True)

    monkeypatch.setattr(api, "_is_participant_study_complete", lambda **_: True)

    is_locked = api._is_external_tasks_locked_by_diary_requirement(
        session=None,
        study=study,
        participant_id="p1",
        study_days_count=7,
    )

    assert is_locked is False


def test_expected_return_url_template_fills_known_study_and_task(monkeypatch):
    monkeypatch.setenv("TUD_FRONTEND_URL", "https://frontend.example.org/report/")

    url = api._build_external_task_expected_return_url_template(
        study_name_short="adult_pilot_de",
        task_key="depression_survey",
    )

    assert (
        url
        == "https://frontend.example.org/report/pages/tasks.html"
        "?study_name=adult_pilot_de"
        "&pid={participant_id}"
        "&callback_task_key=depression_survey"
        "&callback_token={assigned_token}"
    )


def test_build_frontend_study_join_url_builds_concrete_participant_link(monkeypatch):
    monkeypatch.setenv("TUD_FRONTEND_URL", "https://frontend.example.org/report/")

    url = api._build_frontend_study_join_url(
        study_name_short="adult pilot/de",
        participant_id="user 1",
    )

    assert (
        url
        == "https://frontend.example.org/report/index.html"
        "?pid=user+1"
        "&study_name=adult+pilot%2Fde"
    )
