"""Tests for the deployment's legal pages (`TUD_IMPRINT_URL`, `TUD_PRIVACY_URL`).

These are server-wide links (imprint, data protection), not study configuration:
every study on the server points at the same institution pages. The frontend
renders them in the menu and - on desktop - in the footer, so an empty or
whitespace-only value has to mean "not configured" instead of rendering a link
that goes nowhere.
"""

import pytest

from o_timeusediary_backend.settings import TUDBackendSettings


def test_unset_values_mean_no_links(monkeypatch):
    monkeypatch.delenv("TUD_IMPRINT_URL", raising=False)
    monkeypatch.delenv("TUD_PRIVACY_URL", raising=False)

    settings = TUDBackendSettings()

    assert settings.imprint_url is None
    assert settings.privacy_url is None


def test_configured_values_are_returned(monkeypatch):
    monkeypatch.setenv("TUD_IMPRINT_URL", "https://example.org/imprint")
    monkeypatch.setenv("TUD_PRIVACY_URL", "https://example.org/privacy")

    settings = TUDBackendSettings()

    assert settings.imprint_url == "https://example.org/imprint"
    assert settings.privacy_url == "https://example.org/privacy"


@pytest.mark.parametrize("value", ["", "   ", "\n"])
def test_blank_values_are_not_configured(monkeypatch, value):
    monkeypatch.setenv("TUD_IMPRINT_URL", value)
    monkeypatch.setenv("TUD_PRIVACY_URL", value)

    settings = TUDBackendSettings()

    assert settings.imprint_url is None
    assert settings.privacy_url is None


def test_surrounding_whitespace_is_trimmed(monkeypatch):
    monkeypatch.setenv("TUD_IMPRINT_URL", "  https://example.org/imprint  ")

    assert TUDBackendSettings().imprint_url == "https://example.org/imprint"
