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

async function expandAllCategoriesInModal(page) {
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

async function clickTimelineAtPercentMobile(page, targetPercent) {
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

async function clickActivityInModalByText(page, textPattern) {
  await openActivitiesModal(page);
  await expandAllCategoriesInModal(page);
  const activityButton = page
    .locator('#modalActivitiesContainer .activity-button')
    .filter({ hasText: textPattern })
    .first();
  await expect(activityButton).toBeVisible();
  await activityButton.evaluate((button) => button.click());
  // Do not close modal — caller handles sub-modals
}

async function selectDirectSimpleMobile(page) {
  await clickActivityInModalByText(page, /Sleeping/i);
}

async function selectDirectCustomMobile(page, customText) {
  await clickActivityInModalByText(page, /Other Activity.*specify/i);

  const customModal = page.locator('#customActivityModal');
  await expect(customModal).toBeVisible();
  await page.locator('#customActivityInput').fill(customText);
  await page.locator('#confirmCustomActivity').click();
  await expect(customModal).toBeHidden();
}

async function selectFromSubmenuSimpleMobile(page) {
  await clickActivityInModalByText(page, /^Travelling$/i);

  const childItemsModal = page.locator('#childItemsModal');
  await expect(childItemsModal).toBeVisible();

  const walkingOption = page
    .locator('#childItemsContainer .child-item-button')
    .filter({ hasText: /Travelling:\s*walking/i })
    .first();
  await expect(walkingOption).toBeVisible();
  await walkingOption.click();
  await expect(childItemsModal).toBeHidden();
}

async function selectFromSubmenuCustomMobile(page, customText) {
  await clickActivityInModalByText(page, /^Gaming$/i);

  const childItemsModal = page.locator('#childItemsModal');
  await expect(childItemsModal).toBeVisible();

  let customConsoleOption = page
    .locator('#childItemsContainer .child-item-button[data-code="1221"]')
    .first();

  if ((await customConsoleOption.count()) === 0) {
    customConsoleOption = page
      .locator('#childItemsContainer .child-item-button')
      .filter({ hasText: /Console,\s*alone/i })
      .first();
  }

  await expect(customConsoleOption).toBeVisible();
  await customConsoleOption.click();

  const customModal = page.locator('#customActivityModal');
  await expect(customModal).toBeVisible();
  await page.locator('#customActivityInput').fill(customText);
  await page.locator('#confirmCustomActivity').click();
  await expect(customModal).toBeHidden();
}

async function addSelectedActivityAtPercentMobile(page, percent) {
  const countBefore = await page.evaluate(
    () => (window.timelineManager?.activities?.primary || []).length
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await clickTimelineAtPercentMobile(page, percent + attempt);

    const placed = await page
      .waitForFunction(
        (previousCount) =>
          (window.timelineManager?.activities?.primary || []).length >
          previousCount,
        countBefore,
        { timeout: 2500 }
      )
      .then(() => true)
      .catch(() => false);

    if (placed) {
      return;
    }
  }

  throw new Error(`Failed to place selected activity at around ${percent}%`);
}

async function expectSelectedActivity(page, expectedTextPattern) {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const selected = window.selectedActivity;
          if (!selected || !selected.name) {
            return '';
          }
          return String(selected.name);
        }),
      {
        timeout: 10000,
        message: 'Waiting for selected activity to be set',
      }
    )
    .toMatch(expectedTextPattern);
}

async function expectPrimaryTimelineDataContains(page, expectedActivities) {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const activities = window.timelineManager?.activities?.primary || [];
          return activities.map((activity) => String(activity.activity || ''));
        }),
      {
        timeout: 30000,
        message: 'Waiting for expected activities in primary timeline data',
      }
    )
    .toEqual(expect.arrayContaining(expectedActivities));
}

async function moveToSecondaryTimeline(page) {
  const nextBtn = page.locator('#nextBtn');
  await expect(nextBtn).toBeVisible();
  await expect(nextBtn).toBeEnabled();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await nextBtn.click();
    await page.waitForTimeout(700);

    const currentKey = await page.evaluate(
      () => window.timelineManager.keys[window.timelineManager.currentIndex]
    );
    if (currentKey === 'secondary') {
      return;
    }
  }

  await expect
    .poll(
      async () =>
        page.evaluate(
          () => window.timelineManager.keys[window.timelineManager.currentIndex]
        ),
      {
        timeout: 10000,
        message: 'Waiting to switch to secondary timeline',
      }
    )
    .toBe('secondary');
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

    const maybeUpdatedTitle =
      (await currentDayDisplay.getAttribute('title')) || '';
    if (maybeUpdatedTitle.includes(expectedNextDayName)) {
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

test('mobile: primary timeline supports direct/custom/submenu activities and templates to next day', async ({
  page,
}) => {
  const pid = `e2e-mob-activity-types-${Date.now()}-${Math.floor(
    Math.random() * 1_000_000
  )}`;
  const directCustomText = 'Other custom activity';
  const submenuCustomText = 'Mario Kart';
  const expectedDay1AndDay2Activities = [
    'Sleeping',
    directCustomText,
    'Travelling: walking',
    submenuCustomText,
  ];

  await page.goto(`index.html?study_name=default&lang=en&pid=${pid}`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page).toHaveURL(/pages\/instructions\.html/);
  await expect(page.locator('#continueBtn')).toBeVisible();
  await page.locator('#continueBtn').click();

  await expect(page).toHaveURL(/index\.html/);

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

  await expect(page.locator('#currentDayDisplay')).toHaveAttribute(
    'title',
    /Monday/
  );

  await selectDirectSimpleMobile(page);
  await closeActivitiesModal(page);
  await expectSelectedActivity(page, /Sleeping/i);
  await addSelectedActivityAtPercentMobile(page, 10);

  await selectDirectCustomMobile(page, directCustomText);
  await closeActivitiesModal(page);
  await expectSelectedActivity(page, new RegExp(directCustomText, 'i'));
  await addSelectedActivityAtPercentMobile(page, 30);

  await selectFromSubmenuSimpleMobile(page);
  await closeActivitiesModal(page);
  await expectSelectedActivity(page, /Travelling:\s*walking/i);
  await addSelectedActivityAtPercentMobile(page, 50);

  await selectFromSubmenuCustomMobile(page, submenuCustomText);
  await closeActivitiesModal(page);
  await expectSelectedActivity(page, new RegExp(submenuCustomText, 'i'));
  await addSelectedActivityAtPercentMobile(page, 70);

  await expectPrimaryTimelineDataContains(page, expectedDay1AndDay2Activities);
  const primaryActivitiesContainer = page.locator('#primary .activities');
  await expect(primaryActivitiesContainer).toContainText('Sleeping');
  await expect(primaryActivitiesContainer).toContainText(directCustomText);
  await expect(primaryActivitiesContainer).toContainText(
    /Travelling|Travelling:\s*walking/
  );
  await expect(primaryActivitiesContainer).toContainText(/Gaming|Mario Kart/);

  await moveToSecondaryTimeline(page);
  await submitCurrentDay(page, 'Tuesday');

  await expectPrimaryTimelineDataContains(page, expectedDay1AndDay2Activities);
});
