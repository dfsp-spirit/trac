from fastapi import (
    FastAPI,
    HTTPException,
    Request,
    status,
    Response,
    Depends,
    Query,
    UploadFile,
    File,
    Form,
)
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
import logging
import uuid
from typing import Dict, List, Optional, Set, Tuple, Any
from datetime import datetime
import csv
import json
import re
from sqlmodel import Session, delete, select
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from fastapi.templating import Jinja2Templates
from .parsers.activities_config import (
    ActivitiesConfig,
    get_all_activity_codes,
)
from .parsers.studies_config import (
    CfgFileExternalTask,
    get_external_task_effective_config,
    get_cfg_study_by_name_short,
    validate_external_tasks_for_study,
)
import secrets
from .logging_config import setup_logging, get_admin_audit_logger


from .settings import settings
from .models import (
    Activity,
    Study,
    Timeline,
    DayLabel,
    StudyParticipant,
    Participant,
    StudyActivityConfigBlob,
    StudyExternalTask,
    StudyExternalTaskAssignment,
)
from .models import (
    StudyAvailableTimeline,
    StudyAvailableCategory,
    StudyAvailableActivity,
    StudyAvailableActivityI18n,
)
from .database import (
    get_session,
    create_db_and_tables,
    get_timelines_for_study,
    ensure_external_task_assignments,
)
from pathlib import Path
import hashlib
from .api_deps.activities import get_study_activity_codes
from .api_deps.available_activities import (
    get_activities_cfg_text_for_config,
    get_num_activities_in_cfg_per_timeline,
    get_num_categories_in_cfg_per_timeline,
    get_study_activities_config_model,
)
from fastapi.responses import HTMLResponse
from sqlalchemy import func
from io import StringIO
from pydantic import BaseModel, Field, model_validator
import o_timeusediary_backend

from .utils import utc_now, get_time_for_minutes_from_midnight


setup_logging()
logger = logging.getLogger(__name__)
admin_audit_logger = get_admin_audit_logger()


security = HTTPBasic()


def audit_admin_action(admin_username: str, action_text: str) -> None:
    """Write a high-level admin action entry to the dedicated audit log."""
    admin_audit_logger.info("Admin '%s' %s", admin_username, action_text)


def _normalize_language_code(language: Optional[str]) -> Optional[str]:
    if not isinstance(language, str):
        return None
    normalized = language.strip().lower()
    if not normalized:
        return None
    primary_subtag = normalized.split("-")[0]
    return primary_subtag or None


def _get_localized_study_text(
    study: Study, field_name: str, language: Optional[str] = None
) -> Optional[str]:
    target_language = language or study.default_language
    text_map = getattr(study, field_name, None)

    if not isinstance(text_map, dict) or not text_map:
        return None

    return (
        text_map.get(target_language)
        or text_map.get(study.default_language)
        or text_map.get("en")
    )


def _build_external_task_continuation_url(
    external_task: StudyExternalTask,
    assigned_token: str,
    participant_id: Optional[str] = None,
) -> str:
    parsed_url = urlparse(external_task.url)
    config = external_task.config if isinstance(external_task.config, dict) else {}
    token_query_param = (config.get("token_query_param") or "token").strip()
    send_pid = bool(config.get("send_pid"))
    pid_query_param = (config.get("pid_query_param") or "pid").strip()
    query_items = [
        (key, value)
        for key, value in parse_qsl(parsed_url.query, keep_blank_values=True)
        if key != token_query_param
        and not (send_pid and participant_id and key == pid_query_param)
    ]
    query_items.append((token_query_param, assigned_token))
    if send_pid and participant_id:
        query_items.append((pid_query_param, participant_id))

    return urlunparse(parsed_url._replace(query=urlencode(query_items, doseq=True)))


def _get_participant_external_tasks(
    session: Session, study: Study, participant_id: Optional[str]
) -> List["ParticipantExternalTaskResponse"]:
    if not participant_id:
        return []

    assigned_rows = session.exec(
        select(StudyExternalTaskAssignment, StudyExternalTask)
        .join(
            StudyExternalTask,
            StudyExternalTask.id == StudyExternalTaskAssignment.external_task_id,
        )
        .where(
            StudyExternalTask.study_id == study.id,
            StudyExternalTaskAssignment.participant_id == participant_id,
        )
        .order_by(
            StudyExternalTaskAssignment.assignment_order,
            StudyExternalTask.task_key,
        )
    ).all()

    return [
        ParticipantExternalTaskResponse(
            task_key=external_task.task_key,
            name=external_task.name,
            description=external_task.description,
            confirmation_type=external_task.confirmation_type,
            assigned_token=assignment.assigned_token,
            continuation_url=_build_external_task_continuation_url(
                external_task,
                assignment.assigned_token,
                participant_id=participant_id,
            ),
            is_confirmed=assignment.is_confirmed,
            confirmed_at=assignment.confirmed_at,
        )
        for assignment, external_task in assigned_rows
    ]


def _get_study_participant_association(
    session: Session, study: Study, participant_id: str
) -> Optional[StudyParticipant]:
    return session.exec(
        select(StudyParticipant).where(
            StudyParticipant.study_id == study.id,
            StudyParticipant.participant_id == participant_id,
        )
    ).first()


def _is_participant_study_complete(
    session: Session, study: Study, participant_id: Optional[str], study_days_count: int
) -> bool:
    if not participant_id or study_days_count <= 0:
        return False

    completed_day_count = session.exec(
        select(func.count(func.distinct(Activity.day_label_id))).where(
            Activity.study_id == study.id,
            Activity.participant_id == participant_id,
        )
    ).first()

    return int(completed_day_count or 0) >= study_days_count


# Initialize templates with absolute path
current_dir = Path(__file__).parent
templates = Jinja2Templates(directory=str(current_dir / "templates"))
static_dir = Path(__file__).parent / "static"

# get version from __init__.py


tud_version = o_timeusediary_backend.__version__


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info(
        f"TUD Backend version {tud_version} starting with allowed origins: {settings.allowed_origins}"
    )
    if settings.debug:
        print("Debug mode enabled.")

    logger.info("Running startup tasks...")
    create_db_and_tables(settings.print_db_contents_on_startup)
    logger.info(
        f"Running with rootpath '{settings.rootpath}' and allowed origins: '{settings.allowed_origins}'."
    )
    logger.info(f"TUD Backend version {tud_version} startup tasks completed. Ready.")

    yield


app = FastAPI(
    title="Timeusediary (TUD) API",
    version=tud_version,
    root_path=settings.rootpath,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "X-Operation"
    ],  # custom header to tell frontend on submit if the entry was created or updated.
)


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    """Serve the favicon.ico file.

    @returns The `favicon.ico` file when present, otherwise a 204 No Content response.
    """
    favicon_path = static_dir / "favicon.ico"
    if favicon_path.exists():
        return FileResponse(favicon_path)
    return Response(status_code=204)


def verify_admin(credentials: HTTPBasicCredentials = Depends(security)):
    """Verify admin credentials using HTTP Basic Auth. Raises HTTP 401 if authentication fails.

    @param credentials: HTTPBasicCredentials object containing the username and password provided by the client
    @return: The username of the authenticated admin
    """
    for expected_username, expected_password in settings.admin_credentials:
        correct_username = secrets.compare_digest(
            credentials.username, expected_username
        )
        correct_password = secrets.compare_digest(
            credentials.password, expected_password
        )
        if correct_username and correct_password:
            logger.info(f"Admin '{credentials.username}' authenticated successfully.")
            return credentials.username

    logger.info(
        f"Failed admin authentication attempt for user '{credentials.username}'"
    )
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid admin credentials",
        headers={"WWW-Authenticate": "Basic"},
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

    # Determine status code based on exception type.
    # Some framework-level errors (e.g., HTTPBasic auth failures) are raised as
    # Starlette HTTP exceptions, so we honor any exception carrying a status_code.
    status_code = 500
    if hasattr(exc, "status_code") and isinstance(getattr(exc, "status_code"), int):
        status_code = getattr(exc, "status_code")
    elif isinstance(exc, HTTPException):
        status_code = exc.status_code

    # Create response with CORS headers
    response = JSONResponse(
        status_code=status_code,
        content={
            "detail": "Internal server error",
            "error_id": error_id,
            "message": "Something went wrong on our end",
        },
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
        except Exception as ex:
            logger.debug(
                f"Error parsing origin '{origin}', assuming not localhost. Error details: {ex}"
            )
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
async def request_validation_exception_handler(
    request: Request, exc: RequestValidationError
):
    error_id = str(uuid.uuid4())

    # Log detailed error information server-side
    error_details = []
    for error in exc.errors():
        error_details.append(
            {
                "field": " -> ".join(str(loc) for loc in error["loc"]),
                "message": error["msg"],
                "type": error["type"],
            }
        )

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
            "message": "Please check your request data format and values",
        },
    )


@app.exception_handler(ValidationError)
async def validation_exception_handler(request: Request, exc: ValidationError):
    # Generate a unique error ID for tracking
    error_id = str(uuid.uuid4())

    # Log detailed error information server-side
    error_details = []
    for error in exc.errors():
        error_details.append(
            {
                "field": " -> ".join(str(loc) for loc in error["loc"]),
                "message": error["msg"],
                "type": error["type"],
            }
        )

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
            "message": "Please check your request data format and values",
        },
    )


@app.get("/api")
def root():
    """Root endpoint of the API.

    @returns A JSON object with a backend status/version message.
    """
    return {"message": f"TUD API version {tud_version} is running"}


@app.get("/api/health")
def health_check(session: Session = Depends(get_session)):
    """Health check endpoint to verify that the API is running and can connect to the database.

    @param session Database session dependency.
    @returns A JSON object containing health status, study counters, and backend version.
    """
    all_studies = session.exec(select(Study)).all()
    open_studies = session.exec(
        select(Study).where(Study.allow_unlisted_participants)
    ).all()
    return {
        "status": "healthy",
        "all_studies_count": len(all_studies),
        "open_studies_count": len(open_studies),
        "tud_version": tud_version,
    }


@app.get("/api/docs")
async def redirect_to_docs(request: Request):
    """Redirect the root API endpoint to the automatically generated API documentation at /docs.

    @param request Incoming request used to resolve `root_path`.
    @returns A redirect response to the `/docs` endpoint with root-path awareness.
    """
    root_path = request.scope.get("root_path", "")
    # Ensure no double slashes
    redirect_url = f"{root_path}/docs".replace("//", "/")
    return RedirectResponse(url=redirect_url)


@app.get("/api/studies/{study_name_short}/activities-config")
def get_study_activities_config(
    study_name_short: str,
    lang: Optional[str] = Query(
        None,
        description="Optional language code for activities config (e.g., 'en', 'sv'). Defaults to study default language.",
    ),
    participant_id: Optional[str] = Query(
        None,
        description="Participant ID for authorization check. Required unless study is open for everyone.",
    ),
    session: Session = Depends(get_session),
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

    @param study_name_short The short name of the study to retrieve the activities config for.
    @param participant_id (Optional) Participant ID for authorization checks on restricted studies.
    @param session Database session dependency.
    @returns The activities configuration object for the requested study.
    """
    # Find the study
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()

    if not study:
        raise HTTPException(
            status_code=404, detail=f"Study '{study_name_short}' not found"
        )

    # Check if participant_id is required
    if not study.allow_unlisted_participants:
        # Study restricts participants - participant_id parameter is required
        if participant_id is None:
            raise HTTPException(
                status_code=400,
                detail="Participant ID is required for this study. "
                "Please provide 'participant_id' query parameter.",
            )

        # Check if the participant is authorized for this study
        study_participant = session.exec(
            select(StudyParticipant).where(
                StudyParticipant.study_id == study.id,
                StudyParticipant.participant_id == participant_id,
            )
        ).first()

        if not study_participant:
            logger.info(
                f"Unauthorized participant '{participant_id}' attempted to access activities config for '{study_name_short}'"
            )
            raise HTTPException(
                status_code=403,
                detail=f"Participant '{participant_id}' not authorized for this study",
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
                logger.debug(
                    f"Provided participant_id '{participant_id}' doesn't exist for open study '{study_name_short}'"
                )

    try:
        activities_config, _source, _selected_language = (
            get_study_activities_config_model(
                session=session,
                study=study,
                lang=lang,
            )
        )
        return activities_config.dict()
    except FileNotFoundError:
        raise HTTPException(
            status_code=500,
            detail=f"Activities configuration not found for study '{study_name_short}'",
        )
    except Exception as e:
        logger.error(
            f"Error loading activities config for study {study_name_short}: {e}"
        )
        raise HTTPException(
            status_code=500, detail=f"Error loading activities configuration: {str(e)}"
        )


class ActivitySubmitItem(BaseModel):
    timeline_key: str
    activity: str  # For reference/debugging and to compute activity path
    category: str  # For reference/debugging and to compute activity path
    code: Optional[int] = None  # For single-choice only
    codes: Optional[List[int]] = (
        None  # For multiple-choice only: several codes for several activities that were done in parallel
    )
    parent_activity_name: Optional[str] = (
        None  # only set if this is a child activity, ignore if these is no parent_activity_code (in that case it is identical to activity, and this is NOT a child activity. frontend should be fixed not to send it then.)
    )
    parent_activity_code: Optional[int] = None  # only set if this is a child activity
    original_selection: Optional[str] = (
        None  # only set if this is a custom text input, it then shows the prompt text like "Other sport, please specify".
    )
    start_minutes: int
    end_minutes: int
    mode: str  # "single-choice" or "multiple-choice",
    color: Optional[str] = None  # e.g., "#FF0000", used in frontend for display
    frequency_key: Optional[str] = None

    @model_validator(mode="after")
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

        if self.frequency_key is not None:
            self.frequency_key = self.frequency_key.strip()
            if not self.frequency_key:
                raise ValueError(
                    '"frequency_key" must be a non-empty string when provided'
                )

        return self


class ActivitiesSubmitRequest(BaseModel):
    activities: List[ActivitySubmitItem]


def compute_activity_path(activity_item: ActivitySubmitItem) -> str:
    """Compute the activity path for frontend display based on the activity item details.
    @return A string representing the activity path, e.g. "timeline:Morning > category:Sport > parent:Running > activity:Running (outdoor) > custom_input_prompt:Other sport, please specify". The path includes timeline, category, parent activity (if applicable), the actual activity, and custom input prompt (if applicable).
    """
    parts = []

    # Always include timeline
    parts.append(f"timeline:{activity_item.timeline_key}")

    # Include category if present and not empty
    if (
        activity_item.category
        and activity_item.category.strip()
        and activity_item.category != " "
    ):
        parts.append(f"category:{activity_item.category}")

    # Include parent if different from activity (true hierarchy)
    if (
        activity_item.parent_activity_code
        and activity_item.parent_activity_name
        and activity_item.parent_activity_name != activity_item.activity
    ):
        parts.append(f"parent:{activity_item.parent_activity_name}")

    if (
        activity_item.original_selection
        and activity_item.original_selection.strip()
        and activity_item.original_selection != activity_item.activity
    ):
        parts.append(f"custom_input_prompt:{activity_item.original_selection}")

    # Always include the actual activity
    parts.append(f"activity:{activity_item.activity}")

    return " > ".join(parts)


def _build_allowed_frequency_keys_by_code(
    activities_config: ActivitiesConfig,
) -> Dict[int, Set[str]]:
    """Map activity code to allowed frequency keys from activities config."""
    allowed_by_code: Dict[int, Set[str]] = {}
    activity_info = get_all_activity_codes(activities_config)

    for code, metadata in activity_info.items():
        frequency_options = metadata.get("frequency_options") or []
        allowed_by_code[code] = {
            str(option.get("key")).strip()
            for option in frequency_options
            if option.get("key") is not None and str(option.get("key")).strip()
        }

    return allowed_by_code


def _validate_frequency_key_for_codes(
    activity_item: ActivitySubmitItem,
    candidate_codes: List[int],
    allowed_frequency_keys_by_code: Dict[int, Set[str]],
) -> List[Dict[str, object]]:
    """Return validation errors for a submitted frequency_key against one or more activity codes."""
    if activity_item.frequency_key is None:
        return []

    errors: List[Dict[str, object]] = []
    frequency_key = activity_item.frequency_key

    for code in candidate_codes:
        allowed_keys = allowed_frequency_keys_by_code.get(code, set())

        if not allowed_keys:
            errors.append(
                {
                    "code": code,
                    "timeline": activity_item.timeline_key,
                    "activity_name": activity_item.activity,
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
                    "timeline": activity_item.timeline_key,
                    "activity_name": activity_item.activity,
                    "frequency_key": frequency_key,
                    "reason": "frequency_key_not_allowed",
                    "allowed_frequency_keys": sorted(allowed_keys),
                }
            )

    return errors


@app.post(
    "/api/studies/{study_name_short}/participants/{participant_id}/day_labels/{day_label_name}/activities"
)
def submit_activities(
    study_name_short: str,
    participant_id: str,
    day_label_name: str,
    activities_data: ActivitiesSubmitRequest,
    session: Session = Depends(get_session),
):
    """
    Submit activities for a specific day label in a study.
    Handles both single-choice and multiple-choice timelines.
    Rejects entire submission if any activity code is invalid (frontend-backend config mismatch).
    If activities already exist for this user-study-day_label combination, they are deleted first.

    @param study_name_short The short name of the study.
    @param participant_id The participant ID submitting the activities.
    @param day_label_name The day label these activities belong to.
    @param activities_data The submitted activities payload.
    @param session Database session dependency.
    @returns A JSON response indicating success and submission metadata.
    """
    # Validate study exists
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()
    if not study:
        raise HTTPException(
            status_code=404, detail=f"Study '{study_name_short}' not found"
        )

    now = utc_now()

    if now < study.data_collection_start:
        raise HTTPException(
            status_code=403,
            detail=f"Study '{study.name_short}' has not started yet. "
            f"Data collection starts on {study.data_collection_start.isoformat()}.",
        )

    if now > study.data_collection_end:
        raise HTTPException(
            status_code=403,
            detail=f"Study '{study.name_short}' has ended. "
            f"Data collection ended on {study.data_collection_end.isoformat()}.",
        )

    if study.is_paused:
        raise HTTPException(
            status_code=403,
            detail=f"Study '{study.name_short}' is currently paused.",
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
            detail="Could not load activity configuration for validation",
        )

    try:
        activities_config, _source, _selected_language = (
            get_study_activities_config_model(
                session=session,
                study=study,
                lang=None,
            )
        )
        allowed_frequency_keys_by_code = _build_allowed_frequency_keys_by_code(
            activities_config
        )
    except Exception as e:
        logger.error(
            "Error loading activities config for frequency validation in study %s: %s",
            study_name_short,
            e,
        )
        raise HTTPException(
            status_code=500,
            detail="Could not load activity configuration for frequency validation",
        )

    # Validate/Create participant based on study settings
    if not study.allow_unlisted_participants:
        # Study restricts participants - check if they're in the allowed list
        study_participant = session.exec(
            select(StudyParticipant).where(
                StudyParticipant.study_id == study.id,
                StudyParticipant.participant_id == participant_id,
            )
        ).first()
        if not study_participant:
            logger.info(
                f"Unauthorized participant '{participant_id}' attempted to submit to study '{study_name_short}'"
            )
            raise HTTPException(
                status_code=403,
                detail=f"Participant '{participant_id}' not authorized for this study",
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
                StudyParticipant.participant_id == participant_id,
            )
        ).first()

        if not study_participant:
            study_participant = StudyParticipant(
                study_id=study.id, participant_id=participant_id
            )
            session.add(study_participant)

    # Validate day label exists for this study
    day_label = session.exec(
        select(DayLabel).where(
            DayLabel.study_id == study.id, DayLabel.name == day_label_name
        )
    ).first()
    if not day_label:
        logger.info(
            f"Day label '{day_label_name}' not found for study '{study_name_short}'"
        )
        raise HTTPException(
            status_code=404,
            detail=f"Day label '{day_label_name}' not found for study '{study_name_short}'",
        )

    # Get all timelines for this study to validate timeline keys
    study_timelines = session.exec(
        select(Timeline).where(Timeline.study_id == study.id)
    ).all()
    timeline_map = {timeline.name: timeline for timeline in study_timelines}

    created_activities = []
    invalid_codes = []
    invalid_frequency_keys = []

    # PHASE 1: Validate all activity codes before creating any records
    for activity_item in activities_data.activities:
        # Validate timeline exists
        timeline = timeline_map.get(activity_item.timeline_key)
        if not timeline:
            logger.info(
                f"Unknown timeline '{activity_item.timeline_key}' for study '{study_name_short}'"
            )
            raise HTTPException(
                status_code=400,
                detail=f"Unknown timeline '{activity_item.timeline_key}' for study '{study_name_short}'",
            )

        # Handle single-choice activity
        if activity_item.mode == "single-choice":
            if not activity_item.code:
                raise HTTPException(
                    status_code=400,
                    detail=f"Single-choice activity missing 'code' for timeline '{activity_item.timeline_key}'",
                )

            # Validate the activity code
            if activity_item.code not in valid_codes:
                invalid_codes.append(
                    {
                        "code": activity_item.code,
                        "timeline": activity_item.timeline_key,
                        "activity_name": activity_item.activity,
                        "type": "single-choice",
                    }
                )
            else:
                invalid_frequency_keys.extend(
                    _validate_frequency_key_for_codes(
                        activity_item=activity_item,
                        candidate_codes=[activity_item.code],
                        allowed_frequency_keys_by_code=allowed_frequency_keys_by_code,
                    )
                )

        # Handle multiple-choice activity
        elif activity_item.mode == "multiple-choice":
            if not activity_item.codes:
                logger.info(
                    f"Multiple-choice activity missing 'codes' for timeline '{activity_item.timeline_key}'"
                )
                raise HTTPException(
                    status_code=400,
                    detail=f"Multiple-choice activity missing 'codes' for timeline '{activity_item.timeline_key}'",
                )

            # Validate all codes in this multiple-choice activity
            for code in activity_item.codes:
                if code not in valid_codes:
                    invalid_codes.append(
                        {
                            "code": code,
                            "timeline": activity_item.timeline_key,
                            "activity_name": activity_item.activity,
                            "type": "multiple-choice",
                        }
                    )

            valid_codes_for_frequency = [
                code for code in activity_item.codes if code in valid_codes
            ]
            if valid_codes_for_frequency:
                invalid_frequency_keys.extend(
                    _validate_frequency_key_for_codes(
                        activity_item=activity_item,
                        candidate_codes=valid_codes_for_frequency,
                        allowed_frequency_keys_by_code=allowed_frequency_keys_by_code,
                    )
                )

        else:
            logger.info(
                f"Unknown activity mode '{activity_item.mode}' for study '{study_name_short}'"
            )
            raise HTTPException(
                status_code=400, detail=f"Unknown activity mode '{activity_item.mode}'"
            )

    # REJECT ENTIRE SUBMISSION IF ANY INVALID CODE - FATAL CONFIG MISMATCH
    if invalid_codes:
        logger.error(
            f"FATAL CONFIG MISMATCH: Invalid activity codes detected for study '{study_name_short}'. "
            f"Frontend-backend configuration mismatch! Invalid codes: {invalid_codes}"
        )
        raise HTTPException(
            status_code=400,
            detail={
                "message": "FATAL: Invalid activity codes detected. Frontend and backend configuration mismatch!",
                "error_type": "configuration_mismatch",
                "invalid_codes": invalid_codes,
                "total_invalid": len(invalid_codes),
                "suggestion": "Check that the activities.json file used by frontend matches the backend configuration at: "
                + study.activities_json_url,
            },
        )

    if invalid_frequency_keys:
        logger.error(
            "Invalid frequency_key values detected for study '%s': %s",
            study_name_short,
            invalid_frequency_keys,
        )
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Invalid frequency_key submitted for one or more activities.",
                "error_type": "invalid_frequency_key",
                "invalid_frequency_keys": invalid_frequency_keys,
                "total_invalid": len(invalid_frequency_keys),
                "suggestion": "Use one of the configured frequency option keys for the selected activity code.",
            },
        )

    # PHASE 2: Check if activities already exist for this user-study-day_label
    existing_activities = session.exec(
        select(Activity).where(
            Activity.study_id == study.id,
            Activity.participant_id == participant_id,
            Activity.day_label_id == day_label.id,
        )
    ).all()

    existing_count = len(existing_activities)
    operation = "updated" if existing_count > 0 else "created"

    # Delete existing activities if any (this implements the "edit/replace" logic)
    if existing_count > 0:
        logger.info(
            f"Deleting {existing_count} existing activities for participant '{participant_id}', "
            f"study '{study_name_short}', day label '{day_label_name}' before inserting new ones"
        )

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
                frequency_key=activity_item.frequency_key,
                parent_activity_code=activity_item.parent_activity_code,
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
                    frequency_key=activity_item.frequency_key,
                    parent_activity_code=activity_item.parent_activity_code,
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
        "config_source": study.activities_json_url,
    }


@app.get("/admin", name="Admin Overview Page", response_class=HTMLResponse)
async def admin_overview(
    request: Request,
    current_admin: str = Depends(verify_admin),
    session: Session = Depends(get_session),
):
    """
    Admin overview page showing database contents.
    Shows studies, participants, timelines, and activities.
    @param request FastAPI request object for template rendering.
    @param current_admin Authenticated admin username from Basic Auth dependency.
    @param session Database session dependency.
    @returns An HTML admin overview page with studies, participants, timelines, and activities.
    """

    logger.info(f"Admin '{current_admin}' accessed the admin overview page.")
    audit_admin_action(current_admin, "opened admin overview page")

    # Get all studies with their relationships
    studies = session.exec(select(Study).order_by(Study.created_at.desc())).all()

    # Prepare data structure for template
    studies_data = []

    for study in studies:
        cfg_study = get_cfg_study_by_name_short(
            study.name_short, settings.studies_config_path
        )
        supported_cfg_languages = (
            cfg_study.get_supported_languages()
            if cfg_study
            else [study.default_language]
        )
        cfg_language_query_param = f"cfg_lang_{study.name_short}"
        selected_cfg_language = (
            request.query_params.get(cfg_language_query_param) or study.default_language
        )
        if selected_cfg_language not in supported_cfg_languages:
            selected_cfg_language = study.default_language

        activities_config, activities_config_source, selected_cfg_language_effective = (
            get_study_activities_config_model(
                session=session,
                study=study,
                lang=selected_cfg_language,
            )
        )
        selected_cfg_language = selected_cfg_language_effective

        # Get day labels for this study
        day_labels = session.exec(
            select(DayLabel)
            .where(DayLabel.study_id == study.id)
            .order_by(DayLabel.display_order)
        ).all()

        study_is_currently_collecting = (
            study.data_collection_start <= utc_now() <= study.data_collection_end
            and not study.is_paused
        )

        # Get timelines for this study
        timelines = session.exec(
            select(Timeline).where(Timeline.study_id == study.id)
        ).all()

        # Get participants for this study
        study_participants = session.exec(
            select(StudyParticipant).where(StudyParticipant.study_id == study.id)
        ).all()

        # Get participant details
        participants = []
        for sp in study_participants:
            participant = session.get(Participant, sp.participant_id)
            if participant:
                # Get activity count for this participant in this study
                participant_activity_count = (
                    session.exec(
                        select(func.count(Activity.id)).where(
                            Activity.study_id == study.id,
                            Activity.participant_id == participant.id,
                        )
                    ).first()
                    or 0
                )

                participants.append(
                    {
                        "id": participant.id,
                        "created_at": participant.created_at,
                        "joined_study_at": sp.created_at,
                        "consent_given": sp.consent_given,
                        "consent_decided_at": sp.consent_decided_at,
                        "activity_count": participant_activity_count,
                    }
                )

        # Get logged activities from DB for this study (first 10 for preview)
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

            enriched_activities.append(
                {
                    "id": activity.id,
                    "participant_id": activity.participant_id,
                    "participant_name": participant.id if participant else "Unknown",
                    "day_label": day_label.name if day_label else "Unknown",
                    "day_display_order": day_label.display_order if day_label else 0,
                    "day_display_name": day_label.display_name
                    if day_label
                    else "Unknown",
                    "timeline": timeline.name if timeline else "Unknown",
                    "timeline_display_name": timeline.display_name
                    if timeline
                    else "Unknown",
                    "activity_code": activity.activity_code,
                    "activity_name": activity.activity_name,
                    "activity_path_frontend": activity.activity_path_frontend,
                    "category": activity.category,
                    "start_minutes": activity.start_minutes,
                    "end_minutes": activity.end_minutes,
                    "time_range": f"{activity.start_minutes // 60:02d}:{activity.start_minutes % 60:02d} - {activity.end_minutes // 60:02d}:{activity.end_minutes % 60:02d}",
                    "duration": activity.end_minutes - activity.start_minutes,
                    "parent_activity_code": activity.parent_activity_code,
                    "created_at": activity.created_at,
                }
            )

        last_study_activity = session.exec(
            select(Activity)
            .where(Activity.study_id == study.id)
            .order_by(Activity.created_at.desc())
            .limit(1)
        ).first()

        last_study_activity_time = (
            last_study_activity.created_at if last_study_activity else None
        )

        # create a string like "3h 15m ago" for last_study_activity_time
        last_activity_time_str_ago = None
        if last_study_activity_time:
            time_diff = utc_now() - last_study_activity_time
            hours, remainder = divmod(int(time_diff.total_seconds()), 3600)
            minutes, _ = divmod(remainder, 60)
            last_activity_time_str_ago = f"{hours}h {minutes}m ago"

        # Get total activity count for this study in database
        total_activities_logged = (
            session.exec(
                select(func.count(Activity.id)).where(Activity.study_id == study.id)
            ).first()
            or 0
        )

        external_task_rows = session.exec(
            select(StudyExternalTask)
            .where(StudyExternalTask.study_id == study.id)
            .order_by(StudyExternalTask.task_key)
        ).all()
        external_tasks = []
        external_task_assignment_count = 0
        for external_task in external_task_rows:
            assignment_rows = session.exec(
                select(StudyExternalTaskAssignment)
                .where(StudyExternalTaskAssignment.external_task_id == external_task.id)
                .order_by(
                    StudyExternalTaskAssignment.assignment_order,
                    StudyExternalTaskAssignment.participant_id,
                )
            ).all()
            external_task_assignment_count += len(assignment_rows)
            external_tasks.append(
                {
                    "task_key": external_task.task_key,
                    "name": external_task.name,
                    "description": external_task.description,
                    "url": external_task.url,
                    "confirmation_type": external_task.confirmation_type,
                    "token_count": len(external_task.tokens),
                    "assignment_count": len(assignment_rows),
                    "assignments": [
                        {
                            "participant_id": assignment.participant_id,
                            "assigned_token": assignment.assigned_token,
                            "assignment_order": assignment.assignment_order,
                            "is_confirmed": assignment.is_confirmed,
                            "confirmed_at": assignment.confirmed_at,
                        }
                        for assignment in assignment_rows
                    ],
                }
            )

        num_activities_in_cfgfile_by_timeline = get_num_activities_in_cfg_per_timeline(
            activities_config
        )
        num_categories_in_cfgfile_per_timeline = get_num_categories_in_cfg_per_timeline(
            activities_config
        )
        activities_cfg_text = get_activities_cfg_text_for_config(
            activities_config, short=True, no_duplicate_parts=True
        )

        num_activities_in_cfgfile_total = sum(
            num_activities_in_cfgfile_by_timeline.values()
        )
        num_categories_in_cfgfile_total = sum(
            num_categories_in_cfgfile_per_timeline.values()
        )

        # Get timeline statistics
        timeline_stats = []
        for timeline in timelines:
            timeline_activity_count = (
                session.exec(
                    select(func.count(Activity.id)).where(
                        Activity.study_id == study.id,
                        Activity.timeline_id == timeline.id,
                    )
                ).first()
                or 0
            )

            timeline_num_activities_cfg_file: int = (
                num_activities_in_cfgfile_by_timeline.get(timeline.name, 0)
            )
            timeline_num_categories_cfg_file: int = (
                num_categories_in_cfgfile_per_timeline.get(timeline.name, 0)
            )

            timeline_stats.append(
                {
                    "name": timeline.name,
                    "display_name": timeline.display_name,
                    "mode": timeline.mode,
                    "activity_count": timeline_activity_count,  # instances recorded in database by participants
                    "activity_count_cfg_file": timeline_num_activities_cfg_file,  # different ones available in activities.json
                    "category_count_cfg_file": timeline_num_categories_cfg_file,  # different ones available in activities.json
                    "description": timeline.description,
                    "min_coverage": timeline.min_coverage,
                }
            )

        studies_data.append(
            {
                "study": study,
                "require_consent": bool(getattr(cfg_study, "require_consent", False)),
                "day_labels": day_labels,
                "is_actively_collecting": study_is_currently_collecting,
                "timelines": timelines,
                "timeline_stats": timeline_stats,
                "participants": participants,
                "external_tasks": external_tasks,
                "external_task_count": len(external_tasks),
                "external_task_assignment_count": external_task_assignment_count,
                "activities_preview": enriched_activities,
                "total_activities_logged": total_activities_logged,
                "total_activities_cfg": num_activities_in_cfgfile_total,
                "total_categories_cfg": num_categories_in_cfgfile_total,
                "activities_cfg_text": activities_cfg_text,  # condensed text view of config-file activities
                "activities_cfg_source": activities_config_source,
                "supported_cfg_languages": supported_cfg_languages,
                "selected_cfg_language": selected_cfg_language,
                "cfg_language_query_param": cfg_language_query_param,
                "last_activity_time": last_study_activity_time,  # when last activity was logged for this study by a user
                "last_activity_time_str_ago": last_activity_time_str_ago,  # human readable "3h 15m ago"
                "participant_count": len(participants),
            }
        )

    # Get database-wide statistics
    total_studies = len(studies)

    total_participants = session.exec(select(func.count(Participant.id))).first() or 0

    total_activities_all = session.exec(select(func.count(Activity.id))).first() or 0

    # Get recent activities (last 10 overall)
    recent_activities = session.exec(
        select(Activity).order_by(Activity.created_at.desc()).limit(20)
    ).all()

    enriched_recent_activities = []
    for activity in recent_activities:
        study = session.get(Study, activity.study_id)
        participant = session.get(Participant, activity.participant_id)
        day_label = session.get(DayLabel, activity.day_label_id)
        timeline = session.get(Timeline, activity.timeline_id)

        enriched_recent_activities.append(
            {
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
                "activity_code": activity.activity_code,
                "time_range": f"{activity.start_minutes // 60:02d}:{activity.start_minutes % 60:02d} - {activity.end_minutes // 60:02d}:{activity.end_minutes % 60:02d}",
                "created_at": activity.created_at,
            }
        )

    # Render template manually to avoid Starlette TemplateResponse caching issues with wheel-installed packages.
    # When templates are installed from a wheel, Starlette's TemplateResponse cache fails with "unhashable type: dict".
    context_dict = {
        "request": request,
        "current_admin": current_admin,
        "studies_data": studies_data,
        "total_studies": total_studies,
        "active_studies_count": sum(
            1 for s in studies_data if s["is_actively_collecting"]
        ),
        "total_participants": total_participants,
        "total_activities_all": total_activities_all,
        "recent_activities": enriched_recent_activities,
        "current_time": utc_now(),
    }
    template = templates.get_template("admin_overview.html")
    html_content = template.render(context_dict)
    return HTMLResponse(content=html_content)


class AssignParticipantsRequest(BaseModel):
    participant_ids: List[str]
    must_be_new: bool = False


class UpdateStudyCollectionWindowRequest(BaseModel):
    data_collection_start: Optional[datetime] = None
    data_collection_end: Optional[datetime] = None


class ImportStudiesConfigStudy(BaseModel):
    name: str
    name_short: str
    description: Optional[str] = None
    day_labels: List[Dict]
    study_participant_ids: List[str] = []
    allow_unlisted_participants: bool = True
    default_language: str = "en"
    supported_languages: List[str]
    activities_json_data: Optional[Dict[str, Dict]] = None
    activities_json_files: Optional[Dict[str, str]] = None
    require_consent: bool = False
    is_paused: bool = False
    external_tasks: List[CfgFileExternalTask] = Field(default_factory=list)
    study_text_intro: Optional[Dict[str, str]] = None
    study_text_end_completed: Optional[Dict[str, str]] = None
    study_text_end_skipped: Optional[Dict[str, str]] = None
    study_text_end_noconsent: Optional[Dict[str, str]] = None
    study_text_consent: Optional[Dict[str, str]] = None
    data_collection_start: datetime
    data_collection_end: datetime


class UpdateConsentRequest(BaseModel):
    consent_given: bool


class ImportStudiesConfigRequest(BaseModel):
    mode: str = "create_only"
    transaction_mode: str = "all_or_nothing"
    studies: List[ImportStudiesConfigStudy]


def _normalize_languages(languages: List[str]) -> List[str]:
    normalized: List[str] = []
    seen = set()
    for language in languages:
        normalized_lang = _normalize_language_code(language)
        if not normalized_lang:
            continue
        if normalized_lang not in seen:
            seen.add(normalized_lang)
            normalized.append(normalized_lang)
    return normalized


def _collect_codes_from_activities(activities: List) -> List[int]:
    codes: List[int] = []
    for activity in activities:
        codes.append(activity.code)
        if activity.childItems:
            codes.extend(_collect_codes_from_activities(activity.childItems))
    return codes


def _build_activity_structure_signature(activities_cfg: ActivitiesConfig) -> Dict:
    activity_info_by_code = get_all_activity_codes(activities_cfg)
    timeline_signature: Dict[str, Dict] = {}
    for timeline_name, timeline_cfg in sorted(activities_cfg.timeline.items()):
        codes: List[int] = []
        for category in timeline_cfg.categories:
            codes.extend(_collect_codes_from_activities(category.activities))

        unique_codes = sorted(set(codes))
        frequency_keys_by_code = {
            str(code): [
                option["key"]
                for option in (
                    activity_info_by_code.get(code, {}).get("frequency_options") or []
                )
            ]
            for code in unique_codes
        }

        timeline_signature[timeline_name] = {
            "mode": timeline_cfg.mode,
            "min_coverage": timeline_cfg.min_coverage,
            "codes": unique_codes,
            "frequency_keys_by_code": frequency_keys_by_code,
        }

    return timeline_signature


def _describe_activity_structure_difference(
    reference_signature: Dict[str, Dict],
    candidate_signature: Dict[str, Dict],
) -> str:
    reference_timelines = set(reference_signature.keys())
    candidate_timelines = set(candidate_signature.keys())

    missing_timelines = sorted(reference_timelines - candidate_timelines)
    if missing_timelines:
        return f"missing timelines: {missing_timelines}"

    extra_timelines = sorted(candidate_timelines - reference_timelines)
    if extra_timelines:
        return f"unexpected timelines: {extra_timelines}"

    for timeline_key in sorted(reference_timelines):
        reference_timeline = reference_signature[timeline_key]
        candidate_timeline = candidate_signature[timeline_key]

        if candidate_timeline.get("mode") != reference_timeline.get("mode"):
            return (
                f"timeline '{timeline_key}' mode mismatch: "
                f"expected '{reference_timeline.get('mode')}', "
                f"got '{candidate_timeline.get('mode')}'"
            )

        if candidate_timeline.get("min_coverage") != reference_timeline.get(
            "min_coverage"
        ):
            return (
                f"timeline '{timeline_key}' min_coverage mismatch: "
                f"expected {reference_timeline.get('min_coverage')}, "
                f"got {candidate_timeline.get('min_coverage')}"
            )

        reference_codes = set(reference_timeline.get("codes", []))
        candidate_codes = set(candidate_timeline.get("codes", []))

        missing_codes = sorted(reference_codes - candidate_codes)
        if missing_codes:
            return f"timeline '{timeline_key}' missing activity codes: {missing_codes}"

        extra_codes = sorted(candidate_codes - reference_codes)
        if extra_codes:
            return f"timeline '{timeline_key}' unexpected activity codes: {extra_codes}"

        reference_frequency_keys = reference_timeline.get("frequency_keys_by_code", {})
        candidate_frequency_keys = candidate_timeline.get("frequency_keys_by_code", {})

        for code in sorted(reference_codes):
            code_key = str(code)
            expected_keys = reference_frequency_keys.get(code_key, [])
            candidate_keys = candidate_frequency_keys.get(code_key, [])
            if candidate_keys != expected_keys:
                return (
                    f"timeline '{timeline_key}', activity code {code} frequency options mismatch: "
                    f"expected {expected_keys}, got {candidate_keys}"
                )

    return "unknown structure difference"


def _compute_blob_hash(payload: Dict) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def _create_available_catalog_from_validated_activities(
    session: Session,
    study: Study,
    parsed_activities_by_lang: Dict[str, ActivitiesConfig],
    default_language: str,
) -> None:
    default_cfg = parsed_activities_by_lang[default_language]
    activity_info_by_language = {
        language: get_all_activity_codes(activities_cfg)
        for language, activities_cfg in parsed_activities_by_lang.items()
    }

    timeline_id_by_key: Dict[str, int] = {}
    category_id_by_key: Dict[Tuple[str, str], int] = {}

    for timeline_order, (timeline_key, timeline_cfg) in enumerate(
        default_cfg.timeline.items()
    ):
        timeline_row = StudyAvailableTimeline(
            study_id=study.id,
            timeline_key=timeline_key,
            display_name=timeline_cfg.name,
            description=timeline_cfg.description,
            mode=timeline_cfg.mode,
            min_coverage=int(timeline_cfg.min_coverage)
            if timeline_cfg.min_coverage is not None
            else None,
            sort_order=timeline_order,
        )
        session.add(timeline_row)
        session.flush()
        timeline_id_by_key[timeline_key] = timeline_row.id

        for category_order, category_cfg in enumerate(timeline_cfg.categories):
            category_row = StudyAvailableCategory(
                study_id=study.id,
                timeline_id=timeline_row.id,
                category_name=category_cfg.name,
                sort_order=category_order,
            )
            session.add(category_row)
            session.flush()
            category_id_by_key[(timeline_key, category_cfg.name)] = category_row.id

    def _insert_recursive(
        timeline_key: str,
        category_name: str,
        activity_items: List,
        parent_code: Optional[int] = None,
    ) -> None:
        for activity_order, activity_item in enumerate(activity_items):
            activity_row = StudyAvailableActivity(
                study_id=study.id,
                timeline_id=timeline_id_by_key[timeline_key],
                category_id=category_id_by_key[(timeline_key, category_name)],
                activity_code=activity_item.code,
                parent_activity_code=parent_code,
                is_custom_input=bool(activity_item.is_custom_input),
                sort_order=activity_order,
            )
            session.add(activity_row)
            session.flush()

            for language, info_by_code in activity_info_by_language.items():
                language_info = info_by_code.get(activity_item.code, {})
                session.add(
                    StudyAvailableActivityI18n(
                        activity_id=activity_row.id,
                        language=language,
                        name=language_info.get("name") or activity_item.name,
                        label=language_info.get("label"),
                        short=language_info.get("short"),
                        vshort=language_info.get("vshort"),
                        examples=language_info.get("examples"),
                        color=language_info.get("color"),
                        frequency_options=language_info.get("frequency_options"),
                    )
                )

            if activity_item.childItems:
                _insert_recursive(
                    timeline_key=timeline_key,
                    category_name=category_name,
                    activity_items=activity_item.childItems,
                    parent_code=activity_item.code,
                )

    for timeline_key, timeline_cfg in default_cfg.timeline.items():
        for category_cfg in timeline_cfg.categories:
            _insert_recursive(
                timeline_key=timeline_key,
                category_name=category_cfg.name,
                activity_items=category_cfg.activities,
                parent_code=None,
            )


def _validate_import_study_payload(study_payload: ImportStudiesConfigStudy) -> Dict:
    if study_payload.data_collection_start >= study_payload.data_collection_end:
        raise ValueError(
            "data_collection_start must be earlier than data_collection_end"
        )

    supported_languages = _normalize_languages(study_payload.supported_languages)
    if not supported_languages:
        raise ValueError(
            "supported_languages must contain at least one valid language code"
        )

    default_language = _normalize_language_code(study_payload.default_language)
    if default_language not in supported_languages:
        raise ValueError("default_language must be included in supported_languages")

    validate_external_tasks_for_study(
        study_name_short=study_payload.name_short,
        allow_unlisted_participants=study_payload.allow_unlisted_participants,
        study_participant_ids=study_payload.study_participant_ids,
        external_tasks=study_payload.external_tasks,
    )

    has_embedded_data = bool(study_payload.activities_json_data)
    has_file_refs = bool(study_payload.activities_json_files)
    if has_embedded_data and has_file_refs:
        raise ValueError(
            "Provide exactly one of activities_json_data or activities_json_files, not both"
        )
    if not has_embedded_data and not has_file_refs:
        raise ValueError(
            "Missing activities configuration: provide exactly one of activities_json_data or activities_json_files"
        )

    raw_activities_by_lang: Dict[str, Dict] = {}
    if has_embedded_data:
        normalized_data_by_lang: Dict[str, Dict] = {}
        for language, raw_activities in study_payload.activities_json_data.items():
            normalized_lang = _normalize_language_code(language)
            if not normalized_lang:
                continue
            normalized_data_by_lang[normalized_lang] = raw_activities

        missing_activity_languages = sorted(
            set(supported_languages) - set(normalized_data_by_lang.keys())
        )
        if missing_activity_languages:
            raise ValueError(
                f"activities_json_data is missing required languages: {missing_activity_languages}"
            )
        raw_activities_by_lang = {
            language: normalized_data_by_lang[language]
            for language in supported_languages
        }
    else:
        normalized_files_by_lang: Dict[str, str] = {}
        for language, file_path in study_payload.activities_json_files.items():
            normalized_lang = _normalize_language_code(language)
            if not normalized_lang:
                continue
            normalized_files_by_lang[normalized_lang] = file_path

        missing_activity_languages = sorted(
            set(supported_languages) - set(normalized_files_by_lang.keys())
        )
        if missing_activity_languages:
            raise ValueError(
                f"activities_json_files is missing required languages: {missing_activity_languages}"
            )

        for language in supported_languages:
            file_path = normalized_files_by_lang[language]
            if not isinstance(file_path, str) or not file_path.strip():
                raise ValueError(
                    f"activities_json_files has invalid path for language '{language}'"
                )
            try:
                raw_activities_by_lang[language] = (
                    _load_json_file_with_studies_config_base(file_path)
                )
            except Exception as error:
                raise ValueError(
                    f"Could not load activities_json_files for language '{language}' from '{file_path}': {error}"
                ) from error

    for day_label in study_payload.day_labels:
        day_label_name = day_label.get("name", "")
        display_names = day_label.get("display_names")
        if not isinstance(display_names, dict):
            raise ValueError(
                f"day_label '{day_label_name}' is missing display_names object"
            )
        missing_day_label_languages = sorted(
            set(supported_languages) - set(display_names.keys())
        )
        if missing_day_label_languages:
            raise ValueError(
                f"day_label '{day_label_name}' is missing display_names for languages: {missing_day_label_languages}"
            )

    parsed_activities_by_lang: Dict[str, ActivitiesConfig] = {}
    signature_by_lang: Dict[str, Dict] = {}

    for language in supported_languages:
        raw_activities = raw_activities_by_lang[language]
        parsed_activities = ActivitiesConfig(**raw_activities)
        parsed_activities_by_lang[language] = parsed_activities
        signature_by_lang[language] = _build_activity_structure_signature(
            parsed_activities
        )

    reference_signature = signature_by_lang[default_language]
    for language, signature in signature_by_lang.items():
        if signature != reference_signature:
            details = _describe_activity_structure_difference(
                reference_signature,
                signature,
            )
            raise ValueError(
                f"activities_json_data structure mismatch between language '{default_language}' and '{language}': {details}"
            )

    return {
        "supported_languages": supported_languages,
        "default_language": default_language,
        "parsed_activities_by_lang": parsed_activities_by_lang,
        "raw_activities_by_lang": raw_activities_by_lang,
    }


def _load_json_file_with_studies_config_base(file_path: str) -> dict:
    """Load a JSON file and resolve relative paths against the studies config directory."""
    candidate = Path(file_path)
    if not candidate.is_absolute():
        studies_config_parent = Path(settings.studies_config_path).resolve().parent
        candidate = (studies_config_parent / candidate).resolve()

    with candidate.open("r", encoding="utf-8") as file_handle:
        return json.load(file_handle)


def _guess_language_from_filename(filename: str) -> Optional[str]:
    if not isinstance(filename, str):
        return None
    filename_clean = filename.strip().lower()
    if not filename_clean:
        return None

    patterns = [
        r"[_\-.]([a-z]{2})\.json$",
        r"([a-z]{2})\.json$",
    ]
    for pattern in patterns:
        match = re.search(pattern, filename_clean)
        if match:
            return match.group(1)
    return None


def _format_exception_for_client(error: Exception) -> List[Dict[str, Any]]:
    if isinstance(error, ValidationError):
        formatted_errors: List[Dict[str, Any]] = []
        for item in error.errors():
            location = item.get("loc", [])
            formatted_errors.append(
                {
                    "message": item.get("msg", "Validation error"),
                    "path": " -> ".join(str(part) for part in location),
                    "type": item.get("type", "validation_error"),
                }
            )
        return formatted_errors

    return [
        {
            "message": str(error),
            "path": None,
            "type": "error",
        }
    ]


async def _parse_json_upload(upload: UploadFile, label: str) -> Dict[str, Any]:
    raw_bytes = await upload.read()
    try:
        decoded = raw_bytes.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValueError(
            f"{label} ('{upload.filename}') must be valid UTF-8 text"
        ) from error

    try:
        parsed = json.loads(decoded)
    except json.JSONDecodeError as error:
        raise ValueError(
            f"Invalid JSON in {label} ('{upload.filename}') at line {error.lineno}, column {error.colno}: {error.msg}"
        ) from error

    if not isinstance(parsed, dict):
        raise ValueError(f"{label} ('{upload.filename}') must contain a JSON object")

    return parsed


async def _parse_activities_uploads_by_language(
    activities_files: List[UploadFile],
    explicit_map_json: Optional[str] = None,
    expected_filenames_by_language: Optional[Dict[str, str]] = None,
) -> Dict[str, Dict[str, Any]]:
    if not activities_files:
        raise ValueError("At least one activities JSON file is required")

    file_by_name: Dict[str, UploadFile] = {}
    for upload in activities_files:
        filename = (upload.filename or "").strip()
        if not filename:
            raise ValueError("One uploaded activities file is missing a filename")
        file_by_name[filename] = upload

    explicit_map: Dict[str, str] = {}
    if explicit_map_json and explicit_map_json.strip():
        try:
            parsed_map = json.loads(explicit_map_json)
        except json.JSONDecodeError as error:
            raise ValueError(
                f"Invalid JSON in activities language map at line {error.lineno}, column {error.colno}: {error.msg}"
            ) from error
        if not isinstance(parsed_map, dict):
            raise ValueError("Activities language map must be a JSON object")
        for language, filename in parsed_map.items():
            normalized_lang = _normalize_language_code(language)
            if not normalized_lang:
                raise ValueError(
                    f"Invalid language key '{language}' in activities language map"
                )
            if not isinstance(filename, str) or not filename.strip():
                raise ValueError(
                    f"Language map entry for '{language}' must be a non-empty filename"
                )
            explicit_map[normalized_lang] = filename.strip()

    result: Dict[str, Dict[str, Any]] = {}

    if expected_filenames_by_language:
        for language, expected_filename in expected_filenames_by_language.items():
            normalized_lang = _normalize_language_code(language)
            if not normalized_lang:
                continue
            basename = Path(expected_filename).name
            upload = file_by_name.get(basename)
            if not upload:
                raise ValueError(
                    f"Missing uploaded activities file for language '{normalized_lang}': expected filename '{basename}'"
                )
            result[normalized_lang] = await _parse_json_upload(
                upload, f"activities file ({normalized_lang})"
            )
        return result

    if explicit_map:
        for language, filename in explicit_map.items():
            upload = file_by_name.get(filename)
            if not upload:
                raise ValueError(
                    f"Activities language map references missing uploaded file '{filename}' for language '{language}'"
                )
            result[language] = await _parse_json_upload(
                upload, f"activities file ({language})"
            )
        return result

    if len(activities_files) == 1:
        guessed_lang = _guess_language_from_filename(activities_files[0].filename or "")
        language = guessed_lang or "en"
        result[language] = await _parse_json_upload(
            activities_files[0], f"activities file ({language})"
        )
        return result

    ambiguous_files: List[str] = []
    for upload in activities_files:
        guessed_lang = _guess_language_from_filename(upload.filename or "")
        if not guessed_lang:
            ambiguous_files.append(upload.filename or "<unnamed>")
            continue
        if guessed_lang in result:
            raise ValueError(
                f"Duplicate language '{guessed_lang}' detected from filenames. Provide an explicit language map."
            )
        result[guessed_lang] = await _parse_json_upload(
            upload, f"activities file ({guessed_lang})"
        )

    if ambiguous_files:
        raise ValueError(
            "Could not infer language for these files from filename suffixes (_en.json, _de.json, ...): "
            + ", ".join(ambiguous_files)
        )

    return result


def _validate_activities_multilang_in_memory(
    activities_by_lang: Dict[str, Dict[str, Any]],
    supported_languages: List[str],
    default_language: str,
) -> Dict[str, Any]:
    day_label_display_names = {
        language: language.upper() for language in supported_languages
    }

    payload = ImportStudiesConfigStudy(
        name="Validation-only study",
        name_short="validation_only_study",
        description="In-memory validation",
        day_labels=[
            {
                "name": "day1",
                "display_order": 0,
                "display_names": day_label_display_names,
            }
        ],
        study_participant_ids=[],
        allow_unlisted_participants=True,
        default_language=default_language,
        supported_languages=supported_languages,
        activities_json_data=activities_by_lang,
        data_collection_start=datetime.fromisoformat("2024-01-01T00:00:00+00:00"),
        data_collection_end=datetime.fromisoformat("2030-01-01T00:00:00+00:00"),
    )
    validated = _validate_import_study_payload(payload)
    return {
        "supported_languages": validated["supported_languages"],
        "default_language": validated["default_language"],
    }


def _extract_single_study_from_studies_config(
    studies_config_json: Dict[str, Any],
) -> Dict[str, Any]:
    studies = studies_config_json.get("studies")
    if not isinstance(studies, list) or not studies:
        raise ValueError("studies_config must contain a non-empty 'studies' array")
    if len(studies) != 1:
        raise ValueError(
            "Full-study validation mode currently supports exactly one study in studies_config"
        )
    study = studies[0]
    if not isinstance(study, dict):
        raise ValueError("The single entry in 'studies' must be a JSON object")
    return study


def _create_study_from_import_payload(
    session: Session,
    study_payload: ImportStudiesConfigStudy,
    validated_data: Dict,
) -> Study:
    default_language = validated_data["default_language"]
    parsed_default_activities: ActivitiesConfig = validated_data[
        "parsed_activities_by_lang"
    ][default_language]

    study = Study(
        name=study_payload.name,
        name_short=study_payload.name_short,
        description=study_payload.description or "",
        allow_unlisted_participants=study_payload.allow_unlisted_participants,
        require_consent=study_payload.require_consent,
        is_paused=study_payload.is_paused,
        default_language=default_language,
        study_text_intro=study_payload.study_text_intro,
        study_text_end_completed=study_payload.study_text_end_completed,
        study_text_end_skipped=study_payload.study_text_end_skipped,
        study_text_end_noconsent=study_payload.study_text_end_noconsent,
        study_text_consent=study_payload.study_text_consent,
        activities_json_url=f"db_blob://{study_payload.name_short}/{default_language}",
        data_collection_start=study_payload.data_collection_start,
        data_collection_end=study_payload.data_collection_end,
    )
    session.add(study)
    session.flush()

    for external_task_payload in study_payload.external_tasks:
        session.add(
            StudyExternalTask(
                study_id=study.id,
                task_key=external_task_payload.task_key,
                name=external_task_payload.name,
                description=external_task_payload.description,
                url=external_task_payload.url,
                confirmation_type=external_task_payload.confirmation_type,
                tokens=list(external_task_payload.tokens),
                config=get_external_task_effective_config(external_task_payload),
            )
        )

    for day_label_data in sorted(
        study_payload.day_labels, key=lambda row: row.get("display_order", 0)
    ):
        display_names = day_label_data.get("display_names", {})
        display_name = (
            display_names.get(default_language)
            or display_names.get("en")
            or day_label_data.get("name")
        )
        day_label = DayLabel(
            study_id=study.id,
            name=day_label_data["name"],
            display_order=day_label_data.get("display_order", 0),
            display_name=display_name,
        )
        session.add(day_label)

    for timeline_name, timeline_cfg in parsed_default_activities.timeline.items():
        session.add(
            Timeline(
                study_id=study.id,
                name=timeline_name,
                display_name=timeline_cfg.name,
                description=timeline_cfg.description,
                mode=timeline_cfg.mode,
                min_coverage=int(timeline_cfg.min_coverage)
                if timeline_cfg.min_coverage is not None
                else None,
            )
        )

    for participant_id in study_payload.study_participant_ids:
        normalized_participant_id = (participant_id or "").strip()
        if not normalized_participant_id:
            continue

        participant = session.get(Participant, normalized_participant_id)
        if not participant:
            participant = Participant(id=normalized_participant_id)
            session.add(participant)
            session.flush()

        existing_association = session.exec(
            select(StudyParticipant).where(
                StudyParticipant.study_id == study.id,
                StudyParticipant.participant_id == normalized_participant_id,
            )
        ).first()
        if not existing_association:
            session.add(
                StudyParticipant(
                    study_id=study.id,
                    participant_id=normalized_participant_id,
                )
            )

    ensure_external_task_assignments(
        session,
        study,
        study_payload.study_participant_ids,
    )

    for language in validated_data["supported_languages"]:
        raw_blob = validated_data["raw_activities_by_lang"][language]
        session.add(
            StudyActivityConfigBlob(
                study_id=study.id,
                language=language,
                activities_json_data=raw_blob,
                content_hash=_compute_blob_hash(raw_blob),
            )
        )

    _create_available_catalog_from_validated_activities(
        session=session,
        study=study,
        parsed_activities_by_lang=validated_data["parsed_activities_by_lang"],
        default_language=default_language,
    )

    return study


@app.get("/api/admin/studies/{study_name_short}/available-activities-summary")
async def get_available_activities_summary(
    study_name_short: str,
    current_admin: str = Depends(verify_admin),
    session: Session = Depends(get_session),
):
    """Return counts for normalized available activities catalog tables for a study."""
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()
    if not study:
        raise HTTPException(
            status_code=404, detail=f"Study '{study_name_short}' not found"
        )

    audit_admin_action(
        current_admin,
        f"requested available activities summary for study '{study_name_short}'",
    )

    timeline_count = (
        session.exec(
            select(func.count(StudyAvailableTimeline.id)).where(
                StudyAvailableTimeline.study_id == study.id
            )
        ).first()
        or 0
    )
    category_count = (
        session.exec(
            select(func.count(StudyAvailableCategory.id)).where(
                StudyAvailableCategory.study_id == study.id
            )
        ).first()
        or 0
    )
    activity_count = (
        session.exec(
            select(func.count(StudyAvailableActivity.id)).where(
                StudyAvailableActivity.study_id == study.id
            )
        ).first()
        or 0
    )
    i18n_count = (
        session.exec(
            select(func.count(StudyAvailableActivityI18n.id))
            .join(
                StudyAvailableActivity,
                StudyAvailableActivityI18n.activity_id == StudyAvailableActivity.id,
            )
            .where(StudyAvailableActivity.study_id == study.id)
        ).first()
        or 0
    )

    return {
        "study_name_short": study_name_short,
        "available_timeline_count": timeline_count,
        "available_category_count": category_count,
        "available_activity_count": activity_count,
        "available_activity_i18n_count": i18n_count,
    }


@app.post("/api/admin/studies/import-config")
async def import_studies_config(
    payload: ImportStudiesConfigRequest,
    dry_run: bool = Query(False, description="Validate only, no database writes"),
    current_admin: str = Depends(verify_admin),
    session: Session = Depends(get_session),
):
    """Import one or multiple studies using exactly one activities source per study.

    Each study payload must provide exactly one of:
    - activities_json_data (embedded multilingual activity payloads), or
    - activities_json_files (language -> file path references)
    """
    allowed_modes = {"create_only"}
    allowed_transaction_modes = {"all_or_nothing", "per_study"}

    if payload.mode not in allowed_modes:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported mode '{payload.mode}'. Allowed: {sorted(allowed_modes)}",
        )

    if payload.transaction_mode not in allowed_transaction_modes:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported transaction_mode '{payload.transaction_mode}'. Allowed: {sorted(allowed_transaction_modes)}",
        )

    summary = {
        "received": len(payload.studies),
        "created": 0,
        "updated": 0,
        "skipped": 0,
        "failed": 0,
    }
    results: List[Dict] = []

    validation_cache: Dict[str, Dict] = {}

    def _handle_single_study(study_payload: ImportStudiesConfigStudy) -> None:
        existing_study = session.exec(
            select(Study).where(Study.name_short == study_payload.name_short)
        ).first()
        if existing_study:
            raise ValueError(f"Study '{study_payload.name_short}' already exists")

        validated_data = _validate_import_study_payload(study_payload)
        validation_cache[study_payload.name_short] = validated_data

    if payload.transaction_mode == "all_or_nothing":
        for study_payload in payload.studies:
            try:
                _handle_single_study(study_payload)
            except Exception as error:
                summary["failed"] += 1
                results.append(
                    {
                        "study_name_short": study_payload.name_short,
                        "status": "failed",
                        "errors": [str(error)],
                    }
                )

        if summary["failed"] > 0:
            summary["skipped"] = max(0, summary["received"] - summary["failed"])
            for study_payload in payload.studies:
                if study_payload.name_short in {
                    result["study_name_short"] for result in results
                }:
                    continue
                results.append(
                    {
                        "study_name_short": study_payload.name_short,
                        "status": "skipped",
                        "errors": [
                            "Skipped because transaction_mode=all_or_nothing and at least one study failed validation"
                        ],
                    }
                )
            return {
                "dry_run": dry_run,
                "mode": payload.mode,
                "transaction_mode": payload.transaction_mode,
                "summary": summary,
                "results": results,
            }

        if not dry_run:
            for study_payload in payload.studies:
                validated_data = validation_cache[study_payload.name_short]
                _create_study_from_import_payload(
                    session, study_payload, validated_data
                )
                summary["created"] += 1
                results.append(
                    {
                        "study_name_short": study_payload.name_short,
                        "status": "created",
                        "errors": [],
                    }
                )
            session.commit()
        else:
            summary["created"] = len(payload.studies)
            for study_payload in payload.studies:
                results.append(
                    {
                        "study_name_short": study_payload.name_short,
                        "status": "validated",
                        "errors": [],
                    }
                )
    else:
        for study_payload in payload.studies:
            try:
                _handle_single_study(study_payload)
                if dry_run:
                    summary["created"] += 1
                    results.append(
                        {
                            "study_name_short": study_payload.name_short,
                            "status": "validated",
                            "errors": [],
                        }
                    )
                    continue

                validated_data = validation_cache[study_payload.name_short]
                _create_study_from_import_payload(
                    session, study_payload, validated_data
                )
                session.commit()
                summary["created"] += 1
                results.append(
                    {
                        "study_name_short": study_payload.name_short,
                        "status": "created",
                        "errors": [],
                    }
                )
            except Exception as error:
                session.rollback()
                summary["failed"] += 1
                results.append(
                    {
                        "study_name_short": study_payload.name_short,
                        "status": "failed",
                        "errors": [str(error)],
                    }
                )

    logger.info(
        "Admin '%s' imported studies config: received=%s created=%s failed=%s dry_run=%s transaction_mode=%s",
        current_admin,
        summary["received"],
        summary["created"],
        summary["failed"],
        dry_run,
        payload.transaction_mode,
    )
    audit_admin_action(
        current_admin,
        (
            f"imported studies config (received={summary['received']}, created={summary['created']}, "
            f"failed={summary['failed']}, dry_run={dry_run}, transaction_mode={payload.transaction_mode})"
        ),
    )

    return {
        "dry_run": dry_run,
        "mode": payload.mode,
        "transaction_mode": payload.transaction_mode,
        "summary": summary,
        "results": results,
    }


@app.patch("/api/admin/studies/{study_name_short}/collection-window")
async def update_study_collection_window(
    study_name_short: str,
    payload: UpdateStudyCollectionWindowRequest,
    current_admin: str = Depends(verify_admin),
    session: Session = Depends(get_session),
):
    """Update the data-collection time window of an existing study.

    This endpoint enables admins to close a study early or reopen/extend it
    by changing one or both of `data_collection_start` and `data_collection_end`.
    """
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()
    if not study:
        raise HTTPException(
            status_code=404, detail=f"Study '{study_name_short}' not found"
        )

    if payload.data_collection_start is None and payload.data_collection_end is None:
        raise HTTPException(
            status_code=400,
            detail="At least one of data_collection_start or data_collection_end must be provided",
        )

    previous_start = study.data_collection_start
    previous_end = study.data_collection_end

    new_start = payload.data_collection_start or previous_start
    new_end = payload.data_collection_end or previous_end

    if new_start >= new_end:
        raise HTTPException(
            status_code=400,
            detail="data_collection_start must be earlier than data_collection_end",
        )

    study.data_collection_start = new_start
    study.data_collection_end = new_end

    session.add(study)
    session.commit()
    session.refresh(study)

    logger.info(
        "Admin '%s' updated study collection window for '%s': %s -> %s, %s -> %s",
        current_admin,
        study_name_short,
        previous_start.isoformat(),
        study.data_collection_start.isoformat(),
        previous_end.isoformat(),
        study.data_collection_end.isoformat(),
    )
    audit_admin_action(
        current_admin,
        (
            f"updated collection window for study '{study_name_short}' "
            f"(start {previous_start.isoformat()} -> {study.data_collection_start.isoformat()}, "
            f"end {previous_end.isoformat()} -> {study.data_collection_end.isoformat()})"
        ),
    )

    return {
        "study_name_short": study_name_short,
        "previous": {
            "data_collection_start": previous_start,
            "data_collection_end": previous_end,
        },
        "updated": {
            "data_collection_start": study.data_collection_start,
            "data_collection_end": study.data_collection_end,
        },
        "is_currently_collecting": study.data_collection_start
        <= utc_now()
        <= study.data_collection_end
        and not study.is_paused,
    }


@app.patch("/api/admin/studies/{study_name_short}/pause")
async def pause_study(
    study_name_short: str,
    current_admin: str = Depends(verify_admin),
    session: Session = Depends(get_session),
):
    """Pause a study. Participants will not be able to submit data while the study is paused."""
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()
    if not study:
        raise HTTPException(
            status_code=404, detail=f"Study '{study_name_short}' not found"
        )
    if study.is_paused:
        raise HTTPException(
            status_code=400, detail=f"Study '{study_name_short}' is already paused"
        )
    study.is_paused = True
    session.add(study)
    session.commit()
    logger.info("Admin '%s' paused study '%s'", current_admin, study_name_short)
    audit_admin_action(current_admin, f"paused study '{study_name_short}'")
    return {"study_name_short": study_name_short, "is_paused": True}


@app.patch("/api/admin/studies/{study_name_short}/unpause")
async def unpause_study(
    study_name_short: str,
    current_admin: str = Depends(verify_admin),
    session: Session = Depends(get_session),
):
    """Unpause a study, allowing participants to submit data again."""
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()
    if not study:
        raise HTTPException(
            status_code=404, detail=f"Study '{study_name_short}' not found"
        )
    if not study.is_paused:
        raise HTTPException(
            status_code=400, detail=f"Study '{study_name_short}' is not paused"
        )
    study.is_paused = False
    session.add(study)
    session.commit()
    logger.info("Admin '%s' unpaused study '%s'", current_admin, study_name_short)
    audit_admin_action(current_admin, f"unpaused study '{study_name_short}'")
    return {"study_name_short": study_name_short, "is_paused": False}


@app.get("/api/admin/export/studies-runtime-config")
async def export_runtime_studies_config(
    study_name: Optional[str] = Query(
        None, description="Optional study short name to export only one study"
    ),
    current_admin: str = Depends(verify_admin),
    session: Session = Depends(get_session),
):
    """Export runtime study setup as a studies_config-like structure plus activities definitions.

    The export contains two top-level keys:
    - studies_config: compatible studies list with runtime participant IDs and logged activities by participant and study day
    - activities: map keyed by study_name_short with the loaded activities.json content per language

    Note:
    - participant IDs are random external IDs and are used as object keys in participant-grouped maps.
    """
    study_query = select(Study).order_by(Study.name_short)
    if study_name:
        study_query = study_query.where(Study.name_short == study_name)

    studies = session.exec(study_query).all()
    if study_name and not studies:
        raise HTTPException(status_code=404, detail=f"Study '{study_name}' not found")

    exported_studies = []
    activities_by_study: Dict = {}

    for study in studies:
        cfg_study = get_cfg_study_by_name_short(
            study.name_short, settings.studies_config_path
        )

        day_labels = session.exec(
            select(DayLabel)
            .where(DayLabel.study_id == study.id)
            .order_by(DayLabel.display_order)
        ).all()

        if cfg_study:
            day_label_lookup = {
                day_label.name: day_label for day_label in cfg_study.day_labels
            }
        else:
            day_label_lookup = {}

        day_labels_export = []
        for day_label in day_labels:
            cfg_day_label = day_label_lookup.get(day_label.name)
            if cfg_day_label:
                display_names = cfg_day_label.get_display_names(study.default_language)
            else:
                display_names = {study.default_language: day_label.display_name}

            day_labels_export.append(
                {
                    "name": day_label.name,
                    "display_order": day_label.display_order,
                    "display_names": display_names,
                }
            )

        study_participants = session.exec(
            select(StudyParticipant)
            .where(StudyParticipant.study_id == study.id)
            .order_by(StudyParticipant.participant_id)
        ).all()
        participant_ids = [
            association.participant_id for association in study_participants
        ]

        activity_rows = session.exec(
            select(Activity, DayLabel, Timeline)
            .join(DayLabel, Activity.day_label_id == DayLabel.id)
            .join(Timeline, Activity.timeline_id == Timeline.id)
            .where(Activity.study_id == study.id)
            .order_by(
                DayLabel.display_order, Activity.participant_id, Activity.start_minutes
            )
        ).all()

        day_keys = [day_label.name for day_label in day_labels]
        logged_activities: Dict = {
            participant_id: {day_key: [] for day_key in day_keys}
            for participant_id in participant_ids
        }

        for activity, day_label, timeline in activity_rows:
            participant_key = activity.participant_id
            day_key = day_label.name

            if participant_key not in logged_activities:
                logged_activities[participant_key] = {
                    day_name: [] for day_name in day_keys
                }

            logged_activities[participant_key][day_key].append(
                {
                    "activity_code": activity.activity_code,
                    "timeline": timeline.name,
                    "start_minutes": activity.start_minutes,
                    "end_minutes": activity.end_minutes,
                }
            )

        blob_rows = session.exec(
            select(StudyActivityConfigBlob)
            .where(StudyActivityConfigBlob.study_id == study.id)
            .order_by(StudyActivityConfigBlob.language)
        ).all()
        blob_by_lang = {blob.language: blob.activities_json_data for blob in blob_rows}

        if cfg_study:
            activities_json_files = cfg_study.get_supported_activities_json_files()
            supported_languages = cfg_study.get_supported_languages()
            if not activities_json_files and blob_by_lang:
                activities_json_files = {
                    language: f"db_blob://{study.name_short}/{language}"
                    for language in sorted(blob_by_lang.keys())
                }
                supported_languages = sorted(blob_by_lang.keys())
        else:
            if blob_by_lang:
                activities_json_files = {
                    language: f"db_blob://{study.name_short}/{language}"
                    for language in sorted(blob_by_lang.keys())
                }
                supported_languages = sorted(blob_by_lang.keys())
            else:
                activities_json_files = {
                    study.default_language: study.activities_json_url
                }
                supported_languages = [study.default_language]

        activity_configs_for_study: Dict = {}
        for lang, activity_file_path in activities_json_files.items():
            if lang in blob_by_lang:
                activity_configs_for_study[lang] = blob_by_lang[lang]
                continue

            try:
                activity_configs_for_study[lang] = (
                    _load_json_file_with_studies_config_base(activity_file_path)
                )
            except Exception as error:
                activity_configs_for_study[lang] = {
                    "error": f"Could not load activities file '{activity_file_path}': {error}"
                }

        activities_by_study[study.name_short] = activity_configs_for_study

        external_tasks = session.exec(
            select(StudyExternalTask)
            .where(StudyExternalTask.study_id == study.id)
            .order_by(StudyExternalTask.task_key)
        ).all()

        exported_studies.append(
            {
                "name": study.name,
                "name_short": study.name_short,
                "description": study.description,
                "day_labels": day_labels_export,
                "study_participant_ids": participant_ids,
                "allow_unlisted_participants": study.allow_unlisted_participants,
                "require_consent": study.require_consent,
                "is_paused": study.is_paused,
                "external_tasks": [
                    {
                        "task_key": external_task.task_key,
                        "name": external_task.name,
                        "description": external_task.description,
                        "url": external_task.url,
                        "confirmation_type": external_task.confirmation_type,
                        "tokens": external_task.tokens,
                        "config": external_task.config,
                        "participant_assignments": [
                            {
                                "participant_id": assignment.participant_id,
                                "assigned_token": assignment.assigned_token,
                                "assignment_order": assignment.assignment_order,
                                "is_confirmed": assignment.is_confirmed,
                                "confirmed_at": assignment.confirmed_at,
                            }
                            for assignment in session.exec(
                                select(StudyExternalTaskAssignment)
                                .where(
                                    StudyExternalTaskAssignment.external_task_id
                                    == external_task.id
                                )
                                .order_by(
                                    StudyExternalTaskAssignment.assignment_order,
                                    StudyExternalTaskAssignment.participant_id,
                                )
                            ).all()
                        ],
                    }
                    for external_task in external_tasks
                ],
                "default_language": study.default_language,
                "supported_languages": supported_languages,
                "activities_json_files": activities_json_files,
                "activities_json_data": activity_configs_for_study,
                "study_text_intro": study.study_text_intro,
                "study_text_end_completed": study.study_text_end_completed,
                "study_text_end_skipped": study.study_text_end_skipped,
                "study_text_end_noconsent": study.study_text_end_noconsent,
                "study_text_consent": study.study_text_consent,
                "data_collection_start": study.data_collection_start,
                "data_collection_end": study.data_collection_end,
                "activities_logged_by_userid": logged_activities,
            }
        )

    logger.info(
        "Admin '%s' exported runtime studies config%s",
        current_admin,
        f" for study '{study_name}'" if study_name else " for all studies",
    )
    if study_name:
        audit_admin_action(
            current_admin, f"exported runtime studies config for study '{study_name}'"
        )
    else:
        audit_admin_action(
            current_admin, "exported runtime studies config for all studies"
        )

    response_payload = {
        "studies_config": {
            "studies": exported_studies,
        },
        "activities": activities_by_study,
        "tud_backend_version": tud_version,  # Export app version for traceability of exported data (not all versions will be able to import all exports due to potential format changes, so this is important metadata to include in the export)
    }

    export_date = utc_now().strftime("%Y-%m-%d")
    if study_name:
        filename = f"studies_config_{study_name}_{export_date}.json"
    else:
        filename = f"studies_config_{export_date}.json"

    return JSONResponse(
        content=jsonable_encoder(response_payload),
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.get(
    "/admin/participant-management",
    name="Admin Participant Management Page",
    response_class=HTMLResponse,
)
async def admin_participant_management(
    request: Request,
    study_name_short: Optional[str] = Query(None),
    current_admin: str = Depends(verify_admin),
    session: Session = Depends(get_session),
):
    """Render participant-management page for assigning/removing study participants.

    @param request FastAPI request object for template rendering.
    @param study_name_short Optional selected study short name.
    @param current_admin Authenticated admin username from Basic Auth dependency.
    @param session Database session dependency.
    @returns HTML page with study selector and participant management controls.
    """
    logger.info(
        f"Admin '{current_admin}' accessed participant management page for study '{study_name_short}'."
    )
    if study_name_short:
        audit_admin_action(
            current_admin,
            f"opened participant management page for study '{study_name_short}'",
        )
    else:
        audit_admin_action(current_admin, "opened participant management page")

    studies = session.exec(select(Study).order_by(Study.name_short)).all()
    studies_for_dropdown = []
    for study in studies:
        participant_count = (
            session.exec(
                select(func.count(StudyParticipant.id)).where(
                    StudyParticipant.study_id == study.id
                )
            ).first()
            or 0
        )

        studies_for_dropdown.append(
            {
                "name": study.name,
                "name_short": study.name_short,
                "allow_unlisted_participants": study.allow_unlisted_participants,
                "participant_count": participant_count,
            }
        )
    selected_study = None
    current_participants = []
    selected_study_requires_consent = False

    if study_name_short:
        selected_study = session.exec(
            select(Study).where(Study.name_short == study_name_short)
        ).first()

        if not selected_study:
            raise HTTPException(
                status_code=404, detail=f"Study '{study_name_short}' not found"
            )

        selected_study_requires_consent = bool(selected_study.require_consent)

        study_participants = session.exec(
            select(StudyParticipant)
            .where(StudyParticipant.study_id == selected_study.id)
            .order_by(StudyParticipant.created_at.desc())
        ).all()

        for association in study_participants:
            participant = session.get(Participant, association.participant_id)
            if not participant:
                continue

            participant_activity_count = (
                session.exec(
                    select(func.count(Activity.id)).where(
                        Activity.study_id == selected_study.id,
                        Activity.participant_id == participant.id,
                    )
                ).first()
                or 0
            )

            current_participants.append(
                {
                    "id": participant.id,
                    "created_at": participant.created_at,
                    "assigned_at": association.created_at,
                    "consent_given": association.consent_given,
                    "consent_decided_at": association.consent_decided_at,
                    "activity_count": participant_activity_count,
                }
            )

    # Render template manually to avoid Starlette TemplateResponse caching issues with wheel-installed packages.
    # When templates are installed from a wheel, Starlette's TemplateResponse cache fails with "unhashable type: dict".
    context_dict = {
        "request": request,
        "current_admin": current_admin,
        "studies": studies_for_dropdown,
        "selected_study": selected_study,
        "selected_study_requires_consent": selected_study_requires_consent,
        "current_participants": current_participants,
        "current_time": utc_now(),
    }
    template = templates.get_template("admin_participant_management.html")
    html_content = template.render(context_dict)
    return HTMLResponse(content=html_content)


@app.get("/admin/tools", name="Admin Tools Page", response_class=HTMLResponse)
async def admin_tools(
    request: Request,
    current_admin: str = Depends(verify_admin),
):
    """Render a small admin tools page with utilities for integration tasks.

    Uses direct Jinja rendering to avoid TemplateResponse caching issues when the package is
    installed from a wheel (Starlette/Jinja template cache bug).
    """
    logger.info("Admin '%s' accessed the admin tools page.", current_admin)
    audit_admin_action(current_admin, "opened admin tools page")

    context_dict = {
        "request": request,
        "current_admin": current_admin,
        "current_time": utc_now(),
    }
    template = templates.get_template("admin_tools.html")
    html_content = template.render(context_dict)
    return HTMLResponse(content=html_content)


@app.get(
    "/admin/file-validation",
    name="Admin File Validation Page",
    response_class=HTMLResponse,
)
async def admin_file_validation(
    request: Request,
    current_admin: str = Depends(verify_admin),
):
    """Render admin file-validation utilities page."""
    logger.info("Admin '%s' accessed the admin file validation page.", current_admin)
    audit_admin_action(current_admin, "opened admin file validation page")

    context_dict = {
        "request": request,
        "current_admin": current_admin,
        "current_time": utc_now(),
    }
    template = templates.get_template("admin_file_validation.html")
    html_content = template.render(context_dict)
    return HTMLResponse(content=html_content)


@app.post("/api/admin/validate/files")
async def validate_files_in_memory(
    mode: str = Form(...),
    default_language: Optional[str] = Form(None),
    supported_languages_csv: Optional[str] = Form(None),
    activities_language_map: Optional[str] = Form(None),
    activities_file: Optional[UploadFile] = File(None),
    activities_files: List[UploadFile] = File(default_factory=list),
    studies_config_file: Optional[UploadFile] = File(None),
    current_admin: str = Depends(verify_admin),
):
    """Validate uploaded config files in-memory without writing to disk.

    Modes:
    - single_activities: one activities JSON file
    - activities_multilang: several activities files + language config
    - full_study: studies_config (single study) + activities files
    """
    allowed_modes = {
        "single_activities",
        "activities_multilang",
        "full_study",
    }
    if mode not in allowed_modes:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported mode '{mode}'. Allowed: {sorted(allowed_modes)}",
        )

    try:
        if mode == "single_activities":
            if activities_file is None:
                raise ValueError(
                    "single_activities mode requires one activities file upload"
                )
            activities_json = await _parse_json_upload(
                activities_file, "activities file"
            )
            parsed = ActivitiesConfig(**activities_json)

            timeline_count = len(parsed.timeline)
            category_count = sum(
                len(timeline_cfg.categories)
                for timeline_cfg in parsed.timeline.values()
            )
            activity_count = len(get_all_activity_codes(parsed))

            audit_admin_action(
                current_admin,
                f"validated single activities file '{activities_file.filename}' successfully",
            )
            return {
                "ok": True,
                "mode": mode,
                "summary": {
                    "timeline_count": timeline_count,
                    "category_count": category_count,
                    "activity_count": activity_count,
                },
                "errors": [],
            }

        if mode == "activities_multilang":
            supported_languages = _normalize_languages(
                (supported_languages_csv or "").split(",")
            )
            if not supported_languages:
                raise ValueError(
                    "activities_multilang mode requires supported languages (comma-separated)"
                )

            normalized_default_language = _normalize_language_code(default_language)
            if not normalized_default_language:
                raise ValueError(
                    "activities_multilang mode requires a valid default language"
                )
            if normalized_default_language not in supported_languages:
                raise ValueError(
                    "default_language must be included in supported languages"
                )

            activities_by_lang = await _parse_activities_uploads_by_language(
                activities_files=activities_files,
                explicit_map_json=activities_language_map,
            )

            _validate_activities_multilang_in_memory(
                activities_by_lang=activities_by_lang,
                supported_languages=supported_languages,
                default_language=normalized_default_language,
            )

            audit_admin_action(
                current_admin,
                "validated multilingual activities file set successfully",
            )
            return {
                "ok": True,
                "mode": mode,
                "summary": {
                    "languages": supported_languages,
                    "default_language": normalized_default_language,
                    "uploaded_languages": sorted(activities_by_lang.keys()),
                },
                "errors": [],
            }

        if studies_config_file is None:
            raise ValueError("full_study mode requires a studies_config file upload")

        studies_config_json = await _parse_json_upload(
            studies_config_file,
            "studies_config file",
        )
        study = _extract_single_study_from_studies_config(studies_config_json)

        expected_files_by_language: Dict[str, str] = {}
        if isinstance(study.get("activities_json_files"), dict):
            expected_files_by_language = {
                str(language): str(path)
                for language, path in study["activities_json_files"].items()
            }
        elif isinstance(study.get("activities_json_file"), dict):
            expected_files_by_language = {
                str(language): str(path)
                for language, path in study["activities_json_file"].items()
            }
        elif isinstance(study.get("activities_json_file"), str):
            default_lang = study.get("default_language") or "en"
            expected_files_by_language = {
                str(default_lang): str(study["activities_json_file"])
            }

        activities_by_lang = await _parse_activities_uploads_by_language(
            activities_files=activities_files,
            explicit_map_json=activities_language_map,
            expected_filenames_by_language=expected_files_by_language
            if expected_files_by_language
            else None,
        )

        study_payload_dict = dict(study)
        study_payload_dict.pop("activities_json_file", None)
        study_payload_dict.pop("activities_json_files", None)
        study_payload_dict["activities_json_data"] = activities_by_lang

        import_study_payload = ImportStudiesConfigStudy(**study_payload_dict)
        validated = _validate_import_study_payload(import_study_payload)

        audit_admin_action(
            current_admin,
            (
                "validated full study package successfully "
                f"(study_name_short='{import_study_payload.name_short}')"
            ),
        )
        return {
            "ok": True,
            "mode": mode,
            "summary": {
                "study_name_short": import_study_payload.name_short,
                "supported_languages": validated["supported_languages"],
                "default_language": validated["default_language"],
            },
            "errors": [],
        }

    except Exception as error:
        logger.warning(
            "Admin '%s' file validation failed in mode '%s': %s",
            current_admin,
            mode,
            error,
        )
        audit_admin_action(
            current_admin,
            f"attempted file validation in mode '{mode}' and received validation errors",
        )
        return {
            "ok": False,
            "mode": mode,
            "summary": {},
            "errors": _format_exception_for_client(error),
        }


@app.post("/api/admin/studies/{study_name_short}/assign-participants")
async def assign_participants_to_study(
    study_name_short: str,
    payload: AssignParticipantsRequest,
    current_admin: str = Depends(verify_admin),
    session: Session = Depends(get_session),
):
    """Assign a list of participants to a study, creating participant records when needed.

    @param study_name_short Study short name.
    @param payload Participant assignment request payload.
    @param current_admin Authenticated admin username from Basic Auth dependency.
    @param session Database session dependency.
    @returns Assignment summary and resulting study participant count.
    """
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()
    if not study:
        raise HTTPException(
            status_code=404, detail=f"Study '{study_name_short}' not found"
        )

    normalized_ids = []
    seen = set()
    for raw_id in payload.participant_ids:
        participant_id = (raw_id or "").strip()
        if not participant_id or participant_id in seen:
            continue
        seen.add(participant_id)
        normalized_ids.append(participant_id)

    if not normalized_ids:
        raise HTTPException(status_code=400, detail="No valid participant IDs provided")

    if payload.must_be_new:
        existing_participants = session.exec(
            select(Participant).where(Participant.id.in_(normalized_ids))
        ).all()
        if existing_participants:
            existing_ids = sorted(
                [participant.id for participant in existing_participants]
            )
            raise HTTPException(
                status_code=400,
                detail={
                    "message": "Some participants already exist and must_be_new is enabled",
                    "existing_participant_ids": existing_ids,
                },
            )

    summary = {
        "created_and_assigned": 0,
        "already_existed_and_assigned": 0,
        "already_assigned": 0,
    }

    for participant_id in normalized_ids:
        participant = session.get(Participant, participant_id)
        participant_created = False
        if not participant:
            participant = Participant(id=participant_id)
            session.add(participant)
            participant_created = True

        existing_association = session.exec(
            select(StudyParticipant).where(
                StudyParticipant.study_id == study.id,
                StudyParticipant.participant_id == participant_id,
            )
        ).first()

        if existing_association:
            summary["already_assigned"] += 1
            continue

        session.add(StudyParticipant(study_id=study.id, participant_id=participant_id))

        if participant_created:
            summary["created_and_assigned"] += 1
        else:
            summary["already_existed_and_assigned"] += 1

    session.commit()

    total_after_assignment = (
        session.exec(
            select(func.count(StudyParticipant.id)).where(
                StudyParticipant.study_id == study.id
            )
        ).first()
        or 0
    )

    logger.info(
        f"Admin '{current_admin}' assigned participants to study '{study_name_short}'. "
        f"Summary: {summary}, total_after_assignment={total_after_assignment}"
    )
    assigned_count = (
        summary["created_and_assigned"] + summary["already_existed_and_assigned"]
    )
    audit_admin_action(
        current_admin,
        (
            f"assigned participants to study '{study_name_short}' "
            f"(new_assignments={assigned_count}, already_assigned={summary['already_assigned']}, "
            f"total_after_assignment={total_after_assignment})"
        ),
    )

    return {
        "study_name_short": study_name_short,
        "summary": {
            **summary,
            "total_after_assignment": total_after_assignment,
        },
    }


@app.delete("/api/admin/studies/{study_name_short}/participants/{participant_id}")
async def remove_participant_from_study(
    study_name_short: str,
    participant_id: str,
    current_admin: str = Depends(verify_admin),
    session: Session = Depends(get_session),
):
    """Remove participant association from a study.

    @param study_name_short Study short name.
    @param participant_id Participant identifier.
    @param current_admin Authenticated admin username from Basic Auth dependency.
    @param session Database session dependency.
    @returns A confirmation object when association is deleted.
    """
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()
    if not study:
        raise HTTPException(
            status_code=404, detail=f"Study '{study_name_short}' not found"
        )

    association = session.exec(
        select(StudyParticipant).where(
            StudyParticipant.study_id == study.id,
            StudyParticipant.participant_id == participant_id,
        )
    ).first()

    if not association:
        raise HTTPException(
            status_code=404,
            detail=f"Participant '{participant_id}' is not assigned to study '{study_name_short}'",
        )

    session.delete(association)
    session.commit()

    logger.info(
        f"Admin '{current_admin}' removed participant '{participant_id}' from study '{study_name_short}'."
    )
    audit_admin_action(
        current_admin,
        f"removed participant '{participant_id}' from study '{study_name_short}'",
    )

    return {
        "message": "Participant removed from study",
        "study_name_short": study_name_short,
        "participant_id": participant_id,
    }


@app.delete("/api/admin/studies/{study_name_short}")
async def delete_study(
    study_name_short: str,
    current_admin: str = Depends(verify_admin),
    session: Session = Depends(get_session),
):
    """Delete a study and all study-scoped data.

    This is intended for administrative cleanup (e.g., integration test artifacts).
    Shared participant rows are preserved because they may belong to other studies.
    """
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()
    if not study:
        raise HTTPException(
            status_code=404, detail=f"Study '{study_name_short}' not found"
        )

    external_task_ids = session.exec(
        select(StudyExternalTask.id).where(StudyExternalTask.study_id == study.id)
    ).all()

    available_activity_ids = session.exec(
        select(StudyAvailableActivity.id).where(
            StudyAvailableActivity.study_id == study.id
        )
    ).all()

    if external_task_ids:
        session.exec(
            delete(StudyExternalTaskAssignment).where(
                StudyExternalTaskAssignment.external_task_id.in_(external_task_ids)
            )
        )

    if available_activity_ids:
        session.exec(
            delete(StudyAvailableActivityI18n).where(
                StudyAvailableActivityI18n.activity_id.in_(available_activity_ids)
            )
        )

    session.exec(delete(Activity).where(Activity.study_id == study.id))
    session.exec(delete(StudyParticipant).where(StudyParticipant.study_id == study.id))
    session.exec(
        delete(StudyActivityConfigBlob).where(
            StudyActivityConfigBlob.study_id == study.id
        )
    )
    session.exec(
        delete(StudyAvailableActivity).where(
            StudyAvailableActivity.study_id == study.id
        )
    )
    session.exec(
        delete(StudyAvailableCategory).where(
            StudyAvailableCategory.study_id == study.id
        )
    )
    session.exec(
        delete(StudyAvailableTimeline).where(
            StudyAvailableTimeline.study_id == study.id
        )
    )
    session.exec(
        delete(StudyExternalTask).where(StudyExternalTask.study_id == study.id)
    )
    session.exec(delete(Timeline).where(Timeline.study_id == study.id))
    session.exec(delete(DayLabel).where(DayLabel.study_id == study.id))
    session.exec(delete(Study).where(Study.id == study.id))

    session.commit()

    logger.info("Admin '%s' deleted study '%s'", current_admin, study_name_short)
    audit_admin_action(current_admin, f"deleted study '{study_name_short}'")

    return {
        "message": "Study deleted",
        "study_name_short": study_name_short,
    }


@app.get("/api/admin/export/{study_name_short}/activities")
async def export_study_activities(
    request: Request,
    study_name_short: str,
    format: Optional[str] = Query("csv", description="Output format: 'csv' or 'json'"),
    include_metadata: Optional[bool] = Query(
        True, description="Include metadata columns"
    ),
    include_path: Optional[bool] = Query(
        True, description="Include activity path columns"
    ),
    current_admin: str = Depends(verify_admin),
    session: Session = Depends(get_session),
):
    """
    Export activities for a specific study in CSV or JSON format.
    Defaults to CSV format for scientific analysis.

    @param request FastAPI request object.
    @param study_name_short Short name of the study to export.
    @param format Output format, either `csv` or `json`.
    @param include_metadata Whether metadata columns are included.
    @param include_path Whether activity path columns are included.
    @param current_admin Authenticated admin username from Basic Auth dependency.
    @param session Database session dependency.
    @returns A file-download response containing exported activities for the study.
    """

    logger.info(
        f"Admin '{current_admin}' requested export of activities for study '{study_name_short}' in format '{format}'"
    )

    # Validate study exists
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()

    if not study:
        raise HTTPException(
            status_code=404, detail=f"Study '{study_name_short}' not found"
        )

    # Get all activities for this study with related data
    activities = session.exec(
        select(Activity, Participant, DayLabel, Timeline)
        .join(Participant, Activity.participant_id == Participant.id)
        .join(DayLabel, Activity.day_label_id == DayLabel.id)
        .join(Timeline, Activity.timeline_id == Timeline.id)
        .where(Activity.study_id == study.id)
        .order_by(
            Activity.participant_id, Activity.day_label_id, Activity.start_minutes
        )
    ).all()

    if not activities:
        raise HTTPException(
            status_code=404,
            detail=f"No activities found for study '{study_name_short}'",
        )

    consent_by_participant: Dict[str, StudyParticipant] = {}
    if study.require_consent:
        study_participants = session.exec(
            select(StudyParticipant).where(StudyParticipant.study_id == study.id)
        ).all()
        consent_by_participant = {
            study_participant.participant_id: study_participant
            for study_participant in study_participants
        }

    # Prepare the data with dereferenced fields
    export_data = []
    for activity, participant, day_label, timeline in activities:
        # Format time range
        start_hour = activity.start_minutes // 60
        start_minute = activity.start_minutes % 60
        end_hour = activity.end_minutes // 60
        end_minute = activity.end_minutes % 60

        duration_minutes = activity.end_minutes - activity.start_minutes

        # Base data that everyone wants
        record = {
            # Core activity data
            "activity_id_backend": activity.id,
            "activity_code": activity.activity_code,
            "activity_name": activity.activity_name,
            "frequency": activity.frequency_key or "",
            "start_time": f"{start_hour:02d}:{start_minute:02d}",
            "end_time": f"{end_hour:02d}:{end_minute:02d}",
            "start_minutes": activity.start_minutes,
            "end_minutes": activity.end_minutes,
            "duration_minutes": duration_minutes,
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

        if study.require_consent:
            study_participant = consent_by_participant.get(participant.id)
            consent_decided_at = (
                study_participant.consent_decided_at.isoformat()
                if study_participant and study_participant.consent_decided_at
                else None
            )
            record.update(
                {
                    "study_requires_consent": True,
                    "participant_consent_given": (
                        study_participant.consent_given if study_participant else None
                    ),
                    "participant_consent_decided_at": consent_decided_at,
                }
            )

        # Add parent activity info if available
        if activity.parent_activity_code:
            record["parent_activity_code"] = activity.parent_activity_code
        else:
            record["parent_activity_code"] = ""

        # Add metadata if requested
        if include_metadata:
            record.update(
                {
                    "created_at": activity.created_at.isoformat(),
                    "data_collection_start": study.data_collection_start.isoformat(),
                    "data_collection_end": study.data_collection_end.isoformat(),
                    "participant_created_at": participant.created_at.isoformat(),
                    "timeline_description": timeline.description or "",
                    "timeline_min_coverage": timeline.min_coverage or 0,
                }
            )

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

            record.update(
                {"activity_path_full": activity.activity_path_frontend, **path_parts}
            )

        export_data.append(record)

    # Generate filename with timestamp
    timestamp = utc_now().strftime("%Y%m%d_%H%M%S")
    filename = f"{study_name_short}_activities_{timestamp}"

    audit_admin_action(
        current_admin,
        (
            f"downloaded activities export for study '{study_name_short}' "
            f"(format={format.lower()}, records={len(export_data)}, include_metadata={include_metadata}, include_path={include_path})"
        ),
    )

    if format.lower() == "json":
        return export_json(export_data, filename)
    else:
        return export_csv(export_data, filename)


def export_csv(data: list, filename: str) -> Response:
    """
    Export data as CSV with proper headers. Used in admin interface.
    @param data: List of records to export
    @param filename: Base filename without extension (timestamp and extension will be added)
    @return A Response object containing the CSV data with appropriate headers for file download.
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

    @param data: List of records to export
    @param filename: Base filename without extension (timestamp and extension will be added)
    @return A Response object containing the JSON data with appropriate headers for file download.
    """
    if not data:
        raise HTTPException(status_code=404, detail="No data to export")

    # Create JSON response
    response_data = {
        "metadata": {
            "export_timestamp": utc_now().isoformat(),
            "total_records": len(data),
            "format": "json",
            "version": "1.0",
        },
        "data": data,
    }

    content = json.dumps(response_data, indent=2, default=str)
    response = Response(content=content, media_type="application/json")
    response.headers["Content-Disposition"] = f"attachment; filename={filename}.json"
    response.headers["Content-Type"] = "application/json; charset=utf-8"

    return response


def timelines_to_json(timelines: List[Timeline]) -> List[dict]:
    """Convert list of Timeline objects to JSON list with selected fields.

    @param timelines: List of Timeline objects to convert
    @return: List of dictionaries with timeline data for frontend
    """
    return [
        timeline.dict(include={"name", "display_name", "mode", "min_coverage"})
        for timeline in timelines
    ]


@app.get("/api/studies/{study_name_short}/participants/{participant_id}/activities")
def get_participant_day_activities(
    study_name_short: str,
    participant_id: str,
    day_label_name: Optional[str] = Query(
        None,
        description="Day label name (e.g., 'monday'). Either this or day_label_index must be provided",
    ),
    day_label_index: Optional[int] = Query(
        None,
        description="Day label display order/index. Either this or day_label_name must be provided",
    ),
    template_from_day_index: Optional[int] = Query(
        None,
        description="Optional: Day index to use as template source. Defaults to previous day (current_day_index - 1)",
    ),
    session: Session = Depends(get_session),
):
    """
    Get all activities for a specific participant and day in a study.
    This endpoint is for participants to retrieve their own data for editing.
    Returns activities across all timelines for the specified day.

    Either day_label_name or day_label_index must be provided to identify the target day.

    @param study_name_short Short name of the study.
    @param participant_id ID of the participant.
    @param day_label_name (Optional) Day-label name for activity retrieval.
    @param day_label_index (Optional) Day-label index/display order for activity retrieval.
    @param template_from_day_index (Optional) Source day index for template activities.
    @param session Database session dependency.
    @returns A JSON response containing activities, timeline metadata, and optional template activities.

    Optionally include activities from a previous day as a template:
    - If template_from_day_index is not provided, defaults to previous day (current_day_index - 1)
    - If template_from_day_index is provided, uses that specific day as template source
    - Returns empty template if specified source day doesn't exist or has no activities
    """
    # Validate that at least one identifier is provided
    if day_label_name is None and day_label_index is None:
        raise HTTPException(
            status_code=400,
            detail="Either day_label_name or day_label_index must be provided",
        )

    # Validate study exists
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()
    if not study:
        raise HTTPException(
            status_code=404, detail=f"Study '{study_name_short}' not found"
        )

    # Check if participant is authorized for this study
    if not study.allow_unlisted_participants:
        # Study restricts participants - check if they're in the allowed list
        study_participant = session.exec(
            select(StudyParticipant).where(
                StudyParticipant.study_id == study.id,
                StudyParticipant.participant_id == participant_id,
            )
        ).first()
        if not study_participant:
            logger.info(
                f"Unauthorized participant '{participant_id}' attempted to access data from study '{study_name_short}'"
            )
            raise HTTPException(
                status_code=403,
                detail=f"Participant '{participant_id}' not authorized for this study",
            )
    else:
        # Study allows unlisted participants - ensure participant exists
        participant = session.exec(
            select(Participant).where(Participant.id == participant_id)
        ).first()
        if not participant:
            raise HTTPException(
                status_code=403,
                detail=f"Participant '{participant_id}' does not exist for this study",
            )

    # Find the target day label
    day_label = None
    if day_label_name is not None:
        # Find by name
        day_label = session.exec(
            select(DayLabel).where(
                DayLabel.study_id == study.id, DayLabel.name == day_label_name
            )
        ).first()
        if not day_label:
            raise HTTPException(
                status_code=404,
                detail=f"Day label '{day_label_name}' not found for study '{study_name_short}'",
            )
    else:
        # Find by index
        day_label = session.exec(
            select(DayLabel).where(
                DayLabel.study_id == study.id, DayLabel.display_order == day_label_index
            )
        ).first()
        if not day_label:
            raise HTTPException(
                status_code=404,
                detail=f"Day label with index '{day_label_index}' not found for study '{study_name_short}'",
            )

    study_timelines: List[Timeline] = get_timelines_for_study(study.id)
    study_timelines_json = timelines_to_json(study_timelines)
    study_timelines_names = [t.name for t in study_timelines]

    # Get all activities for this participant and day label
    activities = session.exec(
        select(Activity, Timeline)
        .join(Timeline, Activity.timeline_id == Timeline.id)
        .where(
            Activity.study_id == study.id,
            Activity.participant_id == participant_id,
            Activity.day_label_id == day_label.id,
        )
        .order_by(Activity.start_minutes, Activity.timeline_id)
    ).all()

    day_indices_with_data_rows = session.exec(
        select(DayLabel.display_order)
        .join(Activity, Activity.day_label_id == DayLabel.id)
        .where(
            Activity.study_id == study.id,
            Activity.participant_id == participant_id,
            DayLabel.study_id == study.id,
        )
    ).all()
    day_indices_with_data = sorted(
        {int(day_index) for day_index in day_indices_with_data_rows}
    )

    # Structure the response in a frontend-friendly format
    response_activities = []
    for activity, timeline in activities:
        start_time: str = get_time_for_minutes_from_midnight(
            activity.start_minutes
        ).isoformat()  # something like "08:30:00"
        end_time = get_time_for_minutes_from_midnight(activity.end_minutes).isoformat()
        response_activities.append(
            {
                # Activity data
                "timeline_key": timeline.name,
                "timeline_display_name": timeline.display_name,
                "timeline_mode": timeline.mode,
                "activity": activity.activity_name,
                "activity_code": activity.activity_code,
                "frequency_key": activity.frequency_key,
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
                "activity_id_backend": activity.id,
            }
        )

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
                DayLabel.display_order == target_template_index,
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
                    Activity.day_label_id == template_source_day_label.id,
                )
                .order_by(Activity.start_minutes, Activity.timeline_id)
            ).all()

            if template_source_activities:
                has_template = True
                template_source_day_index = template_source_day_label.display_order

                for activity, timeline in template_source_activities:
                    start_time: str = get_time_for_minutes_from_midnight(
                        activity.start_minutes
                    ).isoformat()  # something like "08:30:00"
                    end_time = get_time_for_minutes_from_midnight(
                        activity.end_minutes
                    ).isoformat()
                    template_activities.append(
                        {
                            # Activity data
                            "timeline_key": timeline.name,
                            "timeline_display_name": timeline.display_name,
                            "timeline_mode": timeline.mode,
                            "activity": activity.activity_name,
                            "activity_code": activity.activity_code,
                            "frequency_key": activity.frequency_key,
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
                            "activity_id_backend": None,  # No ID yet, since this is just a template and not an actual saved activity for the current day.
                            # Template source information
                            "is_template_from_previous_day": True,
                            "template_source_day_label": template_source_day_label.name,
                            "template_source_day_index": template_source_day_label.display_order,
                        }
                    )

    print(
        f"Returning activities for participant '{participant_id}', study '{study_name_short}', "
        f"day label '{day_label.name}' (index: {day_label.display_order}): {len(response_activities)} activities, "
        f"has_template: {has_template}"
    )

    # Determine meta-data on the study, including the number of days
    study_days = session.exec(
        select(DayLabel).where(DayLabel.study_id == study.id)
    ).all()
    study_days_count = len(study_days)

    return {
        "study": study_name_short,
        "study_days_count": study_days_count,
        "day_indices_with_data": day_indices_with_data,
        "participant": participant_id,
        "day_label": day_label.name,
        "day_label_id": day_label.id,
        "day_label_index": day_label.display_order,
        "day_display_name": day_label.display_name,
        "timelines_in_study": study_timelines_json,
        "total_activities": len(response_activities),
        "total_timelines": len(study_timelines_names),
        "total_timelines_with_activities": len(
            set([a["timeline_key"] for a in response_activities])
        ),
        "activities": response_activities,
        # Template information
        "has_template": has_template,
        "template_source_day_label": template_source_day_label.name
        if template_source_day_label
        else None,
        "template_source_day_index": template_source_day_index,
        "template_activities": template_activities if has_template else [],
    }


@app.post("/api/template-activities")
def copy_cross_user_template_activities(
    study: str = Query(..., description="Study short name"),
    source_user: str = Query(
        ..., description="Participant ID to copy template activities from"
    ),
    target_user: str = Query(
        ..., description="Participant ID to copy template activities to"
    ),
    session: Session = Depends(get_session),
):
    """
    Copy all activities from source_user to target_user for a study, writing them directly into
    the database.  Days for which target_user already has activities are skipped, making the
    operation idempotent.  For open studies the target participant record and study association
    are created automatically on first call.

    Validation rules:
    - `study` must exist
    - `source_user` must exist as participant
    - If study is closed (`allow_unlisted_participants=False`), `target_user` must already be
      assigned to the study

    @param study Study short name.
    @param source_user Source participant ID.
    @param target_user Target participant ID.
    @param session Database session dependency.
    @returns Summary of copied and skipped days/activities.
    """
    from collections import defaultdict

    # Validate study exists
    study_obj = session.exec(select(Study).where(Study.name_short == study)).first()
    if not study_obj:
        raise HTTPException(status_code=404, detail=f"Study '{study}' not found")

    # Validate source participant exists
    source_participant = session.exec(
        select(Participant).where(Participant.id == source_user)
    ).first()
    if not source_participant:
        raise HTTPException(
            status_code=404, detail=f"Source participant '{source_user}' not found"
        )

    # For closed studies, source and target must be assigned to this study
    if not study_obj.allow_unlisted_participants:
        source_association = session.exec(
            select(StudyParticipant).where(
                StudyParticipant.study_id == study_obj.id,
                StudyParticipant.participant_id == source_user,
            )
        ).first()
        if not source_association:
            raise HTTPException(
                status_code=403,
                detail=f"Source participant '{source_user}' is not authorized for study '{study}'",
            )

        target_association = session.exec(
            select(StudyParticipant).where(
                StudyParticipant.study_id == study_obj.id,
                StudyParticipant.participant_id == target_user,
            )
        ).first()
        if not target_association:
            raise HTTPException(
                status_code=403,
                detail=f"Target participant '{target_user}' is not authorized for closed study '{study}'",
            )
    else:
        # Open study: auto-create Participant and StudyParticipant for target_user if needed
        target_participant = session.exec(
            select(Participant).where(Participant.id == target_user)
        ).first()
        if not target_participant:
            target_participant = Participant(id=target_user)
            session.add(target_participant)
            session.flush()

        target_study_assoc = session.exec(
            select(StudyParticipant).where(
                StudyParticipant.study_id == study_obj.id,
                StudyParticipant.participant_id == target_user,
            )
        ).first()
        if not target_study_assoc:
            target_study_assoc = StudyParticipant(
                study_id=study_obj.id, participant_id=target_user
            )
            session.add(target_study_assoc)
            session.flush()

    # Fetch all source activities
    source_activities = session.exec(
        select(Activity)
        .where(
            Activity.study_id == study_obj.id,
            Activity.participant_id == source_user,
        )
        .order_by(Activity.day_label_id, Activity.start_minutes, Activity.timeline_id)
    ).all()

    # Find which day_label_ids target_user already has activities for → skip those
    target_day_label_ids_with_data: set = set(
        session.exec(
            select(Activity.day_label_id).where(
                Activity.study_id == study_obj.id,
                Activity.participant_id == target_user,
            )
        ).all()
    )

    # Group source activities by day_label_id
    source_by_day: dict = defaultdict(list)
    for activity in source_activities:
        source_by_day[activity.day_label_id].append(activity)

    source_day_label_ids = set(source_by_day.keys())
    days_to_copy = source_day_label_ids - target_day_label_ids_with_data
    days_to_skip = source_day_label_ids & target_day_label_ids_with_data

    # Insert copied activities for each day that has no existing target data
    total_activities_copied = 0
    for day_label_id in days_to_copy:
        for src in source_by_day[day_label_id]:
            new_activity = Activity(
                study_id=study_obj.id,
                participant_id=target_user,
                day_label_id=src.day_label_id,
                timeline_id=src.timeline_id,
                activity_code=src.activity_code,
                start_minutes=src.start_minutes,
                end_minutes=src.end_minutes,
                activity_name=src.activity_name,
                activity_path_frontend=src.activity_path_frontend,
                color=src.color,
                category=src.category,
                frequency_key=src.frequency_key,
                parent_activity_code=src.parent_activity_code,
            )
            session.add(new_activity)
            total_activities_copied += 1

    session.commit()

    # Resolve display_order indices for the response
    copied_day_indices: list = []
    skipped_day_indices: list = []
    all_relevant_ids = days_to_copy | days_to_skip
    if all_relevant_ids:
        day_labels = session.exec(
            select(DayLabel).where(
                DayLabel.study_id == study_obj.id, DayLabel.id.in_(all_relevant_ids)
            )
        ).all()
        order_map = {dl.id: int(dl.display_order) for dl in day_labels}
        copied_day_indices = sorted(
            order_map[d] for d in days_to_copy if d in order_map
        )
        skipped_day_indices = sorted(
            order_map[d] for d in days_to_skip if d in order_map
        )

    logger.info(
        "Copied cross-user template activities: study='%s', source='%s', target='%s', "
        "copied_days=%d, skipped_days=%d, total_activities=%d",
        study,
        source_user,
        target_user,
        len(days_to_copy),
        len(days_to_skip),
        total_activities_copied,
    )

    return {
        "study": study,
        "source_user": source_user,
        "target_user": target_user,
        "copied_days_count": len(days_to_copy),
        "skipped_days_count": len(days_to_skip),
        "total_activities_copied": total_activities_copied,
        "copied_day_indices": copied_day_indices,
        "skipped_day_indices": skipped_day_indices,
    }


class ActiveOpenStudyResponse(BaseModel):
    name_short: str
    name: Optional[str] = None
    description: Optional[str] = None


@app.get("/api/active_open_study_names", response_model=List[ActiveOpenStudyResponse])
async def get_active_open_study_names(session: Session = Depends(get_session)):
    """
    Public endpoint (no authentication required) that returns a list of all studies
    that:
    1. Have allow_unlisted_participants set to True
    2. Are currently active (current date is between data_collection_start and data_collection_end)

    Each study object includes name_short, name, and description fields.
    Returns empty list if no studies match criteria.

    @param session Database session dependency.
    @returns A JSON list of currently active open studies with `name_short`, `name`, and `description`.
    """
    try:
        # Get current UTC time
        now = utc_now()

        # Query for studies that match both criteria
        studies = session.exec(
            select(Study)
            .where(
                Study.allow_unlisted_participants,
                Study.data_collection_start <= now,
                Study.data_collection_end >= now,
            )
            .order_by(Study.name_short)  # Optional: order alphabetically
        ).all()

        # Create response objects with the required fields
        study_responses = [
            ActiveOpenStudyResponse(
                name_short=study.name_short,
                name=study.name,
                description=study.description,
            )
            for study in studies
        ]

        logger.info(f"Found {len(study_responses)} active open studies")

        return study_responses

    except Exception as e:
        logger.error(f"Error fetching active open study names: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Internal server error while fetching study information",
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


class ParticipantExternalTaskResponse(BaseModel):
    task_key: str
    name: str
    description: Optional[str] = None
    confirmation_type: str
    assigned_token: str
    continuation_url: str
    is_confirmed: bool = False
    confirmed_at: Optional[datetime] = None


class StudyConfigResponse(BaseModel):
    study_name: str
    study_name_short: str
    description: str
    allow_unlisted_participants: bool
    require_consent: bool = False
    data_collection_start: datetime
    data_collection_end: datetime
    default_language: str
    activities_json_url: str
    supported_languages: List[str]
    selected_language: str
    study_text_intro: Optional[str] = None
    study_text_end_completed: Optional[str] = None
    study_text_end_skipped: Optional[str] = None
    study_text_end_noconsent: Optional[str] = None
    study_text_consent: Optional[str] = None
    consent_given: Optional[bool] = None
    consent_decided_at: Optional[datetime] = None
    instructions_completed: bool = False
    instructions_completed_at: Optional[datetime] = None
    participant_has_completed_study: bool = False
    external_tasks: List[ParticipantExternalTaskResponse] = []
    all_external_tasks_confirmed: bool = False
    timelines: List[TimelineConfigResponse]
    day_labels: List[DayLabelConfigResponse]
    study_days_count: int


@app.get(
    "/api/studies/{study_name_short}/study-config", response_model=StudyConfigResponse
)
def get_study_config(
    study_name_short: str,
    lang: Optional[str] = Query(
        None,
        description="Optional language code for localized day labels/texts. Defaults to study default language.",
    ),
    participant_id: Optional[str] = Query(
        None,
        description="Participant ID for authorization check. Required unless study is open for everyone.",
    ),
    session: Session = Depends(get_session),
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

    @param study_name_short: Short name of the study to retrieve config for
    @param participant_id: (Optional) Participant ID for authorization check. Required if study is not open for everyone.
    @param session Database session dependency.
    @returns A JSON response containing study configuration, timelines, and day labels.
    """
    # Find the study
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()

    if not study:
        raise HTTPException(
            status_code=404, detail=f"Study '{study_name_short}' not found"
        )

    # Check if participant_id is required
    if not study.allow_unlisted_participants:
        # Study restricts participants - participant_id parameter is required
        if participant_id is None:
            raise HTTPException(
                status_code=400,
                detail="Participant ID is required for this study. "
                "Please provide 'participant_id' query parameter.",
            )

        # Check if the participant is authorized for this study
        study_participant = session.exec(
            select(StudyParticipant).where(
                StudyParticipant.study_id == study.id,
                StudyParticipant.participant_id == participant_id,
            )
        ).first()

        if not study_participant:
            logger.info(
                f"Unauthorized participant '{participant_id}' attempted to access study config for '{study_name_short}'"
            )
            raise HTTPException(
                status_code=403,
                detail=f"Participant '{participant_id}' not authorized for this study",
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
                logger.debug(
                    f"Provided participant_id '{participant_id}' doesn't exist for open study '{study_name_short}'"
                )

    cfg_study = get_cfg_study_by_name_short(
        study_name_short, settings.studies_config_path
    )
    normalized_lang = _normalize_language_code(lang)
    selected_language = normalized_lang or study.default_language
    supported_languages: List[str] = [study.default_language]
    if cfg_study:
        supported_languages = [
            _normalize_language_code(language) or language
            for language in cfg_study.get_supported_languages()
        ]
    else:
        blob_languages = session.exec(
            select(StudyActivityConfigBlob.language)
            .where(StudyActivityConfigBlob.study_id == study.id)
            .order_by(StudyActivityConfigBlob.language)
        ).all()
        if blob_languages:
            supported_languages = [
                _normalize_language_code(language) or language
                for language in blob_languages
            ]

    if selected_language not in supported_languages:
        selected_language = study.default_language

    logger.info(
        "[TRAC day-label-debug] study-config language resolution: requested_lang='%s' normalized_lang='%s' selected_language='%s' supported_languages=%s",
        lang,
        normalized_lang,
        selected_language,
        supported_languages,
    )

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
            min_coverage=timeline.min_coverage,
        )
        for timeline in timelines
    ]

    day_label_responses = []
    for day_label in day_labels:
        display_name = day_label.display_name
        if cfg_study:
            localized_display_name = cfg_study.get_day_label_display_name(
                day_label.name, selected_language
            )
            if localized_display_name:
                display_name = localized_display_name
        day_label_responses.append(
            DayLabelConfigResponse(
                name=day_label.name,
                display_order=day_label.display_order,
                display_name=display_name,
            )
        )

    study_text_intro = _get_localized_study_text(
        study, "study_text_intro", selected_language
    )
    study_text_end_completed = _get_localized_study_text(
        study, "study_text_end_completed", selected_language
    )
    study_text_end_skipped = _get_localized_study_text(
        study, "study_text_end_skipped", selected_language
    )
    study_text_end_noconsent = _get_localized_study_text(
        study, "study_text_end_noconsent", selected_language
    )
    study_text_consent = _get_localized_study_text(
        study, "study_text_consent", selected_language
    )
    require_consent = bool(study.require_consent)

    consent_given = None
    consent_decided_at = None
    instructions_completed = False
    instructions_completed_at = None
    if participant_id is not None:
        study_participant = _get_study_participant_association(
            session, study, participant_id
        )
        if study_participant:
            consent_given = study_participant.consent_given
            consent_decided_at = study_participant.consent_decided_at
            instructions_completed = bool(study_participant.instructions_completed)
            instructions_completed_at = study_participant.instructions_completed_at

    participant_external_tasks = _get_participant_external_tasks(
        session, study, participant_id
    )
    all_external_tasks_confirmed = bool(participant_external_tasks) and all(
        external_task.is_confirmed for external_task in participant_external_tasks
    )
    participant_has_completed_study = _is_participant_study_complete(
        session=session,
        study=study,
        participant_id=participant_id,
        study_days_count=len(day_labels),
    )

    return StudyConfigResponse(
        study_name=study.name,
        study_name_short=study.name_short,
        description=study.description,
        allow_unlisted_participants=study.allow_unlisted_participants,
        require_consent=require_consent,
        data_collection_start=study.data_collection_start,
        data_collection_end=study.data_collection_end,
        default_language=study.default_language,
        activities_json_url=study.activities_json_url,
        supported_languages=supported_languages,
        selected_language=selected_language,
        study_text_intro=study_text_intro,
        study_text_end_completed=study_text_end_completed,
        study_text_end_skipped=study_text_end_skipped,
        study_text_end_noconsent=study_text_end_noconsent,
        study_text_consent=study_text_consent,
        consent_given=consent_given,
        consent_decided_at=consent_decided_at,
        instructions_completed=instructions_completed,
        instructions_completed_at=instructions_completed_at,
        participant_has_completed_study=participant_has_completed_study,
        external_tasks=participant_external_tasks,
        all_external_tasks_confirmed=all_external_tasks_confirmed,
        timelines=timeline_responses,
        day_labels=day_label_responses,
        study_days_count=len(day_labels),
    )


class ConfirmExternalTaskCallbackPayload(BaseModel):
    task_key: str
    assigned_token: str


class CompleteInstructionsPayload(BaseModel):
    completed: bool = True


@app.post(
    "/api/studies/{study_name_short}/participants/{participant_id}/external-tasks/confirm"
)
def confirm_external_task_callback(
    study_name_short: str,
    participant_id: str,
    payload: ConfirmExternalTaskCallbackPayload,
    session: Session = Depends(get_session),
):
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()
    if not study:
        raise HTTPException(
            status_code=404, detail=f"Study '{study_name_short}' not found"
        )

    if not study.allow_unlisted_participants:
        study_participant = _get_study_participant_association(
            session, study, participant_id
        )
        if not study_participant:
            raise HTTPException(
                status_code=403,
                detail=f"Participant '{participant_id}' not authorized for this study",
            )

    assignment_row = session.exec(
        select(StudyExternalTaskAssignment, StudyExternalTask)
        .join(
            StudyExternalTask,
            StudyExternalTask.id == StudyExternalTaskAssignment.external_task_id,
        )
        .where(
            StudyExternalTask.study_id == study.id,
            StudyExternalTask.task_key == payload.task_key,
            StudyExternalTask.confirmation_type == "callback",
            StudyExternalTaskAssignment.participant_id == participant_id,
            StudyExternalTaskAssignment.assigned_token == payload.assigned_token,
        )
    ).first()

    if not assignment_row:
        raise HTTPException(
            status_code=404,
            detail="No matching callback external task assignment found",
        )

    assignment, external_task = assignment_row
    if not assignment.is_confirmed:
        assignment.is_confirmed = True
        assignment.confirmed_at = utc_now()
        session.add(assignment)
        session.commit()
        session.refresh(assignment)

    return {
        "study_name_short": study_name_short,
        "participant_id": participant_id,
        "task_key": external_task.task_key,
        "confirmation_type": external_task.confirmation_type,
        "is_confirmed": assignment.is_confirmed,
        "confirmed_at": assignment.confirmed_at,
    }


@app.post(
    "/api/studies/{study_name_short}/participants/{participant_id}/instructions/complete"
)
def complete_participant_instructions(
    study_name_short: str,
    participant_id: str,
    payload: CompleteInstructionsPayload,
    session: Session = Depends(get_session),
):
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()
    if not study:
        raise HTTPException(
            status_code=404, detail=f"Study '{study_name_short}' not found"
        )

    participant = session.exec(
        select(Participant).where(Participant.id == participant_id)
    ).first()
    if not participant:
        if not study.allow_unlisted_participants:
            raise HTTPException(
                status_code=403,
                detail=f"Participant '{participant_id}' not authorized for this study",
            )
        participant = Participant(id=participant_id)
        session.add(participant)
        session.flush()

    association = _get_study_participant_association(session, study, participant_id)
    if not association:
        if not study.allow_unlisted_participants:
            raise HTTPException(
                status_code=403,
                detail=f"Participant '{participant_id}' not authorized for this study",
            )
        association = StudyParticipant(study_id=study.id, participant_id=participant_id)

    association.instructions_completed = bool(payload.completed)
    association.instructions_completed_at = utc_now() if payload.completed else None
    session.add(association)
    session.commit()
    session.refresh(association)

    return {
        "study_name_short": study_name_short,
        "participant_id": participant_id,
        "instructions_completed": association.instructions_completed,
        "instructions_completed_at": association.instructions_completed_at,
    }


@app.post("/api/studies/{study_name_short}/participants/{participant_id}/consent")
async def set_participant_consent(
    study_name_short: str,
    participant_id: str,
    payload: UpdateConsentRequest,
    session: Session = Depends(get_session),
):
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()
    if not study:
        raise HTTPException(
            status_code=404, detail=f"Study '{study_name_short}' not found"
        )

    participant = session.get(Participant, participant_id)
    if not participant:
        participant = Participant(id=participant_id)
        session.add(participant)
        session.flush()

    association = session.exec(
        select(StudyParticipant).where(
            StudyParticipant.study_id == study.id,
            StudyParticipant.participant_id == participant_id,
        )
    ).first()

    if association is None:
        if not study.allow_unlisted_participants:
            raise HTTPException(
                status_code=403,
                detail=f"Participant '{participant_id}' not authorized for this study",
            )

        association = StudyParticipant(
            study_id=study.id,
            participant_id=participant_id,
        )
        session.add(association)

    association.consent_given = payload.consent_given
    association.consent_decided_at = utc_now()
    session.commit()

    return {
        "study_name_short": study_name_short,
        "participant_id": participant_id,
        "consent_given": association.consent_given,
        "consent_decided_at": association.consent_decided_at,
    }
