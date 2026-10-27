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
 *     fail: (message: string) => void,
 *   },
 *   t: (key: string, params?: Record<string, string | number>) => string,
 * }} deps
 */
export async function loadFirstStage({ api, store, stageMachine, t }) {
  if (!api) {
    stageMachine.fail(t('diary.error.noParticipant'));
    return;
  }
  try {
    const session = await api.getStudyConfig(store.get().language);
    store.set({ status: 'ready' });
    stageMachine.show(session);
  } catch (error) {
    store.set({ status: 'error', error });
    stageMachine.fail(t('diary.stage.failedText'));
  }
}
