// @ts-check
/**
 * The two sentences of the copy dialog: what the source day holds, and what
 * pressing the button would change.
 *
 * Pure and separate from the DOM so the wording is testable against the shipped
 * locales, and so the dialog stays about behaviour. The rules behind the sentences
 * live in `domain/dayCopy.js`.
 */
import { overwrites, refusals } from '../domain/dayCopy.js';
import { dayLabel } from '../domain/diary.js';
import { MINUTES_PER_DAY, formatClock } from '../domain/time.js';
import { describeSkipped } from './messages.js';

/** @typedef {(key: string, params?: Record<string, string | number>) => string} Translator */
/** @typedef {(key: string, count: number) => string} CountTranslator */
/** @typedef {import('../domain/dayCopy.js').CopySource} CopySource */
/** @typedef {import('../domain/dayCopy.js').CopyTarget} CopyTarget */

/**
 * "12 entries · 06:00 – 23:30": what the source day contributes, on the
 * day-relative axis the participant is looking at.
 *
 * @param {Translator} t
 * @param {CountTranslator} tCount
 * @param {CopySource} source
 * @param {number} dayStartMinutes
 * @returns {string}
 */
export function sourceDetail(t, tCount, source, dayStartMinutes) {
  const parts = [tCount('diary.copy.entries', source.count)];
  if (source.firstStart !== null && source.lastEnd !== null) {
    const range = `${formatClock(source.firstStart, dayStartMinutes)} – ${formatClock(source.lastEnd, dayStartMinutes)}`;
    parts.push(
      source.lastEnd > MINUTES_PER_DAY ? `${range} ${t('diary.form.nextDay')}` : range
    );
  }
  return parts.join(' · ');
}

/**
 * The line under the target chips.
 *
 * It answers one question - "what do I lose?" - so days that are empty are left
 * out: naming them buries the part that matters. Refused days are always named,
 * because otherwise the participant would only find out from the toast.
 *
 * @param {Translator} t
 * @param {CountTranslator} tCount
 * @param {{
 *   plan: CopyTarget[],
 *   days: Array<{ index: number, name: string, displayName?: string | null, displayNames?: Record<string, string>, display_name?: string | null, display_names?: Record<string, string> }>,
 *   language: string,
 *   hasSource: boolean,
 *   hasTargets: boolean,
 * }} input
 * @returns {string} Empty when there is nothing to say.
 */
export function previewText(t, tCount, { plan, days, language, hasSource, hasTargets }) {
  if (!hasSource) return t('diary.copy.pickSource');
  if (!hasTargets) return t('diary.copy.pickTargets');

  const lines = [];
  const replaced = overwrites(plan);
  if (replaced.length) {
    const list = replaced
      .map((target) => {
        const day = days.find((entry) => entry.index === target.dayIndex);
        return t('diary.copy.overwriteItem', {
          day: day ? dayLabel(day, language) : String(target.dayIndex),
          count: tCount('diary.copy.entries', target.replaces),
        });
      })
      .join(', ');
    lines.push(t('diary.copy.overwrite', { days: list }));
  }

  const refused = refusals(plan);
  if (refused.length) {
    lines.push(
      describeSkipped(
        t,
        refused.map((target) => ({ day_label_index: target.dayIndex, code: target.code })),
        days,
        language,
        'diary.copy.skipped'
      )
    );
  }
  return lines.join(' ');
}
