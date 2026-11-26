// @ts-check
/**
 * What runs once, right after the shell is wired.
 *
 * Extracted from the composition root for the same reason `loadFirstStage` was
 * (D33 rule 7): the load sequence is a sequence, not a list of `connect()`
 * calls, and it keeps growing. Keeping it here is also what keeps main.js under
 * its size cap once one more thing needs loading at startup.
 */
import { loadFirstStage } from './boot.js';

/**
 * @param {{
 *   language: string,
 *   languageSwitch: {
 *     setLanguage: (language: string) => Promise<void>,
 *     adoptStudyLanguage: (session: any, explicit: string | null | undefined) => Promise<void>,
 *   },
 *   api: any,
 *   store: { set: (patch: object) => void, get: () => any },
 *   stageMachine: any,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   identity: { language: string | null },
 *   reportClientInfo: (api: any, session: any) => void,
 *   listStudies: (language: string) => Promise<Array<{ name_short: string }>>,
 * }} deps
 */
export async function startSession({
  language,
  languageSwitch,
  api,
  store,
  stageMachine,
  t,
  identity,
  reportClientInfo,
  listStudies,
}) {
  try {
    await languageSwitch.setLanguage(language);
  } catch (error) {
    console.error('[i18n] falling back to the markup text:', error);
  }

  // One question, one answer: the server says which stage this participant is
  // in, and the stage machine routes to it (D37). The same answer says which
  // language the study speaks (D40).
  await loadFirstStage({
    api,
    store,
    stageMachine,
    t,
    listStudies,
    onLoaded: async (session) => {
      reportClientInfo(api, session);
      await languageSwitch.adoptStudyLanguage(session, identity.language);
    },
  });
}
