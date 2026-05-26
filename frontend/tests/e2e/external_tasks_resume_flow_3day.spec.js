const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1600, height: 900 } });

const PID = '6655507015767739';
const STUDY_NAME_ALIASES = new Set(['teststudy', 'dteststudy', 'default']);
const DAY_LABELS = [
  { name: 'monday', display_name: 'Monday', display_order: 0 },
  { name: 'tuesday', display_name: 'Tuesday', display_order: 1 },
  { name: 'wednesday', display_name: 'Wednesday', display_order: 2 },
];

function isManagedStudy(studyName) {
  return STUDY_NAME_ALIASES.has(studyName || '');
}

function getManagedActivitiesConfig() {
  return {
    general: {
      app_name: 'TRAC E2E',
      version: '1.0',
      language: 'en',
      // Keep this flow on index without instructions redirects.
      instructions: false,
    },
    timeline: {
      primary: {
        name: 'Primary Activity',
        description: '',
        mode: 'single-choice',
        min_coverage: 0,
        categories: [
          {
            name: 'General',
            activities: [
              {
                name: 'Sleeping',
                code: 1101,
                label: 'Sleeping',
                color: '#7c3aed',
                childItems: [],
              },
            ],
          },
        ],
      },
    },
  };
}

function buildBackendActivityItem(dayIndex, dayLabelName) {
  return {
    timeline_key: 'primary',
    timeline_mode: 'single-choice',
    activity: 'Sleeping',
    category: 'General',
    activity_code: 1101,
    parent_activity: null,
    parent_activity_code: null,
    is_custom_input: false,
    original_selection: null,
    selections: null,
    available_options: null,
    start_minutes: 600,
    end_minutes: 660,
    duration: 60,
    color: '#7c3aed',
    activity_id_backend: `${dayLabelName}-1101`,
    day_label_index: dayIndex,
    day_label: dayLabelName,
  };
}

async function addActivityAt50Percent(page) {
  await expect(page.locator('#activitiesContainer .activity-button').first()).toBeVisible();
  await page.locator('#activitiesContainer .activity-button').first().click();

  const activeTimelineContainer = page.locator(
    '.timeline-container[data-active="true"]'
  );
  await expect(activeTimelineContainer).toBeVisible();

  const markerLocator = activeTimelineContainer.locator('.timeline .hour-marker');
  await expect(markerLocator.first()).toBeVisible();

  const closestIndex = await markerLocator.evaluateAll((markers) => {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    markers.forEach((marker, index) => {
      const styleAttr = marker.getAttribute('style') || '';
      const leftMatch = styleAttr.match(/left\s*:\s*([\d.]+)%/i);
      const leftPercent = leftMatch ? parseFloat(leftMatch[1]) : NaN;
      if (!Number.isNaN(leftPercent)) {
        const distance = Math.abs(leftPercent - 50);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }
    });

    return bestIndex;
  });

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

async function submitCurrentDay(page) {
  const nextBtn = page.locator('#nextBtn');
  const confirmationModal = page.locator('#confirmationModal');

  await expect(nextBtn).toBeVisible();
  await expect(nextBtn).toBeEnabled();
  await nextBtn.click();

  if (await confirmationModal.isVisible()) {
    await page.locator('#confirmOk').click();
  }

  await page.waitForTimeout(800);
}

async function completeDayViaFrontendFetch(page, dayLabelName) {
  await page.evaluate(async (payload) => {
    const params = new URLSearchParams(window.location.search);
    const studyName = params.get('study_name');
    const pid = params.get('pid');
    const apiBaseUrl = window.TUD_SETTINGS?.API_BASE_URL || '/api';
    const endpoint = `${apiBaseUrl}/studies/${studyName}/participants/${pid}/day_labels/${payload.dayLabel}/activities`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        activities: [
          {
            timeline_key: 'primary',
            activity: 'Sleeping',
            category: 'General',
            start_minutes: 600,
            end_minutes: 660,
            mode: 'single-choice',
            code: 1101,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to complete day ${payload.dayLabel}: ${response.status}`);
    }
  }, { dayLabel: dayLabelName });
}

test('3-day resume flow with callback-confirmed and link-only external tasks', async ({
  page,
}) => {
  const state = {
    savedDayLabels: new Set(),
    callbackTaskConfirmed: false,
    callbackTaskConfirmedAt: null,
  };

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    // GET /api/studies/{study}/study-config
    let match = path.match(/\/api\/studies\/([^/]+)\/study-config$/);
    if (match && request.method() === 'GET') {
      const studyName = decodeURIComponent(match[1]);
      if (!isManagedStudy(studyName)) {
        await route.continue();
        return;
      }

      const completedStudy = state.savedDayLabels.size >= DAY_LABELS.length;
      const externalTasks = [
        {
          task_key: 'callback_payment',
          name: 'Payment Verification Task',
          description: 'Return from provider callback to confirm completion.',
          confirmation_type: 'callback',
          assigned_token: 'cb-6655507015767739',
          continuation_url: 'https://example.org/callback?token=cb-6655507015767739',
          is_confirmed: state.callbackTaskConfirmed,
          confirmed_at: state.callbackTaskConfirmed
            ? state.callbackTaskConfirmedAt || '2026-05-26T10:00:00Z'
            : null,
        },
        {
          task_key: 'followup_link',
          name: 'Follow-up Link Task',
          description: 'This task has no backend confirmation callback.',
          confirmation_type: 'none',
          assigned_token: 'lnk-6655507015767739',
          continuation_url: 'https://example.org/followup?token=lnk-6655507015767739',
          is_confirmed: false,
          confirmed_at: null,
        },
      ];

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          study_name: 'Playwright Resume Test Study',
          study_name_short: 'teststudy',
          description: '3-day e2e flow test',
          allow_unlisted_participants: false,
          require_consent: false,
          data_collection_start: '2024-01-01T00:00:00Z',
          data_collection_end: '2028-12-31T23:59:59Z',
          default_language: 'en',
          activities_json_url: '/unused.json',
          supported_languages: ['en'],
          selected_language: 'en',
          study_text_end_completed: 'Thanks for completing the study.',
          study_text_end_skipped: 'Skipped.',
          study_text_end_noconsent: 'No consent.',
          study_text_consent: null,
          consent_given: true,
          consent_decided_at: '2026-05-26T08:00:00Z',
          instructions_completed: true,
          instructions_completed_at: '2026-05-26T08:00:00Z',
          participant_has_completed_study: completedStudy,
          external_tasks: externalTasks,
          all_external_tasks_confirmed: externalTasks.every(
            (task) => task.is_confirmed === true
          ),
          timelines: [
            {
              name: 'primary',
              display_name: 'Primary Activity',
              description: '',
              mode: 'single-choice',
              min_coverage: 0,
            },
          ],
          day_labels: DAY_LABELS,
          study_days_count: DAY_LABELS.length,
        }),
      });
      return;
    }

    // GET /api/studies/{study}/activities-config
    match = path.match(/\/api\/studies\/([^/]+)\/activities-config$/);
    if (match && request.method() === 'GET') {
      const studyName = decodeURIComponent(match[1]);
      if (!isManagedStudy(studyName)) {
        await route.continue();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(getManagedActivitiesConfig()),
      });
      return;
    }

    // GET /api/studies/{study}/participants/{pid}/activities?day_label_index=...
    match = path.match(/\/api\/studies\/([^/]+)\/participants\/([^/]+)\/activities$/);
    if (match && request.method() === 'GET') {
      const studyName = decodeURIComponent(match[1]);
      const participantId = decodeURIComponent(match[2]);
      if (!isManagedStudy(studyName) || participantId !== PID) {
        await route.continue();
        return;
      }

      const requestedDayIndex = Number(url.searchParams.get('day_label_index') || '0');
      const safeDayIndex = Number.isFinite(requestedDayIndex)
        ? Math.max(0, Math.min(DAY_LABELS.length - 1, requestedDayIndex))
        : 0;
      const dayLabelName = DAY_LABELS[safeDayIndex].name;

      const activities = state.savedDayLabels.has(dayLabelName)
        ? [buildBackendActivityItem(safeDayIndex, dayLabelName)]
        : [];

      const dayIndicesWithData = DAY_LABELS.map((day, index) =>
        state.savedDayLabels.has(day.name) ? index : null
      ).filter((value) => value !== null);

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          study_name_short: 'teststudy',
          participant_id: PID,
          day_label_index: safeDayIndex,
          day_label: dayLabelName,
          activities,
          template_activities: [],
          template_source_day_label: null,
          day_indices_with_data: dayIndicesWithData,
          study_days_count: DAY_LABELS.length,
        }),
      });
      return;
    }

    // POST /api/studies/{study}/participants/{pid}/day_labels/{day}/activities
    match = path.match(
      /\/api\/studies\/([^/]+)\/participants\/([^/]+)\/day_labels\/([^/]+)\/activities$/
    );
    if (match && request.method() === 'POST') {
      const studyName = decodeURIComponent(match[1]);
      const participantId = decodeURIComponent(match[2]);
      const dayLabel = decodeURIComponent(match[3]);
      if (!isManagedStudy(studyName) || participantId !== PID) {
        await route.continue();
        return;
      }

      const postData = request.postDataJSON() || {};
      const activities = Array.isArray(postData.activities) ? postData.activities : [];
      if (activities.length > 0) {
        state.savedDayLabels.add(dayLabel);
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'Activities saved',
          participant_id: participantId,
          study_name_short: 'teststudy',
          day_label: dayLabel,
          activities_count: activities.length,
        }),
      });
      return;
    }

    // POST /api/studies/{study}/participants/{pid}/external-tasks/confirm
    match = path.match(
      /\/api\/studies\/([^/]+)\/participants\/([^/]+)\/external-tasks\/confirm$/
    );
    if (match && request.method() === 'POST') {
      const studyName = decodeURIComponent(match[1]);
      const participantId = decodeURIComponent(match[2]);
      if (!isManagedStudy(studyName) || participantId !== PID) {
        await route.continue();
        return;
      }

      state.callbackTaskConfirmed = true;
      state.callbackTaskConfirmedAt = '2026-05-26T10:00:00Z';

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          study_name_short: 'teststudy',
          participant_id: PID,
          task_key: 'callback_payment',
          confirmation_type: 'callback',
          is_confirmed: true,
          confirmed_at: state.callbackTaskConfirmedAt,
        }),
      });
      return;
    }

    // POST /api/studies/{study}/participants/{pid}/instructions/complete
    match = path.match(
      /\/api\/studies\/([^/]+)\/participants\/([^/]+)\/instructions\/complete$/
    );
    if (match && request.method() === 'POST') {
      const studyName = decodeURIComponent(match[1]);
      const participantId = decodeURIComponent(match[2]);
      if (!isManagedStudy(studyName) || participantId !== PID) {
        await route.continue();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          study_name_short: 'teststudy',
          participant_id: PID,
          instructions_completed: true,
          instructions_completed_at: '2026-05-26T08:00:00Z',
        }),
      });
      return;
    }

    await route.continue();
  });

  // 1) First visit: fill only first day, then stop.
  await page.goto(
    `index.html?pid=${PID}&study_name=teststudy&lang=en`,
    { waitUntil: 'domcontentloaded' }
  );

  await expect(page).toHaveURL(/index\.html/);
  await expect(page.locator('#currentDayDisplay')).toHaveAttribute('title', /Monday/);

  await addActivityAt50Percent(page);
  await submitCurrentDay(page);
  await expect(page.locator('#currentDayDisplay')).toHaveAttribute('title', /Tuesday/);

  // 2) Return via invitation link (user paused halfway) and continue editing.
  await page.goto(
    `index.html?pid=${PID}&study_name=dteststudy&lang=en`,
    { waitUntil: 'domcontentloaded' }
  );

  // Must still be able to edit (no forced end-page redirect yet).
  await expect(page).toHaveURL(/index\.html/);
  await expect(page).not.toHaveURL(/pages\/thank-you\.html/);

  // Do one more real UI edit/submit to verify editability after returning.
  await addActivityAt50Percent(page);
  await submitCurrentDay(page);

  // Complete remaining study days in mocked backend state.
  await completeDayViaFrontendFetch(page, 'tuesday');
  await completeDayViaFrontendFetch(page, 'wednesday');

  // User now reaches completion and starts first external task (callback task).
  await page.goto(
    `index.html?pid=${PID}&study_name=teststudy&lang=en&return_url=${encodeURIComponent('https://example.org/end-link')}`,
    { waitUntil: 'domcontentloaded' }
  );
  await expect(page).toHaveURL(/pages\/thank-you\.html/);

  const callbackTaskLink = page.locator(
    '#study-custom-message-end a.continue-link',
    { hasText: 'Payment Verification Task' }
  );
  await expect(callbackTaskLink).toBeVisible();

  // Simulate provider callback-return URL that confirms callback task.
  await page.goto(
    `pages/thank-you.html?pid=${PID}&study_name=teststudy&lang=en&completion_status=completed&callback_task_key=callback_payment&callback_token=cb-6655507015767739&return_url=${encodeURIComponent('https://example.org/end-link')}`,
    { waitUntil: 'domcontentloaded' }
  );
  await expect(page).toHaveURL(/pages\/thank-you\.html/);

  // 3) Return again via invitation link (as requested with study_name=default alias).
  await page.goto(
    `index.html?pid=${PID}&study_name=default&lang=en&return_url=${encodeURIComponent('https://example.org/end-link')}`,
    { waitUntil: 'domcontentloaded' }
  );

  // Must redirect to end page and show finished base task + finished callback task row.
  await expect(page).toHaveURL(/pages\/thank-you\.html/);

  const baseTaskRow = page.locator('#study-custom-message-end .follow-up-link-row', {
    hasText: 'Complete TRAC diary reporting',
  });
  await expect(baseTaskRow).toBeVisible();
  await expect(baseTaskRow).toContainText('Completed');

  const callbackTaskRow = page.locator('#study-custom-message-end .follow-up-link-row', {
    hasText: 'Payment Verification Task',
  });
  await expect(callbackTaskRow).toBeVisible();
  await expect(callbackTaskRow).toContainText('Already completed');
  await expect(
    page.locator('#study-custom-message-end a.continue-link', {
      hasText: 'Payment Verification Task',
    })
  ).toHaveCount(0);

  // Link-only task remains clickable because it has no completion callback.
  const followupLink = page.locator('#study-custom-message-end a.continue-link', {
    hasText: 'Follow-up Link Task',
  });
  await expect(followupLink).toBeVisible();
  await expect(followupLink).toHaveAttribute(
    'href',
    'https://example.org/followup?token=lnk-6655507015767739'
  );

  // End/return link should still be shown.
  const continueLink = page.locator('#study-custom-message-end a.continue-link', {
    hasText: 'Click here to continue.',
  });
  await expect(continueLink).toBeVisible();
  await expect(continueLink).toHaveAttribute('href', 'https://example.org/end-link');
});
