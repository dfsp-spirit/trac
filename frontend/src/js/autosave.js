// Autosave for the diary day.
//
// The day is saved as a whole snapshot (delete + re-insert server side), so the
// only thing this engine has to get right is *when* to send one. Rules, in order
// of importance:
//
//  1. **Never two saves at once.** Two overlapping snapshots for the same day can
//     interleave their delete/insert and duplicate or blank rows - the one real
//     corruption risk of autosaving. Everything funnels through a single in-flight
//     promise; changes that arrive during a save are coalesced into the next one.
//  2. **Never write when nothing changed.** The day is serialised and compared
//     with the last snapshot the server confirmed. This makes it safe to call
//     notePossibleChange() from anywhere (the diary calls it from
//     updateButtonStates(), which also runs for pure re-renders), and it stops
//     no-op writes - which matters beyond efficiency: every save re-creates the
//     rows, so a pointless write also moves the day's created_at and therefore
//     the participant's diary_completed_at.
//  3. **Debounce, with a ceiling.** A burst of edits (drag, resize, delete) turns
//     into one request, but continuous editing still saves at least every
//     maxWaitMs so the amount of work at risk stays bounded.
//  4. **Retry with backoff, and report state.** A failed autosave must be visible
//     (slice 3 renders it) rather than silently lost; the draft in local storage
//     remains the last line of defence.
//
// Nothing here touches the DOM or the network directly: `save` and `serialize`
// are injected, which is what makes the timing rules unit-testable.

export const AUTOSAVE_DEBOUNCE_MS = 2000;
export const AUTOSAVE_MAX_WAIT_MS = 10000;
export const AUTOSAVE_RETRY_DELAYS_MS = [2000, 5000, 15000];

/**
 * @param {object} options
 * @param {() => Promise<{success: boolean, error?: string}>} options.save
 *   Performs the actual save. Resolves `{success: false}` on failure.
 * @param {() => string} options.serialize Current day as a comparable string.
 * @param {() => void} [options.onSaved] Called after a successful save.
 * @param {(state: string) => void} [options.onStateChange] Called on transitions.
 * @param {() => number} [options.now]
 * @param {(fn: () => void, ms: number) => any} [options.setTimer]
 * @param {(id: any) => void} [options.clearTimer]
 * @param {number} [options.debounceMs]
 * @param {number} [options.maxWaitMs]
 * @param {number[]} [options.retryDelaysMs]
 * @param {{warn: (...args: any[]) => void}} [options.logger]
 */
export function createAutosave({
  save,
  serialize,
  onSaved = () => {},
  onStateChange = () => {},
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  debounceMs = AUTOSAVE_DEBOUNCE_MS,
  maxWaitMs = AUTOSAVE_MAX_WAIT_MS,
  retryDelaysMs = AUTOSAVE_RETRY_DELAYS_MS,
  logger = console,
} = {}) {
  if (typeof save !== 'function' || typeof serialize !== 'function') {
    throw new Error('createAutosave needs a save() and a serialize() function');
  }

  /** Last content the server confirmed (or that was loaded); null until known. */
  let baseline = null;
  let dirty = false;
  let state = 'idle';
  let debounceTimer = null;
  let maxWaitTimer = null;
  let retryTimer = null;
  let retryIndex = 0;
  /** In-flight save; at most one exists at a time. */
  let inFlight = null;
  let lastSavedAt = null;
  let disposed = false;

  function setState(next) {
    if (state === next) return;
    state = next;
    onStateChange(state);
  }

  function clearTimers() {
    if (debounceTimer !== null) {
      clearTimer(debounceTimer);
      debounceTimer = null;
    }
    if (maxWaitTimer !== null) {
      clearTimer(maxWaitTimer);
      maxWaitTimer = null;
    }
    if (retryTimer !== null) {
      clearTimer(retryTimer);
      retryTimer = null;
    }
  }

  function schedule(delayMs) {
    if (disposed) return;
    if (debounceTimer !== null) clearTimer(debounceTimer);
    debounceTimer = setTimer(() => {
      debounceTimer = null;
      void run();
    }, delayMs);

    // Ceiling for continuous editing: measured from the first unsaved change, so
    // it is only armed when there is no attempt pending yet.
    if (maxWaitTimer === null) {
      maxWaitTimer = setTimer(() => {
        maxWaitTimer = null;
        if (debounceTimer !== null) {
          clearTimer(debounceTimer);
          debounceTimer = null;
        }
        void run();
      }, maxWaitMs);
    }

    setState('pending');
  }

  /**
   * One save attempt. Serialises right before sending so a burst of edits is
   * sent as a single current snapshot rather than a stale one.
   * @returns {Promise<{success: boolean, saved: boolean, error?: string}>}
   */
  async function attempt() {
    const snapshot = serialize();
    if (snapshot === baseline) {
      dirty = false;
      clearTimers();
      setState('saved');
      return { success: true, saved: false };
    }

    setState('saving');
    const result = (await save()) || { success: false };

    if (result.success) {
      baseline = snapshot;
      lastSavedAt = now();
      retryIndex = 0;
      // Changes may have arrived while the request was in flight; those are not
      // part of what the server just stored.
      dirty = serialize() !== baseline;
      clearTimers();
      setState('saved');
      onSaved();
      if (dirty) schedule(debounceMs);
      return { success: true, saved: true };
    }

    dirty = true;
    setState('error');
    logger.warn?.('Autosave failed:', result.error || 'unknown error');
    const delay = retryDelaysMs[Math.min(retryIndex, retryDelaysMs.length - 1)];
    retryIndex += 1;
    if (retryTimer !== null) clearTimer(retryTimer);
    retryTimer = setTimer(() => {
      retryTimer = null;
      void run();
    }, delay);
    return { success: false, saved: true, error: result.error };
  }

  /** Runs attempts until the day is stored or an attempt fails. */
  async function run() {
    if (disposed) return { success: true, saved: false };
    if (inFlight) return inFlight; // single flight: never two snapshots at once
    inFlight = (async () => {
      try {
        let outcome = await attempt();
        while (outcome.success && dirty && !disposed) {
          outcome = await attempt();
        }
        return outcome;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return {
    /**
     * Tell the engine that the visible day may have changed. Cheap and safe to
     * over-call: an unchanged day results in no request at all.
     */
    notePossibleChange() {
      if (disposed) return;
      const snapshot = serialize();
      if (baseline === null) {
        // First observation is the reference point - typically the day the
        // backend just loaded. Saving here would write back what we just read.
        baseline = snapshot;
        return;
      }
      if (snapshot === baseline) return; // pure re-render, nothing to store
      dirty = true;
      // A retry is already scheduled; let it run instead of re-arming timers.
      if (retryTimer !== null) return;
      schedule(debounceMs);
    },

    /**
     * Persist whatever is pending right now and wait for it.
     * Used before anything that leaves the page or changes day.
     * @returns {Promise<{success: boolean, saved: boolean, error?: string}>}
     */
    async flush() {
      if (disposed) return { success: true, saved: false };
      clearTimers();
      if (inFlight) {
        const pending = await inFlight;
        if (!pending.success) return pending;
      }
      if (!dirty) {
        // Nothing pending: the server already holds this day.
        if (state === 'pending' || state === 'saving') setState('saved');
        return { success: true, saved: false };
      }
      return run();
    },

    /**
     * Record that the current content is stored (after an explicit save, e.g. the
     * Save Day button or the source-day save of a copy) so it is not written
     * again by the next autosave.
     */
    markSaved() {
      baseline = serialize();
      dirty = false;
      lastSavedAt = now();
      retryIndex = 0;
      clearTimers();
      setState('saved');
    },

    /** Discard the reference point, e.g. when another day is loaded. */
    resetBaseline() {
      baseline = serialize();
      dirty = false;
      clearTimers();
      setState('idle');
    },

    dispose() {
      disposed = true;
      clearTimers();
    },

    state: () => state,
    isSaving: () => inFlight !== null,
    hasPendingChanges: () => dirty,
    lastSavedAt: () => lastSavedAt,
  };
}
