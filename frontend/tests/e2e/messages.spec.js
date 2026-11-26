/**
 * Banner messages end to end.
 *
 * A super admin writes the one server message (admin overview) and a study
 * message (study page), a participant sees them as dismissible banners, a
 * dismissal survives a reload, and an edited text comes back to someone who
 * dismissed the previous version. The messages live in the deployment, so the
 * spec clears both before and after each test.
 */
import { test, expect } from '@playwright/test';
import { ORIGIN, STUDY, adminAuth, openDiary } from './helpers.js';

const ADMIN_BASE = `${ORIGIN}/tud_backend/admin`;
const API_BASE = `${ORIGIN}/tud_backend/api`;
const SERVER_MESSAGE_URL = `${API_BASE}/admin/messages/server`;
const STUDY_MESSAGE_URL = `${API_BASE}/admin/studies/${STUDY}/message`;

const PID = 'diary_01';

/** @returns {Record<string, string>} */
function adminHeaders() {
  const auth = adminAuth();
  const token = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

/** @param {import('@playwright/test').APIRequestContext} request */
async function clearMessages(request) {
  const headers = adminHeaders();
  const responses = [
    await request.put(SERVER_MESSAGE_URL, {
      headers,
      data: { text: {}, audience: 'participants', is_active: false },
    }),
    // The study message has no audience: its readers are its participants.
    await request.put(STUDY_MESSAGE_URL, {
      headers,
      data: { text: {}, is_active: false },
    }),
  ];
  for (const response of responses) {
    expect(response.ok(), await response.text()).toBeTruthy();
  }
}

/** @param {string} label */
function uniqueText(label) {
  return `${label} ${Date.now()}`;
}

/** @param {import('@playwright/test').Browser} browser */
async function adminPage(browser) {
  const context = await browser.newContext({ httpCredentials: adminAuth() });
  const page = await context.newPage();
  return { context, page };
}

test.describe('banner messages', () => {
  test.beforeEach(async ({ request }) => clearMessages(request));
  test.afterEach(async ({ request }) => clearMessages(request));

  test('a server message reaches a participant and returns after an edit', async ({
    page,
    browser,
  }) => {
    const admin = await adminPage(browser);
    const first = uniqueText('Maintenance tonight');
    const second = uniqueText('Maintenance moved');

    await admin.page.goto(ADMIN_BASE);
    const form = admin.page.locator('[data-message-form="server"]');
    await form.locator('[data-message-language="en"]').fill(first);
    await form.locator('[data-message-audience="participants"]').check();
    await form.locator('[data-message-audience="admins"]').check();
    await form.locator('[data-message-active]').check();
    await form.locator('#messageSaveBtn').click();
    await expect(form.locator('#messageStatus')).toContainText('live');

    // The participant sees it, dismisses it, and does not see it again.
    await openDiary(page, PID);
    const banner = page.locator('.t-message').first();
    await expect(banner).toContainText(first);
    await banner.locator('.t-message__close').click();
    await expect(page.locator('.t-message')).toHaveCount(0);

    await page.reload();
    await expect(page.locator('#days .t-timeline-day')).toHaveCount(7);
    await expect(page.locator('.t-message')).toHaveCount(0);

    // Editing the text produces a new message, so the dismissal no longer applies.
    await admin.page.reload();
    await form.locator('[data-message-language="en"]').fill(second);
    await form.locator('#messageSaveBtn').click();
    await expect(form.locator('#messageStatus')).toContainText('live');

    await page.reload();
    await expect(page.locator('.t-message').first()).toContainText(second);

    // The admin panel shows the same message (audience "both") and can dismiss it.
    await admin.page.reload();
    const adminBanner = admin.page.locator('.admin-message-banner');
    await expect(adminBanner).toContainText(second);
    await adminBanner.locator('.admin-message-banner-close').click();
    await expect(admin.page.locator('.admin-message-banner')).toHaveCount(0);
    await admin.page.reload();
    await expect(admin.page.locator('.admin-message-banner')).toHaveCount(0);

    await admin.context.close();
  });

  test('a study message reaches only that study and is switched off again', async ({
    page,
    browser,
  }) => {
    const admin = await adminPage(browser);
    const text = uniqueText('No diary tomorrow');

    await admin.page.goto(`${ADMIN_BASE}/study/${STUDY}/message`);
    const form = admin.page.locator('[data-message-form="study"]');
    // The fixture study is German-only; the form offers exactly its languages.
    await form.locator('[data-message-language]').first().fill(text);
    await form.locator('[data-message-active]').check();
    await form.locator('#messageSaveBtn').click();
    await expect(form.locator('#messageStatus')).toContainText('live');

    await openDiary(page, PID);
    await expect(page.locator('.t-message').first()).toContainText(text);

    // Switching it off removes the banner; a reload proves it is the server's
    // state and not a client-side dismissal.
    await admin.page.reload();
    await form.locator('[data-message-active]').uncheck();
    await form.locator('#messageSaveBtn').click();
    await expect(form.locator('#messageStatus')).toContainText('switched off');

    await page.reload();
    await expect(page.locator('#days .t-timeline-day')).toHaveCount(7);
    await expect(page.locator('.t-message')).toHaveCount(0);

    await admin.context.close();
  });
});
