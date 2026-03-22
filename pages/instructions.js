import { getIsMobile, updateIsMobile } from '../js/globals.js';
import i18n from '../js/i18n.js';
import { loadActivitiesConfig } from '../js/activities_config.js';

function getUrlParams() {
    return new URLSearchParams(window.location.search);
}

function getCurrentLanguageFromUrl() {
    return getUrlParams().get('lang');
}

function normalizeLanguageCode(language) {
    if (typeof language !== 'string') {
        return null;
    }
    const normalized = language.trim().toLowerCase();
    if (!normalized) {
        return null;
    }
    return normalized.split('-')[0] || null;
}

function getPreferredLanguage(supportedLanguages = [], fallbackLanguage = 'en') {
    const normalizedSupported = (Array.isArray(supportedLanguages) ? supportedLanguages : [])
        .map((language) => normalizeLanguageCode(language))
        .filter(Boolean);
    const supportedSet = new Set(normalizedSupported);

    const pickIfSupported = (candidate) => {
        const normalizedCandidate = normalizeLanguageCode(candidate);
        if (!normalizedCandidate) {
            return null;
        }
        if (supportedSet.size === 0 || supportedSet.has(normalizedCandidate)) {
            return normalizedCandidate;
        }
        return null;
    };

    const fromUrl = pickIfSupported(getCurrentLanguageFromUrl());
    if (fromUrl) {
        return fromUrl;
    }

    const browserLanguages = Array.isArray(navigator.languages) && navigator.languages.length > 0
        ? navigator.languages
        : [navigator.language];

    for (const browserLanguage of browserLanguages) {
        const picked = pickIfSupported(browserLanguage);
        if (picked) {
            return picked;
        }
    }

    return pickIfSupported(fallbackLanguage) || normalizeLanguageCode(fallbackLanguage) || 'en';
}

function setLanguageInUrl(language) {
    const url = new URL(window.location.href);
    url.searchParams.set('lang', language);
    window.history.replaceState({}, '', url.toString());
}

function resolveLocalizedStudyText(textValue, selectedLanguage, defaultLanguage = 'en') {
    if (typeof textValue === 'string') {
        return textValue;
    }

    if (!textValue || typeof textValue !== 'object') {
        return '';
    }

    return textValue[selectedLanguage]
        || textValue[defaultLanguage]
        || textValue.en
        || Object.values(textValue).find((value) => typeof value === 'string')
        || '';
}

async function loadStudyConfigForInstructions(language) {
    const urlParams = getUrlParams();
    const studyName = urlParams.get('study_name') || window.TUD_SETTINGS?.STUDY_NAME || 'default';
    const participantId = urlParams.get('pid');
    const apiBaseUrl = window.TUD_SETTINGS?.API_BASE_URL || '/api';
    const endpointUrl = new URL(`${apiBaseUrl}/studies/${studyName}/study-config`, window.location.origin);

    if (participantId) {
        endpointUrl.searchParams.set('participant_id', participantId);
    }
    if (language) {
        endpointUrl.searchParams.set('lang', language);
    }

    const response = await fetch(endpointUrl.toString(), {
        headers: {
            'Accept': 'application/json',
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to load study-config from backend: ${response.status}`);
    }

    return await response.json();
}

function renderLanguageSelector(studyConfig, selectedLanguage) {
    const supportedLanguages = studyConfig?.supported_languages || [];
    if (!Array.isArray(supportedLanguages) || supportedLanguages.length <= 1) {
        return;
    }

    const existingSelector = document.getElementById('languageSelect');
    if (existingSelector) {
        return;
    }

    const selectorContainer = document.createElement('div');
    selectorContainer.className = 'language-selector-container';
    selectorContainer.style.marginBottom = '1rem';

    const label = document.createElement('label');
    label.setAttribute('for', 'languageSelect');
    label.textContent = 'Language';
    label.setAttribute('data-i18n', 'common.language');
    label.style.marginRight = '0.5rem';

    const select = document.createElement('select');
    select.id = 'languageSelect';
    select.setAttribute('aria-label', 'Choose language');
    select.setAttribute('data-i18n-aria-label', 'common.chooseLanguage');

    supportedLanguages.forEach((language) => {
        const option = document.createElement('option');
        option.value = language;
        option.textContent = language.toUpperCase();
        if (language === selectedLanguage) {
            option.selected = true;
        }
        select.appendChild(option);
    });

    select.addEventListener('change', () => {
        const newLanguage = select.value;
        const url = new URL(window.location.href);
        url.searchParams.set('lang', newLanguage);
        window.location.href = url.toString();
    });

    selectorContainer.appendChild(label);
    selectorContainer.appendChild(select);

    const bodyFirstDiv = document.body.querySelector('div');
    if (bodyFirstDiv) {
        bodyFirstDiv.insertBefore(selectorContainer, bodyFirstDiv.firstChild);
    }
}

function applyStudyIntroText(studyConfig) {
    const selectedLanguage = studyConfig?.selected_language || getCurrentLanguageFromUrl() || 'en';
    const defaultLanguage = studyConfig?.default_language || 'en';
    const introElement = document.getElementById('study-custom-message-intro');
    if (!introElement) {
        return;
    }

    const resolvedText = resolveLocalizedStudyText(
        studyConfig?.study_text_intro,
        selectedLanguage,
        defaultLanguage
    );

    if (typeof resolvedText === 'string' && resolvedText.trim() !== '') {
        introElement.innerHTML = resolvedText;
        introElement.removeAttribute('data-i18n-html');
    }
}

// Add the missing updateLayout function
function updateLayout() {
    const isMobile = getIsMobile();
    document.body.classList.toggle('mobile-layout', isMobile);
    document.body.classList.toggle('desktop-layout', !isMobile);

    // Update orientation classes
    const isHorizontal = window.innerWidth > window.innerHeight;
    document.body.classList.toggle('is-horizontal', isHorizontal);
    document.body.classList.toggle('is-vertical', !isHorizontal);
}

// Initialize i18n when the module loads
(async () => {
    try {
        let studyConfig = null;
        const requestedLanguage = getCurrentLanguageFromUrl() || getPreferredLanguage();

        try {
            studyConfig = await loadStudyConfigForInstructions(requestedLanguage || undefined);
        } catch (studyConfigError) {
            console.warn('Could not load study-config for instructions page:', studyConfigError.message);
        }

        const selectedLanguage = getPreferredLanguage(
            studyConfig?.supported_languages || [],
            requestedLanguage || studyConfig?.selected_language || studyConfig?.default_language || 'en'
        );
        if (!requestedLanguage && selectedLanguage) {
            setLanguageInUrl(selectedLanguage);
        }

        if (studyConfig) {
            renderLanguageSelector(studyConfig, selectedLanguage);
        }

        const activitiesConfig = await loadActivitiesConfig({
            lang: selectedLanguage,
            settingsBasePath: '../settings',
            preferBackend: true,
            requireBackend: false,
            useCache: true,
        });
        const language = selectedLanguage || activitiesConfig?.general?.language || 'en';
        console.log('Loading language:', language);
        await i18n.init(language);
        i18n.applyTranslations();
        if (studyConfig) {
            applyStudyIntroText(studyConfig);
        }
        console.log('i18n initialized successfully');
    } catch (error) {
        console.error('Error initializing i18n:', error);
        // Fallback to English if there's any error
        await i18n.init('en');
        i18n.applyTranslations();
    }
})();

document.addEventListener('DOMContentLoaded', () => {
    const continueBtn = document.getElementById('continueBtn');
    const progressBar = document.getElementById('progressBar');

    // Function to create URL with preserved parameters
    function createUrlWithParams(targetPath) {
        const currentUrl = new URL(window.location.href);
        const redirectUrl = new URL(targetPath, currentUrl.origin + currentUrl.pathname.replace(/[^/]*$/, ''));

        // Preserve all existing URL parameters
        currentUrl.searchParams.forEach((value, key) => {
            // Don't override 'instructions' param if it's the target destination
            if (targetPath === '../index.html' && key === 'instructions') {
                return;
            }
            redirectUrl.searchParams.set(key, value);
        });

        // Add instructions=completed for final redirect
        if (targetPath === '../index.html') {
            redirectUrl.searchParams.set('instructions', 'completed');
        }

        return redirectUrl.toString();
    }

    // Update progress bar
    if (progressBar) {
        progressBar.style.transition = 'width 0.6s ease';
        progressBar.style.width = '100%';
    }

    // Handle orientation changes
    let orientationTimeout;
    function updateLayoutClass() {
        clearTimeout(orientationTimeout);
        orientationTimeout = setTimeout(() => {
            const isHorizontal = window.innerWidth > window.innerHeight;
            document.body.classList.toggle('is-horizontal', isHorizontal);
            document.body.classList.toggle('is-vertical', !isHorizontal);
        }, 100);
    }

    // Update layout class on load and resize with passive event listener
    updateLayoutClass();
    window.addEventListener('resize', updateLayoutClass, { passive: true });

    // Lazy load images with IntersectionObserver
    const lazyImageObservers = new Map();
    const lazyImages = document.querySelectorAll('.gif-container[data-src]');
    lazyImages.forEach(container => {
        const img = container.querySelector('img');
        if (img) {
            const observer = new IntersectionObserver(
                (entries, observer) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            img.src = container.dataset.src;
                            observer.unobserve(entry.target);
                            lazyImageObservers.delete(container);
                        }
                    });
                },
                { rootMargin: '50px', threshold: 0.1 }
            );
            observer.observe(container);
            lazyImageObservers.set(container, observer);
        }
    });

    // Handle start button click
    if (continueBtn) {
        console.log('Continue button found, adding click handler');
        continueBtn.addEventListener('click', (e) => {
            console.log('Continue button clicked');
            const targetUrl = createUrlWithParams('../index.html');
            console.log('Redirecting to:', targetUrl);
            window.location.href = targetUrl;
        });
    } else {
        console.error('Continue button not found!');
    }

    // Cleanup function
    function cleanup() {
        if (orientationTimeout) clearTimeout(orientationTimeout);
        lazyImageObservers.forEach(observer => observer.disconnect());
        lazyImageObservers.clear();
        window.removeEventListener('resize', updateLayoutClass);
    }

    // Clean up when page is unloaded
    window.addEventListener('unload', cleanup);
});

// Initial layout
updateLayout();

// Update on resize with debouncing
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        updateIsMobile();
        updateLayout();
    }, 100);
}, { passive: true });
