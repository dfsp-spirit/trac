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
import { STEP_MINUTES } from './domain/time.js';
import { createDiaryActions } from './state/diary.js';
import { createStore } from './state/store.js';
import { createActivityPanel } from './ui/activityPanel.js';
import { createDiaryView } from './ui/diaryView.js';
import { createPanelHost } from './ui/panelHost.js';
import { createReviewModal } from './ui/reviewModal.js';
import { readShell } from './ui/shell.js';
import { applyTranslations } from './ui/i18n-dom.js';
import { scrollToDay } from './ui/timeline.js';
import { createToast } from './ui/toast.js';

/**
 * @param {{ root: HTMLElement, params: URLSearchParams }} inputs
 * @returns {{ destroy: () => void }}
 */
export function mount({ root, params }) {
  const paramLanguage = params.get('lang');
  const language =
    paramLanguage && config.supportedLanguages.includes(paramLanguage)
      ? paramLanguage
      : config.defaultLanguage;

  const studyName = params.get('study') || config.studyName;
  const participantId = params.get('pid') || config.participantId;

  /** @type {import('./state/store.js').DiaryState} */
  const initial = {
    status: 'idle',
    error: null,
    diary: null,
    catalogue: null,
    currentDay: 0,
    saveState: 'idle',
    language,
    revision: 0,
  };
  const store = createStore(initial);
  let translator = createTranslator({});

  /** @type {(key: string, values?: Record<string, string | number>) => string} */
  const t = (key, values) => translator.t(key, values);

  const {
    topbar,
    daysHost,
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
    nav,
  } = readShell(root);

  const toast = createToast(toastRegion, {
    undo: t('diary.toast.undo'),
    dismiss: t('diary.toast.dismiss'),
  });

  const wide = window.matchMedia('(min-width: 1200px)');
  /** @type {ReturnType<typeof createActivityPanel> | null} */
  let panel = null;
  let lockedRendered = false;

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

  function createPanel() {
    if (isLocked()) {
      // A submitted diary keeps its timeline, not its editor.
      panel = null;
      if (dialogHost?.open) dialogHost.close();
      if (sectionHost) {
        const note = document.createElement('p');
        note.className = 't-hint';
        note.setAttribute('data-i18n', 'diary.notice.locked');
        note.textContent = t('diary.notice.locked');
        sectionHost.replaceChildren(note);
      }
      return;
    }

    const host = hostPanel();
    if (!host || !actions) {
      panel = null;
      return;
    }
    panel = createActivityPanel({
      host,
      t,
      language: store.get().language,
      getDiary: () => /** @type {import('./domain/diary.js').ApiDiary} */ (store.get().diary),
      getCatalogue: () => store.get().catalogue,
      onCreate: (body) => actions.create(body),
      onUpdate: (uuid, changes) => actions.update(uuid, changes),
      onDelete: async (activity) => {
        const undo = await actions.removeWithUndo(activity);
        toast.show(t('diary.toast.deleted', { name: activity.activity_name }), {
          label: t('diary.toast.undo'),
          run: undo,
        });
      },
      toast,
    });
    panel.showCatalogue();
  }

  /** @param {number} dayIndex @param {number} startRelative @param {number} endRelative */
  function openPanelAt(dayIndex, startRelative, endRelative) {
    if (!panel || isLocked()) return;
    if (!wide.matches && dialogHost && !dialogHost.open) dialogHost.showModal();
    panel.open({ dayIndex, startMinutes: startRelative, endMinutes: endRelative });
  }

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
    onTimelineRendered: () => panel?.refresh(),
  });

  /** @param {number} dayIndex */
  function goToDay(dayIndex) {
    const day = store.get().diary?.days[dayIndex];
    store.set({ currentDay: dayIndex });
    if (day) scrollToDay(view.sections(), day.name);
  }

  const reviewModal = createReviewModal({
    root,
    t,
    onEdit: goToDay,
    onSubmit: () => (actions ? actions.submit() : Promise.reject(new Error('no participant'))),
  });

  /** @param {import('./state/store.js').DiaryState} state */
  function render(state) {
    if (!state.diary) return;
    const locked = isLocked();
    submitBtn.hidden = locked;
    fab.hidden = locked;
    view.render({
      diary: state.diary,
      language: state.language,
      revision: state.revision,
      currentDay: state.currentDay,
      locked,
    });
    if (locked !== lockedRendered) {
      lockedRendered = locked;
      createPanel();
    }
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
  }

  const onFab = () => {
    if (isLocked()) return;
    const dayIndex = store.get().currentDay;
    const start = view.minutesAtTop(dayIndex);
    openPanelAt(dayIndex, start, Math.min(start + 60, 1440 - STEP_MINUTES));
  };

  /** @param {Event} event */
  const onTimelineClick = (event) => {
    if (isLocked()) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const gap = target.closest('.t-gap__btn');
    if (gap instanceof HTMLElement) {
      openPanelAt(Number(gap.dataset.day), Number(gap.dataset.start), Number(gap.dataset.end));
      return;
    }
    const button = target.closest('.t-event__btn');
    const uuid = button instanceof HTMLElement ? button.dataset.uuid : null;
    if (!uuid) return;
    const diary = store.get().diary;
    const activity = diary?.activities.find((item) => item.client_uuid === uuid);
    if (!activity || !panel) return;
    if (!wide.matches && dialogHost && !dialogHost.open) dialogHost.showModal();
    panel.openEdit(activity);
  };

  const onSubmitClick = () => {
    const diary = store.get().diary;
    if (isLocked() || !diary) return;
    reviewModal.open(diary, store.get().language);
  };

  const onLanguageChange = () => {
    const next = languageSelect?.value;
    if (next) void setLanguage(next);
  };
  const onBreakpoint = () => createPanel();

  fab.addEventListener('click', onFab);
  submitBtn.addEventListener('click', onSubmitClick);
  daysHost.addEventListener('click', onTimelineClick);
  languageSelect?.addEventListener('change', onLanguageChange);
  wide.addEventListener('change', onBreakpoint);

  let observer = null;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => {
      root.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`);
    });
    observer.observe(topbar);
  }

  const unsubscribe = store.subscribe(render);
  createPanel();

  void (async () => {
    try {
      await setLanguage(language);
    } catch (error) {
      console.error('[i18n] falling back to the markup text:', error);
    }
    if (!actions) {
      progressNote.hidden = false;
      progressNote.textContent = t('diary.error.noParticipant');
      return;
    }
    await actions.load();
  })();

  return {
    destroy() {
      unsubscribe();
      view.destroy();
      observer?.disconnect();
      fab.removeEventListener('click', onFab);
      submitBtn.removeEventListener('click', onSubmitClick);
      daysHost.removeEventListener('click', onTimelineClick);
      reviewModal.destroy();
      languageSelect?.removeEventListener('change', onLanguageChange);
      wide.removeEventListener('change', onBreakpoint);
    },
  };
}

const root = /** @type {HTMLElement | null} */ (document.querySelector('.t-app'));
if (root) {
  mount({ root, params: new URLSearchParams(window.location.search) });
}
