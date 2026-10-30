/**
 * The drawer menu (D28, D40, D41): what it offers depends on the study, and it
 * must not offer something that cannot do anything.
 *
 * Every shipped rewrite fixture is single-language (`supported_languages: [de]`),
 * so the language entry has to be absent here: a select with one option is
 * clutter and invites a reload that changes nothing. `offersLanguageChoice` in
 * `domain/language.js` pins the rule itself; the multi-language branch of the
 * wiring is the same three lines.
 */
import { test, expect } from '@playwright/test';
import { openDiary } from './helpers.js';

test.describe('drawer menu', () => {
  test('a single-language study has no language entry', async ({ page }) => {
    await openDiary(page, 'diary_02');
    await page.locator('.t-topbar [popovertarget="menu"]').click();
    await expect(page.locator('#menu')).toBeVisible();

    await expect(page.locator('#menu-language-block')).toBeHidden();
    await expect(page.locator('#language-select')).toBeHidden();

    // Nothing is left dangling either: the separator above the language entry
    // lives inside the hidden block, so no visible rule ends the menu.
    const lastVisibleTag = await page.evaluate(() => {
      const menu = document.getElementById('menu');
      const visible = [...(menu?.children ?? [])].filter(
        (node) => node instanceof HTMLElement && !node.hidden
      );
      return visible.at(-1)?.tagName ?? null;
    });
    expect(lastVisibleTag).not.toBe('HR');
  });

  test('a study that can skip offers the entry, one that cannot does not', async ({ page }) => {
    await openDiary(page, 'diary_02');
    await page.locator('.t-topbar [popovertarget="menu"]').click();
    // `newui_06_diary` sets allow_skip_timeuse: false, so a button that ends the
    // diary part of the study must not be there (D41).
    await expect(page.locator('#menu-skip-item')).toBeHidden();
  });
});
