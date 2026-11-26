// @ts-check
/**
 * External tasks, as pure functions (D37, D41).
 *
 * Two things in the URL contract are the client's job and nothing else:
 * reading the callback parameters a provider returns with, and deciding what
 * one task in the payload looks like to a participant. Both are here so the
 * views and the boot sequence stay free of string parsing, and both are tested
 * without a browser.
 *
 * Which task is *allowed* is not decided here. `locked_reason` comes from the
 * server (`api.py::_get_participant_external_tasks`), which owns the rule that
 * every task of level n must be confirmed before level n + 1 opens, and that a
 * study requiring a diary keeps every task closed until it is submitted. The
 * client renders that answer; a second copy of the rule here would be a second
 * place to get it wrong.
 */

/** A finished task: the provider confirmed it, or the study never needed it. */
export const TASK_DONE = 'done';
/** A task the participant can open right now. */
export const TASK_OPEN = 'open';
/** A task the server says is closed, with the reason it gave. */
export const TASK_LOCKED = 'locked';

/** Callback parameters, per `docs/external-tasks-v2-spec.md` §5. */
const TASK_KEY_PARAMS = ['callback_task_key', 'task_key'];
const TOKEN_PARAMS = ['callback_token', 'token'];

/**
 * @typedef {{ taskKey: string, assignedToken: string, hmac: string | null }} CallbackParams
 * @typedef {{ state: 'done' | 'open' | 'locked', reason: 'task_level' | 'diary' | null }} TaskState
 */

/**
 * The confirmation a provider hands back when it returns the participant.
 *
 * Returns null unless both the task key and the token are present: a URL with
 * only one of them is not a callback, and guessing would confirm the wrong task.
 * The prefixed names win when both spellings appear, as documented.
 *
 * @param {string} search e.g. "?pid=bernd&callback_task_key=payment&callback_token=abc"
 * @returns {CallbackParams | null}
 */
export function parseCallbackParams(search) {
  const params = new URLSearchParams(search || '');
  const pick = (/** @type {string[]} */ keys) => {
    for (const key of keys) {
      const value = (params.get(key) || '').trim();
      if (value) return value;
    }
    return '';
  };

  const taskKey = pick(TASK_KEY_PARAMS);
  const assignedToken = pick(TOKEN_PARAMS);
  if (!taskKey || !assignedToken) return null;

  return { taskKey, assignedToken, hmac: pick(['hmac']) || null };
}

/**
 * Remove the callback parameters once they have been redeemed.
 *
 * The token is a credential for one task; leaving it in the address bar - and
 * in the history entry the participant may share - serves no purpose after the
 * server has accepted it. Everything else in the query string is kept.
 *
 * @param {string} search e.g. "?study=adult&pid=bernd&callback_task_key=payment"
 * @returns {string} e.g. "?study=adult&pid=bernd", or "" when nothing is left
 */
export function withoutCallbackParams(search) {
  const params = new URLSearchParams(search || '');
  for (const key of [...TASK_KEY_PARAMS, ...TOKEN_PARAMS, 'hmac']) {
    params.delete(key);
  }
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

/**
 * What the participant should see for one task.
 *
 * `locked_reason` is authoritative when present. The `continuation_url` check is
 * the fallback for a payload without it (an older server, or a task whose link
 * the server withheld for the same reason): a task with no link cannot be
 * opened, so rendering no link is the only honest option.
 *
 * @param {{ is_confirmed?: boolean, locked_reason?: string | null, continuation_url?: string }} task
 * @returns {TaskState}
 */
export function taskState(task) {
  if (task?.is_confirmed) return { state: TASK_DONE, reason: null };
  if (task?.locked_reason === 'diary') return { state: TASK_LOCKED, reason: 'diary' };
  if (task?.locked_reason === 'task_level') {
    return { state: TASK_LOCKED, reason: 'task_level' };
  }
  if (!task?.continuation_url) return { state: TASK_LOCKED, reason: 'task_level' };
  return { state: TASK_OPEN, reason: null };
}
