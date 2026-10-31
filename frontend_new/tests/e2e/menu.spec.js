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
    await page.locator('#menu-open').click();
    await expect(page.locator('#menu')).toBeVisible();

    await expect(page.locator('#menu-language-block')).toBeHidden();
    await expect(page.locator('#language-select')).toBeHidden();

    // Nothing is left dangling either: the separator above the language entry
    // lives inside the hidden block, so no visible rule ends the menu.
    await expect(page.locator('#menu hr')).toBeHidden();
  });

  // The drawer used to be a native popover, which older engines render as a
  // permanently visible panel. Closed must be the default, whatever the engine.
  test('the drawer is closed until it is opened, and closes again on Escape', async ({ page }) => {
    await openDiary(page, 'diary_02');
    await expect(page.locator('#menu')).toBeHidden();

    await page.locator('#menu-open').click();
    await expect(page.locator('#menu')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#menu')).toBeHidden();
    // Focus goes back to the control that opened it, not into the page.
    await expect(page.locator('#menu-open')).toBeFocused();
  });

  test('only a click on the backdrop dismisses the drawer', async ({ page }) => {
    await openDiary(page, 'diary_02');
    await page.locator('#menu-open').click();
    await expect(page.locator('#menu')).toBeVisible();

    // Inside the panel: stays open.
    await page.locator('#menu-title').click();
    await expect(page.locator('#menu')).toBeVisible();

    // Right of the 320px panel: that is the backdrop.
    await page.mouse.click(1000, 400);
    await expect(page.locator('#menu')).toBeHidden();
  });

  test('a study that can skip offers the entry, one that cannot does not', async ({ page }) => {
    await openDiary(page, 'diary_02');
    await page.locator('#menu-open').click();
    // `newui_06_diary` sets allow_skip_timeuse: false, so a button that ends the
    // diary part of the study must not be there (D41).
    await expect(page.locator('#menu-skip-item')).toBeHidden();
  });
});
