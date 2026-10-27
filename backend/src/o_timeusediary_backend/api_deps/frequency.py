"""Frequency-option validation, shared by the old and the new write paths.

The rule was written for the whole-day save endpoint; the incremental diary API
has to apply exactly the same one, so it lives here instead of in api.py. The
functions take plain values, not the request model, so both callers can use them.
"""

from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Set

from ..parsers.activities_config import ActivitiesConfig, get_all_activity_codes


def allowed_frequency_keys_by_code(
    activities_config: ActivitiesConfig,
) -> Dict[int, Set[str]]:
    """Map activity code to the frequency option keys the study allows."""
    allowed_by_code: Dict[int, Set[str]] = {}
    for code, metadata in get_all_activity_codes(activities_config).items():
        frequency_options = metadata.get("frequency_options") or []
        allowed_by_code[code] = {
            str(option.get("key")).strip()
            for option in frequency_options
            if option.get("key") is not None and str(option.get("key")).strip()
        }
    return allowed_by_code


def frequency_key_errors(
    *,
    frequency_key: Optional[str],
    candidate_codes: Iterable[int],
    allowed_by_code: Dict[int, Set[str]],
    timeline_key: Optional[str] = None,
    activity_name: Optional[str] = None,
) -> List[Dict[str, object]]:
    """Return one error per code that does not accept the submitted key."""
    if frequency_key is None:
        return []

    errors: List[Dict[str, object]] = []
    for code in candidate_codes:
        allowed_keys = allowed_by_code.get(code, set())
        if not allowed_keys:
            errors.append(
                {
                    "code": code,
                    "timeline": timeline_key,
                    "activity_name": activity_name,
                    "frequency_key": frequency_key,
                    "reason": "no_frequency_options_for_activity",
                    "allowed_frequency_keys": [],
                }
            )
            continue
        if frequency_key not in allowed_keys:
            errors.append(
                {
                    "code": code,
                    "timeline": timeline_key,
                    "activity_name": activity_name,
                    "frequency_key": frequency_key,
                    "reason": "frequency_key_not_allowed",
                    "allowed_frequency_keys": sorted(allowed_keys),
                }
            )
    return errors
