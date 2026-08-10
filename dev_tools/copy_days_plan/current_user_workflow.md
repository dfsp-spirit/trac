

## TRAC -- user workflow to enter activities into a diary study

### Background on TRAC

TRAC has studies that span several days. Each day has one or more timelines, e.g., "primary activity timeline" and "secondary activity done in parallel timeline". Users place activity blocks with a start and end time on the timelines to document what they did during the day for time use research. The timelines may enforce that users fill in a certain amount of minutes (min_coverage), to prevent users from providing bad quality data.

---

### New workflow (Copy Days)

The new workflow is based on free navigation between days, with explicit copy and submit actions:

1. **Free day navigation**: Users see a row of day buttons at the top. Each button shows a green checkmark if that day's data meets min_coverage in the database ("green"), or stays gray if not. Clicking any day button switches to that day — this auto-saves the current day first (always possible, no min_coverage gate).

2. **Saving a day**: The "Save Day" button is always active, regardless of min_coverage or timeline. Saving stores data in the backend (which accepts partial data — no min_coverage rejection). After saving, the user stays on the same day (no auto-advance). The day button updates to green/gray based on whether the saved data now meets min_coverage.

3. **Template feature**: When navigating to a day that has no data yet, the backend offers template data from the previous day (if it exists). This is configurable via a frontend toggle (`TEMPLATE_ENABLED`). When enabled, template data pre-fills the day as a starting point. Users can edit, delete, or clean the row. When disabled, days start empty and users rely on manual copy.

4. **Copy this day**: A "Copy this day" button on each day allows copying that day's activities to another day. The target picker shows which days are empty vs. have data. If the target day is empty → copy immediately. If the target day has data (in DB or unsaved/dirty) → confirmation dialog: "Day X already has data. Overwrite it?" Copying saves the current day first (if it's the source), then copies via the backend.

5. **Right-click copy** (desktop): Right-clicking a day button opens the same target picker, copying that day's data to the selected target.

6. **"Copy from..." button** (configurable, off by default): A "Copy current day from..." button allows pulling data from a source day into the current day. Same overwrite confirmation rules apply.

7. **Submit Study**: A separate "Submit Study" button sits in the top menu bar. It is inactive (grayed out) unless ALL days are green (meet min_coverage in database). A tooltip lists incomplete days. When clicked:
   - The backend records `study_submitted_at` on the participant's study record.
   - The frontend redirects to the thank-you page.
   - On subsequent visits, the frontend checks `study_submitted_at` (not day coverage) to decide whether to show the thank-you page. Once submitted, the user cannot re-enter the diary.

8. **Study completion**: A participant is "complete" only after clicking "Submit Study". Before that, they can freely navigate, edit, save, and copy between days — even if all days meet min_coverage. The admin panel shows both "all days meet min_coverage" and "study submitted at" as separate status indicators.


### Old workflow (pre-Copy-Days, for historical reference)

* The old workflow was based on guiding users through the days of the study day after day
* Users open diary, they are on first study day. app checks for existing activities in db for user+study (to edit previous entries), loads if needed, but typically empty here. They enter data into first timeline, client checks min coverage, and allows moving to second one once it is met (if any min coverage on that timeline). Users repeats for next timeline(s). Users can go back to previous timelines and edit data if needed. Once all timelines are ready (min coverage met), a button to submit the day becomes active.
* when clicked, data gets stored in database. the database/backend checks prior to saving whether the data fulfills min coverage. the day gets advanced to next day. once more, frontend checks backend for data for that day. but now, on days with day_index > 0, there is a twist: if that day has no data yet in database (no returning user, first time filling out), the backend sends to the frontend template data that is copied from the activities they have saved in the database (from seconds ago most likely) and sends them as templates. they only live in frontend for now: the user can see them, edit them, etc. The template feature serves to speed up the data collection for the user, and is intended to reduce dropout in the scientific study. The user then saves the day, and things continue like this.
* On the last day, the button for submitting the day submits the day and sends the user on to the next page of the flow that does not collect activity data anymore (e.g., a Thank you page)


