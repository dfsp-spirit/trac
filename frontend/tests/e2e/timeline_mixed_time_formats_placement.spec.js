const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1600, height: 900 } });

test('can place new activity when existing entries use legacy date-prefixed times', async ({ page }) => {
  await page.goto('index.html?study_name=default&lang=en', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/pages\/instructions\.html/);
  await page.locator('#continueBtn').click();
  await expect(page).toHaveURL(/index\.html/);
  await expect(page.locator('.timeline-container[data-active="true"] .timeline').first()).toBeVisible({ timeout: 30000 });

  const result = await page.evaluate(() => {
    const key = window.timelineManager.keys[window.timelineManager.currentIndex];
    window.timelineManager.activities[key] = [
      {
        id: 'legacy_1',
        timelineKey: key,
        activity: 'Listening to Audio',
        category: 'Digital Media',
        startTime: '2025-11-06 07:10',
        endTime: '2025-11-06 09:40',
        blockLength: 150,
        color: '#FFE4B5',
        parentName: null,
        parentCode: null,
        isCustomInput: false,
        mode: 'single-choice',
        code: 2101,
        startMinutes: 430,
        endMinutes: 580,
      },
      {
        id: 'legacy_2',
        timelineKey: key,
        activity: 'Socialising',
        category: 'Social, Leisure & Hobbies',
        startTime: '2025-11-06 14:10',
        endTime: '2025-11-06 20:10',
        blockLength: 360,
        color: '#DDA0DD',
        parentName: null,
        parentCode: null,
        isCustomInput: false,
        mode: 'single-choice',
        code: 2140,
        startMinutes: 850,
        endMinutes: 1210,
      },
      {
        id: 'legacy_3',
        timelineKey: key,
        activity: 'Socialising',
        category: 'Social, Leisure & Hobbies',
        startTime: '2025-11-06 21:20',
        endTime: '2025-11-06 24:50',
        blockLength: 210,
        color: '#DDA0DD',
        parentName: null,
        parentCode: null,
        isCustomInput: false,
        mode: 'single-choice',
        code: 2140,
        startMinutes: 1280,
        endMinutes: 1490,
      },
    ];

    window.selectedActivity = {
      name: 'Socialising',
      category: 'Social, Leisure & Hobbies',
      color: '#DDA0DD',
      parentName: null,
      parentCode: null,
      selected: 'Socialising',
      isCustomInput: false,
      originalSelection: null,
      mode: 'single-choice',
      code: 2140,
    };

    const beforeCount = window.timelineManager.activities[key].length;
    const timeline = window.timelineManager.activeTimeline
      || document.querySelector('.timeline-container[data-active="true"] .timeline');
    if (!timeline) {
      return { beforeCount, count: beforeCount, newest: null, error: 'no-active-timeline' };
    }
    const rect = timeline.getBoundingClientRect();
    const clientX = rect.left + (rect.width * 0.1);
    const clientY = rect.top + (rect.height * 0.5);

    timeline.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
      })
    );

    const activities = window.timelineManager.activities[key];
    const newest = activities[activities.length - 1];

    return {
      beforeCount,
      count: activities.length,
      newest,
    };
  });

  expect(result.count).toBe(result.beforeCount + 1);
  expect(result.newest).toBeTruthy();
  expect(result.newest.startTime).toMatch(/^\d{2}:\d{2}(\(\+1\))?$/);
  expect(result.newest.endTime).toMatch(/^\d{2}:\d{2}(\(\+1\))?$/);
  expect(result.newest.startMinutes).toBeGreaterThanOrEqual(240);
  expect(result.newest.endMinutes).toBe(result.newest.startMinutes + 10);
});
