// @ts-check
/**
 * Hand-managed version of the participant rewrite, the counterpart of
 * `TUD_FRONTEND_VERSION` in the old frontend.
 *
 * Bumped by hand when the app changes.
 *
 * Lives in `domain/` because that is the one layer every other layer may import,
 * which keeps the option of showing it in the UI open.
 */
export const APP_VERSION = '0.25.0';
