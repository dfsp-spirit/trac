"""HTTP-facing wrapper around the study ``name_short`` rule.

Kept separate from ``study_names`` so that module stays free of FastAPI and can
be used by the study-config parser and the CLI as well.
"""

from __future__ import annotations

from fastapi import HTTPException

from ..study_names import InvalidStudyNameShortError, validate_study_name_short


def require_valid_study_name_short(
    value: str, *, source: str = "study name_short"
) -> str:
    """Validate a ``name_short`` from a request and turn a violation into a 400.

    A 400 with the concrete reason is deliberate: the global validation handler
    replaces pydantic details with a generic message, which would leave the admin
    with no idea what to fix.

    @param value The value from the request.
    @param source What to name in the error message.
    @returns The identifier without surrounding whitespace.
    @raises HTTPException With status 400 when the value breaks the rule.
    """
    try:
        return validate_study_name_short(value, source=source)
    except InvalidStudyNameShortError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
