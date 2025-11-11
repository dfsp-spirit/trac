from datetime import datetime
from typing import Optional, Dict, Any
from sqlmodel import SQLModel, Field, Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import Integer
import calendar
import uuid

class TimeuseEntryBase(SQLModel):
    uid: str = Field(index=True)  # Add user identifier field

class TimeuseEntry(TimeuseEntryBase, table=True):
    id: Optional[str] = Field(
        default_factory=lambda: str(uuid.uuid4()),
        primary_key=True
    )


# For API - SQLModel handles serialization automatically
class TimeuseEntryCreate(TimeuseEntryBase):
    pass


class TimeuseEntryRead(TimeuseEntryBase):
    id: str


class HealthEntryUpdate(SQLModel):
    # All fields optional for updates
    uid: Optional[str] = None
