from fastapi import FastAPI, HTTPException, Request, status, Response, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
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
from fastapi.templating import Jinja2Templates
from .parsers.activities_config import load_activities_config
import secrets
from .logging_config import setup_logging
setup_logging()
logger = logging.getLogger(__name__)

from .settings import settings
from .models import Activity, Study, Timeline, DayLabel, StudyParticipant, Participant
from .database import get_session, create_db_and_tables, get_timelines_for_study
from pathlib import Path
from .api_deps.activities import (
    validate_activity_code_dependency,
    get_activity_info_dependency,
    get_study_activity_codes
)
from fastapi.responses import HTMLResponse
from datetime import datetime, timezone
from sqlalchemy import func
import csv
import json
from io import StringIO
from typing import Optional
from pydantic import BaseModel, model_validator
from typing import List, Optional, Union


from .utils import utc_now, get_time_for_minutes_from_midnight

security = HTTPBasic()

# Initialize templates with absolute path
current_dir = Path(__file__).parent
templates = Jinja2Templates(directory=str(current_dir / "templates"))
static_dir = Path(__file__).parent / "static"

# get version from __init__.py
import o_timeusediary_backend
tud_version = o_timeusediary_backend.__version__


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info(f"TUD Backend version {tud_version} starting with allowed origins: {settings.allowed_origins}")
    if settings.debug:
        print(f"Debug mode enabled.")

    logger.info("Running on_startup tasks...")
    create_db_and_tables(settings.print_db_contents_on_startup)

    yield


app = FastAPI(title="Timeusediary (TUD) API", version=tud_version, root_path=settings.rootpath, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Operation"] # custom header to tell frontend on submit if the entry was created or updated.
)

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    favicon_path = static_dir / "favicon.ico"
    if favicon_path.exists():
        return FileResponse(favicon_path)
    return Response(status_code=204)

def verify_admin(credentials: HTTPBasicCredentials = Depends(security)):
    correct_username = secrets.compare_digest(
        credentials.username,
        settings.admin_username
    )
    correct_password = secrets.compare_digest(
        credentials.password,
        settings.admin_password
    )

    if not (correct_username and correct_password):
        logger.info(f"Failed admin authentication attempt for user '{credentials.username}'")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin credentials",
            headers={"WWW-Authenticate": "Basic"},
        )

    logger.info(f"Admin '{credentials.username}' authenticated successfully.")

    return credentials.username




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
    activities = session.exec(select(Activity)).all()
    return {"status": "healthy", "entries_count": len(activities)}


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
    participant_id: Optional[str] = Query(None, description="Participant ID for authorization check. Required unless study is open for everyone."),
    session: Session = Depends(get_session)
):
    """
    Get the activities configuration (activities.json) for a study.
    This returns the exact configuration that was used when the study was created, as it is in the file on the server.

    Access is restricted to:
    1. Study is open for everyone (allow_unlisted_participants=True), OR
    2. The provided participant_id is listed as a study participant.

    Example requests:
    - For open study (no auth required):
      GET /api/studies/default/activities-config

    - For restricted study:
      GET /api/studies/restricted-study/activities-config?participant_id=user123
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

    # Check if participant_id is required
    if not study.allow_unlisted_participants:
        # Study restricts participants - participant_id parameter is required
        if participant_id is None:
            raise HTTPException(
                status_code=400,
                detail=f"Participant ID is required for this study. "
                       f"Please provide 'participant_id' query parameter."
            )

        # Check if the participant is authorized for this study
        study_participant = session.exec(
            select(StudyParticipant).where(
                StudyParticipant.study_id == study.id,
                StudyParticipant.participant_id == participant_id
            )
        ).first()

        if not study_participant:
            logger.info(f"Unauthorized participant '{participant_id}' attempted to access activities config for '{study_name_short}'")
            raise HTTPException(
                status_code=403,
                detail=f"Participant '{participant_id}' not authorized for this study"
            )
    else:
        # Study allows unlisted participants
        # If participant_id is provided, we can optionally validate they exist
        if participant_id is not None:
            # Check if participant exists (optional, for logging/validation)
            participant = session.exec(
                select(Participant).where(Participant.id == participant_id)
            ).first()
            if not participant:
                logger.debug(f"Provided participant_id '{participant_id}' doesn't exist for open study '{study_name_short}'")

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
    mode: str  # "single-choice" or "multiple-choice",
    color: Optional[str] = None  # e.g., "#FF0000", used in frontend for display

    @model_validator(mode='after')
    def validate_code_or_codes(self):
        code_provided = self.code is not None
        codes_provided = self.codes is not None and len(self.codes) > 0

        if code_provided and codes_provided:
            raise ValueError('Only one of "code" or "codes" should be provided')
        if not code_provided and not codes_provided:
            raise ValueError('Either "code" or "codes" must be provided')

        # Additional validation based on mode
        if self.mode == "single-choice" and not code_provided:
            raise ValueError('"code" must be provided for single-choice mode')
        if self.mode == "multiple-choice" and not codes_provided:
            raise ValueError('"codes" must be provided for multiple-choice mode')

        return self


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
    If activities already exist for this user-study-day_label combination, they are deleted first.
    """
    # Validate study exists
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()
    if not study:
        raise HTTPException(status_code=404, detail=f"Study '{study_name_short}' not found")


    now = utc_now()

    # Make data_collection_start timezone aware
    if study.data_collection_start.tzinfo is None:
        data_collection_start = study.data_collection_start.replace(tzinfo=timezone.utc)
    else:
        data_collection_start = study.data_collection_start

    # Make data_collection_end timezone aware
    if study.data_collection_end.tzinfo is None:
        data_collection_end = study.data_collection_end.replace(tzinfo=timezone.utc)
    else:
        data_collection_end = study.data_collection_end


    if now < data_collection_start:
        raise HTTPException(
            status_code=403,
            detail=f"Study '{study.name_short}' has not started yet. "
                    f"Data collection starts on {data_collection_start.isoformat()}."
        )

    if now > data_collection_end:
        raise HTTPException(
            status_code=403,
            detail=f"Study '{study.name_short}' has ended. "
                    f"Data collection ended on {data_collection_end.isoformat()}."
        )

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

    # PHASE 2: Check if activities already exist for this user-study-day_label
    existing_activities = session.exec(
        select(Activity).where(
            Activity.study_id == study.id,
            Activity.participant_id == participant_id,
            Activity.day_label_id == day_label.id
        )
    ).all()

    existing_count = len(existing_activities)
    operation = "updated" if existing_count > 0 else "created"

    # Delete existing activities if any (this implements the "edit/replace" logic)
    if existing_count > 0:
        logger.info(f"Deleting {existing_count} existing activities for participant '{participant_id}', "
                   f"study '{study_name_short}', day label '{day_label_name}' before inserting new ones")

        for activity in existing_activities:
            session.delete(activity)

        # Flush to execute deletes before inserts
        session.flush()

    # PHASE 3: Create all new activities (all codes are valid)
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
                color=activity_item.color,
                category=activity_item.category,

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
                    color=activity_item.color,
                    category=activity_item.category,
                )
                session.add(activity)
                created_activities.append(activity)

    # Commit all changes (deletes and inserts)
    session.commit()

    # Refresh to get IDs
    for activity in created_activities:
        session.refresh(activity)

    return {
        "message": f"Successfully {operation} {len(created_activities)} activities",
        "study": study_name_short,
        "participant": participant_id,
        "day_label": day_label_name,
        "activity_count": len(created_activities),
        "previous_activities_deleted": existing_count,
        "operation": operation,
        "validation": "All activity codes validated against study configuration",
        "config_source": study.activities_json_url
    }


@app.get("/admin", response_class=HTMLResponse)
async def admin_overview(
    request: Request,  # Add this parameter
    current_admin: str = Depends(verify_admin),
    session: Session = Depends(get_session)
):
    """
    Admin overview page showing database contents.
    Shows studies, participants, timelines, and activities.
    """

    logger.info(f"Admin '{current_admin}' accessed the admin overview page.")

    # Get all studies with their relationships
    studies = session.exec(
        select(Study).order_by(Study.created_at.desc())
    ).all()

    # Prepare data structure for template
    studies_data = []

    for study in studies:
        # Get day labels for this study
        day_labels = session.exec(
            select(DayLabel)
            .where(DayLabel.study_id == study.id)
            .order_by(DayLabel.display_order)
        ).all()

        # Get timelines for this study
        timelines = session.exec(
            select(Timeline)
            .where(Timeline.study_id == study.id)
        ).all()

        # Get participants for this study
        study_participants = session.exec(
            select(StudyParticipant)
            .where(StudyParticipant.study_id == study.id)
        ).all()

        # Get participant details
        participants = []
        for sp in study_participants:
            participant = session.get(Participant, sp.participant_id)
            if participant:
                # Get activity count for this participant in this study
                participant_activity_count = session.exec(
                    select(func.count(Activity.id))
                    .where(
                        Activity.study_id == study.id,
                        Activity.participant_id == participant.id
                    )
                ).first() or 0

                participants.append({
                    "id": participant.id,
                    "created_at": participant.created_at,
                    "joined_study_at": sp.created_at,
                    "activity_count": participant_activity_count
                })

        # Get activities for this study (first 10 for preview)
        activities = session.exec(
            select(Activity)
            .where(Activity.study_id == study.id)
            .order_by(Activity.created_at.desc())
            .limit(10)
        ).all()

        # Enrich activities with related data
        enriched_activities = []
        for activity in activities:
            participant = session.get(Participant, activity.participant_id)
            day_label = session.get(DayLabel, activity.day_label_id)
            timeline = session.get(Timeline, activity.timeline_id)

            enriched_activities.append({
                "id": activity.id,
                "participant_id": activity.participant_id,
                "participant_name": participant.id if participant else "Unknown",
                "day_label": day_label.name if day_label else "Unknown",
                "day_display_order": day_label.display_order if day_label else 0,
                "day_display_name": day_label.display_name if day_label else "Unknown",
                "timeline": timeline.name if timeline else "Unknown",
                "timeline_display_name": timeline.display_name if timeline else "Unknown",
                "activity_code": activity.activity_code,
                "activity_name": activity.activity_name,
                "activity_path_frontend": activity.activity_path_frontend,
                "category": activity.category,
                "start_minutes": activity.start_minutes,
                "end_minutes": activity.end_minutes,
                "time_range": f"{activity.start_minutes//60:02d}:{activity.start_minutes%60:02d} - {activity.end_minutes//60:02d}:{activity.end_minutes%60:02d}",
                "duration": activity.end_minutes - activity.start_minutes,
                "parent_activity_code": activity.parent_activity_code,
                "created_at": activity.created_at
            })

        # Get total activity count for this study
        total_activities = session.exec(
            select(func.count(Activity.id))
            .where(Activity.study_id == study.id)
        ).first() or 0

        # Get timeline statistics
        timeline_stats = []
        for timeline in timelines:
            timeline_activity_count = session.exec(
                select(func.count(Activity.id))
                .where(
                    Activity.study_id == study.id,
                    Activity.timeline_id == timeline.id
                )
            ).first() or 0

            timeline_stats.append({
                "name": timeline.name,
                "display_name": timeline.display_name,
                "mode": timeline.mode,
                "activity_count": timeline_activity_count,
                "description": timeline.description,
                "min_coverage": timeline.min_coverage
            })

        studies_data.append({
            "study": study,
            "day_labels": day_labels,
            "timelines": timelines,
            "timeline_stats": timeline_stats,
            "participants": participants,
            "activities_preview": enriched_activities,
            "total_activities": total_activities,
            "participant_count": len(participants)
        })

    # Get database-wide statistics
    total_studies = len(studies)

    total_participants = session.exec(
        select(func.count(Participant.id))
    ).first() or 0

    total_activities_all = session.exec(
        select(func.count(Activity.id))
    ).first() or 0

    # Get recent activities (last 10 overall)
    recent_activities = session.exec(
        select(Activity)
        .order_by(Activity.created_at.desc())
        .limit(10)
    ).all()

    enriched_recent_activities = []
    for activity in recent_activities:
        study = session.get(Study, activity.study_id)
        participant = session.get(Participant, activity.participant_id)
        day_label = session.get(DayLabel, activity.day_label_id)
        timeline = session.get(Timeline, activity.timeline_id)

        enriched_recent_activities.append({
            "id": activity.id,
            "study_name_short": study.name_short if study else "Unknown",
            "participant_id": activity.participant_id,
            "participant_name": participant.id if participant else "Unknown",
            "day_label": day_label.name if day_label else "Unknown",
            "day_display_name": day_label.display_name if day_label else "Unknown",
            "day_display_order": day_label.display_order if day_label else 0,
            "category": activity.category if activity else "Unknown",
            "timeline": timeline.name if timeline else "Unknown",
            "activity_name": activity.activity_name,
            "time_range": f"{activity.start_minutes//60:02d}:{activity.start_minutes%60:02d} - {activity.end_minutes//60:02d}:{activity.end_minutes%60:02d}",
            "created_at": activity.created_at
        })

    # Render the template - pass the actual request object, not the class
    return templates.TemplateResponse(
        "admin_overview.html",
        {
            "request": request,  # This should be the request parameter, not Request class
            "current_admin": current_admin,
            "studies_data": studies_data,
            "total_studies": total_studies,
            "total_participants": total_participants,
            "total_activities_all": total_activities_all,
            "recent_activities": enriched_recent_activities,
            "current_time": utc_now()
        }
    )

@app.get("/admin/export/{study_name_short}/activities")
async def export_study_activities(
    request: Request,
    study_name_short: str,
    format: Optional[str] = Query("csv", description="Output format: 'csv' or 'json'"),
    include_metadata: Optional[bool] = Query(True, description="Include metadata columns"),
    include_path: Optional[bool] = Query(True, description="Include activity path columns"),
    current_admin: str = Depends(verify_admin),
    session: Session = Depends(get_session)
):
    """
    Export activities for a specific study in CSV or JSON format.
    Defaults to CSV format for scientific analysis.
    """

    logger.info(f"Admin '{current_admin}' requested export of activities for study '{study_name_short}' in format '{format}'")

    # Validate study exists
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()

    if not study:
        raise HTTPException(
            status_code=404,
            detail=f"Study '{study_name_short}' not found"
        )

    # Get all activities for this study with related data
    activities = session.exec(
        select(
            Activity,
            Participant,
            DayLabel,
            Timeline
        )
        .join(Participant, Activity.participant_id == Participant.id)
        .join(DayLabel, Activity.day_label_id == DayLabel.id)
        .join(Timeline, Activity.timeline_id == Timeline.id)
        .where(Activity.study_id == study.id)
        .order_by(Activity.participant_id, Activity.day_label_id, Activity.start_minutes)
    ).all()

    if not activities:
        raise HTTPException(
            status_code=404,
            detail=f"No activities found for study '{study_name_short}'"
        )

    # Prepare the data with dereferenced fields
    export_data = []
    for activity, participant, day_label, timeline in activities:
        # Format time range
        start_hour = activity.start_minutes // 60
        start_minute = activity.start_minutes % 60
        end_hour = activity.end_minutes // 60
        end_minute = activity.end_minutes % 60

        duration_minutes = activity.end_minutes - activity.start_minutes
        duration_hours = duration_minutes / 60.0

        # Base data that everyone wants
        record = {
            # Core activity data
            "activity_id_backend": activity.id,
            "activity_code": activity.activity_code,
            "activity_name": activity.activity_name,
            "start_time": f"{start_hour:02d}:{start_minute:02d}",
            "end_time": f"{end_hour:02d}:{end_minute:02d}",
            "start_minutes": activity.start_minutes,
            "end_minutes": activity.end_minutes,
            "duration_minutes": duration_minutes,
            "duration_hours": round(duration_hours, 2),
            "category": activity.category,

            # Context data
            "participant_id": participant.id,
            "day_label": day_label.name,
            "timeline_name": timeline.name,
            "timeline_display_name": timeline.display_name,
            "timeline_mode": timeline.mode,

            # Study info
            "study_name": study.name,
            "study_name_short": study.name_short,
            "study_id": study.id,
        }

        # Add parent activity info if available
        if activity.parent_activity_code:
            record["parent_activity_code"] = activity.parent_activity_code
        else:
            record["parent_activity_code"] = ""

        # Add metadata if requested
        if include_metadata:
            record.update({
                "created_at": activity.created_at.isoformat(),
                "data_collection_start": study.data_collection_start.isoformat(),
                "data_collection_end": study.data_collection_end.isoformat(),
                "participant_created_at": participant.created_at.isoformat(),
                "timeline_description": timeline.description or "",
                "timeline_min_coverage": timeline.min_coverage or "",
            })

        # Add activity path components if requested
        if include_path:
            # Parse the activity_path_frontend to get structured components
            path_parts = {}
            if activity.activity_path_frontend:
                parts = activity.activity_path_frontend.split(" > ")
                for part in parts:
                    if ":" in part:
                        key, value = part.split(":", 1)
                        path_parts[f"path_{key}"] = value

            record.update({
                "activity_path_full": activity.activity_path_frontend,
                **path_parts
            })

        export_data.append(record)

    # Generate filename with timestamp
    timestamp = utc_now().strftime("%Y%m%d_%H%M%S")
    filename = f"{study_name_short}_activities_{timestamp}"

    if format.lower() == "json":
        return export_json(export_data, filename)
    else:
        return export_csv(export_data, filename, include_metadata, include_path)


def export_csv(data: list, filename: str, include_metadata: bool, include_path: bool) -> Response:
    """
    Export data as CSV with proper headers. Used in admin interface.
    """
    if not data:
        raise HTTPException(status_code=404, detail="No data to export")

    # Collect all possible fieldnames from all records
    all_fieldnames = set()
    for row in data:
        all_fieldnames.update(row.keys())

    # Convert to list for consistent ordering (you might want to sort them)
    fieldnames = sorted(all_fieldnames)

    # Create CSV in memory
    output = StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames)

    # Write header and data
    writer.writeheader()
    for row in data:
        writer.writerow(row)

    # Prepare response
    content = output.getvalue()
    response = Response(content=content, media_type="text/csv")
    response.headers["Content-Disposition"] = f"attachment; filename={filename}.csv"
    response.headers["Content-Type"] = "text/csv; charset=utf-8"

    return response


def export_json(data: list, filename: str) -> Response:
    """
    Export data as JSON with pretty formatting. Used in admin interface.
    """
    if not data:
        raise HTTPException(status_code=404, detail="No data to export")

    # Create JSON response
    response_data = {
        "metadata": {
            "export_timestamp": utc_now().isoformat(),
            "total_records": len(data),
            "format": "json",
            "version": "1.0"
        },
        "data": data
    }

    content = json.dumps(response_data, indent=2, default=str)
    response = Response(content=content, media_type="application/json")
    response.headers["Content-Disposition"] = f"attachment; filename={filename}.json"
    response.headers["Content-Type"] = "application/json; charset=utf-8"

    return response


def timelines_to_json(timelines: List[Timeline]) -> List[dict]:
    """Convert list of Timeline objects to JSON list with selected fields."""
    return [
        timeline.dict(include={"name", "display_name", "mode", "min_coverage"})
        for timeline in timelines
    ]

@app.get("/api/studies/{study_name_short}/participants/{participant_id}/activities")
def get_participant_day_activities(
    study_name_short: str,
    participant_id: str,
    day_label_name: Optional[str] = Query(None, description="Day label name (e.g., 'monday'). Either this or day_label_index must be provided"),
    day_label_index: Optional[int] = Query(None, description="Day label display order/index. Either this or day_label_name must be provided"),
    template_from_day_index: Optional[int] = Query(None, description="Optional: Day index to use as template source. Defaults to previous day (current_day_index - 1)"),
    session: Session = Depends(get_session)
):
    """
    Get all activities for a specific participant and day in a study.
    This endpoint is for participants to retrieve their own data for editing.
    Returns activities across all timelines for the specified day.

    Either day_label_name or day_label_index must be provided to identify the target day.

    Optionally include activities from a previous day as a template:
    - If template_from_day_index is not provided, defaults to previous day (current_day_index - 1)
    - If template_from_day_index is provided, uses that specific day as template source
    - Returns empty template if specified source day doesn't exist or has no activities
    """
    # Validate that at least one identifier is provided
    if day_label_name is None and day_label_index is None:
        raise HTTPException(
            status_code=400,
            detail="Either day_label_name or day_label_index must be provided"
        )

    # Validate study exists
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()
    if not study:
        raise HTTPException(status_code=404, detail=f"Study '{study_name_short}' not found")

    # Check if participant is authorized for this study
    if not study.allow_unlisted_participants:
        # Study restricts participants - check if they're in the allowed list
        study_participant = session.exec(
            select(StudyParticipant).where(
                StudyParticipant.study_id == study.id,
                StudyParticipant.participant_id == participant_id
            )
        ).first()
        if not study_participant:
            logger.info(f"Unauthorized participant '{participant_id}' attempted to access data from study '{study_name_short}'")
            raise HTTPException(
                status_code=403,
                detail=f"Participant '{participant_id}' not authorized for this study"
            )
    else:
        # Study allows unlisted participants - ensure participant exists
        participant = session.exec(
            select(Participant).where(Participant.id == participant_id)
        ).first()
        if not participant:
            raise HTTPException(
                status_code=403,
                detail=f"Participant '{participant_id}' does not exist for this study"
            )

    # Find the target day label
    day_label = None
    if day_label_name is not None:
        # Find by name
        day_label = session.exec(
            select(DayLabel).where(
                DayLabel.study_id == study.id,
                DayLabel.name == day_label_name
            )
        ).first()
        if not day_label:
            raise HTTPException(
                status_code=404,
                detail=f"Day label '{day_label_name}' not found for study '{study_name_short}'"
            )
    else:
        # Find by index
        day_label = session.exec(
            select(DayLabel).where(
                DayLabel.study_id == study.id,
                DayLabel.display_order == day_label_index
            )
        ).first()
        if not day_label:
            raise HTTPException(
                status_code=404,
                detail=f"Day label with index '{day_label_index}' not found for study '{study_name_short}'"
            )

    study_timelines : List[Timeline] = get_timelines_for_study(study.id)
    study_timelines_json = timelines_to_json(study_timelines)
    study_timelines_names = [t.name for t in study_timelines]


    # Get all activities for this participant and day label
    activities = session.exec(
        select(Activity, Timeline)
        .join(Timeline, Activity.timeline_id == Timeline.id)
        .where(
            Activity.study_id == study.id,
            Activity.participant_id == participant_id,
            Activity.day_label_id == day_label.id
        )
        .order_by(Activity.start_minutes, Activity.timeline_id)
    ).all()

    # Structure the response in a frontend-friendly format
    response_activities = []
    for activity, timeline in activities:
        start_time : str = get_time_for_minutes_from_midnight(activity.start_minutes).isoformat() # something like "08:30:00"
        end_time = get_time_for_minutes_from_midnight(activity.end_minutes).isoformat()
        response_activities.append({
            # Activity data
            "timeline_key": timeline.name,
            "timeline_display_name": timeline.display_name,
            "timeline_mode": timeline.mode,
            "activity": activity.activity_name,
            "activity_code": activity.activity_code,
            "color": activity.color,
            "parent_activity_code": activity.parent_activity_code,
            "activity_path_frontend": activity.activity_path_frontend,
            "start_minutes": activity.start_minutes,
            "end_minutes": activity.end_minutes,
            "start_time": start_time,
            "end_time": end_time,
            "duration": activity.end_minutes - activity.start_minutes,
            "category": activity.category,

            # Metadata
            "created_at": activity.created_at.isoformat(),
            "activity_id_backend": activity.id
        })

    # ========== Get template activities ==========
    template_activities = []
    has_template = False
    template_source_day_label = None
    template_source_day_index = None

    # Determine which day to use as template source
    target_template_index = None
    if template_from_day_index is not None:
        # Use explicitly specified day index
        target_template_index = template_from_day_index
    else:
        # Default to previous day
        target_template_index = day_label.display_order - 1

    # Check if template source day exists
    if target_template_index >= 0:  # Only look for template if index is valid (>= 0)
        template_source_day_label = session.exec(
            select(DayLabel).where(
                DayLabel.study_id == study.id,
                DayLabel.display_order == target_template_index
            )
        ).first()

        if template_source_day_label:
            # Get activities for the template source day for this participant
            template_source_activities = session.exec(
                select(Activity, Timeline)
                .join(Timeline, Activity.timeline_id == Timeline.id)
                .where(
                    Activity.study_id == study.id,
                    Activity.participant_id == participant_id,
                    Activity.day_label_id == template_source_day_label.id
                )
                .order_by(Activity.start_minutes, Activity.timeline_id)
            ).all()

            if template_source_activities:
                has_template = True
                template_source_day_index = template_source_day_label.display_order

                for activity, timeline in template_source_activities:
                    start_time : str = get_time_for_minutes_from_midnight(activity.start_minutes).isoformat() # something like "08:30:00"
                    end_time = get_time_for_minutes_from_midnight(activity.end_minutes).isoformat()
                    template_activities.append({
                        # Activity data
                        "timeline_key": timeline.name,
                        "timeline_display_name": timeline.display_name,
                        "timeline_mode": timeline.mode,
                        "activity": activity.activity_name,
                        "activity_code": activity.activity_code,
                        "color": activity.color,
                        "parent_activity_code": activity.parent_activity_code,
                        "activity_path_frontend": activity.activity_path_frontend,
                        "start_minutes": activity.start_minutes,
                        "end_minutes": activity.end_minutes,
                        "start_time": start_time,
                        "end_time": end_time,
                        "duration": activity.end_minutes - activity.start_minutes,
                        "category": activity.category,

                        # Metadata
                        "created_at": activity.created_at.isoformat(),
                        "activity_id_backend": None,   # No ID yet, since this is just a template and not an actual saved activity for the current day.

                        # Template source information
                        "is_template_from_previous_day": True,
                        "template_source_day_label": template_source_day_label.name,
                        "template_source_day_index": template_source_day_label.display_order
                    })

    print(f"Returning activities for participant '{participant_id}', study '{study_name_short}', "
          f"day label '{day_label.name}' (index: {day_label.display_order}): {len(response_activities)} activities, "
          f"has_template: {has_template}")

    # Determine meta-data on the study, including the number of days
    study_days = session.exec(
        select(DayLabel).where(DayLabel.study_id == study.id)
    ).all()
    study_days_count = len(study_days)

    return {
        "study": study_name_short,
        "study_days_count": study_days_count,
        "participant": participant_id,
        "day_label": day_label.name,
        "day_label_id": day_label.id,
        "day_label_index": day_label.display_order,
        "day_display_name": day_label.display_name,
        "timelines_in_study": study_timelines_json,
        "total_activities": len(response_activities),
        "total_timelines": len(study_timelines_names),
        "total_timelines_with_activities": len(set([a['timeline_key'] for a in response_activities])),
        "activities": response_activities,
        # Template information
        "has_template": has_template,
        "template_source_day_label": template_source_day_label.name if template_source_day_label else None,
        "template_source_day_index": template_source_day_index,
        "template_activities": template_activities if has_template else []
    }


class ActiveOpenStudyResponse(BaseModel):
    name_short: str
    name: Optional[str] = None
    description: Optional[str] = None


@app.get("/api/active_open_study_names", response_model=List[ActiveOpenStudyResponse])
async def get_active_open_study_names(
    session: Session = Depends(get_session)
):
    """
    Public endpoint (no authentication required) that returns a list of all studies
    that:
    1. Have allow_unlisted_participants set to True
    2. Are currently active (current date is between data_collection_start and data_collection_end)

    Each study object includes name_short, name, and description fields.
    Returns empty list if no studies match criteria.
    """
    try:
        # Get current UTC time
        now = utc_now()

        # Query for studies that match both criteria
        studies = session.exec(
            select(Study).where(
                Study.allow_unlisted_participants == True,
                Study.data_collection_start <= now,
                Study.data_collection_end >= now
            ).order_by(Study.name_short)  # Optional: order alphabetically
        ).all()

        # Create response objects with the required fields
        study_responses = [
            ActiveOpenStudyResponse(
                name_short=study.name_short,
                name=study.name,
                description=study.description
            )
            for study in studies
        ]

        logger.info(f"Found {len(study_responses)} active open studies")

        return study_responses

    except Exception as e:
        logger.error(f"Error fetching active open study names: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Internal server error while fetching study information"
        )




class TimelineConfigResponse(BaseModel):
    name: str  # timeline key like "primary", "digitalmediause", "device"
    display_name: str
    description: Optional[str] = None
    mode: str  # "single-choice" or "multiple-choice"
    min_coverage: Optional[int] = None

class DayLabelConfigResponse(BaseModel):
    name: str  # e.g., "monday", "typical_weekend"
    display_order: int
    display_name: Optional[str] = None

class StudyConfigResponse(BaseModel):
    study_name: str
    study_name_short: str
    description: str
    allow_unlisted_participants: bool
    data_collection_start: datetime
    data_collection_end: datetime
    default_language: str
    activities_json_url: str
    timelines: List[TimelineConfigResponse]
    day_labels: List[DayLabelConfigResponse]
    study_days_count: int

@app.get("/api/studies/{study_name_short}/study-config", response_model=StudyConfigResponse)
def get_study_config(
    study_name_short: str,
    participant_id: Optional[str] = Query(None, description="Participant ID for authorization check. Required unless study is open for everyone."),
    session: Session = Depends(get_session)
):
    """
    Get the study configuration including timelines and day labels.
    Access is restricted to:
    1. Study is open for everyone (allow_unlisted_participants=True), OR
    2. The provided participant_id is listed as a study participant.

    Example requests:
    - For open study (no auth required):
      GET /api/studies/default/study-config

    - For restricted study:
      GET /api/studies/restricted-study/study-config?participant_id=user123
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

    # Check if participant_id is required
    if not study.allow_unlisted_participants:
        # Study restricts participants - participant_id parameter is required
        if participant_id is None:
            raise HTTPException(
                status_code=400,
                detail=f"Participant ID is required for this study. "
                       f"Please provide 'participant_id' query parameter."
            )

        # Check if the participant is authorized for this study
        study_participant = session.exec(
            select(StudyParticipant).where(
                StudyParticipant.study_id == study.id,
                StudyParticipant.participant_id == participant_id
            )
        ).first()

        if not study_participant:
            logger.info(f"Unauthorized participant '{participant_id}' attempted to access study config for '{study_name_short}'")
            raise HTTPException(
                status_code=403,
                detail=f"Participant '{participant_id}' not authorized for this study"
            )
    else:
        # Study allows unlisted participants
        # If participant_id is provided, we can optionally validate they exist
        if participant_id is not None:
            # Check if participant exists (optional, for logging/validation)
            participant = session.exec(
                select(Participant).where(Participant.id == participant_id)
            ).first()
            if not participant:
                logger.debug(f"Provided participant_id '{participant_id}' doesn't exist for open study '{study_name_short}'")

    # Get all timelines for this study
    timelines = session.exec(
        select(Timeline).where(Timeline.study_id == study.id)
    ).all()

    # Get all day labels for this study
    day_labels = session.exec(
        select(DayLabel)
        .where(DayLabel.study_id == study.id)
        .order_by(DayLabel.display_order)
    ).all()

    # Prepare response
    timeline_responses = [
        TimelineConfigResponse(
            name=timeline.name,
            display_name=timeline.display_name,
            description=timeline.description,
            mode=timeline.mode,
            min_coverage=timeline.min_coverage
        )
        for timeline in timelines
    ]

    day_label_responses = [
        DayLabelConfigResponse(
            name=day_label.name,
            display_order=day_label.display_order,
            display_name=day_label.display_name
        )
        for day_label in day_labels
    ]

    return StudyConfigResponse(
        study_name=study.name,
        study_name_short=study.name_short,
        description=study.description,
        allow_unlisted_participants=study.allow_unlisted_participants,
        data_collection_start=study.data_collection_start,
        data_collection_end=study.data_collection_end,
        default_language=study.default_language,
        activities_json_url=study.activities_json_url,
        timelines=timeline_responses,
        day_labels=day_label_responses,
        study_days_count=len(day_labels),
    )