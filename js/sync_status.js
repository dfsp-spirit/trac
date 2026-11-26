// What the toolbar says about the day's storage state.
//
// Autosave is silent: nobody presses Save, and the day is stored ~2 s after the
// last edit. Announcing each of those writes turned that silence into noise - the
// chip appeared within a second of every edit, said "Saving...", said "Saved" and
// disappeared again. Participants read that as the app being slow, not as
// reassurance ("people complain about 'lag' which is due to the save delay").
//
// So the chip has exactly one job now: to say that the day is NOT stored, and to
// offer the retry. A successful save needs no ceremony, a pending one even less.
//
// This module is only the state -> presentation mapping; the chip itself is built
// by ui.js, and the engine (autosave.js) reports its state through
// onStateChange().

/**
 * @typedef {object} SyncStatusView
 * @property {'error'} kind Drives the chip's colour.
 * @property {string} textKey i18n key for the chip text.
 * @property {string} icon Font Awesome class (without the `fas` base).
 * @property {boolean} canRetry Whether the chip offers a retry action.
 */

/**
 * @type {Record<string, SyncStatusView>}
 * `error` is the only state with something to say. `idle`, `pending`, `saving`
 * and `saved` all mean "the app is doing its job, there is nothing here for the
 * participant to do", so they map to no chip at all.
 */
const VIEWS = {
  error: {
    kind: 'error',
    textKey: 'messages.syncNotSaved',
    icon: 'fa-exclamation-circle',
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
