
// settings/study_config_manager.js - IMPROVED
console.log('=== Study Config Manager Loading ===');

// Get TUD_SETTINGS from global with better fallback
let TUD_SETTINGS = window.TUD_SETTINGS;

if (!TUD_SETTINGS) {
    console.warn('TUD_SETTINGS not found in window! Creating fallback...');
    TUD_SETTINGS = {
        API_BASE_URL: 'http://localhost:8000/api',
        ALLOW_NO_UID: true,
        STUDY_NAME: 'default',
        DEFAULT_STUDIES_FILE: 'settings/studies_config.json'
    };
    // Also set it on window for other scripts
    window.TUD_SETTINGS = TUD_SETTINGS;
}


let STUDIES_CONFIG_CACHE = null;
let CURRENT_STUDY_CACHE = null;

function getLangFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('lang');
}

function normalizeDayLabels(study, language = null) {
    const targetLanguage = language || study?.default_language || 'en';
    const dayLabels = Array.isArray(study?.day_labels) ? study.day_labels : [];

    return dayLabels.map((label) => {
        if (!label || typeof label !== 'object') {
            return label;
        }

        let displayName = label.display_name;
        if (displayName && typeof displayName === 'object') {
            displayName = displayName[targetLanguage] || displayName[study?.default_language] || displayName.en || label.name;
        }

        return {
            ...label,
            display_name: displayName || label.name
        };
    });
}

// Load studies config from JSON file (fallback)
async function loadStudiesConfigFromFile() {
    try {
        const response = await fetch(TUD_SETTINGS.DEFAULT_STUDIES_FILE);
        if (!response.ok) {
            throw new Error(`Failed to load ${TUD_SETTINGS.DEFAULT_STUDIES_FILE}: ${response.status}`);
        }
        STUDIES_CONFIG_CACHE = await response.json();

        // Find current study
        const studyName = TUD_SETTINGS.STUDY_NAME;
        CURRENT_STUDY_CACHE = STUDIES_CONFIG_CACHE.studies.find(s => s.name_short === studyName);

        if (!CURRENT_STUDY_CACHE) {
            throw new Error(`Study "${studyName}" not found in ${TUD_SETTINGS.DEFAULT_STUDIES_FILE}`);
        }

        const selectedLanguage = getLangFromUrl() || CURRENT_STUDY_CACHE.default_language || 'en';
        CURRENT_STUDY_CACHE.supported_languages = Object.keys(
            CURRENT_STUDY_CACHE.activities_json_files || CURRENT_STUDY_CACHE.activities_json_file || { en: 'activities_default.json' }
        );
        CURRENT_STUDY_CACHE.selected_language = selectedLanguage;
        CURRENT_STUDY_CACHE.day_labels = normalizeDayLabels(CURRENT_STUDY_CACHE, selectedLanguage);

        console.log(`Loaded study from file: ${CURRENT_STUDY_CACHE.name} with ${CURRENT_STUDY_CACHE.day_labels.length} days`);
        return CURRENT_STUDY_CACHE;
    } catch (error) {
        console.error(`Error loading ${TUD_SETTINGS.DEFAULT_STUDIES_FILE}:`, error.message);
        // Create a minimal default study as last resort
        CURRENT_STUDY_CACHE = {
            name: 'Default Fallback',
            name_short: TUD_SETTINGS.STUDY_NAME,
            description: 'Fallback study config',
            day_labels: ['default'],
            study_participant_ids: [],
            allow_unlisted_participants: true,
            activities_json_files: { en: 'activities_default.json' },
            supported_languages: ['en'],
            selected_language: 'en',
            data_collection_start: '2024-01-01T00:00:00Z',
            data_collection_end: '2026-12-31T23:59:59Z'
        };
        return CURRENT_STUDY_CACHE;
    }
}

// Sync with backend (preferred source)
async function syncWithBackendConfig() {
    try {
        const studyName = TUD_SETTINGS.STUDY_NAME;
        const apiUrl = new URL(`${TUD_SETTINGS.API_BASE_URL}/studies/${studyName}/study-config`, window.location.origin);
        const selectedLanguage = getLangFromUrl();
        if (selectedLanguage) {
            apiUrl.searchParams.set('lang', selectedLanguage);
        }

        console.log(`Attempting to sync study config from backend: ${apiUrl.toString()}`);
        const response = await fetch(apiUrl.toString());

        if (response.ok) {
            const backendConfig = await response.json();
            console.log('Backend study config received');

            // Update current study cache with backend data
            if (backendConfig.day_labels && backendConfig.day_labels.length > 0) {
                CURRENT_STUDY_CACHE.day_labels = backendConfig.day_labels;
            }

            if (backendConfig.default_language) {
                CURRENT_STUDY_CACHE.default_language = backendConfig.default_language;
            }

            if (Array.isArray(backendConfig.supported_languages) && backendConfig.supported_languages.length > 0) {
                CURRENT_STUDY_CACHE.supported_languages = backendConfig.supported_languages;
            }

            if (backendConfig.selected_language) {
                CURRENT_STUDY_CACHE.selected_language = backendConfig.selected_language;
            }

            if (typeof backendConfig.study_text_intro === 'string') {
                CURRENT_STUDY_CACHE.study_text_intro = backendConfig.study_text_intro;
            }

            if (typeof backendConfig.study_text_end_completed === 'string') {
                CURRENT_STUDY_CACHE.study_text_end_completed = backendConfig.study_text_end_completed;
            }

            if (typeof backendConfig.study_text_end_skipped === 'string') {
                CURRENT_STUDY_CACHE.study_text_end_skipped = backendConfig.study_text_end_skipped;
            }

            if (backendConfig.study_days_count) {
                // Ensure day_labels matches study_days_count
                if (!CURRENT_STUDY_CACHE.day_labels ||
                    CURRENT_STUDY_CACHE.day_labels.length !== backendConfig.study_days_count) {
                    CURRENT_STUDY_CACHE.day_labels =
                        Array.from({length: backendConfig.study_days_count}, (_, i) => `day_${i + 1}`);
                }
            }

            // Store full backend config for reference
            CURRENT_STUDY_CACHE.backend_config = backendConfig;
            CURRENT_STUDY_CACHE.source = 'backend';

            console.log(`Synced with backend: ${CURRENT_STUDY_CACHE.day_labels.length} days`);
            return CURRENT_STUDY_CACHE;
        } else {
            console.log(`Backend returned ${response.status}, using file config`);
            CURRENT_STUDY_CACHE.source = 'file';
            return CURRENT_STUDY_CACHE;
        }
    } catch (error) {
        console.log('Backend unavailable, using file config:', error.message);
        CURRENT_STUDY_CACHE.source = 'file';
        return CURRENT_STUDY_CACHE;
    }
}

// Public API
function getCurrentStudy() {
    return CURRENT_STUDY_CACHE;
}

function getSupportedLanguages() {
    if (!CURRENT_STUDY_CACHE) {
        return [];
    }
    return CURRENT_STUDY_CACHE.supported_languages || [];
}

function getSelectedLanguage() {
    if (!CURRENT_STUDY_CACHE) {
        return 'en';
    }
    return CURRENT_STUDY_CACHE.selected_language || CURRENT_STUDY_CACHE.default_language || 'en';
}

function getStudyByShortName(nameShort) {
    if (STUDIES_CONFIG_CACHE && STUDIES_CONFIG_CACHE.studies) {
        return STUDIES_CONFIG_CACHE.studies.find(s => s.name_short === nameShort);
    }
    return null;
}


// Initialize - load from file first, then sync with backend
async function initializeStudyConfig() {
    // First load from file
    await loadStudiesConfigFromFile();

    // Then sync with backend (wait for it to complete)
    try {
        await syncWithBackendConfig();
        console.log('Backend sync completed in initializeStudyConfig');
    } catch (error) {
        console.log('Background sync failed:', error.message);
    }

    return CURRENT_STUDY_CACHE;
}

// Get day label for a specific index
function getDayLabel(dayIndex) {
    console.log(`getDayLabel called with index: ${dayIndex}`);

    if (!CURRENT_STUDY_CACHE || !CURRENT_STUDY_CACHE.day_labels) {
        console.log('No day_labels cache, returning fallback');
        return `day_${dayIndex + 1}`;
    }

    const label = CURRENT_STUDY_CACHE.day_labels[dayIndex];
    console.log(`Label at index ${dayIndex}:`, label);

    // Handle object format: {name: "default", display_order: 0}
    if (label && typeof label === 'object' && label.name) {
        console.log(`Extracting name from object: ${label.name}`);
        return label.name;
    }

    // Handle string format (for backward compatibility)
    if (typeof label === 'string') {
        console.log(`Using string label: ${label}`);
        return label;
    }

    // Fallback
    const fallback = `day_${dayIndex + 1}`;
    console.log(`Using fallback: ${fallback}`);
    return fallback;
}

// Get number of days in current study
function getStudyDaysCount() {
    if (!CURRENT_STUDY_CACHE || !CURRENT_STUDY_CACHE.day_labels) {
        return 1;
    }
    return CURRENT_STUDY_CACHE.day_labels.length;
}

// Make everything available globally
window.studyConfigManager = {
    getCurrentStudy,
    getSupportedLanguages,
    getSelectedLanguage,
    getStudyByShortName,
    initializeStudyConfig,
    syncWithBackendConfig,
    getDayLabel,
    getStudyDaysCount
};

export {
    getCurrentStudy,
    getSupportedLanguages,
    getSelectedLanguage,
    getStudyByShortName,
    initializeStudyConfig,
    syncWithBackendConfig,
    getDayLabel,
    getStudyDaysCount
};