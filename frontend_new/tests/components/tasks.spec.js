/**
 * `views/tasks.js` on a fixture page (D33 rule 8, D37).
 *
 * The e2e spec proves the flow; this one proves the view's own contract: an open
 * task is a link, a confirmed task is not, a locked one shows the reason the
 * server gave and never a link, and "check again" is disabled while it is in
 * flight so a nervous participant cannot fire it twice.
 */
import { test, expect } from '@playwright/test';

test.describe('tasks view', () => {
  test('an open task is a link to the launch endpoint', async ({ page }) => {
    await page.goto('tasks.html');

    await expect(page.locator('.t-task')).toHaveCount(1);
    await expect(page.locator('.t-task__name')).toHaveText('Fixture: Umfrage ausfüllen');
    await expect(page.locator('.t-task__hint')).toHaveText('Externe Aufgabe für den Test.');
    await expect(page.locator('.t-task a.t-btn')).toHaveAttribute(
      'href',
      '/tud_backend/api/studies/demo/external-tasks/launch?token=fixture-token'
    );
    await expect(page.locator('.t-task__done')).toHaveCount(0);
  });

  test('a confirmed task is a checkmark, not a link', async ({ page }) => {
    await page.goto('tasks.html?confirmed=1');

    await expect(page.locator('.t-task__done')).toHaveCount(1);
    await expect(page.locator('.t-task a.t-btn')).toHaveCount(0);
    await expect(page.locator('.t-task__done svg')).toHaveCount(1);
  });

  test('a level-locked task says why and offers no link', async ({ page }) => {
    // Level n + 1 opens only once every task of level n is confirmed; the server
    // decides that and sends `locked_reason`.
    await page.goto('tasks.html?lock=level');

    await expect(page.locator('.t-task')).toHaveCount(1);
    await expect(page.locator('.t-task a.t-btn')).toHaveCount(0);
    await expect(page.locator('.t-task__locked svg')).toHaveCount(1);
    await expect(page.locator('.t-task__locked')).toHaveText(
      'Verfügbar, sobald die vorherigen Aufgaben erledigt sind.'
    );
    await expect(page.locator('.t-task__done')).toHaveCount(0);
  });

  test('a diary-locked task says the diary has to be submitted first', async ({ page }) => {
    // The reason a payment task waits: nothing may be opened before the diary is
    // handed in, even though the participant is already on this page.
    await page.goto('tasks.html?lock=diary');

    await expect(page.locator('.t-task a.t-btn')).toHaveCount(0);
    await expect(page.locator('.t-task__locked')).toHaveText(
      'Verfügbar, sobald Ihr Tagebuch abgeschickt ist.'
    );
  });

  test('the hint line disappears with the description', async ({ page }) => {
    await page.goto('tasks.html?description=0');

    await expect(page.locator('.t-task')).toHaveCount(1);
    await expect(page.locator('.t-task__hint')).toHaveCount(0);
  });

  test('checking again disables the button while it runs', async ({ page }) => {
    await page.goto('tasks.html');

    const again = page.getByRole('button', { name: 'Erneut prüfen' });
    await again.click();
    await expect(again).toBeDisabled();
    await expect(again).toBeEnabled();

    expect(await page.evaluate(() => window.__refreshes)).toBe(1);
  });

  test('a failed refresh still re-enables the button', async ({ page }) => {
    await page.goto('tasks.html?fail=1');

    const again = page.getByRole('button', { name: 'Erneut prüfen' });
    await again.click();
    await expect(page.locator('.t-page__actions')).toBeVisible();
    // The view re-throws after the finally block; the button must not stay dead.
    await expect(again).toBeEnabled();
  });

  test('is a page frame with a lead and one action', async ({ page }) => {
    await page.goto('tasks.html');

    await expect(page.locator('.t-page__title')).toHaveText('Noch ein Schritt');
    await expect(page.locator('.t-page__lead')).toHaveText(
      'Das Forschungsteam braucht dies, um Ihre Teilnahme abzuschließen.'
    );
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('.t-page__actions button')).toHaveCount(1);
  });
});
