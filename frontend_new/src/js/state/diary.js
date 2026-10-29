// @ts-check
/**
 * Diary actions: the only code that writes application state.
 *
 * Every write is optimistic in the sense that the local diary is updated from
 * the server's response, never predicted: the backend returns the rows it
 * created or changed, and those replace the local copy. That keeps one source of
 * truth (the server) while avoiding a full reload after each edit.
 */

import { toCreateItem } from '../domain/diary.js';
import { newUuid } from '../domain/uuid.js';

/**
 * @typedef {import('../domain/diary.js').ApiDiary} ApiDiary
 * @typedef {import('../domain/diary.js').ApiActivity} ApiActivity
 * @typedef {ReturnType<typeof import('../data/api.js').createApi>} Api
 * @typedef {ReturnType<typeof import('./store.js').createStore<any>>} Store
 */

/**
 * @param {any} result Response of POST /activities
 * @param {ApiDiary} diary
 * @returns {ApiDiary}
 */
function withCreated(result, diary) {
  /** @type {ApiActivity[]} */
  const created = result?.activities || [];
  const known = new Set(diary.activities.map((activity) => activity.client_uuid));
  const additions = created.filter((activity) => !known.has(activity.client_uuid));
  return { ...diary, activities: [...diary.activities, ...additions] };
}

/**
 * @param {string} clientUuid
 * @param {ApiActivity} updated
 * @param {ApiDiary} diary
 * @returns {ApiDiary}
 */
function withUpdated(clientUuid, updated, diary) {
  return {
    ...diary,
    activities: diary.activities.map((activity) =>
      activity.client_uuid === clientUuid ? { ...activity, ...updated } : activity
    ),
  };
}

/**
 * @param {Set<string>} uuids
 * @param {ApiDiary} diary
 * @returns {ApiDiary}
 */
function withoutUuids(uuids, diary) {
  return {
    ...diary,
    activities: diary.activities.filter((activity) => !uuids.has(activity.client_uuid)),
  };
}

/**
 * @param {{
 *   store: Store,
 *   api: Api,
 *   getLanguage: () => string,
 * }} deps
 */
export function createDiaryActions({ store, api, getLanguage }) {
  async function load() {
    store.set({ status: 'loading', error: null });
    try {
      const [diary, catalogue] = await Promise.all([
        api.getDiary(),
        api.getCatalogue(getLanguage()),
      ]);
      store.set((state) => ({
        ...state,
        status: 'ready',
        diary,
        catalogue,
        revision: (state.revision || 0) + 1,
        currentDay:
          state.currentDay != null && state.currentDay < diary.days.length
            ? state.currentDay
            : 0,
        error: null,
      }));
    } catch (error) {
      store.set({ status: 'error', error });
    }
  }

  /**
   * @param {{ items: any[], group_id?: string }} body
   * @returns {Promise<any>}
   */
  async function create(body) {
    store.set({ saveState: 'saving' });
    try {
      const result = await api.createActivities(body);
      store.set((state) => ({
        ...state,
        saveState: 'saved',
        diary: withCreated(result, state.diary),
        revision: (state.revision || 0) + 1,
      }));
      return result;
    } catch (error) {
      store.set({ saveState: 'error' });
      throw error;
    }
  }

  /**
   * @param {string} clientUuid
   * @param {Record<string, unknown>} changes
   * @returns {Promise<ApiActivity>}
   */
  async function update(clientUuid, changes) {
    store.set({ saveState: 'saving' });
    try {
      const updated = await api.updateActivity(clientUuid, changes);
      store.set((state) => ({
        ...state,
        saveState: 'saved',
        diary: withUpdated(clientUuid, updated, state.diary),
        revision: (state.revision || 0) + 1,
      }));
      return updated;
    } catch (error) {
      store.set({ saveState: 'error' });
      throw error;
    }
  }

  /**
   * @param {string} clientUuid
   * @returns {Promise<void>}
   */
  async function remove(clientUuid) {
    store.set({ saveState: 'saving' });
    try {
      await api.deleteActivity(clientUuid);
      store.set((state) => ({
        ...state,
        saveState: 'saved',
        diary: withoutUuids(new Set([clientUuid]), state.diary),
        revision: (state.revision || 0) + 1,
      }));
    } catch (error) {
      store.set({ saveState: 'error' });
      throw error;
    }
  }

  /**
   * @param {string} groupId
   * @param {string[]} uuids Rows of that group, from the local diary.
   * @returns {Promise<void>}
   */
  async function removeGroup(groupId, uuids) {
    store.set({ saveState: 'saving' });
    try {
      await api.deleteGroup(groupId);
      store.set((state) => ({
        ...state,
        saveState: 'saved',
        diary: withoutUuids(new Set(uuids), state.diary),
        revision: (state.revision || 0) + 1,
      }));
    } catch (error) {
      store.set({ saveState: 'error' });
      throw error;
    }
  }

  /**
   * Delete one row and hand back the undo. The undo is a plain function so the
   * caller decides when (and whether) it runs; nothing here knows about toasts.
   *
   * @param {ApiActivity} activity
   * @returns {Promise<() => Promise<void>>}
   */
  async function removeWithUndo(activity) {
    await remove(activity.client_uuid);
    return async () => {
      await create({ items: [toCreateItem(activity, newUuid())] });
    };
  }

  /**
   * Lock the diary (D20). The server is the authority on whether every day is
   * complete; when it refuses, its `days.incomplete` code lets the UI point at
   * the days instead of showing a generic failure.
   *
   * @returns {Promise<{ study_submitted_at: string, already_submitted: boolean, stage: string }>}
   */
  async function submit() {
    store.set({ saveState: 'saving' });
    try {
      const result = await api.submitDiary();
      store.set((state) => ({
        ...state,
        saveState: 'idle',
        diary: state.diary
          ? {
              ...state.diary,
              study: { ...state.diary.study, submitted_at: result.study_submitted_at },
            }
          : state.diary,
        revision: (state.revision || 0) + 1,
      }));
      return result;
    } catch (error) {
      store.set({ saveState: 'idle' });
      throw error;
    }
  }

  return { load, create, update, remove, removeWithUndo, removeGroup, submit };
}
