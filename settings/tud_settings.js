// Application settings for Time Used Diary (TUD) frontend.

const TUD_SETTINGS = {
    API_BASE_URL: 'http://localhost:8000/tud_backend/api',
    DEFAULT_STUDY_NAME: 'default', // default study name when arriving on page without '&study_name=x' url parameter, can be overridden by URL parameter 'study_name'
    DEFAULT_STUDIES_FILE: 'settings/studies_config.json'
};

window.TUD_SETTINGS = TUD_SETTINGS;

console.log('tud_settings.js loaded, TUD_SETTINGS:', TUD_SETTINGS);