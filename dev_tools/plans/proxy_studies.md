# Proxy Studies (Parent–Child) — Plan Notes

Status: draft, decisions recorded through 2026-11-27. Not yet an implementation plan.
Source: [dfsp-spirit/trac#142](https://github.com/dfsp-spirit/trac/issues/142) — issue body plus the comments of 2026-11-25 (meeting decisions, technical plan), 2026-11-26 and 2026-11-27.
This file records the decisions taken so far and the clarifications from the 2026-11-26 and 2026-11-27 reviews, so the issue can be rewritten in one pass later.

Related existing docs: [Testing & environment](../../docs/agents/testing.md), [Backend agents](../../docs/agents/backend.md), [Database agents](../../docs/agents/database.md), [External tasks v2 spec](../../docs/external-tasks-v2-spec.md) (house style for this kind of document).

Implementation plan: [proxy_studies_implementation.md](./proxy_studies_implementation.md) — phases, files, test data.

---

## 0. Intended workflow (clarified 2026-11-27)

This is the behaviour everything else has to serve. Read it before the data model.

A proxy study is a **closed study with a fixed roster**. The KI's file (parent id, child ids, names, deadline) must be uploaded *before the study starts*, so a parent's link can never fall back to the stand-in participant an open study creates.

**Each child gets their own 7-day questionnaire.** A child is *not* a second dimension of a day ("Monday for child 1" vs. "Monday for child 2"); the parent fills one complete questionnaire per child, one after the other. The parent's walk through the study is linear:

1. The parent opens their own invitation link, `?study=...&pid=<parent_id>`. The link names no child, and the client never has to know which children exist.
2. The server resolves the family and presents the **first child whose questionnaire is not finished**. For a fresh family that is the first child in file order.
3. The parent fills that child's diary. The day view shows that child's name, so "which child am I in" is a property of the page, not of the day.
4. On submit, the server looks for the next unfinished child. If there is one, the client shows **that child's questionnaire instead of the thank-you page**; only when no child is left does the family reach the thank-you page, once.
5. A reload, a new tab or a second visit lands on the same child, because the **active child is derived from completion state, never stored**. So there is no "which child" parameter, no subject switch and no server-side selection state — which is exactly the requirement in §8.2.
6. Optional convenience: when the parent starts child 2, 3, … and a previous child's diary exists, the app offers to **copy that diary as a template**. The parent accepts or rejects; rejecting starts from a blank diary. The copy is a convenience for the parent, and it is research-relevant: a copied diary is not independent data (see §9.12).

Consequences worth keeping in mind while reading the rest of this document:

- The parent is a **credential, not a respondent**: the parent row carries the link and the family, never a diary of its own (decision 3 in §2).
- "Unfinished child" (step 2 and 4) is the definition the whole flow hangs on; it must have exactly one meaning, shared by the server, the stage machine and the admin views (§9.5).
- Because children are sequenced, the two questionnaires must not overlap in time, so one family deadline is enough (§9.7) and the children can share the study's day labels and catalogue unchanged.
- Copying a whole questionnaire is a *participant-level* action; the existing copy feature ([copyDay.js](../../frontend/src/js/ui/copyDay.js), `POST .../day-copies` in [api_diary.py](../../backend/src/o_timeusediary_backend/api_diary.py)) copies days *within* one participant and cannot be reused as-is.

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

### 2a. Decisions taken 2026-11-27

13. **Children are sequenced, not concurrent** (§0): one questionnaire per child, the next one starts after the previous one is submitted or skipped, and the active child is derived from completion state.
14. **Consent and instructions happen once per family.** The child's stage reads the family's consent/instructions, not its own row.
15. **The parent row is never stamped as submitted**; the parent's completion is derived from the children (`derive_only`). Each child's own `study_submitted_at` is what advances the sequence.
16. **The deadline is a hard stop**: no write is accepted after it, not even on a questionnaire in progress, and that includes **submit and skip**. A family that filled everything but did not submit in time is reported as not submitted; the data that exists stays in `activities` and is not reinterpreted (`submitted = false`).
17. **Finishing definition:** a child is *finished* when its row has `study_submitted_at` — set by submitting **or** by skipping. A skip in a proxy study applies to **every still-unfinished child at once** (the parent abandons the study, not one twin); children already submitted stay submitted, so "fill child 1, then skip" yields child 1 `submitted` and child 2 `skipped`, and the researcher excludes it in analysis.
18. **The template copy is unmarked**: one server-side action, no provenance column. Accepted consequence, to be documented for the researchers: a questionnaire seeded from a sibling is not independent data, and nothing in the export says so.
19. **Child names are encrypted at rest**, per the KI's requirement. They are not searched, not re-exported and not shown in the participants endpoint; the pid remains the only identity our app needs. `display_name` ("For: Tim") is the child's first name and exists only so a parent does not mix up the twins.
20. **One shared key**: the KI operates the server and holds the key, so file decryption and at-rest encryption use the same secret. First key encrypts, all keys decrypt (§7.3).
21. **The runtime-config backup carries ciphertext**, so a restore needs the same key set. The key itself is never in the backup.
22. **The admin UI shows pids only** for proxy participants — no decrypted names, so the name column is hidden and search runs on ids.
23. **One end text for the family**: thank them for taking part, with no commentary on which child was filled, skipped or missed. Proxy studies therefore do not use `study_text_end_skipped`.
24. **An encryption health check in the admin interface is required**, not optional: the KI operates the server and must be able to verify the key after a change, a restore or a redeploy, before any parent notices (§7.6).
25. **No silent degradation when the key fails.** Showing a child's pid instead of the name does not help a parent tell twins apart, so the app must surface the problem rather than quietly serve a page without the name.

## 3. Data model (current design)

### 3.1 Study

- `studies.allows_proxy BOOLEAN NOT NULL DEFAULT FALSE` — the data-source axis. Self-report is the default. (Naming note: the repo convention is `allow_*` / `require_*`, e.g. `allow_unlisted_participants`, `allow_skip_timeuse`; the final column name is fixed in the implementation plan, because it cannot change after 1.0.)

### 3.2 Participants

There is no global `users` table and there will not be one: identity is study-scoped. The target is `study_participants` (unique on `(study_id, participant_id)`, see [models.py](../../backend/src/o_timeusediary_backend/models.py)).

New data per participant (deadline placement open, see §9.7):
- the child's name — encrypted at rest (decision 19), never searched, exported or listed,
- the latest possible submission time — one value per family, therefore on the parent row. The KI's *file* column is encrypted; at rest it should be a plain `DateTime(timezone=True)`, because decision 16 turns it into a comparison on every write (§9.7).
- on the child row: the parent link (§3.3). No order column: "first unfinished child" (§0) sorts by insertion order (`study_participants.id`), which is file order on a fresh import and stays stable across reloads and re-uploads.

### 3.3 Parent → child relation: **1:n** (confirmed by KI, 2026-11-27)

One respondent, N subjects. For the twin study: one parent row, N child rows. N is not fixed at two — the roster is long-format (§6), so the model must not have `twin1`/`twin2` slots.

Design: a nullable self-reference on the child row. To keep links inside one study, the column stores the **participant id** and the FK is composite over the existing unique constraint:

```
proxy_participant_id  ->  FOREIGN KEY (study_id, proxy_participant_id)
                          REFERENCES study_participants (study_id, participant_id)
```

(A reference to `study_participants.id` would need an extra `UNIQUE (study_id, id)`, which the existing `uq_study_participant` does not provide.) 1:n was chosen because it makes "is this a parent or a child" a single column check and structurally prevents the state where a participant is both proxy and subject.

DB-level constraints to add: no row may point at itself, and each parent must belong to the same study as its children (the composite FK does that).

**Status: 1:n confirmed.** If the KI ever sends both parents for one child, the model becomes n:m (`proxy_links(proxy_participant_id, subject_participant_id)`), which is a migration, not a rewrite — the composite-FK pattern carries over.

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

The participants endpoint (`/api/admin/participants`) shows this role; a parent is complete when **every child is finished** in the sense of decision 17 (submitted or skipped), derived rather than stored (decision 15).

## 6. Roster import

Reuse the existing roster upload, `POST /api/admin/studies/{study_name_short}/import-participants` in [api.py](../../backend/src/o_timeusediary_backend/api.py) — it already parses CSV/TSV via [tabular_files.py](../../backend/src/o_timeusediary_backend/tabular_files.py), validates ids through [participant_ids.py](../../backend/src/o_timeusediary_backend/participant_ids.py), upserts `display_name`, fails the whole file on any bad row, and supports `dry_run`.

New columns — **long format, one row per child** (confirmed by KI, 2026-11-27):

| Column | Type | Notes |
| --- | --- | --- |
| `parent_id` | string | Must also be a valid participant id. Repeated on every row of the same family. |
| `subject_id` | string | The child's participant id. Exactly one per row; N rows per parent. |
| `subject_name_encrypted` | string | The child's first name, encrypted in the file and at rest (§7). |
| `latest_possible_submission_at_encrypted` | string | Decrypts to an ISO 8601 instant with explicit UTC offset. Repeated per family row — all rows of one parent must decrypt to the **same** value, and it is stored **once**, on the parent row. |

Consequences of the long format: the unit of a row is a child, not a family, so the import groups rows by `parent_id`; the parent row is created once per group; the row order of the file becomes the questionnaire order through insertion order (§3.2), with no extra column; and the deadline is a family-level value that the file repeats.

Validation rules (all whole-file errors, like the existing roster):

- ids follow the shared participant-id rule;
- a child id must appear exactly once in the file, and no id may be both a parent and a child (in any row), nor its own parent;
- every row of one `parent_id` must carry the **same** deadline; a differing value is an error rather than a last-wins;
- decrypted deadline must parse as ISO 8601 **with offset** (`Z` or `±HH:MM`); a value without an offset is read as UTC (app-wide convention, same rule as `data_collection_start/end` in [studies_config.py](../../backend/src/o_timeusediary_backend/parsers/studies_config.py));
- deadline must be **≤ the study's `data_collection_end`** and (recommended) **≥ `data_collection_start`**;
- a deadline already in the past is a warning, not a silent success.

Idempotency: re-uploading updates names/deadline (like the current `display_name` upsert). Open: what a re-upload that *removes* a child does — unlink only, or also delete that child's activity rows (§9.6).

## 7. Encryption

Decided 2026-11-27 (decisions 19–22, 24–25). The KI operates the server and holds the key, so this is one shared secret, not a secret of ours. The **cipher format is not settled yet** — the KI may encrypt with a non-Python library, so the envelope has to be written down (§7.3, §9.13).

### 7.1 What is encrypted

- **The child's name, at rest.** Column `study_participants.subject_name_encrypted`, `String(512)`. A typical name yields 105 (AES-GCM) to 165 (Fernet) characters, but the bound has to cover the worst case: the name rule allows 50 *code points*, and 50 four-byte UTF-8 characters are 200 bytes, which seals to ~304 base64 characters. `String(255)` would fail on a valid name; `display_name`'s `String(64)` cannot hold a token at all. `display_name` stays the plaintext slot for self-report studies.
- **The child's name, in the KI's roster file.** Decrypted on import, validated with `display_names.validate_display_name`, re-encrypted for storage. So there is exactly one name rule, and the roster cannot introduce a name the app would reject.
- **The deadline, in the roster file** — decrypted on import and stored as a plain `DateTime(timezone=True)` on the parent row. It is not encrypted at rest: decision 16 makes it a comparison on every write, and a timestamp does not identify a person.
- **Nothing else.** Encrypted values are never searched, sorted, joined, exported or listed.

### 7.2 How a column says it is encrypted

Convention over framework: **a column whose name ends in `_encrypted` holds a ciphertext token in the envelope of §7.3, and no other column does.** One small module owns the rule ([`encrypted_fields.py`](../../backend/src/o_timeusediary_backend/encrypted_fields.py)):

```
ENCRYPTED_SUFFIX = "_encrypted"
encrypt_text(value) / decrypt_text(token) / is_encrypted_field(name) / mask(value)
```

The module is the only place that knows the format, so settling the KI's format later is a change to one file, not to the model or the import.

Not a generic custom-field store (there is one encrypted value; a generic store would make "no name reaches an export" untestable), and **not** a transparent SQLAlchemy `TypeDecorator`: `StudyParticipant` rows are bulk-loaded by every export and admin list, so a model-level decorator would let a missing or wrong key break self-report studies too. Field encryption must not be able to take down code that does not use it.

One resolver keeps the two storage slots from drifting:

```
participant_display_name(participant) -> decrypt(subject_name_encrypted) or display_name
```

Called by the study-config payload, the admin views and the runtime-config backup. Nothing else reads the encrypted column.

### 7.3 Key

- One shared secret, `TUD_FIELD_ENCRYPTION_KEYS`, comma-separated: **the first key encrypts, all keys decrypt**. The KI's key is the only entry, which also means the KI can decrypt their own data (§7.5).
- Configured like the other server secrets ([.env.example](../../backend/.env.example), [settings.py](../../backend/src/o_timeusediary_backend/settings.py)). Never in the DB, in study config, in logs or in the audit log; an import failure must not echo a decrypted value or a token.
- **Startup validates the format only** (key present, right length, decodable) — the app must stay API-only at startup and not touch the DB. A missing or malformed key is a clear startup error, not a 500 later.
- **Rotation needs no extra machinery if the envelope carries no key id**: decrypting tries each configured key in turn (with one or two keys the cost is nil). If the KI's format turns out to be raw AES-GCM without any key identifier, that trial decryption is the mechanism; Fernet brings it for free. A prepended version byte is worth asking for either way.
- **The envelope must be specified byte-for-byte**, because the producer may not be Python (§9.13). It has to fix: base64 or base64url and padding, nonce length and call site (12 bytes, random per value), tag length and whether it is appended, any associated data, raw key encoding (hex/base64, 32 bytes), and a version prefix so a later format change is detectable rather than corrupting.
- A decryption failure maps to a fixed message and logs the participant id only — never the token, never the plaintext.
- The key lives **outside** the database backup. The runtime-config backup carries ciphertext (decision 21), so a restore needs the same key — document that pairing.

### 7.4 How the convention stays true

CI enforces both directions, which is what makes the convention worth having:

- every `*_encrypted` column is `String(n >= 64)` and appears in no Pydantic response model and no export header;
- the list of columns that *must* be encrypted is explicit, so a future plaintext `child_name` fails;
- after an import, a raw `SELECT` of the column does not contain the name;
- the admin participant search ([api.py](../../backend/src/o_timeusediary_backend/api.py)) does not add an `ilike` on an encrypted column, which would silently match nothing.

### 7.5 Consequences of one shared key

- The KI can decrypt the database, not only the roster. Accepted: they operate the server and are the data controller. It also gives them a way to verify their roster arrived intact.
- Because they hold the key and run the deployment, they can also *detect* a broken key themselves — which is why the admin check in §7.6 is the mitigation that matters.
- The same custody is the risk: without the key, every name is unreadable. Mitigable by re-uploading the roster, which is why import must stay idempotent.
- Our obligation narrows to the surfaces *we* generate: logs, the admin audit log, exports, error messages and the runtime-config backup. None of them may carry a name or a token.

### 7.6 Admin check (required)

A wrong or missing key must be found **before** a parent hits it, not by a parent. Because the fallback is useless to them (see below), the check is the primary defence, not a nicety.

- **A diagnostics check in the admin interface** — a section on [admin_tools.html](../../backend/src/o_timeusediary_backend/templates/admin_tools.html), backed by a super-admin endpoint: how many keys are configured (count only, never values), how many sampled `subject_name_encrypted` rows decrypted, how many failed, and which participant ids failed.
- It samples a bounded number of rows (e.g. 20 across studies) and never prints a name or a token. It never raises on a decryption failure; it reports counts and the ids.
- It is what an admin runs after a key change, a restore or a redeploy. No stored state, no background job.
- **No silent fallback**: showing the bare pid instead of the name does not help a parent tell twins apart, so a key problem must surface as an error and an admin warning, not as a degraded page that quietly removes the only thing distinguishing the two questionnaires. The exact status code/message is still open (§9.14).

Implementation note: `cryptography` is not yet a dependency of [pyproject.toml](../../backend/pyproject.toml).

## 8. Enforcement and security requirements

1. **Subjects cannot act as respondents.** Every place that resolves a participant id must refuse a participant that is a subject in a proxy study — for reads and writes. That is **three** places, not one: `get_participant_context` (the diary and session routers, and through `require_participant_session` also consent, instructions, client-info, skip, submit and the external-task confirm/launch endpoints), plus the two bootstrap endpoints that authorize inline from a `participant_id` **query parameter** and never touch the dependency — `GET .../study-config` (which also returns `participant_display_name`) and `GET .../activities-config`. Acceptance criterion: *a request carrying a child's participant id can neither read nor write that child's diary* — including its name via study-config.
2. **The subject of a write is server-side state.** The client never sends "which child": the server derives the active subject from the parent's link plus the children's completion state (§0). Credential and data identity are deliberately separate — the credentialed participant is the parent, the owner of the diary rows is the child — and so is the write target: diary data goes to the child row, family state (consent, instructions, deadline) to the parent row, and the participant session is keyed by the **credential** so it does not flip when the sequence advances.
3. **Children get no invitation link.** Necessary but not sufficient on its own — point 1 is the enforcement.
4. **Proxy studies are never open**: `allow_unlisted_participants = false` and `is_listed_publicly = false` must be validated at config-import time, not merely defaulted, since an unlisted id currently creates a stand-in participant context in [participant_context.py](../../backend/src/o_timeusediary_backend/api_deps/participant_context.py).
5. **Deadline is enforced server-side**: saves after the deadline are **rejected** (not accepted-and-flagged). The check belongs next to the existing collection-window check and must use the same UTC-normalizing helpers (`coerce_utc_aware`, `to_utc_naive` in [utils.py](../../backend/src/o_timeusediary_backend/utils.py)).

## 9. Open questions for the next discussion

1. ~~**How to store an encrypted name**~~ — decided 2026-11-27 (§7): explicit `subject_name_encrypted` column, `_encrypted` suffix convention, one crypto module, one resolver, CI-enforced; no silent fallback when the key fails (25).
2. ~~**1:n vs n:m**~~ — KI confirmed **1:n**: one parent per child.
3. ~~**End text for a mixed family**~~ — decided 2026-11-27 (23): thank the family once, no details, no skipped variant.
4. ~~**Wide vs. long CSV**~~ — KI confirmed **long format** (`parent_id, subject_id, subject_name_encrypted, deadline`), one row per child. The model must therefore support N children, not two named slots; the import groups rows by `parent_id`.
5. ~~**"Unfinished child"**~~ — resolved 2026-11-27 by decision 17: finished means `study_submitted_at` is set, by submit or by skip; a skip closes every unfinished child.
6. **Re-upload that removes a child**: unlink vs. delete that child's research data.
7. **Where the deadline lives** — one value per family, so the **parent row** is the natural home (recommended); a copy on each child row can drift. Remaining: does the deadline also block family-level actions (consent, instructions, the template copy), and is it editable in the admin UI after import?
8. **Client behaviour at the deadline**: the hard stop is decided (16); still open are the error code, the localized message, and whether the family sees a distinct "deadline passed" page instead of the generic study-ended one.
9. **`response_type` in the science CSV**: derived from `allows_proxy` (cheap, cannot drift) vs. recorded at submission time (audit-proof). Leaning derived.
10. **Does the deadline replace or narrow the study's collection window?** Both exist, so the effective end is the earlier of the two. Still to state: which check runs first in `study_availability` (a family deadline is more specific than "the study is over" and should probably win for the message), and whether the client needs a separate unavailable reason for it.
11. **Study-text placeholders**: `{display_name}` already works. Do we need additional placeholders (e.g. a per-child label on the day view), or is `{display_name}` enough for v1?
12. ~~**Template copy**~~ — decided 2026-11-27 (18): one server-side action, copies the previous child's whole questionnaire, **no marker**. Open sub-question only: is it offered exclusively when the target child's diary is still empty, and is it a one-time offer or repeatable until the parent saves something of their own?
13. **Crypto format contract with the KI** — open, waiting for their reply email. Current state: we proposed **AES-GCM**, and the KI does not necessarily encrypt from Python, so the envelope has to be pinned down independently of any library: encoding, nonce and tag placement, key encoding, and a version prefix (§7.3). This is the one item that blocks the roster importer; everything else about the crypto is decided.
14. ~~**Missing or wrong key at runtime**~~ — decided 2026-11-27 (25): no silent fallback; the admin check (24, §7.6) is the defence. Remaining detail only: the exact status code and message the participant sees.

## 10. Out of scope for now

- Generic per-user custom-field store with per-language labels.
- Per-day custom descriptions ("this day belongs to child X").
- Per-study export opt-in for personal fields beyond the fixed name/deadline columns.
- Multiple respondents per child (n:m) — KI confirmed one parent per child (decision 2/§3.3).

## 11. Housekeeping

- Next Alembic revision is `0025`; forward-only migration tests live in `backend/tests/migrations/` ([test_backend_migrations.sh](../../test_backend_migrations.sh)).
- The issue body should be rewritten once §9 is resolved (Problem / Decision / Data model / Non-goals / Open questions), replacing the `users`/`responses` vocabulary with `study_participants`/`activities`. That rewrite should also close sub-issues [#163](https://github.com/dfsp-spirit/trac/issues/163)–[#166](https://github.com/dfsp-spirit/trac/issues/166) or fold them into the new text: they still use the dropped `users`-table vocabulary.
- Still open: §9.13 (crypto format, waiting for the KI's email) and the remaining detail items in §9.
