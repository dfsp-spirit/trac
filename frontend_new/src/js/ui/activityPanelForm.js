// @ts-check
/**
 * The form half of the activity panel: render the form, own its footer (save,
 * save-and-another, delete) and perform the write.
 *
 * Split from the panel frame so each file stays small enough to read, and so the
 * write path - which is where a mistake costs data - sits in one place.
 */
import { MINUTES_PER_DAY } from '../domain/time.js';
import { formatClock } from '../domain/time.js';
import { newUuid } from '../domain/uuid.js';
import { renderActivityForm } from './activityForm.js';
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
 *   content: HTMLElement,
 *   foot: HTMLElement,
 *   t: Translator,
 *   language: string,
 *   getDiary: () => import('../domain/diary.js').ApiDiary,
 *   getCatalogue: () => any,
 *   onCreate: (body: { items: any[] }) => Promise<any>,
 *   onUpdate: (clientUuid: string, changes: Record<string, unknown>) => Promise<any>,
 *   onDelete: (activity: import('../domain/diary.js').ApiActivity) => Promise<void>,
 *   toast: { show: (message: string, action?: { label?: string, run?: () => void | Promise<void> }) => void },
 *   onDone: () => void,
 * }} deps
 */
export function createFormController(deps) {
  const { content, foot, t, language, getDiary, getCatalogue, onCreate, onUpdate, onDelete, toast, onDone } = deps;

  /** @type {ReturnType<typeof renderActivityForm> | null} */
  let form = null;
  /** @type {import('../domain/diary.js').ApiActivity | null} */
  let editing = null;
  /** @type {{ dayIndex: number, startMinutes: number, endMinutes: number, childCode?: number | null }} */
  let prefill = { dayIndex: 0, startMinutes: 8 * 60, endMinutes: 9 * 60 };

  /** @param {import('../domain/diary.js').ApiActivity | null} activity */
  function renderFoot(activity) {
    foot.replaceChildren();

    const primary = el(
      'button',
      't-btn t-btn--primary t-btn--block',
      activity ? t('diary.panel.saveChanges') : t('diary.panel.addToTimeline')
    );
    primary.type = 'button';
    primary.addEventListener('click', () => void submit('close'));

    const secondary = el('button', 't-btn t-btn--secondary t-btn--block', t('diary.panel.addAnother'));
    secondary.type = 'button';
    secondary.addEventListener('click', () => void submit('another'));
    if (activity) secondary.hidden = true;

    foot.append(primary, secondary);

    if (activity) {
      const remove = el('button', 't-btn t-btn--ghost t-btn--block', t('diary.panel.delete'));
      remove.type = 'button';
      remove.addEventListener('click', async () => {
        await onDelete(activity);
        onDone();
      });
      foot.append(remove);
    }
  }

  /** @param {'close' | 'another'} then */
  async function submit(then) {
    if (!form) return;
    const result = form.read();
    if (!result.ok) {
      const message = describeError(t, result.code, result.meta);
      form.showError(message.title, message.text);
      return;
    }
    const values = /** @type {Record<string, any>} */ (result.values);
    const dayStart = getDiary().study.day_start_minutes || 0;
    const range = `${formatClock(values.start_minutes, dayStart)} – ${formatClock(values.end_minutes, dayStart)}`;

    try {
      if (editing) {
        await onUpdate(editing.client_uuid, {
          day_label_index: values.day_label_index,
          start_minutes: values.start_minutes,
          end_minutes: values.end_minutes,
          activity_code: values.activity_code,
          activity_name: values.activity_name,
          category: values.category,
          color: values.color,
          parent_activity_code: values.parent_activity_code,
          frequency_key: values.frequency_key,
        });
        toast.show(t('diary.toast.changed', { name: values.activity_name, range }));
        onDone();
        return;
      }

      const response = await onCreate({
        items: [
          {
            ...values,
            client_uuid: newUuid(),
            catalogue_version: getCatalogue()?.general?.version || null,
          },
        ],
      });

      const results = response?.results || [];
      const added = results.filter((/** @type {any} */ item) => item.status === 'added').length;
      const skipped = results.filter((/** @type {any} */ item) => item.status === 'skipped');

      let message = t('diary.toast.added', { name: values.activity_name, range });
      if (added > 1) message += ` ${t('diary.toast.addedDays', { count: added })}`;
      if (skipped.length) {
        message += ` ${t('diary.toast.skipped', {
          reason: describeError(t, skipped[0].code, skipped[0]).text,
        })}`;
      }

      const created = response?.activities || [];
      toast.show(
        message,
        created.length
          ? {
              label: t('diary.toast.undo'),
              run: async () => {
                for (const row of created) await onDelete(row);
              },
            }
          : undefined
      );

      if (then === 'another') {
        prefill = {
          dayIndex: values.day_label_index + Math.floor(values.end_minutes / MINUTES_PER_DAY),
          startMinutes: values.end_minutes % MINUTES_PER_DAY,
          endMinutes: Math.min((values.end_minutes % MINUTES_PER_DAY) + 60, MINUTES_PER_DAY - 10),
        };
      }
      onDone();
    } catch (error) {
      const failure = /** @type {{ code?: string, detail?: Record<string, unknown> }} */ (error);
      const message = describeError(t, failure.code, failure.detail || {});
      form.showError(message.title, message.text);
    }
  }

  return {
    /**
     * @param {import('./activitySearch.js').CatalogueEntry} entry
     * @param {import('../domain/diary.js').ApiActivity | null} [activity]
     * @param {{ code: number, name: string } | null} [child] Sub-activity to preselect.
     */
    show(entry, activity = null, child = null) {
      editing = activity;
      foot.hidden = false;
      const diary = getDiary();
      const dayStart = diary.study.day_start_minutes || 0;

      form = renderActivityForm(content, {
        entry,
        days: diary.days,
        language,
        t,
        prefill: activity
          ? {
              dayIndex: activity.day_label_index,
              startMinutes: activity.start_minutes,
              endMinutes: activity.end_minutes,
            }
          : { ...prefill, childCode: child ? child.code : null },
        existing: diary.activities.map((item) => ({
          id: item.client_uuid,
          dayIndex: item.day_label_index,
          startMinutes: dateStart(item, dayStart),
          endMinutes: dateEnd(item, dayStart),
          activityCode: item.activity_code,
        })),
        dayStartMinutes: dayStart,
        maxOverlap: diary.timeline.max_overlap,
        mode: activity ? 'edit' : 'create',
        activity,
      });
      // Enter saves (D31). Two reasons it is spelled out rather than left to the
      // browser: there is no submit button to be the default action, so implicit
      // submission would reload the diary, and a <select> - which is what most of
      // this form is - does not fire implicit submission at all.
      form.form.addEventListener('submit', (event) => event.preventDefault());
      form.form.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.isComposing) return;
        if (event.target instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        void submit('close');
      });
      renderFoot(activity);
    },

    /** @param {{ dayIndex: number, startMinutes: number, endMinutes: number }} next */
    setPrefill(next) {
      prefill = next;
    },

    /** The day the form is currently editing, for the panel's context line. */
    get dayIndex() {
      const select = /** @type {HTMLSelectElement | null} */ (content.querySelector('#form-day'));
      return select ? Number(select.value) : prefill.dayIndex;
    },

    get active() {
      return form !== null;
    },
  };
}

/**
 * @param {import('../domain/diary.js').ApiActivity} activity
 * @param {number} dayStart
 * @returns {number}
 */
function dateStart(activity, dayStart) {
  const shifted = activity.start_minutes - dayStart;
  return shifted < 0 ? shifted + MINUTES_PER_DAY : shifted;
}

/**
 * @param {import('../domain/diary.js').ApiActivity} activity
 * @param {number} dayStart
 * @returns {number}
 */
function dateEnd(activity, dayStart) {
  const start = dateStart(activity, dayStart);
  let end = activity.end_minutes - dayStart;
  if (end < 0) end += MINUTES_PER_DAY;
  return end <= start ? end + MINUTES_PER_DAY : end;
}
