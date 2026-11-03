# TRAC backup / extraction API

A small, read-only HTTP API for copying the collected time-use diary data off
the TRAC server into a separate system.

It is deliberately *not* the scientific export: that one is built for
statistical analysis (R/pandas) and repeats participant-level columns on
every activity row. This API splits the data by grain so your copy can be loaded
with plain inserts and no de-duplication.

**Audience:** the team that runs the backup/extraction job. Everything you need
is on this page; no TRAC internals required.

**Status:** implemented and available starting from version 0.24.0.

Every example below is a **shortened response from the current development
installation** (study `default`), with only the long parts replaced by `...`.
Field names and value formats are exactly what you will receive.

---

## 1. The three endpoints

| Endpoint | Grain | Answers |
|---|---|---|
| `GET /api/admin/participants` | one row per **participant × study** | "Who has finished, and when?" |
| `GET /api/admin/activities` | one row per **reported activity** | the actual diary data |
| `GET /api/admin/studies` | one row per **study** | reference/config data so your copy stays interpretable |

All three are read-only and safe to call repeatedly.

---

## 2. Authentication

HTTP Basic over HTTPS, using an account the TRAC admins create for you
(`TUD_API_BACKUP_USERS` on the server side).

* You get a **read-only, server-wide** account: it can read every study and
  participant.
* It can call **only** these three endpoints. Every other admin route answers
  `403 {"detail": {"code": "extraction_only_account"}}`.
* A super-admin account also works on these endpoints, but a dedicated backup
  account is recommended for security reasons.
* Every call is written to the TRAC admin audit log, so the operators can see
  what was extracted and when.

In the examples below, `$BASE` is your API root
(`https://your.trac.host/<rootpath>`) and `$AUTH` is
`backup_account:its_password`.

---

## 3. What "done" means (important)

A participant counts as **done** when `submitted` is `true`, which mirrors the
`study_submitted_at` timestamp.

* The app only lets a participant press *Finish* once **every day of the study
  meets its coverage requirement** - i.e. on every day, each timeline that
  defines a `min_coverage` has at least that many minutes entered.
* **From that moment the diary is immutable.** No participant-facing endpoint
  can change it afterwards. That is the guarantee this API is built on: once you see a
  participant as submitted, you can pull their rows and the copy stays valid.
  Each participant needs to be pulled **once**.
* Participants who never reported anything are still listed (they are the
  drop-outs). Their day statuses are `empty`, and of course this implies `submitted` is `false` for them.

---

## 4. `GET /api/admin/participants`

One row per participant-per-study, including completion status.

| Query parameter | Meaning |
|---|---|
| `study` | study `name_short`; **repeatable**. Omit = every study. |
| `submitted` | `true` = only finished, `false` = only not finished, omit = all |
| `submitted_after` | ISO 8601 timestamp; only submissions at/after it (**inclusive**) - for polling |
| `format` | `json` (default) or `csv` |

### Example

```bash
curl -s -u "$AUTH" "$BASE/api/admin/participants?study=default&submitted=true" | jq
```

Shortened real response from our dev installation (study `default`):

```jsonc
{
  "metadata": {
    "export_timestamp": "2026-10-14T12:53:04.108358+00:00",
    "total_records": 45,
    "format": "json",
    "schema_version": 1,
    "version": "1",
    "tud_backend_version": "0.30.0"
  },
  "data": [
    {
      "study_id": 1,
      "study_name": "Default Weekly Study for Adults",
      "study_name_short": "default",
      "participant_id": "0266914862368672",
      "participant_study_created_at": "2026-09-30T14:19:19.355392+02:00",
      "submitted": true,
      "study_submitted_at": "2026-09-30T14:19:42.342417+02:00",
      "total_days": 7,
      "days_with_data": 7,
      "days_meeting_min_coverage": 7,
      "all_days_meet_min_coverage": true,
      "day_0_status": "complete",
      "day_1_status": "complete",
      "day_2_status": "complete",
      "day_3_status": "complete",
      "day_4_status": "complete",
      "day_5_status": "complete",
      "day_6_status": "complete"
    }
    // ... 44 more
  ]
}
```

`day_<n>_status` is one column per day label of the study, in the study's
configured order: `complete` (coverage requirement met), `partial` (something
entered, requirement not met) or `empty`.

Scale, for context: that study currently has **2,426** registered participants,
of which **45** are submitted; 12 of them submitted since 2026-10-01. The
response for all 45 is a few tens of KB.

---

## 5. `GET /api/admin/activities`

One row per reported activity. This is the flat diary data.

| Query parameter | Meaning |
|---|---|
| `study` | study `name_short`; **repeatable**. Omit = every study. |
| `participant` | participant id; **repeatable**. *Disables paging* - you get exactly those participants in one response. |
| `limit` | page size in **participants** (default 200, max 2000) |
| `cursor` | page position; pass `next_cursor` from the previous page unchanged |
| `format` | `json` (default) or `csv` |

### Example: the rows of one submitted participant

```bash
curl -s -u "$AUTH" "$B/api/admin/activities?study=default&participant=0593254952219715"
```

Shortened real response (this participant reported exactly one 10-minute entry
per day, so 7 rows in total):

```jsonc
{
  "metadata": {
    "export_timestamp": "2026-10-14T12:59:12.004921+00:00",
    "total_records": 7,
    "format": "json",
    "schema_version": 1,
    "version": "1",
    "tud_backend_version": "0.30.0",
    "limit": 200, "cursor": null, "participants_returned": 1,
    "has_more": false, "next_cursor": null, "paged": false
  },
  "data": [
    {
      "activity_id": 8692,
      "study_id": 1,
      "study_name": "Default Weekly Study for Adults",
      "study_name_short": "default",
      "participant_id": "0593254952219715",
      "day_label": "monday",
      "day_label_index": 0,
      "timeline_name": "primary",
      "timeline_display_name": "Huvudaktivitet",
      "timeline_mode": "single-choice",
      "activity_code": 1101,
      "activity_name": "Sleeping",
      "category": "General Activities",
      "frequency": "",
      "parent_activity_code": null,
      "start_minutes": 530,
      "end_minutes": 540,
      "duration_minutes": 10,
      "start_time": "08:50",
      "end_time": "09:00",
      "created_at": "2026-10-13T17:05:53.779804+02:00"
    }
    // ... 6 more
  ]
}
```

Notes on the fields:

* `start_minutes` / `end_minutes` are **minutes from midnight** and are the
  authoritative values; `start_time` / `end_time` are a convenience rendering
  ("HH:MM"). `duration_minutes = end_minutes - start_minutes`.
* `activity_code` is the numeric code from the study's activity list;
  `activity_name` and `category` are the labels as captured at entry time (so
  historical rows stay readable even if the study's activity list is edited
  later, which in general should be avoided). Colours and other presentation metadata are not on the row - they live in the study's activity definitions (section 6).
* `frequency` is the frequency answer for activities that ask for one
  (empty string when not applicable). E.g., "monthly".
* `timeline_name` is the track (`primary`, `secondary`, ...) and
  `timeline_mode` is always `single-choice` and can be ignored.

### Paging (when you want *everything*, not a specific participant)

Without `participant`, the endpoint returns one page of **participants** at a
time:

```bash
curl -s -u "$AUTH" -D - "$B/api/admin/activities?study=default&limit=1" -o page1.json
# x-participants-returned: 1
# x-record-count: 0
# x-has-more: true
# x-next-cursor: 1:0001734073152839

# then
curl -s -u "$AUTH" "$B/api/admin/activities?study=default&limit=1&cursor=1:0001734073152839"
```

* `limit` counts **participants**, not rows. A page contains all rows of its
  participants, so a participant's days are never split across two pages.
* Follow `next_cursor` until `has_more` is `false`. The state is in the JSON
  `metadata` **and** in response headers, so a CSV consumer can page too.
* **A page can be empty** (`x-record-count: 0`) while `has_more` is still
  `true`: participants are paged in registration order, and most of them may not
  have reported anything yet. Keep following the cursor - do not stop at the
  first empty page.
* The cursor is **opaque** (`"<study_id>:<participant_id>"`). Treat it as a
  token; don't build it yourself.
* `cursor` together with `participant` is a `400` (an explicit participant
  selection is always a single, unpaged response).

Why participants and not row offsets: re-saving a day replaces that day's rows,
so row positions can shift between two page requests; participant keys do not.

---

## 6. `GET /api/admin/studies`

One row per study with the configuration needed to interpret the data without
the TRAC server: study metadata and flags, day labels (with localized names),
timelines (including `min_coverage`) and the per-language activity definition
files.

```bash
curl -s -u "$AUTH" "$B/api/admin/studies?study=default"
```

Shortened real response from our dev installation:

```jsonc
{
  "metadata": { "total_records": 1, "format": "json", "schema_version": 1, "version": "1", ... },
  "data": [
    {
      "study_id": 1,
      "name": "Default Weekly Study for Adults",
      "name_short": "default",
      "description": { "en": "...", "de": "...", "sv": "..." },
      "default_language": "sv",
      "data_collection_start": "2024-01-01T01:00:00+01:00",
      "data_collection_end": "2027-01-01T00:59:59+01:00",
      "created_at": "2026-08-17T11:51:25.267519+02:00",
      "require_consent": true,
      "allow_unlisted_participants": true,
      "is_paused": false,
      "allow_skip_timeuse": true,
      "require_diary_before_external_tasks": false,
      "save_browser_identification": false,
      "owner_usernames": null,
      // ... remaining behavioural flags + study_texts (consent, intro,
      // instructions, the three end texts, inactivity text)
      "day_labels": [
        { "name": "monday", "display_order": 0, "display_name": "Måndag",
          "display_names": { "en": "Monday", "sv": "Måndag", "de": "Montag" } },
        { "name": "tuesday", "display_order": 1, "display_name": "Tisdag",
          "display_names": { "en": "Tuesday", "sv": "Tisdag", "de": "Dienstag" } }
        // ... 5 more days
      ],
      "timelines": [
        { "name": "primary",   "display_name": "Huvudaktivitet",     "mode": "single-choice", "min_coverage": 10 },
        { "name": "secondary", "display_name": "Sekundär Aktivitet", "mode": "single-choice", "min_coverage": null }
      ],
      "activity_configs": [
        { "language": "de", "content_hash": "28d7fd3a...", "activities_json_data": { "general": {...}, "timeline": {...} } },
        { "language": "en", "content_hash": "510eb508...", "activities_json_data": { "general": {...}, "timeline": {...} } },
        { "language": "sv", "content_hash": "892255db...", "activities_json_data": { "general": {...}, "timeline": {...} } }
      ]
    }
  ]
}
```

So `activity_code` 1101 = "Sleeping" (English label) is resolvable from your own
copy, per language, with the colour/category metadata included in
`activities_json_data`.

---

## 7. Recommended workflow

```bash
BASE=https://your.trac.host/<rootpath>
AUTH=backup_account:its_password

# 1. Who finished since the last run? (watermark kept on your side)
curl -s -u "$AUTH" \
  "$BASE/api/admin/participants?study=default&submitted=true&submitted_after=$WATERMARK" \
  -o new_participants.json

jq -r '.data[].participant_id' new_participants.json > new_ids.txt

# New watermark: the LATEST study_submitted_at in this batch. The timestamps
# carry a UTC offset, so compare them as instants, not as strings:
python3 -c "import json; from datetime import datetime; \
print(max(datetime.fromisoformat(r['study_submitted_at']) \
          for r in json.load(open('new_participants.json'))['data']).isoformat())"

# 2. Pull exactly those participants' diary rows (one call, no paging needed)
args=(); while read -r pid; do args+=(--data-urlencode "participant=$pid"); done < new_ids.txt
curl -s -u "$AUTH" -G "$BASE/api/admin/activities" \
  --data-urlencode "study=default" "${args[@]}" -o new_activities.json

# 3. Pull the reference data whenever a study's configuration changes
curl -s -u "$AUTH" "$BASE/api/admin/studies?study=default" -o study_config.json
```

Because submitted data never changes, step 2 can be done once per participant and
the rows can be inserted straight into your own tables.

Two details about the watermark, both verified against the live API:

* `submitted_after` is an **inclusive** lower bound (`>=`). Re-using the latest
  `study_submitted_at` as the next watermark therefore returns that one
  participant again - harmless, because pulling the same submitted rows again
  yields identical rows (upsert and you are done). We made it inclusive on
  purpose: with an exclusive bound you could permanently skip a participant who
  happened to submit in the same microsecond as the watermark.
* If watermark bookkeeping is inconvenient at all, just re-query a generous
  window (e.g. `submitted_after` = a few days ago) and upsert. You will receive
  the same rows again rather than changed ones.

---

## 8. Joining the two extracts

| Join | Key |
|---|---|
| activities → participants | `(study_id, participant_id)` |
| activities → studies | `study_id` |
| activities → day labels | `day_label_index` → `day_label.display_order`, or `day_label` → `day_label.name` |

Stability notes:

* Use **`study_id`** (immutable) rather than `study_name_short` as the key in
  your system - the admins can rename a study, and `name_short` is editable by
  design (it is used for archiving/versioning workflows).
* `activity_id` is a database id that **changes whenever a day is re-saved**, so
  it is not a stable identity. For submitted data nothing changes at all; if you
  ever need to re-match rows across pulls, use
  `(study_id, participant_id, day_label, timeline_name, activity_code,
  start_minutes)`.

---

## 9. Responses and errors

| | |
|---|---|
| `200` with `"data": []` | **normal and not an error** - nothing matched. `total_records: 0`. Never a `404`. |
| `401` | wrong/missing credentials |
| `403` `super_admin_required` | a scientist account tried to use an extraction endpoint |
| `403` `extraction_only_account` | the backup account tried to use a *different* admin route |
| `404` | a `study=` you named does not exist (so you cannot silently copy less than you asked for) |
| `400` | bad `format`, invalid cursor, or `cursor` combined with `participant` |

`json` responses are `application/json` with a `metadata` + `data` envelope.
`csv` responses are a file download (`Content-Disposition: attachment`); the
paging state travels in the `X-*` headers, and an empty result is an empty file.

### Format version

Every response carries an **export schema version**, an integer:

| Where | Key |
|---|---|
| `json` | `metadata.schema_version` |
| `csv` | `X-Export-Schema-Version` response header |

Read it before relying on a column. Within one schema version columns may be
**added**, never removed or renamed; a rename or removal bumps the version.
`metadata.version` (a string) carries the same number for older consumers, and
`metadata.tud_backend_version` names the TRAC release that produced the file -
useful for bug reports, but it is not what you compare against.

The same rule applies to the runtime-config export
(`/api/admin/export/studies-runtime-config`): it declares
`studies_config.schema_version`, every activities payload declares
`general.schema_version`, and an import of a file from a newer TRAC is refused
with an explicit message rather than silently dropping fields.


