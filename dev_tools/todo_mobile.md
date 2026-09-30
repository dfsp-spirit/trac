# Mobile screen space — plan and progress

Goal: cut the amount of chrome above the timeline on phones. A Fairphone 5
(≈ 408×900 CSS px) currently spends ~24 % of the screen on the sticky header
before a single timeline pixel is visible, and the secondary timeline used to be
unreachable there.

**Desktop must stay as-is** unless a change is explicitly listed as applying to
both — that was the working rule for every step below.

Progress lives on branch `develop`:

| Commit | What |
| --- | --- |
| `961607d` | CHG: remove duplicate submit day button in footer |
| `0e058a1` | WIP: add timeline switcher on mobile |
| `13b378e` | CHG: also replace previous timeline button with timeline switcher on desktop |

---

## Verified current state (2026-09-30)

Branch `develop`, clean tree at `b19f15e`. Measured live at 408×900
(`default` study, 7 days, 2 timelines, nginx on :3000):

| Element | Measured now | Earlier note |
| --- | --- | --- |
| `.header-section` (sticky) | **235 px** | 212 px |
| ↳ `.controls` | **99 px / 3 rows** | 76 px / 2 rows |
| ↳ `#previousDaysSwitchRow` | 76 px / 2 rows | unchanged |
| ↳ `.timeline-header` | 28 px | unchanged |
| `.instruction-banner` | 124 px (day 1, dismissible, persisted per study+pid) | — |
| `.timeline-canvas` | 602 px | 625 px |

The third toolbar row is the language `<select>` that
`ensureLanguageSelector()` injects plus yesterday's timeline switcher. And
`.header-section` is `position: sticky` at *every* width: the toolbar **and** the
day row never leave the screen while the timeline scrolls.

Nothing from §4–§6 has been started; §1–§3 are confirmed in the live page and in
chromium E2E runs.

---

## Agreed direction (2026-09-30)

Working rule: **desktop stays as-is**, except the label/id renames (decision 4),
which are deliberate and apply everywhere.

### Scope model — one home per scope

The primary action of a scope stays visible; secondary, destructive and
administrative actions move into that scope's own menu. Two things are never
hidden: the study's goal (Submit Study) and the *existence* of a second timeline
(the §2 reachability bug must not come back).

| Scope | Actions | Placement on mobile |
| --- | --- | --- |
| Study | Submit Study, Skip time reporting, Language | Submit **visible**; Skip + Language in the `⋮` menu |
| Day | Switch day, Save Day, Copy this day | Day control (`‹ Monday ▾ · Day 1 of 7 ›`) + Save Day visible; Copy inside the day sheet |
| Timeline | Switch timeline, Clear timeline | Named in the context row; both actions in the timeline sheet |
| Activity | pick, delete, remove last | `+` stays floating; long-press menu; "Remove last" becomes an Undo toast |

Target mobile header (~80 px instead of 235 px, so the timeline grows
602 → ~812 px; the 63 px footer reservation is reclaimed by moving Skip into the
menu):

```
‹  Monday ▾ · Day 1 of 7      Primary ▾     context row  ~36px
[ Save Day ] [ Submit Study ] [ ⋮ ]         action row   ~40px
```

### Decisions

1. Context row = day picker **and** timeline picker in one row (two sheet triggers).
2. Quick day stepping: `‹` `›` arrows next to the day name.
3. Language picker: on mobile into the `⋮` menu. Desktop styling is a later,
   separate discussion.
4. "Clean Row" is renamed **everywhere**, desktop included — the confirmation
   modal already says "Clear current timeline row?", and the mobile layout is a
   column, not a row.
5. Order: (a) remove the swipe gesture, (b) long-press → context menu, (c) context
   and action rows + sheets + `⋮`, (d) Undo toast. Both (c)'s menu and (d) depend
   on (b) landing first.

### i18n

- Renames touch all 7 locales (`de, en, es, fi, fr, pl, sv`):
  `locales_consistency.test.js` requires identical key sets.
- `buttons.cleanRow` → "Clear timeline" (plus `messages.cleanRowHelp`). German
  "Zeitleiste leeren" and the Finnish/Polish forms are long — fine on a
  full-width sheet row, not in a toolbar chip.
- `buttons.switchTimeline` is only a fallback label: the visible switcher text is
  the *destination timeline name* from the study config (155 px measured for
  "Secondary Activity"). That is why it moves out of the action row.
- New keys for the `⋮` menu and the sheets must be added to all 7 files.

### Instruction banner (noted, not scheduled)

`banner.dayOneInstructions` is one string for all widths and tells mobile users
about the 1200 ms long-press that decision 5 removes. It needs a **mobile and a
desktop variant** (two keys, or two spans toggled in CSS) — and once split, both
can be much shorter than today's three-sentence block (124 px = 14 % of a 900 px
phone screen on day 1). New keys → all 7 locales.

### Id hygiene (so the next rename does not touch tests)

- `#nextBtn` → `#saveDayBtn`: the id is actively misleading now (it *is* Save Day).
  3 test references plus `e2e_helpers.saveCurrentDay()`.
- `#cleanRowBtn` → `#clearTimelineBtn` (no test references today).
- Keep `#currentDayDisplay` (11 test references) as the day picker's trigger id,
  and keep `#skipReportingBtn`, `#submitStudyBtn`, `#removeLastBtn`.
- `#previousDaysSwitchRow` (7 references) only moves together with
  `switchToDay` / `isDayButtonGreen` / `getDayButtonCount` in `e2e_helpers.js`.
- Tests select by id, never by visible label.

---

## 1. Done — duplicate "Save Day" in the footer (`961607d`)

- `#navSubmitBtn` deleted; both it and `#nextBtn` called the same
  `handleNextButtonAction()`, and the toolbar button is the one users reach.
- The footer (`#instructionsFooter`) now starts `hidden` in the markup and
  `ui.js:updateFooterVisibility()` only reveals it while `#skipReportingBtn` is
  visible — so studies with `allow_skip_timeuse: false` (all `adult_pilot_*`)
  lose the whole empty row.
- `autoscroll.js` guards `footer.offsetHeight > 0` before using the footer as a
  scroll limit (a hidden footer reports an all-zero rect ⇒ limit 0 ⇒ downward
  autoscroll silently dead).
- Gotcha found here: `hidden` does **not** hide a `.btn`, because the author
  rule `.btn { display: flex }` outranks the UA `[hidden] { display: none }`.
  Added `.btn[hidden] { display: none !important }`.

## 2. Done — timeline switcher (`0e058a1`, `13b378e`)

**The bug this fixed:** below 1440 px the diary renders only the *active*
timeline — a later `@media (max-width: 1439.98px)` block ("Mobile vertical
layout") overrides the earlier horizontally-scrollable rules with
`.past-initialized-timelines-wrapper { display: none !important }` and
`.timeline-container[data-active='false'] { display: none !important }`, and the
wrapper is `overflow-x: hidden`. The old one-way `#backBtn` was `disabled`
whenever `currentIndex <= 0`, and `init()` deliberately parks on index 0 — so
phone/tablet/small-window users could never reach the secondary timeline. It
failed *silently*: `secondary` has `min_coverage: 0`, so there is no submit
error, just permanently missing data.

Now: `#switchTimelineBtn` cycles `keys[(currentIndex + 1) % keys.length]` via
the existing `navigateToTimelineByKey()` (now exported from `script.js`; reuses
the proven forward `addNextTimeline()`/`restoreNextTimeline()` and backward
`goToPreviousTimeline()` paths). It is **never disabled**, and its label is the
*destination* timeline's name ("Secondary Activity"), so the button itself is
the hint that a second timeline exists.

Desktop question, decided as option "B": use the same switcher at both
breakpoints and delete `#backBtn`. Measured on desktop 1600×900: both timeline
containers are visible in a 298 px pane that does not scroll (horizontal 80 px
bars 138 px apart), so the old button was redundant *and* dead on arrival
(`disabled` at index 0 on every page load) *and* asymmetric. Removing it also
deleted `handleBackButtonAction()`, its debounce state, four
`backButton.disabled` blocks in `script.js`, `.back-btn` CSS, the mobile
`#backBtn` hide rule and `buttons.previousTimeline` from 7 locales (net −86
lines).

---

## 3. Done — swipe removed, long-press opens the context menu (2026-09-30)

Not yet committed; working tree on `develop`. Net −46 lines in `script.js`.

- `initMobileSwipeNavigation()` **deleted** (not guarded). It was the only
  control that could silently save a day: a left swipe clicked `#nextBtn`
  (= Save Day) and then reloaded the page 1.5 s later, and it never checked
  whether an activity was being dragged — a fast horizontal drag looks exactly
  like a swipe. A right swipe clicked the timeline switcher.
- `initMobileDelete()` → **`initMobileLongPressMenu()`**: now gated on
  `getIsMobile()` (before, its document-level `pointerdown` listener armed on
  desktop too, so a motionless 1.2 s mouse press deleted an activity), hold
  shortened **1200 ms → 500 ms**, and it opens the shared context menu instead
  of deleting. Deletion is now one explicit choice inside the menu.
- `initDesktopActivityContextMenu()` → **`initActivityContextMenu()`**; the
  `if (getIsMobile()) { hideMenu(); return; }` early-return is gone, so
  Android's native long-press `contextmenu` opens the same menu. `showMenu` is
  exposed as `window.showActivityContextMenu` for the mobile timer (iOS does not
  emit `contextmenu` for arbitrary elements, hence the own timer).
- CSS: `.long-press-delete-armed` / `.long-press-delete-indicator` →
  `.long-press-armed` / `.long-press-indicator`, red `--danger-color` →
  `--primary-color` — the ring no longer means "about to delete".
- Banner text: only **`en`** needed fixing. `de/es/fi/fr/pl/sv` already said
  "hold it on mobile or use the right-click menu on desktop"; the "long-press for
  2 seconds" and the explicit `d`/DEL hint existed in English only. Dropped
  "2 seconds", added "then choose Delete", kept the `d`/DEL hint.
  (`pages/instructions.html` step 2 was already correct.)
- New spec `frontend/tests/e2e/mobile_activity_gestures.spec.js` (3 tests):
  a plain tap stays inert, a long press opens the menu **without** deleting,
  menu Delete removes the activity, and a horizontal drag neither saves
  (no POST to `/activities`) nor navigates (marker survives ⇒ no reload).
- Verified live at 408×900 and on chromium: 18/18 in the
  context-menu/mobile/drag/keyboard subset, plus `frequency_activity_flows_mobile`
  and `ensure_switching_desktop_mobile_keeps_activities_issue42`.
- Still open: `#removeLastBtn` and `#cleanRowBtn` are untouched — see §6.
## 4. Next — collapse the day row into a title picker (mobile only)

> Superseded by "Agreed direction" above; kept for the reasoning and the
> measurements.

Today: `#previousDaysSwitchRow` = "Switch to day:" label + one button per day.
7 days ⇒ 76 px ⇒ 2 rows, always visible; a 14-day study would be 3–4 rows. The
day is also printed twice on screen (the row and the `Monday (Day 1 of 7)`
title).

Plan:

- Hide `#previousDaysSwitchRow` below 1440 px; desktop keeps it untouched.
- Make the day title itself the switcher: `#currentDayDisplay` lives inside
  `.timeline-title` (`ui.js:updateCurrentDayDisplay()`), next to the
  "Copy this day" link. Tapping it opens a picker.
- Style/behave the picker like the existing `showCopyTargetPicker()`
  (`.copy-day-context-menu`) so there is one consistent "pick a day" UI, and
  keep the per-day completion state (green/gray, as
  `.previous-day-btn.day-complete` shows it today).
- Selecting a day calls `saveAndSwitchToDay(dayIndex)` — it already auto-saves
  the current day first.
- i18n: reuse `messages.goBackToEditPreviousDays` ("Switch to day:") as the
  heading, or add a new key to all 7 locales (the unit test
  `locales_consistency.test.js` requires identical key sets everywhere).

Expected win: one whole row + its label (~76 px on a 408 px screen).

## 5. Next — mobile overflow menu (`⋮`)

> Superseded by "Agreed direction" above, except the Submit Study question,
> which is settled: Submit stays **visible** (its grey→green transition is the
> study's progress meter; hiding it makes "I saved all my days" look like the
> finish line).

Target toolbar on mobile: `[⇄ <other timeline>] [Save day] [⋮]`.

Cheapest implementation: keep the existing buttons in the DOM, hide the
secondary ones on mobile via CSS, and let the `⋮` menu **proxy `.click()`** to
them (`#cleanRowBtn`, `#removeLastBtn`, `#submitStudyBtn`,
`#skipReportingBtn`), mirroring their `disabled` state. That reuses the tested
handlers and keeps desktop byte-identical (hidden elements still receive
`.click()`; a disabled one does nothing).

Open decision: `Submit Study` — keep it in the menu always (disabled with the
existing incomplete-days tooltip) and additionally show it as a prominent green
button when all days are complete, or only render it in the menu. Leaning to
"appears in the toolbar when it becomes actionable".

## 6. Next — Remove Last becomes an Undo toast, Clear timeline moves into its menu

> The long-press half of this landed in §3. What is left:

- `#removeLastBtn` is now redundant: its only unique value is a fast undo, which
  an "Activity removed — Undo" toast does better.
- `#cleanRowBtn` is destructive but *per-timeline* (not per-day), so it belongs
  in the timeline-scoped menu ("Clear this timeline"), together with the
  timeline switcher.
- Instruction banner and `pages/instructions.html` step 2 were updated in §3 and
  describe the menu now; revisit them when these two buttons move.

## Known landmine — done in §3 (the gesture was removed)

`initMobileSwipeNavigation()` (mobile only): a **left** swipe clicks `#nextBtn`,
which since Copy Days is **Save Day** — so an accidental horizontal swipe saves
the day and triggers a 1.5 s `location.reload()`. It does not check whether an
activity is being dragged, and a fast horizontal drag looks exactly like a
swipe. A right swipe now clicks the switcher.

Decided 2026-09-30: **not just guarded — the gesture goes.** With the timeline
switcher, the day control and the day sheet there is nothing left for it to do,
and it is the only control that can silently save a day mid-drag. **Removed in
§3.**

---

## Deferred — autosave instead of "Save Day" (decided 2026-09-30)

Question: save after every action, so the reloads and the Save button disappear?
Answer: **not now, and not as a prerequisite for the mobile work.**

- It needs **no order tracking**: `createTimelineJSON()` serialises every
  timeline of the current day, and the endpoint deletes all rows for
  (study, participant, day_label) before re-inserting — every save is an
  idempotent full-day snapshot, so last-write-wins is already correct.
- There is **no audit trail to preserve**: `Activity` has `created_at` only (no
  `updated_at`, no version), and delete+insert means `created_at` already reads
  as "when this day was last saved".
- **Half of it already exists locally**: `draft_storage.js` keeps the in-progress
  day in sessionStorage + localStorage, and `sendData()` clears it on success.

What it would really need, by risk: a save queue (never two in-flight saves for
one day — overlapping delete/insert can duplicate or blank rows); a visible sync
state (`Saving… / Saved / Not saved — retry`), because silent autosave failure is
worse than a failed explicit save; day-completion flags from the save response
instead of the reload; `markDaySaved()` fed by autosave instead of the button;
and a **policy decision** on whether every glance writes real DB rows (draft vs.
final day) — the only genuinely expensive part.

**Contained subset, worth its own step:** drop the `location.reload()` in
`handleNextButtonAction()` (Save Day saves *and* reloads while staying on the same
day) and refresh the local flags through `updateButtonStates()`. Removes one of
the two reloads per day with no backend change; `e2e_helpers.saveCurrentDay()` is
written around that reload and gets faster once adjusted.

**Coupling rule for the UI work:** the day sheet reuses `saveAndSwitchToDay()`, so
if autosave lands later the sheet just loses its save step. Add no new reloads.

---

## Facts worth not re-deriving

- Breakpoint: `globals.js getIsMobile()` is `innerWidth < 1440`, which matches
  the CSS `max-width: 1439.98px` exactly; desktop is `min-width: 1440px`.
  Crossing it reloads the page.
- Measured at 408×900 (`default` study, 7 days, 2 timelines) — re-measured
  2026-09-30, see "Verified current state" above: `.header-section` 235 px
  (`.controls` 99 px / 3 rows, `#previousDaysSwitchRow` 76 px / 2 rows,
  `.timeline-header` 28 px), `.timeline-canvas` 602 px. The earlier numbers
  (212 / 76 / 2 rows / 625) predate the timeline switcher.
- `styles.css` has **two** `@media (max-width: 1439.98px)` blocks; the second
  one ("Mobile vertical layout", ~line 700) is the one that decides timeline
  visibility and wins over the first.
- On mobile the activity picker is the floating `+` button → `#activitiesModal`;
  the inline `.activities-container` is 0×0 there. In tests use
  `findTimelinePoint()` for tap coordinates and `hasTouch: true` for `.tap()`.
- `updateButtonStates()` (ui.js) is the single chokepoint called on every
  activity mutation — the right place to refresh any new control's state.

## Test status / debt

Green at the time of writing: `sh test_frontend_typecheck.sh`,
`sh test_frontend_unit.sh` (62/62), and on chromium: `copy_days_flow`,
`ensure_switching_desktop_mobile_keeps_activities_issue42`,
`drag_move_activity_block`, `mobile_layout`, `accessibility`,
`keyboard_accessibility`, `draft_restore`, `min_coverage_backend_used`,
`no_broken_static_requests`, `study_footer_links`,
`adult_pilot_skip_button_visibility`, `instructions_skip_to_thankyou`,
`return_url_continue_link`, `submit_retry_after_failed_request`,
`mobile_activity_gestures` (new in §3).

Expected to need adapting after steps 4–6 (deliberately deferred):

- `copy_days_flow.spec.js` runs at 1600×900, so it is unaffected by mobile-only
  hiding; it is the only spec using `switchToDay` / `isDayButtonGreen` /
  `getDayButtonCount`. `mobile_layout.spec.js` only measures `#nextBtn` and
  `#skipReportingBtn`. `cleanRowBtn` and `switchTimelineBtn` have no test
  references.
- `e2e_helpers.js` — `switchToDay`, `getDayButtonCount`, `isDayButtonGreen`
- nothing references `#backBtn` or "Previous timeline" any more (checked)
- There is still **no mobile test that fills both timelines** — add it with the
  day-picker work (that gap is what let the §2 bug live).

## Running things locally

```sh
./run_dev_nginx_both.bash            # nginx :3000 + backend :8000 (keep it running)
# diary: http://localhost:3000/report/index.html?study_name=default&lang=en

sh test_frontend_typecheck.sh
sh test_frontend_unit.sh
cd frontend && npx playwright test --project=chromium tests/e2e/<spec>.spec.js
```
