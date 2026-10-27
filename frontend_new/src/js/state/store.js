// @ts-check
/**
 * The application state. One object, owned here, read by every component.
 *
 * @typedef {Object} DiaryState
 * @property {'idle' | 'loading' | 'ready' | 'error'} status
 * @property {unknown} error
 * @property {import('../domain/diary.js').ApiDiary | null} diary
 * @property {any} catalogue
 * @property {number} currentDay
 * @property {'idle' | 'saving' | 'saved' | 'error'} saveState
 * @property {string} language
 * @property {boolean} shortcuts Whether the keyboard shortcuts respond (D31).
 * @property {number} revision Bumped by every change to the diary.
 */

/**
 * A store, not a framework: one state object, subscribers, and that is all.
 *
 * The point of the size is that components never hold application state. They
 * read it through `get()`, render, and report intent; the actions in
 * state/diary.js are the only writers.
 */

/**
 * @template S
 * @param {S} initial
 */
export function createStore(initial) {
  /** @type {S} */
  let state = initial;
  /** @type {Set<(state: S) => void>} */
  const listeners = new Set();

  return {
    /** @returns {S} */
    get: () => state,

    /**
     * Merge a patch, or replace the state with the result of a function.
     *
     * @param {Partial<S> | ((state: S) => S)} patch
     */
    set(patch) {
      state =
        typeof patch === 'function'
          ? /** @type {(state: S) => S} */ (patch)(state)
          : { ...state, ...patch };
      for (const listener of [...listeners]) listener(state);
    },

    /**
     * @param {(state: S) => void} listener
     * @returns {() => void}
     */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
