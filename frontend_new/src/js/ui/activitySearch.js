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
import { generalTimelineSettings } from '../domain/timelines.js';

/**
 * @typedef {Object} CatalogueEntry
 * @property {number} code
 * @property {string} name
 * @property {string} category
 * @property {string} timelineKey Which timeline defined this activity.
 * @property {string | null} color
 * @property {string | null} examples
 * @property {boolean} isCustomInput
 * @property {Array<{ code: number, name: string }>} children
 * @property {Array<{ key: string, label: string }>} frequencyOptions
 * @property {string} haystack Folded text used by the search.
 */

/**
 * @typedef {Object} SearchHit
 * @property {CatalogueEntry} entry The catalogue row this hit belongs to.
 * @property {{ code: number, name: string } | null} child The matched sub-activity, if the hit is one.
 * @property {number} rank 0 for a word-start match, 1 for an inner match.
 * @property {number} position Where the match starts in the folded text.
 * @property {string} [label] Title override: a custom shortcut shows the typed text.
 * @property {string | null} [prefillText] Text to prefill in a custom-input form.
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
 * Locate the needle in one folded string.
 *
 * @param {string} haystack
 * @param {string} needle
 * @returns {{ rank: number, position: number } | null}
 */
function locate(haystack, needle) {
  const position = haystack.indexOf(needle);
  if (position === -1) return null;
  const startsWord = position === 0 || /\s/.test(haystack[position - 1] || '');
  return { rank: startsWord ? 0 : 1, position };
}

/**
 * Flatten a study activities config into searchable entries.
 *
 * @param {any} catalogue Response of /activities-config
 * @param {string[] | null} [timelineKeys] Timelines to include, in config order;
 *   `null` means every timeline (see `domain/timelines.js` for the policy that
 *   decides this).
 * @returns {{ entries: CatalogueEntry[], categories: string[], minCoverage: number | null, maxOverlap: number | null }}
 */
export function flattenCatalogue(catalogue, timelineKeys = null) {
  /** @type {CatalogueEntry[]} */
  const entries = [];
  /** @type {string[]} */
  const categories = [];

  const timelines = (catalogue && catalogue.timeline) || {};
  const keys = timelineKeys ?? Object.keys(timelines);
  // Study-wide settings come from the first timeline, never the last one: a
  // second timeline used to overwrite `min_coverage` with its own 0.
  const { minCoverage, maxOverlap } = generalTimelineSettings(catalogue, keys);

  for (const key of keys) {
    const config = /** @type {any} */ (timelines[key]);
    if (!config) continue;

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
          timelineKey: key,
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
 * Match entries and their sub-activities against a query.
 *
 * A matching sub-activity *replaces* its parent row: the parent name alone does
 * not say which sub-activity matched, and the child is the row the participant
 * ends up reporting ("Joggen" must find "Joggen: Draußen alleine" directly, not
 * "Sport & Bewegung (Außer Haus)" and then a second choice).
 *
 * @param {CatalogueEntry[]} entries
 * @param {string} query
 * @returns {SearchHit[]}
 */
export function searchHits(entries, query) {
  const needle = fold(query);
  if (!needle) return entries.map((entry) => ({ entry, child: null, rank: 0, position: 0 }));

  /** @type {SearchHit[]} */
  const hits = [];
  for (const entry of entries) {
    const children = [];
    for (const child of entry.children) {
      const found = locate(fold(child.name), needle);
      if (found) children.push({ entry, child, ...found });
    }
    if (children.length) {
      hits.push(...children);
      continue;
    }
    const found = locate(entry.haystack, needle);
    if (found) hits.push({ entry, child: null, ...found });
  }

  /** @param {SearchHit} hit */
  const label = (hit) => (hit.child ? hit.child.name : hit.entry.name);
  hits.sort(
    (a, b) => a.rank - b.rank || a.position - b.position || label(a).localeCompare(label(b))
  );
  return hits;
}

/**
 * Filter entries by a query. Word-start matches come before inner matches, then
 * alphabetical order, which keeps the list stable while typing.
 *
 * Entries are listed once even when several of their sub-activities match; use
 * {@link searchHits} where the matching sub-activity matters.
 *
 * @param {CatalogueEntry[]} entries
 * @param {string} query
 * @returns {CatalogueEntry[]}
 */
export function filterEntries(entries, query) {
  // The catalogue itself when nothing is typed - the renderer relies on the
  // list being untouched while browsing.
  if (!fold(query)) return entries;

  /** @type {CatalogueEntry[]} */
  const matched = [];
  const seen = new Set();
  for (const hit of searchHits(entries, query)) {
    if (seen.has(hit.entry.code)) continue;
    seen.add(hit.entry.code);
    matched.push(hit.entry);
  }
  return matched;
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
