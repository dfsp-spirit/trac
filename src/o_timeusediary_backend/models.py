from sqlmodel import SQLModel, Field, Relationship, JSON, Column
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
from pydantic import BaseModel
from sqlalchemy import Text

from .utils import utc_now


class Participant(SQLModel, table=True):
    __tablename__ = "participants"

    id: str = Field(primary_key=True)  # External ID like "bernddasbrot", "annasmith"
    created_at: datetime = Field(default_factory=utc_now)

    # Relationships
    study_associations: List["StudyParticipant"] = Relationship(back_populates="participant")
    activities: List["Activity"] = Relationship(back_populates="participant")

class Study(SQLModel, table=True):
    __tablename__ = "studies"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    name_short: str = Field(index=True, unique=True)
    description: str
    allow_unlisted_participants: bool = Field(default=True)
    default_language: str = Field(default="en")
    activities_json_url: str
    data_collection_start: datetime
    data_collection_end: datetime
    created_at: datetime = Field(default_factory=utc_now)

    # Relationships
    day_labels: List["DayLabel"] = Relationship(back_populates="study")
    participants: List["StudyParticipant"] = Relationship(back_populates="study")
    timelines: List["Timeline"] = Relationship(back_populates="study")
    activities: List["Activity"] = Relationship(back_populates="study")

class DayLabel(SQLModel, table=True):
    """Valid day labels for a study (e.g., "monday", "tuesday", "typical_weekend")"""
    __tablename__ = "day_labels"

    id: Optional[int] = Field(default=None, primary_key=True)
    study_id: int = Field(foreign_key="studies.id")
    name: str = Field(index=True)  # e.g., "monday", "typical_weekend"
    display_order: int = Field(default=0)  # For ordering in UI
    display_name: str = Field(index=True)  # e.g., "Monday", "Typical Weekend"

    # Relationships
    study: Study = Relationship(back_populates="day_labels")
    activities: List["Activity"] = Relationship(back_populates="day_label")

class Timeline(SQLModel, table=True):
    """Timelines defined in activities.json (primary, digitalmediause, device, etc.)"""
    __tablename__ = "timelines"

    id: Optional[int] = Field(default=None, primary_key=True)
    study_id: int = Field(foreign_key="studies.id")
    name: str = Field(index=True)  # "primary", "digitalmediause", "device"
    display_name: str  # "Main Activity", "Digital Media Use", "Device"
    description: Optional[str] = None
    mode: str = Field(index=True)  # "single-choice", "multiple-choice"
    min_coverage: Optional[int] = None

    # Relationships
    study: Study = Relationship(back_populates="timelines")
    activities: List["Activity"] = Relationship(back_populates="timeline")

class StudyParticipant(SQLModel, table=True):
    """Link table for study-participant associations"""
    __tablename__ = "study_participants"

    id: Optional[int] = Field(default=None, primary_key=True)
    study_id: int = Field(foreign_key="studies.id")
    participant_id: str = Field(foreign_key="participants.id")
    created_at: datetime = Field(default_factory=utc_now)

    # Relationships
    study: Study = Relationship(back_populates="participants")
    participant: Participant = Relationship(back_populates="study_associations")

class Activity(SQLModel, table=True):
    __tablename__ = "activities"

    id: Optional[int] = Field(default=None, primary_key=True)
    study_id: int = Field(foreign_key="studies.id")
    participant_id: str = Field(foreign_key="participants.id")
    day_label_id: int = Field(foreign_key="day_labels.id")  # Links to specific day label
    timeline_id: int = Field(foreign_key="timelines.id")   # Links to specific timeline

    # Core research data - time of day without date
    activity_code: int = Field(index=True)
    start_minutes: int  # Minutes since midnight (0-1439)
    end_minutes: int    # Minutes since midnight (0-1439)
    activity_name: str = Field(index=True)  # Name of the activity as per activities.json, or for a custom input the value the user entered
    activity_path_frontend: str
    color: Optional[str] = None    # e.g., "#FF0000", used in frontend for display
    category: Optional[str] = None  # e.g., "leisure", "work", "commuting", used for grouping in frontend

    # Hierarchy information
    parent_activity_code: Optional[int] = Field(default=None, index=True)

    # Metadata
    created_at: datetime = Field(default_factory=utc_now)

    # Relationships
    study: Study = Relationship(back_populates="activities")
    participant: Participant = Relationship(back_populates="activities")
    day_label: DayLabel = Relationship(back_populates="activities")
    timeline: Timeline = Relationship(back_populates="activities")