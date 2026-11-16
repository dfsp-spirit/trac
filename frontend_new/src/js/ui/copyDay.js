// @ts-check
/**
 * Copying a day, as one seam: the dialog plus what happens after the server
 * answered (the message, the undo, the usability signal).
 *
 * The dialog owns the markup and the rules' feedback; this file owns the
 * consequences, so neither of them has to know about the other's job. The
 * composition root only says "copy".
 */
import { copyableDays, refusals } from '../domain/dayCopy.js';
import { dayLabelList } from '../domain/diary.js';
import { describeSkipped } from './messages.js';
import { createCopyDayDialog } from './copyDayDialog.js';
import { createToast } from './toast.js';

/** @typedef {(key: string, params?: Record<string, string | number>) => string} Translator */

/**
 * @param {{
 *   root: HTMLElement,
 *   store: { get: () => any },
 *   actions: {
 *     copyDay: (body: { source_day_index: number, target_day_indexes: number[] }) => Promise<any>,
 *     undoCopy: (result: any) => Promise<void>,
 *   } | null,
 *   t: Translator,
 *   tCount: (key: string, count: number) => string,
 *   toastRegion: HTMLElement,
 *   signals?: { track: (name: string, props?: Record<string, any>) => void },
 * }} deps
 */
export function createCopyDay({ root, store, actions, t, tCount, toastRegion, signals }) {
  const toast = createToast(toastRegion, {
    undo: () => t('diary.toast.undo'),
    dismiss: () => t('diary.toast.dismiss'),
  });

  const dialog = createCopyDayDialog({
    root,
    t,
    tCount,
    getDiary: () => store.get().diary || null,
    getLanguage: () => store.get().language,
    getCurrentDay: () => store.get().currentDay,
    onCopy: async (body) => {
      if (!actions) throw new Error('no participant');
      return actions.copyDay(body);
    },
    onCopied: (result, { plan, days, language }) => {
      const refused = refusals(plan).map((target) => ({
        day_label_index: target.dayIndex,
        code: target.code,
      }));
      if (refused.length) {
        // The same signal an add reports when a day refuses an entry: which rule
        // stops people is the question the admin page answers.
        signals?.track('diary.blocked', {
          stage: 'multi_day',
          codes: [...new Set(refused.map((item) => String(item.code)))],
        });
      }

      const copied = (result?.results || [])
        .filter((/** @type {any} */ item) => item.status === 'copied')
        .map((/** @type {any} */ item) => Number(item.day_label_index));
      let message = t('diary.copy.success', { days: dayLabelList(copied, days, language) });
      if (refused.length) {
        message += ` ${describeSkipped(t, refused, days, language, 'diary.copy.skipped')}`;
      }

      const undo = result;
      toast.show(message, {
        label: t('diary.toast.undo'),
        run: () => (actions ? actions.undoCopy(undo) : Promise.resolve()),
      });
    },
  });

  return {
    /**
     * @param {{ sourceDay?: number | null }} [options]
     */
    open(options = {}) {
      const diary = store.get().diary;
      if (!diary || diary.study.submitted_at) return;
      // The entry points may be inert, but none of them is silent: a day heading
      // names the day it could not copy from, the rail and the menu name nothing,
      // and all three say why instead of opening an empty dialog.
      const copyable = copyableDays(diary);
      const requested = options.sourceDay;
      if (!copyable.length || (requested != null && !copyable.includes(requested))) {
        toast.show(t('diary.copy.nothingToCopy'));
        return;
      }
      dialog.open(options);
    },
    close: () => dialog.close(),
    destroy() {
      toast.hide();
      dialog.destroy();
    },
  };
}
