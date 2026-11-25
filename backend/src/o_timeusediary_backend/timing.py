"""The study's time grid: the step times are entered in, and the shortest entry.

Two settings, because they answer two different questions:

* ``time_step_minutes`` - how precisely a time can be typed. This is what the
  native time picker offers the participant, so it has to match what they can
  enter: with a 10-minute step, typing 06:15 silently becomes 06:10 and the
  participant thinks they misclicked.
* ``min_duration_minutes`` - how short an entry may be. This is what keeps a
  block large enough to see and tap when the step is fine. It must be a multiple
  of the step, otherwise an on-grid start plus the minimum yields an off-grid
  end, which the client would refuse to save.

The step must divide the day (1440) so that the end of the day is on the grid:
with a 25-minute step a 23:20-24:00 entry would end off-grid and could never be
saved. The choices below are the multiples of 5 that divide 1440.

The backend stores whatever minutes a client sends (there is no server-side
rounding or step validation); these rules govern configuration, and the
participant client enforces them.
"""

from __future__ import annotations

TIME_STEP_CHOICES: tuple[int, ...] = (5, 10, 15, 20, 30, 60)
DEFAULT_TIME_STEP_MINUTES = 10
DEFAULT_MIN_DURATION_MINUTES = 10
MINUTES_PER_DAY = 1440


def validate_timing_settings(
    time_step_minutes: int, min_duration_minutes: int
) -> None:
    """Raise ValueError when a study's two time settings cannot work together."""
    if time_step_minutes not in TIME_STEP_CHOICES:
        raise ValueError(
            f"time_step_minutes must be one of {list(TIME_STEP_CHOICES)}, "
            f"got {time_step_minutes}"
        )
    if min_duration_minutes < time_step_minutes:
        raise ValueError(
            "min_duration_minutes must be at least time_step_minutes "
            f"({time_step_minutes}), got {min_duration_minutes}"
        )
    if min_duration_minutes % time_step_minutes != 0:
        raise ValueError(
            "min_duration_minutes must be a multiple of time_step_minutes "
            f"({time_step_minutes}), got {min_duration_minutes}"
        )
    if min_duration_minutes > MINUTES_PER_DAY:
        raise ValueError(
            "min_duration_minutes must not exceed 1440, "
            f"got {min_duration_minutes}"
        )
