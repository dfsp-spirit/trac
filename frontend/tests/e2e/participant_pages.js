// Single source of truth for the participant-facing pages that the guard specs
// sweep (static assets, accessibility, mobile layout). Adding a participant page
// here gets it checked by all of them.
//
// `url` is relative to the Playwright baseURL; `ready` is an element that only
// exists once the page has rendered its real content, so the specs do not test a
// half-built page.
//
// `enterStudy` marks the diary, which can bounce through consent/instructions
// before it renders. The sweep specs then use openParticipantPage(), which
// drives it with enterStudyIfNeeded(); waiting for `ready` where the redirect
// happened to land was a race - `#mainContent` also exists on the instructions
// page, so the first assertion could run mid-navigation and die with
// "Execution context was destroyed, most likely because of a navigation".
const PARTICIPANT_PAGES = [
  {
    name: 'instructions (en)',
    url: 'pages/instructions.html?study_name=default&lang=en',
    ready: '#continueBtn',
  },
  {
    name: 'instructions (de)',
    url: 'pages/instructions.html?study_name=default&lang=de',
    ready: '#continueBtn',
  },
  {
    name: 'consent (de)',
    url: 'pages/consent.html?study_name=adult_pilot_de&lang=de',
    ready: '#consentAcceptBtn',
  },
  {
    name: 'diary (en)',
    url: 'index.html?study_name=default&lang=en&instructions=completed',
    ready: '#currentDayDisplay',
    enterStudy: true,
  },
  {
    name: 'diary (de)',
    url: 'index.html?study_name=adult_pilot_de&lang=de&instructions=completed',
    ready: '#currentDayDisplay',
    enterStudy: true,
  },
  {
    name: 'open studies',
    url: 'pages/open_studies.html',
    ready: '#studiesList',
  },
  {
    name: 'timeout (de)',
    url: 'pages/timeout.html?lang=de',
    ready: '#timeoutMessage',
  },
  {
    name: 'thank you (en)',
    url: 'pages/thank-you.html?study_name=default&lang=en',
    ready: '#study-custom-message-end',
  },
  {
    name: 'tasks',
    url: 'pages/tasks.html?lang=en',
    ready: '#tasks-heading',
  },
];

// A phone viewport, used by the specs that care about the mobile rendering path
// (the app switches layout below 1440px).
const MOBILE_VIEWPORT = { width: 390, height: 844 };

module.exports = { PARTICIPANT_PAGES, MOBILE_VIEWPORT };
