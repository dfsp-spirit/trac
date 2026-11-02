/**
 * The `unavailable` stage (D39): the study is not collecting, and the page says
 * which of the three situations it is and - where there is one - the date.
 *
 * This is the part of the stage machine the other specs never touch. They all
 * start from an open study, so nothing proved that a closed one renders its own
 * copy instead of falling through to the generic sentence, and nothing proved
 * that the rewrite asks for `include_unavailable=true` in the first place: the
 * endpoint answers 403 without it, which would show the failure page instead.
 *
 * The three fixtures are closed and used nowhere else, so this spec writes
 * nothing and can run repeatedly.
 */
import { test, expect } from '@playwright/test';
import { BASE_URL } from './helpers.js';

/**
 * Prefix instead of the full sentence on purpose: the date goes through
 * `Intl.DateTimeFormat`, whose exact output belongs to the platform, not to this
 * repo. The prefix proves the reason-specific branch was taken, and the year
 * proves a real date was substituted rather than an empty string.
 */
const FIXTURES = [
  {
    study: 'newui_02_paused',
    pid: 'paused_01',
    studyName: 'Fixture: pausierte Studie',
    title: 'Die Studie ist derzeit pausiert',
    textPrefix: 'Bitte versuchen Sie es später',
    year: null,
  },
  {
    study: 'newui_03_ended',
    pid: 'ended_01',
    studyName: 'Fixture: beendete Studie',
    title: 'Die Erhebung ist beendet',
    textPrefix: 'Der Erhebungszeitraum endete am ',
    year: '2025',
  },
  {
    study: 'newui_04_not_started',
    pid: 'notstarted_01',
    studyName: 'Fixture: noch nicht gestartete Studie',
    title: 'Die Erhebung hat noch nicht begonnen',
    textPrefix: 'Sie beginnt am ',
    year: '2030',
  },
];

test.describe('unavailable stage', () => {
  for (const fixture of FIXTURES) {
    test(`${fixture.study} explains why and offers no diary`, async ({ page }) => {
      await page.goto(`${BASE_URL}?study=${fixture.study}&pid=${fixture.pid}`);
      await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/unavailable');

      // D40: the eyebrow is the study, one h1 carries the reason. Scoped to the
      // stage host: the shell keeps a visually hidden `h1` for the diary, and it
      // is inside the `.t-shell` that this stage hides.
      await expect(page.locator('.t-page__eyebrow')).toHaveText(fixture.studyName);
      await expect(page.locator('.t-page__title')).toHaveText(fixture.title);
      await expect(page.locator('.t-stage h1')).toHaveCount(1);

      const text = page.locator('.t-notice').first();
      await expect(text).toBeVisible();
      await expect(text).toHaveAttribute('role', 'status');
      await expect(text).toContainText(fixture.textPrefix);
      if (fixture.year) await expect(text).toContainText(fixture.year);

      // A closed study must not be framed by controls that cannot do anything.
      await expect(page.locator('.t-shell')).toBeHidden();
      await expect(page.locator('#submit-btn')).toBeHidden();
      await expect(page.locator('#fab')).toBeHidden();
      await expect(page.locator('#days .t-timeline-day')).toHaveCount(0);
    });
  }

  test('the generic sentence is never shown for a known reason', async ({ page }) => {
    // The fallback exists for a payload without a reason. Its wording ("paused
    // or no longer collecting") is the one sentence that must not appear when
    // the server said which of the two it is.
    const generic = 'Sie ist pausiert oder nimmt keine Daten mehr auf.';
    for (const fixture of FIXTURES) {
      await page.goto(`${BASE_URL}?study=${fixture.study}&pid=${fixture.pid}`);
      await expect(page.locator('.t-page__title')).toHaveText(fixture.title);
      await expect(page.locator('.t-notice').first()).not.toContainText(generic);
    }
  });
});
