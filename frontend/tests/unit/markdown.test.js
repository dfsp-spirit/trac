import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderInlineMarkdown, renderMarkdown } from '../../src/js/markdown.js';

// renderInlineMarkdown() is used for the instructions page <h1> study title
// (study_text_instructions_title). Unlike renderMarkdown() it must NOT wrap the
// text in a block element, or the title would end up as a <p>/<h1> inside the
// existing <h1>.

test('renders inline markdown without a block wrapper', () => {
  assert.equal(renderInlineMarkdown('Hello world'), 'Hello world');
  assert.equal(renderInlineMarkdown('**Bold** and *italic*'), '<strong>Bold</strong> and <em>italic</em>');
});

test('renders links and escapes html', () => {
  assert.equal(
    renderInlineMarkdown('[Study info](https://example.com/info)'),
    '<a href="https://example.com/info" target="_blank" rel="noopener noreferrer">Study info</a>'
  );
  assert.equal(renderInlineMarkdown('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('trims surrounding whitespace and handles missing input', () => {
  assert.equal(renderInlineMarkdown('  Welcome!  '), 'Welcome!');
  assert.equal(renderInlineMarkdown(undefined), '');
  assert.equal(renderInlineMarkdown(null), '');
});

// renderMarkdown() renders study text blocks (consent, instructions, thank-you).

test('block markdown: paragraphs, headings and lists', () => {
  assert.equal(renderMarkdown('one\n\ntwo'), '<p>one</p><p>two</p>');
  assert.equal(renderMarkdown('## Title'), '<h2>Title</h2>');
  assert.equal(renderMarkdown('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
});

test('a blank line between items does not restart the list', () => {
  // Study texts routinely separate numbered items with blank lines. Ending the
  // list at each blank line emitted one <ol> per item, so every item rendered
  // with the number 1.
  assert.equal(renderMarkdown('1. a\n\n2. b\n\n3. c'), '<ol><li>a</li><li>b</li><li>c</li></ol>');
  assert.equal(renderMarkdown('- a\n\n- b'), '<ul><li>a</li><li>b</li></ul>');
});

test('an ordered list keeps its start number and a paragraph after a list stays a paragraph', () => {
  assert.equal(renderMarkdown('3. a\n\n4. b'), '<ol start="3"><li>a</li><li>b</li></ol>');
  assert.equal(renderMarkdown('- a\n\nplain'), '<ul><li>a</li></ul><p>plain</p>');
});
