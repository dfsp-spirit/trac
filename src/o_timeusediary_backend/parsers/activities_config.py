# activities_config.py -- Parser for activities.json configuration file.

from typing import List, Optional, Dict, Any, Set
from pydantic import BaseModel, Field, field_validator, model_validator, ConfigDict
import json
from pathlib import Path
from functools import lru_cache

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

    model_config = ConfigDict(validate_assignment=True)

class ActivityCategory(BaseModel):
    name: str
    activities: List[ActivityItem]
    color: Optional[str] = None

class TimelineConfig(BaseModel):
    name: str
    description: Optional[str] = None
    mode: str  # "single-choice" or "multiple-choice"
    min_coverage: Optional[int] = None
    categories: List[ActivityCategory]

    @field_validator('mode')
    @classmethod
    def validate_mode(cls, v: str) -> str:
        valid_modes = ['single-choice', 'multiple-choice']
        if v not in valid_modes:
            raise ValueError(f'Timeline mode must be one of {valid_modes}, got "{v}"')
        return v

    @field_validator('min_coverage')
    @classmethod
    def validate_min_coverage(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and (v < 0 or v > 1440):
            raise ValueError(f'min_coverage must be between 0 and 1440, got {v}') # day has 1440 minutes
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

    @field_validator('timeline')
    @classmethod
    def validate_timeline_keys(cls, v: Dict[str, TimelineConfig]) -> Dict[str, TimelineConfig]:
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

    @model_validator(mode='after')
    def validate_unique_activity_codes(self) -> 'ActivitiesConfig':
        """Validate that all ActivityItem.code values are unique across all timelines"""
        seen_codes: Set[int] = set()
        duplicate_codes: Set[int] = set()
        duplicates_info: List[str] = []

        def check_activity_codes(activities: List[ActivityItem], parent_path: str = "") -> None:
            for activity in activities:
                # Check current activity
                if activity.code in seen_codes and activity.code not in duplicate_codes:
                    duplicate_codes.add(activity.code)
                    duplicates_info.append(
                        f"Code {activity.code} (activity: '{activity.name}'{parent_path})"
                    )
                seen_codes.add(activity.code)

                # Recursively check child items
                if activity.childItems:
                    child_path = f"{parent_path} -> child of '{activity.name}'"
                    check_activity_codes(activity.childItems, child_path)

        # Check all timelines
        for timeline_name, timeline_config in self.timeline.items():
            for category in timeline_config.categories:
                parent_path = f" in timeline '{timeline_name}', category '{category.name}'"
                check_activity_codes(category.activities, parent_path)

        if duplicate_codes:
            error_msg = "Activity codes must be unique across all activities. "
            error_msg += f"Found {len(duplicate_codes)} duplicate code(s):\n"
            error_msg += "\n".join(duplicates_info)
            raise ValueError(error_msg)

        return self

# Handle recursive ActivityItem
ActivityItem.model_rebuild()

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


# ============================================================================
# Caching and Validation Helpers
# ============================================================================

@lru_cache(maxsize=10)
def get_cached_activities_config(config_path: str) -> ActivitiesConfig:
    """
    Load and cache activities config.
    Uses LRU cache to avoid repeated file reads.
    """
    return load_activities_config(config_path)


def get_all_activity_codes(config: ActivitiesConfig) -> Dict[int, Dict[str, Any]]:
    """
    Extract all activity codes from the config with their context.
    Returns a dictionary mapping code -> context info.
    """
    codes_info = {}

    def collect_codes(activities: List[ActivityItem], context: Dict[str, str]) -> None:
        for activity in activities:
            # Store code with context
            codes_info[activity.code] = {
                "name": activity.name,
                "label": activity.label,
                "short": activity.short,
                "vshort": activity.vshort,
                "color": activity.color,
                "examples": activity.examples,
                "is_custom_input": activity.is_custom_input,
                "timeline": context.get("timeline"),
                "category": context.get("category"),
                "is_child": context.get("is_child", False),
                "parent_name": context.get("parent_name")
            }

            # Recursively collect child items
            if activity.childItems:
                child_context = context.copy()
                child_context["is_child"] = True
                child_context["parent_name"] = activity.name
                collect_codes(activity.childItems, child_context)

    # Collect codes from all timelines
    for timeline_name, timeline_config in config.timeline.items():
        for category in timeline_config.categories:
            context = {
                "timeline": timeline_name,
                "category": category.name
            }
            collect_codes(category.activities, context)

    return codes_info


def get_activity_codes_set(config: ActivitiesConfig) -> Set[int]:
    """
    Get a simple set of all activity codes.
    Useful for quick membership checks.
    """
    all_codes = set()

    def collect_codes_set(activities: List[ActivityItem]) -> None:
        for activity in activities:
            all_codes.add(activity.code)
            if activity.childItems:
                collect_codes_set(activity.childItems)

    for timeline_config in config.timeline.values():
        for category in timeline_config.categories:
            collect_codes_set(category.activities)

    return all_codes


@lru_cache(maxsize=10)
def get_cached_activity_codes(config_path: str) -> Set[int]:
    """
    Get cached set of activity codes for a config file.
    """
    config = get_cached_activities_config(config_path)
    return get_activity_codes_set(config)


def validate_activity_code(config_path: str, code: int) -> bool:
    """
    Validate that an activity code exists in the config.
    Returns True if valid, False otherwise.
    """
    valid_codes = get_cached_activity_codes(config_path)
    return code in valid_codes


def get_activity_info(config_path: str, code: int) -> Optional[Dict[str, Any]]:
    """
    Get detailed info about an activity by its code.
    Returns None if code not found.
    """
    config = get_cached_activities_config(config_path)
    all_codes_info = get_all_activity_codes(config)
    return all_codes_info.get(code)


def validate_multiple_activity_codes(config_path: str, codes: List[int]) -> Dict[str, Any]:
    """
    Validate multiple activity codes at once.
    Returns dict with validation results.
    """
    valid_codes = get_cached_activity_codes(config_path)
    results = {
        "valid": [],
        "invalid": [],
        "all_valid": True
    }

    for code in codes:
        if code in valid_codes:
            results["valid"].append(code)
        else:
            results["invalid"].append(code)
            results["all_valid"] = False

    return results