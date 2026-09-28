// @ts-check
/**
 * Maintenance notice banner.
 *
 * Shows a small, non-blocking notice at the top of every page while
 * `TUD_SETTINGS.IS_MAINTENANCE_MODE` is enabled. It asks participants to save
 * their current work before a short maintenance window, and it gives them a
 * harmless explanation for the brief hiccups caused by a backend restart.
 *
 * The notice never blocks the app: the diary keeps working (and saving keeps
 * working) while it is displayed, which is the whole point of the message.
 */

import i18n from './i18n.js';

const BANNER_ID = 'maintenanceBanner';
const STYLE_ID = 'maintenanceBannerStyles';
const BODY_CLASS = 'tud-maintenance-active';
const HEIGHT_VAR = '--tud-maintenance-banner-height';
const I18N_KEY = 'maintenance.banner';

/**
 * English default. Used when no MAINTENANCE_MESSAGE override is configured and
 * as the fallback on pages that never load the locale files (e.g.
 * pages/timeout.html), where it is replaced by the translation as soon as i18n
 * becomes available.
 */
const FALLBACK_MESSAGE =
  'Heads-up: we will run brief maintenance soon. Please save your current work.';

/**
 * @typedef {Object} MaintenanceSettings
 * @property {boolean} [IS_MAINTENANCE_MODE]
 * @property {string|null} [MAINTENANCE_MESSAGE]
 */

// Styles are injected instead of being added to styles/styles.css because the
// standalone pages (src/pages/*.html) do not load that stylesheet.
//
// The height variable keeps the fixed banner from covering content: body
// padding pushes the page down, and elements that stick to the top of the
// viewport are docked below the banner instead of underneath it. That covers
// the diary header, the controls row (sticky below 1440px viewports) and the
// idle timeout indicator in the top-right corner.
const BANNER_STYLES = `
.maintenance-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10000;
  box-sizing: border-box;
  padding: 10px 16px;
  background-color: #c62828;
  color: #ffffff;
  font-size: 15px;
  font-weight: 500;
  line-height: 1.35;
  text-align: center;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
}

body.${BODY_CLASS} {
  padding-top: var(${HEIGHT_VAR}, 0px);
}

body.${BODY_CLASS} .header-section,
body.${BODY_CLASS} .controls,
body.${BODY_CLASS} #idleTimeoutIndicator {
  top: var(${HEIGHT_VAR}, 0px);
}
`;

/**
 * Is the maintenance notice turned on?
 * @param {MaintenanceSettings | null | undefined} settings
 * @returns {boolean}
 */
export function isMaintenanceModeEnabled(settings) {
  return Boolean(settings && settings.IS_MAINTENANCE_MODE);
}

/**
 * Configured message override, or null to use the localised default.
 * @param {MaintenanceSettings | null | undefined} settings
 * @returns {string | null}
 */
export function getMessageOverride(settings) {
  const message = settings && settings.MAINTENANCE_MESSAGE;
  if (typeof message !== 'string') return null;
  const trimmed = message.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Build the banner element. Split out of render() so message resolution can be
 * unit tested without a full DOM.
 * @param {Document} doc
 * @param {MaintenanceSettings | null | undefined} settings
 * @returns {HTMLElement}
 */
export function createBannerElement(doc, settings) {
  const banner = doc.createElement('div');
  banner.id = BANNER_ID;
  banner.className = 'maintenance-banner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');

  const override = getMessageOverride(settings);
  if (override) {
    banner.textContent = override;
  } else {
    // data-i18n lets the regular i18n flow (and language switches) translate it.
    banner.textContent = FALLBACK_MESSAGE;
    banner.setAttribute('data-i18n', I18N_KEY);
  }

  return banner;
}

/**
 * Add the banner stylesheet once.
 * @param {Document} doc
 */
function injectStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = BANNER_STYLES;
  (doc.head || doc.documentElement).appendChild(style);
}

/**
 * Keep the CSS height variable in sync with the rendered banner, so content and
 * sticky elements always make room for it (the text wraps to more lines on
 * narrow screens).
 * @param {Window & typeof globalThis} win
 * @param {Document} doc
 * @param {HTMLElement} banner
 */
function trackBannerHeight(win, doc, banner) {
  const applyHeight = () => {
    // Ceil the exact height: the banner's fractional height (device pixel
    // ratio, line wrapping) must never clip the first line of page content.
    const height = Math.ceil(banner.getBoundingClientRect().height) || 0;
    doc.documentElement.style.setProperty(HEIGHT_VAR, `${height}px`);
  };

  applyHeight();

  if (typeof win.ResizeObserver === 'function') {
    new win.ResizeObserver(applyHeight).observe(banner);
  } else {
    win.addEventListener('resize', applyHeight);
  }
}

/**
 * Inject the styles and the banner when the notice is enabled. Idempotent.
 * @param {Document} doc
 * @param {Window & typeof globalThis} win
 * @param {MaintenanceSettings | null | undefined} settings
 * @returns {HTMLElement | null} the banner, or null when nothing is shown
 */
export function renderMaintenanceBanner(doc, win, settings) {
  if (!isMaintenanceModeEnabled(settings)) return null;
  if (!doc || !doc.body || doc.getElementById(BANNER_ID)) return null;

  injectStyles(doc);

  const banner = createBannerElement(doc, settings);
  doc.body.appendChild(banner);
  doc.body.classList.add(BODY_CLASS);

  trackBannerHeight(win, doc, banner);

  return banner;
}

/**
 * Read the deployment settings and show the notice when enabled.
 *
 * Safe to call on every page: it does nothing at all unless
 * IS_MAINTENANCE_MODE is true.
 * @param {Document} [doc]
 * @param {Window & typeof globalThis} [win]
 * @returns {HTMLElement | null}
 */
export function initMaintenanceBanner(doc = document, win = window) {
  const banner = renderMaintenanceBanner(doc, win, win.TUD_SETTINGS);
  if (!banner) return null;

  // Pages that load i18n translate the banner through their own
  // applyTranslations() call; this covers pages where that ran before the
  // banner was injected. Pages without i18n keep FALLBACK_MESSAGE.
  if (i18n.isReady()) {
    i18n.applyTranslations();
  } else {
    i18n
      .waitForReady()
      .then(() => {
        if (i18n.isReady()) i18n.applyTranslations();
      })
      .catch(() => {});
  }

  return banner;
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  initMaintenanceBanner();
}
