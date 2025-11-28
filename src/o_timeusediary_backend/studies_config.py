# config/study_config.py
from typing import List, Optional
from pydantic import BaseModel, validator
import yaml
import json
from pathlib import Path
import re

class CfgFileDayLabel(BaseModel):
    entry_index: int
    entry_name: str

class CfgFileStudy(BaseModel):
    name: str
    name_short: str
    description: Optional[str] = None
    day_labels: List[str]  # Simplified - will be converted to CfgFileDayLabel
    study_participant_ids: List[str] = []
    allow_unlisted_participants: bool = True
    activities_json_file: str = None
    data_collection_start: str = None  # ISO 8601 date string
    data_collection_end: str = None    # ISO 8601 date string

    @validator('name_short')
    def validate_name_short(cls, v):
        if not v:
            raise ValueError('name_short cannot be empty')

        # Check for URL-friendly characters only: lowercase a-z, numbers 0-9, underscore
        if not re.match(r'^[a-z0-9_]+$', v):
            raise ValueError(
                f'name_short "{v}" can only contain lowercase letters (a-z), numbers (0-9), and underscores (_). '
                f'No uppercase letters, spaces, hyphens, or special characters allowed.'
            )

        # Check length
        if len(v) < 2:
            raise ValueError(f'name_short "{v}" must be at least 2 characters long')
        if len(v) > 50:
            raise ValueError(f'name_short "{v}" cannot exceed 50 characters')

        return v

    @validator('data_collection_start', 'data_collection_end')
    def validate_iso8601_date(cls, v):
        if v is not None:
            # Simple regex check for ISO 8601 format (YYYY-MM-DDTHH:MM:SSZ)
            iso8601_regex = r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$'
            if not re.match(iso8601_regex, v):
                raise ValueError(f'Date "{v}" is not in valid ISO 8601 format (e.g., 2024-01-01T00:00:00Z)')
        return v

    @validator('activities_json_file')
    def validate_activities_json_file(cls, v):
        if v is not None and not isinstance(v, str):
            raise ValueError('activities_json_file must be a string')
        if v is not None and v.strip() == "":
            raise ValueError('activities_json_file cannot be an empty string')
        return v



class CfgFileStudies(BaseModel):
    studies: List[CfgFileStudy]

def load_studies_config(config_path: str) -> CfgFileStudies:
    """Load studies configuration from YAML or JSON file"""

    config_path = Path(config_path)

    if not config_path.exists():
        raise FileNotFoundError(f"Studies configuration file not found at '{config_path}'")

    if config_path.suffix in ['.yaml', '.yml']:
        with open(config_path, 'r') as f:
            data = yaml.safe_load(f)
    elif config_path.suffix == '.json':
        with open(config_path, 'r') as f:
            data = json.load(f)
    else:
        raise ValueError(f"Unsupported config file format: {config_path.suffix}")

    return CfgFileStudies(**data)

