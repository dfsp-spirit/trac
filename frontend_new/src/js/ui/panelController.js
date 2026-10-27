// @ts-check
/**
 * Owns the activity panel's lifetime (D29): which host it lives in, when it is
 * created, and what replaces it once the diary is submitted.
 *
 * The composition root used to hold this, and it grew: half of that file was
 * "build the panel, re-host it on a breakpoint, swap it for a read-only note".
 * That is a component's job, so it lives here and main.js only calls it.
 */
import { createActivityPanel } from './activityPanel.js';

/**
 * @param {{
 *   hostPanel: () => HTMLElement | null,
 *   sectionHost: HTMLElement | null,
 *   dialogHost: HTMLDialogElement | null,
 *   isWide: () => boolean,
 *   isLocked: () => boolean,
 *   getDiary: () => import('../domain/diary.js').ApiDiary,
 *   getCatalogue: () => any,
 *   getLanguage: () => string,
 *   actions: {
 *     create: (body: { items: any[], group_id?: string }) => Promise<any>,
 *     update: (clientUuid: string, changes: Record<string, unknown>) => Promise<any>,
 *     removeWithUndo: (activity: import('../domain/diary.js').ApiActivity) => Promise<() => Promise<void>>,
 *   },
 *   toast: { show: (message: string, action?: { label?: string, run?: () => void | Promise<void> }) => void },
 *   t: (key: string, params?: Record<string, string | number>) => string,
 * }} deps
 */
export function createPanelController({
  hostPanel,
  sectionHost,
  dialogHost,
  isWide,
  isLocked,
  getDiary,
  getCatalogue,
  getLanguage,
  actions,
  toast,
  t,
}) {
  /** @type {ReturnType<typeof createActivityPanel> | null} */
  let panel = null;
  let lockedRendered = false;

  /** @param {import('../domain/diary.js').ApiActivity} activity */
  async function deleteWithUndo(activity) {
    const undo = await actions.removeWithUndo(activity);
    toast.show(t('diary.toast.deleted', { name: activity.activity_name }), {
      label: t('diary.toast.undo'),
      run: undo,
    });
  }

  function create() {
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
    if (!host) {
      panel = null;
      return;
    }

    panel = createActivityPanel({
      host,
      t,
      language: getLanguage(),
      getDiary,
      getCatalogue,
      onCreate: (body) => actions.create(body),
      onUpdate: (clientUuid, changes) => actions.update(clientUuid, changes),
      onDelete: deleteWithUndo,
      toast,
    });
    panel.showCatalogue();
  }

  /**
   * @param {number} dayIndex
   * @param {number} startRelative
   * @param {number} endRelative
   */
  function openAt(dayIndex, startRelative, endRelative) {
    if (!panel || isLocked()) return;
    if (!isWide() && dialogHost && !dialogHost.open) dialogHost.showModal();
    panel.open({ dayIndex, startMinutes: startRelative, endMinutes: endRelative });
  }

  /** @param {Event} event A click on the timeline: a gap or an activity. */
  function openFromEvent(event) {
    if (isLocked() || !panel) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    const gap = target.closest('.t-gap__btn');
    if (gap instanceof HTMLElement) {
      openAt(Number(gap.dataset.day), Number(gap.dataset.start), Number(gap.dataset.end));
      return;
    }

    const button = target.closest('.t-event__btn');
    const uuid = button instanceof HTMLElement ? button.dataset.uuid : null;
    if (!uuid) return;
    const activity = getDiary()?.activities.find((item) => item.client_uuid === uuid);
    if (!activity) return;
    if (!isWide() && dialogHost && !dialogHost.open) dialogHost.showModal();
    panel.openEdit(activity);
  }

  return {
    /** Rebuild after a breakpoint change or a submitted/live transition. */
    create,

    /** @param {boolean} locked */
    sync(locked) {
      if (locked === lockedRendered) return;
      lockedRendered = locked;
      create();
    },

    refresh: () => panel?.refresh(),
    openAt,
    openFromEvent,

    /** `/`: the catalogue with the search field focused, in whichever host. */
    focusSearch() {
      if (!panel) return;
      if (!isWide() && dialogHost && !dialogHost.open) dialogHost.showModal();
      panel.focusSearch();
    },

    /** @returns {boolean} Whether the panel consumed the key. */
    escape() {
      return panel ? panel.escape() : false;
    },
  };
}
