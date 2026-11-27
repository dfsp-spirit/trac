# Proxy Studies — Implementation Plan

Status: draft for review, 2026-11-27. Not yet started.
Progress: **A–J done, K partially** — implemented 2026-11-27. Verified: 657 unit tests, 283 integration tests (including the §7 acceptance scenarios), 29 migration tests, 383 frontend unit tests plus architecture and typecheck. Not verified: the copy offer in a real browser.
Derived from [proxy_studies.md](./proxy_studies.md) — the decision record (decisions 1–25). That file says *what* and *why*; this one says *in what order*, *which files*, and *how it is tested*.

Phases A–K are independently shippable and each ends green. A, B and C can run in parallel; D depends on B; E–I depend on D; J depends on E; K is last.

---

## 1. Encryption: build the seam now, with a real codec behind it

The answer to "build the rest unencrypted and add the layer later" is **no**, and the answer to "stub the key management" is **yes, at exactly one point**.

**Why not unencrypted first.** Every integration point has to be built either way: the roster import decrypting and validating, the study-config payload resolving a name, the health check, the CI guards that keep names out of exports. Built against an identity codec, those paths would be exercised with plaintext, so the guard tests ("a raw `SELECT` does not contain the name") would be vacuous and the real bugs — column length, error-path leakage, wrong-key behaviour — would appear on the day the real format lands, during a live study. It would also require a later data migration to encrypt rows that were stored in the clear.

**Why not guess the KI's format.** The one genuinely unknown piece is the *incoming file* format, which is theirs. That is a single function behind a version prefix.

**What we build now** — [`encrypted_fields.py`](../../backend/src/o_timeusediary_backend/encrypted_fields.py):

```
KEY_ENV = "TUD_FIELD_ENCRYPTION_KEYS"      # comma-separated, first encrypts, all decrypt
encode(plaintext) -> "v1." + base64url(nonce12 || ciphertext || tag16)   # AES-256-GCM
decode(token)     -> plaintext             # dispatches on the prefix
decode_incoming(token) -> plaintext        # the ONLY extension point for the KI's file format
probe(session, limit) -> counts            # for the admin health check
mask(value) / is_encrypted_field(name)
```

`decode_incoming` currently equals `decode`. When the KI's format arrives, it gains a second branch (`"k1."` or a documented unwrapping), and nothing else in the codebase changes. That is the "stub" — a seam with one implementation, not a no-op.

**Consequence for the column type.** `String(512)`, not 255: a typical name seals to ~105–165 characters, but the name rule allows 50 *code points* and 50 four-byte UTF-8 characters seal to ~304 base64 characters. A unit test pins the bound.

---

## 2. Phases

### Phase A — Crypto seam (no schema, no behaviour change)

**Files:** `encrypted_fields.py` (new), `settings.py`, `.env.example`, `pyproject.toml`, `tests/unit/test_encrypted_fields.py` (new).

- Add `cryptography` via `uv add cryptography`.
- `settings.field_encryption_keys: list[bytes]` parsed like `external_task_hmac_secrets` (property, read from the environment), plus a `settings.validate_field_encryption_keys()` called from the `lifespan` in [api.py](../../backend/src/o_timeusediary_backend/api.py), next to `validate_auth_configuration()` — that is the existing fail-fast-at-startup pattern, and it keeps startup DB-free.
- `encrypt_text` / `decrypt_text` / `mask` / `is_encrypted_field` / `decode_incoming` / `probe`, plus `DecryptionError` and `EncryptionConfigError`.
- `decrypt_text` never includes the token or the plaintext in its message; the caller adds `participant_id` context.

**Tests:** round-trip; wrong key raises `DecryptionError` with no token in `str(error)`; unknown prefix raises; empty/None passes through; a 50-character name stays under 255; `probe` reports 0/0 on an empty table and counts failures without leaking.

**Done when:** the unit suite is green, nothing else imports the module yet.

> Done 2026-11-27. `encrypted_fields.py` + 39 unit tests + the startup validation. Nothing imports it for storage yet, which is exactly the point.

---

### Phase B — Schema (migration `0025_add_proxy_studies`)

**Files:** `models.py`, `alembic/versions/0025_add_proxy_studies.py` (new), `tests/migrations/` (existing forward-only harness).

Columns are listed in §3. `models.py` gets the fields, the composite FK, the CHECK and the index.

**Tests:** the existing forward-only migration test runs `upgrade` and `downgrade`; add a unit assertion that the model and the migration agree on nullability/defaults (pattern from `test_database_migrations.py`).

**Done when:** `./test_backend_migrations.sh` is green and an upgraded dev database still serves the existing suite.

> Done 2026-11-27. `0025_add_proxy_studies` + model fields + a database-level test for the three link rules (parent link allowed, self-link refused, cross-study link refused). All 29 migration tests pass, including the model/migration drift check and the pre-Alembic adoption path.

---

### Phase C — Study mode: config, validation, backup round-trip

**Files:** `parsers/studies_config.py`, `api.py` (`ImportStudiesConfigStudy`, create/update payloads, runtime-config export), `database.py` (hydration), `templates/admin_study_detail.html`.

- `report_mode` replaces the decision record's `allows_proxy` (§3.1 argues why a mode beats a boolean). Values `self` / `proxy`.
- Config validation, mirroring `validate_public_listing`: a `proxy` study refuses `allow_unlisted_participants: true` and `is_listed_publicly: true`.
- Changing the mode is refused once the study has any participant row (the roster is meaningless in the other mode); it is settable at creation and in the config import.
- Runtime-config export/import carries `report_mode` so a backup round-trip is lossless. The export's participant block gains the proxy fields in Phase H.
- Admin study detail shows the mode read-only next to the other study settings.

**Tests:** unit — proxy + open is a `ValueError` with an actionable message; proxy + listed is refused; the three accepted combinations parse. Integration — create a proxy study, export the runtime config, re-import it, assert the mode survived (`test_admin_export_import_roundtrip.py`).

> Done 2026-11-27. `report_mode` is a config-file field, an import-payload field and part of the runtime-config export; `validate_report_mode` refuses an open study and config-file participants, and the mode cannot change once a study has participants (`database.py`). 8 new unit tests; the "no participants in a proxy config" rule also removes the only way to create half-linked participants outside the roster import. The round-trip assertion is in the integration test but was **not executed** here (needs a running backend).

---

### Phase D — Identity resolution and enforcement (the core)

**Files:** `api_deps/participant_context.py`, `api.py` (`study-config`, `activities-config`), `api_deps/participant_session.py`, `api_deps/diary_access.py`, new `proxy_families.py` (pure helpers + queries), `tests/unit/test_proxy_families.py`, `tests/integration/test_proxy_access.py`.

`ParticipantContext` grows without breaking self-report studies:

| Field | Self-report | Proxy |
| --- | --- | --- |
| `credential_participant_id` | = `participant_id` | the parent's id (from the URL) |
| `participant_id` | = credential | the **active child's** id |
| `study_participant` | the participant's row | the **child's** row |
| `family_participant` | = `study_participant` | the **parent's** row |
| `family` | `None` | `ProxyFamily(children, active, finished)` |

New helper `resolve_family(session, study, credential_id)` → `ProxyFamily` implementing §5 exactly, used by the context dependency **and** by the two bootstrap endpoints that authorize inline (`GET .../study-config`, `GET .../activities-config`) — those are the only participant endpoints that bypass the dependency.

Refusals: a participant id that is a *subject* of any family → 403 for every participant-facing endpoint, including study-config (it returns `participant_display_name`). The session (`participant_sessions`) is keyed by `credential_participant_id`, so advancing the sequence does not invalidate the cookie.

**Tests:** the acceptance criterion directly — a child pid gets 403 on the diary read, the diary write, study-config and activities-config; the parent pid gets 200 and the child's name; a self-report study is byte-for-byte unchanged (existing suite green).

> Done 2026-11-27. `proxy_families.py` (resolution + one definition of "finished"), `ParticipantContext` split into credential/subject/family, refusals on all three resolution points, sessions keyed by the credential, and `participant_display_name()` as the single name resolver. 12 new unit tests.
>
> Two deliberate additions to the plan's scope, both to avoid a split identity:
> * `study-config` already reads consent/instructions from the **parent** row and `submitted` from `family.finished`; leaving that to Phase E would have made the same request resolve to two different identities.
> * `apply_participant_assignment` refuses proxy studies outright until Phase G — otherwise the paste box and the old upload path create participants that are neither parent nor child.
>
> **The HTTP-level acceptance test is not written yet**: it needs a proxy study *with a roster*, which only Phase G can create through the API. It lands there, together with the sequence scenarios in §7.

---

### Phase E — Sequence and stage

> Done 2026-11-27. `stages.stage_for_family` (reads the children's rows, not the cached answer), the `proxy` block in `StudyConfigResponse` (`active` with id/name/index/total, `finished_count`, `total`), and `deadline_passed` as the availability reason that wins over `ended`.

**Files:** `stages.py`, `api.py` (`StudyConfigResponse`, the study-config handler), `api_deps/diary_access.py` (`study_availability_for`).

- The parent's stage is `resolve_placement(available, consent=family, instructions=family, submitted=family_finished, skipped=family_skipped)` — **no new stage value** and no new client route. (Phase D already feeds the family values into `study-config`; what remains here is the response block and the done-reason refinement.)
- `done_reason`: `completed` if at least one child was submitted, `skipped` only if every child was skipped. Both render the same proxy end text (decision 23).
- `StudyConfigResponse` gains an optional `proxy` block: `{"active": {"participant_id", "display_name", "index", "total"}, "finished", "total"}`. `participant_display_name` is filled from the resolver, so "For: Tim" and the tab title keep working without client changes.
- `study_availability_for(study, family)` = the existing window check **and** the family deadline, with `deadline_passed` as a new `unavailable_reason` that wins over `ended` for the message.

**Tests:** unit — `resolve_placement` fed by a proxy family (fresh, one-of-two finished, all finished, all skipped). Integration — study-config returns child 1, then child 2 after a submit, then `done`.

---

### Phase F — Submit, skip, deadline

> Done 2026-11-27. Submit accepts the child (deadline-guarded) and returns the family's stage; skip fans out to every unfinished child with the same reason; consent, instructions and client-info write the parent row. `deadline_passed` blocks saves, submits and skips.

**Files:** `api_diary.py`, `api.py` (consent, instructions, client-info), `api_deps/diary_access.py`.

- **Submit** stays one endpoint; the context already targets the child, so it writes the child's `study_submitted_at` and the response's `stage` is recomputed for the family (next child or `done`).
- **Skip** in a proxy study fans out to **every unfinished child** in one transaction with the same reason/note (decision 17); children already submitted are untouched.
- **Consent, instructions, client-info** write the **parent** row (family state; the browser belongs to the parent). They remain available while a child is unfinished and stop at the deadline.
- **Deadline**: one more check in `get_writable_diary_context` next to `ensure_study_is_currently_available`, and the same check on submit and skip (decision 16). Rejection is a 403 with `{"code": "deadline_passed"}`.

**Tests:** submit child 1 → stage `diary` + child 2's name; submit child 2 → `done`; fill child 1 then skip → child 1 `submitted`, child 2 `skipped`, `done`; after the deadline every write, submit and skip is refused while existing rows are intact; self-report skip unchanged.

---

### Phase G — Roster import (long format)

> Done 2026-11-27. `proxy_roster.py` (parse → validate → decrypt → validate name → re-encrypt → apply), the proxy branch of `import-participants`, `tud roster encrypt`, demo data under `backend/testdata/proxy/` plus `studies_config_proxy_demo.json`, and `tests/integration/test_proxy_studies.py` with the §7 acceptance scenarios - all green against a real backend and database.

**Files:** `api.py` (`import_participants_from_file`, `apply_participant_assignment` or a new `apply_proxy_roster`), `tabular_files.py` (unchanged), `cli.py` (roster generator), `templates/admin_file_validation.html`.

- A `proxy` study reads `parent_id`, `subject_id`, `subject_name_encrypted`, `latest_possible_submission_at_encrypted`; a `self` study keeps today's `pid` / `display_name` contract. Two shapes, one endpoint, chosen by `report_mode`.
- Import: group by `parent_id` → create/reuse the parent row → create child rows with the link → decrypt, validate with `validate_display_name`, re-encrypt → store the deadline once on the parent row.
- All errors are whole-file (existing pattern): duplicate child id, an id that is both parent and child, self-parent, differing deadlines inside one family, unparseable deadline, undecryptable token (`line N, column X: could not be decrypted`), deadline outside the study window. Nothing is written on error; `dry_run` returns the same counts without writes.
- Re-upload is idempotent and never deletes research data: a child absent from the new file is **unlinked** (link cleared, row and activities kept) and the response reports it; deleting data stays an explicit admin action.
- `cli.py` gains `roster-encrypt` (plaintext CSV → encrypted CSV) so demos, tests and the KI handoff do not need a Python one-off.

**Tests:** one integration test per invalid case asserting `400` + *nothing written*; a valid file writing 2 families / 5 children; `dry_run`; re-upload changing a name and the deadline; re-upload dropping a child → unlinked, activities still exported; the audit line and every error string contain no name.

---

### Phase H — Exports, role column, admin diagnostics

> Done 2026-11-27. `participant_role` on both participant endpoints, the parent's `submitted` derived from its children, invitation links for parents only, the `proxy_roster` block in the runtime-config export (ciphertext names, and `study_participant_ids` empty for a proxy study so a restore is lossless), the import side of that block, and `GET /api/admin/diagnostics/encryption` with a section on the admin tools page.

**Files:** `api.py` (participant export, extraction endpoints, invitation links, runtime config), `templates/admin_participant_management.html`, `templates/admin_tools.html`.

- `participant_role` (`parent` / `child` / `self`, the KI's wording) on `/api/admin/participants` and `/api/admin/export/{study}/participants`. A parent's `submitted` is **derived** from its children (decision 15) so the filter and `submitted_after` polling stay usable.
- Activity export and science CSV: unchanged, and now guarded — a test asserts no name and no `*_encrypted` column reaches any export.
- `export-invitation-links` emits **parent rows only** (decision §8.3); a child link must not exist.
- Runtime config: families, links, ciphertext names and the deadline, so a restore is lossless with the same key.
  **Known gap until this phase lands:** the export already lists a proxy study's parents and children in `study_participant_ids`, while `validate_report_mode` refuses config-file participants for a proxy study. A backup of a proxy study that has a roster therefore fails to re-import *loudly* ("roster upload") instead of losing the links. Adding the roster block is what closes it — do not "fix" it by emitting an empty id list, which would be silent data loss.
- Admin participant page hides the name column for proxy studies and searches on ids (decision 22).
- New `GET /api/admin/diagnostics/encryption`: configured key count, sampled rows, ok/failed counts, failing participant ids — never a name, never a token, never raises. Surfaced as a section on `admin_tools.html`.

**Tests:** role column present and correct; parent `submitted` derived; invitation links contain parents only; no `*_encrypted` in any export header or body; the diagnostics endpoint with a wrong key reports failures and leaks nothing.

---

### Phase I — Template copy

> Done 2026-11-27. `POST .../template-copy` copies every day of the most recently finished sibling into an empty target, one `group_id`, refused otherwise.

**Files:** `api_diary.py` (new endpoint), `api.py` (route registration if needed).

`POST /api/studies/{s}/participants/{parent}/template-copy` (name to settle): resolves the active child, refuses when it already has rows, copies every day of the most recently submitted sibling within the same family, in one transaction under one `group_id` (so the existing undo works). No provenance column (decision 18).

**Tests:** copies 7 days; refuses on a non-empty target; refuses a sibling from another family; refuses outside proxy studies; `DELETE .../activity-groups/{group_id}` removes the whole copy.

---

### Phase J — Frontend

> Done 2026-11-27. The subject-change reset in `stageMachine` (`diaryMounted` was never reset, so the next child's screen kept the previous child's entries), `load({ resetDay })`, and the copy offer in the diary's notice area (`ui/templateCopy.js` + `domain/templateCopy.js`, offered once per child). Verified with the frontend suite (383 tests, architecture and typecheck green); the offer itself was not exercised in a browser.

**Files:** `frontend/src/js/ui/stageMachine.js`, `domain/displayName.js` (unchanged), `ui/shellChrome.js` (unchanged), `ui/copyDayDialog.js` / new `ui/templateCopy.js`, `locales/en.json`, `locales/de.json`, `locales/sv.json`, `frontend/tests/unit/`.

Good news first: `refresh()` already refetches study-config and `onSession` already feeds `chrome.apply`, so **"For: Tim" and the tab title switch to the next child with no new view, route or stage code**.

The one real bug to fix: `diaryMounted` is never reset, so after child 1 is submitted the stage is `diary` again and the screen keeps child 1's entries. Fix: remember the active subject id from the `proxy` block; when it changes, reset the store's diary and `currentDay` and reload.

Remaining work: the template-copy offer (a dialog on first load of an empty child questionnaire, calling the Phase I endpoint) and two localized strings. Optionally "child 1 of 2" from the `proxy` block.

**Tests:** unit test for the subject-change reset (pure function, no DOM); a unit test for the copy-offer decision. Manual: the full two-child walk.

---

### Phase K — Docs

> Partially done 2026-11-27: `README_CREATE_STUDY.md` (proxy section), `docs/agents/backend.md`, `.env.example`, `CHANGES`. Outstanding: `docs/agents/database.md` (migration 0025) and closing sub-issues #163–#166.

`README_CREATE_STUDY.md` (proxy study section), `docs/agents/backend.md` (identity resolution, the three enforcement points), `docs/agents/database.md` (0025), `.env.example` (the key), `CHANGES`.

---

## 3. Schema detail — migration `0025_add_proxy_studies`

### 3.1 `studies.report_mode`

```
report_mode  String(16)  NOT NULL  server_default 'self'
CHECK (report_mode IN ('self', 'proxy'))          -- ck_studies_report_mode
```

**Why a mode and not `allows_proxy BOOLEAN`.** Decision 10 says a study is *either* self-report or proxy-report, never mixed — that is a mode, not a switch, and the repo already stores modes as `String(n)` + `CHECK` (`timelines.mode`, `audience`, `skip_reason_code`). A boolean would have to be replaced by a mode the moment a third report type appears (teacher report is the obvious candidate), which is a post-1.0 column rename. The decision record's `allows_proxy` becomes this column; nothing else about decision 10 changes.

### 3.2 `study_participants`

```
proxy_participant_id     String(255)  NULL                       -- the parent's participant_id
subject_name_encrypted   String(512)  NULL                       -- child's first name, ciphertext
proxy_deadline_at        DateTime(tz) NULL                       -- on the parent row, once per family
CHECK (proxy_participant_id IS NULL OR proxy_participant_id <> participant_id)
FK (study_id, proxy_participant_id) REFERENCES study_participants (study_id, participant_id)
INDEX ix_study_participants_proxy (study_id, proxy_participant_id)
```

The composite FK reuses the existing `uq_study_participant` and keeps links inside one study; referencing the row id would need an extra `UNIQUE (study_id, id)`. All three columns are nullable, so existing rows and self-report studies need no backfill.

The FK is self-referential, so the migration adds the column first and `create_foreign_key` afterwards. `session.delete()` on a parent with children must therefore be explicit — see the removal endpoint in Phase H (refuse or unlink first), otherwise the constraint raises.

### 3.3 No new order column

"First unfinished child" orders by `study_participants.id`, which is file order on a fresh import and stable afterwards.

---

## 4. API surface

| Endpoint | Change |
| --- | --- |
| `GET /api/studies/{s}/study-config` | subject refused; name via resolver; new `proxy` block; new `unavailable_reason` value |
| `GET /api/studies/{s}/activities-config` | subject refused (inline check) |
| `.../participants/{pid}` diary router | context resolves credential → active child; deadline check on writes |
| `POST .../consent`, `.../instructions/complete`, `.../client-info` | write the **parent** row |
| `POST .../submit`, `POST .../skip` | submit → child row + family stage; skip → all unfinished children |
| `POST .../template-copy` | new (Phase I) |
| `POST /api/admin/studies/{s}/import-participants` | proxy branch, long format |
| `GET /api/admin/participants` | `participant_role`; derived `submitted` for parents |
| `GET /api/admin/export/{s}/participants` | `participant_role` |
| `GET /api/admin/export/{s}/activities` | unchanged; guarded by test |
| `GET /api/admin/studies/{s}/export-invitation-links` | parents only |
| `GET /api/admin/export/studies-runtime-config` | `report_mode` + families (ciphertext) |
| `GET /api/admin/diagnostics/encryption` | new (Phase H) |

Adding columns to exports is additive, so `EXPORT_SCHEMA_VERSION` stays `1` ([formats.py](../../backend/src/o_timeusediary_backend/formats.py): a format that only gains optional fields does not need a bump).

---

## 5. Derivation rules (the single source of truth)

Implemented once in `proxy_families.py`, used by the context dependency, the bootstrap endpoints, the stage machine and the exports:

```
children(parent)      := rows in the same study with proxy_participant_id == parent, ordered by id
active_child(parent)  := first child with study_submitted_at IS NULL        (may be None)
family_finished(f)    := active_child is None                               # submitted or skipped
family_skipped(f)     := every child has skipped_at                         # only for done_reason
effective_end(f)      := min(study.data_collection_end, parent.proxy_deadline_at)
role(p)               := 'self'   if report_mode == 'self'
                         'child'  if p.proxy_participant_id is set
                         'parent' if p has children
                         <import error> otherwise (never a runtime null)
```

`active_child is None` is the *only* definition the client renders, and it is unreachable for a self-report study.

---

## 6. Test data

### 6.1 Keys

- `.env.example`: `TUD_FIELD_ENCRYPTION_KEYS=` with a generation hint
  `python -c "import os,base64;print(base64.urlsafe_b64encode(os.urandom(32)).decode())"`.
- Unit tests set a fixed key via monkeypatch; integration and e2e suites need it in `backend/.env` (documented in `README_DEVELOPMENT.md`, Phase K).

### 6.2 Fixtures

Two families, five children — enough to prove N > 2 and that families do not leak into each other:

| parent | children | deadline |
| --- | --- | --- |
| `p_twins_a` | `c_twins_a1`, `c_twins_a2` | end of the study window |
| `p_twins_b` | `c_twins_b1`, `c_twins_b2`, `c_twins_b3` | 14 days out |

Names are realistic first names (a 3-character and a 50-character one, to exercise the column length).

- `backend/testdata/proxy/roster_valid.csv` — the file above, encrypted.
- `backend/testdata/proxy/roster_*.csv` — one file per invalid case: bad id, duplicate child, id both parent and child, self-parent, differing deadlines in a family, deadline after `data_collection_end`, deadline in the past, undecryptable token.
- `backend/studies_config_proxy_demo.json` — a `report_mode: proxy` study for manual QA. **Not** added to `STUDIES_CONFIGS` in `tests/support/database_tools.py`, so the fixture studies the whole suite relies on stay unchanged; it is seeded explicitly with `tud studies import`.

### 6.3 How tests get their data

Follow the existing pattern ([test_admin_participant_import.py](../../backend/tests/integration/test_admin_participant_import.py), [test_admin_create_from_files_paths.py](../../backend/tests/integration/test_admin_create_from_files_paths.py)): unique `it_proxy_<hex>` study short names, a study created through the admin API, the roster uploaded through the real endpoint. No direct SQL inserts, so the import path is covered by every scenario that needs data.

---

## 7. Acceptance scenarios (integration)

1. Child pid → 403 on diary read, diary write, study-config, activities-config. Parent pid → 200.
2. Parent's study-config names child 1; a diary write lands under child 1's `participant_id`.
3. Submit child 1 → stage `diary`, name child 2, child 2's diary empty (this is the frontend-reset scenario too).
4. Submit child 2 → stage `done`, end text once; family has no row in the parent.
5. Fill child 1, skip on child 2 → child 1 `submitted`, child 2 `skipped`, stage `done`.
6. After the deadline: save, submit and skip all 403 `deadline_passed`; existing activities unchanged; export shows `submitted = false`.
7. Template copy: 7 days copied, one `group_id`, undo removes all; refused when the target has rows; refused across families.
8. Roster import: every invalid file writes nothing; a valid one writes 2 families / 5 children; `dry_run` writes nothing; re-upload is idempotent; removing a child unlinks it without deleting activities.
9. Exports: `participant_role` correct; parent `submitted` derived; invitation links only for parents; no name and no ciphertext in any export.
10. Health check with a wrong key: failures counted, no name, no token, no exception.
11. Self-report regression: the existing suite stays green, including the SQL-portability guards (`== true()` / `== false()`, no `.is_(True)`).

---

## 8. Validation commands

```
./test_backend_unit.sh            # after A, C, D, E
./test_backend_migrations.sh      # after B
./test_backend_integration.sh     # after D–I
./test_frontend.sh                # after J
```

---

## 9. Risks

- **Crypto format** (decision record §9.13): `decode_incoming` is the only blocked code; A–C do not touch it.
- **Identity split** (Phase D) touches every participant endpoint. It is the highest-risk phase; land it with the acceptance tests in §7.1–2 before anything else builds on it.
- **Self-referential FK** makes participant deletion stricter than today (`DELETE .../participants/{pid}` and `delete-participants`). Decide refuse-vs-unlink in Phase H, not later.
- **`derive_only`** means a parent row can never satisfy `submitted = true` in SQL; every consumer of that field must go through the derivation (§5), or it will silently disagree.

## 10. Explicitly deferred

Per the decision record §10: generic custom fields, per-day descriptions, per-study export opt-in for personal fields, and n:m respondents. Also deferred: key rotation tooling (the envelope's version prefix keeps it cheap later).
