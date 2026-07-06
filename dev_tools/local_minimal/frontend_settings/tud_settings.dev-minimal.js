// Application settings for Time Used Diary (TUD) frontend.

const TUD_SETTINGS = {
    API_BASE_URL: 'http://localhost:8000/api',
    DEFAULT_STUDY_NAME: 'default',
    DEFAULT_STUDIES_FILE: 'settings/studies_config.json',
    SHOW_PREVIOUS_DAYS_BUTTONS: true,
    IMPRINT_URL: "https://www.aesthetics.mpg.de/en/imprint.html", // e.g. 'https://example.org/imprint', set to null to hide
    PRIVACY_URL: "https://www.aesthetics.mpg.de/en/data-protection-information.html", // e.g. 'https://example.org/privacy', set to null to hide
    OPEN_LEGAL_LINKS_IN_NEW_TAB: true,
    FOOTER_LINK_LABELS: {
        de: { imprint: 'Impressum', privacy: 'Datenschutz' },
        en: { imprint: 'Imprint', privacy: 'Data Protection Information' },
        es: { imprint: 'Aviso legal', privacy: 'Protección de datos' },
        fi: { imprint: 'Juridinen ilmoitus', privacy: 'Tietosuoja' },
        fr: { imprint: 'Mentions légales', privacy: 'Protection des données' },
        pl: { imprint: 'Impressum', privacy: 'Ochrona danych' },
        sv: { imprint: 'Impressum', privacy: 'Integritet' }
    }
};


window.TUD_SETTINGS = TUD_SETTINGS;

console.log('tud_settings.js loaded, TUD_SETTINGS:', TUD_SETTINGS);