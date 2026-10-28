// @ts-check
/**
 * Dates as participants see them.
 *
 * The participant UI has no calendar dates (day labels only), but two study
 * values are real dates: the collection window. When a study is not open yet or
 * already over, the unavailable page says when - "not available" without a date
 * is only half an answer (D39).
 *
 * The window is a study-administrative boundary, so it is formatted in UTC: a
 * start of `2026-06-01T00:00:00Z` reads "1 June 2026" everywhere, instead of
 * "31 May" for a participant in a negative-offset timezone. That also keeps the
 * e2e legs (four timezones in CI) deterministic.
 */

/**
 * @param {string | null | undefined} iso ISO 8601 timestamp from the API.
 * @param {string} language Study/UI language, e.g. "de".
 * @param {string} [timeZone] IANA zone; UTC by default for the reason above.
 * @returns {string} Localized date, or "" when there is nothing to format.
 */
export function formatStudyDate(iso, language, timeZone = 'UTC') {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  for (const locale of [language, 'en']) {
    try {
      return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone }).format(date);
    } catch {
      // Unknown language tag: fall back to English below rather than showing ISO.
    }
  }
  return '';
}
