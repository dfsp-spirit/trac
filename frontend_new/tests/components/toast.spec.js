/**
 * `ui/toast.js` on a fixture page (D33 rule 8).
 *
 * The toast is the receipt for what just happened and the only way back for a
 * delete, so it has to be reachable and it must not sit in the way. These tests
 * pin the three things that were wrong when a participant added entries one
 * after another: the toast covered the panel's footer (and, because it takes
 * pointer events, swallowed the click), it could only be waited out, and it
 * stayed while the next entry was already being configured.
 */
import { test, expect } from '@playwright/test';

/** @param {import('@playwright/test').Page} page */
async function open(page) {
  await page.goto('toast.html');
  await page.waitForFunction(() => window.__done === true);
}

/**
 * Show the real "added" message, with or without an undo action.
 *
 * @param {import('@playwright/test').Page} page
 * @param {boolean} [withUndo]
 */
async function showAdded(page, withUndo = true) {
  await page.evaluate((undo) => {
    window.__toast.show(
      window.__addedMessage,
      undo ? { label: 'Rückgängig', run: () => {} } : undefined
    );
  }, withUndo);
}

/**
 * What a tap in the middle of the message reaches.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ tag: string, id: string, className: string, insideToast: boolean } | null>}
 */
async function hitTestMessageArea(page) {
  return page.evaluate(() => {
    const text = document.querySelector('.t-toast__text').getBoundingClientRect();
    const hit = document.elementFromPoint(
      text.left + text.width / 2,
      text.top + text.height / 2
    );
    if (!hit) return null;
    return {
      tag: hit.tagName,
      id: hit.id,
      className: String(hit.className),
      insideToast: Boolean(hit.closest('#toast-region')),
    };
  });
}

const region = (page) => page.locator('#toast-region');
const toast = (page) => page.locator('.t-toast');

test.describe('the toast itself', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('says what happened, offers Undo and a way to close it', async ({ page }) => {
    await open(page);
    await showAdded(page);

    await expect(toast(page)).toContainText('Hinzugefügt: Arbeiten, 08:00–10:00');
    await expect(page.locator('.t-toast__action')).toHaveText('Rückgängig');

    // The close control is named for assistive tech and is a real tap target,
    // not a decorative ×: it is the way out before the six-second timer runs.
    const close = page.locator('.t-toast__close');
    await expect(close).toHaveAttribute('aria-label', 'Schließen');
    const box = await close.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box?.width ?? 0)).toBeGreaterThanOrEqual(44);
    expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(44);
  });

  test('closing it hides the message immediately', async ({ page }) => {
    await open(page);
    await showAdded(page);

    await page.locator('.t-toast__close').click();
    await expect(toast(page)).toHaveCount(0);
  });

  test('a message without an action is still closable', async ({ page }) => {
    await open(page);
    await showAdded(page, false);

    await expect(page.locator('.t-toast__action')).toHaveCount(0);
    await page.locator('.t-toast__close').click();
    await expect(toast(page)).toHaveCount(0);
  });

  test('one message at a time: a second one replaces the first', async ({ page }) => {
    await open(page);
    await showAdded(page);
    await page.evaluate(() => window.__toast.show('Geändert: Schlafen, 08:00–09:00'));

    await expect(toast(page)).toHaveCount(1);
    await expect(toast(page)).toContainText('Geändert: Schlafen');
  });

  test('hide() empties the region', async ({
    page,
  }) => {
    await open(page);
    await showAdded(page);
    await page.evaluate(() => window.__toast.hide());

    await expect(region(page)).toBeEmpty();
  });

  test('Undo is the first control, the close the last', async ({ page }) => {
    await open(page);
    await showAdded(page);

    // Keyboard order follows DOM order: the action that keeps the entry is
    // reached before the one that only dismisses the receipt.
    const buttons = toast(page).locator('button');
    await expect(buttons).toHaveCount(2);
    await expect(buttons.nth(0)).toHaveClass(/t-toast__action/);
    await expect(buttons.nth(1)).toHaveClass(/t-toast__close/);
  });
});

test.describe('desktop: stays out of the panel’s way', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the confirmation ends where the panel column begins', async ({ page }) => {
    await open(page);
    await showAdded(page);

    const toastBox = await toast(page).boundingBox();
    const panelBox = await page.locator('#panel').boundingBox();
    expect(toastBox).not.toBeNull();
    expect(panelBox).not.toBeNull();

    // Not one pixel over the panel column: the whole point of the anchoring.
    expect(toastBox.x + toastBox.width).toBeLessThanOrEqual(panelBox.x);

    // Still the lower part of the screen, as the flow expects.
    const viewport = page.viewportSize();
    expect(toastBox.y + toastBox.height).toBeLessThan(viewport.height);
    expect(toastBox.y).toBeGreaterThan(viewport.height / 2);
  });

  test('a tap on the receipt reaches what is under it', async ({ page }) => {
    await open(page);
    await showAdded(page);

    // Same rule as on a phone: the receipt is a glance, never a surface. The
    // box takes no clicks at any width - only Undo and the close × do - so what
    // is under it stays reachable.
    const hit = await hitTestMessageArea(page);
    expect(hit).not.toBeNull();
    expect(hit.insideToast).toBe(false);
  });

  test('the next save is clickable while the toast is up', async ({ page }) => {
    await open(page);
    await showAdded(page);

    const saved = await page.evaluate(() => {
      const button = document.querySelector('[data-slot="actions"] .t-btn--secondary');
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2
      );
      return Boolean(hit && (hit === button || button.contains(hit)));
    });

    expect(saved).toBe(true);

    // And the real click lands: this is what the participant does next.
    await page.locator('[data-slot="actions"] .t-btn--secondary').click({ timeout: 2000 });
    await expect(toast(page)).toHaveCount(1);
  });
});

test.describe('phone: full-width band above the add button', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('keeps the inset gutters and clears the add button', async ({ page }) => {
    await open(page);
    await showAdded(page);

    const box = await toast(page).boundingBox();
    expect(Math.round(box?.x ?? 0)).toBe(16);
    expect(Math.round(box?.width ?? 0)).toBe(375 - 32);

    // --fab (56) + its bottom inset (16) + 12: the toast floats above the FAB.
    expect(Math.round(667 - (box.y + box.height))).toBe(84);
  });

  test('a tap on the receipt reaches what is under it, not the receipt', async ({
    page,
  }) => {
    await open(page);
    await showAdded(page);

    // The band sits where the participant taps next: an entry of the timeline, or
    // the add button's neighbourhood. The message area must let the click through
    // - while it did not, a tap aimed at a day or an entry hit the toast, and the
    // only part of it that takes clicks is Undo, so deleting several entries in a
    // row could re-add the one just deleted.
    const hit = await hitTestMessageArea(page);
    expect(hit).not.toBeNull();
    expect(hit.id).toBe('under-toast');

    // The toast's own controls keep their clicks.
    const undo = page.locator('.t-toast__action');
    const box = await undo.boundingBox();
    expect(box).not.toBeNull();
    const undoHit = await page.evaluate(
      ([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return hit ? hit.className : null;
      },
      [box.x + box.width / 2, box.y + box.height / 2]
    );
    expect(undoHit).toContain('t-toast__action');
  });
});
