// @ts-check
/**
 * The stage machine (D37): one place that turns "the server says the participant
 * is in stage X" into "this view is on screen and the URL says so".
 *
 * It owns the shell's visibility - the diary chrome (day navigation, progress,
 * submit, the add button, the three columns) belongs to the diary stage only - so
 * a consent page is not framed by controls that cannot do anything.
 *
 * It does not own the diary: when the stage is `diary` it calls back and lets the
 * diary mount itself once, because the diary has its own data, render loop and
 * save state.
 */
import { ROUTE_DIARY, routeForStage } from '../domain/router.js';
import { renderConsent } from './views/consent.js';
import { renderInstructions } from './views/instructions.js';
import { renderThanks } from './views/thanks.js';
import { renderTasks } from './views/tasks.js';
import { renderUnavailable } from './views/unavailable.js';

/**
 * @param {{
 *   router: ReturnType<typeof import('./router.js').createRouter>,
 *   host: HTMLElement,
 *   diaryChrome: HTMLElement[],
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   api: {
 *     getStudyConfig: (language: string) => Promise<any>,
 *     giveConsent: (given: boolean) => Promise<{ stage: string }>,
 *     completeInstructions: () => Promise<{ stage: string }>,
 *   } | null,
 *   getLanguage: () => string,
 *   onEnterDiary: () => void,
 * }} deps
 */
export function createStageMachine({
  router,
  host,
  diaryChrome,
  t,
  api,
  getLanguage,
  onEnterDiary,
}) {
  /** @type {any} */
  let session = null;
  /** @type {string | null} */
  let shownRoute = null;
  let diaryMounted = false;
  let locked = false;

  function requireApi() {
    if (!api) throw new Error('no participant');
    return api;
  }

  /** @param {HTMLElement} node @param {boolean} show */
  function showChrome(node, show) {
    if (show) node.removeAttribute('hidden');
    else node.hidden = true;
  }

  /** The diary's own visibility rule: its chrome is hidden by the stage, and by
   *  a submitted diary. */
  function applyChrome() {
    const diary = shownRoute === ROUTE_DIARY;
    for (const node of diaryChrome) showChrome(node, diary && !locked);
  }

  /** @param {string} stage */
  function applyStage(stage) {
    if (session) session.stage = stage;
    const route = router.settle(stage);
    render(route);
  }

  /** @param {string} route */
  function render(route) {
    shownRoute = route;
    const diary = route === ROUTE_DIARY;
    applyChrome();
    host.hidden = diary;
    if (diary) {
      if (!diaryMounted) {
        diaryMounted = true;
        onEnterDiary();
      }
      return;
    }
    if (!session) return;
    if (route === 'consent') {
      renderConsent(host, {
        session,
        t,
        onDecide: async (given) => {
          const result = await requireApi().giveConsent(given);
          applyStage(result.stage);
        },
      });
    } else if (route === 'instructions') {
      renderInstructions(host, {
        session,
        t,
        onComplete: async () => {
          const result = await requireApi().completeInstructions();
          applyStage(result.stage);
        },
      });
    } else if (route === 'tasks') {
      renderTasks(host, {
        session,
        t,
        onRefresh: async () => {
          session = await requireApi().getStudyConfig(getLanguage());
          applyStage(session.stage);
        },
      });
    } else if (route === 'thanks') {
      renderThanks(host, { session, t });
    } else {
      renderUnavailable(host, { session, t });
    }
  }

  return {
    /** @param {any} loaded The study-config payload, which carries `stage`. */
    show(loaded) {
      session = loaded;
      const requested = router.requested();
      // A deep link is honoured only when it names the stage the server reports,
      // so a hand-typed URL can never reveal a page that is not the participant's.
      const route = requested && requested === routeForStage(loaded.stage) ? requested : null;
      if (route) {
        router.go(route);
        render(route);
        return;
      }
      applyStage(loaded.stage);
    },

    /** @param {any} updated */
    update(updated) {
      session = updated;
      applyStage(updated.stage);
    },

    /** @param {string} stage Move to another stage without asking the server. */
    applyStage,

    /**
     * Show a plain message instead of any stage: no participant in the URL, a
     * stage that could not be loaded, a page that cannot exist.
     *
     * @param {string} message
     */
    fail(message) {
      for (const node of diaryChrome) node.hidden = true;
      shownRoute = null;
      host.hidden = false;
      host.replaceChildren();
      const page = host.ownerDocument.createElement('p');
      page.className = 't-hint';
      page.textContent = message;
      host.append(page);
    },

    /** @param {boolean} isLocked Whether the diary has been submitted. */
    setLocked(isLocked) {
      locked = isLocked;
      applyChrome();
    },

    currentRoute: () => shownRoute,
  };
}
