import { fetchWithSmartRetry } from './utils.js';

function getUrlParams() {
    return new URLSearchParams(window.location.search);
}

export function getCurrentStudyName() {
    return getUrlParams().get('study_name') || window.TUD_SETTINGS?.STUDY_NAME || 'default';
}

export function getCurrentParticipantId() {
    return getUrlParams().get('pid');
}

export function getCurrentLanguage() {
    return getUrlParams().get('lang') || null;
}

export function getApiBaseUrl() {
    return window.TUD_SETTINGS?.API_BASE_URL || '/api';
}

export function getCachedActivitiesConfig() {
    return window.activitiesConfigCache || null;
}

function getActivitiesCacheKey(studyName, lang) {
    return `${studyName || 'default'}::${lang || 'default'}`;
}

function getActivitiesConfigFromCache(studyName, lang) {
    const key = getActivitiesCacheKey(studyName, lang);
    if (!window.activitiesConfigCacheByKey) {
        window.activitiesConfigCacheByKey = {};
    }
    return window.activitiesConfigCacheByKey[key] || null;
}

function setActivitiesConfigCache(studyName, lang, configData) {
    const key = getActivitiesCacheKey(studyName, lang);
    if (!window.activitiesConfigCacheByKey) {
        window.activitiesConfigCacheByKey = {};
    }
    window.activitiesConfigCacheByKey[key] = configData;
    window.activitiesConfigCache = configData;
}

/**
 * Fetch JSON with optional smart retry for transient errors
 * @param {string} url - URL to fetch
 * @param {string} errorMessage - Error message prefix
 * @param {object} fetchOptions - fetch options
 * @param {object} retryConfig - retry config { enableRetry: false, maxRetries: 2, delayMs: 1500 }
 */
async function fetchJson(url, errorMessage, fetchOptions = {}, retryConfig = {}) {
    const { enableRetry = false, maxRetries = 2, delayMs = 1500 } = retryConfig;

    if (enableRetry) {
        // Use smart retry for transient errors (5xx retries, 4xx fast-fail)
        const response = await fetchWithSmartRetry(url, fetchOptions, {
            maxRetries,
            delayMs,
            skipRetryStatuses: [404]  // Don't retry 404s
        });
        if (!response.ok) {
            throw new Error(`${errorMessage}: ${response.status}`);
        }
        return await response.json();
    } else {
        // Standard fetch without retry (for local files and config loading)
        const response = await fetch(url, fetchOptions);
        if (!response.ok) {
            throw new Error(`${errorMessage}: ${response.status}`);
        }
        return await response.json();
    }
}

export async function loadStudiesConfig(settingsBasePath = 'settings') {
    return await fetchJson(
        `${settingsBasePath}/studies_config.json`,
        `Failed to load ${settingsBasePath}/studies_config.json`,
        {},
        { enableRetry: false }  // Local file, no retry needed
    );
}

export async function loadLocalActivitiesConfig({
    studyName = getCurrentStudyName(),
    lang = getCurrentLanguage(),
    settingsBasePath = 'settings'
} = {}) {
    const studiesConfig = await loadStudiesConfig(settingsBasePath);
    const study = studiesConfig?.studies?.find(s => s.name_short === studyName) || studiesConfig?.studies?.[0];
    const filesByLang = study?.activities_json_files || study?.activities_json_file || null;

    let activitiesFile = null;
    if (filesByLang && typeof filesByLang === 'object' && !Array.isArray(filesByLang)) {
        const defaultLanguage = study?.default_language || 'en';
        const selectedLang = lang || defaultLanguage;
        activitiesFile = filesByLang[selectedLang] || filesByLang[defaultLanguage] || filesByLang.en;
    } else if (typeof filesByLang === 'string') {
        activitiesFile = filesByLang;
    }

    if (!activitiesFile) {
        activitiesFile = study?.activities_json_url || 'activities_default.json';
    }

    return await fetchJson(
        `${settingsBasePath}/${activitiesFile}`,
        `Failed to load activities config file ${settingsBasePath}/${activitiesFile}`,
        {},
        { enableRetry: false }  // Local files, no retry needed
    );
}

export async function loadActivitiesConfig({
    participantId = getCurrentParticipantId(),
    studyName = getCurrentStudyName(),
    lang = getCurrentLanguage(),
    apiBaseUrl = getApiBaseUrl(),
    settingsBasePath = 'settings',
    preferBackend = true,
    requireBackend = false,
    useCache = true
} = {}) {
    if (useCache) {
        const cached = getActivitiesConfigFromCache(studyName, lang);
        if (cached) {
            return cached;
        }

        if (window.activitiesConfigCache && !lang) {
            return window.activitiesConfigCache;
        }
    }

    let lastBackendError = null;

    if (preferBackend && studyName) {
        const backendUrl = new URL(`${apiBaseUrl}/studies/${studyName}/activities-config`, window.location.origin);
        if (participantId) {
            backendUrl.searchParams.set('participant_id', participantId);
        }
        if (lang) {
            backendUrl.searchParams.set('lang', lang);
        }

        try {
            const backendConfig = await fetchJson(
                backendUrl.toString(),
                'Failed to load activities config from backend',
                {
                    headers: {
                        'Accept': 'application/json',
                    }
                },
                { enableRetry: false }  // Don't retry - fall back to local config quickly
            );
            setActivitiesConfigCache(studyName, lang, backendConfig);
            return backendConfig;
        } catch (error) {
            lastBackendError = error;
            console.warn('Backend activities config fetch failed:', error.message);
        }
    }

    if (requireBackend) {
        throw lastBackendError || new Error('Backend activities config is required but could not be loaded');
    }

    const localConfig = await loadLocalActivitiesConfig({
        studyName,
        lang,
        settingsBasePath,
    });
    setActivitiesConfigCache(studyName, lang, localConfig);
    return localConfig;
}

export function getTimelineConfig(key, configData = getCachedActivitiesConfig()) {
    if (!configData) {
        throw new Error('Activities configuration is not loaded yet');
    }

    if (!configData.timeline || !configData.timeline[key]) {
        throw new Error(`Timeline configuration not found for key: ${key}`);
    }

    return configData.timeline[key];
}

export function getTimelineCategories(key, configData = getCachedActivitiesConfig()) {
    const timeline = getTimelineConfig(key, configData);
    if (!timeline.categories) {
        throw new Error(`No categories found for timeline key: ${key}`);
    }
    return timeline.categories;
}
