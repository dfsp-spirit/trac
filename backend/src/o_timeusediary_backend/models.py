from sqlmodel import SQLModel, Field, Relationship, JSON, Column
from typing import Optional, List, Dict, Any
from datetime import datetime
from sqlalchemy import DateTime, UniqueConstraint

from .utils import utc_now


class Participant(SQLModel, table=True):
    __tablename__ = "participants"

    id: str = Field(primary_key=True)  # External ID like "bernddasbrot", "annasmith"
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    # Relationships
    study_associations: List["StudyParticipant"] = Relationship(
        back_populates="participant"
    )
    activities: List["Activity"] = Relationship(back_populates="participant")
    external_task_assignments: List["StudyExternalTaskAssignment"] = Relationship(
        back_populates="participant"
    )


class Study(SQLModel, table=True):
    __tablename__ = "studies"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    name_short: str = Field(index=True, unique=True)
    description: str
    allow_unlisted_participants: bool = Field(default=True)
    require_consent: bool = Field(default=False)
    is_paused: bool = Field(default=False)
    allow_skip_timeuse: bool = Field(default=True)
    require_diary_before_external_tasks: bool = Field(default=False)
    default_language: str = Field(default="en")
    study_text_intro: Optional[Dict[str, str]] = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
    study_text_end_completed: Optional[Dict[str, str]] = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
    study_text_end_skipped: Optional[Dict[str, str]] = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
    study_text_end_noconsent: Optional[Dict[str, str]] = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
    study_text_consent: Optional[Dict[str, str]] = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
    activities_json_url: str
    data_collection_start: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    data_collection_end: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    # Relationships
    day_labels: List["DayLabel"] = Relationship(back_populates="study")
    participants: List["StudyParticipant"] = Relationship(back_populates="study")
    timelines: List["Timeline"] = Relationship(back_populates="study")
    activities: List["Activity"] = Relationship(back_populates="study")
    activity_config_blobs: List["StudyActivityConfigBlob"] = Relationship(
        back_populates="study"
    )
    available_timelines: List["StudyAvailableTimeline"] = Relationship(
        back_populates="study"
    )
    available_categories: List["StudyAvailableCategory"] = Relationship(
        back_populates="study"
    )
    available_activities: List["StudyAvailableActivity"] = Relationship(
        back_populates="study"
    )
    external_tasks: List["StudyExternalTask"] = Relationship(back_populates="study")


class StudyExternalTask(SQLModel, table=True):
    __tablename__ = "study_external_tasks"
    __table_args__ = (
        UniqueConstraint("study_id", "task_key", name="uq_study_external_task_key"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    study_id: int = Field(foreign_key="studies.id", index=True)
    task_key: str = Field(index=True)
    name: str
    description: Optional[str] = None
    url: str
    confirmation_type: str = Field(default="none", index=True)
    task_level: int = Field(default=1, index=True)
    tokens: List[str] = Field(
        default_factory=list, sa_column=Column(JSON, nullable=False)
    )
    config: Dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSON, nullable=False)
    )
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    study: Study = Relationship(back_populates="external_tasks")
    assignments: List["StudyExternalTaskAssignment"] = Relationship(
        back_populates="external_task"
    )


class StudyExternalTaskAssignment(SQLModel, table=True):
    __tablename__ = "study_external_task_assignments"
    __table_args__ = (
        UniqueConstraint(
            "external_task_id",
            "participant_id",
            name="uq_external_task_assignment_task_participant",
        ),
        UniqueConstraint(
            "external_task_id",
            "assigned_token",
            name="uq_external_task_assignment_task_token",
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    external_task_id: int = Field(foreign_key="study_external_tasks.id", index=True)
    participant_id: str = Field(foreign_key="participants.id", index=True)
    assigned_token: str = Field(index=True)
    assignment_order: int = Field(default=0, index=True)
    is_confirmed: bool = Field(default=False, index=True)
    confirmed_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    external_task: StudyExternalTask = Relationship(back_populates="assignments")
    participant: Participant = Relationship(back_populates="external_task_assignments")


class StudyActivityConfigBlob(SQLModel, table=True):
    """Language-specific activities config blob for a study.

    This table stores the activities-config JSON payload as imported via admin APIs,
    allowing fully remote study creation without depending on filesystem JSON files.
    """

    __tablename__ = "study_activity_config_blobs"
    __table_args__ = (
        UniqueConstraint(
            "study_id", "language", name="uq_study_activity_blob_study_lang"
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    study_id: int = Field(foreign_key="studies.id", index=True)
    language: str = Field(index=True)
    activities_json_data: Dict[str, Any] = Field(sa_column=Column(JSON, nullable=False))
    content_hash: Optional[str] = Field(default=None, index=True)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    study: Study = Relationship(back_populates="activity_config_blobs")


class StudyAvailableTimeline(SQLModel, table=True):
    """Available timeline definition for a study (catalog, not logged events)."""

    __tablename__ = "study_available_timelines"
    __table_args__ = (
        UniqueConstraint(
            "study_id", "timeline_key", name="uq_study_available_timeline_study_key"
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    study_id: int = Field(foreign_key="studies.id", index=True)
    timeline_key: str = Field(index=True)
    display_name: str
    description: Optional[str] = None
    mode: str = Field(index=True)
    min_coverage: Optional[int] = None
    sort_order: int = Field(default=0, index=True)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    study: Study = Relationship(back_populates="available_timelines")
    categories: List["StudyAvailableCategory"] = Relationship(back_populates="timeline")
    activities: List["StudyAvailableActivity"] = Relationship(back_populates="timeline")


class StudyAvailableCategory(SQLModel, table=True):
    """Available activity category for a study timeline (catalog, not logged events)."""

    __tablename__ = "study_available_categories"
    __table_args__ = (
        UniqueConstraint(
            "timeline_id",
            "category_name",
            name="uq_study_available_category_timeline_name",
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    study_id: int = Field(foreign_key="studies.id", index=True)
    timeline_id: int = Field(foreign_key="study_available_timelines.id", index=True)
    category_name: str = Field(index=True)
    sort_order: int = Field(default=0, index=True)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    study: Study = Relationship(back_populates="available_categories")
    timeline: StudyAvailableTimeline = Relationship(back_populates="categories")
    activities: List["StudyAvailableActivity"] = Relationship(back_populates="category")


class StudyAvailableActivity(SQLModel, table=True):
    """Available activity entry for a study (catalog, not logged events)."""

    __tablename__ = "study_available_activities"
    __table_args__ = (
        UniqueConstraint(
            "study_id", "activity_code", name="uq_study_available_activity_study_code"
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    study_id: int = Field(foreign_key="studies.id", index=True)
    timeline_id: int = Field(foreign_key="study_available_timelines.id", index=True)
    category_id: int = Field(foreign_key="study_available_categories.id", index=True)
    activity_code: int = Field(index=True)
    parent_activity_code: Optional[int] = Field(default=None, index=True)
    is_custom_input: bool = Field(default=False)
    sort_order: int = Field(default=0, index=True)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    study: Study = Relationship(back_populates="available_activities")
    timeline: StudyAvailableTimeline = Relationship(back_populates="activities")
    category: StudyAvailableCategory = Relationship(back_populates="activities")
    i18n: List["StudyAvailableActivityI18n"] = Relationship(back_populates="activity")


class StudyAvailableActivityI18n(SQLModel, table=True):
    """Language-specific labels and metadata for available activities."""

    __tablename__ = "study_available_activity_i18n"
    __table_args__ = (
        UniqueConstraint(
            "activity_id",
            "language",
            name="uq_study_available_activity_i18n_activity_lang",
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    activity_id: int = Field(foreign_key="study_available_activities.id", index=True)
    language: str = Field(index=True)
    name: str = Field(index=True)
    label: Optional[str] = None
    short: Optional[str] = None
    vshort: Optional[str] = None
    examples: Optional[str] = None
    color: Optional[str] = None
    frequency_options: Optional[List[Dict[str, str]]] = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    activity: StudyAvailableActivity = Relationship(back_populates="i18n")


class DayLabel(SQLModel, table=True):
    """Valid day labels for a study (e.g., "monday", "tuesday", "typical_weekend")"""

    __tablename__ = "day_labels"
    __table_args__ = (
        UniqueConstraint("study_id", "name", name="uq_day_label_study_name"),
        UniqueConstraint(
            "study_id", "display_order", name="uq_day_label_study_display_order"
        ),
    )

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
    __table_args__ = (
        UniqueConstraint("study_id", "name", name="uq_timeline_study_name"),
    )

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
    __table_args__ = (
        UniqueConstraint("study_id", "participant_id", name="uq_study_participant"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    study_id: int = Field(foreign_key="studies.id")
    participant_id: str = Field(foreign_key="participants.id")
    consent_given: Optional[bool] = Field(default=None)
    consent_decided_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    instructions_completed: bool = Field(default=False)
    instructions_completed_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    # Relationships
    study: Study = Relationship(back_populates="participants")
    participant: Participant = Relationship(back_populates="study_associations")


class Activity(SQLModel, table=True):
    __tablename__ = "activities"

    id: Optional[int] = Field(default=None, primary_key=True)
    study_id: int = Field(foreign_key="studies.id")
    participant_id: str = Field(foreign_key="participants.id")
    day_label_id: int = Field(
        foreign_key="day_labels.id"
    )  # Links to specific day label
    timeline_id: int = Field(foreign_key="timelines.id")  # Links to specific timeline

    # Core research data - time of day without date
    activity_code: int = Field(index=True)
    start_minutes: int  # Minutes since midnight (0-1439)
    end_minutes: int  # Minutes since midnight (0-1439)
    activity_name: str = Field(
        index=True
    )  # Name of the activity as per activities.json, or for a custom input the value the user entered
    activity_path_frontend: str
    color: Optional[str] = None  # e.g., "#FF0000", used in frontend for display
    category: Optional[str] = (
        None  # e.g., "leisure", "work", "commuting", used for grouping in frontend
    )
    frequency_key: Optional[str] = Field(default=None, index=True)

    # Hierarchy information
    parent_activity_code: Optional[int] = Field(default=None, index=True)

    # Metadata
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    # Relationships
    study: Study = Relationship(back_populates="activities")
    participant: Participant = Relationship(back_populates="activities")
    day_label: DayLabel = Relationship(back_populates="activities")
    timeline: Timeline = Relationship(back_populates="activities")
