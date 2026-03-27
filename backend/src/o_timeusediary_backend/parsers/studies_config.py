# config/study_config.py
from typing import List, Optional, Any, Dict, Union
from datetime import datetime, timezone
from pydantic import BaseModel, Field, model_validator
import yaml
import json
from pathlib import Path
import re
from functools import lru_cache
import logging
from .activities_config import load_activities_config, get_activity_codes_set

logger = logging.getLogger(__name__)

class CfgFileDayLabel(BaseModel):
    name: str
    display_order: int
    display_name: Optional[Union[str, Dict[str, str]]] = None
    display_names: Optional[Dict[str, str]] = None

    def get_display_names(self, default_language: str) -> Dict[str, str]:
        if isinstance(self.display_names, dict):
            return self.display_names
        if isinstance(self.display_name, dict):
            return self.display_name
        if isinstance(self.display_name, str):
            return {default_language: self.display_name}
        return {}


class CfgFileLoggedActivityItem(BaseModel):
    timeline: str
    activity_code: int = Field(ge=0)
    start_minutes: int = Field(ge=0, le=1440)
    end_minutes: int = Field(ge=0, le=1440)

    @model_validator(mode='before')
    @classmethod
    def normalize_legacy_keys(cls, values: Any) -> Any:
        if not isinstance(values, dict):
            return values

        data = dict(values)

        if "activity_code" not in data and "code" in data:
            data["activity_code"] = data["code"]

        if "timeline" not in data and "timeline_key" in data:
            data["timeline"] = data["timeline_key"]

        return data

    @model_validator(mode='after')
    def validate_time_range(self) -> 'CfgFileLoggedActivityItem':
        if self.end_minutes <= self.start_minutes:
            raise ValueError(
                f"end_minutes ({self.end_minutes}) must be greater than start_minutes ({self.start_minutes})"
            )
        return self

class CfgFileStudy(BaseModel):
    name: str
    name_short: str
    description: Optional[str] = None
    day_labels: List[CfgFileDayLabel]
    study_participant_ids: List[str] = []
    allow_unlisted_participants: bool = True
    default_language: str = "en" # default to English if not given
    activities_json_file: Optional[Union[str, Dict[str, str]]] = None
    activities_json_files: Optional[Dict[str, str]] = None
    study_text_intro: Optional[Dict[str, str]] = None
    study_text_end_completed: Optional[Dict[str, str]] = None
    study_text_end_skipped: Optional[Dict[str, str]] = None
    data_collection_start: datetime  # UTC-aware datetime, parsed from ISO 8601 string
    data_collection_end: datetime    # UTC-aware datetime, parsed from ISO 8601 string
    activities_logged_by_userid: Dict[str, Dict[str, List[CfgFileLoggedActivityItem]]] = {}
    logged_activities_by_participant_id: Dict[str, Dict[str, List[CfgFileLoggedActivityItem]]] = {}

    def get_activities_json_files(self) -> Dict[str, str]:
        if isinstance(self.activities_json_files, dict) and self.activities_json_files:
            return self.activities_json_files

        if isinstance(self.activities_json_file, dict) and self.activities_json_file:
            return self.activities_json_file

        if isinstance(self.activities_json_file, str) and self.activities_json_file.strip():
            return {self.default_language: self.activities_json_file}

        return {}

    def get_supported_languages(self) -> List[str]:
        return sorted(self.get_activities_json_files().keys())

    def get_activities_json_file_for_language(self, language: Optional[str] = None) -> Optional[str]:
        files_by_lang = self.get_activities_json_files()
        if not files_by_lang:
            return None

        target_language = language or self.default_language
        return files_by_lang.get(target_language) or files_by_lang.get(self.default_language) or files_by_lang.get("en")

    def get_day_label_display_name(self, day_label_name: str, language: Optional[str] = None) -> Optional[str]:
        target_language = language or self.default_language
        for day_label in self.day_labels:
            if day_label.name != day_label_name:
                continue
            display_names = day_label.get_display_names(self.default_language)
            return display_names.get(target_language) or display_names.get(self.default_language) or display_names.get("en")
        return None

    def get_study_text(self, field_name: str, language: Optional[str] = None) -> Optional[str]:
        target_language = language or self.default_language
        text_map = getattr(self, field_name, None)
        if not isinstance(text_map, dict) or not text_map:
            return None
        return text_map.get(target_language) or text_map.get(self.default_language) or text_map.get("en")

    def get_logged_activities_by_participant(self) -> Dict[str, Dict[str, List[CfgFileLoggedActivityItem]]]:
        if self.logged_activities_by_participant_id:
            return self.logged_activities_by_participant_id
        if self.activities_logged_by_userid:
            return self.activities_logged_by_userid
        return {}

    @model_validator(mode='after')
    def validate_name_short(self) -> 'CfgFileStudy':
        if not self.name_short:
            raise ValueError('name_short cannot be empty')

        # Check for URL-friendly characters only: lowercase a-z, numbers 0-9, underscore
        if not re.match(r'^[a-z0-9_]+$', self.name_short):
            raise ValueError(
                f'name_short "{self.name_short}" can only contain lowercase letters (a-z), numbers (0-9), and underscores (_). '
                f'No uppercase letters, spaces, hyphens, or special characters allowed.'
            )

        # Check length
        if len(self.name_short) < 2:
            raise ValueError(f'name_short "{self.name_short}" must be at least 2 characters long')
        if len(self.name_short) > 50:
            raise ValueError(f'name_short "{self.name_short}" cannot exceed 50 characters')

        return self

    @model_validator(mode='after')
    def validate_iso8601_dates(self) -> 'CfgFileStudy':
        # Ensure both datetimes are UTC-aware.
        # Pydantic v2 on Python 3.11+ parses ISO 8601 strings with 'Z' suffix
        # (e.g. "2024-01-01T00:00:00Z") into timezone-aware datetimes automatically.
        # If somehow a naive datetime slips through, treat it as UTC.
        if self.data_collection_start is not None and self.data_collection_start.tzinfo is None:
            self.data_collection_start = self.data_collection_start.replace(tzinfo=timezone.utc)
        if self.data_collection_end is not None and self.data_collection_end.tzinfo is None:
            self.data_collection_end = self.data_collection_end.replace(tzinfo=timezone.utc)
        return self

    @model_validator(mode='after')
    def validate_default_language(self) -> 'CfgFileStudy':
        """Validate that default_language is a 2-letter lowercase ASCII string."""
        import re

        if not isinstance(self.default_language, str):
            raise ValueError("default_language must be a string")

        if not re.match(r'^[a-z]{2}$', self.default_language):
            raise ValueError(
                f'default_language "{self.default_language}" is invalid. '
                f'Must be a 2-letter lowercase ASCII string (a-z).'
            )

        return self


    @model_validator(mode='after')
    def validate_multilingual_activity_and_daylabel_config(self) -> 'CfgFileStudy':
        files_by_lang = self.get_activities_json_files()
        if not files_by_lang:
            raise ValueError('One of activities_json_files or activities_json_file must be configured and non-empty')

        for language, file_path in files_by_lang.items():
            if not isinstance(language, str) or not re.match(r'^[a-z]{2}$', language):
                raise ValueError(
                    f'activities language key "{language}" is invalid. '
                    f'Must be a 2-letter lowercase ASCII string (a-z).'
                )
            if not isinstance(file_path, str) or file_path.strip() == "":
                raise ValueError(f'activities_json file for language "{language}" must be a non-empty string')

        if self.default_language not in files_by_lang:
            raise ValueError(
                f'default_language "{self.default_language}" must be present in activities_json_files keys: '
                f'{sorted(files_by_lang.keys())}'
            )

        required_languages = set(files_by_lang.keys())
        for day_label in self.day_labels:
            display_names = day_label.get_display_names(self.default_language)
            missing_languages = sorted(required_languages - set(display_names.keys()))
            if missing_languages:
                raise ValueError(
                    f'day_labels entry "{day_label.name}" is missing translated display names for languages '
                    f'{missing_languages}. If an activities file exists for a language, day_labels must also define that language.'
                )

            extra_languages = sorted(set(display_names.keys()) - required_languages)
            if extra_languages:
                logger.warning(
                    "Study '%s': day label '%s' defines extra translation languages %s without corresponding activities_json_files entries. "
                    "These languages will not be available in the app.",
                    self.name_short,
                    day_label.name,
                    extra_languages,
                )

        for text_field_name in ["study_text_intro", "study_text_end_completed", "study_text_end_skipped"]:
            text_map = getattr(self, text_field_name, None)
            if text_map is None:
                continue
            if not isinstance(text_map, dict):
                raise ValueError(f'{text_field_name} must be an object mapping language codes to text')
            for language, text_value in text_map.items():
                if language not in required_languages:
                    logger.warning(
                        "Study '%s': %s defines extra language '%s' without corresponding activities_json_files entry. "
                        "This language will not be available in the app.",
                        self.name_short,
                        text_field_name,
                        language,
                    )
                if not isinstance(text_value, str) or text_value.strip() == "":
                    raise ValueError(f'{text_field_name}["{language}"] must be a non-empty string')

        return self


class CfgFileStudies(BaseModel):
    studies: List[CfgFileStudy]


def _resolve_activities_path(raw_path: str, base_dir: Path) -> Path:
    candidate = Path(raw_path)
    if candidate.is_absolute():
        return candidate
    return (base_dir / candidate).resolve()


def _validate_multilingual_activity_code_sets(cfg_studies: CfgFileStudies, config_dir: Path) -> None:
    for study in cfg_studies.studies:
        files_by_lang = study.get_activities_json_files()
        if len(files_by_lang) <= 1:
            continue

        codes_by_lang: Dict[str, set[int]] = {}

        for language, activity_file in sorted(files_by_lang.items()):
            resolved_path = _resolve_activities_path(activity_file, config_dir)
            activities_cfg = load_activities_config(str(resolved_path))
            codes_by_lang[language] = get_activity_codes_set(activities_cfg)

        reference_language = study.default_language if study.default_language in codes_by_lang else sorted(codes_by_lang.keys())[0]
        reference_codes = codes_by_lang[reference_language]

        mismatch_details: List[str] = []
        for language, code_set in sorted(codes_by_lang.items()):
            if language == reference_language:
                continue
            if code_set == reference_codes:
                continue

            missing_vs_reference = sorted(reference_codes - code_set)
            extra_vs_reference = sorted(code_set - reference_codes)
            mismatch_details.append(
                f"language '{language}' differs from '{reference_language}': "
                f"missing={missing_vs_reference[:20]} extra={extra_vs_reference[:20]}"
            )

        if mismatch_details:
            raise ValueError(
                f"Study '{study.name_short}' has inconsistent activity code sets across languages. "
                f"All language activity files must define the same set of codes. "
                + " | ".join(mismatch_details)
            )


def load_studies_config(config_path: str) -> CfgFileStudies:
    """Load studies configuration from YAML or JSON file.

    @param config_path Path to a YAML/YML/JSON studies config file.
    @return Parsed and validated studies configuration.
    """

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

    cfg_studies = CfgFileStudies(**data)
    _validate_multilingual_activity_code_sets(cfg_studies, config_path.parent)
    return cfg_studies


@lru_cache(maxsize=1)
def get_cached_studies_config(config_path: str) -> CfgFileStudies:
    """Load and cache studies configuration."""
    return load_studies_config(config_path)


def get_cfg_study_by_name_short(study_name_short: str, config_path: str) -> Optional[CfgFileStudy]:
    """Get a single study definition from the studies config by short name."""
    studies_config = get_cached_studies_config(config_path)
    for study in studies_config.studies:
        if study.name_short == study_name_short:
            return study
    return None

