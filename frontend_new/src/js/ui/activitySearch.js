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
