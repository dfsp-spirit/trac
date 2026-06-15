# config/study_config.py
from typing import List, Optional, Any, Dict, Union
from datetime import datetime, timezone
from pydantic import BaseModel, model_validator, Field, ConfigDict, ValidationError
import yaml
import json
from pathlib import Path
import re
from functools import lru_cache
import logging
from .activities_config import (
    ActivitiesConfig,
    load_activities_config,
    get_activity_codes_set,
    get_all_activity_codes,
)

logger = logging.getLogger(__name__)


class CfgFileDayLabel(BaseModel):
    model_config = ConfigDict(extra="forbid")

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


class CfgFileLoggedActivity(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timeline: str
    activity_code: int
    start_minutes: int
    end_minutes: int


class CfgFileExternalTaskOutboundToken(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    by_participant: Dict[str, str] = Field(default_factory=dict)


class CfgFileExternalTask(BaseModel):
    model_config = ConfigDict(extra="forbid")

    """Study-config entry for one external task.

    Example:
    {
        "task_key": "payment",
                "name": {"en": "Payment Survey"},
                "description": {"en": "Complete payment handoff"},
                "outbound_url": "https://example.org/payment?src=trac&pid={participant_id}&study={study_name}&task={task_key}&token={survey_token}",
        "confirmation_type": "none",
                "outbound_tokens": [
                    {
                        "name": "survey_token",
                        "by_participant": {
                            "p1": "tok-user-1",
                            "p2": "tok-user-2"
                        }
                    }
                ],
                "callback_token_name": "survey_token"
    }

    Notes:
        - "outbound_tokens" can define one or more named token groups.
        - Each token group must provide exactly one token per listed participant.
        - "callback_token_name" controls which token group is used for backend callback
            confirmation. If omitted, the first outbound token group is used.
        - Supported outbound_url placeholders are:
            {participant_id}, {study_name}, {task_key}, and all outbound token names.
    """

    # Stable machine key for this task in API payloads and callbacks.
    task_key: str
    # Human-facing localized task name shown in admin and participant views.
    name: Dict[str, str]
    # Optional long description shown next to the task name.
    description: Optional[Dict[str, str]] = None
    # URL template of the external task target.
    outbound_url: str
    # Supported values: "none" (manual completion) or "callback" (backend callback).
    confirmation_type: str = "none"
    # Named outbound token groups.
    outbound_tokens: List[CfgFileExternalTaskOutboundToken] = Field(
        default_factory=list
    )
    # Token group used as callback proof token.
    callback_token_name: Optional[str] = None
    # Tasks with higher level are gated until all lower levels are completed.
    task_level: int = 1


def _extract_template_placeholders(template: str) -> List[str]:
    return re.findall(r"\{([a-zA-Z0-9_]+)\}", template or "")


def get_external_task_callback_token_name(external_task: CfgFileExternalTask) -> str:
    if external_task.callback_token_name and external_task.callback_token_name.strip():
        return external_task.callback_token_name.strip()
    return external_task.outbound_tokens[0].name


def get_external_task_callback_tokens(
    external_task: CfgFileExternalTask, study_participant_ids: List[str]
) -> List[str]:
    callback_token_name = get_external_task_callback_token_name(external_task)
    callback_token_group = next(
        token_group
        for token_group in external_task.outbound_tokens
        if token_group.name == callback_token_name
    )
    return [
        callback_token_group.by_participant[participant_id]
        for participant_id in study_participant_ids
    ]


def get_external_task_effective_config(
    external_task: CfgFileExternalTask,
) -> Dict[str, Any]:
    return {
        "name_i18n": dict(external_task.name),
        "description": dict(external_task.description or {}),
        "outbound_tokens": [
            {
                "name": token_group.name,
                "by_participant": dict(token_group.by_participant),
            }
            for token_group in external_task.outbound_tokens
        ],
        "callback_token_name": get_external_task_callback_token_name(external_task),
        "task_level": external_task.task_level,
    }


_ALLOWED_EXTERNAL_TASK_CONFIRMATION_TYPES = {"none", "callback"}


def validate_external_tasks_for_study(
    *,
    study_name_short: str,
    allow_unlisted_participants: bool,
    study_participant_ids: List[str],
    external_tasks: List[CfgFileExternalTask],
) -> None:
    if not external_tasks:
        return

    if allow_unlisted_participants:
        raise ValueError(
            "external_tasks require allow_unlisted_participants=false so that all participants are explicitly listed"
        )

    participant_ids_set = set(study_participant_ids)
    seen_task_keys: set[str] = set()

    for external_task in external_tasks:
        if not isinstance(external_task.task_key, str) or not re.match(
            r"^[a-z0-9_]+$", external_task.task_key
        ):
            raise ValueError(
                f"Study '{study_name_short}': external_tasks.task_key '{external_task.task_key}' is invalid. "
                "Use lowercase letters, numbers, and underscores only."
            )

        if external_task.task_key in seen_task_keys:
            raise ValueError(
                f"Study '{study_name_short}' has duplicate external task key '{external_task.task_key}'"
            )
        seen_task_keys.add(external_task.task_key)

        if not isinstance(external_task.name, dict) or not external_task.name:
            raise ValueError(
                f"Study '{study_name_short}': external task '{external_task.task_key}' must define a non-empty name"
            )

        if any(
            not isinstance(language, str)
            or not language.strip()
            or not isinstance(text, str)
            or not text.strip()
            for language, text in external_task.name.items()
        ):
            raise ValueError(
                f"Study '{study_name_short}': external task '{external_task.task_key}' has invalid localized name entries"
            )

        if external_task.description is not None and any(
            not isinstance(language, str)
            or not language.strip()
            or not isinstance(text, str)
            or not text.strip()
            for language, text in external_task.description.items()
        ):
            raise ValueError(
                f"Study '{study_name_short}': external task '{external_task.task_key}' has invalid localized description entries"
            )

        if (
            not isinstance(external_task.outbound_url, str)
            or not external_task.outbound_url.strip()
        ):
            raise ValueError(
                f"Study '{study_name_short}': external task '{external_task.task_key}' must define a non-empty outbound_url"
            )

        if (
            external_task.confirmation_type
            not in _ALLOWED_EXTERNAL_TASK_CONFIRMATION_TYPES
        ):
            raise ValueError(
                f"Study '{study_name_short}': external task '{external_task.task_key}' has unsupported confirmation_type "
                f"'{external_task.confirmation_type}'. Allowed values: {sorted(_ALLOWED_EXTERNAL_TASK_CONFIRMATION_TYPES)}"
            )

        if not isinstance(external_task.task_level, int) or external_task.task_level < 1:
            raise ValueError(
                f"Study '{study_name_short}': external task '{external_task.task_key}' task_level must be an integer >= 1"
            )

        if not external_task.outbound_tokens:
            raise ValueError(
                f"Study '{study_name_short}': external task '{external_task.task_key}' must define at least one outbound token group"
            )

        seen_token_group_names: set[str] = set()
        outbound_token_names: set[str] = set()
        for token_group in external_task.outbound_tokens:
            if not isinstance(token_group.name, str) or not re.match(
                r"^[a-z0-9_]+$", token_group.name
            ):
                raise ValueError(
                    f"Study '{study_name_short}': external task '{external_task.task_key}' has invalid outbound token name '{token_group.name}'"
                )

            if token_group.name in seen_token_group_names:
                raise ValueError(
                    f"Study '{study_name_short}': external task '{external_task.task_key}' has duplicate outbound token group '{token_group.name}'"
                )
            seen_token_group_names.add(token_group.name)
            outbound_token_names.add(token_group.name)

            participant_keys = set(token_group.by_participant.keys())
            if participant_keys != participant_ids_set:
                raise ValueError(
                    f"Study '{study_name_short}': external task '{external_task.task_key}' token group '{token_group.name}' must define tokens for exactly the study participants"
                )

            token_values = list(token_group.by_participant.values())
            if any(
                not isinstance(token, str) or not token.strip() for token in token_values
            ):
                raise ValueError(
                    f"Study '{study_name_short}': external task '{external_task.task_key}' token group '{token_group.name}' contains empty token values"
                )

            if len(set(token_values)) != len(token_values):
                raise ValueError(
                    f"Study '{study_name_short}': external task '{external_task.task_key}' token group '{token_group.name}' contains duplicate tokens"
                )

        callback_token_name = get_external_task_callback_token_name(external_task)
        if callback_token_name not in outbound_token_names:
            raise ValueError(
                f"Study '{study_name_short}': external task '{external_task.task_key}' callback_token_name '{callback_token_name}' is not defined in outbound_tokens"
            )

        placeholders = set(_extract_template_placeholders(external_task.outbound_url))
        allowed_placeholders = {"participant_id", "study_name", "task_key"}.union(
            outbound_token_names
        )
        unknown_placeholders = sorted(placeholders - allowed_placeholders)
        if unknown_placeholders:
            raise ValueError(
                f"Study '{study_name_short}': external task '{external_task.task_key}' outbound_url contains unsupported placeholders: {unknown_placeholders}"
            )

        if callback_token_name not in placeholders:
            raise ValueError(
                f"Study '{study_name_short}': external task '{external_task.task_key}' outbound_url must include callback token placeholder '{{{callback_token_name}}}'"
            )


class CfgFileStudy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    name_short: str
    # Accept either a single-string description (legacy) or a localized map.
    description: Optional[Union[str, Dict[str, str]]] = None
    day_labels: List[CfgFileDayLabel] = Field(min_length=1)
    study_participant_ids: List[str] = []
    allow_unlisted_participants: bool = True
    default_language: str = "en"  # default to English if not given
    supported_languages: Optional[List[str]] = None
    activities_json_file: Optional[Union[str, Dict[str, str]]] = None
    activities_json_files: Optional[Dict[str, str]] = None
    activities_json_data: Optional[Dict[str, Dict[str, Any]]] = None
    require_consent: bool = False
    allow_skip_timeuse: bool = True
    is_paused: bool = False
    require_diary_before_external_tasks: bool = False
    external_tasks: List[CfgFileExternalTask] = Field(default_factory=list)
    study_text_intro: Optional[Dict[str, str]] = None
    study_text_end_completed: Optional[Dict[str, str]] = None
    study_text_end_skipped: Optional[Dict[str, str]] = None
    study_text_end_noconsent: Optional[Dict[str, str]] = None
    study_text_consent: Optional[Dict[str, str]] = None
    data_collection_start: datetime  # UTC-aware datetime, parsed from ISO 8601 string
    data_collection_end: datetime  # UTC-aware datetime, parsed from ISO 8601 string
    activities_logged_by_userid: Dict[str, Dict[str, List[CfgFileLoggedActivity]]] = (
        Field(default_factory=dict)
    )

    def get_activities_json_files(self) -> Dict[str, str]:
        if isinstance(self.activities_json_files, dict) and self.activities_json_files:
            return self.activities_json_files

        if isinstance(self.activities_json_file, dict) and self.activities_json_file:
            return self.activities_json_file

        if (
            isinstance(self.activities_json_file, str)
            and self.activities_json_file.strip()
        ):
            return {self.default_language: self.activities_json_file}

        return {}

    def get_activities_json_data(self) -> Dict[str, Dict[str, Any]]:
        if isinstance(self.activities_json_data, dict) and self.activities_json_data:
            return self.activities_json_data
        return {}

    def get_supported_languages(self) -> List[str]:
        if self.supported_languages:
            deduplicated_languages: List[str] = []
            for language in self.supported_languages:
                if language not in deduplicated_languages:
                    deduplicated_languages.append(language)
            return deduplicated_languages
        available_languages = set(self.get_activities_json_files().keys()) | set(
            self.get_activities_json_data().keys()
        )
        return sorted(available_languages)

    def get_supported_activities_json_files(self) -> Dict[str, str]:
        files_by_lang = self.get_activities_json_files()
        supported_languages = self.get_supported_languages()
        return {
            language: files_by_lang[language]
            for language in supported_languages
            if language in files_by_lang
        }

    def get_supported_activities_json_data(self) -> Dict[str, Dict[str, Any]]:
        data_by_lang = self.get_activities_json_data()
        supported_languages = self.get_supported_languages()
        return {
            language: data_by_lang[language]
            for language in supported_languages
            if language in data_by_lang
        }

    def get_activities_json_file_for_language(
        self, language: Optional[str] = None
    ) -> Optional[str]:
        files_by_lang = self.get_supported_activities_json_files()
        if not files_by_lang:
            return None

        target_language = language or self.default_language
        return (
            files_by_lang.get(target_language)
            or files_by_lang.get(self.default_language)
            or files_by_lang.get("en")
        )

    def get_day_label_display_name(
        self, day_label_name: str, language: Optional[str] = None
    ) -> Optional[str]:
        target_language = language or self.default_language
        for day_label in self.day_labels:
            if day_label.name != day_label_name:
                continue
            display_names = day_label.get_display_names(self.default_language)
            return (
                display_names.get(target_language)
                or display_names.get(self.default_language)
                or display_names.get("en")
            )
        return None

    def get_study_text(
        self, field_name: str, language: Optional[str] = None
    ) -> Optional[str]:
        target_language = language or self.default_language
        text_map = getattr(self, field_name, None)
        if not isinstance(text_map, dict) or not text_map:
            return None
        return (
            text_map.get(target_language)
            or text_map.get(self.default_language)
            or text_map.get("en")
        )

    def get_description_map(self) -> Dict[str, str]:
        """Return description as a language->text map.

        If `description` is a string (legacy), return a single-entry map
        keyed by the study default language.
        """
        if isinstance(self.description, dict):
            return dict(self.description)
        if isinstance(self.description, str) and self.description.strip():
            return {self.default_language: self.description}
        return {}

    def get_logged_activities_by_participant(
        self,
    ) -> Dict[str, Dict[str, List[CfgFileLoggedActivity]]]:
        return self.activities_logged_by_userid

    @model_validator(mode="after")
    def validate_name_short(self) -> "CfgFileStudy":
        if not self.name_short:
            raise ValueError(
                f"Study '{self.name}': name_short cannot be empty"
            )

        # Check for URL-friendly characters only: lowercase a-z, numbers 0-9, underscore
        if not re.match(r"^[a-z0-9_]+$", self.name_short):
            raise ValueError(
                f"Study '{self.name_short}': "
                f'name_short "{self.name_short}" can only contain lowercase letters (a-z), numbers (0-9), and underscores (_). '
                f"No uppercase letters, spaces, hyphens, or special characters allowed."
            )

        # Check length
        if len(self.name_short) < 2:
            raise ValueError(
                f"Study '{self.name_short}': "
                f'name_short "{self.name_short}" must be at least 2 characters long'
            )
        if len(self.name_short) > 50:
            raise ValueError(
                f"Study '{self.name_short}': "
                f'name_short "{self.name_short}" cannot exceed 50 characters'
            )

        return self

    @model_validator(mode="after")
    def validate_day_labels(self) -> "CfgFileStudy":
        if not self.day_labels:
            raise ValueError(
                f"Study '{self.name_short}': day_labels must contain at least one day definition"
            )

        seen_names: set[str] = set()
        seen_display_orders: set[int] = set()

        for day_label in self.day_labels:
            normalized_name = day_label.name.strip() if day_label.name else ""
            if not normalized_name:
                raise ValueError(
                    f"Study '{self.name_short}': day_labels entries must define a non-empty name"
                )

            if not re.match(r"^[a-z0-9_]+$", normalized_name):
                raise ValueError(
                    f"Study '{self.name_short}': "
                    f'day_labels entry name "{day_label.name}" is invalid. '
                    "Use lowercase letters, numbers, and underscores only."
                )

            if day_label.display_order < 0:
                raise ValueError(
                    f"Study '{self.name_short}': "
                    f'day_labels entry "{normalized_name}" has invalid display_order '
                    f"{day_label.display_order}. display_order must be >= 0."
                )

            if normalized_name in seen_names:
                raise ValueError(
                    f"Study '{self.name_short}': "
                    f'day_labels contains duplicate name "{normalized_name}"'
                )
            seen_names.add(normalized_name)

            if day_label.display_order in seen_display_orders:
                raise ValueError(
                    f"Study '{self.name_short}': "
                    "day_labels contains duplicate display_order "
                    f"{day_label.display_order}"
                )
            seen_display_orders.add(day_label.display_order)

        return self

    @model_validator(mode="after")
    def validate_iso8601_dates(self) -> "CfgFileStudy":
        # Ensure both datetimes are UTC-aware.
        # Pydantic v2 on Python 3.11+ parses ISO 8601 strings with 'Z' suffix
        # (e.g. "2024-01-01T00:00:00Z") into timezone-aware datetimes automatically.
        # If somehow a naive datetime slips through, treat it as UTC.
        if (
            self.data_collection_start is not None
            and self.data_collection_start.tzinfo is None
        ):
            self.data_collection_start = self.data_collection_start.replace(
                tzinfo=timezone.utc
            )
        if (
            self.data_collection_end is not None
            and self.data_collection_end.tzinfo is None
        ):
            self.data_collection_end = self.data_collection_end.replace(
                tzinfo=timezone.utc
            )
        return self

    @model_validator(mode="after")
    def validate_default_language(self) -> "CfgFileStudy":
        """Validate that default_language is a 2-letter lowercase ASCII string."""
        import re

        if not isinstance(self.default_language, str):
            raise ValueError(
                f"Study '{self.name_short}': default_language must be a string"
            )

        if not re.match(r"^[a-z]{2}$", self.default_language):
            raise ValueError(
                f"Study '{self.name_short}': "
                f'default_language "{self.default_language}" is invalid. '
                f"Must be a 2-letter lowercase ASCII string (a-z)."
            )

        return self

    @model_validator(mode="after")
    def validate_multilingual_activity_and_daylabel_config(self) -> "CfgFileStudy":
        files_by_lang = self.get_activities_json_files()
        data_by_lang = self.get_activities_json_data()
        if not files_by_lang and not data_by_lang:
            raise ValueError(
                f"Study '{self.name_short}': "
                "One of activities_json_files / activities_json_file or activities_json_data must be configured and non-empty"
            )

        for language, file_path in files_by_lang.items():
            if not isinstance(language, str) or not re.match(r"^[a-z]{2}$", language):
                raise ValueError(
                    f"Study '{self.name_short}': "
                    f'activities language key "{language}" is invalid. '
                    f"Must be a 2-letter lowercase ASCII string (a-z)."
                )
            if not isinstance(file_path, str) or file_path.strip() == "":
                raise ValueError(
                    f"Study '{self.name_short}': "
                    f'activities_json file for language "{language}" must be a non-empty string'
                )

        for language, json_payload in data_by_lang.items():
            if not isinstance(language, str) or not re.match(r"^[a-z]{2}$", language):
                raise ValueError(
                    f"Study '{self.name_short}': "
                    f'activities data language key "{language}" is invalid. '
                    f"Must be a 2-letter lowercase ASCII string (a-z)."
                )
            if not isinstance(json_payload, dict) or not json_payload:
                raise ValueError(
                    f"Study '{self.name_short}': "
                    f'activities_json_data for language "{language}" must be a non-empty object'
                )

        available_activity_languages = set(files_by_lang.keys()) | set(
            data_by_lang.keys()
        )

        if self.default_language not in available_activity_languages:
            raise ValueError(
                f"Study '{self.name_short}': "
                f'default_language "{self.default_language}" must be present in activities configuration languages: '
                f"{sorted(available_activity_languages)}"
            )

        if self.supported_languages is not None:
            if (
                not isinstance(self.supported_languages, list)
                or len(self.supported_languages) == 0
            ):
                raise ValueError(
                    f"Study '{self.name_short}': "
                    "supported_languages must be a non-empty array of language codes"
                )

            for language in self.supported_languages:
                if not isinstance(language, str) or not re.match(
                    r"^[a-z]{2}$", language
                ):
                    raise ValueError(
                        f"Study '{self.name_short}': "
                        f'supported_languages entry "{language}" is invalid. '
                        f"Must be a 2-letter lowercase ASCII string (a-z)."
                    )

            if len(set(self.supported_languages)) != len(self.supported_languages):
                raise ValueError(
                    f"Study '{self.name_short}': supported_languages must not contain duplicates"
                )

            if self.default_language not in self.supported_languages:
                raise ValueError(
                    f"Study '{self.name_short}': "
                    f'default_language "{self.default_language}" must be included in supported_languages: '
                    f"{self.supported_languages}"
                )

            missing_activity_configs = sorted(
                set(self.supported_languages) - available_activity_languages
            )
            if missing_activity_configs:
                raise ValueError(
                    f"Study '{self.name_short}': "
                    f"supported_languages contains languages without activities configuration (file or embedded data): "
                    f"{missing_activity_configs}"
                )

        required_languages = set(self.get_supported_languages())
        for day_label in self.day_labels:
            display_names = day_label.get_display_names(self.default_language)
            missing_languages = sorted(required_languages - set(display_names.keys()))
            if missing_languages:
                raise ValueError(
                    f"Study '{self.name_short}': "
                    f'day_labels entry "{day_label.name}" is missing translated display names for languages '
                    f"{missing_languages}. If an activities file exists for a language, day_labels must also define that language."
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

        for text_field_name in [
            "study_text_intro",
            "study_text_end_completed",
            "study_text_end_skipped",
            "study_text_end_noconsent",
            "study_text_consent",
        ]:
            text_map = getattr(self, text_field_name, None)
            if text_map is None:
                continue
            if not isinstance(text_map, dict):
                raise ValueError(
                    f"Study '{self.name_short}': "
                    f"{text_field_name} must be an object mapping language codes to text"
                )
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
                    raise ValueError(
                        f"Study '{self.name_short}': "
                        f'{text_field_name}["{language}"] must be a non-empty string'
                    )

            missing_languages = sorted(required_languages - set(text_map.keys()))
            if missing_languages:
                raise ValueError(
                    f"Study '{self.name_short}': "
                    f"{text_field_name} is missing translations for supported_languages: {missing_languages}"
                )

        return self

    @model_validator(mode="after")
    def validate_external_tasks_config(self) -> "CfgFileStudy":
        validate_external_tasks_for_study(
            study_name_short=self.name_short,
            allow_unlisted_participants=self.allow_unlisted_participants,
            study_participant_ids=self.study_participant_ids,
            external_tasks=self.external_tasks,
        )
        return self


class CfgFileStudies(BaseModel):
    model_config = ConfigDict(extra="forbid")

    studies: List[CfgFileStudy]


def _format_validation_error(error: ValidationError) -> str:
    formatted_items: List[str] = []

    for item in error.errors():
        location = item.get("loc", [])
        path = ".".join(str(part) for part in location) if location else "<root>"
        message = item.get("msg", "Validation error")
        error_type = item.get("type", "validation_error")

        if error_type == "extra_forbidden":
            unknown_field = str(location[-1]) if location else "<unknown>"
            message = f"Unknown field '{unknown_field}' is not allowed"

        formatted_items.append(f"- {path}: {message}")

    if not formatted_items:
        return str(error)

    return "Invalid studies_config schema:\n" + "\n".join(formatted_items)


def _resolve_activities_path(raw_path: str, base_dir: Path) -> Path:
    candidate = Path(raw_path)
    if candidate.is_absolute():
        return candidate
    return (base_dir / candidate).resolve()


def _validate_multilingual_activity_code_sets(
    cfg_studies: CfgFileStudies, config_dir: Path
) -> None:
    def _frequency_keys_by_code(
        activities_cfg: ActivitiesConfig,
    ) -> Dict[int, Optional[tuple[str, ...]]]:
        all_activity_info = get_all_activity_codes(activities_cfg)
        frequency_map: Dict[int, Optional[tuple[str, ...]]] = {}
        for code, metadata in all_activity_info.items():
            options = metadata.get("frequency_options")
            if not options:
                frequency_map[code] = None
                continue
            frequency_map[code] = tuple(option["key"] for option in options)
        return frequency_map

    for study in cfg_studies.studies:
        files_by_lang = study.get_supported_activities_json_files()
        data_by_lang = study.get_supported_activities_json_data()
        supported_languages = study.get_supported_languages()
        if len(supported_languages) <= 1:
            continue

        codes_by_lang: Dict[str, set[int]] = {}
        frequency_by_lang: Dict[str, Dict[int, Optional[tuple[str, ...]]]] = {}

        for language in sorted(supported_languages):
            if language in data_by_lang:
                activities_cfg = ActivitiesConfig(**data_by_lang[language])
            elif language in files_by_lang:
                activity_file = files_by_lang[language]
                resolved_path = _resolve_activities_path(activity_file, config_dir)
                activities_cfg = load_activities_config(str(resolved_path))
            else:
                raise ValueError(
                    f"Study '{study.name_short}' has supported language '{language}' without activities configuration"
                )
            codes_by_lang[language] = get_activity_codes_set(activities_cfg)
            frequency_by_lang[language] = _frequency_keys_by_code(activities_cfg)

        reference_language = (
            study.default_language
            if study.default_language in codes_by_lang
            else sorted(codes_by_lang.keys())[0]
        )
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

        reference_frequency = frequency_by_lang[reference_language]
        frequency_mismatch_details: List[str] = []

        for language, frequency_map in sorted(frequency_by_lang.items()):
            if language == reference_language:
                continue

            per_code_mismatches: List[str] = []
            for code in sorted(reference_codes):
                reference_keys = reference_frequency.get(code)
                language_keys = frequency_map.get(code)
                if reference_keys != language_keys:
                    per_code_mismatches.append(
                        f"code={code} ref={reference_keys} lang={language_keys}"
                    )

            if per_code_mismatches:
                frequency_mismatch_details.append(
                    f"language '{language}' differs from '{reference_language}' for frequency_options: "
                    + "; ".join(per_code_mismatches[:20])
                )

        if frequency_mismatch_details:
            raise ValueError(
                f"Study '{study.name_short}' has inconsistent activity frequency_options across languages. "
                "Activities with frequency_options must define matching frequency key lists in all supported languages. "
                + " | ".join(frequency_mismatch_details)
            )


def load_studies_config(config_path: str) -> CfgFileStudies:
    """Load studies configuration from YAML or JSON file.

    @param config_path Path to a YAML/YML/JSON studies config file.
    @return Parsed and validated studies configuration.
    """

    config_path = Path(config_path)

    if not config_path.exists():
        raise FileNotFoundError(
            f"Studies configuration file not found at '{config_path}'"
        )

    if config_path.suffix in [".yaml", ".yml"]:
        with open(config_path, "r") as f:
            data = yaml.safe_load(f)
    elif config_path.suffix == ".json":
        with open(config_path, "r") as f:
            data = json.load(f)
    else:
        raise ValueError(f"Unsupported config file format: {config_path.suffix}")

    try:
        cfg_studies = CfgFileStudies(**data)
    except ValidationError as error:
        raise ValueError(_format_validation_error(error)) from error

    _validate_multilingual_activity_code_sets(cfg_studies, config_path.parent)
    return cfg_studies


@lru_cache(maxsize=1)
def get_cached_studies_config(config_path: str) -> CfgFileStudies:
    """Load and cache studies configuration."""
    return load_studies_config(config_path)


def get_cfg_study_by_name_short(
    study_name_short: str, config_path: str
) -> Optional[CfgFileStudy]:
    """Get a single study definition from the studies config by short name."""
    studies_config = get_cached_studies_config(config_path)
    for study in studies_config.studies:
        if study.name_short == study_name_short:
            return study
    return None
