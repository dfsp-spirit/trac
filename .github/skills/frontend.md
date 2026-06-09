# Frontend Agent Skills

## Tech Stack & Architecture
- **Pure JavaScript**: No React, Vite, Webpack, or bundling tools are used or allowed for application delivery. Do not add npm dependencies to frontend runtimes.
- **Static Assets**: Standard HTML/CSS/JS served statically.
- **Timelines UI**: Support for one or more timelines (e.g., Primary & Secondary activities) partitioned into 10-minute blocks (1440 minutes/day). Uses interactive click-and-drag mechanics to place, stretch, or move activities.

## Configuration & Integration
- **`tud_settings.js`**: Key settings file (located at `frontend/src/settings/tud_settings.js`). Configures backend API endpoints (usually nested under `/api` or `/tud_backend` in production).
- **Study State**: Participant identifier (`pid` URL parameter) maps to invitation links. No explicit login mechanism is supported.
- **Multilingual Support**: Key localization JSON files at `frontend/src/locales/`. Language detection falls back from URL `lang` -> browser default -> study default.
