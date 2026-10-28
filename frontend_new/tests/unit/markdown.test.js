import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../../src/js/domain/markdown.js';

// Study texts arrive as Markdown from the study config and are rendered into the
// consent, instructions and thank-you pages (D37). Everything here is a rule the
// pages rely on, so a change in the renderer fails here before it reaches a
// participant.

test('empty or missing input renders as nothing', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(null), '');
  assert.equal(renderMarkdown(undefined), '');
});

test('a single newline inside a paragraph is a line break, not a space', () => {
  assert.equal(renderMarkdown('one\ntwo'), '<p>one<br>two</p>');
});

test('a blank line starts a new paragraph', () => {
  assert.equal(renderMarkdown('one\n\ntwo'), '<p>one</p><p>two</p>');
});

test('contact blocks keep their lines (the pilot consent text)', () => {
  const markdown = [
    '**Person A (Studienkoordinatorin)**',
    'Max-Planck-Institut für empirische Ästhetik',
    'Grüneburgweg 14',
    '60322 Frankfurt am Main',
    'ana@example.org',
  ].join('\n');
  assert.equal(
    renderMarkdown(markdown),
    '<p><strong>Person A (Studienkoordinatorin)</strong><br>Max-Planck-Institut für empirische Ästhetik<br>Grüneburgweg 14<br>60322 Frankfurt am Main<br>ana@example.org</p>'
  );
});

test('headings of every level are emitted as written', () => {
  for (const level of [1, 2, 3, 4, 5, 6]) {
    assert.equal(renderMarkdown(`${'#'.repeat(level)} Title`), `<h${level}>Title</h${level}>`);
  }
});

test('unordered and ordered lists, including a switch between them', () => {
  assert.equal(renderMarkdown('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(renderMarkdown('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
  assert.equal(
    renderMarkdown('- a\n1. b'),
    '<ul><li>a</li></ul><ol><li>b</li></ol>'
  );
});

test('text after a list is a paragraph again', () => {
  assert.equal(renderMarkdown('- a\nplain'), '<ul><li>a</li></ul><p>plain</p>');
});

test('bold and italic, also inside a list item', () => {
  assert.equal(renderMarkdown('**b** and *i*'), '<p><strong>b</strong> and <em>i</em></p>');
  assert.equal(renderMarkdown('- **b**'), '<ul><li><strong>b</strong></li></ul>');
});

test('http(s) links open in a new tab without a referrer', () => {
  assert.equal(
    renderMarkdown('[Privacy](https://example.org/privacy)'),
    '<p><a href="https://example.org/privacy" target="_blank" rel="noopener noreferrer">Privacy</a></p>'
  );
});

test('only http(s) targets become links', () => {
  const html = renderMarkdown('[x](javascript:alert(1))');
  assert.ok(!html.includes('<a '), html);
  assert.ok(html.includes('javascript:alert(1)'), html);
});

test('input is escaped before any markup is produced', () => {
  const html = renderMarkdown('<script>alert("x")</script>');
  assert.equal(html, '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>');
});

test('CRLF input behaves like LF input', () => {
  assert.equal(renderMarkdown('one\r\ntwo'), '<p>one<br>two</p>');
});

test('a heading keeps inline emphasis', () => {
  assert.equal(renderMarkdown('## **Bold** title'), '<h2><strong>Bold</strong> title</h2>');
});
