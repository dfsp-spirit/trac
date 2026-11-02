/**
 * Searching the activity catalogue (D30), and the "Used recently" row above it.
 *
 * `activity-search.test.js` pins `searchHits()` and `recentEntries()` as
 * functions. What it cannot pin is the thing 9.1 actually advertises: type
 * "Joggen" and get the *sub-activity* as its own row, so one click lands in the
 * form with that sub-activity already chosen - not the parent plus a second
 * choice. The fixture catalogue has three rows that begin with "Joggen", two of
 * them children of different parents, which is exactly the ambiguity the row has
 * to resolve.
 *
 * Writes (adds an activity for the recents test) and cleans up after itself.
 */
import { test, expect } from '@playwright/test';
import { addActivity, clearActivities, openDiary, openPanel, participantsUrl } from './helpers.js';

const STUDY = 'newui_06_diary';
const PID = 'diary_02';

/** @param {import('@playwright/test').Page} page */
function searchBox(page) {
  return page.locator('.t-search input[type="search"]');
}

/** @param {import('@playwright/test').Page} page */
function catalogueRows(page) {
  return page.locator('.t-activity-group[data-group="catalogue"] .t-activity');
}

/** @param {import('@playwright/test').Page} page */
function recentGroup(page) {
  return page.locator('.t-activity-group[data-group="recent"]');
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} query
 */
async function search(page, query) {
  await openPanel(page);
  await searchBox(page).fill(query);
  await expect(searchBox(page)).toHaveValue(query);
}

test.describe('activity search', () => {
  test.beforeEach(async ({ request }) => clearActivities(request, PID));
  test.afterEach(async ({ request }) => clearActivities(request, PID));

  test('a matching sub-activity becomes its own row', async ({ page }) => {
    await openDiary(page, PID);
    await search(page, 'Joggen');

    const rows = catalogueRows(page);
    await expect(rows).toHaveCount(3);
    // The child name is the title and its parent the hint, because that pair is
    // what tells the two "Joggen: Draußen …" rows apart.
    await expect(rows.nth(0)).toContainText('Joggen');
    await expect(rows.nth(0)).toContainText('Unterwegs (Transit)');
    await expect(rows.nth(1)).toContainText('Joggen: Draußen alleine');
    await expect(rows.nth(1)).toContainText('Sport & Bewegung (Außer Haus)');
    await expect(rows.nth(2)).toContainText('Joggen: Draußen mit anderen');

    // The rows carry the child code, and name their parent for the form.
    await expect(rows.nth(1)).toHaveAttribute('data-activity-code', '1171');
    await expect(rows.nth(1)).toHaveAttribute('data-parent-activity-code', '1166');
  });

  test('one click lands in the form with the sub-activity chosen', async ({ page, request }) => {
    await openDiary(page, PID);
    await search(page, 'Joggen');

    await catalogueRows(page).nth(1).click();

    // The parent is what the participant sees, the child is what is preselected -
    // no second choice.
    await expect(page.locator('.t-chosen__text')).toHaveText('Sport & Bewegung (Außer Haus)');
    await expect(page.locator('#form-child')).toHaveValue('1171');
    await expect(searchBox(page)).toBeHidden();

    await page.locator('#form-start').selectOption('600');
    await page.locator('#form-end').selectOption('660');
    await page.locator('[data-slot="actions"] .t-btn--primary').click();

    // The row reports the sub-activity, not the parent.
    await expect(page.locator('#days .t-event')).toHaveCount(1);
    await expect(page.locator('#days .t-event').first()).toContainText(
      'Joggen: Draußen alleine'
    );

    // What reached the server: the child as the activity and the parent as its
    // context, which is the pair the analysis reads.
    await expect
      .poll(async () => {
        const diary = await (
          await request.get(`${participantsUrl(STUDY)}/${PID}/diary`)
        ).json();
        return diary.activities.map(
          (/** @type {any} */ a) => `${a.parent_activity_code}/${a.activity_code}`
        );
      })
      .toEqual(['1166/1171']);
  });

  test('the query stays applied when the participant goes back to the list', async ({ page }) => {
    await openDiary(page, PID);
    await search(page, 'Joggen');
    await catalogueRows(page).nth(0).click();
    await expect(page.locator('#form-child')).toBeVisible();

    await page.locator('[data-slot="back"]').click();

    // Searching is a place the participant returns to, not a filter that resets.
    await expect(searchBox(page)).toBeVisible();
    await expect(searchBox(page)).toHaveValue('Joggen');
    await expect(catalogueRows(page)).toHaveCount(3);
  });

  test('the search box keeps focus while the list behind it is replaced', async ({ page }) => {
    await openDiary(page, PID);
    await openPanel(page);

    // The input lives in the panel head and is never re-rendered, which is what
    // makes typing one character at a time work at all.
    await searchBox(page).focus();
    for (const query of ['J', 'Jo', 'Jog', 'Jogg']) {
      await page.keyboard.type(query.slice(-1));
      await expect(catalogueRows(page)).not.toHaveCount(0);
      await expect(searchBox(page)).toBeFocused();
    }

    await expect(catalogueRows(page)).toHaveCount(3);
  });

  test('a query that matches nothing says so', async ({ page }) => {
    await openDiary(page, PID);
    await search(page, 'Zzzz');

    await expect(page.locator('[data-slot="content"] .t-hint')).toHaveText(
      'Keine Aktivität passt zu „Zzzz“'
    );
    await expect(catalogueRows(page)).toHaveCount(0);
    await expect(recentGroup(page)).toHaveCount(0);
  });

  test('clearing the query brings the catalogue back', async ({ page }) => {
    await openDiary(page, PID);
    await search(page, 'Zzzz');
    await page.locator('[data-slot="search-clear"]').click();

    await expect(searchBox(page)).toHaveValue('');
    await expect(catalogueRows(page)).not.toHaveCount(0);
    // Categories, not a flat list: seven of them in the rewrite catalogue.
    await expect(page.locator('.t-activity-group[data-group="catalogue"]')).toHaveCount(7);
  });

  test('"Used recently" appears once something is logged, and only while browsing', async ({
    page,
  }) => {
    await openDiary(page, PID);
    await openPanel(page);
    await expect(recentGroup(page)).toHaveCount(0);

    // One activity through the catalogue.
    await addActivity(page, 1101, { start: 480, end: 540 });
    await expect(page.locator('#days .t-event')).toHaveCount(1);

    await openPanel(page);
    await expect(recentGroup(page)).toHaveCount(1);
    await expect(recentGroup(page).locator('h3')).toHaveText('Zuletzt verwendet');
    await expect(recentGroup(page).locator('.t-activity')).toHaveCount(1);
    // The same activity is in the shortcut row *and* in the catalogue, which is
    // why every other spec addresses the catalogue group explicitly.
    await expect(catalogueRows(page).filter({ hasText: 'Schlafen' })).toHaveCount(1);

    // With a query the matches are the whole answer.
    await searchBox(page).fill('Schlafen');
    await expect(recentGroup(page)).toHaveCount(0);
  });
});
