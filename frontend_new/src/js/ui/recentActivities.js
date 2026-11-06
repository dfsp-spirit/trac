// @ts-check
/**
 * The "Used recently" shortcut row of the activity panel (D28).
 *
 * Kept apart from the catalogue and its search (`activitySearch.js`) because it
 * answers a different question: the catalogue describes what the study offers,
 * this describes what *this participant* has already picked.
 */
import { customActivityText } from '../domain/activityName.js';

/**
 * @typedef {Object} RecentEntry
 * @property {import('./activitySearch.js').CatalogueEntry} entry The catalogue
 *   row the shortcut opens.
 * @property {{ code: number, name: string } | null} child The sub-activity the
 *   participant picked, if the row was one.
 * @property {string | null} label Title override, or null to use the entry name.
 *   Only a custom entry has one: the typed text is its activity.
 * @property {string | null} prefillText What the form should prefill, if anything.
 */

/**
 * The activities this participant used most recently, as a shortcut row above
 * the catalogue (D28).
 *
 * Derived from the diary the client already holds - no endpoint, no device
 * storage (D33): it survives a reload and follows the participant to another
 * device because the entries come from the server. The shortcut remembers the
 * *row* the participant picked, so a sub-activity stays a sub-activity
 * ("Radfahren", not its parent "Unterwegs (Transit)"), an activity used on
 * several days counts once, and codes that are no longer in the catalogue are
 * dropped - a shortcut that opens nothing is worse than none.
 *
 * A custom-input entry ("Bezahlte Arbeit" / "Bitte Tätigkeit angeben.") is keyed
 * by the *typed text*, not by its code: "Programmieren" and "E-Mails" are two
 * different activities to a participant, so they are two shortcuts, each of
 * which prefills the text field. Keying by code would collapse them into one
 * generic chip that reopens an empty form.
 *
 * @param {import('./activitySearch.js').CatalogueEntry[]} entries
 * @param {Array<{ activity_code: number, parent_activity_code?: number | null, activity_name?: string | null, created_at?: string | null, updated_at?: string | null }>} activities
 * @param {{ limit?: number }} [options]
 * @returns {RecentEntry[]}
 */
export function recentEntries(entries, activities, { limit = 5 } = {}) {
  if (!Array.isArray(entries) || !Array.isArray(activities) || limit <= 0) return [];

  /** @type {Map<number, import('./activitySearch.js').CatalogueEntry>} */
  const byCode = new Map(entries.map((entry) => [entry.code, entry]));
  /** @type {Map<number, { entry: import('./activitySearch.js').CatalogueEntry, child: { code: number, name: string } }>} */
  const byChildCode = new Map();
  for (const catalogueEntry of entries) {
    for (const child of catalogueEntry.children) {
      byChildCode.set(child.code, { entry: catalogueEntry, child });
    }
  }

  /** @type {Map<string, RecentEntry & { used: number }>} */
  const latestUse = new Map();

  for (const activity of activities) {
    if (!activity) continue;

    const picked = resolvePickedRow(byCode, byChildCode, activity);
    if (!picked) continue;
    const { entry, child } = picked;

    const typedText = entry.isCustomInput
      ? customActivityText(entry.name, activity.activity_name) || null
      : null;
    // Keyed by the row that was picked: a sub-activity and its parent are two
    // shortcuts, and a custom entry is keyed by the participant's words instead
    // of by its code.
    const pickedCode = child ? child.code : entry.code;
    const key =
      typedText === null ? String(pickedCode) : `${pickedCode}:${typedText}`;

    // Parsed, not compared as strings: ISO stamps from the API may carry
    // different offsets, where lexicographic order would be wrong.
    const used = Date.parse(activity.updated_at || activity.created_at || '') || 0;
    const seen = latestUse.get(key);
    if (seen === undefined) {
      // `null` label means "the picked row's own name": only a custom entry is
      // titled by the participant's words, and only then is the parent entry
      // repeated as the hint.
      latestUse.set(key, {
        entry,
        child,
        label: typedText,
        prefillText: typedText,
        used,
      });
    } else if (used > seen.used) {
      seen.used = used;
    }
  }

  return [...latestUse.values()]
    .sort((a, b) => b.used - a.used)
    .slice(0, limit)
    .map(({ entry, child, label, prefillText }) => ({
      entry,
      child,
      label,
      prefillText,
    }));
}

/**
 * The catalogue row a stored activity was picked from.
 *
 * A stored sub-activity keeps its own `activity_code` and names its parent in
 * `parent_activity_code`, while a custom entry repeats its code in both fields.
 * Resolving the child - not just the parent it belongs to - is what keeps
 * "Radfahren" in the shortcut row and preselects it in the form the shortcut
 * opens.
 *
 * @param {Map<number, import('./activitySearch.js').CatalogueEntry>} byCode
 * @param {Map<number, { entry: import('./activitySearch.js').CatalogueEntry, child: { code: number, name: string } }>} byChildCode
 * @param {{ activity_code: number, parent_activity_code?: number | null }} activity
 * @returns {{ entry: import('./activitySearch.js').CatalogueEntry, child: { code: number, name: string } | null } | null}
 */
function resolvePickedRow(byCode, byChildCode, activity) {
  const code = Number(activity.activity_code);
  const parentCode = Number(activity.parent_activity_code || 0);

  const asChild = byChildCode.get(code);
  if (asChild && (!parentCode || parentCode === asChild.entry.code)) {
    return asChild;
  }

  const asEntry = byCode.get(code);
  if (asEntry) return { entry: asEntry, child: null };

  // The sub-activity is gone from the config but its parent is still there:
  // keep the shortcut, one level up, instead of offering nothing.
  const parent = byCode.get(parentCode);
  return parent ? { entry: parent, child: null } : null;
}
