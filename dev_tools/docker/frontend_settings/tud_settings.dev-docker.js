// Application settings for Time Used Diary (TUD) frontend in Docker-based development.

const TUD_SETTINGS = {
    API_BASE_URL: 'http://localhost:3000/tud_backend/api',
    ALLOW_NO_UID: true,
    DEFAULT_STUDY_NAME: 'default',
    DEFAULT_STUDIES_FILE: 'settings/studies_config.json',
    TEMPLATE_ENABLED: true,             // Copy Days: enable/disable template feature
    SHOW_COPY_FROM_BUTTON: false        // Copy Days: show "Copy from..." button (default off)
};

window.TUD_SETTINGS = TUD_SETTINGS;

console.log('tud_settings.dev-docker.js loaded, TUD_SETTINGS:', TUD_SETTINGS);
