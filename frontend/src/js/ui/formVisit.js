// @ts-check
/**
 * One visit to the activity form: where it started, how long it took, how it
 * ended.
 *
 * The interesting case is the visit that never ends within the page load: the
 * participant opened the form, then dismissed the panel or closed the tab. That
 * "left mid-entry" ratio is the one signal no server-side table can provide,
 * because nothing was ever sent.
 */
import { durationBucket } from '../domain/uxEvents.js';

/**
 * @param {{
 *   track?: (name: string, props?: Record<string, any>) => void,
 *   now?: () => number,
 * }} deps
 */
export function createFormVisit({ track, now = () => Date.now() }) {
  let openedAt = 0;
  let open = false;
  /** @type {'search' | 'catalogue' | 'recent' | 'custom' | 'edit'} */
  let source = 'catalogue';
  let isCustom = false;
  let hasOptions = false;

  return {
    /**
     * @param {{
     *   entry: any,
     *   child?: { customInput?: boolean } | null,
     *   editing: boolean,
     *   groupKind?: 'recent' | 'catalogue',
     *   query?: string,
     * }} start `child` is the sub-activity the form opens with; it can be a
     *   custom input itself, which is the same kind of visit as a custom entry's.
     */
    begin({ entry, child = null, editing, groupKind = 'catalogue', query = '' }) {
      const isCustomRow = Boolean(entry?.isCustomInput || child?.customInput);
      source = editing
        ? 'edit'
        : isCustomRow
          ? 'custom'
          : groupKind === 'recent'
            ? 'recent'
            : query
              ? 'search'
              : 'catalogue';
      isCustom = isCustomRow;
      hasOptions = (entry?.children?.length ?? 0) > 0;
      openedAt = now();
      open = true;
      track?.('activity.form.opened', { source, is_custom_input: isCustom });
    },

    /** @param {'saved' | 'cancelled' | 'deleted'} outcome */
    end(outcome) {
      if (!open) return;
      open = false;
      track?.('activity.form.closed', {
        outcome,
        source,
        is_custom_input: isCustom,
        duration_bucket: durationBucket(now() - openedAt),
        had_child_choice: hasOptions,
      });
    },
  };
}
