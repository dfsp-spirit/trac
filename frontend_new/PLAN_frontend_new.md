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
- Study configuration, activity catalogues, i18n (7 locales), idle timeout, consent and
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
| Q2 | **Tagesbeginn 00:00 oder 04:00?** Ist die 4-Uhr-Konvention (ATUS-Vergleichbarkeit) für uns relevant? | Determines attribution, coverage clipping, migration of fixtures, and whether the continuous timeline needs the paged fallback. |
| Q3 | **Muss „Hauptaktivität vs. parallel" in den Daten überleben?** Falls ja: wer setzt es (teilnehmende Person, Reihenfolge, Regel)? | Decides whether `activities` gets an explicit `role` field. Cheap now, expensive after data collection. |
| Q4 | **Abdeckung als Union mit Abschneiden an der Tagesgrenze** – bestätigt? Und bleibt `min_coverage: 1440` (volle Abdeckung) sinnvoll, wenn Nächte über Mitternacht gehen? | Changes which days count as complete; affects submit gate, admin progress and analysis. |
| Q5 | **Kopieren/Sammel-Anlegen:** erlaubt? Wenn ja, mit oder ohne Herkunftsmarkierung (`copy_source_uuid`)? Obergrenze an Tagen? | Data-quality and analysis rule; also endpoint design. |
| Q6 | **Katalog-Merge:** Löschen der `2xxx`-Codes und der zweiten Timeline bestätigt? Wer legt finale Aktivitätsliste und Farben fest? | Content ownership; blocks fixture |
| Q7 | **Bestehende Studien neu aufsetzen** (zwei Timelines → eine) – Freigabe? | Import/validation changes; study configs must be regenerated. |
| Q8 | **Änderungsprotokoll nötig?** Reicht der Endzustand, oder braucht es Historie/`updated_at` in Exporten? | Data protection requirement; schema and export design. |
| Q9 | **Wer schreibt die Texte um** (Anleitung, Einwilligung, Studienbeschreibung), die „zwei Timelines" erwähnen? | Content work must start before the new UI ships. |

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
| 5 | Cutover: port the e2e specs to the new flows (45 specs today, most pin the old interaction model), accessibility pass, i18n pass over 7 locales, then delete the old timeline modules, drag/long-press engine, switch-timeline code, old save endpoints and dead CSS. | 1–2 weeks |

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
