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
     *   editing: boolean,
     *   groupKind?: 'recent' | 'catalogue',
     *   query?: string,
     * }} start
     */
    begin({ entry, editing, groupKind = 'catalogue', query = '' }) {
      source = editing
        ? 'edit'
        : entry?.isCustomInput
          ? 'custom'
          : groupKind === 'recent'
            ? 'recent'
            : query
              ? 'search'
              : 'catalogue';
      isCustom = Boolean(entry?.isCustomInput);
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
