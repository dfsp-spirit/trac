// @ts-check
/**
 * Markdown for study-supplied text (D37).
 *
 * Consent and instruction pages are written by researchers in the study
 * configuration, in Markdown. This is a port of the renderer the old frontend
 * uses, kept dependency-free on purpose: a page that must render text from a
 * config file is not a reason to add a parsing library.
 *
 * Everything is escaped before a single tag is produced, so the only markup in
 * the output is the markup this file emits. Supported: headings, ordered and
 * unordered lists, paragraphs, bold, italic, and http(s) links. That is what the
 * existing study texts use, and it is small enough to keep tested.
 *
 * Line breaks: a single newline inside a paragraph becomes a `<br>`, not a
 * space. Study texts are written for reading, not for a 80-column editor -
 * contact blocks, addresses and opening hours are one line each, and CommonMark's
 * "soft break" would run them together into one sentence ("Grüneburgweg 14 60322
 * Frankfurt am Main ana@example.org"). Authors therefore do not need trailing
 * double spaces, and a blank line still starts a new paragraph.
 *
 * Pure: string in, string out. The caller decides where to put it.
 */

/**
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * @param {string} text
 * @returns {string}
 */
function inline(text) {
  return escapeHtml(text)
    .replace(
      /\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g,
      (_, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
    )
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

/**
 * Render Markdown to HTML. Empty or missing input renders as nothing, not as an
 * empty paragraph, so a caller can test "is there any text?".
 *
 * @param {string | null | undefined} markdown
 * @returns {string}
 */
export function renderMarkdown(markdown) {
  const lines = String(markdown || '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  /** @type {string[]} */
  const chunks = [];
  /** @type {string[]} */
  let paragraph = [];
  /** @type {'ul' | 'ol' | null} */
  let listType = null;
  /** @type {string[]} */
  let listItems = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      chunks.push(`<p>${paragraph.join('<br>')}</p>`);
      paragraph = [];
    }
  };

  const flushList = () => {
    if (listType && listItems.length) {
      chunks.push(
        `<${listType}>${listItems.map((item) => `<li>${item}</li>`).join('')}</${listType}>`
      );
    }
    listType = null;
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      chunks.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.*)$/);
    if (unordered) {
      flushParagraph();
      if (listType && listType !== 'ul') flushList();
      listType = 'ul';
      listItems.push(inline(unordered[1]));
      continue;
    }

    const ordered = line.match(/^\d+\.\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      if (listType && listType !== 'ol') flushList();
      listType = 'ol';
      listItems.push(inline(ordered[1]));
      continue;
    }

    flushList();
    paragraph.push(inline(line));
  }

  flushParagraph();
  flushList();
  return chunks.join('');
}
