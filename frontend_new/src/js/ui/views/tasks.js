// @ts-check
/**
 * The `tasks` stage (D37): what the study still wants after the diary.
 *
 * Each task links straight to the study's outbound URL through the launch
 * endpoint, which logs the launch and redirects. Confirmation happens on the
 * provider's side and comes back to the API, so this page never decides that a
 * task is done - it lists what the server reports and offers to ask again.
 */
import { el, button, icon } from '../dom.js';
import { renderPage } from '../page.js';

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

    if (task.is_confirmed) {
      const done = el('span', 't-task__done');
      done.append(icon(['M5 13l4 4L19 7']));
      done.append(el('span', 't-vh', t('diary.stage.taskDone')));
      item.append(done);
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
