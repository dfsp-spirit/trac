const { test, expect } = require('@playwright/test');
const {
  enterStudyIfNeeded,
  placeActivity,
  placeActivityMobile,
  switchToDay,
  getCurrentDayIndex,
} = require('./e2e_helpers.js');
const { MOBILE_VIEWPORT } = require('./participant_pages.js');

// sendData() retries 5xx itself (fetchWithSmartRetry: maxRetries 2 + the first
// try), so one mocked 500 never surfaces as a failed save.
const SEND_ATTEMPTS_PER_SAVE = 3;

// Autosave: the day is written shortly after the last edit, with no Save Day
// press. What matters here is the part the unit tests cannot see - that the edit
// actually reaches the backend, that a burst of edits becomes one request, that
// leaving the day persists pending work, and that nothing is written when the day
// did not change (every write re-creates the rows, so a pointless one also moves
// the day's created_at, which diary_completed_at is derived from).
//
// The timing rules themselves are unit-tested in tests/unit/autosave.test.js.
test.use({ viewport: { width: 1600, height: 900 } });

/** Collect POSTs to the day-activities endpoint. */
function trackActivityPosts(page) {
  const posts = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      /\/activities(\?|$)/.test(request.url())
    ) {
      posts.push(request.url());
    }
  });
  return posts;
}

async function openDiary(page, pid) {
  await page.goto(`index.html?pid=${pid}&study_name=default&lang=en`, {
    waitUntil: 'load',
  });
  await enterStudyIfNeeded(page);
  await expect(page.locator('#currentDayDisplay')).toBeVisible({ timeout: 30000 });
}

function activityCount(page) {
  return page.evaluate(() =>
    Object.values(window.timelineManager.activities).reduce(
      (sum, list) => sum + list.length,
      0
    )
  );
}

test('an edit is saved without pressing Save Day', async ({ page }) => {
  await openDiary(page, `e2e-autosave-${Date.now()}`);
  const posts = trackActivityPosts(page);

  await placeActivity(page, { activityName: 'Sleeping', positionPercent: 30 });

  // Saved by itself, within the debounce + one request.
  await expect
    .poll(() => page.evaluate(() => window.autosave.state()), {
      timeout: 20000,
      message: 'waiting for autosave to report it stored the day',
    })
    .toBe('saved');
  expect(posts.length).toBe(1);
  expect(await page.evaluate(() => window.autosave.hasPendingChanges())).toBe(false);

  // And it really is in the backend: a reload brings the day back.
  await page.reload({ waitUntil: 'load' });
  await enterStudyIfNeeded(page);
  await expect
    .poll(() => activityCount(page), {
      timeout: 20000,
      message: 'waiting for the autosaved day to load',
    })
    .toBeGreaterThan(0);
});

test('a burst of edits is saved without a request per edit', async ({ page }) => {
  await openDiary(page, `e2e-autosave-burst-${Date.now()}`);
  const posts = trackActivityPosts(page);

  // Three edits in quick succession.
  await placeActivity(page, { activityName: 'Sleeping', positionPercent: 15 });
  await placeActivity(page, { activityName: 'Cooking', positionPercent: 50 });
  await placeActivity(page, { activityName: 'Reading (digital)', positionPercent: 80 });

  await expect
    .poll(() => page.evaluate(() => window.autosave.state()), { timeout: 20000 })
    .toBe('saved');

  // Three placements through the real UI, so how many of them fall inside one
  // AUTOSAVE_DEBOUNCE_MS window is a matter of how fast the runner is: on a
  // loaded CI machine the gaps can exceed 2s and a second save is then correct
  // behaviour, not a defect. What this spec is for is that the burst reaches
  // the backend with every edit - "exactly one request" is asserted where the
  // clock can be controlled (tests/unit/autosave.test.js, "a burst of edits
  // collapses into a single request").
  expect(
    posts.length,
    `three quick edits must not produce one request each, got ${posts.length}`
  ).toBeLessThan(3);
  expect(await activityCount(page)).toBe(3);
});

test('switching day persists pending edits first', async ({ page }) => {
  await openDiary(page, `e2e-autosave-switch-${Date.now()}`);

  // Edit and switch immediately: well inside the debounce window, so only the
  // flush before the navigation can have stored this.
  await placeActivity(page, { activityName: 'Sleeping', positionPercent: 25 });
  await switchToDay(page, 1);
  await expect
    .poll(() => getCurrentDayIndex(page), { timeout: 20000 })
    .toBe(1);

  // Back to Monday: the activity must be there (it came from the backend).
  await switchToDay(page, 0);
  await expect
    .poll(() => activityCount(page), {
      timeout: 20000,
      message: 'waiting for the flushed day to come back',
    })
    .toBeGreaterThan(0);
});

test('clearing a timeline can be undone, and the undo is stored too', async ({
  page,
}) => {
  await openDiary(page, `e2e-autosave-clear-undo-${Date.now()}`);

  await placeActivity(page, { activityName: 'Sleeping', positionPercent: 30 });
  await expect
    .poll(() => page.evaluate(() => window.autosave.state()), { timeout: 20000 })
    .toBe('saved');

  await page.locator('#clearTimelineBtn').click();
  await expect(page.locator('#clearTimelineConfirmModal')).toBeVisible();
  await page.locator('#confirmClearTimelineOk').click();
  await expect(page.locator('.activity-block')).toHaveCount(0);

  // Clearing used to be reversible by not pressing Save Day; now the empty
  // timeline is on its way to the backend within a second, so the toast has to
  // offer the way back.
  const toast = page.locator('.toast');
  await expect(toast).toContainText('Timeline cleared');
  await toast.locator('.toast-action').click();
  await expect(page.locator('.activity-block')).toHaveCount(1);

  // The restored day must be stored as well - otherwise the undo would only last
  // until the next reload.
  await expect
    .poll(() => page.evaluate(() => window.autosave.state()), { timeout: 20000 })
    .toBe('saved');
  await page.reload({ waitUntil: 'load' });
  await enterStudyIfNeeded(page);
  await expect
    .poll(() => activityCount(page), {
      timeout: 20000,
      message: 'waiting for the restored activity to load from the backend',
    })
    .toBeGreaterThan(0);
});

// The day and timeline sheets live in the phone context bar, so this one runs
// at the mobile breakpoint (the rest of the file is desktop).
test.describe('on a phone', () => {
  test.use({ viewport: MOBILE_VIEWPORT, hasTouch: true });

  test('nothing is written while the day does not change', async ({ page }) => {
    await openDiary(page, `e2e-autosave-noop-${Date.now()}`);
    const posts = trackActivityPosts(page);

    // A stored day, so an unwanted re-write would be a real POST - and one that
    // re-dates the rows it re-creates.
    await placeActivityMobile(page, 30);
    await expect
      .poll(() => page.evaluate(() => window.autosave.state()), { timeout: 20000 })
      .toBe('saved');
    const writesAfterTheEdit = posts.length;
    expect(writesAfterTheEdit).toBe(1);

    // Open and close the day sheet: a pure re-render, which calls the same
    // updateButtonStates() hook an edit does.
    await page.locator('#dayPickerBtn').click();
    await expect(page.locator('#dayMenu')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('#timelinePickerBtn').click();
    await expect(page.locator('#timelineMenu')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.waitForTimeout(3500); // longer than the debounce
    // Let a (wrongly) triggered write finish, so it is counted rather than
    // caught mid-flight.
    await expect
      .poll(() => page.evaluate(() => window.autosave.isSaving()), { timeout: 15000 })
      .toBe(false);
    expect(
      posts.length,
      're-rendering the day must not write it back (it would re-date the rows)'
    ).toBe(writesAfterTheEdit);
    expect(await page.evaluate(() => window.autosave.state())).toBe('saved');
  });

  test('the status does not push the phone layout around', async ({ page }) => {
    await openDiary(page, `e2e-autosave-layout-${Date.now()}`);
    const headerHeight = () =>
      page.evaluate(() =>
        Math.round(
          document.querySelector('.header-section').getBoundingClientRect().height
        )
      );

    const withoutStatus = await headerHeight();

    // The state is injected rather than waited for: this is about what the chip
    // does to the layout, and a real failure takes seconds to reach. "Not saved"
    // is the state that stays on screen, so it is the worst case.
    await page.evaluate(() => window.renderSyncStatus('error'));
    const chip = page.locator('#syncStatus');
    await expect(chip).toBeVisible();

    expect(
      await headerHeight(),
      'the chip floats on a phone, it must not add a toolbar row'
    ).toBe(withoutStatus);

    const box = await chip.boundingBox();
    const viewport = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  });
});

test('a failed autosave is retried and the day ends up stored', async ({
  page,
}) => {
  await openDiary(page, `e2e-autosave-retry-${Date.now()}`);

  let attempts = 0;
  await page.route('**/*activities**', async (route, request) => {
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }
    attempts += 1;
    // Fail the entire first save attempt, not just one request of it.
    if (attempts <= SEND_ATTEMPTS_PER_SAVE) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'transient failure' }),
      });
      return;
    }
    await route.continue();
  });

  await placeActivity(page, { activityName: 'Sleeping', positionPercent: 30 });

  // The first save attempt fails, the engine retries after its backoff and
  // reports the error state in between.
  await expect
    .poll(() => page.evaluate(() => window.autosave.state()), {
      timeout: 12000,
      message: 'waiting for the error state after the mocked failure',
    })
    .toBe('error');

  await expect
    .poll(() => page.evaluate(() => window.autosave.state()), {
      timeout: 20000,
      message: 'waiting for the retry to store the day',
    })
    .toBe('saved');
  expect(attempts).toBeGreaterThan(1);
});

test('the toolbar reports what happened to the day', async ({ page }) => {
  await openDiary(page, `e2e-autosave-status-${Date.now()}`);
  const chip = page.locator('#syncStatus');

  // Nothing to say about a day nobody has touched yet.
  await expect(chip).toBeHidden();

  await placeActivity(page, { activityName: 'Sleeping', positionPercent: 30 });

  // The chip is built on the first state change, so this also covers the wiring
  // between the engine and the toolbar.
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('Saving');
  await expect(chip.locator('.sync-status-retry')).toBeHidden();

  // It belongs to the toolbar's button group (as a plain child of .controls it
  // took a line of its own and moved the timeline - a burst of placements then
  // missed), and showing it must not budge the buttons: the row is centred, so an
  // in-flow chip re-centres everything next to it (measured: Submit Study 86 px).
  await expect(
    page.locator('.header-section .controls-group #syncStatus')
  ).toHaveCount(1);

  const geometry = () =>
    page.evaluate(() => {
      const box = (selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { x: Math.round(rect.x), right: Math.round(rect.right) };
      };
      return {
        toolbar: Math.round(
          document
            .querySelector('.header-section .controls')
            .getBoundingClientRect().height
        ),
        submit: box('#submitStudyBtn'),
        clear: box('#clearTimelineBtn'),
        chip: box('#syncStatus'),
        chipVisible: !document.getElementById('syncStatus').hidden,
        viewport: window.innerWidth,
      };
    });

  const shown = await geometry();
  await page.evaluate(() => {
    document.getElementById('syncStatus').hidden = true;
  });
  const hidden = await geometry();

  expect(
    hidden.toolbar,
    'showing the chip must not add a toolbar row'
  ).toBe(shown.toolbar);
  expect(shown.submit.x, 'the buttons must not move with the chip').toBe(
    hidden.submit.x
  );
  expect(shown.clear.x, 'the buttons must not move with the chip').toBe(
    hidden.clear.x
  );
  expect(shown.chip.right).toBeLessThanOrEqual(shown.viewport);

  await page.evaluate(() => {
    document.getElementById('syncStatus').hidden = false;
  });

  await expect(chip).toContainText('Saved', { timeout: 20000 });
  expect(await page.evaluate(() => window.autosave.hasPendingChanges())).toBe(
    false
  );

  // The confirmation is transient: it must not sit in the toolbar for the rest of
  // the session.
  await expect(chip).toBeHidden({ timeout: 10000 });
});

test('a failed save says so, and the retry action stores the day', async ({
  page,
}) => {
  await openDiary(page, `e2e-autosave-status-retry-${Date.now()}`);

  let attempts = 0;
  await page.route('**/*activities**', async (route, request) => {
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }
    attempts += 1;
    if (attempts <= SEND_ATTEMPTS_PER_SAVE) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'transient failure' }),
      });
      return;
    }
    await route.continue();
  });

  await placeActivity(page, { activityName: 'Sleeping', positionPercent: 30 });

  const chip = page.locator('#syncStatus');
  const retry = chip.locator('.sync-status-retry');

  // A silent autosave failure would be worse than a failed explicit save.
  await expect(chip).toContainText('Not saved', { timeout: 20000 });
  await expect(retry).toBeVisible();

  // The retry belongs to the participant, so it must not wait out the engine's
  // 2 s backoff: within 1.5 s of the click the only possible new request is the
  // one the click caused (the engine's own timer is cleared by the flush).
  const attemptsBefore = attempts;
  await retry.click();
  await expect
    .poll(() => attempts, { timeout: 1500 })
    .toBeGreaterThan(attemptsBefore);

  await expect(chip).toContainText('Saved', { timeout: 20000 });
  await expect(chip).toBeHidden({ timeout: 10000 });
});
