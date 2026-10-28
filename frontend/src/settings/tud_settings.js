// Application settings for Time Used Diary (TUD) frontend.

const TUD_SETTINGS = {
    // Same-origin API base: the page talks to whatever host it was loaded from,
    // and nginx proxies /tud_backend/ to 127.0.0.1:8000. This is what production
    // looks like, and it is what makes the app work from a phone on the same
    // wifi - an absolute 'http://localhost:8000/...' would point the phone at
    // the phone itself. For the same reason the dev nginx listens on all
    // interfaces (port 3000), so http://<your-lan-ip>:3000/report/ works.
    API_BASE_URL: '/tud_backend/api',
    DEFAULT_STUDY_NAME: 'default',
    DEFAULT_STUDIES_FILE: 'settings/studies_config.json',
    // Maintenance notice: set to true before short server maintenance to warn
    // participants on every page and ask them to save their current work.
    // MAINTENANCE_MESSAGE overrides the localised default (locales: maintenance.banner),
    // set it to null to use the translated default.
    IS_MAINTENANCE_MODE: false,
    MAINTENANCE_MESSAGE: null,
    TEMPLATE_ENABLED: false,            // Copy Days: enable/disable template feature
    IMPRINT_URL: "https://www.aesthetics.mpg.de/en/imprint.html", // e.g. 'https://example.org/imprint', set to null to hide
    PRIVACY_URL: "https://www.aesthetics.mpg.de/en/data-protection-information.html", // e.g. 'https://example.org/privacy', set to null to hide
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