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
  // modules that assign themselves onto window
  i18n: any;
  timelineManager: any;
  studyConfigManager: any;
  AttributeTracker: any;
  autoScrollModule: any;
  tudIdleTimeout: any;
  TUDRefreshFooter: any;
  // shared state / caches
  activitiesConfigCache: any;
  activitiesConfigCacheByKey: any;
  selectedActivity: any;
  customInputContext: any;
  availableOpenStudies?: any[];
  TUD_STUDY_CONFIG?: any;
  touchStartY?: number;
  // pending-state draft persistence
  __TRAC_CAPTURE_PENDING_STATE?: (...args: any[]) => any;
  __TRAC_CLEAR_PENDING_STATE?: (...args: any[]) => any;
  __TRAC_PERSIST_DRAFT_TIMER?: any;
  // functions exposed for cross-module use
  addCopyDayLink?: (...args: any[]) => any;
  getIsMobile?: () => boolean;
  getCurrentTimelineData?: (...args: any[]) => any;
  getEmptyTargetDayCount?: (...args: any[]) => any;
  getEmptyTargetDayIndices?: (...args: any[]) => any;
  getTimelineCoverage?: (...args: any[]) => any;
  handleCustomActivityModalClose?: (...args: any[]) => any;
  initModalFocusManagement?: (...args: any[]) => any;
  renderPreviousDaysSwitchRow?: (...args: any[]) => any;
  showCopyTargetPicker?: (...args: any[]) => any;
  showToast?: (...args: any[]) => any;
  toggleDebugOverlay?: (...args: any[]) => any;
  tudClearCustomActivityText?: (...args: any[]) => any;
  updateConfirmationModalContent?: (...args: any[]) => any;
  updateDisabledButtonOverlays?: (...args: any[]) => any;
  deleteActivityBlock?: (...args: any[]) => any;
  // legacy hacky globals
  i?: any;
  TUD_SETTINGS: typeof TUD_SETTINGS;
}

// The frontend attaches custom fields to Error instances for control flow.
interface Error {
  code?: string;
  status?: number;
  nonRetryable?: boolean;
}
