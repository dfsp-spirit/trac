# Copy Days — Implementation Plan

This document details all technical changes needed to implement the Copy Days feature. For the high-level user workflow and rationale, see `copy_days_plan.md` and `current_user_workflow.md`.

---

## 1. Database Changes

### 1.1 Alembic Migration: `study_submitted_at` on `StudyParticipant`

Add a nullable timestamp column to `StudyParticipant`:

```python
# In models.py, class StudyParticipant:
study_submitted_at: Optional[datetime] = Field(
    default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
)
```

Generate migration: `tud db revision --autogenerate -m "add_study_submitted_at"`

**Semantics**:
- `NULL` → participant has not yet submitted the study (default).
- Non-NULL → participant submitted on that date. Once set, the frontend redirects to thank-you page on all subsequent visits.
- Can only be set when all days meet min_coverage (enforced at API level).
- In the admin panel, an admin may need the ability to clear this field (reset submission) — TBD whether a dedicated admin action is needed or a manual DB intervention is acceptable for now.

### 1.2 No Other Schema Changes

- No new tables needed.
- `Activity` model unchanged.
- `DayLabel`, `Timeline`, `Study` models unchanged.

---

## 2. Backend API Changes

All changes in `backend/src/o_timeusediary_backend/api.py`.

### 2.1 Remove min_coverage Hard Block on Save

**File**: `api.py`, `POST /api/studies/{study}/participants/{pid}/day_labels/{day}/activities`

**Change**: Remove (or comment out) the `_validate_timeline_min_coverage` call and the associated 400 error response (~lines 1769–1795). The endpoint should accept any set of activities, regardless of coverage.

**Alternative considered**: Keep a soft warning in the response body. **Decision**: Not needed — the green/gray day buttons already serve as the persistent indicator. No popup warnings on auto-save (day switch, copy) to avoid confusing the user during silent saves.

### 2.2 New Endpoint: Submit Study

**Route**: `POST /api/studies/{study_name_short}/participants/{participant_id}/submit`

**Behavior**:
1. Look up study and participant as usual.
2. Verify that all days meet min_coverage (reuse `_get_days_meeting_min_coverage()`). If not → 400 with detail listing incomplete days.
3. Set `study_submitted_at = utc_now()` on the `StudyParticipant` row.
4. `session.commit()`.
5. Return `{"study_submitted_at": "<iso8601>"}`.

**Idempotency**: If `study_submitted_at` is already set, return 200 with the existing timestamp (no error). This handles double-clicks gracefully.

### 2.3 Modify Copy Endpoint: Allow Overwrite

**File**: `api.py`, `POST .../day_labels/{day}/copy-from/{source_day}`

**Current behavior**: Returns 409 Conflict if target day has existing activities.

**New behavior**:
1. If target day has existing activities → delete them all first, then copy.
2. Log whether this was a fresh copy or an overwrite.
3. No min_coverage check on either source or target.

### 2.4 Switch `participant_has_completed_study` Logic

**Files**: `api.py` — `GET /api/studies/{study}/study-config` and `GET .../activities`

**Change**: Replace `_is_participant_study_complete()` call with a check on `StudyParticipant.study_submitted_at IS NOT NULL`.

**Rationale**: Before Copy Days, "all days have data" == "study complete". Now, a participant can have all days filled but not yet submitted. Completion is an explicit action.

Also update `_is_external_tasks_locked_by_diary_requirement()` (line ~711) to use `study_submitted_at` instead of `_is_participant_study_complete()`.

### 2.5 Template Feature: No Backend Changes

The backend template logic (`template_activities` in the GET activities response) stays as-is. The frontend toggle (`TEMPLATE_ENABLED`) controls whether the frontend uses the data. No API changes needed.

---

## 3. Frontend Changes

All in `frontend/src/`.

### 3.1 `script.js` — Major Changes

| Change | Location | Description |
|---|---|---|
| Remove auto-advance on save | `handleDayNavigation()` in `utils.js` | After save, always stay on current day. Do not increment `day_label_index`. Do not redirect on last day. |
| Always-available Save button | `updateButtonStates()` in `ui.js` | Remove `canProceed` gating on `#nextBtn` / `#navSubmitBtn`. Save is always active. |
| Submit Study button | New UI element + handler | Add button in top menu bar. Inactive unless all days green. Tooltip lists incomplete days. On click → POST to `/api/.../submit` → redirect to thank-you. |
| Day buttons always enabled | `renderPreviousDaysSwitchRow()` | Remove min_coverage gate on switching. Any day can be clicked anytime. Auto-save before switch (already in `saveAndSwitchToDay()`). |
| Remove `SHOW_PREVIOUS_DAYS_BUTTONS` gate | `renderPreviousDaysSwitchRow()` | Always render day buttons when `studyDaysCount > 1`. Remove the settings check. |
| Template toggle | `init()`, `fetchActivities()`, template loading logic | Wrap template banner + template activity loading in `if (TUD_SETTINGS.TEMPLATE_ENABLED)`. When disabled, skip template data entirely. |
| Copy button always active | `addCopyDayLink()` in `ui.js` | Remove min_coverage gate. Copy button is always clickable. |
| Copy overwrite confirmation | `showCopyTargetPicker()` / `copyDayTo()` | If target day has data (DB or dirty) → show confirmation dialog before copying. If empty → copy immediately. |
| Right-click copy | Already partially implemented | Ensure right-click on day buttons opens the same target picker. Works on desktop only. |
| "Copy from..." button | New, gated by `SHOW_COPY_FROM_BUTTON` | If enabled, show button next to "Copy this day". Opens source-day picker. Calls `copyDayTo()` with reversed source/target. |
| Redirect check on page load | `init()` ~line 6063 | Check `study_submitted_at` from study config (not `participant_has_completed_study`). If submitted → redirect to thank-you. |
| Green/gray day button update | After save, after copy | Refresh `dayIndicesMeetMinCoverage` from backend response and re-render day buttons. |

### 3.2 `ui.js` — Changes

| Change | Description |
|---|---|
| `updateButtonStates()` | Remove `canProceed` gating. Always enable save button. Add Submit Study button state logic (disabled + tooltip when incomplete days exist). |
| `addCopyDayLink()` | Remove min_coverage gate. Always render active. |
| New: Submit Study button rendering | Add to top controls bar. Show green when all days complete, gray with tooltip otherwise. |

### 3.3 `utils.js` — Changes

| Change | Description |
|---|---|
| `sendData()` | Remove any min_coverage client-side validation before sending (if any remains). |
| `handleDayNavigation()` | Remove auto-advance. Stay on current day. Remove `isLastDay` redirect. |
| `canFinishStudy()` | Either remove entirely or repurpose to check `study_submitted_at` from study config. |
| New: `submitStudy()` | POST to `/api/.../submit`, handle response, redirect to thank-you. |

### 3.4 `index.html` — Changes

- Add Submit Study button element in top controls bar.
- Add "Copy from..." button element (hidden by default, shown if `SHOW_COPY_FROM_BUTTON` is true).

### 3.5 Clean Row — No Changes Needed

The "Clean Row" button remains as-is. It's still useful for:
- Deleting unwanted template data (if template enabled)
- Removing a copied timeline the user doesn't need
- Starting fresh on any day

---

## 4. Settings Changes

### 4.1 `tud_settings.js`

```javascript
const TUD_SETTINGS = {
    // ... existing settings ...
    SHOW_PREVIOUS_DAYS_BUTTONS: true,  // REMOVE — no longer conditional
    TEMPLATE_ENABLED: true,             // NEW — enable/disable template feature
    SHOW_COPY_FROM_BUTTON: false,       // NEW — show "Copy from..." button (default off)
};
```

- `SHOW_PREVIOUS_DAYS_BUTTONS`: Removed. Day buttons are always shown when `studyDaysCount > 1`.
- `TEMPLATE_ENABLED`: Default `true`. When `false`, frontend ignores template data from backend.
- `SHOW_COPY_FROM_BUTTON`: Default `false`. When `true`, shows the reverse-direction copy button.

### 4.2 Dev/CI Settings Templates

Update counterpart settings files in:
- `dev_tools/ci/frontend_settings/`
- `dev_tools/docker/frontend_settings/`
- `dev_tools/local_minimal/frontend_settings/`
- `dev_tools/local_nginx/frontend_settings/`

Add the two new settings, remove `SHOW_PREVIOUS_DAYS_BUTTONS`.

---

## 5. Localization

### 5.1 New Strings Needed (all 7 locale files)

| Key | English Value | Notes |
|---|---|---|
| `submitStudy` | "Submit Study" | Top menu bar button label |
| `submitStudyDisabled` | "Complete all days before submitting" | Tooltip when disabled |
| `submitStudyIncomplete` | "Incomplete days: {{days}}" | Tooltip listing incomplete days |
| `submitStudySuccess` | "Study submitted successfully!" | Toast message |
| `copyOverwriteConfirm` | "{{day}} already has data. Overwrite it?" | Confirmation dialog |
| `copyOverwriteTitle` | "Overwrite Day?" | Dialog title |
| `copyOverwriteYes` | "Overwrite" | Confirm button |
| `copyOverwriteNo` | "Cancel" | Cancel button |
| `copyFromDay` | "Copy from another day" | "Copy from..." button label |
| `copyDayEmpty` | "(empty)" | Indicator in copy target picker |
| `copyDayHasData` | "(has data)" | Indicator in copy target picker |
| `dayIncomplete` | "Day incomplete" | Aria label for gray day button |
| `studySubmittedBanner` | "Diary submitted on {{date}}" | Optional banner on thank-you page |

### 5.2 Strings to Remove/Repurpose

| Key | Action |
|---|---|
| `finishStudy` ("Submit Day and Finish Study") | Remove — replaced by separate Submit Study button |
| `goBackToEditPreviousDays` ("Switch to day:") | Keep — still used for day buttons |

### 5.3 Locale Files to Update

- `frontend/src/locales/en.json`
- `frontend/src/locales/de.json`
- `frontend/src/locales/sv.json`
- `frontend/src/locales/es.json`
- `frontend/src/locales/fi.json`
- `frontend/src/locales/fr.json`
- `frontend/src/locales/pl.json`

---

## 6. Admin Portal Changes

### 6.1 Participant List / Study Config Response

The admin portal (Jinja templates in `backend/src/o_timeuediary_backend/templates/`) currently shows:
- `has_completed_study` (derived from day coverage)
- `activity_count`

**Changes**:
- Replace `has_completed_study` with two separate indicators:
  - `all_days_meet_min_coverage: bool` — derived from `_get_days_meeting_min_coverage()`
  - `study_submitted_at: Optional[str]` — the timestamp from `StudyParticipant`
- Update the admin template to display both. Example display:

  | State | Display |
  |---|---|
  | Days incomplete | "In progress (2 of 5 days complete)" |
  | All days complete, not submitted | "✓ All days complete — not yet submitted" |
  | Submitted | "✓ Submitted on 2026-08-10" |

### 6.2 Admin Reset (Future)

Consider adding an admin action to clear `study_submitted_at` (reset submission). This can be deferred — a manual DB query suffices for now. File a follow-up issue.

### 6.3 Data Export — New Completion Fields

**File**: `api.py`, `GET /api/admin/export/{study_name_short}/activities`

The activities export endpoint is the primary way scientists download study data (CSV/JSON). After Copy Days, the export must reflect the new completion model.

**Current export fields** (from `_build_participant_completion_map`):
- `participant_diary_completed_at` — derived from MAX(MIN(created_at) per day-label), i.e. "when did they first have data on all days"
- `participant_everything_completed_at` — diary + external tasks all confirmed
- `participant_task_{key}_completed_at` — per external task

**New fields to add**:

| Field | Type | Description |
|---|---|---|
| `participant_study_submitted_at` | `datetime \| null` | Explicit submission timestamp from `StudyParticipant.study_submitted_at`. This is the new authoritative "study complete" signal. NULL until the participant clicks "Submit Study". |
| `participant_all_days_meet_min_coverage` | `bool` | Whether ALL days meet their timeline min_coverage requirements. Derived from `_get_days_meeting_min_coverage()`. This tells scientists the data quality is sufficient per-study-config, regardless of whether the participant clicked submit. |
| `participant_days_with_data` | `int` | Count of days that have ANY activity data. From `_get_completed_day_indices()`. |
| `participant_days_meeting_min_coverage` | `int` | Count of days meeting min_coverage. |
| `participant_total_days` | `int` | Total days in the study (`study_days_count`). |
| **Per-day status columns** | | See below. |

**Per-day status columns** (one column per day, e.g. `day_0_status`, `day_1_status`, ...):

Each column value is one of:
- `"complete"` — day has data AND meets min_coverage for all timelines
- `"partial"` — day has data but does NOT meet min_coverage for at least one timeline
- `"empty"` — day has no data at all

This per-day breakdown allows scientists to:
- Judge data quality at a glance without computing coverage themselves
- Decide whether to include a participant who has, say, 4 of 5 days complete but never submitted
- Identify which specific days are problematic

**Implementation approach**:
- Reuse `_get_completed_day_indices()` and `_get_days_meeting_min_coverage()` — both already exist.
- In `_build_participant_completion_map()`, add the new fields alongside the existing `diary_completed_at` / `everything_completed_at`.
- In the export loop (~line 7068), add the per-participant fields to each activity record (they'll be repeated per row — same value for all rows of the same participant — which is fine for CSV analysis via GROUP BY / pivot).
- The `participant_diary_completed_at` field can remain for backward compatibility, but `participant_study_submitted_at` is the new source of truth for "this participant is done."

**Example CSV output** (new columns only):

```csv
participant_id,...,participant_study_submitted_at,participant_all_days_meet_min_coverage,participant_days_with_data,participant_days_meeting_min_coverage,participant_total_days,day_0_status,day_1_status,day_2_status
abc123,...,2026-08-10T14:30:00,true,3,3,3,complete,complete,complete
def456,...,,false,3,2,3,complete,partial,complete
ghi789,...,,false,1,0,3,partial,empty,empty
```

- `abc123`: submitted, all days done.
- `def456`: filled all 3 days but day 1 didn't meet min_coverage, never submitted (scientist can decide whether to use).
- `ghi789`: barely started, only day 0 has partial data.

---

## 7. Tests

### 7.1 Backend Unit Tests

| File | Action |
|---|---|
| `test_submit_min_coverage_validation.py` | Update: min_coverage validation removed from save endpoint. Tests should verify partial saves are accepted. Add tests for submit-study endpoint validation. |
| New: `test_submit_study_endpoint.py` | Tests for `POST .../submit`: success, idempotency, rejection when days incomplete, rejection for unknown study/participant. |

### 7.2 Backend Integration Tests

| File | Action |
|---|---|
| `test_min_coverage_validation.py` | Update: save endpoint no longer rejects partial coverage. Test that partial data is stored successfully. |
| `test_day_min_coverage_completion.py` | Update: `participant_has_completed_study` now based on `study_submitted_at`, not day coverage. |
| `test_template_activities_endpoint.py` | No changes (template logic unchanged in backend). |
| New: `test_copy_day_overwrite.py` | Test copy endpoint with non-empty target (overwrite behavior). |
| New: `test_submit_study_integration.py` | End-to-end submit study flow: create data for all days, submit, verify timestamp, verify subsequent visits redirect. |

### 7.3 Frontend E2E Tests

| File | Action |
|---|---|
| `day_switch_disabled_when_min_coverage_not_met.spec.js` | **Rewrite**: day switch is always enabled. Test switching with partial data. |
| `add_activities_and_verify_template.spec.js` | Update: template still works when `TEMPLATE_ENABLED=true`. Add test for `TEMPLATE_ENABLED=false`. |
| `add_activities_and_verify_template_mobile.spec.js` | Same as above. |
| `activity_types_template_propagation.spec.js` | Update for new template toggle behavior. |
| `day_switch_enabled_with_template_activities.spec.js` | Update: day switch always enabled. Test template loading on switch. |
| `templates_keep_both_timelines_two_days.spec.js` | Update for configurable template behavior. |
| `day2_template_timeline_separation.spec.js` | Same. |
| `delete_replace_template_propagation.spec.js` | Same. |
| `copy_day_current_day_saves_then_copies.spec.js` | Update: no min_coverage gate. Test copy with partial data, overwrite confirmation. |
| `copy_day_excludes_current_day.spec.js` | Update: may need to test overwrite scenario with current day as target. |
| `cannot_complete_with_missing_days.spec.js` | **Rewrite**: test that Submit Study is disabled when days incomplete, enabled when all green. |
| `completed_participant_redirect.spec.js` | Update: redirect based on `study_submitted_at`, not day coverage. |
| `save_day_preserves_switch_buttons.spec.js` | Update: no auto-advance, day buttons always visible. |
| `min_coverage_delete_disables_submit.spec.js` | Update: save always available. Test that delete reduces coverage but save still works. |
| `min_coverage_backend_used.spec.js` | Update or remove: backend no longer rejects on min_coverage. |
| `submit_retry_after_failed_request.spec.js` | May need minor updates for new save behavior. |
| New: `submit_study_button.spec.js` | Test submit study button: disabled state, tooltip, click → redirect. |
| New: `copy_day_overwrite.spec.js` | Test copy to populated day: confirmation dialog, overwrite behavior. |
| New: `copy_from_button.spec.js` | Test "Copy from..." button when enabled. |
| New: `free_day_navigation.spec.js` | Test switching between days, auto-save on switch, green/gray indicators. |

---

## 8. Implementation Order

Recommended sequence to minimize broken intermediate states:

1. **Database migration** — Add `study_submitted_at` column (safe, additive, no behavior change yet).
2. **Backend: remove min_coverage block on save** — Allows partial saves.
3. **Backend: modify copy endpoint for overwrite** — Enables overwrite copies.
4. **Backend: add submit-study endpoint** — New API, no frontend consumer yet.
5. **Backend: switch completion logic to `study_submitted_at`** — Changes `participant_has_completed_study` semantics.
6. **Frontend: save always available, no auto-advance** — Core flow change.
7. **Frontend: day buttons always enabled, free navigation** — Unlocks free switching.
8. **Frontend: copy button always active, overwrite confirmation** — Core copy feature.
9. **Frontend: submit study button** — New UI element.
10. **Frontend: template toggle** — Configurable template.
11. **Frontend: "Copy from..." button (configurable)** — Optional reverse copy.
12. **Settings: update `tud_settings.js` and all CI/local templates**.
13. **Localization: add new strings to all 7 locale files**.
14. **Admin portal: update completion display**.
14.5. **Data export: add new completion fields and per-day status columns** — Updates `_build_participant_completion_map()` and the export loop.
15. **Tests: update existing, add new** — Run after all changes are stable.
16. **Remove `SHOW_PREVIOUS_DAYS_BUTTONS`** — Cleanup after full migration.

---

## 9. Files Summary

| Area | Files Changed | Files Added |
|---|---|---|
| Database | `models.py` | 1 Alembic migration |
| Backend API | `api.py` (~6 touch points, including export endpoint) | — |
| Frontend JS | `script.js`, `ui.js`, `utils.js` | — |
| Frontend HTML | `index.html` | — |
| Settings | `tud_settings.js` + 4 CI/local copies | — |
| Locales | 7 JSON files | — |
| Admin | Jinja template(s) in `templates/` | — |
| Data Export | `_build_participant_completion_map()` + export loop in `api.py` | — |
| Backend tests | 3–4 files updated, including export tests | 2–3 new files |
| E2E tests | ~13 files updated | 4 new files |
