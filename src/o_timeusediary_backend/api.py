from fastapi import FastAPI, HTTPException, Request, status, Response, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from fastapi.exceptions import RequestValidationError
import logging
import uuid
from typing import List, Optional
from datetime import datetime, timedelta
import csv
import json
import io
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select
from urllib.parse import urlparse

from .logging_config import setup_logging
setup_logging()
logger = logging.getLogger(__name__)

from . settings import settings
from .models import TimeuseEntry, TimeuseEntryCreate, TimeuseEntryRead, HealthEntryUpdate
from .database import get_session, create_db_and_tables



@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info(f"Backend starting with allowed origins: {settings.allowed_origins}")
    if settings.debug:
        print(f"Debug mode enabled.")

    logger.info("Running on_startup tasks...")
    create_db_and_tables()

    yield
    # Shutdown
    logger.info("Backend shutting down")


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


@app.post("/entries/", response_model=TimeuseEntryRead)
def submit_entry(entry: TimeuseEntryCreate, session: Session = Depends(get_session)):

    if not entry.uid:
        raise HTTPException(status_code=400, detail="User ID (uid) is required")

    # Use the date from the submitted entry, not today!
    target_date = entry.date

    # Calculate day_of_week from the date (Monday=0, Sunday=6)
    date_obj = datetime.strptime(target_date, "%Y-%m-%d").date()
    computed_day_of_week = date_obj.weekday()  # Store in variable
    entry.day_of_week = computed_day_of_week

    existing_entry = session.exec(
        select(TimeuseEntry).where(TimeuseEntry.date == target_date,
               TimeuseEntry.uid == entry.uid)
    ).first()

    if existing_entry:
        # Update existing entry - EXCLUDE DATE from updates
        update_data = entry.dict(exclude_unset=True, exclude={'date', 'uid'})
        for field, value in update_data.items():
            setattr(existing_entry, field, value)

        existing_entry.day_of_week = computed_day_of_week

        session.add(existing_entry)
        session.commit()
        session.refresh(existing_entry)

        return Response(
             content=existing_entry.json(),
             status_code=200,
             headers={"X-Operation": "updated"}
        )
    else:
        # Create new entry
        db_entry = TimeuseEntry.from_orm(entry)
        session.add(db_entry)
        session.commit()
        session.refresh(db_entry)

        return Response(
             content=db_entry.json(),
             status_code=201,
             headers={"X-Operation": "created"}
        )


@app.get("/entries/", response_model=List[TimeuseEntryRead])
def read_all_entries(
    skip: int = 0,
    limit: int = 100,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    uid: str = Query(..., description="User ID required"),
    session: Session = Depends(get_session)
):
    """Get all health entries with optional filtering"""

    query = select(TimeuseEntry).where(TimeuseEntry.uid == uid)  # Filter by UID

    if start_date:
        query = query.where(TimeuseEntry.date >= start_date)
    if end_date:
        query = query.where(TimeuseEntry.date <= end_date)

    query = query.order_by(TimeuseEntry.date.desc()).offset(skip).limit(limit)

    entries = session.exec(query).all()
    return entries

@app.get("/entries/today", response_model=Optional[TimeuseEntryRead])
def read_today_entry(uid: str = Query(..., description="User ID required"), session: Session = Depends(get_session)):
    """Get today's entry if it exists"""
    today = datetime.now().date().isoformat()
    entry = session.exec(
        select(TimeuseEntry).where(TimeuseEntry.date == today, TimeuseEntry.uid == uid)
    ).first()
    return entry

@app.get("/entries/{entry_id}", response_model=TimeuseEntryRead)
def read_entry(entry_id: str, session: Session = Depends(get_session)):
    """Get a specific entry by ID"""
    entry = session.exec(
        select(TimeuseEntry).where(TimeuseEntry.id == entry_id)
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry


@app.get("/")
def root():
    return {"message": "TUD API is running"}

@app.get("/health")
def health_check(session: Session = Depends(get_session)):
    count = session.exec(select(TimeuseEntry)).all()
    return {"status": "healthy", "entries_count": len(count)}



@app.get("/export/csv")
def export_all_data_csv(session: Session = Depends(get_session)):
    """
    Export all health data as CSV for analysis in pandas/excel.
    Note that this export all data, not limited to a specific user.
    """

    # Get all entries ordered by date
    entries = session.exec(
        select(TimeuseEntry).order_by(TimeuseEntry.date)
    ).all()

    if not entries:
        raise HTTPException(status_code=404, detail="No data to export")

    # Create CSV in memory
    output = io.StringIO()
    writer = csv.writer(output)

    # Define CSV headers - include all fields from your model
    headers = [
        'id', 'uid', 'date', 'timestamp', 'day_of_week', 'day_name', 'is_weekend',
        'mood', 'pain', 'energy',
        'allergy_state', 'allergy_medication',
        'had_sex', 'sexual_wellbeing', 'sleep_quality',
        'stress_level_work', 'stress_level_home',
        'physical_activity', 'step_count', 'weather_enjoyment',
        'daily_comments'
    ]

    # Add daily_activities columns (flatten the JSON)
    # Get all possible activity keys from the first entry that has activities
    activity_columns = set()
    for entry in entries:
        if entry.daily_activities:
            activity_columns.update(entry.daily_activities.keys())

    # Sort activity columns for consistent ordering
    activity_columns = sorted(activity_columns)
    headers.extend(activity_columns)

    writer.writerow(headers)

    # Write data rows
    for entry in entries:
        row = [
            entry.id,
            entry.uid or 'default',
            entry.date,
            entry.timestamp.isoformat() if entry.timestamp else '',
        ]

        # Add activity columns (1 for present, 0 for absent)
        activities = entry.daily_activities or {}
        for activity in activity_columns:
            row.append(1 if activities.get(activity) == 1 else 0)

        writer.writerow(row)

    # Return as downloadable CSV file
    output.seek(0)
    today = datetime.now().strftime("%Y-%m-%d")

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=health_data_export_{today}.csv",
            "Content-Type": "text/csv; charset=utf-8"
        }
    )


@app.get("/export/json")
def export_all_data_json(session: Session = Depends(get_session)):
    """
    Export all health data as JSON.
    Note that this export all data, not limited to a specific user.
    """

    entries = session.exec(
        select(TimeuseEntry).order_by(TimeuseEntry.date)
    ).all()

    if not entries:
        raise HTTPException(status_code=404, detail="No data to export")

    # Convert to list of dicts
    data = []
    for entry in entries:
        entry_dict = entry.dict()
        # Convert datetime to ISO string for JSON serialization
        entry_dict['timestamp'] = entry.timestamp.isoformat() if entry.timestamp else None
        # Add computed properties
        data.append(entry_dict)

    today = datetime.now().strftime("%Y-%m-%d")

    return Response(
        content=json.dumps(data, indent=2, ensure_ascii=False),
        media_type="application/json",
        headers={
            "Content-Disposition": f"attachment; filename=health_data_export_{today}.json"
        }
    )