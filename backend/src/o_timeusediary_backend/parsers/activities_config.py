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
    """Load activities configuration from JSON file.

    @param config_path Path to the activities JSON configuration file.
    @return Parsed and validated activities configuration.
    """

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

    @param config Parsed activities configuration model.
    @return Dictionary mapping activity code to context metadata.
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

    @param config Parsed activities configuration model.
    @return Set of all activity codes in timelines/categories/children.
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

    @param config_path Path to the activities JSON configuration file.
    @param code Activity code to validate.
    @return True when the code exists in the config, otherwise False.
    """
    valid_codes = get_cached_activity_codes(config_path)
    return code in valid_codes


def get_activity_info(config_path: str, code: int) -> Optional[Dict[str, Any]]:
    """
    Get detailed info about an activity by its code.

    @param config_path Path to the activities JSON configuration file.
    @param code Activity code to look up.
    @return Activity metadata dictionary or None if not found.
    """
    config = get_cached_activities_config(config_path)
    all_codes_info = get_all_activity_codes(config)
    return all_codes_info.get(code)


def validate_multiple_activity_codes(config_path: str, codes: List[int]) -> Dict[str, Any]:
    """
    Validate multiple activity codes at once.

    @param config_path Path to the activities JSON configuration file.
    @param codes List of activity codes to validate.
    @return Validation result with `valid`, `invalid`, and `all_valid` fields.
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

def get_num_activities_in_cfgfile_per_timeline(config_path: str) -> Dict[str, int]:
    """
    Get the number of activities defined in the config file per timeline.

    @param config_path Path to the activities JSON configuration file.
    @return Dictionary mapping timeline name to number of activities (including child items).
    """
    config = get_cached_activities_config(config_path)
    timeline_counts = {}

    def count_activities(activities: List[ActivityItem]) -> int:
        count = 0
        for activity in activities:
            count += 1  # Count current activity
            if activity.childItems:
                count += count_activities(activity.childItems)  # Count child items recursively
        return count

    for timeline_name, timeline_config in config.timeline.items():
        total_count = 0
        for category in timeline_config.categories:
            total_count += count_activities(category.activities)
        timeline_counts[timeline_name] = total_count

    return timeline_counts

def get_num_categories_in_cfgfile_per_timeline(config_path: str) -> Dict[str, int]:
    """
    Get the number of categories defined in the config file per timeline.

    @param config_path Path to the activities JSON configuration file.
    @return Dictionary mapping timeline name to number of categories.
    """
    config = get_cached_activities_config(config_path)
    timeline_category_counts = {}

    for timeline_name, timeline_config in config.timeline.items():
        category_count = len(timeline_config.categories)
        timeline_category_counts[timeline_name] = category_count

    return timeline_category_counts


def compute_activity_path_from_config(
    timeline_key: str,
    category_name: str,
    activity: 'ActivityItem',
    parent_name: Optional[str] = None,
    short: bool = False,
    no_duplicate_parts: bool = False
) -> str:
    """Compute the frontend_path string for an ActivityItem from the config file.

    Mirrors the logic of compute_activity_path() in api.py, adapted for config-file
    activities (which have no parent_activity_code, original_selection, etc.).

    @param timeline_key  The timeline key (e.g. 'primary').
    @param category_name The category name the activity belongs to.
    @param activity      The ActivityItem.
    @param parent_name   Parent activity name if this is a child item, otherwise None.
    @param short         Whether to omit the "timeline:" and "category:" prefixes for a more concise path (e.g. "primary > General Activities > activity:Sleeping").
    @param no_duplicate_parts Whether to avoid duplicate parts in the path. Forces short mode.
    @return Path string in the same format as activity_path_frontend on DB rows.
    """

    timeline_key_part = "" if no_duplicate_parts else timeline_key
    parts = [timeline_key_part] if short else [f"timeline:{timeline_key}"]
    if category_name and category_name.strip():
        category_name_part = "" if no_duplicate_parts else category_name
        if short:
            parts.append(category_name_part)
        else:
            parts.append(f"category:{category_name}")
    if parent_name:
        parent_name_part = "" if no_duplicate_parts else parent_name
        if short:
            parts.append(parent_name_part)
        else:
            parts.append(f"parent:{parent_name}")
    if short:
        parts.append(activity.name)
    else:
        parts.append(f"activity:{activity.name}")

    # remove all empty parts (like "") to avoid " >  > " in the path
    parts = [part for part in parts if part]

    return " > ".join(parts)


def get_activities_cfg_text(config: ActivitiesConfig, short: bool = False, no_duplicate_parts: bool = False) -> str:
    """Build a condensed multi-line text representation of all activities in the config.

    Format::

        Timeline: primary (Main Activity)
          Category: General Activities
            1101  timeline:primary > category:General Activities > activity:Sleeping
            1104  ...
          Category: Travel & Transit
            1110  timeline:primary > category:Travel & Transit > activity:Travelling
              1111  timeline:primary > category:Travel & Transit > parent:Travelling > activity:Travelling: walking

    Child items are indented one additional level beyond their parent.

    @param config Parsed activities configuration.
    @return Multi-line string.
    """
    lines: List[str] = []
    for timeline_key, timeline_cfg in config.timeline.items():
        lines.append(f"Timeline: {timeline_key} ({timeline_cfg.name})")
        for category in timeline_cfg.categories:
            lines.append(f"  Category: {category.name}")
            for activity in category.activities:
                path = compute_activity_path_from_config(timeline_key, category.name, activity, short=short, no_duplicate_parts=no_duplicate_parts)
                lines.append(f"    {activity.code}  {path}")
                for child in activity.childItems:
                    child_path = compute_activity_path_from_config(
                        timeline_key, category.name, child, parent_name=activity.name, short=short, no_duplicate_parts=no_duplicate_parts
                    )
                    lines.append(f"      {child.code}  {child_path}")
    return "\n".join(lines)


def get_activities_cfg_text_for_path(config_path: str, short: bool = False, no_duplicate_parts: bool = False) -> str:
    """Convenience wrapper: load (cached) config from *config_path* and return its condensed text.

    @param config_path Path to the activities JSON configuration file.
    @param short       Whether to use the short path format.
    @return Multi-line condensed text of all activities.
    """
    config = get_cached_activities_config(config_path)
    return get_activities_cfg_text(config, short=short, no_duplicate_parts = no_duplicate_parts)