from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException
from sqlmodel import Session, select

from ..models import Study, StudyActivityConfigBlob
from ..parsers.activities_config import (
    ActivitiesConfig,
    compute_activity_path_from_config,
    get_activity_codes_set,
    get_all_activity_codes,
)


def _normalize_language_code(language: Optional[str]) -> Optional[str]:
    if not isinstance(language, str):
        return None
    normalized = language.strip().lower()
    if not normalized:
        return None
    primary_subtag = normalized.split("-")[0]
    return primary_subtag or None


def _lookup_languages(
    requested_language: Optional[str], default_language: Optional[str]
) -> List[str]:
    lookup: List[str] = []
    for candidate in [requested_language, default_language, "en"]:
        normalized = _normalize_language_code(candidate)
        if normalized and normalized not in lookup:
            lookup.append(normalized)
    return lookup


def _get_blob_by_language(
    session: Session, study_id: int
) -> Dict[str, StudyActivityConfigBlob]:
    blobs = session.exec(
        select(StudyActivityConfigBlob).where(
            StudyActivityConfigBlob.study_id == study_id
        )
    ).all()
    return {
        _normalize_language_code(blob.language): blob
        for blob in blobs
        if _normalize_language_code(blob.language)
    }


def get_study_activities_config_model(
    session: Session,
    study: Study,
    lang: Optional[str] = None,
) -> Tuple[ActivitiesConfig, str, str]:
    """Return ActivitiesConfig for a study using DB blobs only.

    Returns: (ActivitiesConfig, source, selected_language)
    source: db_blob
    """
    normalized_lang = _normalize_language_code(lang)
    lookup_languages = _lookup_languages(normalized_lang, study.default_language)

    blob_by_lang = _get_blob_by_language(session, study.id)
    for language in lookup_languages:
        blob = blob_by_lang.get(language)
        if not blob:
            continue
        return ActivitiesConfig(**blob.activities_json_data), "db_blob", language

    raise HTTPException(
        status_code=500,
        detail=(
            f"Study '{study.name_short}' is missing DB-backed activities config blobs. "
            "Import the study configuration before serving this study."
        ),
    )


def get_study_activities_config_model_by_short_name(
    session: Session,
    study_name_short: str,
    lang: Optional[str] = None,
) -> Tuple[Study, ActivitiesConfig, str, str]:
    study = session.exec(
        select(Study).where(Study.name_short == study_name_short)
    ).first()
    if not study:
        raise HTTPException(
            status_code=404, detail=f"Study '{study_name_short}' not found"
        )
    config, source, selected_language = get_study_activities_config_model(
        session, study, lang
    )
    return study, config, source, selected_language


def get_valid_activity_codes_for_study(
    session: Session,
    study_name_short: str,
    lang: Optional[str] = None,
) -> set[int]:
    _, config, _, _ = get_study_activities_config_model_by_short_name(
        session, study_name_short, lang
    )
    return get_activity_codes_set(config)


def get_activity_info_for_study_code(
    session: Session,
    study_name_short: str,
    activity_code: int,
    lang: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    _, config, _, _ = get_study_activities_config_model_by_short_name(
        session, study_name_short, lang
    )
    return get_all_activity_codes(config).get(activity_code)


def get_num_activities_in_cfg_per_timeline(config: ActivitiesConfig) -> Dict[str, int]:
    def count_activities(activities) -> int:
        count = 0
        for activity in activities:
            count += 1
            if activity.childItems:
                count += count_activities(activity.childItems)
        return count

    timeline_counts: Dict[str, int] = {}
    for timeline_name, timeline_cfg in config.timeline.items():
        timeline_counts[timeline_name] = sum(
            count_activities(category.activities)
            for category in timeline_cfg.categories
        )
    return timeline_counts


def get_num_categories_in_cfg_per_timeline(config: ActivitiesConfig) -> Dict[str, int]:
    return {
        timeline_name: len(timeline_cfg.categories)
        for timeline_name, timeline_cfg in config.timeline.items()
    }


def get_activities_cfg_text_for_config(
    config: ActivitiesConfig,
    short: bool = False,
    no_duplicate_parts: bool = False,
) -> str:
    lines: List[str] = []
    for timeline_key, timeline_cfg in config.timeline.items():
        for category in timeline_cfg.categories:
            for activity in category.activities:
                lines.append(
                    compute_activity_path_from_config(
                        timeline_key,
                        category.name,
                        activity,
                        short=short,
                        no_duplicate_parts=no_duplicate_parts,
                    )
                )
    return "\n".join(lines)
