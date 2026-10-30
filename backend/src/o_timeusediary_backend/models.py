import uuid
from sqlmodel import SQLModel, Field, Relationship, JSON
from typing import Optional, List, Dict, Any, Union
from datetime import datetime
from sqlalchemy import CheckConstraint, DateTime, UniqueConstraint, Column, String

from .utils import utc_now


class Participant(SQLModel, table=True):
    __tablename__ = "participants"

    id: str = Field(
        primary_key=True, sa_type=String(255)
    )  # External ID like "bernddasbrot", "annasmith"
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
    # `name` is the human-readable label (not an identifier): studies are looked
    # up by `name_short` everywhere, so duplicate labels are allowed and the
    # admin interface only warns about them. Migration 0010 dropped the old
    # unique constraint on `name`.
    name: str = Field(index=True, sa_type=String(255))
    name_short: str = Field(index=True, unique=True, sa_type=String(255))
    # `description` stores either a single-string fallback or a localized
    # language->text map. Persisted as JSON so it can hold either form.
    description: Optional[Union[str, Dict[str, str]]] = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
    allow_unlisted_participants: bool = Field(default=True)
    require_consent: bool = Field(default=False)
    is_paused: bool = Field(default=False)
    allow_skip_timeuse: bool = Field(default=True)
    require_diary_before_external_tasks: bool = Field(default=False)
    default_language: str = Field(default="en", sa_type=String(32))
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
    study_text_instructions: Optional[Dict[str, str]] = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
    # Optional per-study override for the big title at the top of the
    # instructions page. When unset, the frontend keeps its localized
    # `instructions.welcomeTitle` default.
    study_text_instructions_title: Optional[Dict[str, str]] = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
    activities_json_url: str = Field(sa_type=String(2048))
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
    # Where the reporting day starts, in minutes after midnight. 0 for new
    # studies; legacy 04:00 studies are imported with 240 (D26). Data is stored
    # as clock minutes and clipped to [day_start, day_start + 24h), so this is
    # the only place the window is defined.
    day_start_minutes: int = Field(default=0)
    # Inactivity timeout configuration
    inactivity_timeout_minutes: int = Field(default=0)
    inactivity_timeout_stress_time_left: int = Field(default=5)
    inactivity_page_custom_text: Optional[Dict[str, str]] = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
    # Study-specific footer links
    footer_links: Optional[List[Dict[str, Any]]] = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
    hide_server_wide_links: bool = Field(default=False)
    # When true (opt-in, default false), the frontend captures browser/device
    # identification data (raw user agent + parsed ua-parser-js result + a few
    # environment signals) and stores it per participant. Used to assess whether
    # the app works across different devices. Off by default so that studies
    # have to make a deliberate choice about collecting this personal data.
    save_browser_identification: bool = Field(default=False)
    # Usernames of the scientists who own (i.e. administer) this study.
    # `None` means the study is not owned by any scientist and can only be
    # managed by super admins. Stored as JSON so a study can have several owners.
    owner_usernames: Optional[List[str]] = Field(
        default=None, sa_column=Column(JSON, nullable=True)
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
    task_key: str = Field(index=True, sa_type=String(255))
    name: str = Field(sa_type=String(512))
    description: Optional[str] = Field(default=None, sa_type=String(2048))
    url: str = Field(sa_type=String(2048))
    confirmation_type: str = Field(default="none", index=True, sa_type=String(64))
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
    participant_id: str = Field(
        foreign_key="participants.id", index=True, sa_type=String(255)
    )
    assigned_token: str = Field(index=True, sa_type=String(512))
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
    language: str = Field(index=True, sa_type=String(32))
    activities_json_data: Dict[str, Any] = Field(sa_column=Column(JSON, nullable=False))
    content_hash: Optional[str] = Field(default=None, index=True, sa_type=String(128))
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
    timeline_key: str = Field(index=True, sa_type=String(255))
    display_name: str = Field(sa_type=String(255))
    description: Optional[str] = Field(default=None, sa_type=String(2048))
    mode: str = Field(index=True, sa_type=String(64))
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
    category_name: str = Field(index=True, sa_type=String(255))
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
    language: str = Field(index=True, sa_type=String(32))
    name: str = Field(index=True, sa_type=String(255))
    label: Optional[str] = Field(default=None, sa_type=String(255))
    short: Optional[str] = Field(default=None, sa_type=String(255))
    vshort: Optional[str] = Field(default=None, sa_type=String(255))
    examples: Optional[str] = Field(default=None, sa_type=String(2048))
    color: Optional[str] = Field(default=None, sa_type=String(64))
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
    name: str = Field(
        index=True, sa_type=String(255)
    )  # e.g., "monday", "typical_weekend"
    display_order: int = Field(default=0)  # For ordering in UI
    display_name: str = Field(
        index=True, sa_type=String(255)
    )  # e.g., "Monday", "Typical Weekend" (default-language value)
    # Full localized display names map, e.g. {"en": "Monday", "sv": "Måndag"}.
    # The single-language `display_name` column holds the default-language value;
    # this map lets the API localize day labels per requested language.
    display_names: Optional[Dict[str, str]] = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )

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
    name: str = Field(
        index=True, sa_type=String(255)
    )  # "primary", "digitalmediause", "device"
    display_name: str = Field(
        sa_type=String(255)
    )  # "Main Activity", "Digital Media Use", "Device"
    description: Optional[str] = Field(default=None, sa_type=String(2048))
    mode: str = Field(
        index=True, sa_type=String(64)
    )  # "single-choice", "multiple-choice"
    min_coverage: Optional[int] = None
    # How many activities may cover the same minute. PI answer to Q1: 2. It is a
    # study setting, not a constant, so a study that needs three can say so.
    max_overlap: int = Field(default=2)

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
    participant_id: str = Field(foreign_key="participants.id", sa_type=String(255))
    consent_given: Optional[bool] = Field(default=None)
    consent_decided_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    instructions_completed: bool = Field(default=False)
    instructions_completed_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    study_submitted_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    # Browser/device identification captured once per participant (see the
    # study's `save_browser_identification` flag). The raw user agent string is
    # kept verbatim so it can be re-parsed later when parsing rules improve;
    # `client_info` holds the parsed snapshot plus extra environment signals.
    user_agent: Optional[str] = Field(default=None, sa_type=String(2048))
    # none_as_null=True so an empty capture is a real SQL NULL, not the JSON
    # value `null`. SQLAlchemy's default (none_as_null=False) would store "null",
    # which makes `WHERE client_info IS NOT NULL` match rows that hold no data.
    # The type has to be instantiated (not passed as a class) for the option to
    # reach the type instead of being treated as a Column dialect argument.
    client_info: Optional[Dict[str, Any]] = Field(
        default=None, sa_column=Column(JSON(none_as_null=True), nullable=True)
    )
    client_info_captured_at: Optional[datetime] = Field(
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
    __table_args__ = (
        # Row identity for incremental writes and for idempotent retries: a
        # save retried after a lost response must not create a second row.
        UniqueConstraint(
            "study_id", "participant_id", "client_uuid", name="uq_activity_client_uuid"
        ),
        # D8: the same activity at the same time on the same day is a duplicate,
        # enforced by the database and not only by a check in the endpoint.
        UniqueConstraint(
            "study_id",
            "participant_id",
            "day_label_id",
            "activity_code",
            "start_minutes",
            "end_minutes",
            name="uq_activity_slot",
        ),
        # D21: cross-midnight is explicit, and no single record may exceed a day.
        CheckConstraint(
            "end_minutes > start_minutes", name="ck_activity_end_after_start"
        ),
        CheckConstraint(
            "end_minutes - start_minutes <= 1440", name="ck_activity_duration_max"
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    study_id: int = Field(foreign_key="studies.id")
    participant_id: str = Field(foreign_key="participants.id", sa_type=String(255))
    day_label_id: int = Field(
        foreign_key="day_labels.id"
    )  # Links to specific day label
    timeline_id: int = Field(foreign_key="timelines.id")  # Links to specific timeline

    # Core research data - time of day without date
    activity_code: int = Field(index=True)
    start_minutes: int  # Minutes since midnight (0-1439)
    end_minutes: int  # Minutes since midnight (0-1439)
    activity_name: str = Field(
        index=True, sa_type=String(512)
    )  # Name of the activity as per activities.json, or for a custom input the value the user entered
    activity_path_frontend: str = Field(sa_type=String(1024))
    color: Optional[str] = Field(
        default=None, sa_type=String(64)
    )  # e.g., "#FF0000", used in frontend for display
    category: Optional[str] = Field(
        default=None, sa_type=String(255)
    )  # e.g., "leisure", "work", "commuting", used for grouping in frontend
    frequency_key: Optional[str] = Field(default=None, index=True, sa_type=String(128))

    # Hierarchy information
    parent_activity_code: Optional[int] = Field(default=None, index=True)

    # Row identity (D17). `client_uuid` is generated here when a caller does not
    # supply one, which is what lets the old whole-day writer keep working
    # unchanged (D25).
    # The (study, participant, client_uuid) unique constraint below serves the
    # lookups, so the column needs no index of its own.
    client_uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()), sa_type=String(64)
    )
    # Activities created together (one multi-day save) share a group id, so one
    # undo reverses the whole action (D19).
    group_id: Optional[str] = Field(default=None, index=True, sa_type=String(64))
    # Which catalogue produced this row, for detecting stale frontends (D17).
    catalogue_version: Optional[str] = Field(default=None, sa_type=String(64))
    # Metadata
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    # Relationships
    study: Study = Relationship(back_populates="activities")
    participant: Participant = Relationship(back_populates="activities")
    day_label: DayLabel = Relationship(back_populates="activities")
    timeline: Timeline = Relationship(back_populates="activities")
