# config/activities_config.py
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, validator
import json
from pathlib import Path

class ActivityItem(BaseModel):
    name: str
    code: int
    label: Optional[str] = None
    short: Optional[str] = None
    vshort: Optional[str] = None
    color: Optional[str] = None
    examples: Optional[str] = None
    is_custom_input: Optional[bool] = False
    childItems: List['ActivityItem'] = []

class ActivityCategory(BaseModel):
    name: str
    activities: List[ActivityItem]
    color: Optional[str] = None

class TimelineConfig(BaseModel):
    name: str
    description: Optional[str] = None
    mode: str  # "single-choice" or "multiple-choice"
    min_coverage: Optional[str] = None  # String because it can be "10" or "0"
    categories: List[ActivityCategory]

    @validator('mode')
    def validate_mode(cls, v):
        valid_modes = ['single-choice', 'multiple-choice']
        if v not in valid_modes:
            raise ValueError(f'Timeline mode must be one of {valid_modes}, got "{v}"')
        return v

class GeneralConfig(BaseModel):
    experimentID: Optional[str] = None
    app_name: Optional[str] = None
    version: Optional[str] = None
    author: Optional[str] = None
    language: Optional[str] = None
    instructions: Optional[bool] = None
    primary_redirect_url: Optional[str] = None
    fallbackToCSV: Optional[bool] = None

class ActivitiesConfig(BaseModel):
    general: GeneralConfig
    timeline: Dict[str, TimelineConfig]

    @validator('timeline')
    def validate_timeline_keys(cls, v):
        # Ensure at least one timeline exists
        if not v:
            raise ValueError('At least one timeline must be defined')

        # Validate timeline names don't contain invalid characters
        for timeline_name in v.keys():
            if not timeline_name.strip():
                raise ValueError('Timeline name cannot be empty or whitespace')
            if ' ' in timeline_name:
                raise ValueError(f'Timeline name "{timeline_name}" cannot contain spaces')

        return v

# Handle recursive ActivityItem
ActivityItem.update_forward_refs()

def load_activities_config(config_path: str) -> ActivitiesConfig:
    """Load activities configuration from JSON file"""

    config_path = Path(config_path)

    if not config_path.exists():
        raise FileNotFoundError(f"Activities configuration file not found at '{config_path}'")

    if config_path.suffix != '.json':
        raise ValueError(f"Activities config must be JSON file, got: {config_path.suffix}")

    with open(config_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    return ActivitiesConfig(**data)