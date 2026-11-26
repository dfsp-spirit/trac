// @ts-check
/**
 * Composition root. The only file that knows about every layer: it reads the
 * deployment config, loads the locale, creates the API client and the store,
 * mounts the components and connects them.
 *
 * It owns no application state: the store does. Everything here is wiring, and it
 * stays under the same size cap so "wiring" cannot become the next god module.
 */
import { config } from './config.js';
import { createApi, listListedStudies } from './data/api.js';
import { loadMessages } from './data/messages.js';
import { createSignalSender, createSignals } from './data/signals.js';
import { reportClientInfo } from './data/clientInfo.js';
import { createTranslator, loadLocaleWithFallback } from './data/i18n.js';
import { pickInitialLanguage } from './domain/language.js';
import { parseIdentity } from './domain/router.js';
import { createDiaryActions } from './state/diary.js';
import { createInitialState, createStore } from './state/store.js';
import { createCopyDay } from './ui/copyDay.js';
import { createDiaryScreen } from './ui/diaryScreen.js';
import { createDiaryView } from './ui/diaryView.js';
import { adoptParticipantId } from './ui/identity.js';
import { createPanelController } from './ui/panelController.js';
import { createPanelHost } from './ui/panelHost.js';
import { createRouter } from './ui/router.js';
import { createStageMachine } from './ui/stageMachine.js';
import { createLanguageSwitch } from './ui/languageSwitch.js';
import { createMessageBanners } from './ui/messageBanner.js';
import { startSession } from './ui/startup.js';
import { createReviewFlow } from './ui/reviewFlow.js';
import { readShell } from './ui/shell.js';
import { createShortcuts } from './ui/shortcuts.js';
import { createShellChrome } from './ui/shellChrome.js';
import { applyTranslations } from './ui/i18n-dom.js';
import { watchTopbarHeight } from './ui/topbarHeight.js';

/** @param {{ root: HTMLElement, params: URLSearchParams }} inputs */
export function mount({ root, params }) {
  // Identity only - never progress (D37).
  const identity = parseIdentity(params.toString());
  const language = pickInitialLanguage({
    requested: identity.language,
    browserLanguages: navigator.languages || [navigator.language],
    supported: config.supportedLanguages,
    fallback: config.defaultLanguage,
  });
  const studyName = identity.study || config.studyName;
  const participantId = adoptParticipantId({ studyName, participantId: identity.participant || config.participantId });

  const store = createStore(createInitialState({ language }));
  // Opt-in usability signals, unlinked and silent until the study asks (domain/uxEvents.js).
  const signals = createSignals({
    send: studyName ? createSignalSender(config.apiBaseUrl, studyName) : null,
    getLanguage: () => store.get().language,
  });
  let translator = createTranslator({});

  /** @type {(key: string, values?: Record<string, string | number>) => string} */
  const t = (key, values) => translator.t(key, values);
  const tCount = /** @type {(k: string, n: number) => string} */ ((k, n) => translator.tCount(k, n));
  // Banners belong to every page (entry included); a language change re-fetches.
  const messageBanners = createMessageBanners({
    host: root,
    t,
    load: (language) => loadMessages(config.apiBaseUrl, { studyName, language }),
  });

  const handles = readShell(root);
  const {
    topbar,
    daysHost,
    stageHost,
    shell,
    dayNav,
    noticesHost,
    railList,
    progressNote,
    fab,
    submitBtn,
    toastRegion,
    sectionHost,
    dialogHost,
    template,
    menuShortcuts,
    nav,
  } = handles;

  const wide = window.matchMedia('(min-width: 1200px)');

  let copy = /** @type {ReturnType<typeof createCopyDay> | null} */ (null); // wired below

  const api = studyName && participantId
    ? createApi(config.apiBaseUrl, studyName, participantId, {
        onError: (info) => signals.track('api.error', info),
        onSessionExpired: () => chrome.expireSession(),
      })
    : null;

  // Shell parts that depend on the study config (shellChrome.js); callbacks are deferred.
  const chrome = createShellChrome({
    shell: handles,
    t,
    tCount,
    api,
    getLanguage: () => store.get().language,
    onLanguageChange: (next) => void languageSwitch.setLanguage(next),
    onSkip: (body) => actions?.skip(body).then(() => stageMachine.refresh()),
    onCopy: () => copy?.open(),
    onReview: () => review.open(),
  });

  const actions = api
    ? createDiaryActions({
        store,
        getLanguage: () => store.get().language,
        api,
        multiTimelinePolicy: config.multiTimelinePolicy,
        onRefused: (refusal) => signals.track('diary.blocked', refusal),
      })
    : null;

  copy = createCopyDay({ root, store, actions, t, tCount, toastRegion, signals });

  const { hostPanel } = createPanelHost({
    section: sectionHost,
    dialog: dialogHost,
    template,
    isWide: () => wide.matches,
    translate: (host) => applyTranslations(host, translator),
  });

  const isLocked = () => Boolean(store.get().diary?.study.submitted_at);

  /** @type {ReturnType<typeof createDiaryView> | null} The view the panel reads from. */
  let viewRef = null;

  const panels = createPanelController({
    hostPanel,
    sectionHost,
    dialogHost,
    isWide: () => wide.matches,
    isLocked,
    getDiary: () => /** @type {import('./domain/diary.js').ApiDiary} */ (store.get().diary),
    getCatalogue: () => store.get().catalogue,
    multiTimelinePolicy: config.multiTimelinePolicy,
    getLanguage: () => store.get().language,
    // "Where the participant is looking" - the day in view and the minute under
    // the top bar - is what the form's defaults are derived from. Both are only
    // known once the view exists, hence the holder.
    getCurrentDay: () => store.get().currentDay,
    getAnchorMinutes: (dayIndex) => viewRef?.minutesAtTop(dayIndex) ?? 0,
    actions: actions ?? undefined,
    toastRegion,
    t,
    signals,
  });

  const router = createRouter({ onChange: () => {} });

  const stageMachine = createStageMachine({
    router,
    host: stageHost,
    // Everything that only makes sense inside the diary.
    diaryChrome: [dayNav, progressNote, submitBtn, fab, shell],
    t,
    api,
    getLanguage: () => store.get().language,
    onEnterDiary: () => void actions?.load(),
    onSession: (session) => (chrome.apply(session), signals.onSession(session)),
  });

  const languageSwitch = createLanguageSwitch({
    config,
    store,
    chrome,
    stageMachine,
    loadMessages: (language) => loadLocaleWithFallback(language, config.defaultLanguage),
    createTranslator,
    setTranslator: (next) => {
      translator = next;
    },
    setDocumentLanguage: (language) => {
      document.documentElement.lang = language;
    },
    onLanguageChanged: (language) => void messageBanners.refresh(language),
    loadDiary: async () => {
      await actions?.load();
    },
  });

  const view = createDiaryView({
    root,
    timelineHost: daysHost,
    railList,
    nav,
    noticesHost,
    progressNote,
    topbar,
    t,
    review: { button: submitBtn, open: () => review.open() },
    onDayInView: (index) => {
      if (index !== store.get().currentDay) store.set({ currentDay: index });
    },
    onTimelineRendered: () => panels.refresh(),
  });
  viewRef = view;

  const review = createReviewFlow({
    root,
    t,
    actions,
    stageMachine,
    getState: () => store.get(),
    isLocked,
    onEdit: (dayIndex) => screen.goToDay(dayIndex),
  });

  const screen = createDiaryScreen({
    store,
    view,
    panels,
    stageMachine,
    review: { entries: [submitBtn, progressNote], open: () => review.open() },
    daysHost,
    fab,
    dialogHost,
    isLocked,
    copy,
    copyDays: { button: handles.copyDays, hint: handles.copyDaysHint },
  });

  const finePointer = window.matchMedia('(pointer: fine)');
  const shortcuts = createShortcuts({
    root,
    menuEntry: menuShortcuts,
    closeMenu: chrome.closeMenu,
    // Single-key shortcuts only trust focus that is already in the diary (D31).
    regions: [daysHost, sectionHost, dialogHost, railList],
    t,
    isEnabled: () => store.get().shortcuts && !isLocked(),
    isFinePointer: () => finePointer.matches,
    // Any open dialog owns the keyboard: Esc, Enter and Tab mean what the dialog
    // says they mean, not what the diary behind it says (which is also why the
    // review and shortcut lists can close on Esc at all).
    isBlocked: () =>
      store.get().status !== 'ready' || root.querySelector('dialog[open]') !== null,
    onToggle: (enabled) => store.set({ shortcuts: enabled }),
    actions: {
      nextDay: () => screen.stepDay(1),
      prevDay: () => screen.stepDay(-1),
      newActivity: screen.addActivity,
      search: () => panels.focusSearch(),
      escape: screen.onEscape,
      nudge: (mode, delta) => panels.nudge(mode, delta),
    },
  });

  const onBreakpoint = () => panels.create();
  wide.addEventListener('change', onBreakpoint);

  const stopTopbarWatch = watchTopbarHeight(topbar, root);

  const stopHashListener = router.onHashChange(() => void stageMachine.refresh());

  const unsubscribe = store.subscribe(screen.render);
  panels.create();

  void startSession({
    language,
    languageSwitch,
    api,
    store,
    stageMachine,
    t,
    identity,
    reportClientInfo,
    listStudies: (language) => listListedStudies(config.apiBaseUrl, language),
  });

  return {
    destroy() {
      unsubscribe();
      view.destroy();
      stopTopbarWatch();
      stopHashListener();
      stageMachine.destroy();
      wide.removeEventListener('change', onBreakpoint);
      screen.destroy();
      shortcuts.destroy();
      review.destroy();
      copy?.destroy();
      chrome.destroy();
      signals.destroy();
    },
  };
}
const root = /** @type {HTMLElement | null} */ (document.querySelector('.t-app'));
if (root) mount({ root, params: new URLSearchParams(window.location.search) });
