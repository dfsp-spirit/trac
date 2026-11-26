// @ts-check
/**
 * Coming back from an external task.
 *
 * The provider returns the browser to the tasks page with the task key and the
 * participant's assigned token in the URL; redeeming that confirmation is the
 * client's job (spec §5), because the token is the participant's and the
 * provider has no direct channel to the API for it.
 *
 * This runs once, before the stage is read. Without it a participant who
 * finished a survey would come back to a page that still lists it as owed - and
 * their only way forward would be a "check again" button that never learns
 * anything, because nobody had sent the confirmation.
 *
 * A failure is not surfaced. A stale, forged or expired callback must not break
 * the tasks page: it still lists what is owed and offers the launch link, and
 * the server remains the only authority on what is confirmed.
 */
import { parseCallbackParams, withoutCallbackParams } from '../domain/externalTasks.js';

/**
 * @param {{
 *   api: { confirmExternalTask: (input: {
 *     taskKey: string, assignedToken: string, hmac?: string | null
 *   }) => Promise<any> } | null,
 *   session: any,
 *   search?: string,
 *   replaceUrl?: (search: string) => void,
 * }} deps `search` and `replaceUrl` exist so the flow can be driven without a
 *   browser; the app passes neither.
 * @returns {Promise<boolean>} whether the participant's state changed
 */
export async function confirmReturningTask({ api, session, search, replaceUrl }) {
  const callback = parseCallbackParams(search ?? window.location.search);
  if (!callback || !api) return false;

  /** @type {Array<{ task_key?: string, is_confirmed?: boolean }>} */
  const tasks = Array.isArray(session?.external_tasks) ? session.external_tasks : [];
  const task = tasks.find((item) => item.task_key === callback.taskKey);
  // The server already knows, so there is nothing to send and nothing to
  // re-read: a reload of the same URL stays a single GET.
  if (task?.is_confirmed) return false;

  try {
    await api.confirmExternalTask(callback);
  } catch (error) {
    console.warn('[external-task] the returned confirmation was not accepted:', error);
    return false;
  }

  // The token is a per-task credential. Keep the study, the participant and any
  // `return_url`; drop what has just been spent.
  const rewrite =
    replaceUrl ||
    ((/** @type {string} */ nextSearch) => {
      const url = new URL(window.location.href);
      url.search = nextSearch;
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    });
  rewrite(withoutCallbackParams(search ?? window.location.search));

  return true;
}
