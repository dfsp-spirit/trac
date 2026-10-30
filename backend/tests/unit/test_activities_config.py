import json
from pathlib import Path

import pytest

from o_timeusediary_backend.parsers.activities_config import (
    ActivitiesConfig,
    get_activity_codes_set,
    get_all_activity_codes,
    validate_multiple_activity_codes,
)


def _example_activities_payload() -> dict:
    return {
        "general": {"app_name": "TRAC"},
        "timeline": {
            "primary": {
                "name": "Primary",
                "mode": "single-choice",
                "categories": [
                    {
                        "name": "Main",
                        "activities": [
                            {
                                "name": "Sleep",
                                "code": 100,
                                "childItems": [{"name": "Nap", "code": 101}],
                            },
                            {"name": "Work", "code": 200},
                        ],
                    }
                ],
            }
        },
    }


def test_get_all_activity_codes_includes_child_context():
    config = ActivitiesConfig(**_example_activities_payload())

    all_codes = get_all_activity_codes(config)

    assert set(all_codes.keys()) == {100, 101, 200}
    assert all_codes[100]["timeline"] == "primary"
    assert all_codes[100]["category"] == "Main"
    assert all_codes[101]["is_child"] is True
    assert all_codes[101]["parent_name"] == "Sleep"


def test_get_activity_codes_set_collects_all_codes():
    config = ActivitiesConfig(**_example_activities_payload())

    assert get_activity_codes_set(config) == {100, 101, 200}


def test_validate_multiple_activity_codes_reports_valid_and_invalid(tmp_path):
    config_file = tmp_path / "activities_test.json"
    config_file.write_text(json.dumps(_example_activities_payload()), encoding="utf-8")

    result = validate_multiple_activity_codes(str(config_file), [100, 999, 200])

    assert result == {
        "valid": [100, 200],
        "invalid": [999],
        "all_valid": False,
    }


def test_activity_label_defaults_to_exact_name_when_missing():
    payload = _example_activities_payload()
    payload["timeline"]["primary"]["categories"][0]["activities"][0]["name"] = (
        "Sleep EXACT"
    )
    payload["timeline"]["primary"]["categories"][0]["activities"][0]["childItems"][0][
        "name"
    ] = "Nap MixedCase"

    config = ActivitiesConfig(**payload)
    all_codes = get_all_activity_codes(config)

    assert all_codes[100]["label"] == "Sleep EXACT"
    assert all_codes[101]["label"] == "Nap MixedCase"


def test_rejects_third_level_activity_nesting():
    payload = _example_activities_payload()
    payload["timeline"]["primary"]["categories"][0]["activities"][0]["childItems"][0][
        "childItems"
    ] = [{"name": "Too Deep", "code": 102}]

    with pytest.raises(
        ValueError,
        match="found 3 levels of activities, but only 2 are allowed",
    ):
        ActivitiesConfig(**payload)


def test_activity_frequency_options_are_optional_and_exposed_in_metadata():
    payload = _example_activities_payload()
    payload["timeline"]["primary"]["categories"][0]["activities"][0][
        "frequency_options"
    ] = [
        {"key": "bi_weekly", "label": "Bi-weekly"},
        {"key": "monthly", "label": "Monthly"},
    ]

    config = ActivitiesConfig(**payload)
    all_codes = get_all_activity_codes(config)

    assert all_codes[100]["frequency_options"] == [
        {"key": "bi_weekly", "label": "Bi-weekly"},
        {"key": "monthly", "label": "Monthly"},
    ]
    assert all_codes[200]["frequency_options"] is None


def test_rejects_duplicate_frequency_option_keys():
    payload = _example_activities_payload()
    payload["timeline"]["primary"]["categories"][0]["activities"][0][
        "frequency_options"
    ] = [
        {"key": "monthly", "label": "Monthly"},
        {"key": "monthly", "label": "Every month"},
    ]

    with pytest.raises(ValueError, match="duplicate key"):
        ActivitiesConfig(**payload)


def test_rejects_empty_frequency_options_list():
    payload = _example_activities_payload()
    payload["timeline"]["primary"]["categories"][0]["activities"][0][
        "frequency_options"
    ] = []

    with pytest.raises(ValueError, match="cannot be an empty list"):
        ActivitiesConfig(**payload)


def test_shipped_activity_configs_keep_the_app_name_for_the_legacy_app():
    """The old app's tab title and footer come from `general.app_name`.

    The rewrite uses its own i18n title, so the key looks unused - but while the
    old app is still served, every config it loads must carry it, or the tab
    falls back to the generic localized page title ("Time Use Diary").
    """
    backend_root = Path(__file__).resolve().parents[2]
    studies = json.loads((backend_root / "studies_config.json").read_text())["studies"]
    referenced = {
        name
        for study in studies
        for name in (study.get("activities_json_files") or {}).values()
    }
    assert referenced, "studies_config.json should reference activity configs"

    missing = []
    for name in sorted(referenced):
        general = json.loads((backend_root / name).read_text())["general"]
        if not general.get("app_name"):
            missing.append(name)

    assert not missing, (
        "these activity configs are served to the old app but have no "
        f"general.app_name: {missing}"
    )
