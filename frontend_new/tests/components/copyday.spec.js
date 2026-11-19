/**
 * `ui/copyDayDialog.js` on a fixture page (D33 rule 8).
 *
 * The target grid is seven chips; the shortcuts are the one-click answer to
 * "copy this onto every work day" / "onto the weekend". These tests pin that a
 * preset replaces the selection (not adds to it), never selects the source day,
 * updates the chip state the same way a tap does, and disappears when the
 * study's day names cannot be classified.
 */
import { test, expect } from '@playwright/test';

const DIALOG = '#copy-day-dialog';

/** @param {import('@playwright/test').Page} page */
async function checkedDays(page) {
  return page
    .locator(`${DIALOG} .t-day-chip input:checked`)
    .evaluateAll((nodes) => nodes.map((node) => Number(/** @type {HTMLInputElement} */ (node).value)));
}

test.beforeEach(async ({ page }) => {
  await page.goto('copyday.html');
});

test('work days and the weekend are one click each, and replace the selection', async ({
  page,
}) => {
  const dialog = page.locator(DIALOG);
  await expect(dialog).toBeVisible();

  const group = dialog.locator('.t-days__shortcuts');
  await expect(group).toHaveAttribute('role', 'group');
  await expect(group).toContainText('Schnellauswahl');

  // Monday is the source, so "all work days" is Tuesday to Friday.
  await group.getByRole('button', { name: 'Alle Werktage' }).click();
  await expect.poll(() => checkedDays(page)).toEqual([1, 2, 3, 4]);
  await expect(dialog.locator('[data-slot="copy-submit"]')).toBeEnabled();
  // The chip look follows the input, exactly as if it had been tapped.
  await expect(dialog.locator('.t-day-chip:has(input[value="1"])')).toHaveClass(
    /t-day-chip--checked/
  );

  // The second preset replaces the first one instead of adding to it.
  await group.getByRole('button', { name: 'Wochenende' }).click();
  await expect.poll(() => checkedDays(page)).toEqual([5, 6]);
  await expect(dialog.locator('.t-day-chip:has(input[value="1"])')).not.toHaveClass(
    /t-day-chip--checked/
  );
});

test('a study with custom day names gets no shortcut section', async ({ page }) => {
  await page.goto('copyday.html?custom=1');

  const dialog = page.locator(DIALOG);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.t-days__shortcuts')).toHaveCount(0);
  // The chips are still there; only the guess is withheld.
  await expect(dialog.locator('.t-day-chip')).toHaveCount(7);
});
