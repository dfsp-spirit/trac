"""HTTP-facing wrappers around the participant identity rules (id and name).

Kept separate from ``participant_ids`` and ``display_names`` so those modules
stay free of FastAPI and can be used by the study-config parser and the CLI as
well.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from ..display_names import InvalidDisplayNameError, validate_display_name
from ..participant_ids import InvalidParticipantIdError, validate_participant_id


def require_valid_participant_id(
    participant_id: str, *, source: str = "participant id"
) -> str:
    """Validate an id from a request and turn a rule violation into a 400.

    A 400 with the concrete reason is deliberate: the global validation handler
    replaces pydantic details with a generic message, which would leave an admin
    or a participant with no idea what to fix.

    @param participant_id The value from the request.
    @param source What to name in the error message.
    @returns The id without surrounding whitespace.
    @raises HTTPException With status 400 when the id breaks the rule.
    """
    try:
        return validate_participant_id(participant_id, source=source)
    except InvalidParticipantIdError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


def require_valid_display_name(
    value: Any, *, source: str = "display name"
) -> str:
    """Validate a display name from a request and turn a rule violation into a 400.

    Same reason as for ids: the concrete reason ("contains 'U+202E'") is what
    lets an admin fix the roster, and a generic validation error would not say
    it.

    @param value The value from the request.
    @param source What to name in the error message.
    @returns The normalized display name.
    @raises HTTPException With status 400 when the name breaks the rule.
    """
    try:
        return validate_display_name(value, source=source)
    except InvalidDisplayNameError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
