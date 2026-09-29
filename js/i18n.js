// @ts-check
/**
 * Internationalization (i18n) utility module
 * Handles loading and applying translations based on language settings
 */

class I18n {
  constructor() {
    this.currentLanguage = 'en';
    /** @type {Record<string, any>} */
    this.translations = {};
    this.isLoaded = false;
    /** @type {Promise<Record<string, any>> | null} */
    this.loadPromise = null; // Track ongoing load operations
    /**
     * Keys that were requested through t() but are missing from the loaded
     * locale. Used to detect a stale/incomplete locale file and repair it.
     * @type {Set<string>}
     */
    this.missingKeys = new Set();
    this.isRepairing = false;
  }

  /**
   * Initialize the i18n system
   * @param {string} language - Language code (e.g., 'es', 'en', 'fr')
   * @returns {Promise<void>}
   */
  async init(language = 'en') {
    return this.setLanguage(language);
  }

  /**
   * Change the current language
   * @param {string} language - Language code (e.g., 'es', 'en', 'fr')
   * @returns {Promise<void>}
   */
  async setLanguage(language) {
    // Don't reload if it's the same language and already loaded
    if (language === this.currentLanguage && this.isLoaded) {
      console.log(`Language ${language} is already loaded`);
      return;
    }

    // Cancel any ongoing load operation
    if (this.loadPromise) {
      // We can't actually cancel a fetch, but we can track the latest request
      console.log('New language request, overriding previous load');
    }

    this.currentLanguage = language;
    this.missingKeys.clear();

    try {
      // Store the promise to track completion
      this.loadPromise = this.loadTranslations(language);
      this.translations = await this.loadPromise;

      this.updateHtmlLang(language);
      this.isLoaded = true;
      this.applyTranslations(); // Automatically update UI when language changes

      console.log(`i18n language changed to: ${language}`);

      // Dispatch a custom event for components that need to react to language changes
      window.dispatchEvent(
        new CustomEvent('i18n:languageChanged', {
          detail: { language, translations: this.translations },
        })
      );

      // A stale (browser-cached) locale file renders a half-translated page:
      // missing keys silently keep the built-in English markup. Detect that and
      // re-fetch the locale file once with a cache-buster.
      await this.repairMissingTranslations();
    } catch (error) {
      console.error(`Failed to set language to ${language}:`, error);

      // Fallback to English if the requested language fails and it's not already English
      if (language !== 'en') {
        console.log('Falling back to English...');
        return this.setLanguage('en');
      }

      // If even English fails, throw the error
      throw error;
    } finally {
      this.loadPromise = null;
    }
  }

  /**
   * Load translation file for the specified language
   * @param {string} language - Language code, like 'en', 'sv', 'fr'
   * @param {{ bustCache?: boolean }} [options] - bustCache appends a query
   *   parameter so a stale copy cannot be served from the browser or a proxy
   *   cache (used by repairMissingTranslations()).
   * @returns {Promise<Record<string, any>>}
   */
  async loadTranslations(language, options = {}) {
    const { bustCache = false } = options;
    try {
      // Determine the correct path based on current location
      const isInSubfolder = window.location.pathname.includes('/pages/');
      const localesPath = isInSubfolder ? '../locales' : './locales';

      // Locale files change with every release, but they are requested from a
      // stable URL. Revalidate instead of trusting a cached copy: a stale file
      // renders a page that mixes the requested language with the built-in
      // English fallback markup (missing keys keep their markup text).
      const url = `${localesPath}/${language}.json${
        bustCache ? `?v=${Date.now()}` : ''
      }`;
      const response = await fetch(url, { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error(
          `Failed to load ${language} translations: ${response.status}`
        );
      }
      return await response.json();
    } catch (error) {
      console.error(`Error loading translations for ${language}:`, error);
      throw error;
    }
  }

  /**
   * Re-fetch the current locale when the loaded file was missing keys that the
   * page asked for, and report keys that are still missing afterwards (those
   * are a real translation gap, not a stale cache).
   * @returns {Promise<boolean>} true when a fresher locale file was applied
   */
  async repairMissingTranslations() {
    if (!this.isLoaded || this.isRepairing || this.missingKeys.size === 0) {
      return false;
    }

    const language = this.currentLanguage;
    const requested = [...this.missingKeys];
    // Clear before re-applying so the second pass reports what is really gone.
    this.missingKeys.clear();
    this.isRepairing = true;

    try {
      const fresh = await this.loadTranslations(language, { bustCache: true });
      const changed =
        JSON.stringify(fresh) !== JSON.stringify(this.translations);
      // Keys that are still absent in the freshly fetched file are a real
      // translation gap (not a stale cache), so check them explicitly instead
      // of relying on the DOM re-application below.
      const stillMissing = requested.filter(
        (key) => this._resolve(key, fresh) === undefined
      );

      this.translations = fresh;
      this.applyTranslations();

      if (changed) {
        console.info(
          `i18n: reloaded locale '${language}' because ${requested.length} key(s) were missing ` +
            `(stale cached copy): ${requested.join(', ')}`
        );
        window.dispatchEvent(
          new CustomEvent('i18n:languageChanged', {
            detail: { language, translations: this.translations },
          })
        );
      }

      if (stillMissing.length > 0) {
        console.error(
          `i18n: locale '${language}' (${language}.json) is missing ${stillMissing.length} key(s) ` +
            `used by this page: ${stillMissing.join(', ')}. ` +
            'The affected text stays in its built-in English wording.'
        );
        return false;
      }

      return changed;
    } catch (error) {
      console.warn(
        `i18n: could not reload locale '${language}' after missing keys ${requested.join(
          ', '
        )}:`,
        error
      );
      return false;
    } finally {
      this.isRepairing = false;
    }
  }

  /**
   * Update the HTML lang attribute
   * @param {string} language - Language code
   */
  updateHtmlLang(language) {
    document.documentElement.lang = language;
  }

  /**
   * Get a translated string by key path
   * @param {string} keyPath - Dot-separated path to translation key (e.g., 'buttons.saveDay')
   * @param {Object} params - Optional parameters for string interpolation
   * @returns {string} - Translated string or key if not found
   */
  t(keyPath, params = {}) {
    if (!this.isLoaded) {
      console.warn('i18n not loaded yet, returning key:', keyPath);
      return keyPath;
    }

    const translation = this._resolve(keyPath);
    if (translation === undefined) {
      // Remember the miss: a stale cached locale file silently leaves the
      // markup's built-in English text in place, so the miss is also the
      // signal that repairMissingTranslations() should re-fetch the file.
      this.missingKeys.add(keyPath);
      console.warn(`Translation not found for key: ${keyPath}`);
      return keyPath;
    }

    // Handle string interpolation if parameters are provided
    if (typeof translation === 'string' && Object.keys(params).length > 0) {
      return this.interpolate(translation, params);
    }

    return translation;
  }

  /**
   * Look up a translation without logging and without reporting a miss.
   * Use this for optional keys whose absence is expected (e.g. labels that may
   * be overridden by deployment settings).
   * @param {string} keyPath - Dot-separated path to translation key
   * @param {Object} [params] - Optional parameters for string interpolation
   * @returns {string | null} the translation, or null when it does not exist
   */
  tOptional(keyPath, params = {}) {
    const translation = this._resolve(keyPath);
    if (typeof translation !== 'string') {
      return null;
    }
    if (Object.keys(params).length > 0) {
      return this.interpolate(translation, params);
    }
    return translation;
  }

  /**
   * Is a translation key available in the loaded locale?
   * @param {string} keyPath - Dot-separated path to translation key
   * @returns {boolean}
   */
  has(keyPath) {
    return this._resolve(keyPath) !== undefined;
  }

  /**
   * Navigate the translation object without side effects.
   * @param {string} keyPath - Dot-separated path to translation key
   * @param {Record<string, any>} [source] - Translation tree to look in,
   *   defaults to the currently loaded translations
   * @returns {any} the value, or undefined when the key does not exist
   */
  _resolve(keyPath, source = this.translations) {
    const keys = String(keyPath).split('.');
    /** @type {any} */
    let translation = source;

    for (const key of keys) {
      if (
        translation &&
        typeof translation === 'object' &&
        key in translation
      ) {
        translation = translation[key];
      } else {
        return undefined;
      }
    }

    return translation;
  }

  /**
   * Simple string interpolation
   * @param {string} template - String template with {{key}} placeholders
   * @param {Object} params - Parameters to substitute
   * @returns {string} - Interpolated string
   */
  interpolate(template, params) {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return params[key] !== undefined ? params[key] : match;
    });
  }

  /**
   * Apply translations to elements with data-i18n attributes
   * @param {HTMLElement | Document} [container] - Optional container to scope the translation application
   */
  applyTranslations(container = document) {
    if (!this.isLoaded) {
      console.warn('i18n not loaded, cannot apply translations');
      return;
    }

    // Handle elements with data-i18n attribute for text content
    const textElements = container.querySelectorAll('[data-i18n]');
    textElements.forEach((element) => {
      const key = element.getAttribute('data-i18n');
      const translation = this.t(key);
      if (translation !== key) {
        element.textContent = translation;
      }
    });

    // Handle elements with data-i18n-html attribute for innerHTML
    const htmlElements = container.querySelectorAll('[data-i18n-html]');
    htmlElements.forEach((element) => {
      const key = element.getAttribute('data-i18n-html');
      const translation = this.t(key);
      if (translation !== key) {
        element.innerHTML = translation;
      }
    });

    // Handle elements with data-i18n-placeholder attribute for placeholders
    const placeholderElements = container.querySelectorAll(
      '[data-i18n-placeholder]'
    );
    placeholderElements.forEach((element) => {
      const key = element.getAttribute('data-i18n-placeholder');
      const translation = this.t(key);
      if (translation !== key) {
        /** @type {HTMLInputElement} */ (element).placeholder = translation;
      }
    });

    // Handle elements with data-i18n-value attribute for input values
    const valueElements = container.querySelectorAll('[data-i18n-value]');
    valueElements.forEach((element) => {
      const key = element.getAttribute('data-i18n-value');
      const translation = this.t(key);
      if (translation !== key) {
        /** @type {HTMLInputElement} */ (element).value = translation;
      }
    });

    // Handle elements with data-i18n-title attribute for title/tooltip
    const titleElements = container.querySelectorAll('[data-i18n-title]');
    titleElements.forEach((element) => {
      const key = element.getAttribute('data-i18n-title');
      const translation = this.t(key);
      if (translation !== key) {
        /** @type {HTMLElement} */ (element).title = translation;
      }
    });

    // Handle elements with data-i18n-aria-label attribute for aria-label
    const ariaLabelElements = container.querySelectorAll(
      '[data-i18n-aria-label]'
    );
    ariaLabelElements.forEach((element) => {
      const key = element.getAttribute('data-i18n-aria-label');
      const translation = this.t(key);
      if (translation !== key) {
        element.setAttribute('aria-label', translation);
      }
    });

    // Handle elements with data-i18n-alt attribute for image alt text
    const altElements = container.querySelectorAll('[data-i18n-alt]');
    altElements.forEach((element) => {
      const key = element.getAttribute('data-i18n-alt');
      const translation = this.t(key);
      if (translation !== key) {
        /** @type {HTMLImageElement} */ (element).alt = translation;
      }
    });
  }

  /**
   * Get current language
   * @returns {string} - Current language code
   */
  getCurrentLanguage() {
    return this.currentLanguage;
  }

  /**
   * Check if i18n is loaded
   * @returns {boolean}
   */
  isReady() {
    return this.isLoaded;
  }

  /**
   * Wait for i18n to be loaded
   * @returns {Promise<void>}
   */
  async waitForReady() {
    if (this.isLoaded) return;
    if (this.loadPromise) {
      await this.loadPromise;
    }
  }
}

// Create global instance
window.i18n = new I18n();

// Export for module usage
export default window.i18n;
