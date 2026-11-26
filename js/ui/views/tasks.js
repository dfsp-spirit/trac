// @ts-check
/**
 * The `tasks` stage (D37): what the study still wants after the diary.
 *
 * Each task links straight to the study's outbound URL through the launch
 * endpoint, which logs the launch and redirects. Confirmation happens on the
 * provider's side and comes back to the API, so this page never decides that a
 * task is done - it lists what the server reports and offers to ask again.
 *
 * Nor does it decide what may be opened. The server sends `locked_reason` per
 * task: every task of level n must be confirmed before level n + 1 opens, and a
 * study that requires the diary keeps all of them closed until it is submitted
 * (a payment task is the reason that setting exists). A locked task is rendered
 * as a lock with the reason, never as a link that goes nowhere.
 */
import { taskState, TASK_DONE, TASK_LOCKED } from '../../domain/externalTasks.js';
import { el, button, icon } from '../dom.js';
import { renderPage } from '../page.js';

const CHECK = ['M5 13l4 4L19 7'];
const LOCK = [
  'M7 11V8a5 5 0 0 1 10 0v3',
  'M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z',
];

/** @type {Record<'task_level' | 'diary', string>} */
const LOCKED_KEY = {
  task_level: 'diary.stage.taskLockedLevel',
  diary: 'diary.stage.taskLockedDiary',
};

/**
 * @param {HTMLElement} host
 * @param {{
 *   session: any,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   onRefresh: () => Promise<void>,
 * }} view
 */
export function renderTasks(host, { session, t, onRefresh }) {
  const tasks = Array.isArray(session.external_tasks) ? session.external_tasks : [];

  const list = el('ul', 't-task-list');
  for (const task of tasks) {
    const item = el('li', 't-task');
    const body = el('div', 't-task__body');
    body.append(el('span', 't-task__name', task.name));
    if (task.description) body.append(el('span', 't-task__hint', task.description));
    item.append(body);

    const state = taskState(task);
    if (state.state === TASK_DONE) {
      const done = el('span', 't-task__done');
      done.append(icon(CHECK));
      done.append(el('span', 't-vh', t('diary.stage.taskDone')));
      item.append(done);
    } else if (state.state === TASK_LOCKED) {
      // The reason is visible text, not a visually-hidden label: a padlock on
      // its own does not tell anyone what to do about it.
      const locked = el('span', 't-task__locked');
      locked.append(icon(LOCK));
      locked.append(el('span', null, t(LOCKED_KEY[state.reason || 'task_level'])));
      item.append(locked);
    } else {
      const open = el('a', 't-btn t-btn--secondary t-btn--sm', t('diary.stage.taskOpen'));
      open.href = task.continuation_url;
      open.rel = 'noopener';
      item.append(open);
    }
    list.append(item);
  }

  const again = button('primary', t('diary.stage.tasksRefresh'), () => void refresh());

  renderPage(host, {
    eyebrow: session.study_name,
    title: t('diary.stage.tasksTitle'),
    lead: t('diary.stage.tasksLead'),
    body: [list],
    actions: [again],
  });

  async function refresh() {
    again.disabled = true;
    try {
      await onRefresh();
    } finally {
      again.disabled = false;
    }
  }
}
