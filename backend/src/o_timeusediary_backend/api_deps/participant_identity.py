"""HTTP-facing wrapper around the participant id rule.

Kept separate from ``participant_ids`` so that module stays free of FastAPI and
can be used by the study-config parser and the CLI as well.
"""

from __future__ import annotations

from fastapi import HTTPException

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
