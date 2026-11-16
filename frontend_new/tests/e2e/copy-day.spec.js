/**
 * Copying a day (D18, D19): the per-day button in a day heading, the rail's
 * general entry, the target chips, the overwrite preview and the undo.
 *
 * The copy overwrites a target's own entries, so the assertions are about what
 * the target holds afterwards, not about what the toast says.
 */
import { test, expect } from '@playwright/test';
import {
  addSchlafen,
  clearActivities,
  dayEvents,
  isPhone,
  openDiary,
} from './helpers.js';

test.describe('copying a day', () => {
  const pid = 'diary_01';

  test.beforeEach(async ({ request }) => clearActivities(request, pid));
  test.afterEach(async ({ request }) => clearActivities(request, pid));

  test('a day heading copies its entries onto an empty day', async ({ page }) => {
    await openDiary(page, pid);
    await addSchlafen(page, { start: 600, end: 660 });
    await expect(dayEvents(page, 0)).toHaveCount(1);

    await page
      .locator('#days .t-timeline-day[data-day-index="0"] [data-copy-day]')
      .click();

    const dialog = page.locator('#copy-day-dialog');
    await expect(dialog).toBeVisible();
    // The source is a receipt above the grid, not a chip among the targets.
    await expect(dialog.locator('.t-copy-source__name')).toHaveText('Montag');
    await expect(dialog.locator('.t-copy-source')).toContainText('1 Eintrag');

    // The source chip is present for the week's shape but cannot be a target.
    await expect(dialog.locator('.t-day-chip input').first()).toBeDisabled();

    // Nothing is ticked yet, and the button says so.
    await expect(dialog.locator('[data-slot="copy-submit"]')).toBeDisabled();
    await expect(dialog.locator('[data-slot="copy-hint"]')).toHaveText(
      'Wähle einen oder mehrere Tage.'
    );

    await dialog.locator('.t-day-chip input[name="days"][value="2"]').check();
    await expect(dialog.locator('[data-slot="copy-submit"]')).toBeEnabled();
    await expect(dialog.locator('[data-slot="copy-submit"]')).toHaveText('Kopieren');

    await dialog.locator('[data-slot="copy-submit"]').click();

    await expect(dialog).toBeHidden();
    await expect(dayEvents(page, 2)).toHaveCount(1);
    await expect(dayEvents(page, 2).locator('.t-event__time')).toHaveText(
      /10:00\s*–\s*11:00/
    );
    await expect(page.locator('.t-toast')).toContainText('Nach Mittwoch kopiert');

    await page.reload();
    await expect(dayEvents(page, 2)).toHaveCount(1);
  });

  test('copying onto a filled day replaces it instead of adding to it', async ({ page }) => {
    await openDiary(page, pid);
    await addSchlafen(page, { start: 600, end: 660 });
    await addSchlafen(page, { start: 480, end: 540, day: 2 });
    await expect(dayEvents(page, 2)).toHaveCount(1);

    await page
      .locator('#days .t-timeline-day[data-day-index="0"] [data-copy-day]')
      .click();

    const dialog = page.locator('#copy-day-dialog');
    await dialog.locator('.t-day-chip input[name="days"][value="2"]').check();

    // The day that loses entries is named with what it loses, the empty ones are not.
    await expect(dialog.locator('[data-slot="copy-hint"]')).toHaveText(
      'Wird überschrieben: Mittwoch (1 Eintrag)'
    );
    await expect(dialog.locator('[data-slot="copy-submit"]')).toHaveText(
      'Kopieren und ersetzen'
    );

    await dialog.locator('[data-slot="copy-submit"]').click();
    await expect(dialog).toBeHidden();

    // Still one entry, now the copied one - an overwrite, not a merge.
    await expect(dayEvents(page, 2)).toHaveCount(1);
    await expect(dayEvents(page, 2).locator('.t-event__time')).toHaveText(
      /10:00\s*–\s*11:00/
    );
  });

  test('the undo puts the replaced entries back', async ({ page }) => {
    await openDiary(page, pid);
    await addSchlafen(page, { start: 600, end: 660 });
    await addSchlafen(page, { start: 480, end: 540, day: 2 });

    await page
      .locator('#days .t-timeline-day[data-day-index="0"] [data-copy-day]')
      .click();
    await page
      .locator('#copy-day-dialog .t-day-chip input[name="days"][value="2"]')
      .check();
    await page.locator('#copy-day-dialog [data-slot="copy-submit"]').click();

    await expect(dayEvents(page, 2).locator('.t-event__time')).toHaveText(
      /10:00\s*–\s*11:00/
    );

    await page.locator('.t-toast__action').click();

    // The copy is gone and the original 08:00-09:00 entry is back.
    await expect(dayEvents(page, 2)).toHaveCount(1);
    await expect(dayEvents(page, 2).locator('.t-event__time')).toHaveText(
      /08:00\s*–\s*09:00/
    );
  });

  test('an empty day keeps its button and says why', async ({ page }) => {
    await openDiary(page, pid);
    // One filled day, so this is about the *day*, not about the whole diary.
    await addSchlafen(page, { start: 600, end: 660 });

    const button = page.locator('#days .t-timeline-day[data-day-index="1"] [data-copy-day]');
    // `aria-disabled`, not `disabled`: the button stays focusable and announced,
    // so the feature does not disappear for keyboard users. Its reason is a
    // description, not a `title` (which no phone and no focus ring ever shows).
    // Playwright treats it as disabled, hence the forced click.
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toHaveAccessibleDescription('Es gibt noch nichts zu kopieren.');

    await button.click({ force: true });
    await expect(page.locator('#copy-day-dialog')).toBeHidden();
    await expect(page.locator('.t-toast')).toContainText('Es gibt noch nichts zu kopieren.');
  });

  test('the empty rail explains itself in place, before the click', async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), 'the rail is a desktop column (D12)');
    await openDiary(page, pid);

    const rail = page.locator('#copy-days');
    await expect(rail).toHaveAttribute('aria-disabled', 'true');
    await expect(rail).toHaveAccessibleDescription('Es gibt noch nichts zu kopieren.');
    await expect(page.locator('#copy-days-hint')).toBeVisible();

    // Inert, but answered instead of swallowed.
    await rail.click({ force: true });
    await expect(page.locator('#copy-day-dialog')).toBeHidden();
    await expect(page.locator('.t-toast')).toContainText('Es gibt noch nichts zu kopieren.');
  });

  test('the menu entry explains an empty diary instead of a dead end', async ({ page }) => {
    // The phone has no rail, so this is its way in; on desktop it must behave the
    // same rather than three entry points with three answers.
    await openDiary(page, pid);

    await page.locator('#menu-open').click();
    await page.locator('#menu-copy').click();
    await expect(page.locator('#copy-day-dialog')).toBeHidden();
    await expect(page.locator('.t-toast')).toContainText('Es gibt noch nichts zu kopieren.');
  });

  test('the rail opens the dialog without a source and asks for one', async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), 'the rail is a desktop column (D12)');
    await openDiary(page, pid);
    await addSchlafen(page, { start: 600, end: 660 });

    await expect(page.locator('#copy-days-hint')).toBeHidden();
    await page.locator('#copy-days').click();

    const dialog = page.locator('#copy-day-dialog');
    await expect(dialog).toBeVisible();
    // The day in view has entries, so it is the source; a day without entries
    // leaves the select open instead.
    await expect(dialog.locator('#copy-source-day')).toHaveCount(0);
    await expect(dialog.locator('.t-copy-source__name')).toHaveText('Montag');
  });
});
