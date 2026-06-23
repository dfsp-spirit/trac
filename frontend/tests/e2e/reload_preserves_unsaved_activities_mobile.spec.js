const { test, expect } = require('@playwright/test');

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

async function enterDiaryIfNeeded(page) {
  const continueBtn = page.locator('#continueBtn');
  const hasInstructionsStart = await continueBtn
    .waitFor({ state: 'visible', timeout: 3000 })
    .then(() => true)
    .catch(() => false);

  if (hasInstructionsStart) {
    await continueBtn.click();
    await page.waitForLoadState('domcontentloaded');
  }
}

async function clickHourMarkerClosestToPercentMobile(page, targetPercent) {
  const activeTimelineContainer = page.locator(
    '.timeline-container[data-active="true"]'
  );
  await expect(activeTimelineContainer).toBeVisible();

  const markerLocator = activeTimelineContainer.locator(
    '.timeline .hour-marker'
  );
  await expect(markerLocator.first()).toBeVisible();

  const markerCount = await markerLocator.count();
  expect(markerCount).toBeGreaterThan(0);

  const closestIndex = await markerLocator.evaluateAll((markers, percent) => {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    markers.forEach((marker, index) => {
      const styleAttr = marker.getAttribute('style') || '';
      const topMatch = styleAttr.match(/top\s*:\s*([\d.]+)%/i);
      const topPercent = topMatch ? parseFloat(topMatch[1]) : NaN;
      if (!Number.isNaN(topPercent)) {
        const distance = Math.abs(topPercent - percent);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }
    });

    return bestIndex;
  }, targetPercent);

  await markerLocator.nth(closestIndex).evaluate((marker) => {
    marker.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
      })
    );
  });
}

async function selectFirstVisibleActivityFromModal(page) {
  await openActivitiesModal(page);

  const placeable = page.locator(
    '#modalActivitiesContainer .activity-button:visible:not(.has-child-items):not(.custom-input)'
  );

  if (await placeable.count()) {
    await placeable.first().evaluate((button) => button.click());
  } else {
    const firstVisible = page
      .locator('#modalActivitiesContainer .activity-button:visible')
      .first();
    await expect(firstVisible).toHaveCount(1);
    await firstVisible.evaluate((button) => button.click());
  }

  await closeActivitiesModal(page);

  await expect
    .poll(async () => page.evaluate(() => !!window.selectedActivity), {
      timeout: 3000,
      message: 'Waiting for selected activity state after button click',
    })
    .toBeTruthy();
}

async function addActivityAtPercentAndGetIdMobile(page, percent) {
  const before = await page.evaluate(() => {
    const key =
      window.timelineManager.keys[window.timelineManager.currentIndex];
    const ids = (window.timelineManager.activities[key] || []).map((a) =>
      String(a.id)
    );
    return { key, ids };
  });

  await selectFirstVisibleActivityFromModal(page);
  await clickHourMarkerClosestToPercentMobile(page, percent);

  await expect
    .poll(
      async () => {
        return page.evaluate((beforeIds) => {
          const key =
            window.timelineManager.keys[window.timelineManager.currentIndex];
          const ids = (window.timelineManager.activities[key] || []).map((a) =>
            String(a.id)
          );
          return ids.find((id) => !beforeIds.includes(id)) || null;
        }, before.ids);
      },
      {
        timeout: 5000,
        message:
          'Waiting for newly placed activity to appear in timeline state',
      }
    )
    .not.toBeNull();

  return page.evaluate((beforeIds) => {
    const key =
      window.timelineManager.keys[window.timelineManager.currentIndex];
    const ids = (window.timelineManager.activities[key] || []).map((a) =>
      String(a.id)
    );
    return ids.find((id) => !beforeIds.includes(id)) || null;
  }, before.ids);
}

test('mobile: reload preserves unsaved timeline activities from local draft state', async ({
  page,
}) => {
  const pid = `reload_draft_mob_${Date.now()}`;
  const url = `index.html?study_name=default&lang=en&day_label_index=0&pid=${pid}`;

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await enterDiaryIfNeeded(page);

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

  const timeline = page
    .locator('.timeline-container[data-active="true"] .timeline')
    .first();
  await expect(timeline).toBeVisible();

  const activityId = await addActivityAtPercentAndGetIdMobile(page, 30);
  expect(activityId).toBeTruthy();

  const block = page
    .locator(
      `.timeline-container[data-active="true"] .activity-block[data-id="${activityId}"]`
    )
    .first();
  await expect(block).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await enterDiaryIfNeeded(page);
  await expect(timeline).toBeVisible();

  const restoredBlock = page
    .locator(
      `.timeline-container[data-active="true"] .activity-block[data-id="${activityId}"]`
    )
    .first();
  await expect(restoredBlock).toBeVisible();

  await expect
    .poll(
      async () => {
        return page.evaluate((id) => {
          const key =
            window.timelineManager.keys[window.timelineManager.currentIndex];
          const activities = window.timelineManager.activities[key] || [];
          return activities.some((a) => String(a.id) === String(id));
        }, activityId);
      },
      {
        timeout: 5000,
        message:
          'Waiting for restored activity to appear in timeline state after reload',
      }
    )
    .toBeTruthy();
});
