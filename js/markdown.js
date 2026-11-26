// @ts-check
function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseInlineMarkdown(text) {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    })
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

export function renderMarkdown(markdown) {
  const source = String(markdown || '').replace(/\r\n/g, '\n');
  const lines = source.split('\n');
  const chunks = [];
  let paragraph = [];
  let listType = null;
  let listItems = [];
  // The first number of an ordered list is part of the Markdown: `3.` starts at
  // 3. Later numbers are decoration, as in CommonMark.
  let listStart = 1;

  const flushParagraph = () => {
    if (paragraph.length) {
      chunks.push(`<p>${paragraph.join(' ')}</p>`);
      paragraph = [];
    }
  };

  const flushList = () => {
    if (!listType || !listItems.length) {
      listType = null;
      listItems = [];
      listStart = 1;
      return;
    }
    const start = listType === 'ol' && listStart !== 1 ? ` start="${listStart}"` : '';
    chunks.push(
      `<${listType}${start}>${listItems.map((item) => `<li>${item}</li>`).join('')}</${listType}>`
    );
    listType = null;
    listItems = [];
    listStart = 1;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      // A blank line between two list items is a loose list, not the end of the
      // list: flushing here would emit one list per item, each restarting at 1.
      flushParagraph();
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      chunks.push(`<h${level}>${parseInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    const unorderedMatch = line.match(/^[-*]\s+(.*)$/);
    if (unorderedMatch) {
      flushParagraph();
      if (listType && listType !== 'ul') {
        flushList();
      }
      listType = 'ul';
      listItems.push(parseInlineMarkdown(unorderedMatch[1]));
      continue;
    }

    const orderedMatch = line.match(/^(\d+)\.\s+(.*)$/);
    if (orderedMatch) {
      flushParagraph();
      if (listType && listType !== 'ol') {
        flushList();
      }
      if (!listType) {
        listStart = Number.parseInt(orderedMatch[1], 10);
      }
      listType = 'ol';
      listItems.push(parseInlineMarkdown(orderedMatch[2]));
      continue;
    }

    flushList();
    paragraph.push(parseInlineMarkdown(line));
  }

  flushParagraph();
  flushList();
  return chunks.join('');
}

/**
 * Render one line of inline markdown (bold, italic, links) without wrapping it
 * in a block element. Used for study text that has to live inside an existing
 * element - e.g. the instructions page's `<h1>` study title, where a heading
 * marker would nest a heading inside a heading.
 */
export function renderInlineMarkdown(markdown) {
  return parseInlineMarkdown(String(markdown ?? '').trim());
}