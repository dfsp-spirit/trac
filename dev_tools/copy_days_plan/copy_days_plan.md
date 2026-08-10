
## New Feature Request -- Copy Days

Feature request: When entering activity data during the diary phase, users can copy the data from one day to another.

### Analysis

This seamingly small feature request is XXXL and basically means rewriting the entire frontend logic, as it turned out.

* What happens if we copy to a day that already has data? There may be conflicting data. Mewrging is complex and comes with various questions, like which data to keep in case of conflicting entries (current data on target day, or the data from source day being copied there). Should we disallow copying to days that have data?
* what if target day is current day, and there is data being edited in frontend that the backend doesnt even know about?
* to allow copying from current day, it needs to be in database. so copy day button must also first save current day.
* what if user creates some baseline activities and wants to copy to all other days, but they do not fullfil min coverage? copying is saving, and we check min coverage on save, so its not possible. we need to remove min coverage checks on save.
* note that the current day is ALWAYS dirty/has unsaved data  (except on first time filling out first day of study) due to template feature.
* For a user to copy the data from a day, they should be able to see the data of the source day, and most likely also that of the destination day before deciding to copy, as copying may mean overwriting. so we need a list of buttons to switch days.
* buttons to switch days means:
    - users cannot submit on last day: they may not yet have filled out all days
    - we can add separate buttons for submit day and submit study. but how do users know which days are incomplete and prevent the submit study button from becoming active? we need a visisual indicator on day bzuttons to say whether this day is complete.
* when users can switch between days freely, do we even auto-advance them to next day wehen they save? isnt this confusing?
* our template feature only makes sense when auto-advancing the days. when they switcvh freely, the previous day may not have data, and if they can copy anyways, why template.
* do we even need submit study button? this is complex: stakeholders said in the past that once users have completed study, they should NOT be allowed to edit data again. so we built into frontend that if user comes again (clicks invitation link again) even though he is done, they are send again to thankyou page. but this means: as soon as they save the last day of the study that was not complete, and now after save it is complete, the system detects they are done and forwards to thankyou page. but what if they still intended to edit something on one day before submitting? 2 options: first, we show a modal and ask them wehther to keep editing or submit study every time they save a day AND everything is complete. second option: we separate saving days from submitting study. we add separate submit study button, at top, active only is all days done. the FIRST time users click that button, we save in database they committed. we use this in the future, instead of the computationg whether all days are complete, to determine whether to send them to thankyou page.


### Conclusion

we need a completely new frontend flow for this:

* **template feature**: keep it, but make it configurable via a frontend/server-wide toggle (`TEMPLATE_ENABLED` in `tud_settings.js`, default `true`). When disabled, the frontend simply ignores template data from the backend. No backend changes needed for the toggle.
* **min coverage checks on save**: remove the hard block. Saving is always allowed. Day buttons at top show green/gray status based on min_coverage in database. The submit study button enforces completion as the final gate. No popup warnings on auto-save (day switch, copy) — the gray/green day button is the persistent indicator.
* change submit day button in 2 ways:
    - it should always be available / active, irrespective of min coverage or which timeline we are on
    - using it must NOT advance day to next day
* add list of days as buttons at top for free navigation (always shown when `studyDaysCount > 1`)
* indicate on buttons whether day is complete (min coverage met in database). we call this the day is "green".
* switching days also saves current day. always possible now because no min coverage check on save anymore.
* add copy current day button. button allows selecting target day. displays whether empty or not. If target day is empty → copy immediately. If target day has data in DB or dirty/unsaved state → show confirmation dialog "Day X already has data. Overwrite it?". Copy button saves current day first, and that is now always possible (irrespective of min coverage), so it must also always be available.
* **copy overwrite policy**: allowed. Backend copy endpoint must accept overwrites (delete existing target activities, then copy). Confirmation dialog shown when target day is not empty.
* button to submit study should be at the top in menu bar, inactive unless all days green (min coverage met in database). Tooltip on the disabled button lists which days are incomplete. First time user clicks it: backend records `study_submitted_at` timestamp. This flag replaces the current `participant_has_completed_study` computation for determining whether to redirect to thank-you page.
* add convenience feature on desktop: right-click day buttons to copy that day. also opens target day list, identical to copy current day button.
* **"Copy current day from..." button**: configurable via `SHOW_COPY_FROM_BUTTON` setting (default `false` for now). Allows selecting the SOURCE day. Will overwrite current day data (with confirmation if current day has data). Same underlying copy logic as the push-direction copy, only source/target parameters swap.
* remove `SHOW_PREVIOUS_DAYS_BUTTONS` setting — day buttons are now mandatory for the UX to work.


## Current implementation status

* buttons to switch days are already added (`renderPreviousDaysSwitchRow()` in `script.js`), gated by `SHOW_PREVIOUS_DAYS_BUTTONS` (currently `true`)
* you can currently only save when min coverage is met — both client-side (`updateButtonStates()` in `ui.js` disables save when coverage insufficient) and server-side (POST activities endpoint returns 400 if `_validate_timeline_min_coverage` fails)
* copy this day button (`addCopyDayLink()` in `ui.js`) is inactive unless min coverage is met
* min coverage is still enforced in backend on save (hard 400 rejection)
* submit study button is only on last day of study, if all others are ready (`canFinishStudy()` in `utils.js`). but it cannot be pressed, as the user gets auto-forwarded to next page as soon as they save the last day (`handleDayNavigation()` redirects to thank-you page)
* backend copy endpoint (`POST .../copy-from/{source_day}`) already exists but requires target day to be empty (409 Conflict if data exists) — needs modification to allow overwrite
* no `study_submitted_at` field exists yet on `StudyParticipant` — needs Alembic migration
* `participant_has_completed_study` is currently computed from day coverage (`_is_participant_study_complete()`) — needs to switch to `study_submitted_at IS NOT NULL`
