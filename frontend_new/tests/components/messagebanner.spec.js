/**
 * `ui/messageBanner.js` on a fixture page (D33 rule 8).
 *
 * The banners sit above the app shell in normal flow, so no sticky offset has
 * to know about them; what the tests pin is the order (server first), that the
 * text stays plain text with real line breaks, and that dismissing removes one
 * banner - and only that one - while remembering its opaque key.
 */
import { test, expect } from '@playwright/test';

const banner = '[data-message-stack] .t-message';

test('both messages render, server first', async ({ page }) => {
  await page.goto('messagebanner.html');

  const banners = page.locator(banner);
  await expect(banners).toHaveCount(2);
  await expect(banners.nth(0)).toContainText('Maintenance tonight');
  await expect(banners.nth(1)).toContainText('No diary tomorrow');

  // The stack is the first thing in the app, above the top bar.
  await expect(page.locator('#app > [data-message-stack]')).toHaveCount(1);

  // Plain text: the newline is a line break, not markup.
  const text = await banners.nth(0).locator('.t-message__text').textContent();
  expect(text).toBe('Maintenance tonight\n22:00-23:00');
  await expect(banners.nth(0).locator('.t-message__text strong')).toHaveCount(0);
});

test('the close button is labelled for assistive tech', async ({ page }) => {
  await page.goto('messagebanner.html');

  await expect(page.locator(banner).nth(0).locator('.t-message__close')).toHaveAttribute(
    'aria-label',
    'Dismiss this message'
  );
  await expect(page.locator(banner).nth(0)).toHaveAttribute('role', 'status');
});

test('dismissing one banner removes only that banner and remembers its key', async ({
  page,
}) => {
  await page.goto('messagebanner.html');

  await page.locator(banner).nth(0).locator('.t-message__close').click();

  const banners = page.locator(banner);
  await expect(banners).toHaveCount(1);
  await expect(banners.nth(0)).toContainText('No diary tomorrow');

  const remembered = await page.evaluate(() => window.__banners.dismissed.has('srv-1'));
  expect(remembered).toBe(true);
});

test('dismissing the last banner removes the stack', async ({ page }) => {
  await page.goto('messagebanner.html');

  await page.locator(banner).nth(0).locator('.t-message__close').click();
  await page.locator(banner).nth(0).locator('.t-message__close').click();

  await expect(page.locator('[data-message-stack]')).toHaveCount(0);
});

test('a dismissed message stays gone on reload', async ({ page }) => {
  await page.goto('messagebanner.html?dismissed=srv-1');

  const banners = page.locator(banner);
  await expect(banners).toHaveCount(1);
  await expect(banners.nth(0)).toContainText('No diary tomorrow');
});

test('no visible message means no stack at all', async ({ page }) => {
  await page.goto('messagebanner.html?studyOff&dismissed=srv-1');

  await expect(page.locator('[data-message-stack]')).toHaveCount(0);
});
