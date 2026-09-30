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

Nothing is left of the agreed design: §1–§7 are all implemented, verified in the
live page and covered by chromium E2E runs.

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
| Activity | pick, delete, remove last | `+` stays floating; long-press menu; "Remove last" became an Undo toast (§6) |

Target mobile header (~80 px instead of 235 px):

```
‹  Monday ▾ · Day 1 of 7      Primary ▾     context row  ~36px
[ Save Day ] [ Submit Study ] [ ⋮ ]         action row   ~40px
```

Measured progress after §4: 235 → **99 px** sticky header and the timeline
602 → **801 px** (+33 %). The timeline switcher button and the day row are gone
from phones; what is left is the context row (32 px: day picker + timeline
picker) and a one-row toolbar (40 px).

### Decisions

1. Context row = day picker **and** timeline picker in one row (two sheet triggers).
2. Quick day stepping: `‹` `›` arrows next to the day name.
3. Language picker: on mobile into the `⋮` menu. Desktop styling is a later,
   separate discussion.
4. **Done 2026-09-30** — "Clean Row" is renamed everywhere, desktop included. The
   confirmation modal used to say "Clear current timeline row?" and the mobile
   layout is a column, not a row, so the action is now **"Clear timeline"** in
   all 7 locales. The keys went with the labels: `buttons.cleanRow` →
   `buttons.clearTimeline`, `instructions.cleanRowHelp` →
   `instructions.clearTimelineHelp`, `modals.confirmCleanRow.*` →
   `modals.confirmClearTimeline.*`. The two template banners that quoted the
   button name were updated in every locale as well.
5. Order: (a) remove the swipe gesture, (b) long-press → context menu, (c) context
   and action rows + sheets + `⋮`, (d) Undo toast. Both (c)'s menu and (d) depend
   on (b) landing first.

### i18n

- Renames touch all 7 locales (`de, en, es, fi, fr, pl, sv`):
  `locales_consistency.test.js` requires identical key sets.
- `buttons.cleanRow` → `buttons.clearTimeline` (**done**: "Clear timeline",
  "Zeitleiste leeren", "Vaciar línea de tiempo", "Tyhjennä aikajana",
  "Effacer la chronologie", "Wyczyść oś czasu", "Rensa tidslinjen"). The long
  forms are fine on a full-width sheet row, but not in a toolbar chip.
- `buttons.switchTimeline` is only a fallback label: the visible switcher text is
  the *destination timeline name* from the study config (155 px measured for
  "Secondary Activity"). That is why it moves out of the action row.
- New keys for the `⋮` menu and the sheets must be added to all 7 files.

### Instruction banner — done, see §7

`banner.dayOneInstructions` is one string for all widths and tells mobile users
about the 1200 ms long-press that decision 5 removes. It needs a **mobile and a
desktop variant** (two keys, or two spans toggled in CSS) — and once split, both
can be much shorter than today's three-sentence block (124 px = 14 % of a 900 px
phone screen on day 1). New keys → all 7 locales.

### Id hygiene — done (2026-09-30)

- `#nextBtn` → `#saveDayBtn`, class `.next-btn` → `.save-day-btn`,
  `handleNextButtonAction()` → `handleSaveDayAction()`.
- `#cleanRowBtn` → `#clearTimelineBtn`, class `.clean-row-btn` →
  `.clear-timeline-btn`. The confirm dialog followed: `#clearTimelineConfirmModal`,
  `#clearTimelineConfirmModalTitle`, `#confirmClearTimelineOk` /
  `#confirmClearTimelineCancel`, and `performCleanRow()` →
  `performClearTimeline()`.
- Deleted as dead: the two `.next-btn:has(i.fa-check)` rules — nothing has put an
  `fa-check` icon in that button since it became Save Day.
- Deliberately unchanged: `#currentDayDisplay` (11 test references) stays the day
  picker's trigger id; `#skipReportingBtn`, `#submitStudyBtn` and `#removeLastBtn`
  keep their ids; `#previousDaysSwitchRow` (7 references) only moves together with
  the `e2e_helpers.js` day helpers.
- Tests updated to the new ids: `mobile_layout.spec.js` and
  `e2e_helpers.js` (`saveCurrentDay`). Tests select by id, never by visible label.
- Verified: typecheck, 62/62 unit tests (the locale key-set guard and
  "every requested key exists in every locale" cover the rename), 25/25 E2E on
  chromium, and live in en + de (diary toolbar, instructions page, confirm modal).

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
- Both leftovers were handled: ownership of `#clearTimelineBtn` moved to the
  timeline menu in this slice, and `#removeLastBtn` was removed in §6.
## 4. Done — phone context row: day picker + timeline picker (2026-09-30)

Not yet committed. What shipped:

- `#contextBar` (`.context-bar`) is inserted *before* `.controls`, so a phone
  reads context first, actions second. It is `display: none` from 1440 px up and
  below that the navigation it replaces is hidden: `#previousDaysSwitchRow` (no
  longer rendered on phones at all) and the cycling `#switchTimelineBtn`.
- Left: `‹  Wednesday (3/7)  ›` - two step buttons plus the day picker. The
  arrows name the day they lead to, the full "Wednesday (Day 3 of 7)" sentence
  stays the button's accessible name and tooltip, and only the compact counter is
  visible. `#currentDayDisplay` still exists - inside the context bar now, which
  is what the 11 specs waiting for it check.
- Right: `Main Activity ▾`, the current timeline (hidden when a study has only
  one).
- **Day menu** (`#dayMenu`): every day, with a `✓` when it meets min_coverage
  (same signal and palette as the desktop day buttons), the current day marked
  `aria-current` and disabled, plus "Copy this day" opening the existing copy
  picker. Selecting a day calls `window.saveAndSwitchToDay(index)`, which still
  auto-saves first.
- **Timeline menu** (`#timelineMenu`): one row per timeline with its coverage on
  a second line (reusing `messages.timelineCoverageMet/Missing`) and **Clear this
  timeline**, which moved here out of the ⋮ menu because it is per-timeline, not
  per-day.
- The four popups (copy picker, ⋮ menu, day menu, timeline menu) now share one
  look and one open/close path: `.context-menu` / `.context-menu-item` /
  `.context-menu-header` in CSS, `openContextMenu()` / `closeContextMenu()` /
  `addMenuItem()` in `ui.js`. The old `.copy-day-context-menu*` style rules are
  gone; the class names stay on the elements because specs locate them.
- Bug caught on the way: `updateCurrentDayDisplay()` still wrote the
  `?custom_page_title=` label through the *old* variable name after the container
  rename - a `ReferenceError` waiting for any study that passes that param, and
  invisible to `tsc` because `ui.js` is not `@ts-check`ed. Fixed; on phones that
  label now gets its own line in the context bar instead of vanishing with the
  title row.

Measured at 408×900 (`default` study):

| | Original | After §5 | After §4 |
| --- | --- | --- | --- |
| sticky `.header-section` | 235 px | 212 px | **99 px** |
| `.timeline-canvas` | 602 px | 688 px | **801 px** |

Desktop 1600×900 re-verified: context bar hidden, day row with 7 buttons,
switcher labelled "Secondary Activity", title row with "Copy this day", one-row
toolbar with all four extra buttons and no ⋮.

### Test changes for §4

- `e2e_helpers.js`: `switchToDay()` now works with either layout (day row or day
  menu), and the phone placement helper moved in as `placeActivityMobile()`
  (it was private to `mobile_activity_gestures.spec.js`).
- New `mobile_context_bar.spec.js`: the context bar replaces the day row and the
  timeline button; the day menu lists days/✓/current/copy; the timeline menu
  lists every timeline with coverage; and - closing the gap this whole bug class
  came from - **both timelines of a phone day can be filled and survive a save**.
- Three specs clicked `#skipReportingBtn` directly and therefore broke at the
  default 1280 px viewport, which is the *phone* layout: `instructions_skip_to_thankyou`,
  `return_url_continue_link`, `return_url_default_thankyou`. All three now use
  `openSkipConfirmation()`.
- Full suite 72/72 on chromium (`accessibility.spec.js` still cannot run locally:
  `@axe-core/playwright` is not installed).

### Original plan for §4 (kept for the reasoning)

Today: `#previousDaysSwitchRow` = "Switch to day:" label + one button per day.
7 days ⇒ 76 px ⇒ 2 rows, always visible; a 14-day study would be 3–4 rows. The
day is also printed twice on screen (the row and the `Monday (Day 1 of 7)`
title).

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
  heading; no new keys were needed in the end (the arrows name their target day,
  the day menu uses a ✓ glyph, and the timeline menu reuses the coverage keys).

Expected win: one whole row + its label (~76 px on a 408 px screen) — delivered
as 133 px total, together with the timeline switcher row.

## 5. Done — mobile overflow menu (`⋮`) (2026-09-30)

Not yet committed. `#moreMenuBtn` (icon-only, 36×32) sits at the end of the
`.controls` row, `display: none` from 1440 px up so desktop keeps every button.
Below 1440 px it appears and `#removeLastBtn`, `#clearTimelineBtn`,
`.language-select-wrapper` and `#skipReportingBtn` are hidden instead.

- Items: Clear timeline, Remove Last, Skip time reporting (only when the study
  allows it), then a **Language** group built from the options of
  `#languageSelectMain`. Each item **proxies `.click()`** to the real control and
  mirrors its `disabled` state (`refreshMoreMenuItems()`, called from
  `updateButtonStates()`), so every action keeps one implementation - including
  its confirmation dialog. The language items set the `<select>` and dispatch
  `change`, which is the same path the picker itself uses.
- Reuses the Copy Days popup look: the `.copy-day-context-menu*` rules were
  extended to also match `.more-menu*`, so both stay one bottom sheet on phones
  (48 px tall, full-width items).
- Behaviour: `aria-expanded` on the trigger, focus moves to the first *enabled*
  item, Escape / outside click / resize / scroll-away close it, and focus returns
  to the trigger. Scrolling *inside* the sheet does not close it.
- `updateFooterVisibility()` now checks `getComputedStyle(...).display` instead of
  the inline style, otherwise the CSS-hidden skip button would have kept the
  empty footer row alive. Hiding skip also collapses the footer as designed.
- `ensureLanguageSelector()` no longer writes inline styles on its wrapper (they
  would have beaten any stylesheet rule); the wrapper has a class now.

Measured at 408×900 (`default` study):

| | Before | After |
| --- | --- | --- |
| `.controls` | 99 px / 3 rows | **76 px / 2 rows** |
| `.header-section` | 235 px | **212 px** |
| `#instructionsFooter` | 63 px | **0** (skip moved into the menu) |
| `.timeline-canvas` | 602 px | **688 px** (+14 %) |

Desktop 1600×900 verified unchanged: `.controls` 48 px / 1 row, day row 40 px,
footer 81 px, and Remove Last / Clear timeline / Skip / Language all still
visible with `#moreMenuBtn` hidden.

**Two specs had to be adapted** - and they revealed something worth knowing:
Playwright's default project viewport is `devices['Desktop Chrome']` = 1280×720,
which is *below* this app's 1440 px breakpoint. Specs without an explicit
`test.use({ viewport })` therefore exercise the **mobile** layout.
`instructions_skip_to_thankyou` and `return_url_continue_link` clicked
`#skipReportingBtn` directly, so both now use the new shared helper
`openSkipConfirmation(page)` (e2e_helpers) that finds the action wherever it is
and retries until its handler is wired.

`mobile_layout.spec.js` gained "the secondary controls move into the ⋮ menu on a
phone" and its tap-target list now measures `#moreMenuBtn` instead of the hidden
skip button.

## 6. Done — Remove Last replaced by a delete undo toast (2026-09-30)

Not yet committed. `#removeLastBtn` is gone from the diary, from the ⋮ menu, from
"Helpful tools" on the instructions page and from all 7 locales
(`buttons.removeLast` → `buttons.undo`, `instructions.removeLastHelp` deleted,
`messages.activityRemoved` added).

- Deleting is one tap inside the activity menu, so the way back is a toast:
  `deleteActivityBlock()` remembers the removed row and its index and offers
  **"Activity removed — Undo"** for 6 s. `showToast(message, type, duration,
  action)` gained the optional action button (`.toast-action`; the toast itself
  is `pointer-events: none`, the button re-enables them).
- The inline re-render block in `deleteActivityBlock()` was extracted into
  `rerenderActivitiesInTimeline(timeline, timelineKey)`, so the undo path renders
  identically (and several hundred lines of debug logging went with it).
- Guarded by `mobile_activity_gestures.spec.js` ("deleting through the long-press
  menu offers a working undo"); `copy_days_flow.spec.js` now deletes through the
  right-click menu instead of the removed button.

For the record: the button was once *called* an undo, but it deleted the last
**placed** activity - not the same thing, and not what a toast undoes either. The
toast is a real undo of the deletion.

## 7. Done — instruction banner split by layout (2026-09-30)

Not yet committed. The day-one banner and the template-loaded banner each mixed
both platforms into one string ("...on mobile ... or on desktop ..."), which also
meant a phone was told to "click".

- **Day-one banner**: two keys, `banner.dayOneInstructionsMobile` /
  `...Desktop`, rendered as two `<span>`s in `index.html` and toggled purely by
  the 1439.98 px breakpoint in CSS (`.banner-text-mobile` / `.banner-text-desktop`)
  — no JS, and `applyTranslations()` covers both.
- **Template banner** (days 2–7, the one participants see most):
  `messages.templateLoadedBannerMobile` / `...Desktop`, chosen in
  `showTemplateBanner()` by `getIsMobile()` at render time (crossing the
  breakpoint reloads the page anyway).
- Wording decisions: full sentences instead of the old telegraphic style (that is
  what made translations drift); **no colour** ("the + button in the bottom right
  corner", matching `instructions.vertical`); "tap" on phones and "click" on
  desktop; "drag its edges" instead of "drag borders"; deletion is always "then
  choose Delete", since it opens a menu (§3).
- **No keyboard-shortcut mentions in any banner** — deliberately dropped; the
  `d`/DEL hint predates the context menu and serves a minority.
- The undo toast is not advertised in the banner either; it announces itself.
- Measured: mobile 124 px (en) / 164 px (de) — the same as the old mixed string,
  so no day-1 regression — and 54 px (one line) on desktop.
- `locales_consistency.test.js`'s required-keys list now names the four new keys.
- Guarded by `mobile_layout.spec.js` ("the day-one banner explains the layout the
  participant is in").

Still platform-mixed by design, because they are study/admin content rather than
UI chrome: `messages.instructionsDefault` and `messages.templateCopiedBanner`.

## 8. Bug fix — the activity menu was invisible below 1440 px (2026-09-30)

Reported by the user: "I long-press with the mouse, the blue circle animation
plays after a delay, but in the end nothing happens (no menu)".

Root cause: the whole `.activity-context-menu` / `.activity-context-menu-item`
rule set lived **inside `@media (min-width: 1440px)`**. Below 1440 px the menu
therefore had **no** styling — in particular no `position: fixed` — so the
`left`/`top` that `showMenu()` sets resolved to nothing and the element laid out
as a plain block in normal flow at the end of `<body>`: measured
`rect {x: 0, y: 824, w: 1265, h: 22}` at a 720 px-tall viewport, i.e. **below the
fold**, with `display: block` and all three items present in the DOM.

Why it appeared only now: before §3 the `contextmenu` handler bailed out with
`if (getIsMobile()) return`, so the menu could only ever open at ≥ 1440 px, where
the media query applies. §3 removed that guard (deliberately — it is the phone
long-press entry point), which exposed the width gate. So it was broken on
**every phone**, not just in a narrow desktop window.

Fix: the base look (position/background/border/shadow/z-index/padding and the
items) moved out of the media query to top level, so it applies at all widths;
the 1440 px block keeps only its width-specific extras, which is what makes the
desktop rendering unchanged. Added a `max-width: 1439.98px` tweak giving the
items a 44 px thumb target and the sheet-like `min-width: 200px` (desktop items
stay 32 px tall / 214 px wide). Verified live with a real long-press at three
widths — 1280×720, 408×900, 1600×900 — all `position: fixed`, on screen, and
opening at the pressed block.

**Testing lesson (the reason §3's tests passed while the feature was broken):**
`expect(locator).toBeVisible()` only checks display/visibility/non-zero size — an
element rendered at `y: 824` in a 720 px viewport is "visible", and Playwright
clicks auto-scroll a target into view, so *clicking* the menu items proves
nothing about position. The long-press test now asserts `boundingBox()` is
inside the viewport and near the pressed block. Confirmed effective by
re-injecting `position: static`: the test fails with
"Expected ≤ 844, Received 1149.84". Use geometry assertions for every popup, not
visibility.

## 9. Done — the copy-day action made unmissable in the day menu (2026-09-30)

The user could not find copy-by-day on a phone even though it worked. Root
cause: it was the **eighth row of a seven-day list**, styled exactly like the day
rows, labelled "Copy this day" - in a menu where every other row means "go to
that day", while the action actually refers to the day the participant is
already on.

- Moved to the **first row, above the day list** and above the "Switch to day:"
  header, with a `fa-copy` glyph (new optional `icon` argument in
  `addMenuItem`), the primary colour, a tinted background and a rule under it -
  so it cannot be read as a day.
- Relabelled with the direction and the day: `messages.copyDayToAnother` =
  "Copy {{day}} to another day" → "Copy Monday to another day" (the first key
  with the `{{day}}` placeholder in a *menu*; `moreMenuLabel` now forwards
  params, and the fallback passed to it is already interpolated so the
  not-yet-loaded-i18n path stays readable).
- Added to all 7 locales and to `locales_consistency.test.js`'s required keys.
- Guarded by `mobile_context_bar.spec.js`: first row is the copy row, it names
  the current day, it carries the glyph, and it sits above the day list.
- Desktop is untouched: `#dayPickerBtn` does not exist ≥ 1440 px, and the
  timeline-title `.copy-day-link` button is unchanged (verified 1600×900).

Known rough edge, fixed in §11: on a day with no activities the row used to be
fully active and only toast `copyEmptySource`.

### Long-term idea (user, 2026-09-30)

Once saving happens on every action (see "Deferred - autosave"), **Save Day can
go away**, and its toolbar slot is a good home for copy-day: one prominent
button in the main controls instead of a row inside the day menu. Not now - it
depends on autosave, and until then the day menu is where the copy target is
picked anyway.

## 10. Page titles and participant-facing naming (2026-09-30)

Not mobile work, but found while testing the mobile layout.

### The bug: the tab sat on "Loading..." forever

The diary's `<title>` was wired to the **loading** key:
`<title data-i18n="common.loading">Loading...</title>`. `i18n.applyTranslations()`
rewrites the text of every `[data-i18n]` element - `<title>` included - so this
happened, measured with a MutationObserver on the title:

```
  71ms  static markup   "Loading..."
 106ms  script.js       "KI Time Use Diary - Adults"   <- document.title = configData.general.app_name
 108ms  i18n pass       "Loading..."                   <- clobbered 2ms later
```

Reproduce on demand: set the title to anything and call
`window.i18n.applyTranslations()` once - it comes back as the loading string (in
German: "Wird geladen ..."). Nothing to do with the backend or caching, and it
re-broke on every re-order of the init sequence, which is why it kept coming back.

Two further late i18n passes made any `data-i18n` title unusable for the study
name: `ui.js` (activities modal) and `maintenance.js` both call
`applyTranslations()` **after** the diary is built.

### Pre-existing bug found on the way

`footer.js renderFooter()` did `targetFooter.innerHTML = ''` on `#footer`, which
deleted `#footer_app_title`, `#footer_app_version` and `#footer_backend_status` on
every page with footer links. So the version and the backend status the diary sets
were never visible; the footer showed the links row only. It now replaces just its
own `.trac-legal-footer-links` row.

### The rule that now holds

**Chrome that JS fills must not carry `data-i18n`**, because any i18n pass (init,
language change, activities modal, maintenance banner) rewrites those elements:

| element | owner | markup |
| --- | --- | --- |
| diary `<title>`, `#footer_app_title` | `applyPageTitle()` (`script.js`) | no `data-i18n`, English fallback |
| consent / tasks `<title>` | `setStudyPageTitle()` (`footer.js`) | no `data-i18n`, page-name fallback |
| instructions / open studies / thank-you / timeout `<title>` | i18n pass | `data-i18n` = the page name |

`applyPageTitle()` runs after `applyTranslations()` for the same reason;
`setStudyPageTitle()` (in `footer.js`, loaded on every page) is the shared helper
for study pages and is called after the i18n pass on consent and tasks.

### Naming decision: who sees which name

Approved 2026-09-30: **participants see the study, not the software.** A
participant knows the study their invitation named; "TRAC" is an unexplained
acronym in their tab, and the study config already carries a better identifier
(`general.app_name`: "KI Time Use Diary - Adults" in EN, "KI Zeitverwendungstagebuch
- Erwachsene" in DE for the same study - it is even localized per study).

- Diary tab + footer: `general.app_name`, fallback the localized `common.pageTitle`.
- Study pages: `common.pageTitleWithStudy` = "{{study}} - {{page}}" (one shared
  pattern; `consent.pageTitleWithStudy` was dropped).
- Brand-free page names everywhere participant-facing: `Consent`, `Instructions`,
  `Open Studies`, `Tasks`, `Thank You`, `Session Timed Out` (the SV/FR/ES/FI/PL
  values kept "TRAC"/"O-ELIDDI", EN/ES instructions mixed "Time Use Diary").
- The fatal-error tab title is no longer "TRAC -- ERROR": study name (or the
  generic name) + localized "Error".
- **TRAC stays** for operator/developer surfaces: admin portal, `dev.html`, repo
  docs, logs, service names. Only participant chrome changed.
- Deliberate deviation from the plan: **instructions.html keeps a plain
  "Instructions" title** (no study prefix). That page does not load the study
  config, and adding a config fetch purely for the tab title is not worth it.

### Guards

- `tests/unit/page_titles.test.js` - the diary title carries no `data-i18n`, the
  JS-owned pages have brand-free fallbacks equal to their English locale value,
  i18n-managed titles match their key, no `TRAC`/`O-ELIDDI` in any participant-facing
  title/heading across all 7 locales, `common.pageTitleWithStudy` interpolates both
  placeholders. **When you add a participant page, add it to `I18N_TITLED_PAGES` or
  `JS_TITLED_PAGES` and to `PARTICIPANT_FACING_KEYS`.**
- `tests/e2e/page_titles.spec.js` - the diary tab equals `general.app_name` and is
  never the loading string (en + de), and consent/open-studies identify the study
  without the brand. Run with `--repeat-each=2` when touching the init order.

## 11. Copy day: push-only, disabled when it cannot run, jump-to-target toast (2026-09-30)

### Push-only is the design, not a limitation

An earlier version had both directions ("Copy this day" and "Copy from..."). The
user removed the pull direction as irritating, and argued the case better than the
plan did: **the participant must see what they are copying, so they have to be on
the source day.** Two more reasons it stays gone:

- The pull direction is the *risky* one: overwriting a day from a source that is
  not on screen. Push only ever overwrites a target the participant picked from a
  list that labels each one `(empty)` / `(has data)`.
- One row, one direction keeps the day sheet small - the reason pull was dropped.

So: **do not re-add a reverse picker.** The dormant code was deleted rather than
left behind a flag (`agents.md`: no backwards-compatibility bloat):
`showCopySourcePicker()` and its `window` export, the `copy-from-link` branch in
`addCopyDayLink()`, `SHOW_COPY_FROM_BUTTON` (main settings + the 4 dev settings
templates), and `messages.copyFromDay` in all 7 locales. No test referenced any of
it. The historical docs under `dev_tools/copy_days_plan/` stay as records.

### The row is disabled with the reason on it - not hidden, not silent

The row is now **always present** in the day sheet (only a single-day study, where
copying cannot exist, omits it) and:

- **day has activities** → active: accent blue, copy glyph, wraps to a second
  line if needed;
- **day is empty** → `disabled` + greyed, with `messages.copyEmptySource` shown as
  a `.context-menu-item-detail` line: "Source day has no activities to copy."

The user's rule: a greyed-out control teaches that the feature exists, a missing
one hides it. So it is never hidden, and the reason is **on the row** rather than
behind a tap - the same "greyed out, but tell them why" shape Save/Submit use.

The first attempt used `aria-disabled="true"` + a click that toasted the reason.
That was wrong twice over: Playwright's actionability check treats `aria-disabled`
as disabled (so the click never even ran in the test - it timed out), and it made
assistive tech announce a control as unavailable while it still acted. A real
`disabled` property plus a visible reason is honest and needs no interaction.
Layout note: the shared `.context-menu-item:has(.context-menu-item-detail)` rule
stacks rows as a column, which put the copy glyph on its own line, so the copy row
uses `display: grid` (`auto 1fr`) with the icon spanning both rows.

### After a copy, offer the jump

Copying persists the source day and **stays on it** (it never advances
`day_label_index`), so the participant still has to walk to the day that was just
filled. The success toast now carries an action: `messages.goToCopiedDay` =
"Go to {{day}}" → `saveAndSwitchToDay(target)`. The toast gets 6 s instead of 4 s
when it carries an action (a second line has to be read and chosen). No action
when the target *is* the day being viewed - that case reloads after 3 s anyway.

Guarded by `mobile_context_bar.spec.js`: the row is disabled with the reason on an
empty day (and enabled, with the tooltip line gone, once the day has an activity),
and the copy flow's toast action lands on the copied day with its activities.

## 12. Copy overwrite asked in the browser's bare prompt (2026-09-30)

Reported from testing: confirming an overwrite showed a completely unstyled
browser dialog. Cause: `copyDayTo()` asked with `window.confirm()` - the only
native prompt left in the app; every other confirmation is a styled
`.modal-overlay` dialog.

**The dialog was already specced and never built.** `dev_tools/copy_days_plan/
implementation_plan.md` names a confirmation dialog with `copyOverwriteTitle`,
`copyOverwriteConfirm`, `copyOverwriteYes`, `copyOverwriteNo`, and the E2E helper
was written against `#copyOverwriteConfirm` / `#copyOverwriteYes` - but only the
*message* key ever landed, so the implementation fell back to `window.confirm()`
and the helper's branch was dead code. The dialog is now built with exactly those
ids.

- New generic `showConfirmDialog({ overlayId, confirmId, cancelId, title,
  message, confirmLabel, cancelLabel })` in `ui.js` → `Promise<boolean>`. It
  lazily creates the overlay from the shared modal markup (`.modal-overlay >
  .modal > .modal-content` + `.button-container`), reuses it on later calls, and
  resolves `false` on Cancel, Escape or a backdrop click.
- The cancel button carries `data-modal-cancel`, which was added to
  `MODAL_CLOSE_SELECTOR` so the existing focus manager closes the dialog on
  Escape and restores focus - no new focus code.
- Keys: `messages.copyOverwriteTitle` ("Overwrite day?") and
  `messages.copyOverwriteYes` ("Overwrite") added to all 7 locales; the cancel
  label reuses `buttons.cancel`, so the plan's `copyOverwriteNo` was unnecessary.
- **Latent bug fixed:** `e2e_helpers.copyDayTo` / `rightClickCopyDay` clicked
  `.nth(targetDayIndex)`, but the picker excludes the source day, so the item for
  target N sits at N-1 (the neighbouring spec had the correct maths inline). Dead
  code until this test started using it.
- Guarded by `copy_days_flow.spec.js`: the dialog is a styled `modal-overlay` with
  the expected title, message and button labels; **Cancel leaves the target day's
  own activity in place** (2 activities stay 2) while Overwrite replaces them
  (2 -> 1); and a `page.on('dialog')` trap fails the test if a native prompt ever
  returns.

Optional follow-up (not done): the skip-confirmation and clear-timeline modals
still hand-roll the same markup in `createModal()`. They could call
`showConfirmDialog` with their own ids and lose ~60 lines of duplication - worth
it only if we touch them anyway.

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

Green 2026-09-30 after §12: `sh test_frontend_typecheck.sh`,
`sh test_frontend_unit.sh` (69/69, incl. `locales_consistency` key-set +
untranslated-value guards and the `page_titles` guards), and on chromium
**78/78** (`npx playwright test --project=chromium $(ls tests/e2e/*.spec.js |
grep -v accessibility.spec.js)` - `accessibility.spec.js` needs
`@axe-core/playwright`, which is not installed locally, so it cannot run here).
New specs added during this work: `mobile_activity_gestures` (§3),
`mobile_context_bar` (§4, day/timeline sheets + the copy row),
`page_titles` (§10).

Everything that had to be adapted for steps 4–6 has been adapted:

- `e2e_helpers.js` — `switchToDay` (layout-aware: `#dayPickerBtn` / `#dayMenu`
  below the breakpoint), `placeActivityMobile`, `openSkipConfirmation` (skip lives
  in the ⋮ menu on phones, so specs must not click `#skipReportingBtn` directly).
- `copy_days_flow.spec.js` runs at 1600×900 and is unaffected by mobile-only
  hiding; it is the only spec using `switchToDay` / `isDayButtonGreen` /
  `getDayButtonCount`.
- The old "no mobile test fills both timelines" gap (the one that let the §2
  reachability bug live) is **closed**: `mobile_context_bar.spec.js` fills both
  timelines of a phone day and saves.

## Known gaps, deliberately not asserted

- Footer/legal links and the two language `<select>`s are 16–19 px high on a
  phone, below the 24×24 WCAG 2.2 SC 2.5.8 minimum. Reachable, but small for a
  thumb; `mobile_layout.spec.js` documents this rather than failing on it.
- `accessibility.spec.js` cannot run locally without `@axe-core/playwright` (CI
  does run it).

## Running things locally

```sh
./run_dev_nginx_both.bash            # nginx :3000 + backend :8000 (keep it running)
# diary: http://localhost:3000/report/index.html?study_name=default&lang=en

sh test_frontend_typecheck.sh
sh test_frontend_unit.sh
cd frontend && npx playwright test --project=chromium tests/e2e/<spec>.spec.js
```
