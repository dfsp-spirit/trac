// @ts-check
/**
 * First question on load: where does this participant belong? (D37)
 *
 * One request, one answer, one route. The composition root used to hold this
 * inline, which is why it kept growing; the sequence itself is three lines of
 * logic and a message for each way it can fail.
 *
 * One exception to "one request": a provider returning the participant from an
 * external task brings the confirmation in the URL, and the stage computed
 * before that confirmation is stale by definition. Redeeming it costs a second
 * GET, and only on that return.
 */
import { confirmReturningTask } from './externalTaskReturn.js';

class CookieRequiredError extends Error {}

/**
 * @param {{
 *   api: {
 *     getStudyConfig: (language: string) => Promise<any>,
 *     startSession: () => Promise<any>,
 *     verifySession: () => Promise<boolean>,
 *     confirmExternalTask: (input: {
 *       taskKey: string, assignedToken: string, hmac?: string | null
 *     }) => Promise<any>,
 *   } | null,
 *   store: { set: (patch: object) => void, get: () => any },
 *   stageMachine: {
 *     show: (session: any) => void,
 *     fail: (message: string, options?: { title?: string, retry?: boolean }) => void,
 *     entry: (studies: Array<{ name_short: string, name?: string | null, description?: string | null }>) => void,
 *   },
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   listStudies?: (language: string) => Promise<Array<{ name_short: string, name?: string | null, description?: string | null }>>,
 *   onLoaded?: (session: any) => void | Promise<void>,
 * }} deps
 */
export async function loadFirstStage({ api, store, stageMachine, t, listStudies, onLoaded }) {
  if (!api) {
    // No invitation link: the visitor is on the entry page. It lists the studies
    // that can be joined without one; when there are none, the plain "no
    // invitation" message is still the honest answer, and a reload cannot help.
    if (listStudies) {
      try {
        const studies = await listStudies(store.get().language);
        if (studies.length) {
          stageMachine.entry(studies);
          return;
        }
      } catch (error) {
        console.warn('[entry] could not load the study list:', error);
        stageMachine.fail(t('diary.stage.failedText'));
        return;
      }
    }
    stageMachine.fail(t('diary.stage.noInvitationText'), {
      title: t('diary.stage.noInvitationTitle'),
      retry: false,
    });
    return;
  }
  try {
    let session = await api.getStudyConfig(store.get().language);

    // The timeout is opt-in and off by default. When it is on, establish the
    // server session before the provider return is redeemed: that request is
    // protected too, and a long external task may have outlived the old cookie.
    if (Number(session.inactivity_timeout_minutes) > 0) {
      const started = await api.startSession();
      if (started?.active && !(await api.verifySession())) {
        throw new CookieRequiredError('session cookie was not stored');
      }
    }

    store.set({ status: 'ready' });

    // The stage above was computed before the provider's confirmation existed,
    // so redeeming it must be followed by the same question again.
    if (await confirmReturningTask({ api, session })) {
      session = await api.getStudyConfig(store.get().language);
    }

    // The payload names the study's own language and its `supported_languages`;
    // both have to reach the shell before the first view renders (D40).
    try {
      await onLoaded?.(session);
    } catch (error) {
      console.warn('[i18n] could not follow the study language:', error);
    }
    stageMachine.show(session);
  } catch (error) {
    store.set({ status: 'error', error });
    if (error instanceof CookieRequiredError) {
      stageMachine.fail(t('diary.stage.cookiesRequiredText'), {
        title: t('diary.stage.cookiesRequiredTitle'),
        retry: true,
      });
      return;
    }
    stageMachine.fail(t('diary.stage.failedText'));
  }
}
