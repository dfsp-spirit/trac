const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1600, height: 900 } });

async function waitForActivitiesLoaded(page) {
  await expect
    .poll(
      async () => page.locator('#activitiesContainer .activity-button').count(),
      {
        timeout: 30000,
        message: 'Waiting for activity buttons to load',
      }
    )
    .toBeGreaterThan(0);
}

async function getCurrentTimelineKey(page) {
  return page.evaluate(
    () => window.timelineManager.keys[window.timelineManager.currentIndex]
  );
}

async function clickTimelineAtPercent(page, targetPercent) {
  await page.waitForTimeout(350);

  const timeline = page
    .locator('.timeline-container[data-active="true"] .timeline')
    .first();
  await expect(timeline).toBeVisible();

  const box = await timeline.boundingBox();
  expect(box).not.toBeNull();

  const x = box.x + (box.width * targetPercent) / 100;
  const y = box.y + box.height / 2;

  await page.mouse.click(x, y);
}

async function selectActivity(
  page,
  { preferredCode = null, excludeCode = null } = {}
) {
  await waitForActivitiesLoaded(page);

  if (preferredCode !== null) {
    const preferred = page.locator(
      `#activitiesContainer .activity-button[data-code="${preferredCode}"]`
    );
    if (await preferred.count()) {
      await preferred.first().click();
      await expect
        .poll(
          async () =>
            page.evaluate(() => window.selectedActivity?.code ?? null),
          {
            timeout: 3000,
            message: 'Waiting for preferred activity selection',
          }
        )
        .toBe(preferredCode);
      return;
    }
  }

  const candidates = page.locator(
    '#activitiesContainer .activity-button:visible:not(.has-child-items):not(.custom-input)'
  );
  const count = await candidates.count();

  for (let i = 0; i < count; i += 1) {
    const candidate = candidates.nth(i);
    const codeAttr = await candidate.getAttribute('data-code');
    const code = codeAttr === null ? null : parseInt(codeAttr, 10);

    if (excludeCode !== null && code === excludeCode) {
      continue;
    }

    await candidate.click();
    return;
  }

  await page
    .locator('#activitiesContainer .activity-button:visible')
    .first()
    .click();
}

async function addActivityAtPercentAndGetId(page, percent, selection = {}) {
  const before = await page.evaluate(() => {
    const key =
      window.timelineManager.keys[window.timelineManager.currentIndex];
    const ids = (window.timelineManager.activities[key] || []).map((a) =>
      String(a.id)
    );
    return { key, ids };
  });

  await selectActivity(page, selection);
  await clickTimelineAtPercent(page, percent);

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
    const activities = window.timelineManager.activities[key] || [];
    const newActivity = activities.find(
      (a) => !beforeIds.includes(String(a.id))
    );
    return {
      id: String(newActivity.id),
      code: newActivity.code ?? null,
      activity: newActivity.activity,
      timelineKey: key,
    };
  }, before.ids);
}

async function goToSecondaryTimeline(page) {
  const nextBtn = page.locator('#nextBtn');
  await expect(nextBtn).toBeVisible();
  await expect(nextBtn).toBeEnabled();
  await nextBtn.click();

  await expect
    .poll(async () => getCurrentTimelineKey(page), {
      timeout: 10000,
      message: 'Waiting to switch to secondary timeline',
    })
    .toBe('secondary');
}

async function switchToTimelineKey(page, timelineKey) {
  const current = await getCurrentTimelineKey(page);
  if (current === timelineKey) return;

  const timelineContainer = page
    .locator(`.timeline-container:has(#${timelineKey})`)
    .first();
  await expect(timelineContainer).toBeVisible({ timeout: 10000 });
  await timelineContainer.click();

  await expect
    .poll(async () => getCurrentTimelineKey(page), {
      timeout: 10000,
      message: `Waiting to switch to timeline '${timelineKey}'`,
    })
    .toBe(timelineKey);
}

async function submitCurrentDay(page, expectedNextDayName) {
  const nextBtn = page.locator('#nextBtn');
  const confirmationModal = page.locator('#confirmationModal');
  const currentDayDisplay = page.locator('#currentDayDisplay');

  await expect(nextBtn).toBeVisible();
  await expect(nextBtn).toBeEnabled();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await nextBtn.click();

    if (await confirmationModal.isVisible()) {
      await page.locator('#confirmOk').click();
      break;
    }

    const title = (await currentDayDisplay.getAttribute('title')) || '';
    if (title.includes(expectedNextDayName)) {
      break;
    }

    await page.waitForTimeout(700);
  }

  await expect(currentDayDisplay).toHaveAttribute(
    'title',
    new RegExp(expectedNextDayName),
    {
      timeout: 30000,
    }
  );
}

async function waitForTimelineStateCounts(
  page,
  { primaryMin = 1, secondaryMin = 1 } = {}
) {
  await expect
    .poll(
      async () => {
        const counts = await page.evaluate(() => {
          const primary = window.timelineManager.activities.primary || [];
          const secondary = window.timelineManager.activities.secondary || [];
          return {
            primaryCount: primary.length,
            secondaryCount: secondary.length,
          };
        });

        return (
          counts.primaryCount >= primaryMin &&
          counts.secondaryCount >= secondaryMin
        );
      },
      {
        timeout: 10000,
        message: 'Waiting for next-day timeline state to finish loading',
      }
    )
    .toBeTruthy();
}

async function deleteActivityByIdUsingDeleteKey(page, timelineKey, activityId) {
  await switchToTimelineKey(page, timelineKey);

  const block = page
    .locator(
      `.timeline-container[data-active="true"] .activity-block[data-id="${activityId}"]`
    )
    .first();
  await expect(block).toBeVisible();

  await block.hover();
  await page.keyboard.press('Delete');

  await expect(block).toHaveCount(0);

  await expect
    .poll(
      async () => {
        return page.evaluate(
          ({ key, id }) => {
            const activities = window.timelineManager.activities[key] || [];
            return activities.some((a) => String(a.id) === String(id));
          },
          { key: timelineKey, id: activityId }
        );
      },
      {
        timeout: 5000,
        message:
          'Waiting for deleted activity to be removed from timeline state',
      }
    )
    .toBeFalsy();
}

test('delete template activity on Tuesday, replace same slot, and propagate correctly to Wednesday', async ({
  page,
}) => {
  await page.goto('index.html?study_name=default&lang=en', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page).toHaveURL(/pages\/instructions\.html/);
  await page.locator('#continueBtn').click();
  await page.waitForURL(/index\.html/, { timeout: 15000 });
  await expect(page.locator('#currentDayDisplay')).toHaveAttribute(
    'title',
    /Monday/
  );

  const mondayPrimary = await addActivityAtPercentAndGetId(page, 25, {
    preferredCode: 1101,
  });

  await goToSecondaryTimeline(page);
  const mondaySecondary = await addActivityAtPercentAndGetId(page, 70, {});

  expect(mondayPrimary.timelineKey).toBe('primary');
  expect(mondaySecondary.timelineKey).toBe('secondary');

  await submitCurrentDay(page, 'Tuesday');
  await waitForTimelineStateCounts(page);

  const tuesdayInitial = await page.evaluate(() => {
    const primary = window.timelineManager.activities.primary || [];
    const secondary = window.timelineManager.activities.secondary || [];
    return {
      primaryCount: primary.length,
      secondaryCount: secondary.length,
      primary: primary.map((a) => ({
        id: String(a.id),
        code: a.code ?? null,
        activity: a.activity,
      })),
      secondary: secondary.map((a) => ({
        id: String(a.id),
        code: a.code ?? null,
        activity: a.activity,
      })),
    };
  });

  expect(tuesdayInitial.primaryCount).toBeGreaterThan(0);
  expect(tuesdayInitial.secondaryCount).toBeGreaterThan(0);

  const tuesdayPrimaryTemplate = tuesdayInitial.primary[0];
  expect(tuesdayPrimaryTemplate).toBeTruthy();

  await deleteActivityByIdUsingDeleteKey(
    page,
    'primary',
    tuesdayPrimaryTemplate.id
  );

  const afterDeleteCount = await page.evaluate(
    () => (window.timelineManager.activities.primary || []).length
  );
  expect(afterDeleteCount).toBe(tuesdayInitial.primaryCount - 1);

  const replacement = await addActivityAtPercentAndGetId(page, 25, {
    excludeCode: tuesdayPrimaryTemplate.code,
  });
  expect(replacement.timelineKey).toBe('primary');

  const afterReplaceCount = await page.evaluate(
    () => (window.timelineManager.activities.primary || []).length
  );
  expect(afterReplaceCount).toBe(tuesdayInitial.primaryCount);

  await switchToTimelineKey(page, 'secondary');
  await submitCurrentDay(page, 'Wednesday');
  await waitForTimelineStateCounts(page);

  const wednesdayState = await page.evaluate(() => {
    const primary = window.timelineManager.activities.primary || [];
    const secondary = window.timelineManager.activities.secondary || [];

    return {
      primaryCount: primary.length,
      secondaryCount: secondary.length,
      primaryCodes: primary.map((a) => a.code ?? null),
      primaryNames: primary.map((a) => a.activity),
      secondaryCountFromState: secondary.length,
    };
  });

  expect(wednesdayState.primaryCount).toBeGreaterThan(0);
  expect(wednesdayState.secondaryCount).toBeGreaterThan(0);

  if (tuesdayPrimaryTemplate.code !== null) {
    expect(
      wednesdayState.primaryCodes.includes(tuesdayPrimaryTemplate.code)
    ).toBeFalsy();
  } else {
    expect(
      wednesdayState.primaryNames.includes(tuesdayPrimaryTemplate.activity)
    ).toBeFalsy();
  }

  if (replacement.code !== null) {
    expect(wednesdayState.primaryCodes.includes(replacement.code)).toBeTruthy();
  } else {
    expect(
      wednesdayState.primaryNames.includes(replacement.activity)
    ).toBeTruthy();
  }
});
