// What the toolbar says about the day's storage state.
//
// Autosave is silent by design - which is exactly why it must not be *invisible*:
// a participant who never presses a button needs another way to know their day is
// stored, and above all to notice when it is not. This module is only the
// state -> presentation mapping; the chip itself is built by ui.js, and the
// engine (autosave.js) reports its state through onStateChange().

/** How long the "Saved" confirmation stays before it fades out. */
export const SYNC_STATUS_SAVED_VISIBLE_MS = 2500;

/**
 * @typedef {object} SyncStatusView
 * @property {'progress' | 'ok' | 'error'} kind Drives the chip's colour.
 * @property {string} textKey i18n key for the chip text.
 * @property {string} icon Font Awesome class (without the `fas` base).
 * @property {boolean} spin Whether the icon animates.
 * @property {boolean} canRetry Whether the chip offers a retry action.
 */

/**
 * @type {Record<string, SyncStatusView>}
 * `idle` is deliberately absent: nothing to say means no chip.
 * `pending` and `saving` share their label - to the participant both mean "your
 * edit is on its way", and the difference (debouncing vs. request in flight) is an
 * implementation detail.
 */
const VIEWS = {
  pending: {
    kind: 'progress',
    textKey: 'messages.syncSaving',
    icon: 'fa-circle-notch',
    spin: true,
    canRetry: false,
  },
  saving: {
    kind: 'progress',
    textKey: 'messages.syncSaving',
    icon: 'fa-circle-notch',
    spin: true,
    canRetry: false,
  },
  saved: {
    kind: 'ok',
    textKey: 'messages.syncSaved',
    icon: 'fa-check',
    spin: false,
    canRetry: false,
  },
  error: {
    kind: 'error',
    textKey: 'messages.syncNotSaved',
    icon: 'fa-exclamation-circle',
    spin: false,
    canRetry: true,
  },
};

/**
 * Presentation for an autosave state, or `null` when the chip should be hidden.
 * @param {string} state
 * @returns {SyncStatusView | null}
 */
export function syncStatusView(state) {
  return VIEWS[state] || null;
}
