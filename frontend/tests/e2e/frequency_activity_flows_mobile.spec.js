const { test, expect } = require('@playwright/test');
const { enterStudyIfNeeded } = require('./e2e_helpers.js');

const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.use({ viewport: MOBILE_VIEWPORT });

async function waitForActivitiesModal(page) {
  await expect
    .poll(
      async () => page.locator('#modalActivitiesContainer .activity-button').count(),
      {
        timeout: 30000,
        message: 'Waiting for activity buttons in modal to load',
      }
    )
    .toBeGreaterThan(0);
}

async function openActivitiesModal(page) {
  const addButton = page.locator('.floating-add-button');
  await expect(addButton).toBeVisible({ timeout: 30000 });
  await addButton.click();
  await expect(page.locator('#activitiesModal')).toBeVisible();
  await waitForActivitiesModal(page);
}

async function closeActivitiesModal(page) {
  const modal = page.locator('#activitiesModal');
  if (!(await modal.isVisible())) {
    return;
  }

  try {
    await modal.waitFor({ state: 'hidden', timeout: 1000 });
    return;
  } catch {
    // modal still open, close explicitly
  }

  const closeButton = page.locator('#activitiesModal .modal-close').first();
  if (await closeButton.isVisible()) {
    await closeButton.click({ force: true });
  }

  await expect(modal).toBeHidden({ timeout: 10000 });
}

async function enterStudyWithRetry(page, maxAttempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await enterStudyIfNeeded(page);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        throw error;
      }

      const message = String(error?.message || '');
      const isTransientNavigationIssue =
        message.includes('WebKit encountered an internal error') ||
        message.includes('net::ERR_ABORTED') ||
        message.includes('Navigation failed because page was closed');

      if (!isTransientNavigationIssue) {
        throw error;
      }

      await page.waitForTimeout(500);
    }
  }

  throw lastError;
}

async function expandAllCategoriesInModal(page) {
  // In mobile modal, categories use CSS class 'active' to toggle visibility.
  // Click collapsed (non-active) category headers to expand them.
  const categoryHeaders = page.locator(
    '#modalActivitiesContainer .activity-category h3'
  );
  const count = await categoryHeaders.count();
  for (let i = 0; i < count; i += 1) {
    const header = categoryHeaders.nth(i);
    const parentCategory = page.locator(
      `#modalActivitiesContainer .activity-category`
    ).nth(i);
    const isActive = await parentCategory.evaluate((el) =>
      el.classList.contains('active')
    );
    if (!isActive) {
      await header.click();
      await page.waitForTimeout(150);
    }
  }
}

async function selectTopLevelByCodeMobile(page, code) {
  await openActivitiesModal(page);
  await expandAllCategoriesInModal(page);
  const btn = page.locator(`#modalActivitiesContainer .activity-button[data-code="${code}"]`).first();
  await expect(btn).toBeVisible();
  await btn.evaluate((button) => button.click());
  // Do NOT close the modal here — the caller handles sub-modals (frequency, custom)
  // and then closes the activities modal afterwards.
}

async function selectChildByCodesMobile(page, parentCode, childCode) {
  await selectTopLevelByCodeMobile(page, parentCode);
  const childModal = page.locator('#childItemsModal');
  await expect(childModal).toBeVisible();

  const childBtn = page
    .locator(`#childItemsContainer .child-item-button[data-code="${childCode}"]`)
    .first();
  await expect(childBtn).toBeVisible();
  await childBtn.click();
  // After child selection, the child modal closes but activities modal stays open.
  // If the child has frequency, a frequency modal opens on top.
  // Caller must handle sub-modals and close activities modal afterwards.
}

async function confirmDetailsModal({
  page,
  expectedInputVisible,
  expectedFrequencyVisible,
  customText,
  frequencyKey,
}) {
  const modal = page.locator('#customActivityModal');
  await expect(modal).toBeVisible();

  const inputContainer = page.locator('#customActivityInputContainer');
  const frequencyContainer = page.locator('#customActivityFrequencyContainer');

  if (expectedInputVisible) {
    await expect(inputContainer).toBeVisible();
  } else {
    await expect(inputContainer).toBeHidden();
  }

  if (expectedFrequencyVisible) {
    await expect(frequencyContainer).toBeVisible();
  } else {
    await expect(frequencyContainer).toBeHidden();
  }

  if (customText != null) {
    await page.locator('#customActivityInput').fill(customText);
  }

  if (frequencyKey != null) {
    await page.locator('#customActivityFrequencySelect').selectOption(frequencyKey);
  }

  await page.locator('#confirmCustomActivity').click();
  await expect(modal).toBeHidden();
}

async function clickTimelineAtPercentMobile(page, targetPercent) {
  // Dispatch synthetic events on the timeline at a specific vertical percentage.
  // In mobile mode, the timeline is vertical and click position uses clientY.
  const timeline = page
    .locator('.timeline-container[data-active="true"] .timeline')
    .first();
  await expect(timeline).toBeVisible();

  await timeline.evaluate((el, percent) => {
    const rect = el.getBoundingClientRect();
    const x = rect.left + Math.max(1, Math.min(rect.width - 1, rect.width / 2));
    const y = rect.top + Math.max(1, Math.min(rect.height - 1, (rect.height * percent) / 100));

    const types = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    for (const type of types) {
      el.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          view: window,
        })
      );
    }
  }, targetPercent);
}

async function placeSelectedAtPercentAndGetIdMobile(page, percent) {
  const selectedSnapshot = await page.evaluate(() => {
    if (!window.selectedActivity || !window.selectedActivity.name) {
      return null;
    }
    return JSON.parse(JSON.stringify(window.selectedActivity));
  });

  if (!selectedSnapshot) {
    throw new Error('Cannot place activity because window.selectedActivity is not set');
  }

  const beforeIds = await page.evaluate(() => {
    const key = window.timelineManager.keys[window.timelineManager.currentIndex];
    return (window.timelineManager.activities[key] || []).map((a) => String(a.id));
  });

  const offsets = [0, 7, -7, 14, -14, 21, -21, 28, -28];
  const nearbyAttempts = offsets
    .map((offset) => Math.max(2, Math.min(98, percent + offset)))
    .filter((value, index, arr) => arr.indexOf(value) === index);
  const fullSweepAttempts = Array.from({ length: 19 }, (_, i) => 2 + i * 5);
  const attempts = [...nearbyAttempts, ...fullSweepAttempts].filter(
    (value, index, arr) => arr.indexOf(value) === index
  );

  for (const targetPercent of attempts) {
    await page.evaluate((snapshot) => {
      if (!window.selectedActivity) {
        window.selectedActivity = JSON.parse(JSON.stringify(snapshot));
        return;
      }

      if (Number(window.selectedActivity.code) !== Number(snapshot.code)) {
        window.selectedActivity = JSON.parse(JSON.stringify(snapshot));
      }
    }, selectedSnapshot);

    await clickTimelineAtPercentMobile(page, targetPercent);

    const newIdHandle = await page.waitForFunction(
      (knownIds) => {
        const key = window.timelineManager.keys[window.timelineManager.currentIndex];
        const ids = (window.timelineManager.activities[key] || []).map((a) =>
          String(a.id)
        );
        return ids.find((id) => !knownIds.includes(id)) || null;
      },
      beforeIds,
      { timeout: 3500 }
    ).catch(() => null);

    if (newIdHandle) {
      const newId = await newIdHandle.jsonValue();
      if (newId) {
        return String(newId);
      }
    }

    await page.waitForTimeout(200);
  }

  throw new Error(`Could not place activity around ${percent}% after retries`);
}

async function expectSelectedActivityCode(page, code) {
  const handle = await page.waitForFunction(
    (targetCode) => {
      const selected = window.selectedActivity;
      if (!selected) {
        return null;
      }
      return Number(selected.code) === Number(targetCode)
        ? { code: Number(selected.code), frequencyKey: selected.frequencyKey || null }
        : null;
    },
    code,
    { timeout: 10000 }
  );
  return handle.jsonValue();
}

async function expectActivityByIdValues(
  page,
  { id, expectedCode, expectedFrequencyKey, namePattern }
) {
  const activityHandle = await page.waitForFunction(
    (activityId) => {
      const keys = window.timelineManager.keys || [];
      for (const key of keys) {
        const list = window.timelineManager.activities[key] || [];
        const found = list.find((a) => String(a.id) === String(activityId));
        if (found) {
          return {
            code: Number(found.code),
            activity: String(found.activity || ''),
            frequencyKey: found.frequencyKey || null,
          };
        }
      }
      return null;
    },
    id,
    { timeout: 10000 }
  );

  const activity = await activityHandle.jsonValue();
  if (!activity) {
    throw new Error(`Could not find activity id ${id} in timeline data`);
  }

  expect(activity.code).toBe(Number(expectedCode));
  expect(activity.frequencyKey).toBe(expectedFrequencyKey ?? null);

  if (namePattern) {
    expect(activity.activity).toMatch(namePattern);
  }
}

async function deleteActivityByIdMobile(page, id) {
  const block = page
    .locator(`.timeline-container[data-active="true"] .activity-block[data-id="${id}"]`)
    .first();
  await expect(block).toBeVisible();

  // In mobile mode, use hover + Delete key instead of right-click context menu
  await block.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await block.hover({ force: true });
  await page.keyboard.press('Delete');

  await expect(block).toHaveCount(0);
}

test('mobile: frequency flows cover all combinations and non-frequency edit flows remain stable', async ({
  page,
}) => {
  const pid = `freq-e2e-mob-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  await page.goto(`index.html?study_name=default&lang=de&pid=${pid}`, {
    waitUntil: 'domcontentloaded',
  });

  await enterStudyWithRetry(page);

  // Verify mobile layout
  await expect
    .poll(
      async () =>
        page
          .locator('.timeline-container[data-active="true"] .timeline')
          .first()
          .getAttribute('data-layout'),
      {
        timeout: 30000,
        message: 'Waiting for mobile vertical timeline layout',
      }
    )
    .toBe('vertical');

  // 1) Top-level, non-custom with frequency (1163)
  await selectTopLevelByCodeMobile(page, 1163);
  await confirmDetailsModal({
    page,
    expectedInputVisible: false,
    expectedFrequencyVisible: true,
    frequencyKey: 'bi-weekly',
  });
  await closeActivitiesModal(page);
  await expectSelectedActivityCode(page, 1163);
  const freq1163Id = await placeSelectedAtPercentAndGetIdMobile(page, 12);
  await expectActivityByIdValues(page, {
    id: freq1163Id,
    expectedCode: 1163,
    expectedFrequencyKey: 'bi-weekly',
  });

  // 2) Top-level, custom with frequency (1164)
  const hobbyCustomText = 'Museumsbesuch am Abend';
  await selectTopLevelByCodeMobile(page, 1164);
  await confirmDetailsModal({
    page,
    expectedInputVisible: true,
    expectedFrequencyVisible: true,
    customText: hobbyCustomText,
    frequencyKey: 'monthly',
  });
  await closeActivitiesModal(page);
  const freq1164Id = await placeSelectedAtPercentAndGetIdMobile(page, 24);
  await expectActivityByIdValues(page, {
    id: freq1164Id,
    expectedCode: 1164,
    expectedFrequencyKey: 'monthly',
    namePattern: /Museumsbesuch am Abend/i,
  });

  // 3) Child-item, non-custom with frequency (1167)
  await selectChildByCodesMobile(page, 1166, 1167);
  await expect(page.locator('#childItemsModal')).toBeHidden();
  await confirmDetailsModal({
    page,
    expectedInputVisible: false,
    expectedFrequencyVisible: true,
    frequencyKey: 'monthly',
  });
  await closeActivitiesModal(page);
  const freq1167Id = await placeSelectedAtPercentAndGetIdMobile(page, 36);
  await expectActivityByIdValues(page, {
    id: freq1167Id,
    expectedCode: 1167,
    expectedFrequencyKey: 'monthly',
  });

  // 4) Child-item, custom with frequency (1171)
  const outdoorCustomText = 'Basketball im Park';
  await selectChildByCodesMobile(page, 1166, 1171);
  await confirmDetailsModal({
    page,
    expectedInputVisible: true,
    expectedFrequencyVisible: true,
    customText: outdoorCustomText,
    frequencyKey: 'bi-weekly',
  });
  await closeActivitiesModal(page);
  const freq1171Id = await placeSelectedAtPercentAndGetIdMobile(page, 48);
  await expectActivityByIdValues(page, {
    id: freq1171Id,
    expectedCode: 1171,
    expectedFrequencyKey: 'bi-weekly',
    namePattern: /Basketball im Park/i,
  });

  // Regression A: standard top-level (1162) remains unaffected and editable
  await selectTopLevelByCodeMobile(page, 1162);
  await closeActivitiesModal(page);
  await expectSelectedActivityCode(page, 1162);
  const errandsId = await placeSelectedAtPercentAndGetIdMobile(page, 60);
  await expectActivityByIdValues(page, {
    id: errandsId,
    expectedCode: 1162,
    expectedFrequencyKey: null,
  });
  await deleteActivityByIdMobile(page, errandsId);
  await selectTopLevelByCodeMobile(page, 1162);
  await closeActivitiesModal(page);
  await expectSelectedActivityCode(page, 1162);
  await placeSelectedAtPercentAndGetIdMobile(page, 64);

  // Regression B: custom top-level without frequency (1147) remains unaffected and editable
  const customA = 'Werkstatt zuhause';
  await selectTopLevelByCodeMobile(page, 1147);
  await confirmDetailsModal({
    page,
    expectedInputVisible: true,
    expectedFrequencyVisible: false,
    customText: customA,
  });
  await closeActivitiesModal(page);
  const customAId = await placeSelectedAtPercentAndGetIdMobile(page, 74);
  await expectActivityByIdValues(page, {
    id: customAId,
    expectedCode: 1147,
    expectedFrequencyKey: null,
    namePattern: /Werkstatt zuhause/i,
  });

  await deleteActivityByIdMobile(page, customAId);
  const customB = 'Basteln im Keller';
  await selectTopLevelByCodeMobile(page, 1147);
  await confirmDetailsModal({
    page,
    expectedInputVisible: true,
    expectedFrequencyVisible: false,
    customText: customB,
  });
  await closeActivitiesModal(page);
  const customBId = await placeSelectedAtPercentAndGetIdMobile(page, 80);
  await expectActivityByIdValues(page, {
    id: customBId,
    expectedCode: 1147,
    expectedFrequencyKey: null,
    namePattern: /Basteln im Keller/i,
  });
});
