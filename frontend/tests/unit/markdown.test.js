import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderInlineMarkdown } from '../../src/js/markdown.js';

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
