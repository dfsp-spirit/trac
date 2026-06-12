// Application settings for Time Used Diary (TUD) frontend.

const TUD_SETTINGS = {
    API_BASE_URL: 'http://localhost:8000/tud_backend/api',
    DEFAULT_STUDY_NAME: 'default',
    DEFAULT_STUDIES_FILE: 'settings/studies_config.json',
    SHOW_PREVIOUS_DAYS_BUTTONS: true
};


// Legal / footer link settings
// If `IMPRINT_URL` or `PRIVACY_URL` are null, no link will be shown.
TUD_SETTINGS.IMPRINT_URL = "https://www.aesthetics.mpg.de/en/imprint.html"; // e.g. 'https://example.org/imprint', set to null to hide
TUD_SETTINGS.PRIVACY_URL = "https://www.aesthetics.mpg.de/en/data-protection-information.html"; // e.g. 'https://example.org/privacy', set to null to hide
TUD_SETTINGS.OPEN_LEGAL_LINKS_IN_NEW_TAB = true;
TUD_SETTINGS.FOOTER_LINK_LABELS = {
    en: { imprint: 'Imprint', privacy: 'Data Protection Information' },
    sv: { imprint: 'Impressum', privacy: 'Integritet' },
    de: { imprint: 'Impressum', privacy: 'Datenschutz' }
};

window.TUD_SETTINGS = TUD_SETTINGS;

console.log('tud_settings.js loaded, TUD_SETTINGS:', TUD_SETTINGS);