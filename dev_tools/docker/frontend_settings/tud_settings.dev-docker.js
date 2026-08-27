// Application settings for Time Used Diary (TUD) frontend in Docker-based development.

const TUD_SETTINGS = {
    API_BASE_URL: 'http://localhost:3000/tud_backend/api',
    ALLOW_NO_UID: true,
    DEFAULT_STUDY_NAME: 'default',
    DEFAULT_STUDIES_FILE: 'settings/studies_config.json',
    TEMPLATE_ENABLED: true,             // Copy Days: enable/disable template feature
    SHOW_COPY_FROM_BUTTON: false,        // Copy Days: show "Copy from..." button (default off)
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
    },
    TEMPLATE_ENABLED: false
};

window.TUD_SETTINGS = TUD_SETTINGS;

console.log('tud_settings.dev-docker.js loaded, TUD_SETTINGS:', TUD_SETTINGS);
