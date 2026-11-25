// @ts-check
/**
 * Which banners this browser has dismissed.
 *
 * This is the one module in the rewrite that touches device storage, and it
 * stores nothing but the opaque keys the server sends with each message. A
 * dismissal is a preference of the browser, not a fact about a participant:
 * there is no pid, no study name and no message text in here, so a shared
 * family tablet tells the server nothing about who read what.
 *
 * The key changes whenever the message is edited or switched back on, which is
 * how a new maintenance window reaches someone who dismissed the last one.
 * Storage that is unavailable or full (private mode, blocked cookies, quota)
 * simply means the banner comes back on the next page - the diary must never
 * break because a dismissal could not be saved.
 */

const STORAGE_KEY = 'trac.dismissedMessages.v1';
// A ledger, not a log: older keys are dropped once the list is this long. The
// server only ever shows two banners at a time.
const MAX_ENTRIES = 20;

/**
 * @typedef {{
 *   getItem: (key: string) => string | null,
 *   setItem: (key: string, value: string) => void,
 * }} KeyValueStorage
 */

/**
 * @param {KeyValueStorage | null | undefined} storage
 * @returns {string[]}
 */
function readKeys(storage) {
  try {
    const raw = storage ? storage.getItem(STORAGE_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * @param {KeyValueStorage | null | undefined} storage
 * @param {string[]} keys
 */
function writeKeys(storage, keys) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(keys.slice(-MAX_ENTRIES)));
  } catch {
    // Private mode or a full quota: the banner simply returns next time.
  }
}

/** @returns {KeyValueStorage | null} */
function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * @param {KeyValueStorage | null} [storage] Injecting one keeps the rules
 *   testable without a DOM; the default is this browser's localStorage.
 */
export function createDismissedMessages(storage = browserStorage()) {
  return {
    /** @param {string} key @returns {boolean} */
    has(key) {
      return readKeys(storage).includes(key);
    },

    /** @param {string} key */
    remember(key) {
      const keys = readKeys(storage).filter((existing) => existing !== key);
      keys.push(key);
      writeKeys(storage, keys);
    },
  };
}
