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

The return contract remains fixed and documented (not per-task configurable).

Remote site should return to TRAC tasks page with query parameters:
- `pid`
- `study_name`
- `callback_task_key`
- `callback_token`

Frontend behavior:
- Read query params from tasks page URL.
- POST confirmation payload:
  - `task_key = callback_task_key`
  - `assigned_token = callback_token`

Backend confirmation rule:
- Confirm only if `study + participant + task_key + assigned_token` match an existing assignment with callback confirmation enabled.

Security effect:
- A participant can only confirm a task for another participant if they know that other participant's valid token.
- This is the baseline security accepted for first implementation.

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
