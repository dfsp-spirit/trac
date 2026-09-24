# Frontend Agent Documentation

## Tech Stack & Architecture
- Pure JavaScript frontend. No React, Vite, Webpack, or runtime bundling toolchain in delivery.
- Static HTML/CSS/JS served by the deployment stack.
- Timeline UI supports one or more timelines with 10-minute blocks over 24h.

## Configuration & Integration
- Primary frontend settings file: `frontend/src/settings/tud_settings.js`.
- Backend API is typically mounted under `/api` (or deployment-specific prefixes).
- Participant context is URL-driven (`pid`, optional `lang`), not login-driven.

## Localization
- Locale resources are in `frontend/src/locales/`.
- Language fallback order: URL `lang` -> browser language -> study default.
- Every i18n key must exist in all locale files (identical key sets, plus no untranslated English values in non-en files); `frontend/tests/unit/locales_consistency.test.js` enforces this.

## Page Texts (per-study overrides)
- Pages show built-in text that a study can override from `studies_config.json`: `study_text_intro` -> `#study-custom-message-intro` and `study_text_instructions` -> `#study-custom-message-instructions` (`pages/instructions.html`), `study_text_consent` (`pages/consent.html`), `study_text_end_{completed,skipped,noconsent}` (`pages/thank-you.html`).
- The backend resolves each text's language before sending it in the participant `study-config` response (`_get_localized_study_text`: selected language -> study `default_language` -> `en`).
- `pages/instructions.js` and `pages/consent.html` render these texts through `js/markdown.js`, which escapes HTML first (so `<br>` in study text shows up literally). The built-in intro default (`instructions.studyIntroDefault`) is injected as raw HTML via `data-i18n-html`; the override removes that attribute so i18n cannot overwrite it.
- `pages/thank-you.html` assigns the end text straight to `innerHTML` (raw HTML, no Markdown rendering, no escaping).
- Built-in fallbacks when a study sets nothing live in the locale files (all 7 locales): `instructions.studyIntroDefault` for the intro and `instructions.instructionsDefault` for the second block (`pages/instructions.js` looks the latter up via `i18n.t()`).
- The illustrated steps of `pages/instructions.html` follow the diary layout (`.horizontal-layout` / `.vertical-layout`, one image per layout, lazily loaded via `data-src`). `applyCopyDayStepVisibility()` in `pages/instructions.js` hides the "Copy a Day" step for studies with a single day (`study_days_count` of the participant `study-config` response, fallback `day_labels.length`; no config at all keeps the step visible, like the diary page, which only shows the copy button when there is another day). Hidden steps are skipped when numbering, so a single-day study numbers its steps 1-3 instead of 1-4.
