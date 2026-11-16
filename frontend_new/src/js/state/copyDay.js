// @ts-check
/**
 * Copying a day: the writes and the undo, split from the CRUD actions so both
 * files stay readable.
 *
 * The copy is the one write that both deletes and creates, so its undo has to do
 * both as well - remove what the copy added, put back what it replaced.
 */
import { toCreateItem } from '../domain/diary.js';
import { withCopied } from '../domain/diaryMerges.js';
import { newUuid } from '../domain/uuid.js';

/**
 * @typedef {import('../domain/diary.js').ApiDiary} ApiDiary
 * @typedef {import('../domain/diary.js').ApiActivity} ApiActivity
 * @typedef {ReturnType<typeof import('../data/api.js').createApi>} Api
 * @typedef {ReturnType<typeof import('./store.js').createStore<any>>} Store
 */

/**
 * @param {{
 *   store: Store,
 *   api: Api,
 *   onRefused?: (refusal: { stage: 'multi_day', codes: string[] }) => void,
 *   create: (body: { items: any[] }) => Promise<any>,
 *   remove: (clientUuid: string) => Promise<void>,
 *   removeGroup: (groupId: string, uuids: string[]) => Promise<void>,
 * }} deps
 */
export function createCopyActions({ store, api, onRefused, create, remove, removeGroup }) {
  /**
   * @param {unknown} error
   * @returns {string[]}
   */
  function refusalCodes(error) {
    const code = /** @type {{ code?: unknown }} */ (error)?.code;
    return typeof code === 'string' && code ? [code] : [];
  }

  /**
   * @param {{ source_day_index: number, target_day_indexes: number[] }} body
   * @returns {Promise<any>}
   */
  async function copyDay(body) {
    store.set({ saveState: 'saving' });
    try {
      const result = await api.copyDay(body);
      store.set((state) => ({
        ...state,
        saveState: 'saved',
        diary: withCopied(result, state.diary),
        revision: (state.revision || 0) + 1,
      }));
      return result;
    } catch (error) {
      store.set({ saveState: 'error' });
      onRefused?.({ stage: 'multi_day', codes: refusalCodes(error) });
      throw error;
    }
  }

  /**
   * Remove the rows the copy created and put the replaced ones back. Restoring
   * re-creates them under fresh identities, the same way the delete undo does,
   * because the originals are gone from the database.
   *
   * @param {any} result Response of `copyDay`.
   * @returns {Promise<void>}
   */
  async function undoCopy(result) {
    /** @type {ApiActivity[]} */
    const created = result?.activities || [];
    if (result?.group_id) {
      await removeGroup(
        result.group_id,
        created.map((activity) => activity.client_uuid)
      );
    } else {
      for (const activity of created) await remove(activity.client_uuid);
    }

    /** @type {ApiActivity[]} */
    const replaced = result?.replaced || [];
    if (replaced.length) {
      await create({ items: replaced.map((activity) => toCreateItem(activity, newUuid())) });
    }
  }

  return { copyDay, undoCopy };
}
