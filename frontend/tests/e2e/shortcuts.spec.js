/**
 * The keyboard model in a browser (D31).
 *
 * `keyboard.test.js` pins which key resolves to which shortcut. What it cannot
 * pin is the effect and the confinement, and confinement is a WCAG 2.1.4
 * requirement: a single-key shortcut must not fire from a text field. `n`
 * opening a form while somebody types "nein" into the search box is exactly the
 * failure this spec exists for.
 *
 * The shortcuts are aimed at a fine pointer, so the desktop projects own this and
 * one test proves a phone gets none of it.
 */
import { test, expect } from '@playwright/test';
import { chooseActivity, isPhone, openDiary } from './helpers.js';

const PID = 'diary_02';

/** @param {import('@playwright/test').Page} page */
function searchBox(page) {
  return page.locator('#panel-host input[type="search"]');
}

/** @param {import('@playwright/test').Page} page */
async function currentDayIndex(page) {
  const current = page.locator('.t-rail__row[aria-current="true"]');
  return Number(await current.getAttribute('data-day-index'));
}

/**
 * Put focus inside the diary region without opening anything: the day rail is a
 * navigation list, so focusing it is not a click that creates an activity.
 *
 * @param {import('@playwright/test').Page} page
 */
async function focusDiary(page) {
  await page.locator('.t-rail__row').first().focus();
}

test.describe('keyboard shortcuts', () => {
  test('paging moves the day, even without focus in the diary', async ({ page }) => {
    test.skip(isPhone(test.info()), 'shortcuts need a fine pointer');
    await openDiary(page, PID);
    expect(await currentDayIndex(page)).toBe(0);

    // Nothing is focused yet, so this is the body. Paging is not a single-key
    // shortcut, which is why it is allowed outside the diary region.
    await page.keyboard.press('PageDown');
    await expect.poll(() => currentDayIndex(page)).toBe(1);
    await expect(page.locator('#day-label')).toHaveText('Dienstag');

    await page.keyboard.press('PageUp');
    await expect.poll(() => currentDayIndex(page)).toBe(0);
    await expect(page.locator('#day-label')).toHaveText('Montag');
  });

  test('/ is confined to the diary and dead while typing', async ({ page }) => {
    test.skip(isPhone(test.info()), 'shortcuts need a fine pointer');
    await openDiary(page, PID);

    // Body focus: the region rule keeps the key away from the panel.
    await page.keyboard.press('/');
    await expect(searchBox(page)).not.toBeFocused();

    await focusDiary(page);
    await page.keyboard.press('/');
    await expect(searchBox(page)).toBeFocused();

    // Typing is the participant's own business (WCAG 2.1.4), so the other
    // single-key shortcut must not fire from inside the field.
    await page.keyboard.type('n');
    await expect(page.locator('#form-start')).toHaveCount(0);
    await expect(searchBox(page)).toHaveValue('n');
  });

  test('n opens the add form for the day in view', async ({ page }) => {
    test.skip(isPhone(test.info()), 'shortcuts need a fine pointer');
    await openDiary(page, PID);

    // Move to the second day first, so this also proves the shortcut uses the
    // current day rather than always the first. The arrows in the top bar are
    // phone-only (desktop has the rail), so the paging key is the way there.
    await page.keyboard.press('PageDown');
    await expect.poll(() => currentDayIndex(page)).toBe(1);

    await focusDiary(page);
    await page.keyboard.press('n');
    // `n` is the floating button's action: it opens the panel to add an activity
    // at the visible time, so the form appears as soon as one is chosen.
    await chooseActivity(page, 1101);
    await expect(page.locator('#form-day')).toHaveValue('1');
    await expect(page.locator('#form-start')).toBeVisible();
  });

  test('? lists the shortcuts and Escape closes the list', async ({ page }) => {
    test.skip(isPhone(test.info()), 'shortcuts need a fine pointer');
    await openDiary(page, PID);

    await focusDiary(page);
    await page.keyboard.press('?');

    const list = page.locator('#shortcuts-dialog');
    await expect(list).toHaveAttribute('open', '');
    await expect(page.locator('#shortcuts-title')).toBeVisible();
    // The list is the only onboarding there is (D31), so it has to name them.
    await expect(list).toContainText('PageDown');

    await page.keyboard.press('Escape');
    await expect(list).not.toHaveAttribute('open', '');
  });

  test('a phone with no fine pointer gets none of it', async ({ page }) => {
    test.skip(!isPhone(test.info()), 'this is the phone case');
    await openDiary(page, PID);

    await expect(page.locator('#day-label')).toHaveText('Montag');
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(300);
    await expect(page.locator('#day-label')).toHaveText('Montag');
  });
});
