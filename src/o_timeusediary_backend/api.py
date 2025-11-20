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



from .logging_config import setup_logging
setup_logging()
logger = logging.getLogger(__name__)

from . settings import settings
from .models import TimeuseEntry, TimeuseEntryCreate, TimeuseEntryRead, StudyEntryName, Study, StudyRead, StudyCreate, StudyEntryNameCreate, StudyEntryNameRead, TimelineActivity
from .database import get_session, create_db_and_tables



@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info(f"TUD Backend starting with allowed origins: {settings.allowed_origins}")
    if settings.debug:
        print(f"Debug mode enabled.")

    logger.info("Running on_startup tasks...")
    create_db_and_tables()

    yield
    # Shutdown
    logger.info("TUD Backend shutting down")


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


@app.get("/")
def root():
    return {"message": "TUD API is running"}

@app.get("/health")
def health_check(session: Session = Depends(get_session)):
    count = session.exec(select(TimeuseEntry)).all()
    return {"status": "healthy", "entries_count": len(count)}





@app.post("/timeline/submit", response_model=TimeuseEntryRead)
async def submit_timeline_data(
    entry_data: TimeuseEntryCreate,
    session: Session = Depends(get_session)
):
    # Validate that the study exists
    study_name_short = entry_data.study_name_short
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()

    if not study:
        raise HTTPException(
            status_code=400,
            detail=f"Study '{study_name_short}' not found. Valid studies: {get_available_studies(session)}"
        )

    # Validate that the daily_entry_index exists for this study
    daily_entry_index = entry_data.daily_entry_index
    entry_name_obj = session.exec(
        select(StudyEntryName).where(
            StudyEntryName.study_id == study.id,
            StudyEntryName.entry_index == daily_entry_index
        )
    ).first()

    if not entry_name_obj:
        valid_indices = get_valid_entry_indices(session, study.id)
        raise HTTPException(
            status_code=400,
            detail=f"Daily entry index {daily_entry_index} not found for study '{study_name_short}'. Valid indices: {valid_indices}"
        )

    # Check if entry already exists for this participant+study+index combination
    existing_entry = session.exec(
        select(TimeuseEntry).where(
            TimeuseEntry.participant_id == entry_data.entry_metadata.participant.pid,
            TimeuseEntry.study_id == study.id,
            TimeuseEntry.daily_entry_index == daily_entry_index
        )
    ).first()

    if existing_entry:
        raise HTTPException(
            status_code=400,
            detail=f"Entry already exists for participant {entry_data.entry_metadata.participant.pid}, study {study_name_short}, index {daily_entry_index}"
        )

    # Create main entry
    db_entry = TimeuseEntry(
        participant_id=entry_data.entry_metadata.participant.pid,
        study_id=study.id,
        daily_entry_index=daily_entry_index,
        entry_metadata_json=entry_data.entry_metadata.dict(),
        raw_data=entry_data.dict()
    )

    session.add(db_entry)
    session.commit()
    session.refresh(db_entry)

    # Create activity entries
    for activity_data in entry_data.activities:
        db_activity = TimelineActivity(
            timeuse_entry_id=db_entry.id,
            **activity_data.dict()
        )
        session.add(db_activity)

    session.commit()

    # Return the created entry with study and entry name details
    return TimeuseEntryRead(
        id=db_entry.id,
        participant_id=db_entry.participant_id,
        study_id=db_entry.study_id,
        daily_entry_index=db_entry.daily_entry_index,
        submitted_at=db_entry.submitted_at,
        activities=entry_data.activities,
        entry_metadata=entry_data.entry_metadata,
        raw_data=db_entry.raw_data,
        study=StudyRead.from_orm(study),
        entry_name=entry_name_obj.entry_name
    )

def get_available_studies(session: Session) -> List[str]:
    studies = session.exec(select(Study)).all()
    return [study.name_short for study in studies]

def get_valid_entry_indices(session: Session, study_id: int) -> List[Tuple[int, str]]:
    entry_names = session.exec(
        select(StudyEntryName).where(StudyEntryName.study_id == study_id)
    ).all()
    return [(en.entry_index, en.entry_name) for en in entry_names]

# Study management endpoints
@app.post("/studies/", response_model=StudyRead)
async def create_study(study: StudyCreate, session: Session = Depends(get_session)):
    existing = session.exec(
        select(Study).where(Study.name_short == study.name_short)
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="Study with this short name already exists")

    db_study = Study.from_orm(study)
    session.add(db_study)
    session.commit()
    session.refresh(db_study)

    # Create entry names if provided
    if study.entry_names:
        for entry_name in study.entry_names:
            db_entry_name = StudyEntryName(
                study_id=db_study.id,
                entry_index=entry_name.entry_index,
                entry_name=entry_name.entry_name
            )
            session.add(db_entry_name)
        session.commit()

    return db_study

@app.post("/studies/{study_id}/entry_names", response_model=StudyEntryNameRead)
async def add_study_entry_name(
    study_id: int,
    entry_name: StudyEntryNameCreate,
    session: Session = Depends(get_session)
):
    study = session.get(Study, study_id)
    if not study:
        raise HTTPException(status_code=404, detail="Study not found")

    # Check if index or name already exists for this study
    existing_index = session.exec(
        select(StudyEntryName).where(
            StudyEntryName.study_id == study_id,
            StudyEntryName.entry_index == entry_name.entry_index
        )
    ).first()

    existing_name = session.exec(
        select(StudyEntryName).where(
            StudyEntryName.study_id == study_id,
            StudyEntryName.entry_name == entry_name.entry_name
        )
    ).first()

    if existing_index:
        raise HTTPException(status_code=400, detail=f"Entry index {entry_name.entry_index} already exists for this study")
    if existing_name:
        raise HTTPException(status_code=400, detail=f"Entry name '{entry_name.entry_name}' already exists for this study")

    db_entry_name = StudyEntryName(
        study_id=study_id,
        entry_index=entry_name.entry_index,
        entry_name=entry_name.entry_name
    )
    session.add(db_entry_name)
    session.commit()
    session.refresh(db_entry_name)
    return db_entry_name

@app.get("/studies/{study_id}/entry_names", response_model=List[StudyEntryNameRead])
async def get_study_entry_names(study_id: int, session: Session = Depends(get_session)):
    study = session.get(Study, study_id)
    if not study:
        raise HTTPException(status_code=404, detail="Study not found")

    entry_names = session.exec(
        select(StudyEntryName).where(StudyEntryName.study_id == study_id)
    ).all()
    return entry_names