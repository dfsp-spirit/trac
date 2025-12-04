from fastapi import FastAPI, HTTPException, Request, status, Response, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from fastapi.exceptions import RequestValidationError
import logging
import uuid
from typing import List, Optional, Tuple
from datetime import datetime, timedelta
import csv
import json
import io
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select
from urllib.parse import urlparse
import sys, argparse

from .activities_config import load_activities_config

from .logging_config import setup_logging
setup_logging()
logger = logging.getLogger(__name__)

from . settings import settings
from .models import Activity, Study, Timeline, DayLabel, StudyParticipant, Participant
from .database import get_session, create_db_and_tables

from .api_deps.activities import (
    validate_activity_code_dependency,
    get_activity_info_dependency,
    get_study_activity_codes
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info(f"TUD Backend starting with allowed origins: {settings.allowed_origins}")
    if settings.debug:
        print(f"Debug mode enabled.")

    logger.info("Running on_startup tasks...")
    create_db_and_tables(settings.print_db_contents_on_startup)

    yield


app = FastAPI(title="Timeusediary (TUD) API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Operation"] # custom header to tell frontend on submit if the entry was created or updated.
)



@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """
    Global exception handler that ensures CORS headers are always set,
    even in case of exceptions.
    Otherwise, an internal server error may appear as a CORS error in the
    browser, which is misleading during development.
    This also creates a unique error ID for tracking and systematic logging.
    """
    error_id = str(uuid.uuid4())

    # Log the actual error
    logger.error(f"Unhandled exception ID {error_id}: {str(exc)}", exc_info=True)

    # Determine status code based on exception type
    status_code = 500
    if isinstance(exc, HTTPException):
        status_code = exc.status_code

    # Create response with CORS headers
    response = JSONResponse(
        status_code=status_code,
        content={
            "detail": "Internal server error",
            "error_id": error_id,
            "message": "Something went wrong on our end"
        }
    )

    # Get the origin from the request
    origin = request.headers.get("origin")

    def is_localhost(origin: str) -> bool:
        """Check if the origin corresponds to localhost."""
        if not origin:
            return False
        try:
            parsed = urlparse(origin)
            return parsed.hostname in ["localhost", "127.0.0.1", "::1"]
        except:
            return False

    # Check if the origin is in our configured allowed origins
    if origin in settings.allowed_origins or is_localhost(origin):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Methods"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "*"
        response.headers["Access-Control-Expose-Headers"] = "X-Operation"

    return response


# Add this exception handler for request validation errors
@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(request: Request, exc: RequestValidationError):
    error_id = str(uuid.uuid4())

    # Log detailed error information server-side
    error_details = []
    for error in exc.errors():
        error_details.append({
            "field": " -> ".join(str(loc) for loc in error["loc"]),
            "message": error["msg"],
            "type": error["type"]
        })

    logger.error(
        f"Request Validation error ID {error_id}: "
        f"Path: {request.url.path}, "
        f"Errors: {error_details}, "
        f"Client: {request.client.host if request.client else 'unknown'}"
    )

    # Send generic error to client
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "detail": "Invalid request data",
            "error_id": error_id,
            "message": "Please check your request data format and values"
        }
    )

@app.exception_handler(ValidationError)
async def validation_exception_handler(request: Request, exc: ValidationError):
    # Generate a unique error ID for tracking
    error_id = str(uuid.uuid4())

    # Log detailed error information server-side
    error_details = []
    for error in exc.errors():
        error_details.append({
            "field": " -> ".join(str(loc) for loc in error["loc"]),
            "message": error["msg"],
            "type": error["type"]
        })

    logger.error(
        f"Validation error ID {error_id}: "
        f"Path: {request.url.path}, "
        f"Errors: {error_details}, "
        f"Client: {request.client.host if request.client else 'unknown'}"
    )

    # Send generic error to client
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "detail": "Invalid request data",
            "error_id": error_id,  # Client can reference this if needed
            "message": "Please check your request data format and values"
        }
    )


@app.get("/api")
def root():
    return {"message": "TUD API is running"}

@app.get("/api/health")
def health_check(session: Session = Depends(get_session)):
    count = session.exec(select(Activity)).all()
    return {"status": "healthy", "entries_count": len(count)}


@app.get("/api/debug/routes")
def debug_routes():
    routes = []
    for route in app.routes:
        if hasattr(route, "path") and "/api/studies" in route.path:
            routes.append({
                "path": route.path,
                "methods": getattr(route, "methods", []),
                "name": getattr(route, "name", "")
            })
    return {"routes": routes}

@app.get("/api/studies/{study_name_short}/activities-config")
def get_study_activities_config(
    study_name_short: str,
    session: Session = Depends(get_session)
):
    """
    Get the activities configuration (activities.json) for a study.
    This returns the exact configuration that was used when the study was created.

    Example request:
    curl -X GET "http://localhost:8000/api/studies/default/activities-config" -H "Accept: application/json"
    """
    # Find the study
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()

    if not study:
        raise HTTPException(
            status_code=404,
            detail=f"Study '{study_name_short}' not found"
        )

    # Try to load the activities config from the file
    try:
        activities_config = load_activities_config(study.activities_json_url)
        return activities_config.dict()
    except FileNotFoundError:
        raise HTTPException(
            status_code=500,
            detail=f"Activities configuration file not found: {study.activities_json_url}"
        )
    except Exception as e:
        logger.error(f"Error loading activities config for study {study_name_short}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Error loading activities configuration: {str(e)}"
        )

from pydantic import BaseModel
from typing import List, Optional, Union

class ActivitySubmitItem(BaseModel):
    timeline_key: str
    activity: str  # For reference/debugging and to compute activity path
    category: str  # For reference/debugging and to compute activity path
    code: Optional[int] = None  # For single-choice only
    codes: Optional[List[int]] = None  # For multiple-choice only: several codes for several activities that were done in parallel
    parent_activity_name: Optional[str] = None   # only set if this is a child activity, ignore if these is no parent_activity_code (in that case it is identical to activity, and this is NOT a child activity. frontend should be fixed not to send it then.)
    parent_activity_code: Optional[int] = None   # only set if this is a child activity
    original_selection: Optional[str] = None  # only set if this is a custom text input, it then shows the prompt text like "Other sport, please specify".
    start_minutes: int
    end_minutes: int
    mode: str  # "single-choice" or "multiple-choice"

class ActivitiesSubmitRequest(BaseModel):
    activities: List[ActivitySubmitItem]


def compute_activity_path(activity_item: ActivitySubmitItem) -> str:
    parts = []

    # Always include timeline
    parts.append(f"timeline:{activity_item.timeline_key}")

    # Include category if present and not empty
    if activity_item.category and activity_item.category.strip() and activity_item.category != " ":
        parts.append(f"category:{activity_item.category}")

    # Include parent if different from activity (true hierarchy)
    if (activity_item.parent_activity_code and
        activity_item.parent_activity_name and
        activity_item.parent_activity_name != activity_item.activity):
        parts.append(f"parent:{activity_item.parent_activity_name}")

    if activity_item.original_selection and activity_item.original_selection.strip() and activity_item.original_selection != activity_item.activity:
        parts.append(f"custom_input_prompt:{activity_item.original_selection}")

    # Always include the actual activity
    parts.append(f"activity:{activity_item.activity}")

    return " > ".join(parts)


@app.post("/api/studies/{study_name_short}/participants/{participant_id}/day_labels/{day_label_name}/activities")
def submit_activities(
    study_name_short: str,
    participant_id: str,
    day_label_name: str,
    activities_data: ActivitiesSubmitRequest,
    session: Session = Depends(get_session)
):
    """
    Submit activities for a specific day label in a study.
    Handles both single-choice and multiple-choice timelines.
    Rejects entire submission if any activity code is invalid (frontend-backend config mismatch).
    """
    # Validate study exists
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()
    if not study:
        raise HTTPException(status_code=404, detail=f"Study '{study_name_short}' not found")

    # Get all valid activity codes for this study
    try:
        valid_codes = get_study_activity_codes(study_name_short, session)
    except HTTPException as e:
        # Re-raise the HTTP exception
        raise e
    except Exception as e:
        logger.error(f"Error loading activity codes for study {study_name_short}: {e}")
        raise HTTPException(
            status_code=500,
            detail="Could not load activity configuration for validation"
        )

    # Validate/Create participant based on study settings
    if not study.allow_unlisted_participants:
        # Study restricts participants - check if they're in the allowed list
        study_participant = session.exec(
            select(StudyParticipant).where(
                StudyParticipant.study_id == study.id,
                StudyParticipant.participant_id == participant_id
            )
        ).first()
        if not study_participant:
            logger.info(f"Unauthorized participant '{participant_id}' attempted to submit to study '{study_name_short}'")
            raise HTTPException(
                status_code=403,
                detail=f"Participant '{participant_id}' not authorized for this study"
            )
    else:
        # Study allows unlisted participants - ensure participant exists and is linked to study
        participant = session.exec(
            select(Participant).where(Participant.id == participant_id)
        ).first()

        if not participant:
            # Create the participant since they don't exist yet
            participant = Participant(id=participant_id)
            session.add(participant)
            session.flush()

        # Ensure participant is linked to study (for tracking)
        study_participant = session.exec(
            select(StudyParticipant).where(
                StudyParticipant.study_id == study.id,
                StudyParticipant.participant_id == participant_id
            )
        ).first()

        if not study_participant:
            study_participant = StudyParticipant(
                study_id=study.id,
                participant_id=participant_id
            )
            session.add(study_participant)

    # Validate day label exists for this study
    day_label = session.exec(
        select(DayLabel).where(
            DayLabel.study_id == study.id,
            DayLabel.name == day_label_name
        )
    ).first()
    if not day_label:
        logger.info(f"Day label '{day_label_name}' not found for study '{study_name_short}'")
        raise HTTPException(
            status_code=404,
            detail=f"Day label '{day_label_name}' not found for study '{study_name_short}'"
        )

    # Get all timelines for this study to validate timeline keys
    study_timelines = session.exec(
        select(Timeline).where(Timeline.study_id == study.id)
    ).all()
    timeline_map = {timeline.name: timeline for timeline in study_timelines}

    created_activities = []
    invalid_codes = []

    # PHASE 1: Validate all activity codes before creating any records
    for activity_item in activities_data.activities:
        # Validate timeline exists
        timeline = timeline_map.get(activity_item.timeline_key)
        if not timeline:
            logger.info(f"Unknown timeline '{activity_item.timeline_key}' for study '{study_name_short}'")
            raise HTTPException(
                status_code=400,
                detail=f"Unknown timeline '{activity_item.timeline_key}' for study '{study_name_short}'"
            )

        # Handle single-choice activity
        if activity_item.mode == "single-choice":
            if not activity_item.code:
                raise HTTPException(
                    status_code=400,
                    detail=f"Single-choice activity missing 'code' for timeline '{activity_item.timeline_key}'"
                )

            # Validate the activity code
            if activity_item.code not in valid_codes:
                invalid_codes.append({
                    "code": activity_item.code,
                    "timeline": activity_item.timeline_key,
                    "activity_name": activity_item.activity,
                    "type": "single-choice"
                })

        # Handle multiple-choice activity
        elif activity_item.mode == "multiple-choice":
            if not activity_item.codes:
                logger.info(f"Multiple-choice activity missing 'codes' for timeline '{activity_item.timeline_key}'")
                raise HTTPException(
                    status_code=400,
                    detail=f"Multiple-choice activity missing 'codes' for timeline '{activity_item.timeline_key}'"
                )

            # Validate all codes in this multiple-choice activity
            for code in activity_item.codes:
                if code not in valid_codes:
                    invalid_codes.append({
                        "code": code,
                        "timeline": activity_item.timeline_key,
                        "activity_name": activity_item.activity,
                        "type": "multiple-choice"
                    })

        else:
            logger.info(f"Unknown activity mode '{activity_item.mode}' for study '{study_name_short}'")
            raise HTTPException(
                status_code=400,
                detail=f"Unknown activity mode '{activity_item.mode}'"
            )

    # REJECT ENTIRE SUBMISSION IF ANY INVALID CODE - FATAL CONFIG MISMATCH
    if invalid_codes:
        logger.error(f"FATAL CONFIG MISMATCH: Invalid activity codes detected for study '{study_name_short}'. "
                     f"Frontend-backend configuration mismatch! Invalid codes: {invalid_codes}")
        raise HTTPException(
            status_code=400,
            detail={
                "message": "FATAL: Invalid activity codes detected. Frontend and backend configuration mismatch!",
                "error_type": "configuration_mismatch",
                "invalid_codes": invalid_codes,
                "total_invalid": len(invalid_codes),
                "suggestion": "Check that the activities.json file used by frontend matches the backend configuration at: " + study.activities_json_url
            }
        )

    # PHASE 2: Create all activities (all codes are valid)
    for activity_item in activities_data.activities:
        timeline = timeline_map[activity_item.timeline_key]

        if activity_item.mode == "single-choice":
            activity = Activity(
                study_id=study.id,
                participant_id=participant_id,
                day_label_id=day_label.id,
                timeline_id=timeline.id,
                activity_code=activity_item.code,
                start_minutes=activity_item.start_minutes,
                end_minutes=activity_item.end_minutes,
                activity_name=activity_item.activity,
                activity_path_frontend=compute_activity_path(activity_item),
            )
            session.add(activity)
            created_activities.append(activity)

        elif activity_item.mode == "multiple-choice":
            for code in activity_item.codes:
                activity = Activity(
                    study_id=study.id,
                    participant_id=participant_id,
                    day_label_id=day_label.id,
                    timeline_id=timeline.id,
                    activity_code=code,
                    start_minutes=activity_item.start_minutes,
                    end_minutes=activity_item.end_minutes,
                    activity_name=activity_item.activity,
                    activity_path_frontend=compute_activity_path(activity_item),
                )
                session.add(activity)
                created_activities.append(activity)

    # Commit all activities
    session.commit()

    # Refresh to get IDs
    for activity in created_activities:
        session.refresh(activity)

    return {
        "message": f"Successfully submitted {len(created_activities)} activities",
        "study": study_name_short,
        "participant": participant_id,
        "day_label": day_label_name,
        "activity_count": len(created_activities),
        "validation": "All activity codes validated against study configuration",
        "config_source": study.activities_json_url
    }