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

## 3. Next — collapse the day row into a title picker (mobile only)

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

## 4. Next — mobile overflow menu (`⋮`)

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

## 5. Next — long-press opens the context menu

- `initDesktopActivityContextMenu()` currently starts with
  `if (getIsMobile()) { hideMenu(); return; }` — remove that and open the same
  menu (**Copy / Show info / Delete**) on long-press.
- `initMobileDelete()` currently **deletes immediately after a 1200 ms hold**
  (and its handler is not gated on `getIsMobile()`, so desktop pointer events
  arm it too). Replace the destructive hold with "open the menu".
- Then `#removeLastBtn` becomes redundant: its only unique value is a fast undo,
  which an "Activity removed — Undo" toast does better. `#cleanRowBtn` is
  destructive but *per-timeline* (not per-day), so it belongs in the same
  timeline-scoped menu.
- Must be done together: the instruction banner text ("long-press it on mobile")
  and `pages/instructions.html` step 4 both describe the current buttons.

## Known landmine (not scheduled)

`initMobileSwipeNavigation()` (mobile only): a **left** swipe clicks `#nextBtn`,
which since Copy Days is **Save Day** — so an accidental horizontal swipe saves
the day and triggers a 1.5 s `location.reload()`. It does not check whether an
activity is being dragged, and a fast horizontal drag looks exactly like a
swipe. A right swipe now clicks the switcher. Either guard it against
drag/resize or drop the gesture.

---

## Facts worth not re-deriving

- Breakpoint: `globals.js getIsMobile()` is `innerWidth < 1440`, which matches
  the CSS `max-width: 1439.98px` exactly; desktop is `min-width: 1440px`.
  Crossing it reloads the page.
- Measured at 408×900 (`default` study, 7 days, 2 timelines): `.header-section`
  212 px (`.controls` 76 px / 2 rows, `#previousDaysSwitchRow` 76 px / 2 rows,
  `.timeline-header` 28 px), `.timeline-canvas` 625 px.
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
`return_url_continue_link`, `submit_retry_after_failed_request`.

Expected to need adapting after steps 3–5 (deliberately deferred):

- `mobile_layout.spec.js` — tap-target list
- `copy_days_flow.spec.js` — asserts `#previousDaysSwitchRow .previous-day-btn`
- `e2e_helpers.js` — `switchToDay`, `getDayButtonCount`, `isDayButtonGreen`
- nothing references `#backBtn` or "Previous timeline" any more (checked)

There is **no mobile test that both timelines can be filled** — that gap is what
let the reachability bug live; worth adding with the day-picker work.

## Running things locally

```sh
./run_dev_nginx_both.bash            # nginx :3000 + backend :8000 (keep it running)
# diary: http://localhost:3000/report/index.html?study_name=default&lang=en

sh test_frontend_typecheck.sh
sh test_frontend_unit.sh
cd frontend && npx playwright test --project=chromium tests/e2e/<spec>.spec.js
```
