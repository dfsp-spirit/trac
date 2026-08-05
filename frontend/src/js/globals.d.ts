/**
 * Ambient declarations for globals the vanilla-JS frontend defines outside of
 * ES modules: classic scripts (e.g. settings/tud_settings.js) and assignments
 * onto `window`. Picked up by the TS language server and `tsc --noEmit` for
 * files marked with `// @ts-check`.
 */

declare var TUD_SETTINGS: {
  API_BASE_URL: string;
  DEFAULT_STUDY_NAME?: string;
  DEFAULT_STUDIES_FILE?: string;
  [key: string]: unknown;
};

declare var interact: any;

interface Window {
  i18n: any;
  timelineManager: any;
  studyConfigManager: any;
  TUD_STUDY_CONFIG?: any;
  addCopyDayLink?: (...args: any[]) => any;
  getIsMobile?: () => boolean;
  availableOpenStudies?: any[];
}

// The frontend attaches custom fields to Error instances for control flow.
interface Error {
  code?: string;
  status?: number;
}
