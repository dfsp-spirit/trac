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
import { createApi } from './data/api.js';
import { createTranslator, loadLocale } from './data/i18n.js';
import { followStudyLanguage, pickInitialLanguage, studyLanguageOptions } from './domain/language.js';
import { parseIdentity } from './domain/router.js';
import { STEP_MINUTES } from './domain/time.js';
import { createDiaryActions } from './state/diary.js';
import { createInitialState, createStore } from './state/store.js';
import { createDiaryView } from './ui/diaryView.js';
import { createPanelController } from './ui/panelController.js';
import { createPanelHost } from './ui/panelHost.js';
import { createRouter } from './ui/router.js';
import { createStageMachine } from './ui/stageMachine.js';
import { loadFirstStage } from './ui/boot.js';
import { createReviewFlow } from './ui/reviewFlow.js';
import { readShell } from './ui/shell.js';
import { createShortcuts } from './ui/shortcuts.js';
import { applyTranslations, restrictLanguageOptions } from './ui/i18n-dom.js';
import { scrollToDay } from './ui/timeline.js';
import { watchTopbarHeight } from './ui/topbarHeight.js';

/**
 * @param {{ root: HTMLElement, params: URLSearchParams }} inputs
 * @returns {{ destroy: () => void }}
 */
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
  const participantId = identity.participant || config.participantId;

  const store = createStore(createInitialState({ language }));
  let translator = createTranslator({});

  /** @type {(key: string, values?: Record<string, string | number>) => string} */
  const t = (key, values) => translator.t(key, values);

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
    languageSelect,
    menu,
    menuShortcuts,
    nav,
  } = readShell(root);

  const wide = window.matchMedia('(min-width: 1200px)');

  const api =
    studyName && participantId ? createApi(config.apiBaseUrl, studyName, participantId) : null;
  const actions = api
    ? createDiaryActions({ store, api, getLanguage: () => store.get().language })
    : null;

  const { hostPanel } = createPanelHost({
    section: sectionHost,
    dialog: dialogHost,
    template,
    isWide: () => wide.matches,
    translate: (host) => applyTranslations(host, translator),
  });

  /** @returns {boolean} */
  function isLocked() {
    return Boolean(store.get().diary?.study.submitted_at);
  }

  const panels = createPanelController({
    hostPanel,
    sectionHost,
    dialogHost,
    isWide: () => wide.matches,
    isLocked,
    getDiary: () => /** @type {import('./domain/diary.js').ApiDiary} */ (store.get().diary),
    getCatalogue: () => store.get().catalogue,
    getLanguage: () => store.get().language,
    actions: actions ?? undefined,
    toastRegion,
    t,
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
    onSession: (session) =>
      restrictLanguageOptions(
        languageSelect,
        studyLanguageOptions(session.supported_languages, config.supportedLanguages)
      ),
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
    onDayInView: (index) => {
      if (index !== store.get().currentDay) store.set({ currentDay: index });
    },
    onTimelineRendered: () => panels.refresh(),
  });

  /** @param {number} dayIndex */
  function goToDay(dayIndex) {
    const day = store.get().diary?.days[dayIndex];
    store.set({ currentDay: dayIndex });
    if (day) scrollToDay(view.sections(), day.name);
  }

  const review = createReviewFlow({
    root,
    t,
    actions,
    stageMachine,
    getState: () => store.get(),
    isLocked,
    onEdit: goToDay,
  });

  /** @param {import('./state/store.js').DiaryState} state */
  function render(state) {
    if (!state.diary) return;
    const locked = isLocked();
    stageMachine.setLocked(locked);
    view.render({
      diary: state.diary,
      language: state.language,
      revision: state.revision,
      currentDay: state.currentDay,
      locked,
    });
    panels.sync(locked);
  }

  /** @param {string} next */
  async function setLanguage(next) {
    if (!config.supportedLanguages.includes(next)) return;
    const messages = await loadLocale(next);
    translator = createTranslator(messages);
    document.documentElement.lang = next;
    applyTranslations(document, translator);
    store.set({ language: next });
    if (languageSelect) languageSelect.value = next;
    stageMachine.rerender();
  }

  /** @param {any} session Follow the study's language unless the URL named one (D40). */
  async function adoptStudyLanguage(session) {
    const next = followStudyLanguage({
      selected: session.selected_language,
      explicit: identity.language,
      current: store.get().language,
      supported: config.supportedLanguages,
    });
    if (next) await setLanguage(next);
  }

  const onFab = () => {
    if (isLocked()) return;
    const dayIndex = store.get().currentDay;
    const start = view.minutesAtTop(dayIndex);
    panels.openAt(dayIndex, start, Math.min(start + 60, 1440 - STEP_MINUTES));
  };

  const onEscape = () => {
    if (panels.escape()) return;
    if (dialogHost?.open) dialogHost.close();
  };

  /** @param {Event} event */
  const onTimelineClick = (event) => panels.openFromEvent(event);

  const onSubmitClick = () => review.open();

  const onLanguageChange = () => {
    const next = languageSelect?.value;
    if (next) void setLanguage(next);
  };

  const finePointer = window.matchMedia('(pointer: fine)');
  const shortcuts = createShortcuts({
    root,
    menu,
    menuEntry: menuShortcuts,
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
      nextDay: () =>
        goToDay(Math.min(store.get().currentDay + 1, (store.get().diary?.days.length ?? 1) - 1)),
      prevDay: () => goToDay(Math.max(store.get().currentDay - 1, 0)),
      newActivity: onFab,
      search: () => panels.focusSearch(),
      escape: onEscape,
    },
  });

  fab.addEventListener('click', onFab);
  submitBtn.addEventListener('click', onSubmitClick);
  daysHost.addEventListener('click', onTimelineClick);
  languageSelect?.addEventListener('change', onLanguageChange);
  const onBreakpoint = () => panels.create();
  wide.addEventListener('change', onBreakpoint);

  const stopTopbarWatch = watchTopbarHeight(topbar, root);

  const stopHashListener = router.onHashChange(() => void stageMachine.refresh());

  const unsubscribe = store.subscribe(render);
  panels.create();

  void (async () => {
    try {
      await setLanguage(language);
    } catch (error) {
      console.error('[i18n] falling back to the markup text:', error);
    }
    // One question, one answer: the server says which stage this participant is
    // in, and the stage machine routes to it (D37). The same answer says which
    // language the study speaks (D40).
    await loadFirstStage({
      api,
      store,
      stageMachine,
      t,
      onLoaded: adoptStudyLanguage,
    });
  })();

  return {
    destroy() {
      unsubscribe();
      view.destroy();
      stopTopbarWatch();
      stopHashListener();
      wide.removeEventListener('change', onBreakpoint);
      fab.removeEventListener('click', onFab);
      submitBtn.removeEventListener('click', onSubmitClick);
      daysHost.removeEventListener('click', onTimelineClick);
      shortcuts.destroy();
      review.destroy();
      languageSelect?.removeEventListener('change', onLanguageChange);
    },
  };
}

const root = /** @type {HTMLElement | null} */ (document.querySelector('.t-app'));
if (root) {
  mount({ root, params: new URLSearchParams(window.location.search) });
}
