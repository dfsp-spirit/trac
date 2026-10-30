// @ts-check
/**
 * Activity catalogue flattening and search (D30).
 *
 * The catalogue arrives exactly as the study defines it - timeline, categories,
 * activities with optional children, custom text and frequency options - so it is
 * flattened once here and filtered by text. Searching is on the *localized*
 * strings the study shipped, which is why folding has to cope with German and
 * Swedish diacritics.
 */

/**
 * @typedef {Object} CatalogueEntry
 * @property {number} code
 * @property {string} name
 * @property {string} category
 * @property {string | null} color
 * @property {string | null} examples
 * @property {boolean} isCustomInput
 * @property {Array<{ code: number, name: string }>} children
 * @property {Array<{ key: string, label: string }>} frequencyOptions
 * @property {string} haystack Folded text used by the search.
 */

/**
 * Lowercase, strip diacritics and normalise "ß" so "Aussern" finds "Äußern".
 *
 * @param {string} value
 * @returns {string}
 */
export function fold(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .trim();
}

/**
 * Flatten a study activities config into searchable entries.
 *
 * @param {any} catalogue Response of /activities-config
 * @returns {{ entries: CatalogueEntry[], categories: string[], minCoverage: number | null, maxOverlap: number | null }}
 */
export function flattenCatalogue(catalogue) {
  /** @type {CatalogueEntry[]} */
  const entries = [];
  /** @type {string[]} */
  const categories = [];
  let minCoverage = null;
  let maxOverlap = null;

  const timelines = (catalogue && catalogue.timeline) || {};
  for (const timeline of Object.values(timelines)) {
    const config = /** @type {any} */ (timeline);
    if (typeof config.min_coverage === 'number') minCoverage = config.min_coverage;
    if (typeof config.max_overlap === 'number') maxOverlap = config.max_overlap;

    for (const category of config.categories || []) {
      if (!categories.includes(category.name)) categories.push(category.name);
      for (const activity of category.activities || []) {
        const children = (activity.childItems || []).map(
          (/** @type {any} */ child) => ({ code: Number(child.code), name: String(child.name) })
        );
        const frequencyOptions = (activity.frequency_options || []).map(
          (/** @type {any} */ option) => ({ key: String(option.key), label: String(option.label) })
        );
        entries.push({
          code: Number(activity.code),
          name: String(activity.name),
          category: category.name,
          color: activity.color || category.color || null,
          examples: activity.examples || null,
          isCustomInput: Boolean(activity.is_custom_input),
          children,
          frequencyOptions,
          haystack: fold(
            [activity.name, activity.label, activity.examples, category.name]
              .filter(Boolean)
              .join(' ')
          ),
        });
      }
    }
  }

  return { entries, categories, minCoverage, maxOverlap };
}

/**
 * Filter entries by a query. Word-start matches come before inner matches, then
 * alphabetical order, which keeps the list stable while typing.
 *
 * @param {CatalogueEntry[]} entries
 * @param {string} query
 * @returns {CatalogueEntry[]}
 */
export function filterEntries(entries, query) {
  const needle = fold(query);
  if (!needle) return entries;

  const scored = [];
  for (const entry of entries) {
    const position = entry.haystack.indexOf(needle);
    if (position === -1) continue;
    const startsWord = position === 0 || /\s/.test(entry.haystack[position - 1] || '');
    scored.push({ entry, rank: startsWord ? 0 : 1, position });
  }
  scored.sort(
    (a, b) => a.rank - b.rank || a.position - b.position || a.entry.name.localeCompare(b.entry.name)
  );
  return scored.map((item) => item.entry);
}

/**
 * Entries grouped by category, in catalogue order, with empty groups dropped.
 *
 * @param {CatalogueEntry[]} entries
 * @returns {Array<[string, CatalogueEntry[]]>}
 */
export function groupByCategory(entries) {
  /** @type {Map<string, CatalogueEntry[]>} */
  const groups = new Map();
  for (const entry of entries) {
    const list = groups.get(entry.category) || [];
    list.push(entry);
    groups.set(entry.category, list);
  }
  return [...groups.entries()];
}

/**
 * The activities this participant used most recently, as a shortcut row above
 * the catalogue (D28).
 *
 * Derived from the diary the client already holds - no endpoint, no device
 * storage (D33): it survives a reload and follows the participant to another
 * device because the entries come from the server. A sub-activity counts as its
 * parent (that is the row the participant picked), an activity used on several
 * days counts once, and codes that are no longer in the catalogue are dropped -
 * a shortcut that opens nothing is worse than none.
 *
 * @param {CatalogueEntry[]} entries
 * @param {Array<{ activity_code: number, parent_activity_code?: number | null, created_at?: string | null, updated_at?: string | null }>} activities
 * @param {{ limit?: number }} [options]
 * @returns {CatalogueEntry[]}
 */
export function recentEntries(entries, activities, { limit = 4 } = {}) {
  if (!Array.isArray(entries) || !Array.isArray(activities) || limit <= 0) return [];

  /** @type {Map<number, CatalogueEntry>} */
  const byCode = new Map(entries.map((entry) => [entry.code, entry]));
  /** @type {Map<number, number>} */
  const latestUse = new Map();

  for (const activity of activities) {
    if (!activity) continue;
    const code = Number(activity.parent_activity_code || activity.activity_code);
    const entry = byCode.get(code);
    // Custom inputs are one-offs by nature ("Other activity" with the
    // participant's own text): as a shortcut they would only repeat themselves.
    if (!entry || entry.isCustomInput) continue;

    // Parsed, not compared as strings: ISO stamps from the API may carry
    // different offsets, where lexicographic order would be wrong.
    const used = Date.parse(activity.updated_at || activity.created_at || '') || 0;
    const seen = latestUse.get(code);
    if (seen === undefined || used > seen) latestUse.set(code, used);
  }

  return [...latestUse.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([code]) => /** @type {CatalogueEntry} */ (byCode.get(code)));
}
