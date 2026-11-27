/**
 * `ui/activityForm.js` on a fixture page (D33 rule 8): the free-text field.
 *
 * A custom input is a property of the catalogue *row*, and a sub-activity is a
 * row. The pilot study ships sub-activities that ask for the participant's words
 * ("Sport in Innenräumen (z.B. Schwimmen, Kurse)"), so picking one has to offer
 * the text field - it used to be rendered only when the *parent* was a custom
 * input, which silently turned those sub-activities into plain ones.
 */
import { test, expect } from '@playwright/test';

/** @param {import('@playwright/test').Page} page @param {string} [query] */
async function open(page, query = '') {
  await page.goto(`activityform.html${query}`);
  await page.waitForFunction(() => window.__done === true);
}

const textField = (page) => page.locator('#form-text');
const childSelect = (page) => page.locator('#form-child');

/** @param {import('@playwright/test').Page} page */
async function read(page) {
  return page.evaluate(() => window.__read());
}

test.describe('a custom sub-activity', () => {
  test('offers its text field only while it is the chosen row', async ({ page }) => {
    await open(page);

    // Nothing chosen yet: there is nothing to type into.
    await expect(textField(page)).toBeHidden();

    // The plain sub-activity stays plain.
    await childSelect(page).selectOption('1171');
    await expect(textField(page)).toBeHidden();

    // The custom sub-activity asks for the participant's words.
    await childSelect(page).selectOption('1173');
    await expect(textField(page)).toBeVisible();
    // The row names its own prompt; without one the form asks the generic
    // question from the locale files.
    await expect(page.locator('label[for="form-text"]')).toHaveText(
      'Welche Sportart genau?'
    );

    // The prompt follows the row: a custom row without one falls back, and a
    // plain row hides the field entirely.
    await childSelect(page).selectOption('1174');
    await expect(textField(page)).toBeVisible();
    await expect(page.locator('label[for="form-text"]')).toHaveText(
      'Was haben Sie gemacht?'
    );

    // Switching back hides it again - the choice can change while the form is open.
    await childSelect(page).selectOption('1171');
    await expect(textField(page)).toBeHidden();
  });

  test('saves the typed text under the sub-activity, not the parent', async ({ page }) => {
    await open(page);
    await childSelect(page).selectOption('1173');
    await textField(page).fill('Yoga');

    const result = await read(page);
    expect(result.ok).toBe(true);
    expect(result.values).toMatchObject({
      activity_code: 1173,
      activity_name: 'Sport in Innenräumen (z.B. Schwimmen, Kurse): Yoga',
      parent_activity_code: 1166,
    });
  });

  test('refuses to save it without text', async ({ page }) => {
    await open(page);
    await childSelect(page).selectOption('1173');

    const result = await read(page);
    expect(result).toEqual({ ok: false, code: 'form.needsText' });
  });

  test('a plain sub-activity is saved without any text', async ({ page }) => {
    await open(page);
    await childSelect(page).selectOption('1171');

    const result = await read(page);
    expect(result.ok).toBe(true);
    expect(result.values).toMatchObject({
      activity_code: 1171,
      activity_name: 'Joggen: Draußen alleine',
      parent_activity_code: 1166,
    });
  });

  test('opened from the search results, it arrives with the field ready', async ({
    page,
  }) => {
    // The search hit (and the "used recently" shortcut) preselects the
    // sub-activity, so the form must open on its custom row.
    await open(page, '?child=1173');

    await expect(textField(page)).toBeVisible();
    await expect(childSelect(page)).toHaveValue('1173');
  });

  test('editing a stored row prefills the words without its prefix', async ({ page }) => {
    await open(
      page,
      `?child=1173&edit=1&activity_name=${encodeURIComponent(
        'Sport in Innenräumen (z.B. Schwimmen, Kurse): Yoga'
      )}`
    );

    await expect(textField(page)).toBeVisible();
    await expect(textField(page)).toHaveValue('Yoga');

    const result = await read(page);
    expect(result.ok).toBe(true);
    expect(result.values.activity_name).toBe(
      'Sport in Innenräumen (z.B. Schwimmen, Kurse): Yoga'
    );
  });
});

test.describe('a custom activity without sub-activities', () => {
  test('keeps its text field, as before', async ({ page }) => {
    await open(page, '?custom_parent=1');

    await expect(textField(page)).toBeVisible();
    await expect(page.locator('label[for="form-text"]')).toHaveText(
      'Was ist Ihr Beruf?'
    );
    await textField(page).fill('Programmieren');

    const result = await read(page);
    expect(result.ok).toBe(true);
    expect(result.values).toMatchObject({
      activity_code: 1199,
      activity_name: 'Bezahlte Arbeit: Programmieren',
      parent_activity_code: 1199,
    });
  });
});

/**
 * How often an activity happens is an optional answer that only a few catalogue
 * rows offer. It used to be a stacked field at the end of the form, which pushed
 * the dialog past the fold on a 375x667 phone; it now shares a line with the day
 * it qualifies. These pin the layout and the round trip, not the wording.
 */
test.describe('a frequency the activity offers', () => {
  const frequency = (page) => page.locator('#form-frequency');

  test('is absent for an activity that offers no options', async ({ page }) => {
    await open(page, '?child=1171');

    await expect(frequency(page)).toHaveCount(0);
    const result = await read(page);
    expect(result.values.frequency_key).toBeNull();
  });

  test('shares one line with its label, right under the day', async ({ page }) => {
    await open(page, '?freq=1&child=1171');

    await expect(frequency(page)).toBeVisible();
    await expect(page.locator('label[for="form-frequency"]')).toHaveText('Wie oft?');

    // One row: label and select sit on the same line, and the select keeps the
    // full tap height. A stacked field would put the label above the control.
    const label = await page.locator('label[for="form-frequency"]').boundingBox();
    const select = await frequency(page).boundingBox();
    expect(select.height).toBeGreaterThanOrEqual(48);
    expect(label.x + label.width).toBeLessThan(select.x);
    expect(Math.abs(label.y + label.height / 2 - (select.y + select.height / 2))).toBeLessThan(6);

    // It belongs to "when": above the start time, and below the day control.
    const day = await page.locator('#form-day').boundingBox();
    const start = await page.locator('#form-start').boundingBox();
    expect(select.y).toBeGreaterThan(day.y);
    expect(select.y).toBeLessThan(start.y);
  });

  test('states what the empty answer means and saves the chosen key', async ({ page }) => {
    await open(page, '?freq=1&child=1171');

    // Leaving it alone means "every week", so the option says so.
    expect(await frequency(page).locator('option').first().textContent()).toBe(
      'Jede Woche (Standard)'
    );
    expect((await read(page)).values.frequency_key).toBeNull();

    await frequency(page).selectOption('monthly');
    const result = await read(page);
    expect(result.ok).toBe(true);
    expect(result.values.frequency_key).toBe('monthly');
  });

  test('editing a stored row shows the key that was saved', async ({ page }) => {
    await open(page, '?freq=1&child=1171&edit=1&frequency_key=monthly');

    await expect(frequency(page)).toHaveValue('monthly');
    const result = await read(page);
    expect(result.values.frequency_key).toBe('monthly');
  });

  test('a sub-activity offers the options of its row', async ({ page }) => {
    await open(page, '?freq=1&child=1171');

    await expect(frequency(page)).toBeVisible();
    await frequency(page).selectOption('bi-weekly');

    const result = await read(page);
    expect(result.values).toMatchObject({
      activity_code: 1171,
      frequency_key: 'bi-weekly',
    });
  });
});
