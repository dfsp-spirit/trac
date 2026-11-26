/**
 * The opt-in inactivity timeout: a static menu note, an invisible timer, and a
 * standalone timeout page that never carries the invitation identity.
 */
import { test, expect } from '@playwright/test';
import { BASE_URL, openDiary } from './helpers.js';

const TIMED_STUDY = 'pilot_mpiae_01_open';
const UNTIMED_STUDY = 'newui_06_diary';

test('shows a static note and redirects after the configured inactivity period', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto(`${BASE_URL}?study=${TIMED_STUDY}&pid=timeout_e2e_01&lang=de`);
  await expect(page.locator('#menu-open')).toBeVisible();

  await page.locator('#menu-open').click();
  const note = page.locator('#session-note');
  await expect(note).toBeVisible();
  await expect(note).toHaveText(/20 Minuten/);
  await page.locator('#menu-close').click();

  await page.clock.fastForward(20 * 60 * 1000);

  await expect(page).toHaveURL(/\/report\/timeout\.html/);
  await expect(page.locator('h1')).toHaveText('Ihre Sitzung wurde beendet');
  await expect(page.locator('[data-timeout-body]')).toContainText(
    'Ihre Sitzung wurde beendet, weil Sie zu lange inaktiv waren.'
  );

  const url = new URL(page.url());
  expect(url.searchParams.get('study')).toBeNull();
  expect(url.searchParams.get('pid')).toBeNull();
  expect(url.searchParams.get('lang')).toBe('de');
  await expect(page.locator('a')).toHaveCount(0);
});

test('explains that cookies are required when the session cannot be stored', async ({
  page,
}) => {
  await page.route('**/session', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ active: true, timeout_minutes: 20 }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto(
    `${BASE_URL}?study=${TIMED_STUDY}&pid=timeout_cookie_01&lang=de`
  );
  await expect(page.locator('.t-page__title')).toHaveText('Cookies erforderlich');
  await expect(page.locator('.t-page__lead')).toContainText(
    'benötigt Browser-Cookies'
  );
  await expect(page.locator('.t-page__actions button')).toHaveText(
    'Erneut versuchen'
  );
});

test('the timeout page is standalone and contains no invitation link', async ({
  page,
}) => {
  await page.goto(`${BASE_URL}timeout.html?lang=en`);
  await expect(page.locator('h1')).toHaveText('Your session has ended');
  await expect(page.locator('[data-timeout-body]')).toContainText(
    'You were inactive for a while'
  );
  await expect(page.locator('a')).toHaveCount(0);
});

test('a study without a timeout never redirects and shows no note', async ({
  page,
}) => {
  await page.clock.install();
  await openDiary(page, 'diary_01', UNTIMED_STUDY);

  await page.locator('#menu-open').click();
  await expect(page.locator('#session-note')).toBeHidden();
  await page.locator('#menu-close').click();

  await page.clock.fastForward(60 * 60 * 1000);
  await expect(page).toHaveURL(new RegExp(`study=${UNTIMED_STUDY}`));
  await expect(page.locator('#days .t-timeline-day')).toHaveCount(7);
});
