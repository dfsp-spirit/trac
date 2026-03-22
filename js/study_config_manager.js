
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

function normalizeLanguageCode(language) {
    if (typeof language !== 'string') {
        return null;
    }
    const normalized = language.trim().toLowerCase();
    if (!normalized) {
        return null;
    }
    const primarySubtag = normalized.split('-')[0];
    return primarySubtag || null;
}

function getPreferredLanguage(supportedLanguages = [], fallbackLanguage = 'en') {
    const normalizedSupported = (Array.isArray(supportedLanguages) ? supportedLanguages : [])
        .map((language) => normalizeLanguageCode(language))
        .filter(Boolean);

    const uniqueSupported = [...new Set(normalizedSupported)];
    const normalizedFallback = normalizeLanguageCode(fallbackLanguage) || 'en';

    const pickIfSupported = (candidate) => {
        const normalizedCandidate = normalizeLanguageCode(candidate);
        if (!normalizedCandidate) {
            return null;
        }
        if (uniqueSupported.length === 0 || uniqueSupported.includes(normalizedCandidate)) {
            return normalizedCandidate;
        }
        return null;
    };

    // Always trust explicit URL language, even if local fallback config is stale.
    // Backend remains authoritative and can validate/fallback if unsupported.
    const fromUrl = normalizeLanguageCode(getLangFromUrl());
    if (fromUrl) {
        return fromUrl;
    }

    const browserLanguages = Array.isArray(navigator.languages) && navigator.languages.length > 0
        ? navigator.languages
        : [navigator.language];

    for (const browserLanguage of browserLanguages) {
        const picked = normalizeLanguageCode(browserLanguage) || pickIfSupported(browserLanguage);
        if (picked) {
            return picked;
        }
    }

    return pickIfSupported(normalizedFallback) || normalizedFallback;
}

function normalizeDayLabels(study, language = null) {
    const targetLanguage = normalizeLanguageCode(language) || normalizeLanguageCode(study?.default_language) || 'en';
    const defaultLanguage = normalizeLanguageCode(study?.default_language) || 'en';
    const dayLabels = Array.isArray(study?.day_labels) ? study.day_labels : [];

    return dayLabels.map((label) => {
        if (!label || typeof label !== 'object') {
            return label;
        }

        let displayName = label.display_name;
        if (!displayName && label.display_names && typeof label.display_names === 'object') {
            displayName = label.display_names;
        }

        if (displayName && typeof displayName === 'object') {
            displayName = displayName[targetLanguage]
                || displayName[defaultLanguage]
                || displayName.en
                || Object.values(displayName).find((value) => typeof value === 'string')
                || label.name;
        }

        return {
            ...label,
            display_name: displayName || label.name
        };
    });
}

function resolveLocalizedStudyText(textValue, selectedLanguage, defaultLanguage = 'en') {
    if (typeof textValue === 'string') {
        return textValue;
    }

    if (!textValue || typeof textValue !== 'object') {
        return null;
    }

    return textValue[selectedLanguage]
        || textValue[defaultLanguage]
        || textValue.en
        || Object.values(textValue).find((value) => typeof value === 'string')
        || null;
}

function getLocalizedDayLabelDisplayName(label, selectedLanguage, defaultLanguage = 'en') {
    if (!label || typeof label !== 'object') {
        return null;
    }

    const displayNames = (label.display_names && typeof label.display_names === 'object')
        ? label.display_names
        : (label.display_name && typeof label.display_name === 'object' ? label.display_name : null);

    if (displayNames) {
        return displayNames[selectedLanguage]
            || displayNames[defaultLanguage]
            || displayNames.en
            || Object.values(displayNames).find((value) => typeof value === 'string')
            || null;
    }

    // Do not override backend-localized labels with plain string fallback labels.
    // A plain string usually means language-specific context is unknown.
    return null;
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

        const supportedLanguages = Object.keys(
            CURRENT_STUDY_CACHE.activities_json_files || CURRENT_STUDY_CACHE.activities_json_file || { en: 'activities_default.json' }
        );
        const selectedLanguage = getPreferredLanguage(supportedLanguages, CURRENT_STUDY_CACHE.default_language || 'en');
        CURRENT_STUDY_CACHE.supported_languages = supportedLanguages;
        CURRENT_STUDY_CACHE.selected_language = selectedLanguage;
        CURRENT_STUDY_CACHE.day_labels = normalizeDayLabels(CURRENT_STUDY_CACHE, selectedLanguage);

        CURRENT_STUDY_CACHE.study_text_intro = resolveLocalizedStudyText(
            CURRENT_STUDY_CACHE.study_text_intro,
            selectedLanguage,
            CURRENT_STUDY_CACHE.default_language || 'en'
        );
        CURRENT_STUDY_CACHE.study_text_end_completed = resolveLocalizedStudyText(
            CURRENT_STUDY_CACHE.study_text_end_completed,
            selectedLanguage,
            CURRENT_STUDY_CACHE.default_language || 'en'
        );
        CURRENT_STUDY_CACHE.study_text_end_skipped = resolveLocalizedStudyText(
            CURRENT_STUDY_CACHE.study_text_end_skipped,
            selectedLanguage,
            CURRENT_STUDY_CACHE.default_language || 'en'
        );

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
        const selectedLanguage = getPreferredLanguage(
            CURRENT_STUDY_CACHE?.supported_languages || [],
            CURRENT_STUDY_CACHE?.default_language || 'en'
        );
        if (selectedLanguage) {
            apiUrl.searchParams.set('lang', selectedLanguage);
        }

        console.log(`Attempting to sync study config from backend: ${apiUrl.toString()}`);
        const response = await fetch(apiUrl.toString());

        if (response.ok) {
            const backendConfig = await response.json();
            console.log('Backend study config received');

            // Update current study cache with backend data
            const selectedLanguageFromConfig = normalizeLanguageCode(backendConfig.selected_language)
                || selectedLanguage
                || CURRENT_STUDY_CACHE.selected_language
                || CURRENT_STUDY_CACHE.default_language
                || 'en';
            const defaultLanguageFromConfig = normalizeLanguageCode(backendConfig.default_language)
                || normalizeLanguageCode(CURRENT_STUDY_CACHE.default_language)
                || 'en';

            if (backendConfig.day_labels && backendConfig.day_labels.length > 0) {
                const fallbackDayLabels = Array.isArray(CURRENT_STUDY_CACHE.day_labels)
                    ? CURRENT_STUDY_CACHE.day_labels
                    : [];

                const normalizedBackendDayLabels = normalizeDayLabels(
                    {
                        day_labels: backendConfig.day_labels,
                        default_language: defaultLanguageFromConfig
                    },
                    selectedLanguageFromConfig
                );

                CURRENT_STUDY_CACHE.day_labels = normalizedBackendDayLabels.map((backendLabel) => {
                    if (!backendLabel || typeof backendLabel !== 'object') {
                        return backendLabel;
                    }

                    const fallbackLabel = fallbackDayLabels.find((candidateLabel) =>
                        candidateLabel
                        && typeof candidateLabel === 'object'
                        && candidateLabel.name === backendLabel.name
                    );

                    const localizedDisplayName = getLocalizedDayLabelDisplayName(
                        fallbackLabel,
                        selectedLanguageFromConfig,
                        defaultLanguageFromConfig
                    );

                    if (!localizedDisplayName) {
                        return backendLabel;
                    }

                    return {
                        ...backendLabel,
                        display_name: localizedDisplayName
                    };
                });
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

            const selectedLanguage = normalizeLanguageCode(backendConfig.selected_language)
                || getPreferredLanguage(
                    backendConfig.supported_languages || CURRENT_STUDY_CACHE.supported_languages || [],
                    backendConfig.default_language || CURRENT_STUDY_CACHE.default_language || 'en'
                )
                || CURRENT_STUDY_CACHE.selected_language
                || CURRENT_STUDY_CACHE.default_language
                || 'en';
            const defaultLanguage = backendConfig.default_language
                || CURRENT_STUDY_CACHE.default_language
                || 'en';

            const resolvedIntro = resolveLocalizedStudyText(
                backendConfig.study_text_intro,
                selectedLanguage,
                defaultLanguage
            );
            if (resolvedIntro && !CURRENT_STUDY_CACHE.study_text_intro) {
                CURRENT_STUDY_CACHE.study_text_intro = resolvedIntro;
            }

            const resolvedCompleted = resolveLocalizedStudyText(
                backendConfig.study_text_end_completed,
                selectedLanguage,
                defaultLanguage
            );
            if (resolvedCompleted && !CURRENT_STUDY_CACHE.study_text_end_completed) {
                CURRENT_STUDY_CACHE.study_text_end_completed = resolvedCompleted;
            }

            const resolvedSkipped = resolveLocalizedStudyText(
                backendConfig.study_text_end_skipped,
                selectedLanguage,
                defaultLanguage
            );
            if (resolvedSkipped && !CURRENT_STUDY_CACHE.study_text_end_skipped) {
                CURRENT_STUDY_CACHE.study_text_end_skipped = resolvedSkipped;
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

function getDayLabels() {
    if (!CURRENT_STUDY_CACHE || !Array.isArray(CURRENT_STUDY_CACHE.day_labels)) {
        return [];
    }
    return CURRENT_STUDY_CACHE.day_labels;
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

    // Handle object format: {name: "monday", display_name: "Monday", ...}
    // For backend submission endpoints, we must use the stable day label name.
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

// Get display label for a specific day index (UI-facing)
function getDayDisplayLabel(dayIndex) {
    if (!CURRENT_STUDY_CACHE || !CURRENT_STUDY_CACHE.day_labels) {
        return `day_${dayIndex + 1}`;
    }

    const label = CURRENT_STUDY_CACHE.day_labels[dayIndex];

    if (label && typeof label === 'object') {
        if (label.display_names && typeof label.display_names === 'object') {
            const selectedLanguage = getSelectedLanguage();
            const defaultLanguage = CURRENT_STUDY_CACHE.default_language || 'en';
            return label.display_names[selectedLanguage]
                || label.display_names[defaultLanguage]
                || label.display_names.en
                || label.display_name
                || label.name
                || `day_${dayIndex + 1}`;
        }
        return label.display_name || label.name || `day_${dayIndex + 1}`;
    }

    if (typeof label === 'string') {
        return label;
    }

    return `day_${dayIndex + 1}`;
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
    getDayLabels,
    getStudyByShortName,
    initializeStudyConfig,
    syncWithBackendConfig,
    getDayLabel,
    getDayDisplayLabel,
    getStudyDaysCount
};

export {
    getCurrentStudy,
    getSupportedLanguages,
    getSelectedLanguage,
    getDayLabels,
    getStudyByShortName,
    initializeStudyConfig,
    syncWithBackendConfig,
    getDayLabel,
    getDayDisplayLabel,
    getStudyDaysCount
};