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
