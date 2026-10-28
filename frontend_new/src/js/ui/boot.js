// @ts-check
/**
 * First question on load: where does this participant belong? (D37)
 *
 * One request, one answer, one route. The composition root used to hold this
 * inline, which is why it kept growing; the sequence itself is three lines of
 * logic and a message for each way it can fail.
 */

/**
 * @param {{
 *   api: { getStudyConfig: (language: string) => Promise<any> } | null,
 *   store: { set: (patch: object) => void, get: () => any },
 *   stageMachine: {
 *     show: (session: any) => void,
 *     fail: (message: string, options?: { title?: string, retry?: boolean }) => void,
 *   },
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   onLoaded?: (session: any) => void | Promise<void>,
 * }} deps
 */
export async function loadFirstStage({ api, store, stageMachine, t, onLoaded }) {
  if (!api) {
    // Not a failure: the page was opened without an invitation link. Say what to
    // do, and do not offer a reload that would land on the same page.
    stageMachine.fail(t('diary.stage.noInvitationText'), {
      title: t('diary.stage.noInvitationTitle'),
      retry: false,
    });
    return;
  }
  try {
    const session = await api.getStudyConfig(store.get().language);
    store.set({ status: 'ready' });
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
    stageMachine.fail(t('diary.stage.failedText'));
  }
}
