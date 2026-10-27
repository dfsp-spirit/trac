import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkTree, layerOf, SIZE_CAPS } from '../../tools/check-architecture.mjs';

const REPO_FRONTEND_NEW = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Build a throwaway tree and run the checker over it.
 *
 * @param {Record<string, string>} files Paths relative to the root, e.g. 'src/js/ui/a.js'.
 * @param {(violations: ReturnType<typeof checkTree>) => void} assertOn
 */
function withTree(files, assertOn) {
  const root = mkdtempSync(join(tmpdir(), 'trac-arch-'));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const full = join(root, relativePath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    assertOn(checkTree(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** @param {ReturnType<typeof checkTree>} violations @param {string} rule */
function rules(violations) {
  return violations.map((violation) => violation.rule).sort();
}

test('the real tree has no architecture violations', () => {
  assert.deepEqual(checkTree(REPO_FRONTEND_NEW), []);
});

test('layerOf maps the component tree and rejects loose files', () => {
  assert.equal(layerOf('src/js/domain/geometry.js'), 'domain');
  assert.equal(layerOf('src/js/data/i18n.js'), 'data');
  assert.equal(layerOf('src/js/state/store.js'), 'state');
  assert.equal(layerOf('src/js/ui/timeline/timeline.js'), 'ui');
  assert.equal(layerOf('src/js/main.js'), 'main');
  assert.equal(layerOf('src/js/config.js'), 'config');
  assert.equal(layerOf('src/js/rogue.js'), 'unknown');
  assert.equal(layerOf('src/styles/tokens.css'), null);
});

test('a component may import the domain but not the data layer', () => {
  withTree(
    {
      'src/js/ui/a.js': "import { coverageMinutes } from '../domain/geometry.js';\nimport { api } from '../data/api.js';\n",
      'src/js/domain/geometry.js': 'export const coverageMinutes = () => 0;\n',
      'src/js/data/api.js': 'export const api = {};\n',
    },
    (violations) => {
      assert.deepEqual(rules(violations), ['import-direction']);
      assert.match(violations[0].message, /ui must not import data/);
    }
  );
});

test('the domain may not import anything above it', () => {
  withTree(
    {
      'src/js/domain/a.js': "import { x } from '../state/store.js';\n",
      'src/js/state/store.js': 'export const x = 1;\n',
    },
    (violations) => assert.deepEqual(rules(violations), ['import-direction'])
  );
});

test('only main.js may import the data and state layers', () => {
  withTree(
    {
      'src/js/main.js': "import { api } from './data/api.js';\nimport { store } from './state/store.js';\n",
      'src/js/data/api.js': 'export const api = {};\n',
      'src/js/state/store.js': 'export const store = {};\n',
    },
    (violations) => assert.deepEqual(violations, [])
  );
});

test('an import that leaves the component tree is reported', () => {
  withTree(
    {
      'src/js/ui/a.js': "import i18n from '../../../frontend/src/js/i18n.js';\n",
    },
    (violations) => assert.deepEqual(rules(violations), ['import-outside-src'])
  );
});

test('assigning to a global is reported, reading one is not', () => {
  withTree(
    {
      'src/js/ui/a.js': 'window.state = {};\nglobalThis.other = 1;\nconst s = window.location.pathname;\n',
    },
    (violations) => assert.deepEqual(rules(violations), ['no-globals', 'no-globals'])
  );
});

test('writing to the document root is reported', () => {
  withTree(
    { 'src/js/ui/a.js': "document.documentElement.style.setProperty('--x', '1px');\n" },
    (violations) => assert.deepEqual(rules(violations), ['no-document-element'])
  );
});

test('device storage is reported anywhere in js', () => {
  withTree(
    {
      'src/js/state/store.js': "localStorage.setItem('draft', '{}');\n",
      'src/js/data/api.js': "sessionStorage.getItem('x');\nindexedDB.open('db');\n",
    },
    (violations) => assert.deepEqual(rules(violations), ['no-device-storage', 'no-device-storage', 'no-device-storage'])
  );
});

test('network access outside the data layer is reported', () => {
  withTree(
    {
      'src/js/ui/a.js': "fetch('/api/x');\n",
      'src/js/data/api.js': "fetch('/api/x');\n",
    },
    (violations) => assert.deepEqual(rules(violations), ['no-network-outside-data'])
  );
});

test('a file in src/js with no layer is reported', () => {
  withTree({ 'src/js/rogue.js': 'export const x = 1;\n' }, (violations) =>
    assert.deepEqual(rules(violations), ['file-placement'])
  );
});

test('the js and css line caps are enforced, with the vendored bundle exempt', () => {
  const longJs = 'const a = 1;\n'.repeat(SIZE_CAPS.js + 1);
  const longCss = '.t-a { color: var(--ink); }\n'.repeat(SIZE_CAPS.css + 1);
  withTree(
    {
      'src/js/ui/a.js': longJs,
      'src/styles/panel.css': longCss,
      'src/styles/components.css': longCss,
    },
    (violations) => {
      assert.deepEqual(rules(violations), ['file-size', 'file-size']);
      assert.ok(violations.every((violation) => !violation.file.includes('components.css')));
    }
  );
});

test('!important is only allowed in the global layer', () => {
  withTree(
    {
      'src/styles/base.css': '[hidden] { display: none !important; }\n',
      'src/styles/panel.css': '.t-a { display: none !important; }\n',
    },
    (violations) => {
      assert.deepEqual(rules(violations), ['css-no-important']);
      assert.equal(violations[0].file, 'src/styles/panel.css');
    }
  );
});

test('colour literals are only allowed in tokens.css', () => {
  withTree(
    {
      'src/styles/tokens.css': ':root { --ink: #111111; --line: rgba(0, 0, 0, 0.5); }\n',
      'src/styles/panel.css': '.t-a { border-color: #d4d4d4; }\n.t-b { background: rgba(0, 0, 0, 0.2); }\n',
    },
    (violations) => assert.deepEqual(rules(violations), ['css-no-color-literal', 'css-no-color-literal'])
  );
});

test('id selectors are reported and attribute selectors with # are not', () => {
  withTree(
    {
      'src/styles/panel.css': '#panel-host { display: block; }\n.t-a[href^="#"] { color: var(--ink); }\n',
    },
    (violations) => {
      assert.deepEqual(rules(violations), ['css-no-id-selector']);
      assert.match(violations[0].message, /#panel-host/);
    }
  );
});
