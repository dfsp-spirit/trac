// @ts-check
// Time constants
export const MINUTES_PER_DAY = 24 * 60;
export const INCREMENT_MINUTES = 10;
export const DEFAULT_ACTIVITY_LENGTH = 10;
export const TIMELINE_START_HOUR = 4;
export const TIMELINE_HOURS = 24;

// Debug mode
export const DEBUG_MODE = true;
export const TUD_FRONTEND_VERSION = '0.24.0'; // Update this version number when making changes to the frontend code

/**
 * Does this study get timeline tabs on a phone, or the picker?
 *
 * Exactly two: that is the case the tabs exist for - seeing both tracks at once
 * is what makes the second timeline noticeable without opening anything, and two
 * names fit the strip's own row. A single timeline has nothing to switch to (the
 * control hides, as it always has) and three or more names would run off the row,
 * so those keep the picker (a menu can list any number).
 *
 * Lives here rather than inline because no study we have has anything but two
 * timelines: a stubbed activities config whose timeline set disagrees with the
 * study's does not bring the diary up at all, so the other branches are pinned by
 * unit test instead of E2E.
 */
export function shouldShowTimelineTabs(timelineCount) {
  return timelineCount === 2;
}
