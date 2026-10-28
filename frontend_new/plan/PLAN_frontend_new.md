# Plan: new participant frontend (diary view)

Status: discussion summary, nothing implemented yet. Date: 2026-10-22.

Scope: **only the participant data-entry page** (the diary/timeline view). The admin portal,
the participant text pages (consent, instructions, thank-you, timeout) and the backend
API surface stay as they are, except where this plan says otherwise.

Inputs used for this plan:

- UX prototype by Alex Horré: `~/develop_mpiae/time-diary-frontend-prototype-alex/`
  (mobile entry flow only; its product framing — multiple diaries, waves, calendar days,
  device-only storage — was a misreading of the study and is **not** adopted).
- `diary_UX.md` in that repository (pathways, goals, 17 recommendations).
- Current frontend: `../frontend/src/js/script.js` (~7.5k lines), `ui.js` (~2.8k),
  `styles.css` (~3.8k); backend models in `../backend/src/o_timeusediary_backend/models.py`.

Why we are doing this: the diary view grew into one interlocking module that is no longer
understandable, and the mobile experience has a demonstrated failure — participants did not
discover the optional second timeline and left it empty without intending to. The fix is a
new, small, component-structured implementation of the entry page, not a rewrite of the app.

---

## 1. What stays

- **Day labels stay abstract** (`monday`, `typical_weekday`, …), ordered by `display_order`.
  No calendar dates, no waves, no multiple diaries, no per-diary receipts.
- **One submission per participant per study** (`StudyParticipant.study_submitted_at`).
- **`min_coverage` is enforced at submit**, not while editing.
- **Save after every interaction** to the server (no device-only storage, no offline queue).
- Study configuration, activity catalogues, i18n (en, de, sv — see D34), idle timeout, consent and
  instructions flow, external tasks, exports, admin portal and its tests.

## 2. Decisions

### Entry surface

| # | Decision |
| --- | --- |
| D1 | **One timeline per study.** The `primary`/`secondary` split disappears from the participant UI and the catalogue: no tabs, no switch button, no "what may I log as secondary". One `timelines` row per study is kept, so admin and exports are unaffected. |
| D2 | **Concurrency is overlap, not a second lane group.** Up to N activities may occupy the same minute on the one timeline; display lanes are computed, the data has no lane. N is configurable (default 3, see open question Q1). |
| D3 | **Vertical timeline, continuous across the study's days.** Day sections with headings and anchors; prev/next buttons and a day rail jump (never a mode switch); scroll-spy label ("Day 2 of 7 · Tuesday"); `PageUp`/`PageDown` move one day. A `daysToRender` value in state (`7` = continuous, `1` = paged) keeps the alternative available as a one-line change. |
| D4 | **The reporting day starts at 00:00** (see Q2 for the 04:00 alternative). |
| D5 | **An activity may start on one day and end on the next, as one record** (end shown as `07:00 (+1)`). No splitting into two entries. |
| D6 | **Attribution:** a record belongs to the day it **starts**. **Coverage** is computed per day by clipping intervals to the day window, including the tail of activities that started the previous day. |
| D7 | **Entry always goes through a form dialog** (day, start, end, option/note), prefilled from the tapped time. No drag or resize required. Gap taps open the dialog with that range prefilled. "Used recently" (5) shortcut. "Save and add another" keeps the day and chains `start = last end`. |
| D8 | **Duplicate rejection:** same activity code + same start + same end is refused server-side (relevant because desktop palette placement creates a block on click). |
| D9 | **Undo, not confirmation.** Deleting or clearing offers an undo toast; the only confirm step is submission. |
| D10 | **Review list before submit**, reachable also from the menu: days in order, activities as text time ranges, per-day coverage, *Edit* links back to the day, then a confirm step. |
| D11 | **Colour comes only from the study config** (`activity.color`). The app chrome stays neutral and the app adds no colour of its own. No dark mode. No colour design or colour testing in this project. The block picks black or white label ink by luminance, and falls back to a neutral fill when a study defines no colour. |

### Desktop

| # | Decision |
| --- | --- |
| D12 | **Three columns at ≥1200 px**: [1] days + coverage + submit, [2] timeline, [3] activity palette with search. **Single column below 1200 px** (palette becomes a bottom sheet, days pager in the header). **No 2-column tier** — it would squeeze the timeline and the palette and add a third layout to test. |
| D13 | **No graphical overview strip.** A 24 h bar in a 640 px column is ~4 px per 10 minutes, i.e. unreadable. The "how complete is my week" view is the day rail (coverage bar + minutes + state per day) plus the review list. |
| D14 | **Drag-to-move is a later, optional desktop module** (`pointer: fine` only), expressed as the same `moveActivity()` action the form uses. Resize only if pilot feedback demands it. Keyboard nudge ships from the start. |

### Stack

| # | Decision |
| --- | --- |
| D15 | **No React, no UI library.** Vanilla ES2022 modules, same static delivery. JSDoc + `tsc --noEmit`; a small store (~50 lines), `h()` hyperscript and a keyed list helper (~80 lines together), a pure geometry module, a ~500-line internal kit (Button, Field, Sheet, List, Toast, Timeline), native controls, existing i18n loader. |
| D16 | **No globals.** No `window.timelineManager`/`window.selectedActivity`; one-way flow: DOM event → action → new state → render. Desktop-only enhancers live in one module loaded for fine pointers only; no `isMobile` branches inside renderers. |

### Backend and data

| # | Decision |
| --- | --- |
| D17 | **Row identity:** `client_uuid`, `group_id` (activities created together), `catalogue_version`, `updated_at` on `activities`. Optional `copy_source_uuid`. |
| D18 | **Incremental endpoints** replace the whole-day delete+insert save: create (single or batch with `targets[]`), update, delete, delete-by-group, copy. Submit stays as it is. |
| D19 | **Multi-day add/copy is explicit**: explicit selection → explicit target days, merged into the target (never "replace the day"), per-target result (`added`, `skipped: slot_full`, `skipped: invalid day`), one `group_id` so one undo reverses it. |
| D20 | **Coverage = interval union, clipped to the day window.** One server-side helper used by submit validation, save responses, admin progress and the frontend rail; mirrored client-side and unit-tested. |
| D21 | **Cross-midnight is explicit:** store `duration_minutes` (or a validated `end_minutes`) with a constraint, instead of the current implicit `end > 1440` convention. Dialog validates end > start and a sane maximum (24 h). |
| D22 | **One `timelines` row per study.** Exports and admin queries are unchanged apart from additive columns; the second catalogue (codes `2xxx`) is deleted, since no real data exists (test fixtures only). |

---

## 3. Implicit consequences for the data model and analysis

The following is the part the study leads must see. **Sections 3 and 4 are written in German**
because they are meant to be forwarded to the PI / study designers.

### Was die PI über die Änderungen wissen muss

Aus meiner Sicht müssen wir uns neben dem offensichtlichen Aufwand noch über diese Dinge
klar werden, die sich erst im Verlauf der Diskussion ergeben haben:

**a) Tage sind keine getrennten Ansichten mehr; eine Aktivität darf über Mitternacht gehen**

Bisher musste ein Schlaf von Montag 22 Uhr bis Dienstag 8 Uhr als zwei Einträge erfasst
werden (Montag 22–4 Uhr, Dienstag 4–8 Uhr). Künftig ist das **ein** Datensatz, der am
Montag beginnt und am Dienstag endet.

Implikationen:

- Weniger Datensätze pro Person; die Anzahl der Einträge ist nicht mehr mit früheren
  Erhebungen vergleichbar.
- Ein Datensatz kann länger als 24 h nicht, aber deutlich länger als eine übliche Aktivität
  sein (z. B. 10 h Schlaf). Analysen, die „alle Aktivitäten liegen innerhalb eines Tages"
  annehmen, müssen angepasst werden.
- **Zurechnung:** Der Datensatz gehört zu dem Tag, an dem er **beginnt**. Für die
  Tagesabdeckung (min_coverage) wird er an der Tagesgrenze **abgeschnitten** und zählt
  anteilig zu beiden Tagen. Diese Regel muss in der Datendokumentation stehen, weil sonst
  Tages-Summen nicht reproduzierbar sind.
- Ohne diese Abschneide-Regel wäre ein Tag mit einem über Mitternacht gehenden Schlaf bei
  `min_coverage: 1440` (wie im deutschen Pilot-Setting) nicht mehr erfüllbar.

**b) Es gibt nur noch eine Timeline**

Bisher gab es `primary` (Hauptaktivität, verpflichtend) und `secondary` (parallele
Aktivitäten, optional, `min_coverage: 0`). Künftig gibt es eine Zeitleiste mit bis zu N
gleichzeitigen Aktivitäten.

Implikationen:

- **Die Unterscheidung „Hauptaktivität" vs. „parallele Aktivität" verschwindet aus den
  Daten.** Analysen, die danach gefragt haben („Wie viel Zeit wurde mit Hauptaktivität X
  verbracht, während parallel Y lief?"), sind ohne ein zusätzliches Feld nicht mehr möglich.
  Wenn das gebraucht wird, brauchen wir ein explizites Feld (`role` / `is_primary`), das
  die teilnehmende Person setzt – nicht aus der Reihenfolge erraten. **Das ist die
  wichtigste offene Frage** (Q3).
- Gleichzeitige Aktivitäten sind datenmäßig **gleichrangig**. Es gibt keine implizite
  „Hauptaktivität pro Minute" mehr, auf die man Analysen stützen könnte.
- **Summen können 1440 Minuten pro Tag überschreiten.** Wenn drei Aktivitäten gleichzeitig
  laufen, ist die Summe der Dauern größer als der Tag. „Abgedeckte Zeit" (Union) und
  „Zeit pro Aktivität" (Summe) sind ab jetzt zwei verschiedene Kennzahlen und dürfen nicht
  verwechselt werden.
- **Aktivitätscodes ändern sich:** Der zweite Katalog (Codes `2xxx`, z. B. `2200 Streaming
  Video`) wird gelöscht, weil die Inhalte im Hauptkatalog bereits vorhanden sind (`1200`).
  Jede Code-basierte Zuordnung (Auswertungsskripte, Veröffentlichungen) muss
  auf die neuen Codes umgestellt werden.
- Die Option „zweite Timeline bleibt leer" existiert nicht mehr. Wer bisher bewusst nur die
  Hauptaktivität erhoben hat, erhält jetzt automatisch die Möglichkeit, parallele
  Aktivitäten einzutragen (und ggf. eine Mindestabdeckung, die für alle gilt).

**c) Tagesbeginn: Mitternacht statt 4 Uhr**

Der 4-Uhr-Tagesbeginn war in der alten Oberfläche unsichtbar (jeder Tag war eine eigene
Ansicht). In einer durchgehend scrollbaren Woche wird er sichtbar und wirkt erklärungs-
bedürftig. Deshalb schlagen wir **Mitternacht** vor.

Implikationen:

- Die Zurechnung von Aktivitäten zwischen 00:00 und 04:00 ändert sich gegenüber der
  bisherigen Export-Logik: bisher gehörten sie zum Vortag, künftig zum Kalendertag.
- **Der 4-Uhr-Tagesbeginn ist kein Zufall, sondern die Konvention amtlicher
  Zeitverwendungserhebungen** (u. a. American Time Use Survey, https://www.bls.gov/tus/,
  in der Regel als 4-Uhr-bis-4-Uhr-Tag beschrieben). Wenn Vergleichbarkeit mit solchen
  Erhebungen eine Rolle spielt, ist Mitternacht ein methodischer Nachteil. Bitte prüfen
  (Q2).
- Vorher (getrennte Tagesansichten) war beides problemlos möglich. Mit einer durchgehenden
  Woche hängen die beiden Entscheidungen zusammen: eine Tagesgrenze um 4 Uhr mitten in
  einem durchgehenden Band sieht falsch aus.
- Technisch ist die Alternative billig: ein `dayStartHour`-Wert (Standard 0) in der
  Geometrie- und Abdeckungslogik. Es geht also um eine Methoden-Entscheidung, nicht um
  Aufwand.

**d) Mehrere Tage auf einmal erfassen / kopieren**

Geplant ist, eine Aktivität beim Anlegen direkt mehreren Tagen zuweisen zu können, und
ausgewählte Aktivitäten auf andere Tage zu kopieren (ausdrücklich **keine** „ganzen Tage
kopieren", das ersetzt bisher den Zieltagg vollständig und war eine Fehlerquelle).

Implikationen:

- Kopierte Einträge sind **bewusste Duplikate** über Tage hinweg. Analysen dürfen sie nicht
  als unabhängige Beobachtungen behandeln, ohne dass das entschieden ist. Wir können
  optional festhalten, aus welchem Eintrag eine Kopie entstanden ist
  (`copy_source_uuid`) – bitte sagen, ob das gewünscht ist (Q5).
- Es besteht ein Risiko, dass Teilnehmende Tage „gleich machen", um schneller fertig zu
  werden. Das ist ein Datenqualitäts-Thema, kein UI-Thema, aber die Funktion macht es
  leichter. Wenn das unerwünscht ist, lassen wir das Mehrfach-Anlegen weg und behalten nur
  das Kopieren einzelner Aktivitäten (oder gar nichts).

==> It does not make a difference whether an activity was created manually on its own or copied. It is an activitiy, thats it. we do not need to know where it was copied from.

**e) Änderungsverlauf: es wird weiterhin nur der Endzustand gespeichert**

- Auch mit dem neuen Schreibmodell speichern wir keine Bearbeitungshistorie. Ein Löschen
  ist ein echtes Löschen (Undo stellt den Datensatz neu her, mit neuer ID).
- Neu ist `updated_at`: damit lässt sich sehen, **wann** ein Eintrag zuletzt geändert wurde
  (und wie kurz vor der Abgabe noch editiert wurde). Das ist ein zusätzliches Feld in
  Exporten, wenn gewünscht (Q8).
- Falls für Datenschutz/Qualitätssicherung ein Änderungsprotokoll nötig ist, muss das
  ausdrücklich entschieden werden – es ist ein zusätzlicher Aufwand.

**f) Speichern nach jeder Interaktion bleibt**

- Kein Verhalten ändert sich für die Teilnehmenden: jede Änderung geht sofort an den Server,
  mit sichtbarem Speicherstatus und lokalem Entwurf als Rückfallebene.
- Technisch gibt es dadurch **mehr, kleinere Schreibvorgänge** statt eines Tages-Snapshots.
  Für die Auswertung ist das besser (kein Datensatz wird durch eine spätere Speicherung
  neu erzeugt), für den Server ist es mehr Last. Für die erwarteten Teilnehmerzahlen
  unproblematisch.

**g) Vor der Abgabe gibt es einen Prüfschritt (Review)**

- Teilnehmende sehen vor dem Absenden alle Tage als Liste zur Kontrolle und können
  zurückgehen und korrigieren.
- Folge für die Daten: es wird häufiger **kurz vor der Abgabe** noch geändert. Der
  Abgabezeitpunkt bleibt `study_submitted_at`, aber „letzte Änderung" und „Abgabe" liegen
  jetzt häufiger nah beieinander.

**h) Grenzen, die konfiguriert werden müssen**

- **Maximale Gleichzeitigkeit** (Vorschlag: 3). Höher heißt mehr Daten, aber auch mehr
  Verwirrung; niedriger heißt, dass seltene echte Parallelität nicht erfasst werden kann.
  Bitte festlegen (Q1).
- **Mindestabdeckung pro Tag** bleibt grundsätzlich, gilt aber jetzt für die eine
  Zeitleiste und wird als Union gemessen. Für Studien mit `min_coverage: 1440` ändert sich
  dadurch, welche Tage als vollständig gelten (siehe a).

**i) Studienkonfiguration und Texte müssen angepasst werden**

- Bestehende Studien, die mit zwei Timelines definiert wurden, sind nach der Umstellung
  **nicht mehr gültig** und müssen neu erzeugt werden (Kataloge, `activities_*.json`,
  `studies_config.json`). Da noch keine echten Daten erhoben wurden, ist das unkritisch –
  aber es ist Arbeit und braucht eine Freigabe (Q7).
- **Anleitungstexte, Einwilligungstexte und Studienbeschreibungen**, die von „zwei
  Timelines" oder „Hauptaktivität / paralleler Aktivität" sprechen, müssen neu geschrieben
  werden. Das betrifft auch die im Admin-Portal gepflegten Studien-Texte (Q9).
- Farben pro Aktivität bleiben eine Aufgabe der Studiendesigner. Die App rendert sie nur
  (und wählt die Schriftfarbe so, dass sie lesbar bleibt). Ohne Farbe wird neutral
  dargestellt.

**j) Was sich ausdrücklich nicht ändert**

- Keine Kalenderdaten, keine Wellen, keine mehreren Tagebücher, keine Belege/Quittungen.
- Keine Offline-/PWA-Speicherung nur auf dem Gerät.
- Kein Wechsel der Granularität: 10-Minuten-Schritte bleiben.
- Admin-Portal, Teilnehmer-Textseiten, Exporte (außer zusätzlichen Spalten), Einwilligung,
  Inaktivitäts-Timeout, externe Aufgaben: unverändert.

---

## 4. Open questions for the PI

| # | Question | Why it blocks |
| --- | --- | --- |
| Q1 | **Maximale Gleichzeitigkeit:** 3? Darf dieselbe Aktivität sich selbst überlappen? | Sets `max_overlap`, validation, lane rendering and the coverage rule. |

=>  PI Answer: set max parallel to 2, but keep as a variable. we do not check anything regaring self-overlap for now, no special rules here. users fill in things, thats it.

| Q2 | **Tagesbeginn 00:00 oder 04:00?** Ist die 4-Uhr-Konvention (ATUS-Vergleichbarkeit) für uns relevant? | Determines attribution, coverage clipping, migration of fixtures, and whether the continuous timeline needs the paged fallback. |

=>  Due to the constinuozus scroll and calendar style, we use 00:00.

| Q3 | **Muss „Hauptaktivität vs. parallel" in den Daten überleben?** Falls ja: wer setzt es (teilnehmende Person, Reihenfolge, Regel)? | Decides whether `activities` gets an explicit `role` field. Cheap now, expensive after data collection. |

=>  We do not collect this info anymore.

| Q4 | **Abdeckung als Union mit Abschneiden an der Tagesgrenze** – bestätigt? Und bleibt `min_coverage: 1440` (volle Abdeckung) sinnvoll, wenn Nächte über Mitternacht gehen? | Changes which days count as complete; affects submit gate, admin progress and analysis. |

=>  yes, there still needs to be support to require a coverage. the value (1440) stays a configuration detail. time slots in which several things were done in parallel do not count twice. so if min_coverage = 200, we require 200 minutes of the day to be covered (with 1 or more activities).

| Q5 | **Kopieren/Sammel-Anlegen:** erlaubt? Wenn ja, mit oder ohne Herkunftsmarkierung (`copy_source_uuid`)? Obergrenze an Tagen? | Data-quality and analysis rule; also endpoint design. |

=>  When adding an activiity, one can select several days (up to all days of study) on which this has happened, no limits.

| Q6 | **Katalog-Merge:** Löschen der `2xxx`-Codes und der zweiten Timeline bestätigt? Wer legt finale Aktivitätsliste und Farben fest? | Content ownership; blocks fixture |

=> Yes, the 2xxx codes and 2nd timeline make no sense anymore, they need to go. colors and acitivites are a study configuration, like they have always been. this software aloow scientists to create studies, the studies we ship are NOTHING but examples and test data.

| Q7 | **Bestehende Studien neu aufsetzen** (zwei Timelines → eine) – Freigabe? | Import/validation changes; study configs must be regenerated. |

=> We will adapt the test data in studies_config.json to work with the new system, of course. This includes removing 2nd timeline.

| Q8 | **Änderungsprotokoll nötig?** Reicht der Endzustand, oder braucht es Historie/`updated_at` in Exporten? | Data protection requirement; schema and export design. |

=> No history required.

| Q9 | **Wer schreibt die Texte um** (Anleitung, Einwilligung, Studienbeschreibung), die „zwei Timelines" erwähnen? | Content work must start before the new UI ships. |

=> The study creators are responsible for changing study-specific text, we are responsible for chaing app--specfific text. Study-specific text is changed in studies_config.json fields, app specific text in frontend i18n files.

We drop the help page with screenshots entirely. Its outdated and hopefully not needed anymore, now that UI is easier, like calendar. People dont read this anyways.

---

## 5. Implementation plan

Order matters: the data model first, so there is exactly one write path when the UI lands.

| Step | Content | Rough effort |
| --- | --- | --- |
| 0 | Behaviour checklist: every current diary behaviour that must survive (day labels, timelines→lanes, min_coverage, save state, drafts, idle timeout, study params, browser check, i18n, custom text, frequency options, context menu/delete, accessibility). Wireframes for mobile sheet and desktop 3 columns. | 3–5 days |
| 1 | Backend: row identity + migration, incremental endpoints, coverage union helper with day clipping, multi-day create/copy, duplicate rule, `max_overlap`, delete of the second catalogue and its fixtures, export/test updates. | 1.5–2 weeks |
| 2 | Domain/state layer: store, selectors, pure geometry (minutes↔px, lanes, clipping), API client, save-state machine. Unit tests, no DOM. | 1 week |
| 3 | Mobile view: continuous vertical timeline with lanes, day rail/pager, bottom sheet form, edit/delete/undo, gaps, recent, coverage display, review, submit. Behind a temporary entry point so running pilots keep working. | 3–4 weeks |
| 4 | Desktop layout: same components, 3 columns, searchable palette, keyboard shortcuts, optional drag-to-move module. | 1–2 weeks |
| 5 | Cutover: port the e2e specs to the new flows (45 specs today, most pin the old interaction model), accessibility pass, i18n pass over the 3 remaining locales (en, de, sv), then delete the old timeline modules, drag/long-press engine, switch-timeline code, old save endpoints and dead CSS. | 1–2 weeks |

Order of magnitude: **8–12 weeks for one developer**, with mobile usable around week 6–7.

### Success criteria

- New diary code ≈ 2–3k lines + CSS, no globals, no drag engine, one renderer, one add/edit
  component, one save path (today: ~14k lines across `script.js`, `ui.js`, `styles.css`).
- Every checklist item covered by a unit or e2e test.
- Save-after-every-interaction still true, with per-row calls, visible save state and undo.
- Multi-day copy is one action, one undo, with per-target failure reasons.
- Admin portal and its tests unchanged.

### Cheap to reverse

- `daysToRender` (`7` continuous / `1` paged) — one value in state.
- `dayStartHour` (default `0`) — one constant in geometry and coverage.
- Drag-to-move — one optional module, loaded only for fine pointers.

---

## 6. Explicitly out of scope

Calendar dates, waves, multiple diaries, per-diary receipts, offline/PWA storage,
admin portal redesign, dark mode, colour design or colour testing, a 2-column layout tier,
a graphical overview strip, drag/resize at launch, React or any UI library, changes to the
study import format beyond dropping the second timeline.

---

## 7. Decisions from the 2026-10-27 prototype review

Source: `~/develop_mpiae/time-diary-frontend-prototype-alex/` (design system, `src/page.py`,
`src/app.js`, its README/HANDOFF and Playwright checks). These decisions settle the questions
that section 5 assumed; where they contradict earlier text, this section wins.

### D23 — Prototype reuse: hybrid

Keep the design layer, rewrite the JS. The prototype is two artefacts with different value.

| From the prototype | What we do |
| --- | --- |
| `design-system/components/bundle.css` (125 `td-` classes), `tokens.css`, `tokens.json` | Copy. Drop the `prefers-color-scheme: dark` block (D11: no dark mode) instead of shipping it untested. |
| 11 component READMEs, `screens.md`, `accessibility.md`, `data.md` | Copy as the behaviour + accessibility spec; they are step 0's checklist, already written. |
| Static shell markup in `src/page.py` (topbar, main, `<dialog>`, drawer, popover, toast) | Copy by hand (~200 lines). Not the generator, not the demo catalogue. |
| `segmentsFor` (lanes), `coverageFor` (union), gap generation, `fillEnd` (+1 day), `fullAt` (overlap limit), multi-day `targets`/`group`, `dayInView`/`timeInView` | Port into pure modules with unit tests. |
| `src/app.js` as a whole, `src/page.py` as a generator, generated root files, `dist/`, `tools/` | Do not copy. IndexedDB-only persistence, fixed demo clock, diary/date model, no server, no i18n, one IIFE with module-scope state — the coupling D15/D16 remove. |
| `tests/*.cjs` | Convert into e2e specs: last day ends at midnight, one jump per day-nav tap, toast/live-region placement, one `<main>` per view. |

Consequences to plan for: the prototype needs `<dialog>`, the `popover` attribute and `:has()`,
so the `bowser` floor in `js/client_info.js` has to be re-decided; and the prototype is English-only
where we need the 3 locales (D34).

### D24 — Granularity stays 10 minutes

The prototype works in 15-minute steps (`Q = 96`); the app keeps `INCREMENT_MINUTES = 10`
(`frontend/src/js/constants.js`). Geometry is px-per-minute, so the prototype's `--quarter`
token becomes `--ten-min`.

### D25 — The old whole-day save path stays until cutover

- New `activities` columns are nullable/defaulted so the existing
  `POST …/day_labels/{name}/activities` keeps working unchanged.
- No translation layer between snapshot saves and row writes: the new UI uses only the new
  endpoints, one write path once the UI lands.
- Shared semantics (coverage union, overlap, duplicate rule, collection-window/paused/submitted
  guards) live in one place so the two writers cannot drift.
- Dropping the second timeline and the `2xxx` codes moves from step 1 to step 5 (cutover): the
  old frontend and ~43 e2e specs still pin them, and they cost nothing to keep.
- The old endpoint's day-wide delete does not touch new rows beyond the day it rewrites. One
  participant uses one frontend; write that down rather than code around it.

### D26 — `day_start_minutes` becomes a study field

Old frontend day window is 04:00–04:00 (`TIMELINE_START_HOUR = 4`); the new UI is 00:00 (Q2).
Two frontends over one table with different day windows is a data-semantics bug, so the window
moves into the study: `Study.day_start_minutes`, default `0`, legacy studies imported with `240`.
Coverage clips to that window; the geometry reads it from study config instead of a constant.

### D27 — Additions to the backend list (section 5, step 1)

- `client_uuid` is for **idempotency** as much as undo: save-per-interaction plus retries
  duplicates rows without it. Unique per (study, participant).
- Duplicate rejection (D8) must be a DB constraint, not only a check.
- `CHECK (end_minutes > start_minutes AND end_minutes - start_minutes <= 1440)` for D21.
- `Timeline.max_overlap` (default 2, PI answer to Q1) next to `min_coverage`.
- One `coverage.py`: union + clipping is currently summed in three places — submit validation,
  admin progress and the "days meeting min coverage" helper — and `_get_completed_day_indices`
  ("has any data") guards copy-overwrite.
- `GET …/participants/{id}/diary`: the continuous view needs the whole diary in one request.
- `copy_source_uuid` is still an open question (Q5 answered multi-day, not provenance). Add the
  nullable column now; after data collection it is expensive.

### D28 — Desktop UI/UX (external review, 27 Oct 2026)

The three "extra content" blocks the review flags are prototype-only text in `src/page.py`:
the topbar note ("Desktop layout prototype · 7 days · sample data"), the rail note, and the
docked panel's idle copy. All three go. In their place:

- **Rail (column 1):** days with real coverage (already there) plus per-day state
  (complete / incomplete) against `min_coverage`, submission state, and Submit — one place,
  not two.
- **Dock (column 3):** coverage feedback for the day being edited ("1 h 20 min to go") instead
  of instructions, plus *Used recently*.
- **Topbar:** a compact progress figure ("4 of 7 days complete") instead of the prototype note.
- **Completion is not minutes.** The prototype gates Submit on "every day has any activity";
  the real rule is `min_coverage` per day, and that is the signal the UI shows (already D20).
- **Toast** is `position: fixed` today and lands viewport-right when the panel is docked; anchor
  it to the third column instead. Do not rely on `html:has(#add[open])` for scroll lock.
- **Gap blocks stay** (the fastest catch-up path), limited to gaps of at least 30 minutes and
  never leading/trailing, as in the prototype.
- **Colour** stays study-config only; the `td-pat--*` category patterns are only the
  no-colour fallback.

Settled by D29: the catalogue is always visible on desktop and a palette click opens the form
(prefilled) rather than creating a block.

Settled since: D30 (search), D31 (keyboard), D32 (Review as a modal). Step 4 no longer has open
questions; D33 is the binding architecture contract for all of steps 2–5.

### D29 — Desktop column 3: one panel whose content swaps

The catalogue is roughly 61 codes and six screens tall, so nothing may be placed below it. Column 3
is therefore a single fixed-height panel (`100dvh - topbar`) with a sticky head, one scrollable
content region and a sticky foot:

- **Default content on desktop is the catalogue**, always present, with a pinned search field,
  sticky category headings and *Used recently* on top. No "Add activity" reveal; the floating
  button stays hidden on desktop as it is now.
- **Selecting an activity replaces the content region with the form.** Never stacked, never
  appended. `←` returns to the list and restores the search query and scroll offset, which is
  what makes `←` usable at all with this many rows.
- **The head names the target explicitly** ("Add activity · Tue 20 Oct, 14:00 – 15:00"). The panel
  is non-modal and column 2 keeps scrolling while it is open, so the day in view is *not* the
  target: the `Day` select is authoritative, and the head states it.
- **The head's second line carries the day context and coverage** — for the day in view when
  browsing the catalogue, for the target day when the form is open ("6 h 45 min · requirement met",
  or "1 h 20 min to go"). This is where the external reviewer's point A lands; it replaces the
  prototype's explanatory copy and removes the need for a separate instructions block.
- **The foot stays sticky** (Add to timeline / Save and add another / Save changes / Delete), so the
  primary action remains visible even when the form's lower fields scroll. Worst case at 768 px
  viewport height: content region 568 px, form ≈ 400–590 px.
- **Consequence for the write path:** a palette click never creates a block. It opens the form
  prefilled with the time at the top of the viewport, and D8's duplicate rule applies to form
  submits only. One create path, one undo path.

Rejected alternatives: a sticky form sheet over the scrolling list (eats 50–60 % of a 380 px column
and leaves two scroll regions in one narrow column), and the prototype's on-demand dock (costs a
click and idles the column).

### D30 — Activity search in the panel head

The catalogue is ~61 codes in the pilot study, so search is not optional, and it is not a "nice to
have later" item: both the desktop panel and mobile step 1 need it.

- **Placement:** a search field in the fixed part of the panel head, directly under the title row,
  so it never scrolls out of view. Hidden (not disabled) in the form state, restored on `←` with
  the previous query and the previous scroll offset.
- **Matching:** localized activity name, option/parent labels, example/hint text and category name,
  from the backend `activities-config` payload — not a hardcoded list. Case- and accent-insensitive
  (NFKD + diacritic stripping) because German and Swedish both carry diacritics (ä/ö/ü/ß, å/ä/ö)
  while English does not; word-start matches rank before inner-substring matches.
- **Result rendering:** matching activities stay grouped under their category headings; categories
  with no match are hidden, not left as empty headings. *Used recently* is shown only while the
  query is empty. A live region announces the result count; no match reads "No activity matches
  …, try Other activity".
- **Keys:** `Enter` selects the first result, `Esc` clears the query, then returns focus to the list.
- **Implementation constraint:** filtering must replace only the result list, never the input node —
  re-rendering the head on every keystroke loses focus mid-word. 61 items need no debounce.

### D31 — Keyboard model: ship it, confined, but no onboarding screen

Single-key shortcuts are a WCAG 2.1.4 problem if they are global, and that constraint also answers
the "how do we teach it" question:

- Allowed keys: `PageUp`/`PageDown` = previous/next day, `n` = new activity, `/` = focus search,
  `Esc` = close panel / clear search, `Enter` = confirm, `Delete` = delete while the form's delete
  action has focus, `?` = shortcut list.
- **Single-character shortcuts are active only while focus is inside the diary region** (timeline or
  panel), never globally, and never while a text field has focus. This satisfies 2.1.4 without
  remapping.
- **Teaching surface:** one menu entry, *Keyboard shortcuts*, opens a compact list and contains the
  on/off switch for participants who don't want them. No separate page, no screenshots, no
  onboarding step. Controls that have shortcuts carry `aria-keyshortcuts`.
- Desktop only (`pointer: fine`); nothing here is reachable on touch.

Built in `src/js/ui/keyboard.js` (rules, pure) + `ui/shortcuts.js` (binding + menu entry) +
`ui/shortcutsDialog.js` (the list and the switch). Three findings from building it:

- **Paging is not a single-key shortcut**, so `PageUp`/`PageDown` work outside the diary region;
  they are suppressed only inside a control that pages its own content (`<select>`, `<textarea>`).
  Confinement applies to `n`, `/`, `?` and `Delete`.
- **The switch remembers for the session only.** D33 forbids device storage and there is no
  participant profile to hang a preference on yet; a server-side preference is a later decision.
- **Enter had to be spelled out.** The form has no submit button, so implicit submission reloaded
  the diary, and a `<select>` never fires it. `Enter` now saves (except in a textarea), which is
  what the list promises.

The menu's instruction-page entries (study information, data protection, contact) are removed
until the pages exist: an entry that does nothing is worse than no entry.

### D32 — Review is a modal

Review keeps the prototype's presentation: a centred modal, max-width ~720 px, sticky head and foot,
focus trapped, one scroll region, days in order with *Edit* links back to the day, then the confirm
step. It does not replace the middle column: reviewing is a focused task, and swapping the timeline
out would add a third state to column 2 for no gain. On desktop it is deliberately not docked into
column 3 — it is wider than that column and unrelated to the activity palette.

### D33 — Component architecture: separate, testable components instead of a god module

This is the failure the rewrite exists to fix. The current diary is ~31k lines of JS
(`js/script.js` alone is 7.5k) over ~3.8k lines of global CSS, and the prototype shows the same
shape at small scale: one 830-line IIFE with module-scope `diaries`, `entries`, `viewing` and `view`,
and renderers that reach into the document by id. **We port the prototype's algorithms, never its
structure.**

Layout and dependency direction (arrows point at the allowed import direction):

```
src/
  index.html
  styles/  tokens.css   base.css   layout.css          (shell + grid only)
  js/
    domain/    pure: geometry, coverage, days, validation, formatting
    data/      api client, study config, i18n loader
    state/     store, actions, selectors
    ui/<component>/<component>.js + <component>.css
    main.js    composition root
```

```
main ──▶ ui ──▶ domain
  │       ▲
  ├──▶ state ──▶ domain
  └──▶ data ──▶ domain
```

Rules. Each is checkable, and the ones marked *(CI)* are enforced, not requested:

1. **One-way dependencies.** `domain` imports nothing from the app. `ui` and `state` may import
   `domain`, never `data`. Only `main.js` imports `data` **and** `state` *and* `ui`. No cycles. *(CI)*
2. **No globals.** No assignment to `window.*` or `globalThis.*`. Module-level mutable state exists
   only in `state/store.js`; configuration is passed in through `config.js`, not read off `window`. *(CI)*
3. **One-way data flow.** DOM event → action → store → subscriber re-render. A component never calls
   the API and never mutates state; persistence lives in `state/` actions and `data/`.
4. **Component contract.** Each component exports `mount(root, props, emit) → { update, destroy }`,
   plus pure `render…` helpers. A component may only touch the DOM inside the root it was given;
   `document.querySelector` outside that root is forbidden, and `main.js` resolves each root once.
5. **CSS ownership.** One stylesheet per component, `t-<component>` block prefix (`t-timeline__event`).
   No selector may reach into another component's classes, no id selectors, no `!important` (the
   single global `[hidden]` rule excepted), no colour literals — tokens only. Inline styles are
   allowed only for CSS custom properties set from data (`--start`, `--dur`, `--lane`, `--fill`),
   as the prototype already does. *(CI)*
6. **Explicit, minimal state.** One object with named fields; derived values live in selectors, never
   in the store; UI state is limited to what must survive a re-render (panel mode, search query,
   target day/time, focus target).
7. **Size caps:** 300 lines per JS file, 150 per CSS file, one component per file. This is the rule
   that actually prevents a new `script.js`. *(CI)*
8. **Test layer per boundary.** `domain` and `state` are unit-tested with `node --test` and no DOM —
   every rule in D20/overlap-limit/duplicate/last-day/coverage is a domain unit test, not an e2e.
   Each component gets a mount test on a fixture page (Playwright project `tests/components`).
   End-to-end specs cover flows only.
9. **Enforcement:** `tools/check-architecture.mjs` (Node, no new dependencies) fails CI on rules
   1, 2, 5 and 7, and `tsc --noEmit` over JSDoc keeps the contracts honest (D15).
10. **Naming:** components are named for the domain noun — TopBar, MenuDrawer, DayRail, Timeline,
    DaySection, ActivityEvent, GapSlot, NowLine, ActivityPanel, ActivitySearch, AddActivityForm,
    ReviewDialog, ToastHost — so the file tree is the map of the UI.

The composition root (`main.js`) is the only file allowed to know about everything, and it carries
the same 300-line cap, so "wiring" can never become the new god module.

### D34 — UI languages: English, German, Swedish only

i18n stays; the locale set shrinks to `en`, `de`, `sv`. `es`, `fi`, `fr` and `pl` are dropped from
now on — in the old frontend, in the new one and in anything imported from a study config.

What this does *not* change: one JSON file per language, `data-i18n` attributes, the selector driven
by the study's `supported_languages`, and switching language without a reload. Only the set of files
gets smaller, and no component may hardcode a user-visible string.

What has to move with the decision:

- **Delete** `frontend/src/locales/{es,fi,fr,pl}.json`. `locales_consistency.test.js` and
  `locale_values.test.js` discover files by directory listing, so the guards keep working unchanged;
  only their `LANGUAGE_NEUTRAL_VALUES` entries that existed for es/fr ("No", "Error", "Code",
  "Description") become dead and should be cleaned out.
- **Trim** `FOOTER_LINK_LABELS` in `frontend/src/settings/tud_settings.js` (7 languages today).
- **Trim** the day-label `display_names` maps in `frontend/src/settings/studies_config.json`: they
  still carry `es`, `fi`, `fr`, `pl` although `supported_languages` is already `["en","sv","de"]` /
  `["en","sv"]`.
- **Backend:** nothing is allow-listed today — `supported_languages` comes from the study and is
  validated against the activity blobs and the day-label `display_names` (`api.py:3053-3151`). Add a
  single module-level constant of UI-supported languages and reject anything else at study import,
  so a future config cannot reintroduce a locale the app can no longer render. Same constant serves
  the export/validation error messages.
- **New frontend:** new keys go to `en`, `de`, `sv` only. This is where the effort saved actually
  lands: the ported prototype copy is English-only and has to be translated twice, not six times.
- **Docs:** section 1 and the cutover step in section 5 now name the three languages instead of
  "7 locales".

### D35 — Locale keys: `diary.*` namespaces in the shared files, no version prefix

The new UI adds its strings to the existing `frontend/src/locales/{en,de,sv}.json`, under a
`diary.*` root with one subtree per component, and never reuses an old diary key.

Rationale, in the numbers: the three files hold 166 leaf keys today, 84 of them diary-surface
(`messages` 41, `modals` 25, `buttons` 13, `errors` 3, `banner` 2); the other 82 belong to consent,
instructions, tasks, open studies, thank-you, timeout, `common`, footer, maintenance and idle
timeout — pages this rewrite does not touch.

- **No version prefix** (`v2.`, `new.`, `beta.`). It encodes a transient fact into a permanent
  artefact: at cutover the keys are either renamed across three files, the markup and the code, or
  the prefix stays forever. It also says nothing about ownership.
- **Namespace by component**, mirroring D33: `diary.timeline.*`, `diary.dayRail.*`,
  `diary.activityPanel.*`, `diary.activitySearch.*`, `diary.addActivity.*`, `diary.review.*`,
  `diary.submit.*`, `diary.toast.*`. The set is deletable in one sweep at cutover, and it makes the
  rule below enforceable.
- **Shared files, not forked ones.** The new diary page still needs shell strings (footer links,
  language label, maintenance banner, idle timeout). A forked file would either duplicate them
  (drift, and `locales_consistency.test.js` only compares within one directory) or force the loader
  to merge two files.
- **Reuse shell keys freely, never reuse diary keys.** `common.*`, `footer.*`, `maintenance.*`,
  `idleTimeout.*` stay shared. Old diary keys (`messages.*`, `modals.*`, `buttons.*`, `errors.*`,
  `banner.*`) are not referenced by the new UI, because the copy is being rewritten (D28–D31) and
  because they are scheduled for deletion.
- **Allowed references rule:** the new frontend may use `diary.*` plus the shell allowlist above.
  Anything else is a bug — it would tie the new UI to keys that disappear at cutover.
- **Plain text only.** No `data-i18n-html` in the new UI; split a string into title and body instead
  of embedding markup, so `locale_values.test.js` has nothing to police.
- **Counts use `{{count}}` with `_one` / `_other`** and a small `tCount(key, n)` helper. The
  prototype concatenates (`'… for ' + n + ' days'`), which does not survive German or Swedish word
  order; en/de/sv need exactly two plural forms, so no CLDR machinery is involved.
- **Enforcement:** `page_i18n_keys.test.js` scans a fixed root (`frontend/src/`); it needs a second
  instance for `frontend_new/src`, or the directory parameterised, otherwise the new UI's key
  references are unguarded. Add a test for the allowed-reference rule in the same pass.
- **At cutover** the 84 old diary keys are deleted together with the old `index.html`/`script.js`,
  verified by a single grep for `data-i18n=` and `t(`.

### D36 — Publication seam: build C now, defer A/B/D, keep three hooks

Priority is shipping the new frontend. Generality is a later concern, so only the work that is
cheap now and expensive later is done now. Estimates are one developer on this codebase.

| Item | Now | If deferred | Verdict |
| --- | --- | --- | --- |
| **C.** Host-agnostic `mount()`: components take `scrollRoot` / `portalRoot`, never write `document.documentElement`, never listen on `window` | 0.5–1 day | 5–10 days (retrofit scroll/portal in every component, re-verify sticky/scroll-spy, add contained layout mode) | **do now** |
| **A.** `trac.study/v1` + `trac.diary/v1` documents, JSON Schema, `tud studies validate` | 6–9 days | 8–12 days | defer |
| **B.** `SubmitSink` port + webhook + outbox/retry + delivery state in admin | 6–9 days | 7–10 days | defer |
| **D.** Standalone URL contract + `postMessage` lifecycle + iframe embedding | 3–4 days | 3–4 days (stays cheap because of C) | defer |

A+B+D ≈ 15–22 days, i.e. +30–40 % on top of the 8–12 week plan, with no value for our own studies.

**Three hooks (<1.5 days total), so deferring is a delay and not a bet:**

1. `schema_version: "1"` in the whole-diary GET and in the study payload (D27). Promoting either to
   a published document later is then additive instead of a breaking change.
2. One backend function owns "a diary was submitted" (`deliver_submission(study, participant,
   payload)`); today it only writes `study_submitted_at`. A webhook sink later is a second call
   inside it, not a redesign of the submit endpoint.
3. C's two parameters. Free while writing a component, a rewrite afterwards.

**Cost of the mandatory core (D33):** rules that cost nothing (naming, one component per file,
size caps, import direction, CSS prefix, no globals), rules that cost a little (per-component CSS
and its enforcement), and rules that cost real time: fixture-page component tests ~1–2 days of
infrastructure, `check-architecture.mjs` ~1 day. Total ~2–3 days, about 4 % of the plan — and both
are kept, because an unchecked size cap is a comment and an unverified "isolated component" is a
claim.

**Deferral triggers, so "later" does not become "never":**

- **A** — when a partner wants to import a study, or a second installation must share definitions.
- **B** — when a study's data must land in REDCap/JATOS/a warehouse; then via the webhook receiver,
  not a storage driver.
- **D** — when a survey platform wants to embed the diary; the deliverable is the URL contract plus
  `postMessage`, not a JS widget.

Explicitly rejected for v1: a storage-driver abstraction (REDCap/JATOS have different write models:
bulk record overwrite and one result blob), offline sync, a plugin system, and in-page JS-widget
embedding (would require a contained layout mode; an iframe reaches the same platforms for a
fraction of the cost).

---

## 8. Decisions after the build started

### D37 — Navigation is a stage machine, not a set of redirects

The old frontend decides "where does this participant belong now?" in five places: ~25
`location.href` assignments across `script.js`, `consent.html`, `instructions.js`, `tasks.html` and
`ui.js`, a whitelist of page names (`getSafeRedirectUrl('instructions.html')`), path sniffing
(`isInstructionsPagePath()`), a `completion_status` flag copied through the query string so one page
can tell the next what it decided, and a second copy of the same facts in `CURRENT_STUDY_CACHE`
(`localStorage`). Each page re-derives the rules on load, so a stale cache produces a wrong redirect.
The root cause is one thing: **progress was carried in the URL and the decisions were made in the
browser.**

A participant has exactly one stage:

| Stage | When |
| --- | --- |
| `unavailable` | study paused, closed, or outside its collection window |
| `consent` | study requires consent and it has not been given |
| `instructions` | instructions required and not completed |
| `tasks` | external tasks pending, or the diary is done and `require_diary_before_external_tasks` is satisfied |
| `done` | submitted (or otherwise finished); thank-you, nothing editable |
| `diary` | everything else |

- **The server computes it**, in one function, from what it already knows (`require_consent`,
  `consent_given`, `instructions_completed`, `study_submitted_at`, pending external tasks,
  `ensure_study_is_currently_available`). One test per row of that table. The client renders; it does
  not decide.
- **Every mutation returns the next stage** in its response body. Consent → `instructions`,
  instructions complete → `diary`, submit → `done` or `tasks`. No reload to learn what happened, no
  flag in the URL.
- **The URL carries identity only** — `study`, `pid`, `lang` — never progress. That rule alone
  removes `completion_status` and the page-name whitelist.
- **The client router maps URL → view, and the only redirect is a guard**: on load it asks for the
  stage and, if the URL names a different one, `router.replace(stageRoute(stage))`. One function, one
  redirect.
- **Route style: hash (`#/consent`) for now**, behind a `domain/router.js` seam so path routes
  (`/consent` + `try_files $uri /index.html` + `<base>`) are a change in one file later. The app is
  served from at least three places with different path prefixes (dev nginx, CI, the GH-Pages demo),
  the assets in `index.html` are relative, and none of that has to be solved before the pilot.
- **Returning from an external task** re-asks for the stage on `visibilitychange`/focus instead of
  trusting a cached flag.
- `CURRENT_STUDY_CACHE` is replaced by the store, re-derived from one endpoint on load — which also
  keeps D33's no-device-storage rule intact.

Not adopted: server-side 302 chains (that is the current design), per-route guard logic duplicated in
JS, and any router dependency. `hashchange`/`popstate` plus a parse function is ~100 lines.

**Built.** Three refinements to the sketch above, all of them simplifications found while building it:

- **No separate `GET /session`.** `GET …/study-config` already returns the participant's consent,
  instruction and submission state plus every study text the views need, so it gained `stage` and
  `done_reason` instead of a second endpoint duplicating 90 % of its payload. Consent,
  instructions-complete and both submit endpoints answer with the next stage.
- **`done` carries a reason** (`completed` or `noconsent`), because the thank-you text differs. A
  declined consent wins over `unavailable`: telling someone "try later" would invite them back to a
  decision they already made.
- **After any step the client re-asks.** The stage alone is not enough to render the next page
  (`done_reason` decides the text), so `ui/stageMachine.js` refetches once per transition rather than
  patching its cached payload from several responses.

**Deployment (the rewrite is served next to the old app, not instead of it).** `frontend_new/src` is
mounted at `/report-new/` with the API at `/tud_backend/` and the shared locale files at `/locales/`,
in both the dev nginx config and the CI config, so a study can be piloted on the new UI while every
other study stays on the old one. No second set of `run_dev_*` / `test_*` scripts: each environment
has one nginx config with both locations and one settings file per app, copied into the served tree
exactly like `tud_settings.js` is today. The rewrite therefore reads `apiBaseUrl` and `localesUrl`
from `js/config.js` and must work under any host or path prefix. Cutover is deleting the old
`location` block, not a migration.

### D38 — Consent is a one-way latch

Once recorded, `consent_given` does not go back to false inside this application. Withdrawal happens
through other means, outside the app, so the consent stage is a latch and not a state that can be
re-entered by the participant. This is what makes the `consent` row of the D37 table a simple
one-shot check rather than a review screen.

### D39 — "Unavailable" says why, and a submitted diary outranks a closed window

Found while building the fixture studies, and fixed in three parts.

**One page, three situations, one sentence.** Paused, not started yet and already over all resolved
to `available = False` and the same copy, which told a participant who arrived a week early to
"contact the research team" - the wrong advice for every situation except the last. The server now
reports `unavailable_reason` (`paused` | `not_started` | `ended`) next to `stage`, computed by one
function (`study_availability` in `api_deps/diary_access.py`) that the 403, the stage machine and the
page all share. The page names the date for the two window reasons. Precedence is `ended` →
`not_started` → `paused`: the date is what the participant can act on, so it wins over the pause
switch, and "paused" only describes a study that would otherwise be open. Dates come from the study
payload and are formatted in **UTC** (`formatStudyDate`), because the collection window is a study
administrative boundary, not a local appointment - and it keeps the four timezone legs of the e2e
suite deterministic.

**The read endpoint refused to answer.** `GET …/study-config` raised 403 for an unavailable study
*before* computing the placement, so the rewrite could never render the page at all: it landed in its
generic failure text instead. The endpoint gained `include_unavailable=true`, off by default. The
rewrite passes it and receives `stage=unavailable` plus the reason; the old frontend keeps its 403
signal until cutover (D25), and every write endpoint still refuses with `study_unavailable`.

**Submitted outranks availability.** `resolve_placement` checked availability before submission, so a
participant who had handed in a diary saw "study not available" on any revisit after the window
closed, and could not reach an external task they still owed. The order is now
`declined → submitted (tasks / done) → unavailable → consent → instructions → diary`: a finished
participant is finished, for the same reason D38 gives for consent, and outstanding tasks stay
reachable after the window so they can be completed. This is a change to the D37 table and is pinned
per row in `tests/unit/test_stages.py`; the seam between old and new client is covered by
`tests/integration/test_study_config_unavailable.py`.

### Open, deferred: idle timeout that tears down the session

Stakeholders asked for the idle timeout to *"prevent other family members from continuing in an open
browser session"*. The old implementation pursued that by `location.replace`ing to `timeout.html` with
the participant id stripped from the URL, which is a URL trick standing in for a session, and it costs
a real feature (a participant returning to their own open browser is locked out).

Recorded, not built. Priority Z: it is a request to make the app work worse on purpose for a threat
this application does not really face (writing someone else's time-use diary is not an attack worth
mounting), and it must not be paid for out of the pilot budget. If it is ever built, the honest form
is a server-side session token with an expiry — not URL manipulation — and the participant's own
return is then the thing that must keep working.

What the new frontend does instead, and what D37 already gives us: the stage is re-verified from the
server on every load, so a stale tab cannot act on stale permissions. A blank-screen "continue"
overlay is all the idle behaviour we ship until a decision is made.

### D40 — One `Page`, one header, study name as eyebrow

The five stage pages had grown five different anatomies: the study name as `h1` on consent and
unavailable, the study's own instructions title as `h1` on instructions, a generic title on tasks and
no `h1` at all on thanks; three of them indented their heading 16 px relative to their own body text
because `.t-stage` and `.t-page-head` both added page padding; the thanks page then centred everything
inside a third layer. Measured at 1440 px: heading at x=416, prose at x=400 and buttons at x=400 with
a 640 px width while prose stopped at 595 px. On top of that, `.t-topbar` was a flex item with
`margin-inline: auto`, so it **shrink-wrapped to 173 px and floated centred** instead of spanning the
app - the border under the header stopped mid-screen, and on desktop the header sat over the middle
column only.

Three decisions, implemented together because they are the same surface:

1. **One `Page` component** (`ui/page.js` + `styles/page.css`) for every stage: an optional eyebrow
   (the study name), one `h1` (the stage's own purpose), an optional lead, a body and an action
   footer. Variants `--confirm` (thank-you: mark, centred) and a notice body (unavailable). Each view
   now only supplies content; none of them owns padding, headings or alignment. Exactly one `h1`
   per page, always the stage title.
2. **Study text is content, not page structure.** The page owns the `h1`, so
   `renderMarkdown(text, { headingOffset: 1 })` demotes study headings by one level (h1 → h2 … h6 →
   h6). That is what removes the "three `h1`s and an `h2` → `h4` jump" axe failure without asking
   study authors to renumber their texts. `.t-prose` gained rules for `a` (ink, underlined - the
   browser-blue default was the only chroma on a monochrome page), `h2`–`h6` (never smaller than body
   text) and `overflow-wrap: anywhere` (a long URL in a consent text must not scroll the page
   sideways).
3. **The header is a bar, not a pill.** `.t-topbar` is owned by `layout.css` alone (it was defined in
   `components.css` too, with `position: fixed` and `margin-inline: auto`), spans the app width, and
   carries an inner row aligned to `--shell-max`, so the header, the day rail and the timeline start on
   the same edge. The app title stays the study name for now; a per-stage document title is a later,
   separate change.

Consequences: `.t-prose`, `.t-confirm*` and `.t-page-head` left `components.css` (one owner per
class), the dead prototype page frame (`.t-pages`, `.t-page__head`, `.t-page__body`) and the unused
category patterns, popovers and save chips were deleted, and the failure state is a real page with a
title and a *Try again* action instead of one grey sentence.

Same pass, same reasons: the UI language now follows the study when the URL does not name one (it
used to fall back to `en` around German study text), switching language re-renders the stage that is
on screen, the menu offers only the study's `supported_languages`, and a stage transition moves focus
to the new `h1` instead of dropping it on `<body>`.
