# External Tasks V2 Spec (Pre-Implementation)

Status: draft agreed for implementation
Scope: replace current external task config shape (no backward-compat parsing required)

## 1. Goals

- Keep current user-visible behavior working.
- Improve configuration clarity and naming.
- Add i18n support for task metadata.
- Support multiple outbound tokens per task.
- Keep callback security simple: token-bound confirmation is required.

## 2. Non-Goals (for now)

- No launch state nonce.
- No compatibility layer for old config shape.
- No change to core callback flow semantics beyond config/schema cleanup.

## 3. New External Task Config Shape

Each external task entry in `external_tasks` uses this structure:

```json
{
  "task_key": "depression_survey",
  "name": {
    "de": "Umfrage zu Depressionssymptomen ausfuellen"
  },
  "description": {
    "de": "Fuellen Sie die verlinkte Umfrage zu Depressionssymptomen aus."
  },
  "confirmation_type": "callback",
  "task_level": 1,
  "outbound_tokens": [
    {
      "name": "survey_token",
      "by_participant": {
        "bernd": "dep-bernd-31526357",
        "sophia": "dep-sophia-3754687526",
        "claudia": "dep-claudia-3576872"
      }
    }
  ],
  "outbound_url": "https://survey.academiccloud.de/f/153111?pid={participant_id}&study_name={study_name}&task={task_key}&token={survey_token}"
}
```

Notes:
- `name` and `description` are localized maps (`language_code -> text`).
- `outbound_tokens` supports one or more token groups.
- `name` inside each token group is the placeholder key (for example `survey_token`).
- `by_participant` maps participant IDs directly to their token values.
- `task_level` controls unlock order: tasks at level `N` are locked until all tasks at levels `< N` are confirmed for that participant.
- `hmac_secret_reference` (optional) references a shared secret in `.env` for HMAC-signed callbacks (§5a).

## 4. Outbound URL Templating

`outbound_url` is a template resolved per participant/task launch.

Required supported placeholders:
- `{participant_id}`
- `{study_name}`
- `{task_key}`

Token placeholders:
- For each `outbound_tokens[i].name`, a placeholder of the same name must be supported (for example `{survey_token}`, `{pay_token}`).

Behavior:
- Placeholder replacement is string-based and URL-safe.
- Unknown placeholders must fail validation.
- Missing required placeholders do not have to be mandatory in template text, but all placeholders that are present must be resolvable.

## 5. Callback / Return Contract (Documented, Not Configured)

The return contract remains fixed and documented (not per-task configurable). There are two
frontends and therefore two return URLs; the admin study page shows both for every task, and a study
is configured with whichever one its participants use.

Remote site should return the browser to TRAC with query parameters:
- `pid`
- the study: `study_name` for the classic client, `study` for the rewrite (`frontend_new`)
- `callback_task_key` (or `task_key`)
- `callback_token` (or `token`)
- `hmac` *(required when the task defines `hmac_secret_reference`; see §5a)*

The prefixed names (`callback_task_key`, `callback_token`) take priority when both forms are present.

| Frontend | Return URL shape |
| --- | --- |
| classic (`frontend/`) | `{TUD_FRONTEND_URL}/pages/tasks.html?study_name=…&pid={participant_id}&callback_task_key=…&callback_token={assigned_token}[&hmac={hmac_signature}]` |
| rewrite (`frontend_new/`) | `{TUD_FRONTEND_NEW_URL}/index.html?study=…&pid={participant_id}&callback_task_key=…&callback_token={assigned_token}[&hmac={hmac_signature}]#/tasks` |

The rewrite's `#/tasks` fragment is a courtesy: the client asks the server for the participant's
stage and lands on the tasks page anyway, so a provider that drops everything after `#` still
returns the participant to the right place.

Frontend behavior:
- Read query params from the return URL.
- POST confirmation payload:
  - `task_key` = value of `callback_task_key` or `task_key`
  - `assigned_token` = value of `callback_token` or `token`
  - `hmac = hmac` (forwarded when present in the URL)
- A rejected confirmation is not an error page: the tasks page still lists what is owed. The classic
  client logs the failure; the rewrite does the same and leaves the parameters in the URL so a reload
  retries.
- The rewrite redeems the confirmation **before** it reads the stage, because the stage it fetched
  first was computed without it, then drops the spent parameters from the address bar (the token is a
  per-task credential). `pid` and any `return_url` stay.

Backend confirmation rule:
- Confirm only if `study + participant + task_key + assigned_token` match an existing assignment with callback confirmation enabled.
- If the task defines `hmac_secret_reference` a valid HMAC signature is also required (see §5a).

Security effect:
- A participant can only confirm a task for another participant if they know that other participant's valid token.
- When HMAC is enabled a participant must also possess a valid HMAC generated by the remote system, which requires the shared secret.

### 5b. What the participant payload says about a task

`GET …/study-config` returns one entry per assigned task with `task_key`, `name`, `description`,
`confirmation_type`, `assigned_token`, `continuation_url`, `is_confirmed`, `confirmed_at`,
`task_level` and `locked_reason`.

- `continuation_url` is the launch URL while the task may be opened, and empty while it may not.
- `locked_reason` is `null` when the participant may open the task now, and otherwise names the gate:
  - `task_level` - an unconfirmed task of a lower level holds it closed (all tasks of level *n* must
    be confirmed before level *n + 1* opens; see `task_level` in §3).
  - `diary` - the study sets `require_diary_before_external_tasks` and the diary is not submitted.
    This is the payment case: bank details are only collected from participants who handed in a
    diary.
- A confirmed task is never locked; `is_confirmed` wins.

Clients render `locked_reason`; they do not re-derive the level rule, which lives in one function in
`api.py` (`_build_participant_external_task_unlock_map`). `locked_reason` is the signal that replaced
"infer a lock from an empty `continuation_url`".

### 5a. HMAC-Signed Callbacks (Optional Per-Task)

A task may include an `hmac_secret_reference` field referencing a named
shared secret configured in the backend `.env` file.  When present the
remote system **must** HMAC-sign the return URL.

**Configuration**

- **`studies_config.json`**: set `"hmac_secret_reference": "survey_hub_v1"` on the task.
- **`.env`**: `TUD_EXTERNAL_TASK_HMAC_SECRETS='{"survey_hub_v1":"<hex-secret>"}'`

**Remote system contract**

1. After the participant completes the external task, compute:
   ```
   message = "study_name|participant_id|task_key|assigned_token"
   signature = HMAC-SHA256(hex_secret, message)  → hex-encoded
   ```
2. Append `&hmac={signature}` to the redirect URL.

**TRAC validation**

1. Extract `hmac_secret_reference` from the task config.
2. Look up the secret from `TUD_EXTERNAL_TASK_HMAC_SECRETS`.
3. Recompute `HMAC-SHA256(secret, message)` with the same canonical
   message.
4. Compare in constant time.  Mismatch → 403 Forbidden.

**Why this helps**

Without HMAC a participant who knows their own token can craft a fake
return URL and self-confirm.  With HMAC the return URL must be signed
by a party that knows the shared secret — i.e. the remote system's
backend, not the participant's browser.  Different remote systems
should use different secret references so that a compromise of one
system does not affect tasks hosted by another.

**Per-task opt-in**

The `hmac_secret_reference` field is optional.  Tasks without it use
the original token-only confirmation flow.  This allows gradual
adoption across different remote systems.

## 6. Validation Rules

Validation should fail fast if any rule is violated.

Task-level:
- `task_key` required, unique within study, lowercase letters/numbers/underscore.
- `confirmation_type` allowed values: `none`, `callback`.
- `name` must contain at least one localized entry.
- `outbound_url` must be non-empty.

Token groups:
- `outbound_tokens` must be non-empty for tasks requiring outbound tokens.
- Each token group `name` must be unique within a task.
- Each token group `by_participant` keys must exactly match `study_participant_ids`.
- Token values must be non-empty strings.
- No duplicate token values within the same token group.

Template:
- Every placeholder used in `outbound_url` must be one of:
  - core placeholders: `participant_id`, `study_name`, `task_key`
  - token-group names from `outbound_tokens`

HMAC:
- `hmac_secret_reference` (optional string) must reference a key that exists in `TUD_EXTERNAL_TASK_HMAC_SECRETS`.

## 7. Implementation Guidance

Because app is not in production yet:
- Replace old schema directly.
- Do not add legacy parser branches for old `tokens/send_pid/pid_query_param/config.token_query_param` layout.
- Update config examples and tests in one pass.

## 8. Minimal Example with Two Token Types

```json
{
  "task_key": "payment_info",
  "name": {
    "de": "Bankdaten eingeben"
  },
  "description": {
    "de": "Geben Sie Ihre Bankdaten ein."
  },
  "confirmation_type": "callback",
  "outbound_tokens": [
    {
      "name": "pay_token",
      "by_participant": {
        "bernd": "pay-bernd-123",
        "sophia": "pay-sophia-456",
        "claudia": "pay-claudia-789"
      }
    },
    {
      "name": "site_user_token",
      "by_participant": {
        "bernd": "site-bernd-a",
        "sophia": "site-sophia-b",
        "claudia": "site-claudia-c"
      }
    }
  ],
  "outbound_url": "https://survey.academiccloud.de/f/153222?pid={participant_id}&study_name={study_name}&task={task_key}&pay={pay_token}&u={site_user_token}"
}
```
