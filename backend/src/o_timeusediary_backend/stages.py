"""Where a participant belongs right now (D37).

The old frontend answered this question in five places. The diary script, the
consent page, the instructions page, the tasks page and the idle-timeout module
each decided where to send the participant, carried the decision in the URL as
``completion_status``, and kept a second copy of the facts in ``localStorage``, so
pages disagreed after a stale cache and a rule change meant finding every
``location.href``.

Here the answer is computed once:

* ``resolve_placement`` is a pure function over the participant's state, one
  branch per row of the table in D37. It is the only statement of the rules, and
  it is tested without a database.
* ``stage_for_participant`` is the only code that reads the database to feed it.

The client renders the stage it is handed. It never decides, and it never carries
progress in the URL. An `unavailable` stage also carries a reason (paused, not
started yet, already over), so the one page can say why instead of guessing (D39).

A skipped diary is ``done`` with ``skipped`` as the reason (D41). Skipping closes
the diary exactly like submitting it, but it is **not** a filled diary: a study
that sets ``require_diary_before_external_tasks`` keeps its tasks closed for a
skipper, because the requirement exists precisely so questionnaires are not
answered without the diary. For studies without that requirement the participant
continues to the tasks - that is what ``allow_skip_timeuse`` is for.

**Tasks never come before the diary.** They are reached from the diary (and after
it), never instead of it.
"""

from __future__ import annotations

from typing import NamedTuple, Optional

from sqlalchemy import func
from sqlmodel import Session, select

from .api_deps.diary_access import study_availability
from .models import (
    Study,
    StudyExternalTask,
    StudyExternalTaskAssignment,
    StudyParticipant,
)
from .utils import localized_study_text

STAGE_UNAVAILABLE = "unavailable"
STAGE_CONSENT = "consent"
STAGE_INSTRUCTIONS = "instructions"
STAGE_DIARY = "diary"
STAGE_TASKS = "tasks"
STAGE_DONE = "done"

DONE_COMPLETED = "completed"
DONE_NOCONSENT = "noconsent"
DONE_SKIPPED = "skipped"


class Placement(NamedTuple):
    """The stage a participant belongs in, plus why.

    ``done_reason`` explains a `done` stage; ``unavailable_reason`` explains an
    `unavailable` stage (D39). The client renders both, it does not derive them.
    """

    stage: str
    done_reason: Optional[str] = None
    unavailable_reason: Optional[str] = None


def resolve_placement(
    *,
    available: bool,
    unavailable_reason: Optional[str] = None,
    require_consent: bool,
    consent_given: Optional[bool],
    require_instructions: bool,
    instructions_completed: bool,
    submitted: bool,
    pending_external_tasks: int = 0,
    skipped: bool = False,
    require_diary_before_external_tasks: bool = False,
) -> Placement:
    """The stage table from D37, as code.

    Two checks run before availability, both for the same reason - a participant
    who has already finished must not be sent back into a decision or a waiting
    room:

    * ``consent_given is False``: they declined, and "come back later" would
      invite them to a decision they already made.
    * ``submitted``: they handed the diary in, and a study whose collection
      window has since closed would otherwise hide their thank-you page and any
      external task they still owe. Tasks stay reachable after the window so a
      participant can finish them.
    """
    if require_consent and consent_given is False:
        return Placement(STAGE_DONE, DONE_NOCONSENT)

    if submitted:
        # A closed diary is finished; instructions and availability are moot.
        # A *skipped* one does not satisfy a "diary before tasks" requirement: the
        # participant ended the diary without filling it, which is exactly what
        # that setting rules out.
        tasks_unlocked = not (skipped and require_diary_before_external_tasks)
        if pending_external_tasks > 0 and tasks_unlocked:
            return Placement(STAGE_TASKS)
        return Placement(STAGE_DONE, DONE_SKIPPED if skipped else DONE_COMPLETED)

    if not available:
        return Placement(STAGE_UNAVAILABLE, None, unavailable_reason)
    if require_consent and consent_given is not True:
        return Placement(STAGE_CONSENT)

    if require_instructions and not instructions_completed:
        return Placement(STAGE_INSTRUCTIONS)
    return Placement(STAGE_DIARY)


def pending_external_task_count(
    session: Session, study: Study, participant_id: Optional[str]
) -> int:
    """How many external tasks this participant still owes the study."""
    if not participant_id:
        return 0
    statement = (
        select(func.count())
        .select_from(StudyExternalTaskAssignment)
        .join(
            StudyExternalTask,
            StudyExternalTask.id == StudyExternalTaskAssignment.external_task_id,
        )
        .where(
            StudyExternalTask.study_id == study.id,
            StudyExternalTaskAssignment.participant_id == participant_id,
            StudyExternalTaskAssignment.is_confirmed == False,  # noqa: E712 - SQL
        )
    )
    return int(session.exec(statement).one())


def stage_for_participant(
    session: Session,
    study: Study,
    participant_id: Optional[str],
    language: Optional[str] = None,
) -> Placement:
    """Resolve the stage for a participant who may not exist yet.

    Used by the endpoints that change a participant's state (consent,
    instructions, submit), so each of them can answer with the next stage instead
    of making the client ask again. ``GET /study-config`` feeds the same pure
    function with values it has already loaded, which keeps its query count where
    it was.
    """
    link = None
    if participant_id:
        link = session.exec(
            select(StudyParticipant).where(
                StudyParticipant.study_id == study.id,
                StudyParticipant.participant_id == participant_id,
            )
        ).first()

    availability = study_availability(study)
    return resolve_placement(
        available=availability.available,
        unavailable_reason=availability.reason,
        require_consent=bool(study.require_consent),
        consent_given=link.consent_given if link else None,
        require_instructions=bool(
            localized_study_text(study, "study_text_instructions", language)
        ),
        instructions_completed=bool(link.instructions_completed) if link else False,
        submitted=bool(link and link.study_submitted_at is not None),
        pending_external_tasks=pending_external_task_count(
            session, study, participant_id
        ),
        skipped=bool(link and link.skipped_at is not None),
        require_diary_before_external_tasks=bool(
            study.require_diary_before_external_tasks
        ),
    )
