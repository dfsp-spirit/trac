# Frontend Agent Documentation

## Tech Stack & Architecture
- Pure JavaScript frontend. No React, Vite, Webpack, or runtime bundling toolchain in delivery.
- Static HTML/CSS/JS served by the deployment stack.
- Timeline UI supports one or more timelines with 10-minute blocks over 24h.

## Configuration & Integration
- Primary frontend settings file: `frontend/src/settings/tud_settings.js`.
- Backend API is typically mounted under `/api` (or deployment-specific prefixes).
- Participant context is URL-driven (`pid`, optional `lang`), not login-driven.

## Unsaved diary work (draft state)
- `frontend/src/js/draft_storage.js` owns the browser-side copy of the diary that is being edited: `sessionStorage` (`trac.pendingTimelineState.v1`) plus `localStorage` (`trac.timelineDraftState.v1`, survives closing the browser, restored only while younger than 24h). `script.js` captures it on every change (debounced), on `beforeunload` and on `visibilitychange`, and restores it after a reload.
- Nothing in that module may throw: `safeGetItem`/`safeSetItem`/`safeRemoveItem` swallow unavailable/quota-exceeded storage (Safari private mode, blocked cookies). Drafts are validated on read (`normalizeTimelineState`) and unusable payloads are deleted instead of restored.
- A draft is only restored when `matchesTimelineContext()` agrees on `pid`, `study_name` and `day_label_index` - participants share browsers (family tablet, lab PC). Covered by `frontend/tests/unit/draft_storage.test.js` and E2E `draft_restore.spec.js`; the context rule itself is unit-tested because the browser flow for switching participant goes through consent/instructions, which drop the pending state first.

## Localization
- Locale resources are in `frontend/src/locales/`.
- Language fallback order: URL `lang` -> browser language -> study default.
- Every i18n key must exist in all locale files (identical key sets, plus no untranslated English values in non-en files); `frontend/tests/unit/locales_consistency.test.js` enforces this.
- `frontend/tests/unit/page_i18n_keys.test.js` enforces the other direction: every key requested by markup (`data-i18n*`) or by a literal `t('key')`/`tOptional('key')` call must exist in every locale, and no stylesheet may carry hardcoded user-visible `content:` text. A key that is missing at runtime is *not* an error: `applyTranslations()` keeps the built-in English text of the markup, which is how half-translated pages happen - so add keys to all locales in the same change.
- `frontend/tests/unit/locale_values.test.js` checks the values themselves: the `{{placeholders}}` of every key and the HTML tags inside it must match `en.json` (balanced), so a translation cannot silently drop `{{days}}` or break `data-i18n-html` markup.
- `frontend/tests/unit/static_assets.test.js` verifies that every asset referenced by an HTML page or stylesheet exists in the repository (it ignores commented-out markup); E2E `no_broken_static_requests.spec.js` additionally loads every participant page and fails if any static request (js/css/gif/font/locale/settings json) does not succeed.
- Stale cached locale files: `js/i18n.js` fetches locales with `cache: 'no-cache'`, and if the loaded file is missing requested keys it re-fetches it once with a `?v=<timestamp>` cache-buster (passing `cache: 'no-store'`) before logging the remaining keys as a real gap (`i18n: locale 'de' ... is missing N key(s) ...`). That self-heals a page whose browser/proxy cache still holds an old locale file. `frontend/tests/unit/i18n_missing_keys.test.js` covers this.
- `i18n.tOptional(key)` / `i18n.has(key)` are the non-reporting lookups for keys that may legitimately be absent (deployment-overridable labels such as `footer.imprint`): they neither warn nor mark the locale as stale. Use them instead of `t()` when a miss is expected.
- Markup hooks: `data-i18n` (textContent), `data-i18n-html` (innerHTML), `data-i18n-title`, `data-i18n-placeholder`, `data-i18n-value`, `data-i18n-aria-label`, `data-i18n-alt` (image alt text). Prefer a `data-i18n` hook over a CSS `content:` string, which can never be translated.

## Page Texts (per-study overrides)
- Pages show built-in text that a study can override from `studies_config.json`: `study_text_intro` -> `#study-custom-message-intro` and `study_text_instructions` -> `#study-custom-message-instructions` (`pages/instructions.html`), `study_text_consent` (`pages/consent.html`), `study_text_end_{completed,skipped,noconsent}` (`pages/thank-you.html`).
- The backend resolves each text's language before sending it in the participant `study-config` response (`_get_localized_study_text`: selected language -> study `default_language` -> `en`).
- `pages/instructions.js` and `pages/consent.html` render these texts through `js/markdown.js`, which escapes HTML first (so `<br>` in study text shows up literally). The built-in intro default (`instructions.studyIntroDefault`) is injected as raw HTML via `data-i18n-html`; the override removes that attribute so i18n cannot overwrite it.
- `pages/thank-you.html` assigns the end text straight to `innerHTML` (raw HTML, no Markdown rendering, no escaping).
- Built-in fallbacks when a study sets nothing live in the locale files (all 7 locales): `instructions.studyIntroDefault` for the intro and `instructions.instructionsDefault` for the second block (`pages/instructions.js` looks the latter up via `i18n.t()`).
- The illustrated steps of `pages/instructions.html` follow the diary layout (`.horizontal-layout` / `.vertical-layout`, one image per layout, lazily loaded via `data-src`). `applyCopyDayStepVisibility()` in `pages/instructions.js` hides the "Copy a Day" step for studies with a single day (`study_days_count` of the participant `study-config` response, fallback `day_labels.length`; no config at all keeps the step visible, like the diary page, which only shows the copy button when there is another day). Hidden steps are skipped when numbering, so a single-day study numbers its steps 1-3 instead of 1-4.
