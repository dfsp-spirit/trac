#!/usr/bin/env node
/**
 * Enforces the mechanical half of D33 (component architecture). The rules that
 * cannot be checked mechanically - "one component per file", "components never
 * mutate state" - are reviewed; everything below fails the build.
 *
 * No dependencies: it reads files and matches patterns, so it runs anywhere the
 * unit tests run.
 *
 *   node tools/check-architecture.mjs [--root <dir>] [--json]
 *
 * Exported for tests: checkTree(root) -> violation[].
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Line caps. The design-system bundle is vendored whole; its blocks move next
 *  to their components as those are built, at which point the exemption goes. */
export const SIZE_CAPS = {
  js: 300,
  css: 150,
  exempt: {
    'src/styles/components.css': 'vendored design-system bundle (D23), split when components land',
  },
};

/** Which layers each layer may import. Anything not listed is forbidden. */
export const ALLOWED_IMPORTS = {
  config: [],
  domain: [],
  data: ['domain', 'config'],
  state: ['domain', 'config'],
  ui: ['domain', 'config'],
  main: ['domain', 'data', 'state', 'ui', 'config'],
};

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build']);

/**
 * @typedef {Object} Violation
 * @property {string} rule
 * @property {string} file Path relative to the root.
 * @property {number} line 1-based; 0 when the file as a whole is at fault.
 * @property {string} message
 */

/**
 * @param {string} dir
 * @param {(file: string) => boolean} predicate
 * @param {string[]} [out]
 * @returns {string[]}
 */
function walk(dir, predicate, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

/** @param {string} file @returns {string} */
function toPosix(file) {
  return file.split(sep).join('/');
}

/**
 * The architectural layer of a file, or null when it is outside src/js.
 *
 * @param {string} relativePath e.g. "src/js/domain/geometry.js"
 * @returns {string | null}
 */
export function layerOf(relativePath) {
  const match = /^src\/js\/(?:(domain|data|state|ui)\/|[^/]*$)/.exec(relativePath);
  if (!match) return null;
  if (match[1]) return match[1];
  if (relativePath === 'src/js/main.js') return 'main';
  if (relativePath === 'src/js/config.js') return 'config';
  return 'unknown';
}

/** @param {string} text @returns {{ text: string, line: number }[]} */
function linesOf(text) {
  return text.split('\n').map((line, index) => ({ text: line, line: index + 1 }));
}

/** @param {string} css @returns {string} */
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));
}

/**
 * @param {string} root
 * @returns {Violation[]}
 */
export function checkTree(root) {
  /** @type {Violation[]} */
  const violations = [];
  const add = (rule, absoluteFile, line, message) =>
    violations.push({ rule, file: toPosix(relative(root, absoluteFile)), line, message });

  const jsFiles = walk(join(root, 'src', 'js'), (file) => file.endsWith('.js'));
  const cssFiles = walk(join(root, 'src', 'styles'), (file) => file.endsWith('.css'));

  for (const file of jsFiles) {
    const relativePath = toPosix(relative(root, file));
    const layer = layerOf(relativePath);
    const text = readFileSync(file, 'utf8');
    const lines = linesOf(text);

    if (layer === 'unknown') {
      add('file-placement', file, 1, 'a file in src/js belongs to domain|data|state|ui, or is main.js/config.js');
    }

    for (const { text: line, line: lineNumber } of lines) {
      if (/(?:^|[^\w.$])window\.[A-Za-z_$][\w$]*\s*=(?!=)/.test(line) ||
          /(?:^|[^\w.$])globalThis\.[A-Za-z_$][\w$]*\s*=(?!=)/.test(line)) {
        add('no-globals', file, lineNumber, 'assigning to a global; pass state through mount() instead');
      }
      if (/document\.documentElement/.test(line)) {
        // One exception, in the composition root only: <html lang> has to be on
        // the document root for assistive tech and hyphenation. Everything else
        // (style, class, data attributes) stays on the app root.
        const setsHtmlLang = layer === 'main' && /document\.documentElement\.lang\b/.test(line);
        if (!setsHtmlLang) {
          add('no-document-element', file, lineNumber, 'the document root is the host app\'s, not ours');
        }
      }
      if (/localStorage|sessionStorage|indexedDB/.test(line)) {
        add('no-device-storage', file, lineNumber, 'saving goes to the server; no device-only store (D-plan)');
      }
      if (layer !== 'data' && /\bfetch\s*\(|XMLHttpRequest|EventSource/.test(line)) {
        add('no-network-outside-data', file, lineNumber, `only js/data may talk to the network (this is ${layer ?? 'unknown'})`);
      }
      const importMatch = /(?:from\s+|import\s+)['"]([^'"]+)['"]/.exec(line);
      if (importMatch) {
        const specifier = importMatch[1];
        if (specifier.startsWith('.')) {
          const targetPath = toPosix(join(dirname(relativePath), specifier));
          const targetLayer = layerOf(targetPath);
          if (targetLayer === null) {
            add('import-outside-src', file, lineNumber, `import of ${specifier} leaves the component tree`);
          } else if (layer && !ALLOWED_IMPORTS[layer].includes(targetLayer) && targetLayer !== layer) {
            add(
              'import-direction',
              file,
              lineNumber,
              `${layer} must not import ${targetLayer} (allowed: ${ALLOWED_IMPORTS[layer].join(', ') || 'nothing'})`
            );
          }
        }
      }
    }

    if (lines.length > SIZE_CAPS.js) {
      add('file-size', file, 0, `${lines.length} lines exceeds the ${SIZE_CAPS.js}-line cap; split the component`);
    }
  }

  for (const file of cssFiles) {
    const relativePath = toPosix(relative(root, file));
    const raw = readFileSync(file, 'utf8');
    const text = stripCssComments(raw);
    const lines = linesOf(text);

    for (const { text: line, line: lineNumber } of lines) {
      // base.css is the global layer: it is the one place allowed to force a
      // declaration ([hidden], the visually-hidden utility, reduced motion).
      // Anywhere else !important means a selector fight.
      if (/!\s*important/.test(line) && relativePath !== 'src/styles/base.css') {
        add('css-no-important', file, lineNumber, '!important hides a specificity problem; fix the selector instead');
      }
      if (relativePath !== 'src/styles/tokens.css' && /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(line)) {
        add('css-no-color-literal', file, lineNumber, 'colour belongs in tokens.css');
      }
    }

    for (const match of text.matchAll(/([^{}]*)\{/g)) {
      const selector = match[1].trim();
      if (!selector || selector.startsWith('@') || selector.startsWith(':')) continue;
      const selectorWithoutAttributes = selector.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '');
      if (/#[A-Za-z][\w-]*/.test(selectorWithoutAttributes)) {
        const lineNumber = text.slice(0, match.index).split('\n').length;
        add('css-no-id-selector', file, lineNumber, `id selector in "${selector.slice(0, 60)}"; ids are for JS hooks only`);
      }
    }

    if (!(relativePath in SIZE_CAPS.exempt) && lines.length > SIZE_CAPS.css) {
      add('file-size', file, 0, `${lines.length} lines exceeds the ${SIZE_CAPS.css}-line cap; split the component`);
    }
  }

  return violations;
}

function main() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const root = rootIndex >= 0 ? args[rootIndex + 1] : fileURLToPath(new URL('..', import.meta.url));
  const violations = checkTree(root);

  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(violations, null, 2)}\n`);
  } else if (violations.length === 0) {
    console.log(`architecture: ok (${toPosix(root)})`);
  } else {
    for (const violation of violations) {
      const where = violation.line ? `${violation.file}:${violation.line}` : violation.file;
      console.error(`${where}  [${violation.rule}] ${violation.message}`);
    }
    console.error(`\narchitecture: ${violations.length} violation(s)`);
  }

  process.exit(violations.length === 0 ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
