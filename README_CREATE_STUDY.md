# How to Create a Study in TRAC

This guide explains how scientists and study administrators can define and
configure a time-use study for TRAC.  It covers the two core configuration
files — `studies_config.json` and the activities file(s) — and describes all
available options.  See the [main README](README.md) for installation and
deployment instructions.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Configuration Overview](#configuration-overview)
   - [The Two File Types](#the-two-file-types)
   - [Open vs. Invite-Only Studies](#open-vs-invite-only-studies)
   - [Languages and Internationalization](#languages-and-internationalization)
   - [Importing Your Configuration](#importing-your-configuration)
   - [Validating and Creating Studies via the Admin Web Interface](#validating-and-creating-studies-via-the-admin-web-interface)
3. [The `studies_config.json` File](#the-studies_configjson-file)
   - [Field Reference Table](#field-reference-table)
   - [Inactivity Timeout](#inactivity-timeout)
   - [External Tasks (External Integrations)](#external-tasks-external-integrations)
   - [HMAC-Signed Callbacks (Optional Per-Task)](#hmac-signed-callbacks-optional-per-task)
   - [Participant Invitation Links](#participant-invitation-links)
   - [Footer Links](#footer-links)
   - [Full Example](#full-example)
4. [The Activities File](#the-activities-file)
   - [Structure Overview](#structure-overview)
   - [Activity Field Reference](#activity-field-reference)
   - [Activity Types (Standard, Custom Input, Child, Child Custom)](#activity-types)
   - [Full Example Activities File](#full-example-activities-file)

---

## Quick Start

1. Create a `studies_config.json` file describing your study (name, languages,
   days, participants, etc.).
2. Create one or more activities files (e.g., `activities_my_study_en.json`)
   that define the timelines and activity codes for each supported language.
3. Import them into the running backend:

   ```bash
   cd backend/
   uv run tud studies import --config studies_config.json
   ```

4. Give participants their invitation links:

   ```text
   https://your.domain.example.com/report/index.html?study_name=<name_short>&pid=<participant_id>
   ```

---

## Configuration Overview

### The Two File Types

TRAC separates study configuration into two kinds of files:

| File | Purpose |
|---|---|
| **`studies_config.json`** | Defines the **study metadata**: study name, days covered, supported languages, participant handling, consent requirements, data collection window, external tasks, and references to the activities files. |
| **Activities file(s)** (e.g., `activities_default.json`) | Defines the **timelines and activity codes**: the actual clickable activities that participants place on their daily timelines. Usually one file per supported language. |

The `studies_config.json` **references** the activities files via the
`activities_json_files` field, which maps each language code to a file name.
You can also embed activities data directly via `activities_json_data` (useful
for API-based import workflows).

### Open vs. Invite-Only Studies

- **Open study** (`allow_unlisted_participants: true`): Any visitor can
  participate.  If no `pid` is given in the URL, a random ID is generated
  automatically.  You do not need to pre-list participants.
- **Invite-only (closed) study** (`allow_unlisted_participants: false`): Only
  participants whose IDs appear in `study_participant_ids` can access the
  study.  External tasks (see below) require a closed study.

### Languages and Internationalization

Each study defines a `default_language` (a 2-letter ISO 639-1 code like `"en"`,
`"de"`, `"sv"`) and a list of `supported_languages`.  Study texts (intro,
consent, end messages, day labels) are provided as localized maps, e.g.:

```json
"study_text_intro": {
  "en": "Welcome to our study!",
  "de": "Willkommen zu unserer Studie!"
}
```

The frontend selects the display language in this order:

1. The `lang` URL parameter (if present).
2. The participant's browser language (if supported by the study).
3. The study's `default_language`.

Activity lists can also be language-specific via `activities_json_files`.

### Importing Your Configuration

Once your JSON files are ready, import them with the CLI:

```bash
cd backend/
uv run tud db upgrade                          # ensure schema is up to date
uv run tud studies import --config studies_config.json
```

You can also import multiple config files:

```bash
uv run tud studies import --config study_a.json --config study_b.json
```

The import command validates all configuration before applying it.  If
validation fails, the entire import is rolled back and no studies are modified.

### Validating and Creating Studies via the Admin Web Interface

In addition to the CLI, the **admin web interface** provides a graphical way to
validate and create studies:

1. Open the admin interface at `https://your.domain.example.com/<TUD_ROOTPATH>/admin`.
2. Navigate to the **Study Import** section.
3. Paste your `studies_config.json` content (with embedded activities data or
   references to activities files) into the text area.
4. Click **Validate** to check your configuration for errors without applying
   it.  The interface reports any schema violations, missing fields, or
   cross-language inconsistencies.
5. If validation succeeds, click **Import** to create or update the study(ies).

The admin interface uses the same validation logic as the CLI `tud studies
import` command, so you can use whichever workflow you prefer.  The web-based
validator is especially helpful during iterative configuration development
because it gives you immediate feedback without needing terminal access to the
server.

The admin interface also supports **exporting** your current runtime study
configuration via `GET /api/admin/export/studies-runtime-config`, which is
useful for backups, cloning studies, or migrating between environments.

---

## The `studies_config.json` File

The top-level structure of `studies_config.json` is:

```json
{
  "studies": [ ... ]
}
```

The `studies` array contains one or more study objects.  Each study object
defines a single study.

### Field Reference Table

#### Study Identity & Display

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | **Yes** | Human-readable full study name, e.g., `"Default Weekly Study for Adults"`. |
| `name_short` | string | **Yes** | Technical short name used in URLs and API calls. Must contain only lowercase letters, digits, and underscores (`[a-z0-9_]+`), 2–50 characters. Example: `"default"`. |
| `description` | string or `{lang: text}` | No | Study description. Can be a plain string (legacy, treated as the default language) or a localized map. |

#### Participant Handling

| Field | Type | Required | Description |
|---|---|---|---|
| `study_participant_ids` | `[string]` | No | List of pre-assigned participant IDs (for invite-only studies). Default: `[]`. |
| `allow_unlisted_participants` | boolean | No | If `true`, open study — any visitor can participate. If `false`, only IDs in `study_participant_ids` are allowed. Required to be `false` when using `external_tasks`. Default: `true`. |

#### Day Configuration

| Field | Type | Required | Description |
|---|---|---|---|
| `day_labels` | `[object]` | **Yes** | Array of day definitions (at least one). Each entry has: `name` (machine name, e.g., `"monday"`), `display_order` (integer ≥ 0), and `display_names` (localized map, e.g., `{"en": "Monday", "de": "Montag"}`). |

#### Languages & Activities

| Field | Type | Required | Description |
|---|---|---|---|
| `default_language` | string | No | 2-letter ISO 639-1 code. Default: `"en"`. |
| `supported_languages` | `[string]` | No | List of 2-letter language codes available in the frontend. If omitted, derived from the keys of `activities_json_files` / `activities_json_data`. |
| `activities_json_files` | `{lang: filename}` | Conditional¹ | Map of language code → activities JSON file path (relative to the config file directory). |
| `activities_json_file` | string or `{lang: filename}` | Conditional¹ | Legacy single-file variant. Prefer `activities_json_files`. |
| `activities_json_data` | `{lang: object}` | Conditional¹ | Inline activities data (the full activities JSON object), keyed by language. Use this instead of referencing external files when importing via the API. |

¹ At least one of `activities_json_files`, `activities_json_file`, or `activities_json_data` must be present.

#### Study Text (Localized)

All text fields are localized maps (`{lang: text}`).  If the study supports
multiple languages, every supported language must have an entry.

| Field | Type | Required | Description |
|---|---|---|---|
| `study_text_intro` | `{lang: text}` | No | Introduction text shown before the participant starts the diary. |
| `study_text_end_completed` | `{lang: text}` | No | Text shown after the participant completes all days. |
| `study_text_end_skipped` | `{lang: text}` | No | Text shown if the participant skipped the time-use part. |
| `study_text_consent` | `{lang: text}` | No | Consent text shown on the consent page. Supports Markdown headings (`#`). |
| `study_text_end_noconsent` | `{lang: text}` | No | Text shown if the participant did not give consent. |

#### Study Flow Control

| Field | Type | Required | Description |
|---|---|---|---|
| `require_consent` | boolean | No | If `true`, the participant must accept the consent text before proceeding. Default: `false`. |
| `allow_skip_timeuse` | boolean | No | If `true`, the participant can skip the time-use reporting and still reach the end page. If `false`, they must fill out the diary. Default: `true`. |
| `is_paused` | boolean | No | If `true`, the study is paused and participants cannot submit new data. Default: `false`. |

#### Data Collection Window

| Field | Type | Required | Description |
|---|---|---|---|
| `data_collection_start` | ISO 8601 datetime | **Yes** | UTC date/time when data collection begins. Example: `"2024-01-01T00:00:00Z"`. |
| `data_collection_end` | ISO 8601 datetime | **Yes** | UTC date/time when data collection ends. Example: `"2026-12-31T23:59:59Z"`. |

#### Inactivity Timeout

| Field | Type | Required | Description |
|---|---|---|---|
| `inactivity_timeout_minutes` | integer | No | Minutes of user inactivity before the session is automatically ended. Omit or set to `0` to disable. |
| `inactivity_timeout_stress_time_left` | integer | No | When remaining time drops below this threshold (minutes), a visual countdown warning appears. Default: `5`. |
| `inactivity_page_custom_text` | `{lang: text}` | No | Localized message shown on the inactivity expiration page. |

#### External Tasks

| Field | Type | Required | Description |
|---|---|---|---|
| `external_tasks` | `[object]` | No | Array of external task definitions. Requires `allow_unlisted_participants: false`. See [External Tasks](#external-tasks-external-integrations) below. |
| `require_diary_before_external_tasks` | boolean | No | If `true`, the participant must complete the diary before accessing external tasks. Default: `false`. |

#### Footer Links

| Field | Type | Required | Description |
|---|---|---|---|
| `footer_links` | `[object]` | No | Array of study-specific footer links. Each link has `title` (localized map), `target_url` (string), and `in_new_tab` (boolean, default `true`). |
| `hide_server_wide_links` | boolean | No | If `true`, hides the server-wide legal links (imprint/privacy) from the footer for this study. Default: `false`. |

#### Pre-Logged Activities (Admin)

| Field | Type | Required | Description |
|---|---|---|---|
| `activities_logged_by_userid` | `{userid: {day: [activity]}}` | No | Pre-populated activities for specific participants. Each activity has `timeline`, `activity_code`, `start_minutes`, `end_minutes`. |

---

### Inactivity Timeout

Each study can optionally configure an **inactivity timeout** that ends the
participant's session after a period of no user interaction, helping to protect
study data integrity.

| Field | Type | Description |
|---|---|---|
| `inactivity_timeout_minutes` | integer | Duration of inactivity (in minutes) after which the session is automatically ended. Omit or set to `0` to disable the timeout. |
| `inactivity_timeout_stress_time_left` | integer | When the remaining time drops below this threshold (in minutes), a visual countdown indicator appears in the frontend to warn the participant. |
| `inactivity_page_custom_text` | object | Localized message object (e.g., `{ "en": "...", "de": "..." }`) displayed on the inactivity expiration page, explaining why the session ended. |

Example configuration:

```json
{
    "inactivity_timeout_minutes": 30,
    "inactivity_timeout_stress_time_left": 5,
    "inactivity_page_custom_text": {
        "en": "Your session has ended because you were inactive for 30 minutes. This is required to protect the integrity of the study data. Thank you for your understanding.",
        "de": "Ihre Sitzung wurde beendet, weil Sie 30 Minuten lang inaktiv waren. Dies ist notwendig, um die Integrität der Studiendaten zu schützen. Vielen Dank für Ihr Verständnis.",
        "sv": "Din session har avslutats eftersom du var inaktiv i 30 minuter. Detta krävs för att skydda studiedatas integritet. Tack för din förståelse."
    }
}
```

When the inactivity timeout triggers, the frontend redirects the participant to
the `inactivity.html` page, which displays the localized
`inactivity_page_custom_text` message.

---

### External Tasks (External Integrations)

Studies may include `external_tasks` entries to describe external systems
participants should visit (for example, external surveys or payment forms).

#### External Task Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `task_key` | string | **Yes** | Short machine identifier. Must use only lowercase letters, numbers, and underscores (`[a-z0-9_]+`). |
| `task_level` | integer | No | Positive integer defining task hierarchy. A task can only be started after all tasks with a lower `task_level` have been completed. Set all to `1` if you don't need hierarchy. Default: `1`. |
| `name` | `{lang: text}` | **Yes** | Localized display name for the task. |
| `description` | `{lang: text}` | No | Localized longer description shown next to the task name. |
| `confirmation_type` | string | No | Either `"none"` (manual, participant self-confirms) or `"callback"` (backend expects a return confirmation). Default: `"none"`. |
| `outbound_tokens` | `[object]` | **Yes** | Array of token group definitions. Each group has a `name` (string) and a `by_participant` map (`{participant_id: token_string}`). |
| `outbound_url` | string | **Yes** | URL template with placeholders. Supported placeholders: `{participant_id}`, `{study_name}`, `{task_key}`, plus all token group names (e.g., `{pay_token}`). |
| `hmac_secret_reference` | string | No | Optional name of a shared secret (configured in `.env` via `TUD_EXTERNAL_TASK_HMAC_SECRETS`) for HMAC-signed callbacks. |

Example:

```json
{
    "task_key": "payment_info",
    "task_level": 2,
    "name": { "de": "Bankdaten eingeben" },
    "description": { "de": "Geben Sie Ihre Bankdaten ein..." },
    "confirmation_type": "callback",
    "outbound_tokens": [
        {
            "name": "pay_token",
            "by_participant": {
                "bernd": "pay-bernd-123434214",
                "sophia": "pay-sophia-987654321"
            }
        }
    ],
    "outbound_url": "https://survey.example.org/f/153222?pid={participant_id}&study_name={study_name}&task={task_key}&token={pay_token}"
}
```

#### How External Tasks Work at Runtime

1. The backend substitutes placeholders in `outbound_url` per participant and
   returns the expanded URLs in the study-config API response.
2. The frontend `pages/tasks.html` handles the flow.  When an external provider
   redirects participants back, it should send these query parameters:
   - `callback_task_key`: the `task_key` of the task being confirmed.
   - `callback_token`: the token assigned to this participant for that task.

   Example return URL:

   ```text
   https://your.domain.example.com/report/pages/tasks.html?study_name=default&pid=bernd&callback_task_key=payment_info&callback_token=pay-bernd-123434214
   ```

3. On page load, `pages/tasks.html` POSTs a confirmation to:

   `POST /api/studies/{study_name}/participants/{participant_id}/external-tasks/confirm`

   with body `{ "task_key": "<task_key>", "assigned_token": "<token>" }`.

---

### HMAC-Signed Callbacks (Optional Per-Task)

To prevent participants from forging callback confirmations, individual
external tasks can opt into **HMAC-signed return URLs**.  This requires
a shared secret between TRAC and the remote system's backend.

**Configuration**

1. Add the shared secret to `.env`:

   ```
   TUD_EXTERNAL_TASK_HMAC_SECRETS='{"survey_hub_v1":"a1b2c3d4e5f6..."}'
   ```

   Generate a secret with `python3 -c "import secrets; print(secrets.token_hex(32))"`.

2. Reference it in the task definition in `studies_config.json`:

   ```json
   {
     "task_key": "depression_survey",
     "hmac_secret_reference": "survey_hub_v1"
   }
   ```

**Remote system contract**

After the participant completes the task, the remote system must compute:

```
message    = "study_name|participant_id|task_key|assigned_token"
signature  = HMAC-SHA256(shared_secret, message) → hex string
```

And append `&hmac={signature}` to the redirect URL.  TRAC verifies the
signature before accepting the callback.

**Security properties**

- Without HMAC a participant who knows their own token can self-confirm.
- With HMAC the return URL must be signed by someone who knows the secret —
  i.e. the remote system's backend, not the browser.
- Different `hmac_secret_reference` values for different remote systems ensure
  a compromise of one system cannot affect tasks on another.
- If `hmac_secret_reference` is absent, the original token-only flow is used
  (backward compatible).

---

### Participant Invitation Links

TRAC identifies participants primarily through the `pid` URL parameter together
with the target study in `study_name`.  A minimal invitation link:

```text
https://your.domain.example.com/report/index.html?study_name=default&pid=PARTICIPANT_ID
```

All invitation URL parameters:

| Parameter | Required | Description |
|---|---|---|
| `study_name` | Yes | The study short name (`name_short` in `studies_config.json`). |
| `pid` | Yes¹ | The participant identifier. For invite-only studies this must match a pre-assigned participant; for open studies any value is accepted and a new participant record is created if needed. |
| `lang` | No | Language override as an ISO 639-1 two-letter code (e.g., `en`, `de`, `sv`). |
| `template_user` | No | Participant ID of another user whose timeline entries should be copied as a starting point. |
| `return_url` | No | A fully URL-encoded absolute URL to which the participant is redirected after completing the study (shown as a link on the thank-you page). |
| `custom_page_title` | No | Arbitrary text displayed next to the day label on all diary pages (e.g., `&custom_page_title=for%20Child%20A`). This is a frontend-only convenience feature — the value is never sent to or stored in the backend. |

¹ `pid` is required for invite-only studies.  For open studies
(`allow_unlisted_participants: true`) a missing `pid` is replaced with a
randomly generated, fresh ID automatically.

Examples:

```text
# Select study and participant
https://your.domain.example.com/report/index.html?study_name=default&pid=c303282d

# Also force the language shown in the frontend
https://your.domain.example.com/report/index.html?study_name=default&pid=c303282d&lang=sv

# Use another participant as a template for first-time initialization
https://your.domain.example.com/report/index.html?study_name=study1&pid=c303282d&template_user=a5sf35gh

# Return to an external system after completion
https://your.domain.example.com/report/index.html?study_name=default&pid=c303282d&return_url=https%3A%2F%2Fexample.org%2Ffinish%3Ftoken%3Dabc123

# Add a custom page title to remind the participant which child they are reporting for
https://your.domain.example.com/report/index.html?study_name=default&pid=c303282d&custom_page_title=for%20Child%20A
```

---

### Footer Links

Each study can define optional footer links that appear alongside (or instead
of) the server-wide legal links:

```json
"footer_links": [
  {
    "title": {
      "en": "Study Information",
      "de": "Studieninformation"
    },
    "target_url": "https://example.com/study-info",
    "in_new_tab": true
  }
]
```

Set `hide_server_wide_links: true` to hide the server-wide imprint and privacy
links for this study.

---

### Full Example

Below is a complete, fully-featured study configuration based on the `"default"`
study from the test data.  It demonstrates all major features: multilingual
support, consent, inactivity timeout, footer links, and the data collection
window.

```json
{
  "studies": [
    {
      "name": "Default Weekly Study for Adults",
      "name_short": "default",
      "description": {
        "en": "Default Study for Adults, filled out by themselves",
        "sv": "Standardstudie för vuxna, ifylld av deltagarna själva",
        "de": "Standardstudie für Erwachsene, ausgefüllt von den Teilnehmern selbst"
      },
      "day_labels": [
        {
          "name": "monday",
          "display_order": 0,
          "display_names": {
            "en": "Monday",
            "sv": "Måndag",
            "de": "Montag"
          }
        },
        {
          "name": "tuesday",
          "display_order": 1,
          "display_names": {
            "en": "Tuesday",
            "sv": "Tisdag",
            "de": "Dienstag"
          }
        },
        {
          "name": "wednesday",
          "display_order": 2,
          "display_names": {
            "en": "Wednesday",
            "sv": "Onsdag",
            "de": "Mittwoch"
          }
        },
        {
          "name": "thursday",
          "display_order": 3,
          "display_names": {
            "en": "Thursday",
            "sv": "Torsdag",
            "de": "Donnerstag"
          }
        },
        {
          "name": "friday",
          "display_order": 4,
          "display_names": {
            "en": "Friday",
            "sv": "Fredag",
            "de": "Freitag"
          }
        },
        {
          "name": "saturday",
          "display_order": 5,
          "display_names": {
            "en": "Saturday",
            "sv": "Lördag",
            "de": "Samstag"
          }
        },
        {
          "name": "sunday",
          "display_order": 6,
          "display_names": {
            "en": "Sunday",
            "sv": "Söndag",
            "de": "Sonntag"
          }
        }
      ],
      "study_text_intro": {
        "en": "This is our time use study for adults. Please reconstruct a typical week of your daily activities.",
        "sv": "Detta är vår tidsanvändningsstudie för vuxna. Vänligen återskapa en typisk vecka av dina dagliga aktiviteter.",
        "de": "Dies ist unsere Zeitnutzungsstudie für Erwachsene. Bitte rekonstruieren Sie eine typische Woche Ihrer täglichen Aktivitäten."
      },
      "study_text_end_completed": {
        "en": "Thanks for filling out this study. Your efforts will contribute to valuable research.",
        "sv": "Tack för att du fyllde i denna studie. Dina insatser kommer att bidra till värdefull forskning.",
        "de": "Vielen Dank für das Ausfüllen dieser Studie. Ihre Beiträge werden zu wertvoller Forschung beitragen."
      },
      "study_text_end_skipped": {
        "en": "You skipped the time reporting part. If you provided some information, we will try to use it. Thank you!",
        "sv": "Du hoppade över att fylla i tidsanvändningsdelen av studien. Om du har lämnat viss information kommer vi att försöka använda den. Tack!",
        "de": "Sie haben den Teil zur Zeitberichterstattung übersprungen. Wenn Sie einige Angaben gemacht haben, werden wir versuchen, diese zu verwenden. Vielen Dank!"
      },
      "require_consent": true,
      "is_paused": false,
      "study_text_consent": {
        "en": "By continuing, you agree that:\n- your answers are collected for scientific time use research\n- the data may be analyzed in aggregated form\n- you can stop at any time before submitting",
        "sv": "Genom att fortsätta godkänner du att:\n- dina svar samlas in för vetenskaplig tidsanvändningsforskning\n- uppgifterna kan analyseras i samlad form\n- du kan avbryta när som helst innan du skickar in",
        "de": "Wenn Sie fortfahren, stimmen Sie zu, dass:\n- Ihre Antworten für wissenschaftliche Forschung zur Zeitnutzung erhoben werden\n- die Daten in zusammengefasster Form ausgewertet werden können\n- Sie jederzeit vor dem Absenden abbrechen können"
      },
      "study_text_end_noconsent": {
        "en": "You did not give consent and your data will not be used in this study.",
        "sv": "Du gav inte ditt samtycke och dina data kommer inte att användas i denna studie.",
        "de": "Sie haben keine Einwilligung gegeben und Ihre Daten werden in dieser Studie nicht verwendet."
      },
      "study_participant_ids": [],
      "allow_unlisted_participants": true,
      "default_language": "sv",
      "supported_languages": ["en", "sv", "de"],
      "activities_json_files": {
        "en": "activities_ki_adults_en.json",
        "sv": "activities_ki_adults_sv.json",
        "de": "activities_ki_adults_de.json"
      },
      "data_collection_start": "2024-01-01T00:00:00Z",
      "data_collection_end": "2026-12-31T23:59:59Z",
      "inactivity_timeout_minutes": 30,
      "inactivity_timeout_stress_time_left": 5,
      "inactivity_page_custom_text": {
        "en": "Your session has ended because you were inactive for 30 minutes. Please use your invitation link to continue.",
        "de": "Ihre Sitzung wurde beendet, weil Sie 30 Minuten lang inaktiv waren. Bitte verwenden Sie Ihren Einladungslink, um fortzufahren.",
        "sv": "Din session har avslutats eftersom du var inaktiv i 30 minuter. Vänligen använd din inbjudningslänk för att fortsätta."
      },
      "footer_links": [
        {
          "title": {
            "en": "Study Information",
            "sv": "Studieinformation",
            "de": "Studieninformation"
          },
          "target_url": "https://example.com/study-info",
          "in_new_tab": true
        },
        {
          "title": {
            "en": "Contact",
            "sv": "Kontakt",
            "de": "Kontakt"
          },
          "target_url": "https://example.com/contact",
          "in_new_tab": false
        }
      ]
    }
  ]
}
```

---

## The Activities File

### Structure Overview

An activities file defines what participants can select and place on their
daily timelines.  The top-level structure is:

```json
{
  "general": { ... },
  "timeline": {
    "primary": { ... },
    "secondary": { ... }
  }
}
```

#### General Settings

The `general` section provides metadata about the activities definition:

| Field | Type | Description |
|---|---|---|
| `experimentID` | string | Identifier matching the study `name_short` (used by the frontend to validate the configuration). |
| `app_name` | string | Display name of the application. |
| `version` | string | Version string for the activities definition. |
| `author` | string | Author name. |
| `language` | string | 2-letter language code this file is written for. |
| `instructions` | boolean | Whether the frontend should show activity instructions. |
| `primary_redirect_url` | string | URL to redirect to after completion (usually `"pages/thank-you.html"`). |
| `fallbackToCSV` | boolean | Whether the frontend should fall back to CSV export. |

#### Timelines

The `timeline` object contains one or more named timelines.  The typical setup
has `"primary"` (the main activity) and optionally `"secondary"` (a secondary
activity done simultaneously, e.g., listening to music while commuting).

Each timeline has:

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | **Yes** | Human-readable timeline name, e.g., `"Main Activity"`. |
| `description` | string | No | Optional description. |
| `mode` | string | **Yes** | Either `"single-choice"` (only one activity per time slot) or `"multiple-choice"` (multiple overlapping activities allowed). |
| `min_coverage` | integer | No | Minimum number of minutes the participant must cover on this timeline (0–1440). `0` means no minimum. |
| `categories` | `[object]` | **Yes** | Array of activity categories. |

Each **category** has:

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | **Yes** | Category display name, e.g., `"Work / Study"`. |
| `color` | string | No | Optional CSS color for the category header. |
| `activities` | `[object]` | **Yes** | Array of activity items in this category. |

---

### Activity Field Reference

Each activity item in a category can have these fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | **Yes** | Display name of the activity, e.g., `"Sleeping"`. |
| `code` | integer | **Yes** | Unique numeric activity code. Must be unique across **all** timelines in the file. |
| `label` | string | No | Short label shown on the timeline bar. Defaults to `name` if omitted. |
| `short` | string | No | Abbreviated label for narrow viewports. |
| `vshort` | string | No | Very short label (e.g., 3–4 characters). |
| `color` | string | No | CSS color for the timeline bar, e.g., `"#A8D8EA"`. |
| `examples` | string | No | Examples shown in the UI to help participants understand the activity, e.g., `"Eating, drinking, personal care"`. |
| `is_custom_input` | boolean | No | If `true`, the participant can type a free-text custom description for this activity. Default: `false`. |
| `frequency_options` | `[{key, label}]` | No | Array of frequency options the participant can select from. Each option has a `key` (machine identifier) and `label` (display text). All keys must be unique within the activity. |
| `childItems` | `[object]` | No | Array of child activities. When a parent activity is selected, the participant can optionally choose a more specific child activity. Child items use the same fields as parent activities (except they cannot have their own `childItems`). |

> **Note on activity codes**: Activity codes must be unique across all
> timelines within a single activities file.  For multilingual studies, the
> **same codes must appear in all language variants** — only the
> human-readable fields (`name`, `label`, `examples`, etc.) should differ
> between languages.

---

### Activity Types

TRAC supports four kinds of activities:

#### 1. Standard Activity

The most basic activity — a name, code, and color:

```json
{
  "name": "Sleeping",
  "code": 1101,
  "label": "sleeping",
  "color": "#A8D8EA",
  "childItems": []
}
```

#### 2. Custom Input Activity

Like a standard activity, but the participant can also type a free-text
description to specify details:

```json
{
  "name": "Paid Work (please specify job)",
  "examples": "Including work from home",
  "code": 1120,
  "label": "paid work (including at home)",
  "color": "#FFB6C1",
  "is_custom_input": true,
  "childItems": []
}
```

#### 3. Parent Activity with Children

A parent activity that presents sub-options when selected:

```json
{
  "name": "Travelling",
  "code": 1110,
  "label": "travelling",
  "color": "#98FB98",
  "childItems": [
    {
      "name": "Travelling: walking",
      "code": 1111,
      "label": "travelling: walking",
      "color": "#98FB98"
    },
    {
      "name": "Travelling: cycle",
      "code": 1112,
      "label": "travelling: cycle",
      "color": "#90EE90"
    }
  ]
}
```

#### 4. Child Activity with Custom Input

A child item that also allows free-text input:

```json
{
  "name": "Console Gaming, alone (please specify game)",
  "code": 1221,
  "examples": "Playstation, Xbox, Nintendo Switch, etc",
  "label": "Console Gaming, alone",
  "color": "#FFA500",
  "is_custom_input": true
}
```

---

### Full Example Activities File

Below is a minimal but technically valid activities file that demonstrates all
four activity types, with one primary timeline and one optional secondary
timeline.  You can use this as a starting template for your own study.

```json
{
  "general": {
    "experimentID": "example_study",
    "app_name": "TRAC Time-Use Diary",
    "version": "1.0.0",
    "author": "Your Name",
    "language": "en",
    "instructions": true,
    "primary_redirect_url": "pages/thank-you.html",
    "fallbackToCSV": true
  },
  "timeline": {
    "primary": {
      "name": "Main Activity",
      "description": "What were you mainly doing?",
      "mode": "single-choice",
      "min_coverage": 10,
      "categories": [
        {
          "name": "Rest & Personal Care",
          "activities": [
            {
              "name": "Sleeping",
              "code": 100,
              "label": "sleeping",
              "color": "#A8D8EA",
              "childItems": []
            },
            {
              "name": "Personal Care (please specify)",
              "code": 101,
              "label": "personal care",
              "color": "#87CEEB",
              "is_custom_input": true,
              "childItems": []
            }
          ]
        },
        {
          "name": "Travel",
          "activities": [
            {
              "name": "Travelling",
              "code": 200,
              "label": "travelling",
              "color": "#98FB98",
              "childItems": [
                {
                  "name": "Travelling: walking",
                  "code": 201,
                  "label": "walking",
                  "color": "#98FB98"
                },
                {
                  "name": "Travelling: by car",
                  "code": 202,
                  "label": "by car",
                  "color": "#90EE90"
                },
                {
                  "name": "Travelling: other (please specify)",
                  "code": 203,
                  "label": "travelling: other",
                  "color": "#7CFC00",
                  "is_custom_input": true
                }
              ]
            }
          ]
        },
        {
          "name": "Work & Education",
          "activities": [
            {
              "name": "Paid Work (please specify job)",
              "code": 300,
              "label": "paid work",
              "color": "#FFB6C1",
              "is_custom_input": true,
              "childItems": []
            },
            {
              "name": "Studying",
              "code": 301,
              "label": "studying",
              "color": "#FFA07A",
              "childItems": [
                {
                  "name": "Attending lectures",
                  "code": 302,
                  "label": "lectures",
                  "color": "#FFA07A"
                },
                {
                  "name": "Self-study",
                  "code": 303,
                  "label": "self-study",
                  "color": "#FFDAB9"
                }
              ]
            }
          ]
        },
        {
          "name": "Other",
          "activities": [
            {
              "name": "Other Activity (please specify)",
              "code": 999,
              "label": "other",
              "color": "#C0C0C0",
              "is_custom_input": true,
              "childItems": []
            },
            {
              "name": "Forgot / Unspecified",
              "code": 998,
              "label": "unspecified",
              "color": "#C0C0C0",
              "childItems": []
            }
          ]
        }
      ]
    },
    "secondary": {
      "name": "Secondary Activity",
      "description": "Were you doing anything else at the same time?",
      "mode": "single-choice",
      "min_coverage": 0,
      "categories": [
        {
          "name": "Media & Entertainment",
          "activities": [
            {
              "name": "Listening to Audio",
              "code": 400,
              "label": "listening to audio",
              "color": "#FFE4B5",
              "childItems": []
            },
            {
              "name": "Social Media",
              "code": 401,
              "label": "social media",
              "color": "#FFD700",
              "childItems": []
            }
          ]
        }
      ]
    }
  }
}
```

> **Tip**: Use the admin web interface (see
> [Validating and Creating Studies via the Admin Web Interface](#validating-and-creating-studies-via-the-admin-web-interface))
> to validate your activities file together with your studies config before
> deploying to participants.
