function getUrlParams() {
    return new URLSearchParams(window.location.search);
}

export function getCurrentStudyName() {
    return getUrlParams().get('study_name') || window.TUD_SETTINGS?.STUDY_NAME || 'default';
}

export function getCurrentParticipantId() {
    return getUrlParams().get('pid');
}

export function getApiBaseUrl() {
    return window.TUD_SETTINGS?.API_BASE_URL || '/api';
}

export function getCachedActivitiesConfig() {
    return window.activitiesConfigCache || null;
}

async function fetchJson(url, errorMessage, fetchOptions = {}) {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
        throw new Error(`${errorMessage}: ${response.status}`);
    }
    return await response.json();
}

export async function loadStudiesConfig(settingsBasePath = 'settings') {
    return await fetchJson(
        `${settingsBasePath}/studies_config.json`,
        `Failed to load ${settingsBasePath}/studies_config.json`
    );
}

export async function loadLocalActivitiesConfig({
    studyName = getCurrentStudyName(),
    settingsBasePath = 'settings'
} = {}) {
    const studiesConfig = await loadStudiesConfig(settingsBasePath);
    const study = studiesConfig?.studies?.find(s => s.name_short === studyName) || studiesConfig?.studies?.[0];
    const activitiesFile = study?.activities_json_file || study?.activities_json_url || 'activities_default.json';

    return await fetchJson(
        `${settingsBasePath}/${activitiesFile}`,
        `Failed to load activities config file ${settingsBasePath}/${activitiesFile}`
    );
}

export async function loadActivitiesConfig({
    participantId = getCurrentParticipantId(),
    studyName = getCurrentStudyName(),
    apiBaseUrl = getApiBaseUrl(),
    settingsBasePath = 'settings',
    preferBackend = true,
    requireBackend = false,
    useCache = true
} = {}) {
    if (useCache && window.activitiesConfigCache) {
        return window.activitiesConfigCache;
    }

    let lastBackendError = null;

    if (preferBackend && studyName) {
        const backendUrl = new URL(`${apiBaseUrl}/studies/${studyName}/activities-config`, window.location.origin);
        if (participantId) {
            backendUrl.searchParams.set('participant_id', participantId);
        }

        try {
            const backendConfig = await fetchJson(
                backendUrl.toString(),
                'Failed to load activities config from backend',
                {
                    headers: {
                        'Accept': 'application/json',
                    }
                }
            );
            window.activitiesConfigCache = backendConfig;
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
        settingsBasePath,
    });
    window.activitiesConfigCache = localConfig;
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
