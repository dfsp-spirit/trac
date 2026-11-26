# Proxy Studies (Parent–Child) — Plan Notes

Status: draft, under discussion (2026-11-26). Not yet an implementation plan.
Source: [dfsp-spirit/trac#142](https://github.com/dfsp-spirit/trac/issues/142) — issue body plus the comments of 2026-11-25 (meeting decisions, technical plan) and 2026-11-26.
This file records the decisions taken so far and the clarifications from the 2026-11-26 review, so the issue can be rewritten in one pass later.

Related existing docs: [Testing & environment](../../docs/agents/testing.md), [Backend agents](../../docs/agents/backend.md), [Database agents](../../docs/agents/database.md), [External tasks v2 spec](../../docs/external-tasks-v2-spec.md) (house style for this kind of document).

---

## 1. Problem

A parent fills out the diary for two children, so the app must know *who a given diary belongs to*, and the parent must be able to work on two separate questionnaires without the client being able to choose identities.

**Why it cannot be done client-side** (the actual justification for the feature): today the participant id *is* the credential. It is carried in the invitation link and used directly as the request identity (see [participant_ids.py](../../backend/src/o_timeusediary_backend/participant_ids.py) and [participant_context.py](../../backend/src/o_timeusediary_backend/api_deps/participant_context.py)). A client that may send a child's id can read and write that child's diary. The parent→child relation therefore has to be **server-side state**; the subject of a write is resolved on the server, never taken from the request.

## 2. Decisions taken (meeting 2026-11-25, refined 2026-11-26)

1. KI supplies a CSV/TSV roster per study, uploaded through the admin interface.
2. A server secret decrypts the name/deadline columns (Fernet, AES-GCM or similar).
3. In proxy studies the parent cannot fill out a diary for themselves — only for the children.
4. A parent fills out **two separate 7-day questionnaires**, one per child.
5. Direct use of a child link is not possible.
6. Data export yields one row per child; no rows for parent users.
7. The participants/users endpoint gains a column telling `parent` from `child`.
8. API activity export and scientific CSV export: one row per child, child id but **no name**.
9. Scientific CSV export may gain `response_type` (`proxy_response` / `self_response`).
10. A study is either self-report or proxy-report — never mixed.
11. Proxy studies can never be open (no invitation-less joining, no public listing).
12. Proxy studies ship later than the first self-report studies (2–3 months), but schema changes should land before 1.0 to avoid post-production migrations.

## 3. Data model (current design)

### 3.1 Study

- `studies.allows_proxy BOOLEAN NOT NULL DEFAULT FALSE` — the data-source axis. Self-report is the default.

### 3.2 Participants

There is no global `users` table and there will not be one: identity is study-scoped. The target is `study_participants` (unique on `(study_id, participant_id)`, see [models.py](../../backend/src/o_timeusediary_backend/models.py)).

New data per participant (exact column placement still open, see §9.1 and §9.7):
- the child's name — encrypted at rest,
- the latest possible submission time — encrypted at rest, one value per family (parent + both children).

### 3.3 Parent → child relation: **1:n**

One respondent, N subjects. For the twin study: one parent row, two child rows.

Design: a nullable self-reference on the child row (`proxy_participant_id` → `study_participants.id`), or an equivalent link table with a uniqueness rule that enforces at most one respondent per subject. 1:n was chosen because it makes "is this a parent or a child" a single column check and structurally prevents the state where a participant is both proxy and subject.

DB-level constraints to add (recommended): links must stay inside one study (composite FK on `(study_id, participant_id)`, which the existing unique constraint already supports), and no row may point at itself.

**Status: 1:n, pending confirmation by KI** whether a single parent per child is acceptable. If they ever send links to both parents, the model becomes n:m (`proxy_links(proxy_participant_id, subject_participant_id)`) and "at most one respondent per subject" becomes "both parents see the same child".

## 4. Dropped from the earlier technical plan

| Idea in the issue | Decision |
| --- | --- |
| `users.can_self_report` | **Dropped.** It is fully derivable: self-report study ⇒ everyone may self-report; proxy study ⇒ nobody may (parents act for children, children do not fill out at all). A stored copy can only drift from `studies.allows_proxy`. |
| `responses.respondent_type` | **Dropped.** There is no `responses` table; a "response" is the set of `activities` rows plus `study_participants.study_submitted_at`. The value is constant per study, so it is derived in exports instead of stored per activity row. |
| `ENUM` column type | **Dropped.** Repo convention is `String(n)` + `CHECK` (e.g. `skip_reason_code`, `audience`) to stay DBMS-neutral. |
| Generic per-user "custom fields" store, per-day descriptions | **Deferred** — see §10. The decided feature is narrower: names + deadline + parent/child links. |

## 5. Role derivation (replaces `can_self_report`)

Role is computed, never stored:

- self-report study ⇒ every participant is `self`;
- proxy study ⇒ look at the proxy link: listed as respondent ⇒ `proxy`, listed as subject ⇒ `subject`.

In a consistent roster every participant of a proxy study is in exactly one of the two positions, so the derivation has no "unknown" case. A participant in neither position is an **import error**, not a runtime null (that is the state a half-applied upload produces).

The participants endpoint (`/api/admin/participants`) shows this role; completion for a parent is `both children complete` (skip semantics still open, see §9.5).

## 6. Roster import

Reuse the existing roster upload, `POST /api/admin/studies/{study_name_short}/import-participants` in [api.py](../../backend/src/o_timeusediary_backend/api.py) — it already parses CSV/TSV via [tabular_files.py](../../backend/src/o_timeusediary_backend/tabular_files.py), validates ids through [participant_ids.py](../../backend/src/o_timeusediary_backend/participant_ids.py), upserts `display_name`, fails the whole file on any bad row, and supports `dry_run`.

New columns:

| Column | Type | Notes |
| --- | --- | --- |
| `parent_id` | string | Must also be a valid participant id. |
| `twin1_id`, `twin2_id` | string | Child participant ids. Exactly two, per the twin study; a general (long-format) variant is an open question, §9.4. |
| `twin1_name_encrypted`, `twin2_name_encrypted` | string | Encrypted in the file and at rest, decrypted only at runtime. |
| `latest_possible_submission_at_encrypted` | string | Decrypts to an ISO 8601 instant with explicit UTC offset. One value per row — valid for the parent **and both** children (the parent is the only one who submits). |

Validation rules (all whole-file errors, like the existing roster):

- ids follow the shared participant-id rule;
- the same child id must not appear in two rows;
- no id may be both a parent and a child, and no id may be its own parent;
- decrypted deadline must parse as ISO 8601 **with offset** (`Z` or `±HH:MM`); a value without an offset is read as UTC (app-wide convention, same rule as `data_collection_start/end` in [studies_config.py](../../backend/src/o_timeusediary_backend/parsers/studies_config.py));
- deadline must be **≤ the study's `data_collection_end`** and (recommended) **≥ `data_collection_start`**;
- a deadline already in the past is a warning, not a silent success.

Idempotency: re-uploading updates names/deadline (like the current `display_name` upsert). Open: what a re-upload that *removes* a twin does — unlink only, or also delete that child's activity rows (§9.6).

## 7. Encryption

- Names and the deadline are **encrypted in the CSV and at rest in the database**; decryption happens only at runtime, immediately before the value is used or sent to a client.
- The key is fixed, set once, and configured like the other server secrets: environment variable in the backend `.env` (see [.env.example](../../backend/.env.example), [settings.py](../../backend/src/o_timeusediary_backend/settings.py)). No key material in the DB, in study config, in logs, or in the audit log.
- The key must never be logged, and an import failure must not echo decrypted values.
- Consequence to plan for: encrypted values cannot be searched, sorted, or joined by value. The deadline is therefore decrypted and validated on import, and any enforcement compares it after decryption (or against a separately stored non-encrypted, non-personal copy — decision needed, §9.1).

Implementation note: no crypto dependency exists in [pyproject.toml](../../backend/pyproject.toml) yet; `cryptography` (Fernet) would be added if that method is chosen.

## 8. Enforcement and security requirements

1. **Subjects cannot act as respondents.** The participant-context dependency must refuse a participant that is a subject in a proxy study — for reads and writes. Acceptance criterion: *a request carrying a child's participant id can neither read nor write that child's diary.*
2. **The subject of a write is server-side state.** The client never sends "which child"; the server resolves the active subject from the parent's session/link.
3. **Children get no invitation link.** Necessary but not sufficient on its own — point 1 is the enforcement.
4. **Proxy studies are never open**: `allow_unlisted_participants = false` and `is_listed_publicly = false` must be validated at config-import time, not merely defaulted, since an unlisted id currently creates a stand-in participant context in [participant_context.py](../../backend/src/o_timeusediary_backend/api_deps/participant_context.py).
5. **Deadline is enforced server-side**: saves after the deadline are **rejected** (not accepted-and-flagged). The check belongs next to the existing collection-window check and must use the same UTC-normalizing helpers (`coerce_utc_aware`, `to_utc_naive` in [utils.py](../../backend/src/o_timeusediary_backend/utils.py)).

## 9. Open questions for the next discussion

1. **Name storage vs. at-rest encryption.** `study_participants.display_name` already exists, is validated, substituted into study texts as `{display_name}`, shown in admin and exported. Options: (a) new encrypted column for proxy names, keep `display_name` for self-report studies; (b) encrypt `display_name` everywhere (touches study-text substitution, admin, export, backup). Also unresolved: how the deadline is compared if it is stored only encrypted (§7).
2. **1:n vs n:m** — waiting for KI's answer on one parent vs. both parents (§3.3).
3. **Child's own completion state / what a parent sees** when one child is submitted and the other is skipped or hits the deadline.
4. **Wide vs. long CSV.** `twin1_*`/`twin2_*` hard-codes exactly two children; a long format (`parent_id, subject_id, subject_name_encrypted, deadline`) would generalize at no extra cost if KI's export can produce it.
5. **Skip semantics** for parents: can a parent skip one child's questionnaire, both, or none?
6. **Re-upload that removes a twin**: unlink vs. delete research data.
7. **Where the deadline lives** — on the parent row (one per family) or per child row; and whether it also blocks parent-initiated actions like skipping.
8. **Client behaviour at the deadline**: error code, message text (localized), and whether an in-progress day is still savable.
9. **`response_type` in the science CSV**: derived from `allows_proxy` (cheap, cannot drift) vs. recorded at submission time (audit-proof). Leaning derived.
10. **Does the deadline replace or narrow the study's collection window?** Both exist; state which check runs first and what the client is told.
11. **Study-text placeholders**: `{display_name}` already works. Do we need additional placeholders (e.g. a per-child label on the day view), or is `{display_name}` enough for v1?

## 10. Out of scope for now

- Generic per-user custom-field store with per-language labels.
- Per-day custom descriptions ("this day belongs to child X").
- Per-study export opt-in for personal fields beyond the fixed name/deadline columns.
- Multiple respondents per child (n:m) unless §9.2 says otherwise.

## 11. Housekeeping

- Next Alembic revision is `0025`; forward-only migration tests live in `backend/tests/migrations/` ([test_backend_migrations.sh](../../test_backend_migrations.sh)).
- The issue body should be rewritten once §9 is resolved (Problem / Decision / Data model / Non-goals / Open questions), replacing the `users`/`responses` vocabulary with `study_participants`/`activities`.
