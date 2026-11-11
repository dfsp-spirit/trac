# One parent filling a diary for two twins

**Status:** analysis only, no code written. For a PO / stakeholder decision.
**Scope:** what it would cost to let a single participant (`pid`) report for two
children in one diary, where each child has its own set of days
("twin1 monday", "twin2 monday", …), and each day shows the child's name.
**Baseline:** `develop` at `06cde34`. Line references are to that tree.

---

## 1. The request

Two related changes:

1. **Days no longer mean "consecutive calendar days".** After `twin1_monday` comes
   `twin2_monday`, not Tuesday. Consequently an activity may no longer run past
   midnight, because there is no meaningful "next day" to run into.
2. **Per-day names in the UI** — "Montag: Tim", "Montag: Tom". The results may
   stay **one row per activity** (no split of the diary into two DB rows), but the
   names must be imported, shown per day, and presumably exported.

---

## 2. The decisive fact

**`day_labels` are per study, not per participant.**
`DayLabel` is unique on `(study_id, name)` (`backend/src/o_timeusediary_backend/models.py:371`),
and the diary payload builds its `days` array from the study's labels, not from
anything participant-specific (`backend/src/o_timeusediary_backend/api_diary.py:459`).

That single fact splits the cost of item 2 in two:

* **Generic child labels** (`Kind A` / `Kind B`, `twin1` / `twin2`) — works **today**
  with no code at all.
* **Real per-family names** (Tim/Tom for one family, Lea/Lena for the next) — needs
  a new per-participant dimension in the database, because the name cannot live in
  a study-wide label.

So the first question for the PO is: *one family, or many?*

---

## 3. What already works (cost 0)

Item 1 is much cheaper than it looks, because the data model never encoded
consecutiveness:

* `DayLabel` carries `name` + `display_order` (unique, only required `>= 0` in the
  config validator at `parsers/studies_config.py:618`) + a localized
  `display_names` map. Nothing enforces 7 days or a contiguous 0..6.
* The study config format already accepts `name: "twin1_monday"`,
  `display_order: 3`, `display_names: {"de": "Montag"}`.
* Both participant frontends iterate the day list generically: `dayNav` renders
  "Tag *n* von *N*", the timeline renders one section per day, the day-chip grid is
  `auto-fit`, the review list and the admin tables use `days.length` / `total_days`.
* No participant-facing code derives a calendar date. `frontend_new/src/js/domain/dates.js`
  only formats the study's collection window.

Item 2's *display* half also already works: a localized day label is what the day
nav, timeline headings, review list, activity-panel context line and the chips'
`aria-label` all print. Setting `display_names` is enough.

---

## 4. Item 1 — independent days

### 4.1 The only real coupling is the cross-midnight tail

Everything that treats day *N+1* as "the next moment in time" is the tail of a
record that started the day before:

| # | Site | What it does | Breaks with interleaved days because |
|---|---|---|---|
| 1 | `backend/src/o_timeusediary_backend/coverage.py:86` `next_day_label_ids()` | credits a record's tail to the next day label | Tim's 00:30 tail lands on **Tom's** coverage |
| 2 | `backend/src/o_timeusediary_backend/api_diary.py:212` `_absolute_interval()` | `display_order * 1440` axis for overlap checks | twin days share a false time axis |
| 3 | `backend/src/o_timeusediary_backend/api_diary.py:757` | `day.ends_at_midnight` on the last day only | "last" is no longer the temporally last |
| 4 | `backend/src/o_timeusediary_backend/api_diary.py:91` | `end_minutes: le=2880` | allows the tail at all |
| 5 | `frontend_new/src/js/domain/validation.js:47` | client overlap axis | mirrors #2 |
| 6 | `frontend_new/src/js/domain/validation.js:188` | last-day rule | mirrors #3 |
| 7 | `frontend_new/src/js/domain/geometry.js:81` | `continuesAfter` / `continuesBefore` segments | draws a tail on another child's day |
| 8 | `frontend_new/src/js/ui/timeline.js:83` | `↓` marker, continuation styling, a11y text | points at the wrong day |
| 9 | `frontend_new/src/js/ui/timeRange.js:82` | end ≤ start ⇒ next day; "(nächster Tag)" | the affordance itself |
| 10 | `frontend_new/src/js/domain/neighbours.js:141` | weekday-named neighbour ("ab Dienstag 00:00") | names the **other child's** day |
| 11 | `frontend_new/src/js/domain/review.js:99` / `ui/reviewList.js` | `nextDay` flag per row | same |
| 12 | `backend/src/o_timeusediary_backend/api.py:8123` | **published export columns** `start/end_minutes_since_diary_start` = `display_order × 1440` | axis becomes meaningless |
| 13 | `frontend/src/js/script.js:4283` | old frontend drag/resize next-day logic | a second implementation |

Removing the tail collapses #1–#11 into per-day intervals. **Your intuition in the
request is correct: forbidding cross-midnight is what removes the need for
consecutiveness, not an incidental side rule.**

### 4.2 Two traps

* **The old frontend is still live.** `/report` (old) and `/report-new` (rewrite)
  are served side by side; the dev configs say "`/report-new/` today, `/report/`
  after the cutover". The old app has its **own** save endpoint
  (`backend/src/o_timeusediary_backend/api.py:1518`) whose payload accepts
  `end_minutes` unbounded. A global backend rule would break every existing
  cross-midnight study in the old app.
* **Existing rows.** Any `activity` with `end_minutes > 1440` becomes invalid.
  Needs a data check plus a `CHECK` constraint in an Alembic migration.

### 4.3 Options

| Option | Description | Cost | Risk |
|---|---|---|---|
| **1a. Global rule** | Cross-midnight forbidden everywhere; rewrite and old app both changed | 4–6 d (rewrite + backend) + 2–3 d (old frontend) | breaks old-frontend studies until both ship |
| **1b. Per-study flag** (recommended if this ships before the cutover) | `Study.allow_cross_midnight` (default `true`); twin studies set it false. Backend rejects tails when false; coverage skips the tail mapping; frontend hides the next-day affordances; export omits the `*_since_diary_start` columns for those studies | 5–7 d + 0.5 d flag plumbing (model, migration, import, admin toggle) | a second branch in validation and coverage to keep tested |
| **1c. Rewrite only** | Change only `frontend_new`, leave the old app and its endpoint alone | 4–6 d | backend still accepts tails; the rewrite would have to ignore them — not honest, not recommended |
| **1d. Nothing** | Keep consecutive days, forbid nothing | 0 | the twin scenario cannot be modelled |

Effort includes the ~21 cross-midnight tests (8 rewrite unit, 5 rewrite e2e,
3 backend unit, 2 backend integration), doc updates (decisions **D5**, **D6**,
**D21** in `frontend_new/plan/PLAN_frontend_new.md`, `docs/agents/frontend.md`,
`README_CREATE_STUDY.md`, export docs) and the data migration.

### 4.4 Effort summary, item 1

| Work package | Days |
|---|---|
| Backend: coverage tail, day axis, last-midnight, payload bounds | 2–3 |
| Rewrite frontend: validation, geometry, timeline, timeRange, neighbours, review, messages, locales, tests | 2–3 |
| Old frontend (if 1a) | +2–3 |
| Migration + data check | 0.5 |
| Docs | 0.5 |
| **Total** | **4–6 d (1b, rewrite+backend)** · **7–10 d (1a, both apps)** |

---

## 5. Item 2 — a name per day

### 5.1 Case A — generic child labels

`twin1_monday` / `{"de": "Montag: Kind A"}` in the study config.

| Work | Days |
|---|---|
| Config authoring (14 day labels instead of 7) | ~0 |
| Fix the day-chip abbreviation: `frontend_new/src/js/ui/formFields.js:80` uses `label.slice(0, 2)`, so both twins render "Mo" | 0.5–1 (needs a real short label: config field + parser + payload + i18n) |
| Add `day_display_name` to the activities export (readable column; the admin previews already show it) | 0.5 |
| **Total** | **1–2 d** |

Not covered: per-child analysis by *name*. The child is only in `day_label`
(e.g. `twin1_monday`) or in a display string — fine for a pivot on the code,
fragile for a parse of the label.

### 5.2 Case B — real per-family names

Needs a per-participant name per day. Two shapes:

* **Override table** — `participant_day_label_names(participant_id, day_label_id, label)`,
  unique on the first two. Smallest schema change; the study keeps its own labels,
  each participant overrides the display text.
* **Subject table** — `study_subjects(participant_id, subject_key, name)` plus
  `day_labels.subject_key`. Cleaner if children later need consent, external tasks,
  completion or aggregation of their own (see §6).

| Work | Days |
|---|---|
| Model + Alembic migration | 1–1.5 |
| Diary payload resolves the override; API for setting names | 1–2 |
| Admin UI to enter/edit the names per participant (a screen, not a table cell) | 1.5–2 |
| Import: extra columns in the participant roster upload (e.g. `pid, t1, t2`) — extends `POST …/import-participants` | 1 |
| Export: name columns in the activities and participants exports | 0.5–1 |
| Frontend: prefer the override in day nav, headings, chips, review, panel | 1–2 |
| Tests (unit + integration + one e2e) | 1.5–2 |
| **Total** | **8–12 d** |

**Data-protection note.** A child's first name is personal data. In Case A it ends
up in a shared study config file in the repository; in Case B it belongs in the
database, where it can be deleted and exported with the participant. Case A is only
acceptable while the labels are generic.

---

## 6. What else this touches (the part that is easy to miss)

1. **External tasks are per participant** —
   `external_task_assignments` is unique on `(external_task_id, participant_id)`
   (`models.py:189`). One assignment per *parent*. If each twin needs their own
   questionnaire link, that is a further model change (assignment per subject).
2. **Consent is per participant** — one consent would cover two children's data.
   That is an ethics / data-protection decision, not a code decision. The
   `save_browser_identification` and `save_ux_events` flags are also per participant.
3. **One submission gate for both children** — `study_submitted_at` is a single
   timestamp, and `min_coverage` now means 14 days of work for one parent.
   `allow_skip_timeuse` ends both children at once. Per-child completion is a
   change to `StudyParticipant`'s completion fields.
4. **Scientific grain** — one row per activity with `participant_id` = parent.
   Pivoting on `day_label` gives per-child data (acceptable per the request), but
   the export documentation must say so and the `*_since_diary_start` axis has to go
   or be redefined (§4.1 #12).
5. **Naming** — a day-label machine name must match `^[a-z0-9_]+$`, so a child's
   name can only live in the display map. Analysis by name would be a string parse.
6. **The "close activities" block** we just added would name another child's day
   ("Ausruhen ab Dienstag 00:00") — it must be suppressed for non-sequential studies.

---

## 7. Option 0 — two studies instead of one (zero code)

The app already supports several studies per participant. Run
`…_twin1` and `…_twin2` with identical 7-day labels, two invitation links, and a
`pid` convention (`family01_t1`, `family01_t2`).

| | |
|---|---|
| **Code cost** | **0** |
| **Data** | clean: two `study_name_short` values, two participant rows, no false day axis |
| **UX cost** | the parent fills two diaries, gets two links; no "one page with both children" |
| **Analysis** | join on the `pid` prefix, or just use `study_name_short` |
| **Names** | in the `participant_id` and/or the study description — no new schema |

This is worth stating explicitly, because otherwise the comparison reads as
"3–4 weeks vs nothing", when the real comparison is **"3–4 weeks vs ~2 days of
setup"**.

---

## 8. Comparison and recommendation

| Option | Days | Per-family names | One page for the parent | Per-child tasks/consent |
|---|---|---|---|---|
| 0. Two studies | **0–2** | via `pid` | no | no (per study) |
| A. Flag + generic labels (1b + 5.1) | **6–8** | no (Kind A/B only) | yes | no |
| B. Flag + per-family names (1b + 5.2) | **14–19** | yes | yes | no |
| C. Global rule + both frontends + names (1a + 5.2) | **17–22** | yes | yes | no |
| D. B/C + per-child tasks, consent, completion (§6.1–6.3) | **+5–10** | yes | yes | yes |

**Recommendation.** Unless the study needs *real per-family names* and *one page for
all children*, run **Option 0**. If the "one page, two children" experience is a
requirement, ship **Option A first** (6–8 days, generic labels) — it proves the
independent-days model with real participants and keeps the door to B open, because
the per-family names are an additive table that does not touch the day semantics.
Do not start with C or D.

---

## 9. Open questions for the PO

1. **One family, or many?** (decides Case A vs Case B — 1–2 d vs 8–12 d)
2. **Do the twins need their own external-task links and their own consent?**
   (possibly the largest single item, §6.1–6.2)
3. **Is `/report` retired before this ships?** (decides whether item 1 is done once
   or twice, and whether 1b's flag is needed at all)
4. **Is "one page for both children" a requirement, or is a second invitation link
   acceptable?** (Option 0 vs everything else)
5. **Does the parent have to fill 14 days, or 7 days per child in alternating
   weeks?** — 14 days doubles the burden and the `min_coverage` gate.

---

## 10. Appendix — how the findings were checked

* `backend/src/o_timeusediary_backend/models.py` — `DayLabel` (study-wide, unique
  `name`/`display_order`), `Participant` (`id` *is* the pid, no attributes),
  `StudyParticipant` (consent / instructions / submission per participant),
  `StudyExternalTaskAssignment` (per participant).
* `backend/src/o_timeusediary_backend/parsers/studies_config.py:618` — day-label
  validation requires only `^[a-z0-9_]+$`, unique name, unique `display_order >= 0`.
* `backend/src/o_timeusediary_backend/coverage.py:86` — the tail→next-label mapping
  is the only place that turns day order into time order on the server.
* `frontend_new/src/js/domain/{validation,geometry,neighbours,review}.js` — the
  client mirror of the same assumption; `absoluteStart`/`absoluteEnd` are the only
  `dayIndex * MINUTES_PER_DAY` sites in the rewrite.
* `frontend/src/js/script.js:4283` — the old frontend keeps its own copy.
* `frontend_new/plan/PLAN_frontend_new.md` — decisions **D5** (one record may cross
  midnight), **D6** (attribution + tail coverage), **D21** (explicit cross-midnight)
  are the documented assumptions this plan would reverse.
