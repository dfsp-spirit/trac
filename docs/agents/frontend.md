# Frontend Agent Documentation

## Tech Stack & Architecture
- Pure ES-module JavaScript frontend. No React, Vite, Webpack, or runtime
  bundling toolchain in delivery.
- Static HTML/CSS/JS served by the deployment stack from `frontend/src/`.
- Architecture is enforced by `frontend/tools/check-architecture.mjs` (D33): only
  `js/data` may call `fetch`, imports point downwards, files stay under the line
  caps, and only `ui/dismissedMessages.js` may touch device storage.
- The diary shows one timeline over 24h; the time grid is per study
  (`time_step_minutes`, default 10) instead of a fixed 10-minute step.

## Configuration & Integration
- The single settings file is `frontend/src/js/config.js`, copied per
  environment from `dev_tools/*/frontend_settings/config.*.js`. It carries
  `apiBaseUrl`, the relative `localesUrl`, the supported languages and
  `multiTimelinePolicy` (`ignore` | `merge` | `error`, default `ignore`) - a
  safety net for an imported legacy config that still defines two timelines.
  Every shipped study is single-timeline: the app reads
  `GET …/diary?timelines=resolved` and sends `timeline_key` with every create.
- Backend API is typically mounted under `/api` (or deployment-specific
  prefixes).
- Participant context is URL-driven (`study`, `pid`, optional `lang`), not
  login-driven. The stage is re-read from the server on every load (D37).

## Inactivity timeout (opt-in)
- The study-config payload's `inactivity_timeout_minutes` defaults to `0` (off). When it is
  greater than zero, `ui/boot.js` starts a server session before an external-task
  return is redeemed; `ui/shellChrome.js` arms `ui/sessionLifecycle.js`.
- The lifecycle is invisible: one `setTimeout`, activity listeners
  (`pointerdown`, `keydown`, `touchstart`, `wheel`, `scroll`) and a throttled
  `POST /session/touch`. There is deliberately **no countdown, progress bar or
  seconds display**; a ticking clock pressures participants and costs timeline
  space.
- The only visible hint is the static privacy note in the drawer
  (`#session-note`), rendered from `diary.session.idleNote_one/_other`. It names
  the duration but does not update.
- On expiry the app calls `DELETE /session` best-effort and uses
  `location.replace` to `timeout.html?lang=…` (plus the study's optional
  `inactivity_page_custom_text` as `text`). The page is a separate entry point
  (`js/timeout-main.js`), has no shell and no API bootstrap, receives no study or
  participant identifier, and contains no invitation link. It renders the custom
  text as plain text via `textContent`.
- The server is the authority. A `401` with `session.required`,
  `session.expired` or `session.invalid` calls `chrome.expireSession()` through
  the `onSessionExpired` API hook, so a direct request or a cookie cleared in
  another tab still ends the app.
- The timeout is a privacy guard, not authentication: reopening the invitation
  link starts a new session. Cookies are required; with `0` none are used.
- `ui/sessionLifecycle.js` keeps all DOM and timer access; `data/request.js` owns
  the session-error hook and the `credentials: 'include'` fetch.

## Usability signals
- `frontend/src/js/domain/uxEvents.js` holds the rules (which events exist,
  which properties they may carry, query folding, load-id shape);
  `frontend/src/js/data/signals.js` is the transport (buffer, 15 s flush,
  `sendBeacon` on `pagehide`); `frontend/src/js/ui/formVisit.js` reports how
  one activity-form visit started and ended.
- **Nothing is collected unless the study opts in** (`save_ux_events` in the
  study config) **and**, for a consent-requiring study, the participant
  consented - the same gate as browser identification (D38). The tracker starts
  silent, and a session that loses consent clears its buffer.
- The `load_id` is a random UUID per page load, kept in memory only (no device
  storage, D33), and is only used to count distinct visits on the admin page.
  Never persist it, never derive it from `pid`.
- Sends are fire-and-forget: no await, no retry, no user-visible error. A
  signal is never worth a lost diary. Properties are filtered against the
  allow-list client-side too, so a stray one never leaves the browser.
- `activity.form.opened` without a matching `activity.form.closed` is the
  "left mid-entry" signal - that case only exists on the client, which is why
  the panel reports the pair rather than only the completed saves.

## Defaults for a new entry
- Every way into the form resolves its start through `ui/entrySlot.js` +
  `domain/suggestSlot.js`, never through a stored constant: the day the
  participant is looking at, the minute under the top bar (or the end of the
  entry just saved, for "save and add another" where the form covers the
  timeline), moved into the next free minute, lasting
  `DEFAULT_DURATION_MINUTES` (60) or until the next entry, whichever comes first.
  A clicked gap is the one exact range - it is a one-shot claim, so a click that
  was not used cannot pre-fill a later, unrelated entry (that snapshot was why
  the desktop column used to open on Monday 08:00).
- A default must never silently overlap: an hour that does not fit is shortened
  to the free block, a block shorter than one step is skipped, and only a day
  with nothing free falls back to a short slot at the anchor (the neighbour hint
  then explains the overlap). Cross-midnight entries block the morning after
  them, because the computation runs on the absolute minute axis.
- `suggest-slot.test.js` pins the ladder and `entry-defaults.spec.js` pins the
  wiring (day in view, no overlap, "add another" continues).

## Start and end time in the activity form
- Both bounds are native `<input type="time">` fields (`ui/timeRange.js`): a
  segmented, typeable field on desktop and the OS picker (Android dial, iOS
  wheel) on phones. Do not replace them with a `<select>` of times again - a
  144-entry list was the old shape and is the one pattern no calendar app uses.
- The control shows a time of day, so `domain/time.js#resolveRangeEnd` decides
  which day the end belongs to: a clock that is not after the start is the next
  day. Equality is a deliberate 24-hour entry (a whole day), which the duration
  line shows as such.
- `step` is the study's grid (`domain/timing.js`, from `diary.study`): a typed
  value that lands between steps is snapped on commit (`snapMinutes`), and
  `validateActivity` would refuse it otherwise. The minimum length is a second
  setting (`min_duration_minutes`), so a 5-minute grid can still keep 10-minute
  blocks. Both are only configuration: the backend stores whatever minutes it is
  sent, and the client is what enforces them.
- 24-hour display is our own text (timeline, duration, review). The picker itself
  follows the **browser UI language**, so a device whose browser runs in English
  renders AM/PM; there is no attribute that forces 24h on a native time field.
- One line under the fields carries what the two values mean:
  `22:00 – 00:30 · 2 Std. 30 Min.`. The range is formatted by us in 24-hour form
  (the picker may show AM/PM on a 12-hour device), the `(next day)` marker
  appears when the end crosses midnight, and the duration follows. Both parts are
  `nowrap`, so a cross-midnight entry wraps *between* them and never inside
  "2 Std. 30 Min.". `endInput`'s `aria-describedby` points at that line. The last
  day keeps its hint that activities end by midnight.

## Catalogue categories (`ui/activityList.js`)
- The catalogue is a flat list of activity rows grouped by the study's own
  category names, with no accordions (D29/D30): every activity stays one scroll
  away.
- **The category header is a section bar, not a caption.** Ink text (not
  `--ink-muted`), weight 700 at the unchanged 0.875rem, a 3px bar on the start
  edge (`inset` shadow) and a rule under the line; sticky at the top of the
  panel body, so the current category stays visible while its rows scroll. The
  bar/rule/contrast is what makes the groups readable next to 30+ rows that each
  carry a strong colour swatch - do not reintroduce size as the hierarchy.
- The row count sits on the right while browsing and is `aria-hidden` (the list
  itself carries that fact for assistive tech). It is **omitted while
  searching**: a hit count would read as the size of the category.
- Vertical budget: the header keeps the line box the old caption had (one line,
  two for the longest German names at 380px) plus one 8px gap between groups;
  `tests/components/activitylist.spec.js` pins the height, the sticky offset
  and the count rules.

## Custom input (free text) in the activity form
- `is_custom_input` is a property of a catalogue **row**, and a sub-activity is a
  row. The pilot study's "Sport in Innenräumen (z.B. Schwimmen, Kurse)" is a
  child of "Sport & Bewegung (Außer Haus)" that asks for the participant's own
  words, so the form has to look at the *chosen* row, not only at the parent:
  `flattenCatalogue()` keeps the flag per child (`children[].customInput`) and
  `renderActivityForm` shows the text field only while a custom row is selected
  (`customTarget()`), toggling it on the child select's `change`. Dropping the
  flag in `flattenCatalogue` is what silently turned those sub-activities into
  plain ones.
- The typed words are appended to **that row's** name ("Sport in Innenräumen
  (…): Yoga") and the row keeps its own `activity_code`, with the parent in
  `parent_activity_code` - the same compose/split pair (`domain/activityName.js`)
  the parent-level custom input uses, so an edit never doubles the prefix.
- `recentEntries()` keys a custom row by the typed text, per row: two texts are
  two shortcuts, and the "used recently" chip prefills the field. A custom
  sub-activity is such a row too, which is why the text is read with *its* name
  as the prefix.
- How many shortcuts the row shows is the study's `num_recent_activities_shown`
  (default 5), delivered in the diary payload under `study`; `0` hides the
  section entirely. The client never hard-codes the number.
- `custom_input_question` (optional, per row) replaces the field's label:
  "Paid work" asks "What is your job?", a gaming child asks "Which game?".
  `flattenCatalogue()` carries it as `children[].customInputQuestion` /
  `customInputQuestion`, and `createCustomField()` sets the label from the
  *currently selected* row in `sync()`, falling back to `diary.form.what` when
  the row names none. It is a label, not a placeholder: the prompt stays visible
  while typing and is the input's accessible name. The backend rejects the field
  on a row without `is_custom_input`, so the config cannot promise text the form
  never asks for.
- `activityform.spec.js` mounts the form with a custom sub-activity and pins
  visibility, the composed name, the refusal without text, the search prefill,
  the edit round-trip, and that the label follows the chosen row (own question,
  fallback, hidden for a plain row).

## Surroundings block in the activity form
- On a phone the panel is a modal that covers the timeline, so the one fact a
  participant cannot look up while choosing times is where the neighbouring
  entries end ("did I sleep until 6:00 or 6:10?"). `domain/neighbours.js` answers
  it from the same records `validateActivity` uses (the form builds `existing`
  once and passes it to both, so block and rule cannot disagree), and
  `ui/timeNeighbours.js` renders `neighbourRows()` under the time row as a
  description list: a muted label, then the value.
- **Why labelled rows instead of one sentence.** An unlabelled "Schlafen ab
  00:00 · Mittagessen ab 12:00" directly under the range being edited reads as
  another fragment of *that* entry - and the cross-day case ("… (Dienstag)") is
  the one where the reader most needs to know whose entry it is. Each row is
  therefore labelled `Davor` / `Gleichzeitig` / `Danach`, which gives the
  fragment an owner that cannot be the entry itself; the label comes from the
  row's `kind`, so a new kind needs a `…Label` locale key. Values stay
  sans-serif so the mono duration line above remains the only "this is my entry"
  element. Rows are chronological and independent: every applicable fact is
  shown.
- **Label or value, stated by weight and colour, not by punctuation.** A label is
  `600` at `--ink-muted` - the same weight cue the form's field labels use - while
  the value is `400` at `--ink`, so the fact stays the thing the eye lands on. No
  colon: that is the convention for an inline "key: value" run, whereas the
  aligned value column already states the relationship (and would widen the `auto`
  label column on a 360px phone).
- **Separated by proximity, not by a frame.** Three levels, and every gap states
  which level it belongs to: 8–12px inside the entry (inputs → duration line),
  24px before the surroundings block, 32px between the form's sections
  (`.t-form { gap }`, which also separates the error notice). A bordered box was
  rejected on purpose - `--line-strong` plus a radius is this design system's word
  for "notice that wants an answer" (`.t-notice`), and the block appears and
  disappears with the times, so an edge would flicker where a couple of text rows
  stay quiet. If more separation is ever needed, the next step is a 1px `--line`
  hairline above the block, not a container.
- **The block is the last child of the "when" fieldset**, after `endHint` (the
  last-day midnight note, which belongs to the entry). Otherwise the section would
  end with an entry-related hint glued under the context rows, and the context
  block would split the entry's own fields in two.
- **An overlap is a row, not a warning.** Music while cooking is data the study
  wants, so an overlap is stated in the same muted voice as the boundaries
  ("Gleichzeitig: Musik 21:10–22:00, 50 Min.") - no attention styling, and the
  boundaries beside it are not hidden. `max_overlap` is *not* a form validation:
  it only decides in `ui/nudgeController.js` whether an auto-suggested multi-day
  fill is worth proposing.
- An "An Schlafen anschließen (06:00)" chip sits under the rows when the start is
  within `SNAP_MAX_MINUTES` of the previous edge. The chip keeps the chosen
  length and only moves the start.
- **A neighbour on another day names its weekday before the time** ("Schlafen ab
  Dienstag 00:00"). A routine filled on all seven days puts the same activity on
  both sides of every entry, and a bare time read as today's midnight. The
  weekday comes from `describe()` in `ui/timeNeighbours.js`, which labels the
  neighbour with the same localized day name the day select uses; it precedes the
  time because that is how the phrase reads in all three languages. The same
  marker is applied to an overlap range that runs past midnight. A boundary on
  another day is reported but never offered as a "continue" chip, because the
  start field only spans the day being edited.
- The list is an `aria-live="polite"` region - not `role="status"`, which would
  replace the list semantics - so a screen reader hears it change. The block is
  hidden when the day around the range is empty, so an empty form gains no
  clutter.

## The compact day strip
- **What it answers.** On a phone the activity panel is a modal over the
  timeline, so while choosing times the participant cannot see the day they are
  placing into. `ui/dayStrip.js` draws it under the day select: light grey for
  "nothing recorded", the study's own activity colour where something is, and a
  row of its own for the range currently in the two time fields. It is a glance,
  not a reading surface - the surroundings block above still says in words what
  is around the range.
- **Percentages, not cells.** Measured on the real surfaces: 288 px for a whole
  day on the narrowest phone (320 px viewport, full-screen dialog), 347 px in the
  desktop panel column, 361 px on a 393 px phone. The shortest entry (the
  study's `min_duration_minutes`, 10 by default) is therefore **2 px** - the
  *step* may be 5, but it cannot produce anything shorter than the minimum. A segment is positioned as `start / 1440 * 100%`, so a boundary stays
  exact at any width and the component costs one node per activity instead of 144
  cells. Never add a gap between slots: at 2 px a 1 px gutter would be half a
  slot.
- **Rows follow the data.** `layoutDay()` already packs lanes exactly as the
  timeline does, so a day with two overlapping entries grows a second row and the
  two views cannot disagree about what overlaps. `maxRows` exists only for a
  caller that cannot afford growth; the form passes nothing (dynamic).
- **The pending range is a row, not an outline.** A minimum-length range is
  2 px wide (and `min-width: 2px` keeps it visible at a 5-minute step), so a
  1.5 px outline around it would be wider than the range. Its own 4 px row in
  `--ink` is unambiguous at any length and cannot claim an activity colour. The bar
  breathes between `--ink` and `--surface-300` (2 s, `ease-in-out`, alternate) so
  "this one is yours" needs no reading. The range is the full grey ramp on
  purpose: at 4 px tall - 2 px wide for a short entry - a one-step change is
  invisible, and the light end still sits below the row's own `--surface-100`
  track, so the bar dims instead of looking deleted. It is the app's only animation, and
  `base.css` stops it for `prefers-reduced-motion`, where the static black bar in
  its own row already carries the distinction.
- **`aria-hidden`.** Everything the strip shows is stated elsewhere in text
  (surroundings, duration line), and colour alone may not be the only carrier of
  information (WCAG 1.4.1), so it stays out of the accessibility tree and the tab
  order. An entry running past midnight is clipped at the day boundary, like the
  timeline's tail.
- **Reuse contract.** `buildDayStrip({ records, dayIndex, pending, maxRows })`
  returns a node and has no lifecycle; a caller rebuilds it when its data changes
  (the form does it from `refreshDerived()`, which already runs after every
  committed time or day change). The entry being edited is filtered out of
  `records` - the pending row shows where it is going, and drawing it twice would
  make the day look busier than validation sees it. The rail uses the plain
  coverage picture from `ui/coverageStrip.js` (`appendCoverageRuns`), the review
  the coloured one; do not fork either drawing code.
- Guarded by `tests/components/daystrip.spec.js` (arithmetic, lanes, clipping,
  bad colours) and `tests/e2e/day-strip.spec.js` (wiring, follow the fields and
  the day dropdown).

## "Also on other days?" is planned before it is saved
- A multi-day save is decided per day on the server (`day_label_indexes` in,
  `status` + `code` per day out), so the client cannot promise anything until
  the response. `ui/multiDayHint.js` runs the same plan
  (`domain/validation.js` `planMultiDayCreate`, the function the domain tests
  already pinned) while the form is open and states the outcome under the chips:
  "Wird an 3 Tagen eingetragen" or "Wird an 1 von 3 Tagen eingetragen ·
  Mittwoch, Freitag übersprungen". It stays quiet for one day (the everyday save)
  and when *nothing* lands - then the anchor day is invalid too and the form's
  error notice is the message that matters.
- The chips are deliberately **not** disabled for days that would be skipped.
  Whether a day can take the entry depends on the range being picked right now
  and on the other chips (a night spilling into the next morning can fill it), so
  a disabled chip would flip while the end time is still moving and could not say
  why. A day can be "full" for one range and free a minute later; naming the days
  and their reason reads better than a dead control, and it survives on a phone,
  where nothing has a tooltip.
- The toast after the save names the days, grouped by reason: "Nicht
  hinzugefügt: Dienstag, Mittwoch (Diese Zeit ist belegt), Donnerstag (Bereits
  eingetragen)". It used to print only the first skipped reason, which left the
  participant diffing the timeline to find out which days to redo
  (`describeSkipped()` in `ui/messages.js`).

## Review before submit (D32)
- The topbar button is **"Prüfen" / "Review"**, not "Absenden": it opens the
  check screen, and the irreversible step is the primary button inside it. Two
  more ways in, so finishing never depends on finding one control: the progress
  line (desktop, `#progress-note`, a button whose visible summary stays its
  accessible name) and the drawer menu's "Tagebuch prüfen" (the phone's path).
- The review is a **week overview, not a second diary**. Each day is one compact
  row: label and state, the day's covered stretches as a strip, and - on open
  days with entries - the largest remaining hole. There is no per-activity list.
  That list repeated the timeline row by row and made the review a long copy of
  the page behind it (several screens on a phone); the timeline is already the
  detail view and *Ändern* opens it on that day.
- Each day's picture is the **coloured, one-row-per-lane strip**
  (`ui/dayStrip.js`, `aria-hidden`), the same component the add-activity form
  uses - not the single-line coverage bar. At review size both scan equally
  fast, and the coloured one also says *where* the time went, which is what
  makes a day that looks wrong worth opening. `domain/review.js` therefore
  returns `records` for the whole week, with `toTimedActivity` applied once and
  the colour kept exactly as the study set it (no colour is invented). The state
  line still carries the meaning; `runs` stays in the model because "empty day"
  and the largest hole are computed from the merged stretches.
- `domain/review.js` returns `runs` and `largestGap` per day. The hole is the
  longest uncovered stretch of the day, **including a leading or trailing one** -
  an empty evening is exactly what the review should point at, which is why this
  is not `layoutDay().gaps`. It is shown only when the day is open, has entries,
  and the hole is at least `MIN_GAP_MINUTES`; an empty day says so in words and
  points nowhere.
- One column at **every** width. The old two-column spread existed to compare
  detailed day lists; with one strip per day a single column keeps all seven
  aligned, which is what makes the week scannable. The modal is the screen below
  1200 px and a centred card above it, but never a spread.
- **The foot button follows readiness.** White (`--secondary`) while `canSubmit`
  is false - pressing it then is how a participant learns *what* is missing, so it
  stays enabled and the hint under it says "Noch nicht alle Tage sind
  vollständig." - and black (`--primary`) once every day meets its requirement.
  The focus logic targets the foot's first button, because an incomplete week has
  no `--primary` there at all.
- **Becoming ready is announced twice**, because nothing else on the page changes
  at that moment and the progress line does not exist on a phone:
  the banner in `#timeline-notices` (`renderDiaryNotice`, "Alle Tage sind
  vollständig" + the send button) and the top bar button, which turns black,
  changes its icon and says "Absenden" (`diaryView.renderCta`). Both read
  `progress(diary)` - the same numbers the rail and the submit gate use - so the
  cue cannot promise something the server refuses, and it reverts as soon as an
  edit opens a day again.
- The top bar label is written by `renderCta` and therefore carries **no
  `data-i18n`**: the translation pass would overwrite a state-dependent text with
  the static one. The label is refreshed before the state short-circuit, so a
  language switch on a ready diary switches "Absenden" / "Submit" too.

## Copying a day
- `ui/copyDay.js` is the seam (dialog + toast + undo), `ui/copyDayDialog.js` the
  markup, `ui/copyDayText.js` the two sentences, `domain/dayCopy.js` the rules
  (`ownCounts`, `copyableDays`, `planCopy`). The planner mirrors the server's
  `POST /day-copies`, so `tests/unit/day-copy.test.js` pins the answer without a
  browser.
- The source day is a **receipt block above the target grid**, never a chip among
  the targets: "where do I copy from" and "where do I copy to" must not be told
  apart by a border style. The source chip stays visible in the grid (the week's
  shape) but is inert.
- The target grid can show **one-click presets** (`ui/copyDayShortcuts.js`).
  A preset *replaces* the selection, never adds to it, and never selects the
  source day. The groups come from the study config (`day_groups`: `key`,
  localized `names`, and the `days` it contains), never from the weekday names:
  whether a study runs a Mon-Fri week, a Sun-Thu week or a school week is study
  content, and the app must not guess. The server resolves each group to day
  indexes, so the client never compares day names. The label is picked like
  other study content (`localizedText`: interface language, study default,
  English, then the first name); a study without groups gets no section, and a
  group whose days are all filtered out (e.g. only the source day) renders no
  button.
- A day with entries gets a **dot** on its chip, not a count - a number under the
  weekday reads as a duration. The count lives in the sentence under the grid,
  which names only the days that lose something: "Wird überschrieben: Mittwoch
  (2 Einträge)". The button carries the consequence too ("Kopieren und
  ersetzen"), and the toast afterwards offers an undo that restores the replaced
  rows - no confirmation dialog (D9).
- `copyableDays()` is deliberately **not** `daySummaries().hasData`: a day whose
  only content is the tail of the previous night looks filled but owns no rows,
  and there would be nothing to copy.
- Entry points: the "Tag kopieren" button in each day heading (`timeline.js`,
  rendered inert when the day owns no rows), "Tage kopieren…" under the day rail,
  and the same entry in the drawer menu for phones. All three open one dialog;
  only the source preselection differs.
- **An inert entry point is never silent.** `aria-disabled` (not `disabled`)
  keeps it focusable and announced, the reason is its `aria-describedby` text -
  never a `title`, which reaches neither phones nor keyboard focus - and
  activating it raises the same toast ("Es gibt noch nichts zu kopieren.") via
  `createCopyDay.open()`, which also refuses a heading that names a day with
  nothing to copy. The rail additionally shows the sentence in place while the
  whole diary is empty: that column has room, nothing below it moves, and the
  phone never sees it. A revealed line under a day heading was rejected - on a
  phone the heading is not sticky, so it would shift the timeline under the
  finger; on desktop it would grow a sticky header.
- Wording note: the sentence says "nothing to copy", not "no entries". A day whose
  only content is the previous night's tail shows a block but owns no rows, and
  telling that participant "this day has no entries" contradicts the screen.

## Toast placement
- Above 1200px the toast keeps the panel's width and stays tied to the panel it
  reports on (D28), but it sits one gap *left* of the panel's column instead of in
  it. Inside the column it covered the footer, and the only part that takes a
  click is the Undo button - so reaching "Speichern und weitere" through the toast
  could undo the entry just saved. Below 1200px the panel is a dialog in the top
  layer, so the toast cannot cover it - while the panel is open the toast is
  painted underneath it, which is why a delete closes the panel
  (`deleteWithUndo`).
- **A receipt never takes the pointer, at any width** (`components.css`:
  `pointer-events: none` on the region's children, `auto` only on
  `.t-toast__action` / `.t-toast__close`). This is the same rule as the placement
  above, one layer down: the phone band sits exactly where the participant taps
  next (a timeline entry, a day heading), and when the box took clicks a tap there
  reached the toast - or its Undo, which reverses the action the toast confirms.
  A toast that covers something must never also own the click.
- The toast is dismissible before its 6 s run out. The close control is icon-only
  on purpose: a text label ("Schließen" / "Dismiss") took width from the message
  and wrapped it onto a third line. `ui/toast.js` always appends it; an
  action-less toast (an error line) is dismissible too.
- `ui/activityPanelForm.js` hides the toast when the *next* entry's form opens
  (`show()`): the receipt belongs to the entry just saved, and on desktop it would
  otherwise still be on screen while the next save is configured.
- `activity-lifecycle.spec.js` ("the save toast does not swallow the next save")
  clicks the next save with a 3 s timeout, so a regression cannot hide behind
  the toast timing out.

## Day names
- Study day labels arrive per language (`days[].display_names`) and every screen
  renders them through `dayLabel()` in `domain/diary.js` - the rail, the day nav,
  the timeline headings, the day select, the "also on other days" chips and the
  boundary hint. Never slice the internal `name`: it is English, so
  `name.slice(0, 2)` gave every participant "mo", "tu", "we" whatever language
  the study ships.

## Accessibility & mobile
- Participants answer on phones and include older adults, so both are treated as
  first-class: `frontend/tests/e2e/a11y.spec.js` runs axe-core (WCAG 2.0/2.1/2.2
  A + AA) over the app and its views, and `touch-targets.spec.js` checks the
  phone layout (no sideways scrolling, >= 24x24 primary controls).
- Never put `aria-label` on an element without a role. Dialogs use a real
  `<dialog>`; `ui/panelHost.js` is the one place that decides between the
  desktop column and the modal dialog.
- Do not disable zoom in the viewport meta (`user-scalable=no`,
  `maximum-scale=1.0`).
- Interactive targets need 24x24 CSS px (WCAG 2.2 SC 2.5.8). Inline links in a
  wrapping row need padding, and a row of links must offer a break opportunity.
- Components are mounted on their own fixture pages under
  `frontend/tests/components/` (D33 rule 8), so a broken view fails in seconds
  without the stack.

## Localization
- Locale resources are in `frontend/src/locales/` and ship inside the app.
- Language fallback order: URL `lang` -> browser language -> study default.
- `frontend/tests/unit/page_i18n_keys.test.js` enforces that every key the app
  requests exists in every locale file. Add keys to all three locales in the
  same change.
- Markup hooks (`data-i18n`, `data-i18n-aria-label`, ...) and `t('key')` are
  resolved by `data/i18n.js`; the locale URL comes from `config.localesUrl`.

## Study texts
- Consent, instructions, tasks and thank-you texts come from the server in the
  `study-config` payload (`study_text_*`), already resolved to the selected
  language. Views render them as Markdown through `domain/markdown.js`; do not
  add a second copy of the text to the locale files.

## Entry page
- Opening `frontend/` without a study in the URL is not a failure: `ui/boot.js` asks `GET /api/listed_public_studies?lang=<lang>` and `ui/views/studyList.js` renders one link per study (`ui/stageMachine.js` hides the diary chrome for it, like the other non-diary pages). The server decides what may appear - studies with `is_listed_publicly: true` that are also open, running and not paused - so the list never offers a study the diary would refuse.
- The entry page creates no identity: each link carries only `study` (plus the current `lang`). The participant id is generated by `ui/identity.js` when the link is followed, which is why opening the page cannot add a participant.
- An empty list falls back to the `diary.stage.noInvitation*` page, and a failed request to the usual failure page with *Try again*. Guards: `tests/e2e/entry-page.spec.js`, `tests/e2e/failure-page.spec.js`, `tests/e2e/a11y.spec.js`.

## Banner messages
- `data/messages.js` fetches `GET /api/messages` (server message + the study's
  own one) and returns `{text, key}` or nulls. Failure is silent by design: a
  missing banner is not a reason to interrupt a diary.
- `ui/messageBanner.js` renders them above the top bar inside `#app`, in normal
  flow, so **no sticky offset has to know about the banner** - it scrolls away
  with the page. Text is plain text with `white-space: pre-line`; the close
  button only removes the element.
- `ui/dismissedMessages.js` is the **one allow-listed `localStorage` module**
  (`DEVICE_STORAGE_ALLOWLIST` in `tools/check-architecture.mjs`, asserted by
  `architecture.test.js`). It stores opaque message keys only - no pid, no study
  name, no text. The key covers the text and `revision`, so an edit or a fresh
  activation re-shows the banner to someone who dismissed the previous version.
  Broken/blocked storage means "nothing dismissed", never an exception.
- Wiring: `main.js` creates the controller and `ui/startup.js` triggers the first
  load through the language switch (`onLanguageChanged`), so the server resolves
  the text in the language that is actually on screen. `main.js` is at its size
  cap - that is why the load sequence lives in `startup.js`.

## The study's time grid
- `study.time_step_minutes` (allowed: 5, 10, 15, 20, 30, 60 - multiples of five
  that divide 1440, so midnight stays on the grid) is how precisely a time can be
  typed. 5 is what makes the quarter hours a native picker offers survive; 10 is
  the historical grid.
- `study.min_duration_minutes` (multiple of the step) is the shortest entry. It
  is what keeps a block large enough to see and tap when the step is fine. With
  step 5 / minimum 10 the smallest block is today's 10-minute block.
- One module resolves both: `domain/timing.js#timingFor(diary)`. Nothing else
  may import `STEP_MINUTES` for a decision - it is only the fallback default.
- **A stored row is never invalidated by a settings change**: `timeRange` keeps
  an edit's times exactly as stored until the participant changes one, and
  `validateActivity` receives `timesUnchanged` so the grid and minimum checks are
  skipped for an unchanged range (e.g. a 10-minute entry after a study moved to
  a 15-minute grid). Without that, raising a setting would lock old data.
- The error texts are step-aware (`diary.error.notOnStepGrid`, {% raw %}`{{step}}`{% endraw %}) and
  the nudge shortcut moves one study step (`diary.shortcuts.nudgeStep`).

