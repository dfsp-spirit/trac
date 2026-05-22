// Application settings for Time Used Diary (TUD) frontend.

const TUD_SETTINGS = {
    API_BASE_URL: 'http://localhost:8000/tud_backend/api',
    DEFAULT_STUDY_NAME: 'default',
    DEFAULT_STUDIES_FILE: 'settings/studies_config.json',
    SHOW_PREVIOUS_DAYS_BUTTONS: true
};

window.TUD_SETTINGS = TUD_SETTINGS;

console.log('tud_settings.js loaded, TUD_SETTINGS:', TUD_SETTINGS);