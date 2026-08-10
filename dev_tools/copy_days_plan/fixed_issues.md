
## Fixed issues after/during implementation of the new plan

This file lists bugs discovered during manual testing on 2026-08-10 after the
initial implementation was committed.  Worth covering in E2E tests later.

---

### 1. JS Syntax Error — Unbalanced Braces in `ui.js`

**Symptom**: Page loaded broken — "Loading..." title, 3 disabled buttons, no
timelines, no activities. Complete initialization failure.

**Root cause**: Two stray closing braces from incomplete cleanup of old
navSubmitBtn code during the `updateButtonStates()` simplification.

**Fix**: Removed leftover `}` that prematurely closed `updateButtonStates()`,
and duplicate `});` that prematurely closed `initButtons()`. Also restored
missing `/**` JSDoc opening for `updateSubmitStudyButton`.

---

### 2. Last Timeline Active by Default Instead of First

**Symptom**: After page load, the last timeline had the active blue border.
"Previous timeline" button was grayed out.

**Root cause**: The init loop `for (…keys…) addNextTimeline()` left
`currentIndex` on the last timeline. Manual override broke internal state.

**Fix**: After the init loop, use `goToPreviousTimeline()` in a `while` loop
to properly walk back to index 0, correctly moving timelines to the past
wrapper and restoring event handlers.

---

### 3. Submit Study Button Not Updated After Copy

**Symptom**: After copying data to all days, day buttons turned green but the
Submit Study button stayed gray with the old tooltip.

**Root cause**: `updateSubmitStudyButton()` was module-scoped in `ui.js`, not
accessible from `copyDayTo()` in `script.js`.

**Fix**: Exposed `window.updateSubmitStudyButton` and called it from
`copyDayTo()` after updating day indices.

---

### 4. Save Confirmation Modal Removed

**Change**: The confirmation modal before every save was a relic from the old
flow. Saving is now routine — no modal needed.

**Fix**: `handleNextButtonAction()` saves directly. The modal DOM remains but
is unused for saves.

---

### 5. All Timelines Shown Immediately

**Change**: Timelines were previously revealed one-by-one via "Next Timeline"
— a guided wizard pattern obsolete after Copy Days.

**Fix**: Init now renders all timelines immediately. Save button always says
"Save Day". "Next Timeline" concept removed entirely.

---

### 6. Submit Study Button Styling

**Symptom**: Inactive state looked like a rendering artifact (browser default
disabled). Active state was light gray, confusing users.

**Fix**: Inactive uses normal button colors (`opacity: 1`, `#6c757d`).
Active uses green (`#16a34a`) with smooth transition.

---

### 7. Right-Click Copy Menu Excluded Current Viewing Day

**Symptom**: Right-clicking a day button excluded the current viewing day
from targets — couldn't copy another day's data onto the viewing day.

**Root cause**: `getAllTargetDayIndices()` always excluded current viewing day.

**Fix**: Added `excludeIndex` parameter. "Copy this day" defaults to current;
right-click passes the clicked day instead, making the viewing day a target.

---

### 8. Copy Picker `hasData` Disagreed with Visible State

**Symptom A**: Templates loaded → picker showed "(empty)" (DB had no data).
**Symptom B**: Activities deleted locally → picker showed "(has data)" (DB
still had old data).

**Root cause**: Picker used pure DB state for all days, ignoring unsaved
frontend state on the current viewing day.

**Fix**: New `hasFrontendActivities()` helper checks in-memory state for the
current day only. Non-current days remain DB-driven (always clean after
day-switch save+reload).

---

### 9. Copy Overwrite Confirmation Disagreed with Picker

**Symptom**: Picker showed "(empty)" but clicking triggered "Already has data.
Overwrite?" — broken promise.

**Root cause**: `copyDayTo()` used pure DB state for the overwrite check,
while the picker used the in-memory-aware logic (see #8).

**Fix**: `copyDayTo()` now uses `hasFrontendActivities()` for the current day,
matching the picker.

---

### 10. No Page Refresh After Copying onto Current Day

**Symptom**: Copying onto the current viewing day succeeded but the frontend
didn't show the new data until manual reload.

**Fix**: After a successful copy where target is the current day, auto-reload
after 3 seconds (allowing time to read the success toast).

---

### 11. Templates Re-Loaded After Saving an Empty Day

**Symptom**: Fill Monday → switch Tuesday → delete templates → save → reload →
templates appear again. Backend can't distinguish "never visited" from
"intentionally cleared."

**Fix**: `sessionStorage` tracking via `markDaySaved()` / `wasDaySaved()`.
Called after every successful save (manual and day-switch auto-save).
Templates skipped if a day was already saved this session. Tab-close resets it.

---

### Files Changed

| File | Issues |
|---|---|
| `frontend/src/js/ui.js` | #1, #3, #4, #5, #6, #11 |
| `frontend/src/js/script.js` | #1, #2, #7, #8, #9, #10, #11 |
| `frontend/src/styles/styles.css` | #6 |
