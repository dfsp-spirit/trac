"""Incremental diary API for the participant frontend (D18, D19, D27).

One row per activity, addressed by ``client_uuid``, instead of the old
"delete the whole day and insert a snapshot". Four properties matter here:

* **Idempotent creates.** The client sends a ``client_uuid`` per activity and the
  row id is ``"<client_uuid>:<day_index>"``, so a save retried after a lost
  response finds its rows instead of duplicating them.
* **Multi-day create** is one request with one transaction and one ``group_id``,
  with a per-day outcome (added, or skipped with a reason) (D19).
* **The same rules as the UI**: time range, the study's overlap limit, the
  duplicate rule and "the last day ends at midnight". The client mirrors them for
  instant feedback; this is the authority.
* **Reads return coverage per day**, computed by the same helper the submit gate
  uses, so the day rail cannot disagree with what submission will check.

The old whole-day endpoint stays untouched until cutover (D25).
"""

from __future__ import annotations

import logging
import uuid
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, delete, select

from .api_deps.activities import get_study_activity_codes
from .api_deps.available_activities import get_study_activities_config_model
from .api_deps.diary_access import (
    DiaryContext,
    ensure_participant_rows,
    get_readable_diary_context,
    get_writable_diary_context,
)
from .api_deps.frequency import allowed_frequency_keys_by_code, frequency_key_errors
from .coverage import (
    TimedActivity,
    coverage_by_day_and_timeline,
    day_meets_requirements,
    required_coverage_by_timeline,
    to_day_relative,
)

from .database import get_session
from .models import Activity, DayLabel, Study, Timeline
from .stages import stage_for_participant
from .utils import utc_now

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/studies/{study_name_short}/participants/{participant_id}"
)

#: Reasons a target day is skipped. These are the same codes the frontend's
#: domain/validation.js produces, so the UI can map one set of messages.
CODE_OVERLAP = "overlap.limit_reached"
CODE_DUPLICATE = "activity.duplicate"
CODE_DAY_RANGE = "day.out_of_range"
CODE_LAST_MIDNIGHT = "day.ends_at_midnight"
CODE_BAD_TIME = "time.end_not_after_start"
CODE_TOO_LONG = "time.too_long"

MINUTES_PER_DAY = 1440


# --------------------------------------------------------------------------- #
# Request bodies
# --------------------------------------------------------------------------- #
class ActivityFields(BaseModel):
    """The data of one activity, independent of where it sits in the week."""

    timeline_key: Optional[str] = None
    activity_code: int
    activity_name: str
    category: Optional[str] = None
    activity_path: Optional[str] = None
    color: Optional[str] = None
    parent_activity_code: Optional[int] = None
    frequency_key: Optional[str] = None
    original_selection: Optional[str] = None
    catalogue_version: Optional[str] = None
    start_minutes: int = Field(ge=0, lt=1440)
    end_minutes: int = Field(gt=0, le=2880)


class NewActivityItem(ActivityFields):
    """One activity, optionally on several days (D19)."""

    client_uuid: Optional[str] = None
    group_id: Optional[str] = None
    day_label_indexes: List[int] = Field(default_factory=list)


class CreateActivitiesRequest(BaseModel):
    items: List[NewActivityItem]
    group_id: Optional[str] = None
    catalogue_version: Optional[str] = None


class UpdateActivityRequest(BaseModel):
    day_label_index: Optional[int] = None
    start_minutes: Optional[int] = Field(default=None, ge=0, lt=1440)
    end_minutes: Optional[int] = Field(default=None, gt=0, le=2880)
    activity_code: Optional[int] = None
    activity_name: Optional[str] = None
    category: Optional[str] = None
    activity_path: Optional[str] = None
    color: Optional[str] = None
    parent_activity_code: Optional[int] = None
    frequency_key: Optional[str] = None
    original_selection: Optional[str] = None
    catalogue_version: Optional[str] = None


# --------------------------------------------------------------------------- #
# Study layout helpers
# --------------------------------------------------------------------------- #
def _ordered_day_labels(session: Session, study: Study) -> List[DayLabel]:
    day_labels = session.exec(
        select(DayLabel).where(DayLabel.study_id == study.id)
    ).all()
    return sorted(day_labels, key=lambda label: (label.display_order, label.id))


def _day_ids_by_index(day_labels: Sequence[DayLabel]) -> Dict[int, int]:
    return {label.display_order: label.id for label in day_labels}


def _index_by_day_id(day_labels: Sequence[DayLabel]) -> Dict[int, int]:
    return {label.id: label.display_order for label in day_labels}


def _coverage_snapshot(
    session: Session, study: Study, rows: Sequence[Activity]
) -> Tuple[List[DayLabel], Dict[int, Dict[int, int]], Dict[int, int]]:
    """Days in order, covered minutes per day and timeline, and the requirement.

    The read endpoint and the submit gate both go through this, so the day rail
    cannot promise something the gate then rejects (D20). The arithmetic is
    ``coverage.py``'s, which the admin progress view uses as well.
    """
    day_labels = _ordered_day_labels(session, study)
    covered = coverage_by_day_and_timeline(
        (
            TimedActivity(
                day_label_id=row.day_label_id,
                timeline_id=row.timeline_id,
                start_minutes=row.start_minutes,
                end_minutes=row.end_minutes,
            )
            for row in rows
        ),
        day_labels_in_order=[label.id for label in day_labels],
        day_start_minutes=study.day_start_minutes,
    )
    timelines = session.exec(
        select(Timeline).where(Timeline.study_id == study.id)
    ).all()
    return day_labels, covered, required_coverage_by_timeline(timelines)


def _incomplete_days(
    day_labels: Sequence[DayLabel],
    covered: Dict[int, Dict[int, int]],
    required: Dict[int, int],
) -> List[int]:
    """Display orders of the days that are not complete yet, in day order."""
    return [
        label.display_order
        for label in day_labels
        if not day_meets_requirements(covered.get(label.id, {}), required)
    ]


def _resolve_timeline(
    session: Session, study: Study, timeline_key: Optional[str] = None
) -> Timeline:
    """The timeline a write belongs to.

    A study has exactly one timeline in the new model (D22). While a legacy study
    still has two, an explicit ``timeline_key`` selects one and otherwise the
    primary (or first) timeline is used.
    """
    timelines = session.exec(
        select(Timeline).where(Timeline.study_id == study.id).order_by(Timeline.id)
    ).all()
    if not timelines:
        raise HTTPException(
            status_code=409, detail="This study has no timeline configured."
        )
    if timeline_key:
        for timeline in timelines:
            if timeline.name == timeline_key:
                return timeline
        raise HTTPException(
            status_code=400, detail=f"Unknown timeline '{timeline_key}'"
        )
    for timeline in timelines:
        if timeline.name == "primary":
            return timeline
    return timelines[0]


def _absolute_interval(
    *,
    day_label_id: int,
    start_minutes: int,
    end_minutes: int,
    day_start_minutes: int,
    index_by_day_id: Dict[int, int],
) -> tuple[int, int]:
    """Interval on a study-wide minute axis, so days compare with each other."""
    base = index_by_day_id.get(day_label_id, 0) * MINUTES_PER_DAY
    start = to_day_relative(start_minutes, day_start_minutes)
    end = to_day_relative(end_minutes, day_start_minutes)
    if end <= start:
        end += MINUTES_PER_DAY
    return base + start, base + end


# --------------------------------------------------------------------------- #
# Rules
# --------------------------------------------------------------------------- #
def _range_error(start_minutes: int, end_minutes: int) -> Optional[str]:
    if end_minutes <= start_minutes:
        return CODE_BAD_TIME
    if end_minutes - start_minutes > MINUTES_PER_DAY:
        return CODE_TOO_LONG
    return None


def _duplicate_exists(
    rows: Iterable[Activity],
    *,
    day_label_id: int,
    activity_code: int,
    start_minutes: int,
    end_minutes: int,
    ignore_uuid: Optional[str] = None,
) -> bool:
    for row in rows:
        if row.client_uuid == ignore_uuid:
            continue
        if (
            row.day_label_id == day_label_id
            and row.activity_code == activity_code
            and row.start_minutes == start_minutes
            and row.end_minutes == end_minutes
        ):
            return True
    return False


def _overlap_violation(
    rows: Iterable[Activity],
    *,
    candidate: tuple[int, int],
    max_overlap: int,
    day_start_minutes: int,
    index_by_day_id: Dict[int, int],
    ignore_uuid: Optional[str] = None,
    step: int = 10,
) -> Optional[dict]:
    """First minute where the candidate would exceed the study's overlap limit."""
    from_start, to_end = candidate
    if to_end <= from_start:
        return None

    intervals = []
    for row in rows:
        if row.client_uuid == ignore_uuid:
            continue
        start, end = _absolute_interval(
            day_label_id=row.day_label_id,
            start_minutes=row.start_minutes,
            end_minutes=row.end_minutes,
            day_start_minutes=day_start_minutes,
            index_by_day_id=index_by_day_id,
        )
        if end > from_start and start < to_end:
            intervals.append((start, end))

    minute = from_start
    while minute < to_end:
        probe = minute + step / 2
        count = 1 + sum(1 for start, end in intervals if start <= probe < end)
        if count > max_overlap:
            return {
                "code": CODE_OVERLAP,
                "minute": minute,
                "count": count,
                "max_overlap": max_overlap,
            }
        minute += step
    return None


# --------------------------------------------------------------------------- #
# Serialisation
# --------------------------------------------------------------------------- #
def _serialize_activity(row: Activity, index_by_day_id: Dict[int, int]) -> dict:
    return {
        "client_uuid": row.client_uuid,
        "group_id": row.group_id,
        "day_label_index": index_by_day_id.get(row.day_label_id),
        "activity_code": row.activity_code,
        "activity_name": row.activity_name,
        "activity_path": row.activity_path_frontend,
        "category": row.category,
        "color": row.color,
        "parent_activity_code": row.parent_activity_code,
        "frequency_key": row.frequency_key,
        "start_minutes": row.start_minutes,
        "end_minutes": row.end_minutes,
        "catalogue_version": row.catalogue_version,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _row_uuid(client_uuid: Optional[str], day_index: int) -> str:
    """Row identity: one client activity can live on several days.

    A retry of the same request resolves to the same rows, which is what makes
    the create idempotent (D17).
    """
    if not client_uuid:
        return str(uuid.uuid4())
    return f"{client_uuid}:{day_index}"


def _activity_rows(
    session: Session, study: Study, participant_id: str
) -> List[Activity]:
    return list(
        session.exec(
            select(Activity).where(
                Activity.study_id == study.id,
                Activity.participant_id == participant_id,
            )
        ).all()
    )


def _validate_codes_and_frequency(
    *,
    session: Session,
    study: Study,
    items: Sequence[ActivityFields],
) -> None:
    valid_codes = get_study_activity_codes(study.name_short, session)
    invalid = [
        item.activity_code for item in items if item.activity_code not in valid_codes
    ]
    if invalid:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "invalid_activity_code",
                "message": "Activity code not found in the study configuration.",
                "activity_codes": sorted(set(invalid)),
            },
        )

    activities_config, _source, _lang = get_study_activities_config_model(
        session=session, study=study, lang=None
    )
    allowed_by_code = allowed_frequency_keys_by_code(activities_config)
    errors: List[dict] = []
    for item in items:
        errors.extend(
            frequency_key_errors(
                frequency_key=item.frequency_key,
                candidate_codes=[item.activity_code],
                allowed_by_code=allowed_by_code,
                timeline_key=item.timeline_key,
                activity_name=item.activity_name,
            )
        )
    if errors:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "invalid_frequency_key",
                "message": "Invalid frequency_key for one or more activities.",
                "errors": errors,
            },
        )


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
@router.get("/diary")
def get_diary(
    context: DiaryContext = Depends(get_readable_diary_context),
    session: Session = Depends(get_session),
):
    """The whole diary in one request: days, coverage, activities and limits."""
    study = context.study
    participant_id = context.study_participant.participant_id

    day_labels = _ordered_day_labels(session, study)
    index_by_day_id = _index_by_day_id(day_labels)
    timeline = _resolve_timeline(session, study)
    rows = _activity_rows(session, study, participant_id)
    _, covered, required = _coverage_snapshot(session, study, rows)

    days = []
    for label in day_labels:
        per_timeline = covered.get(label.id, {})
        days.append(
            {
                "index": label.display_order,
                "name": label.name,
                "display_name": label.display_name,
                "display_names": label.display_names or {},
                "has_data": label.id in covered,
                "coverage_minutes": sum(per_timeline.values()),
                "meets_requirement": day_meets_requirements(per_timeline, required),
            }
        )

    return {
        "schema_version": 1,
        "study": {
            "name_short": study.name_short,
            "name": study.name,
            "default_language": study.default_language,
            "day_start_minutes": study.day_start_minutes,
            "submitted_at": (
                context.study_participant.study_submitted_at.isoformat()
                if context.study_participant.study_submitted_at
                else None
            ),
            "allow_skip_timeuse": study.allow_skip_timeuse,
        },
        "timeline": {
            "key": timeline.name,
            "display_name": timeline.display_name,
            "mode": timeline.mode,
            "min_coverage": timeline.min_coverage,
            "max_overlap": timeline.max_overlap,
        },
        "days": days,
        "activities": [_serialize_activity(row, index_by_day_id) for row in rows],
    }


@router.post("/diary/submit")
def submit_diary(
    context: DiaryContext = Depends(get_readable_diary_context),
    session: Session = Depends(get_session),
):
    """Lock the diary: the participant is done (D20).

    The gate is the same coverage rule the day rail shows, so a participant
    never sees "7 of 7 days complete" and then a rejection. Idempotent: a second
    call returns the first timestamp instead of an error, which makes a retry
    after a lost response harmless.

    Lives under ``/diary`` rather than on the participant root, so it cannot
    collide with the old ``POST .../submit`` that stays until cutover (D25).
    """
    study = context.study
    participant = context.study_participant

    if participant.study_submitted_at is not None:
        return {
            "study_submitted_at": participant.study_submitted_at.isoformat(),
            "already_submitted": True,
            "stage": stage_for_participant(
                session, study, participant.participant_id
            ).stage,
        }

    rows = _activity_rows(session, study, participant.participant_id)
    day_labels, covered, required = _coverage_snapshot(session, study, rows)
    incomplete = _incomplete_days(day_labels, covered, required)

    if incomplete:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "days.incomplete",
                "message": "Not every day is complete yet.",
                "incomplete_day_indices": incomplete,
                "days_complete": len(day_labels) - len(incomplete),
                "total_days": len(day_labels),
            },
        )

    participant.study_submitted_at = utc_now()
    session.add(participant)
    session.commit()
    # Report what the database holds rather than the value we passed in, so this
    # response and a later GET /diary spell the same instant the same way.
    session.refresh(participant)
    submitted_at = participant.study_submitted_at
    assert submitted_at is not None

    return {
        "study_submitted_at": submitted_at.isoformat(),
        "already_submitted": False,
        # `tasks` when external tasks are still owed, otherwise `done` (D37).
        "stage": stage_for_participant(
            session, study, participant.participant_id
        ).stage,
    }


#: Reasons a participant may pick when skipping. The codes are stored as-is, so
#: they are stable strings; their labels live in the client's locales.
SKIP_REASON_CODES = (
    "no_time_and_effort",
    "technical_problem",
    "did_not_understand",
    "do_not_want_to_report",
    "other",
)


class SkipDiaryRequest(BaseModel):
    """Why the participant is skipping. Both fields are optional on purpose."""

    reason_code: Optional[str] = None
    reason_note: Optional[str] = Field(default=None, max_length=500)


@router.post("/diary/skip")
def skip_diary(
    payload: Optional[SkipDiaryRequest] = None,
    context: DiaryContext = Depends(get_readable_diary_context),
    session: Session = Depends(get_session),
):
    """Close the diary because the participant does not want to fill it (D41).

    Skipping is a server action, not a redirect: it sets ``study_submitted_at``
    (the field every lock, the admin completion view and the exports already key
    off) plus ``skipped_at`` and the optional reason, so the decision survives a
    reload and the study team can tell a skip from an abandonment.

    What it does **not** do: satisfy ``require_diary_before_external_tasks``. A
    study that requires the diary before its questionnaires keeps them closed for
    a skipper (see ``stages.resolve_placement``), because that requirement exists
    to prevent exactly this - questionnaires without a diary.

    Idempotent: skipping again returns the stored state. Refused when the study
    does not offer the option, and when the diary was already submitted normally
    (then there is nothing to skip).

    @param payload Optional reason (code and/or short note).
    @param context Diary context dependency (study + participant).
    @param session Database session dependency.
    @returns When the diary closed, the reason, and the stage to show next.
    """
    study = context.study
    participant = context.study_participant
    payload = payload or SkipDiaryRequest()

    if not study.allow_skip_timeuse:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "diary.skip_not_allowed",
                "message": "This study does not allow skipping the diary.",
            },
        )

    reason_code = (payload.reason_code or "").strip() or None
    if reason_code is not None and reason_code not in SKIP_REASON_CODES:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "diary.unknown_skip_reason",
                "message": "Unknown skip reason.",
                "allowed_reason_codes": list(SKIP_REASON_CODES),
            },
        )
    note = (payload.reason_note or "").strip() or None

    # A first write from an open study still has to create the two rows; the
    # readable context hands out an unsaved stand-in on purpose.
    ensure_participant_rows(session, participant)

    # Already closed: report what is stored instead of overwriting it. A diary
    # submitted the normal way is not turned into a skipped one.
    if participant.study_submitted_at is not None:
        return {
            "study_submitted_at": participant.study_submitted_at.isoformat(),
            "skipped_at": (
                participant.skipped_at.isoformat() if participant.skipped_at else None
            ),
            "already_closed": True,
            "stage": stage_for_participant(
                session, study, participant.participant_id
            ).stage,
        }

    closed_at = utc_now()
    participant.study_submitted_at = closed_at
    participant.skipped_at = closed_at
    participant.skip_reason_code = reason_code
    participant.skip_note = note
    session.add(participant)
    session.commit()
    session.refresh(participant)

    skipped_at = participant.skipped_at
    assert skipped_at is not None
    logger.info(
        "Participant '%s' skipped the diary of study '%s' (reason=%s)",
        participant.participant_id,
        study.name_short,
        reason_code or "not given",
    )

    return {
        "study_submitted_at": participant.study_submitted_at.isoformat(),
        "skipped_at": skipped_at.isoformat(),
        "already_closed": False,
        "stage": stage_for_participant(
            session, study, participant.participant_id
        ).stage,
    }


@router.post("/activities", status_code=201)
def create_activities(
    payload: CreateActivitiesRequest,
    context: DiaryContext = Depends(get_writable_diary_context),
    session: Session = Depends(get_session),
):
    """Create one activity, optionally on several days, in one transaction."""
    study = context.study
    participant_id = context.study_participant.participant_id

    if not payload.items:
        raise HTTPException(status_code=400, detail="No activities submitted.")

    day_labels = _ordered_day_labels(session, study)
    day_ids_by_index = _day_ids_by_index(day_labels)
    index_by_day_id = _index_by_day_id(day_labels)
    day_count = len(day_labels)

    _validate_codes_and_frequency(session=session, study=study, items=payload.items)

    existing = _activity_rows(session, study, participant_id)
    existing_by_uuid = {row.client_uuid: row for row in existing}
    group_id = payload.group_id or str(uuid.uuid4())

    results: List[dict] = []
    created: List[Activity] = []

    for item in payload.items:
        range_code = _range_error(item.start_minutes, item.end_minutes)
        if range_code:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": range_code,
                    "message": "The end must be after the start, within 24 hours.",
                    "start_minutes": item.start_minutes,
                    "end_minutes": item.end_minutes,
                },
            )

        timeline = _resolve_timeline(session, study, item.timeline_key)
        targets = item.day_label_indexes or []

        for day_index in sorted(set(targets)):
            day_label_id = day_ids_by_index.get(day_index)
            if day_label_id is None:
                results.append(
                    {
                        "activity_code": item.activity_code,
                        "day_label_index": day_index,
                        "status": "skipped",
                        "code": CODE_DAY_RANGE,
                    }
                )
                continue

            row_uuid = _row_uuid(item.client_uuid, day_index)
            if row_uuid in existing_by_uuid:
                # A retry of a request whose response was lost: the row is there.
                results.append(
                    {
                        "activity_code": item.activity_code,
                        "day_label_index": day_index,
                        "status": "added",
                        "client_uuid": row_uuid,
                        "existing": True,
                    }
                )
                continue

            if item.end_minutes > MINUTES_PER_DAY and day_index >= day_count - 1:
                results.append(
                    {
                        "activity_code": item.activity_code,
                        "day_label_index": day_index,
                        "status": "skipped",
                        "code": CODE_LAST_MIDNIGHT,
                    }
                )
                continue

            if _duplicate_exists(
                [*existing, *created],
                day_label_id=day_label_id,
                activity_code=item.activity_code,
                start_minutes=item.start_minutes,
                end_minutes=item.end_minutes,
            ):
                results.append(
                    {
                        "activity_code": item.activity_code,
                        "day_label_index": day_index,
                        "status": "skipped",
                        "code": CODE_DUPLICATE,
                    }
                )
                continue

            violation = _overlap_violation(
                [*existing, *created],
                candidate=_absolute_interval(
                    day_label_id=day_label_id,
                    start_minutes=item.start_minutes,
                    end_minutes=item.end_minutes,
                    day_start_minutes=study.day_start_minutes,
                    index_by_day_id=index_by_day_id,
                ),
                max_overlap=timeline.max_overlap,
                day_start_minutes=study.day_start_minutes,
                index_by_day_id=index_by_day_id,
            )
            if violation:
                results.append(
                    {
                        "activity_code": item.activity_code,
                        "day_label_index": day_index,
                        "status": "skipped",
                        **violation,
                    }
                )
                continue

            row = Activity(
                study_id=study.id,
                participant_id=participant_id,
                day_label_id=day_label_id,
                timeline_id=timeline.id,
                activity_code=item.activity_code,
                start_minutes=item.start_minutes,
                end_minutes=item.end_minutes,
                activity_name=item.activity_name,
                activity_path_frontend=item.activity_path
                or f"timeline:{timeline.name} > activity:{item.activity_name}",
                color=item.color,
                category=item.category,
                frequency_key=item.frequency_key,
                parent_activity_code=item.parent_activity_code,
                client_uuid=row_uuid,
                group_id=item.group_id or group_id,
                catalogue_version=item.catalogue_version or payload.catalogue_version,
            )
            session.add(row)
            created.append(row)
            existing_by_uuid[row_uuid] = row
            results.append(
                {
                    "activity_code": item.activity_code,
                    "day_label_index": day_index,
                    "status": "added",
                    "client_uuid": row_uuid,
                }
            )

    try:
        session.commit()
    except IntegrityError:
        # Two requests raced through the checks above; the database has the last
        # word, which is the point of the constraint.
        session.rollback()
        raise HTTPException(
            status_code=409,
            detail={
                "code": CODE_DUPLICATE,
                "message": "This activity was already saved. Reload the diary.",
            },
        )
    for row in created:
        session.refresh(row)

    return {
        "group_id": group_id,
        "created": len(created),
        "results": results,
        "activities": [_serialize_activity(row, index_by_day_id) for row in created],
    }


@router.patch("/activities/{client_uuid}")
def update_activity(
    client_uuid: str,
    payload: UpdateActivityRequest,
    context: DiaryContext = Depends(get_writable_diary_context),
    session: Session = Depends(get_session),
):
    """Change one activity: move it, retime it, or change what it is."""
    study = context.study
    participant_id = context.study_participant.participant_id

    row = session.exec(
        select(Activity).where(
            Activity.study_id == study.id,
            Activity.participant_id == participant_id,
            Activity.client_uuid == client_uuid,
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Activity not found.")

    day_labels = _ordered_day_labels(session, study)
    day_ids_by_index = _day_ids_by_index(day_labels)
    index_by_day_id = _index_by_day_id(day_labels)

    if payload.day_label_index is not None:
        day_label_id = day_ids_by_index.get(payload.day_label_index)
        if day_label_id is None:
            raise HTTPException(status_code=400, detail={"code": CODE_DAY_RANGE})
        row.day_label_id = day_label_id

    for field in (
        "start_minutes",
        "end_minutes",
        "activity_code",
        "activity_name",
        "category",
        "activity_path",
        "color",
        "parent_activity_code",
        "frequency_key",
        "original_selection",
        "catalogue_version",
    ):
        value = getattr(payload, field)
        if value is not None:
            setattr(row, field, value)

    if payload.activity_name is not None:
        row.activity_path_frontend = payload.activity_path or (
            f"activity:{payload.activity_name}"
        )

    updated_fields = payload.model_dump(exclude_none=True)
    if updated_fields:
        _validate_codes_and_frequency(
            session=session,
            study=study,
            items=[
                ActivityFields(
                    activity_code=row.activity_code,
                    activity_name=row.activity_name,
                    frequency_key=row.frequency_key,
                    start_minutes=row.start_minutes,
                    end_minutes=row.end_minutes,
                )
            ],
        )

    range_code = _range_error(row.start_minutes, row.end_minutes)
    if range_code:
        raise HTTPException(status_code=400, detail={"code": range_code})

    timeline = _resolve_timeline(session, study)
    rows = _activity_rows(session, study, participant_id)

    if _duplicate_exists(
        rows,
        day_label_id=row.day_label_id,
        activity_code=row.activity_code,
        start_minutes=row.start_minutes,
        end_minutes=row.end_minutes,
        ignore_uuid=client_uuid,
    ):
        raise HTTPException(status_code=409, detail={"code": CODE_DUPLICATE})

    violation = _overlap_violation(
        rows,
        candidate=_absolute_interval(
            day_label_id=row.day_label_id,
            start_minutes=row.start_minutes,
            end_minutes=row.end_minutes,
            day_start_minutes=study.day_start_minutes,
            index_by_day_id=index_by_day_id,
        ),
        max_overlap=timeline.max_overlap,
        day_start_minutes=study.day_start_minutes,
        index_by_day_id=index_by_day_id,
        ignore_uuid=client_uuid,
    )
    if violation:
        raise HTTPException(status_code=409, detail=violation)

    row.updated_at = utc_now()
    session.add(row)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=409,
            detail={"code": CODE_DUPLICATE, "message": "This activity already exists."},
        )
    session.refresh(row)

    return _serialize_activity(row, index_by_day_id)


@router.delete("/activities/{client_uuid}")
def delete_activity(
    client_uuid: str,
    context: DiaryContext = Depends(get_writable_diary_context),
    session: Session = Depends(get_session),
):
    """Remove one activity. Deleting twice is reported, not an error."""
    study = context.study
    participant_id = context.study_participant.participant_id

    row = session.exec(
        select(Activity).where(
            Activity.study_id == study.id,
            Activity.participant_id == participant_id,
            Activity.client_uuid == client_uuid,
        )
    ).first()
    if row is None:
        return {"deleted": 0}

    session.delete(row)
    session.commit()
    return {"deleted": 1}


@router.delete("/activity-groups/{group_id}")
def delete_activity_group(
    group_id: str,
    context: DiaryContext = Depends(get_writable_diary_context),
    session: Session = Depends(get_session),
):
    """Remove every row of a multi-day action, which is what one undo reverses."""
    study = context.study
    participant_id = context.study_participant.participant_id

    result = session.exec(
        delete(Activity).where(
            Activity.study_id == study.id,
            Activity.participant_id == participant_id,
            Activity.group_id == group_id,
        )
    )
    session.commit()
    return {"deleted": result.rowcount or 0}
