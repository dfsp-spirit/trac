// @ts-check
/**
 * The activity panel (D29, D30): one fixed-height panel whose content swaps
 * between the catalogue and the form. The same markup is mounted into the
 * desktop column or the mobile dialog; this component only ever touches the host
 * it was given.
 *
 * It holds UI state (which mode, the query, the prefill) and nothing else. The
 * diary itself lives in the store; edits are reported through the callbacks.
 */
import { createFormController } from './activityPanelForm.js';
import { renderActivityList } from './activityList.js';
import { flattenCatalogue, recentEntries } from './activitySearch.js';
import { dayLabel, daySummaries } from '../domain/diary.js';
import { describeError } from './messages.js';

/** @typedef {(key: string, params?: Record<string, string | number>) => string} Translator */

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {string | null} [className]
 * @param {string | null} [text]
 * @returns {HTMLElementTagNameMap[K]}
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * @param {{
 *   host: HTMLElement,
 *   t: Translator,
 *   language: string,
 *   getDiary: () => import('../domain/diary.js').ApiDiary,
 *   getCatalogue: () => any,
 *   onCreate: (body: { items: any[], group_id?: string }) => Promise<any>,
 *   onUpdate: (clientUuid: string, changes: Record<string, unknown>) => Promise<any>,
 *   onDelete: (activity: import('../domain/diary.js').ApiActivity) => Promise<void>,
 *   toast: { show: (message: string, action?: { label?: string, run?: () => void | Promise<void> }) => void },
 * }} deps
 */
export function createActivityPanel(deps) {
  const { host, t, language, getDiary, getCatalogue, onCreate, onUpdate, onDelete, toast } = deps;

  /**
   * @template {keyof HTMLElementTagNameMap} K
   * @param {string} selector
   * @param {K} [tag] Only for a compile-time shape; the node already exists.
   * @returns {HTMLElementTagNameMap[K]}
   */
  function must(selector, tag = /** @type {any} */ ('div')) {
    const node = host.querySelector(selector);
    if (!node) throw new Error(`Activity panel host is missing ${selector}`);
    return /** @type {HTMLElementTagNameMap[K]} */ (node);
  }

  const title = must('[data-slot="title"]', 'h2');
  const contextLine = must('[data-slot="context"]', 'p');
  const searchRow = must('[data-slot="search"]', 'div');
  const searchInput = must('input[type="search"]', 'input');
  const searchClear = must('[data-slot="search-clear"]', 'button');
  const backButton = must('[data-slot="back"]', 'button');
  const content = must('[data-slot="content"]', 'div');
  const foot = must('[data-slot="actions"]', 'div');

  /** @type {'catalogue' | 'form'} */
  let mode = 'catalogue';
  let query = '';
  let scrollOffset = 0;

  function entries() {
    return flattenCatalogue(getCatalogue()).entries;
  }

  function updateContext() {
    if (!contextLine) return;
    const diary = getDiary();
    if (!diary) return;
    const summaries = daySummaries(diary);
    const index = mode === 'form' ? formController.dayIndex : 0;
    const summary = summaries[index] || summaries[0];
    if (!summary) return;
    const required = diary.timeline.min_coverage || 0;
    const state = summary.meets
      ? t('diary.panel.met')
      : summary.hasData
        ? t('diary.panel.toGo', { minutes: Math.max(0, required - summary.coverage) })
        : t('diary.panel.emptyDay');
    contextLine.textContent = `${dayLabel(summary, language)}: ${state}`;
    contextLine.hidden = false;
  }

  /**
   * The catalogue step: search field above, "Used recently" (when there is
   * anything in the diary and no query), then the categories.
   */
  function renderCatalogue() {
    const all = entries();
    const diary = getDiary();
    renderActivityList(content, {
      entries: all,
      // With a query the matches are the whole answer; the shortcut row is for
      // browsing.
      recents: query ? [] : recentEntries(all, diary?.activities ?? []),
      query,
      t,
      onChoose: (entry, child) => showForm(entry, null, child),
    });
  }

  function showCatalogue({ preserveScroll = false } = {}) {
    mode = 'catalogue';
    if (title) title.textContent = t('diary.panel.chooseActivity');
    searchRow.hidden = false;
    if (backButton) backButton.hidden = true;
    foot.hidden = true;
    foot.replaceChildren();
    renderCatalogue();
    if (preserveScroll) content.scrollTop = scrollOffset;
    updateContext();
  }

  /**
   * @param {import('./activitySearch.js').CatalogueEntry} entry
   * @param {import('../domain/diary.js').ApiActivity | null} [activity]
   * @param {{ code: number, name: string } | null} [child] Sub-activity to preselect.
   */
  function showForm(entry, activity = null, child = null) {
    mode = 'form';
    scrollOffset = content.scrollTop;
    if (title) title.textContent = activity ? t('diary.panel.editActivity') : t('diary.panel.addActivity');
    searchRow.hidden = true;
    if (backButton) backButton.hidden = false;
    formController.show(entry, activity, child);
    updateContext();
    // The list item that was just clicked is gone, so focus would fall back to
    // the body; move it to the first field so the form is where the next key
    // press lands.
    const first = content.querySelector('input, select, textarea');
    if (first instanceof HTMLElement) first.focus();
  }

  const formController = createFormController({
    content,
    foot,
    t,
    language,
    getDiary,
    getCatalogue,
    onCreate,
    onUpdate,
    onDelete,
    toast,
    onDone: () => showCatalogue(),
  });

  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    if (searchClear) searchClear.hidden = !query;
    if (mode !== 'catalogue') return;
    scrollOffset = 0;
    renderCatalogue();
  });

  if (searchClear) {
    searchClear.hidden = true;
    searchClear.addEventListener('click', () => {
      query = '';
      searchInput.value = '';
      searchClear.hidden = true;
      searchInput.focus();
      renderCatalogue();
    });
  }

  if (backButton) {
    backButton.addEventListener('click', () => showCatalogue({ preserveScroll: true }));
  }

  return {
    /** @param {{ dayIndex: number, startMinutes: number, endMinutes: number }} next */
    open(next) {
      formController.setPrefill(next);
      showCatalogue();
      searchInput.focus();
    },

    /** @param {import('../domain/diary.js').ApiActivity} activity */
    openEdit(activity) {
      const all = entries();
      const parentCode = activity.parent_activity_code || activity.activity_code;
      const entry = all.find((item) => item.code === parentCode);
      if (!entry) {
        toast.show(t('diary.error.generic.title'));
        return;
      }
      showForm(entry, activity);
    },

    refresh() {
      if (mode === 'catalogue') showCatalogue({ preserveScroll: true });
      else updateContext();
    },

    /** `/`: the catalogue, with the search field ready to type into. */
    focusSearch() {
      if (mode !== 'catalogue') showCatalogue();
      searchInput.focus();
      searchInput.select();
    },

    /**
     * `Esc`: leave the form, or clear the search. Reports whether it did
     * anything, so the caller can fall back to closing the dialog.
     *
     * @returns {boolean}
     */
    escape() {
      if (mode === 'form') {
        showCatalogue({ preserveScroll: true });
        backButton.focus();
        return true;
      }
      if (query) {
        searchClear?.click();
        return true;
      }
      return false;
    },

    showCatalogue,
  };
}
