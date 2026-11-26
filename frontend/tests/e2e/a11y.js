/**
 * The accessibility gate (WCAG 2.0 / 2.1 / 2.2, level A + AA).
 *
 * axe-core is the rule engine; `@axe-core/playwright` only wires it to a live
 * page, which is the point - the rules need the real CSS (contrast), the real
 * accessibility tree (landmarks, names) and the real state (an open dialog, a
 * phone-width panel that is a modal rather than a column).
 *
 * Deliberately **not** the component fixtures: those pages load no stylesheet, so
 * anything about colour, visibility or "is this text rendered at all" would be a
 * guess. They exist to pin behaviour, not to certify a page.
 *
 * `best-practice` rules are out of the gate. The one that would fire here is
 * `region` - the floating "add activity" button and the toast region sit outside
 * a landmark - and that is a structural decision about a fixed-position control,
 * not a conformance failure.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import { ALLOWED_VIOLATIONS } from './a11y-allowlist.js';

/** WCAG A + AA across the three versions axe knows about. */
export const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** @typedef {{ id: string, impact?: string | null, nodes: any[] }} Violation */

/**
 * One line per violation, plus the failing nodes, because "1 violation" without
 * the selector costs ten minutes of searching.
 *
 * @param {Violation[]} violations
 * @returns {string}
 */
export function formatViolations(violations) {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .slice(0, 5)
        .map((node) => {
          const target = Array.isArray(node.target) ? node.target.join(' ') : String(node.target);
          const summary = String(node.failureSummary || '')
            .split('\n')
            .filter(Boolean)
            .join(' / ');
          return `      ${target}\n        ${summary}`;
        })
        .join('\n');
      const more =
        violation.nodes.length > 5 ? `\n      … and ${violation.nodes.length - 5} more` : '';
      return `  - ${violation.id} (${violation.impact ?? 'unknown'}) ×${violation.nodes.length}\n${nodes}${more}`;
    })
    .join('\n');
}

/**
 * @param {string} id
 * @returns {{ reason: string, maxNodes: number } | undefined}
 */
function allowance(id) {
  return /** @type {any} */ (ALLOWED_VIOLATIONS)[id];
}

/**
 * Run the gate on whatever is on screen now.
 *
 * A finding is only tolerated when it is listed in `a11y-allowlist.js`, and only
 * up to the number of nodes recorded there - so a rule that starts leaking into a
 * second component still fails the build instead of hiding behind an old entry.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} label Human-readable name of the surface, used in the failure.
 */
export async function expectNoA11yViolations(page, label) {
  const results = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();

  /** @type {Violation[]} */
  const unexpected = [];
  /** @type {string[]} */
  const tolerated = [];

  for (const violation of results.violations) {
    const allowed = allowance(violation.id);
    if (allowed && violation.nodes.length <= allowed.maxNodes) {
      tolerated.push(`${violation.id} ×${violation.nodes.length} (known: ${allowed.reason})`);
      continue;
    }
    unexpected.push(violation);
  }

  if (tolerated.length) {
    // Printed, not just dropped: an allowlist that nobody reads becomes permanent.
    console.log(`[a11y] ${label}: tolerated ${tolerated.join('; ')}`);
  }

  expect(
    unexpected,
    `\nWCAG A/AA violations on "${label}":\n${formatViolations(unexpected)}\n`
  ).toEqual([]);
}
