"""The stage table from D37, one test per row.

Nothing here touches a database: the rules are a pure function, so a rule change
shows up as one failing row instead of a redirect that only breaks in production.
"""

from __future__ import annotations

import pytest

from o_timeusediary_backend.stages import (
    DONE_COMPLETED,
    DONE_NOCONSENT,
    STAGE_CONSENT,
    STAGE_DIARY,
    STAGE_DONE,
    STAGE_INSTRUCTIONS,
    STAGE_TASKS,
    STAGE_UNAVAILABLE,
    resolve_placement,
)


def _place(**overrides):
    """A participant who consented, read the instructions, and has an open diary."""
    values = dict(
        available=True,
        require_consent=True,
        consent_given=True,
        require_instructions=True,
        instructions_completed=True,
        submitted=False,
        pending_external_tasks=0,
    )
    values.update(overrides)
    return resolve_placement(**values)


def test_an_undecided_participant_starts_at_consent():
    assert _place(consent_given=None).stage == STAGE_CONSENT


def test_consent_decided_but_not_yet_read_moves_to_instructions():
    assert _place(instructions_completed=False).stage == STAGE_INSTRUCTIONS


def test_a_fresh_participant_lands_in_the_diary_once_the_way_is_clear():
    assert _place().stage == STAGE_DIARY


def test_a_study_without_consent_or_instructions_starts_in_the_diary():
    placement = _place(
        require_consent=False,
        consent_given=None,
        require_instructions=False,
        instructions_completed=False,
    )
    assert placement.stage == STAGE_DIARY


def test_declining_consent_is_final_and_says_so():
    placement = _place(consent_given=False)
    assert placement.stage == STAGE_DONE
    assert placement.done_reason == DONE_NOCONSENT


def test_declining_beats_unavailability_so_a_paused_study_does_not_invite_a_return():
    placement = _place(consent_given=False, available=False)
    assert placement.stage == STAGE_DONE
    assert placement.done_reason == DONE_NOCONSENT


def test_a_study_that_is_not_collecting_is_unavailable():
    placement = _place(available=False, unavailable_reason="ended")
    assert placement.stage == STAGE_UNAVAILABLE


def test_the_unavailable_stage_says_why():
    for reason in ("paused", "not_started", "ended"):
        placement = _place(available=False, unavailable_reason=reason)
        assert placement.stage == STAGE_UNAVAILABLE
        assert placement.unavailable_reason == reason


def test_a_submitted_diary_outranks_a_closed_window():
    placement = _place(available=False, submitted=True)
    assert placement.stage == STAGE_DONE
    assert placement.done_reason == DONE_COMPLETED


def test_an_outstanding_task_stays_reachable_after_the_window_closed():
    placement = _place(available=False, submitted=True, pending_external_tasks=1)
    assert placement.stage == STAGE_TASKS


def test_a_submitted_diary_with_nothing_outstanding_is_done():
    placement = _place(submitted=True)
    assert placement.stage == STAGE_DONE
    assert placement.done_reason == DONE_COMPLETED


def test_outstanding_external_tasks_keep_the_participant_in_tasks():
    assert _place(submitted=True, pending_external_tasks=2).stage == STAGE_TASKS


def test_tasks_never_precede_the_diary():
    assert _place(submitted=False, pending_external_tasks=2).stage == STAGE_DIARY


def test_instructions_come_before_the_diary_and_are_moot_once_it_is_submitted():
    assert _place(instructions_completed=False).stage == STAGE_INSTRUCTIONS
    assert _place(instructions_completed=False, submitted=True).stage == STAGE_DONE


@pytest.mark.parametrize(
    "stage",
    [
        STAGE_UNAVAILABLE,
        STAGE_CONSENT,
        STAGE_INSTRUCTIONS,
        STAGE_DIARY,
        STAGE_TASKS,
        STAGE_DONE,
    ],
)
def test_every_stage_is_a_stable_string(stage):
    """The client routes on these strings, so they are part of the contract."""
    assert isinstance(stage, str) and stage.islower()
