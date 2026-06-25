/**
 * idle_timeout.js — Inactivity timeout with two-phase visual countdown.
 *
 * Detects user inactivity across mouse, keyboard, touch, and scroll events.
 * After configurable minutes of inactivity, redirects to a timeout page via
 * location.replace() to strip the diary from session history and lose the pid.
 *
 * UX: Two phases —
 *   Calm:   timeLeft > stressThreshold  → gray "NNm" text, updates every 60s.
 *   Stressed: timeLeft <= stressThreshold → red progress bar + MM:SS counter,
 *            updates every second.
 *
 * Configuration comes from the study config (via backend API):
 *   inactivity_timeout_minutes         — 0 disables the timer entirely.
 *   inactivity_timeout_stress_time_left — minutes at which the stressed UI starts.
 *   inactivity_page_custom_text         — optional { "de": "...", "en": "..." }.
 */

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _timerId = null;             // setTimeout handle for the current countdown
let _displayIntervalId = null;   // setInterval handle for display updates
let _started = false;            // true when timer is actively running
let _pausedUntil = null;         // Date.now() value until which timer is paused (for temporary suspends)

let _config = {
  timeoutMinutes: 0,
  stressTimeLeft: 5,
  customText: null,              // Dict[str,str] or null
  redirectUrl: 'pages/timeout.html',
};

let _deadline = null;            // Date.now() at which timeout fires (absolute timestamp)
let _lastActivity = 0;

// DOM elements
let _timerContainer = null;
let _progressBar = null;
let _timerText = null;

// The current phase: 'calm' or 'stressed'
let _currentPhase = 'calm';

// For throttling mousemove/scroll activity resets
let _lastActivityReset = 0;
const ACTIVITY_RESET_THROTTLE_MS = 2000;

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function _createTimerDOM() {
  if (_timerContainer) return;

  _timerContainer = document.createElement('div');
  _timerContainer.id = 'idleTimeoutIndicator';
  _timerContainer.setAttribute('aria-label', 'Inactivity timer');
  _timerContainer.setAttribute('role', 'timer');
  _timerContainer.title = 'Idle Timeout. Click to confirm you are still here and reset the timer.';

  // Progress bar (shown only in stressed phase)
  _progressBar = document.createElement('div');
  _progressBar.id = 'idleTimeoutProgressBar';
  _progressBar.style.display = 'none';
  _timerContainer.appendChild(_progressBar);

  // Timer text
  _timerText = document.createElement('span');
  _timerText.id = 'idleTimeoutText';
  _timerContainer.appendChild(_timerText);

  // Clicking the timer resets it (counts as activity)
  _timerContainer.addEventListener('click', () => {
    _resetActivity();
    _resetCountdown();
  });

  document.body.appendChild(_timerContainer);
}

function _removeTimerDOM() {
  if (_timerContainer) {
    _timerContainer.remove();
    _timerContainer = null;
    _progressBar = null;
    _timerText = null;
  }
}

function _localizeCustomText() {
  if (!_config.customText || typeof _config.customText !== 'object') return null;
  const lang = _getCurrentLanguage();
  return _config.customText[lang] || _config.customText.en || Object.values(_config.customText)[0] || null;
}

function _getCurrentLanguage() {
  // Try to determine the active language from URL or study config
  const urlParams = new URLSearchParams(window.location.search);
  const urlLang = urlParams.get('lang');
  if (urlLang) return urlLang.toLowerCase();

  const studyConfig = window.timelineManager?.studyConfig;
  if (studyConfig?.selected_language) return studyConfig.selected_language.toLowerCase();
  if (studyConfig?.default_language) return studyConfig.default_language.toLowerCase();

  return 'en';
}

// ---------------------------------------------------------------------------
// Activity tracking
// ---------------------------------------------------------------------------

function _recordActivity() {
  _lastActivity = Date.now();
}

function _throttledRecordActivity() {
  const now = Date.now();
  if (now - _lastActivityReset < ACTIVITY_RESET_THROTTLE_MS) return;
  _lastActivityReset = now;
  _recordActivity();
  _resetCountdown();
}

function _resetActivity() {
  _lastActivityReset = Date.now();
  _recordActivity();
}

// ---------------------------------------------------------------------------
// Countdown logic
// ---------------------------------------------------------------------------

function _resetCountdown() {
  if (!_started) return;
  _deadline = Date.now() + _config.timeoutMinutes * 60 * 1000;
  _currentPhase = 'calm';

  // Clear existing timeout and re-set
  if (_timerId) clearTimeout(_timerId);

  const msUntilTimeout = _deadline - Date.now();
  if (msUntilTimeout <= 0) {
    _onTimeout();
    return;
  }
  _timerId = setTimeout(_onTimeout, msUntilTimeout);
  _updateDisplay();
}

function _onTimeout() {
  _stopTimerInternal();

  // Store custom text so the timeout page can read it (via sessionStorage)
  const customText = _localizeCustomText();
  if (customText) {
    try {
      sessionStorage.setItem('tud_timeout_custom_text', customText);
    } catch (_e) { /* ignore storage errors */ }
  }

  // Brief delay so the user sees the final state, then redirect
  // Use replace() to avoid the diary page being in history
  setTimeout(() => {
    window.location.replace(_config.redirectUrl);
  }, 1500);
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

function _updateDisplay() {
  if (!_started || !_timerText) return;

  const timeLeft = Math.max(0, _deadline - Date.now());
  const totalMinutes = Math.ceil(timeLeft / 60000);
  const stressMs = _config.stressTimeLeft * 60 * 1000;

  if (timeLeft <= 0) {
    _timerText.textContent = '0:00';
    _timerText.className = 'stressed';
    if (_progressBar) _progressBar.style.width = '0%';
    return;
  }

  if (timeLeft > stressMs) {
    // ---- Calm phase ----
    _currentPhase = 'calm';
    _timerContainer.className = 'calm';
    _timerText.textContent = `${totalMinutes}m`;
    _timerText.className = 'calm';
    if (_progressBar) _progressBar.style.display = 'none';
  } else {
    // ---- Stressed phase ----
    _currentPhase = 'stressed';
    const minutes = Math.floor(timeLeft / 60000);
    const seconds = Math.floor((timeLeft % 60000) / 1000);
    _timerContainer.className = 'stressed';
    _timerText.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
    _timerText.className = 'stressed';

    if (_progressBar) {
      _progressBar.style.display = 'block';
      const pct = (timeLeft / stressMs) * 100;
      _progressBar.style.width = `${pct}%`;
    }
  }
}

function _startDisplayUpdates() {
  _updateDisplay();
  if (_displayIntervalId) clearInterval(_displayIntervalId);
  _displayIntervalId = setInterval(_updateDisplay, 1000);
}

function _stopDisplayUpdates() {
  if (_displayIntervalId) {
    clearInterval(_displayIntervalId);
    _displayIntervalId = null;
  }
}

// ---------------------------------------------------------------------------
// Visibility change handling
// ---------------------------------------------------------------------------

function _onVisibilityChange() {
  if (document.hidden) {
    // Tab hidden: let the timer keep counting. No action needed.
    return;
  }

  // Tab visible again: check if we timed out while hidden
  if (_started && _deadline && Date.now() >= _deadline) {
    _onTimeout();
  } else if (_pausedUntil) {
    // Timer was paused while a modal or critical UI was open; skip check.
  }
}

// ---------------------------------------------------------------------------
// Timer lifecycle
// ---------------------------------------------------------------------------

function _startTimerInternal() {
  if (_config.timeoutMinutes <= 0) return;
  if (_started) return;

  _started = true;
  _deadline = Date.now() + _config.timeoutMinutes * 60 * 1000;
  _lastActivity = Date.now();

  _createTimerDOM();
  _startDisplayUpdates();
  _resetCountdown();

  // Bind activity listeners
  window.addEventListener('mousemove', _throttledRecordActivity, { passive: true });
  window.addEventListener('keydown', _resetActivity, { passive: true });
  window.addEventListener('click', _resetActivity, { passive: true });
  window.addEventListener('touchstart', _resetActivity, { passive: true });
  window.addEventListener('scroll', _throttledRecordActivity, { passive: true });
  document.addEventListener('visibilitychange', _onVisibilityChange);

  console.log(`[idle_timeout] Started — ${_config.timeoutMinutes} min timeout, ${_config.stressTimeLeft} min stress threshold`);
}

function _stopTimerInternal() {
  if (!_started && !_timerId && !_displayIntervalId) return;

  _started = false;
  _deadline = null;
  _config.timeoutMinutes = 0;

  if (_timerId) { clearTimeout(_timerId); _timerId = null; }
  _stopDisplayUpdates();
  _removeTimerDOM();

  // Unbind activity listeners
  window.removeEventListener('mousemove', _throttledRecordActivity);
  window.removeEventListener('keydown', _resetActivity);
  window.removeEventListener('click', _resetActivity);
  window.removeEventListener('touchstart', _resetActivity);
  window.removeEventListener('scroll', _throttledRecordActivity);
  document.removeEventListener('visibilitychange', _onVisibilityChange);

  console.log('[idle_timeout] Stopped');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the inactivity timer.
 * @param {object} cfg — { timeoutMinutes, stressTimeLeft?, customText?, redirectUrl? }
 *   timeoutMinutes = 0 disables the timer.
 */
export function startIdleTimer(cfg = {}) {
  const timeoutMinutes = cfg.inactivity_timeout_minutes ?? cfg.timeoutMinutes ?? 0;
  if (timeoutMinutes <= 0) {
    _stopTimerInternal();
    return;
  }

  _config.timeoutMinutes = timeoutMinutes;
  _config.stressTimeLeft = cfg.inactivity_timeout_stress_time_left
    ?? cfg.stressTimeLeft
    ?? Math.min(5, Math.floor(timeoutMinutes / 6));
  _config.customText = cfg.inactivity_page_custom_text ?? cfg.customText ?? null;
  _config.redirectUrl = cfg.redirectUrl || 'pages/timeout.html';

  _startTimerInternal();
}

/**
 * Stop the inactivity timer and remove all UI.
 * Call before data submission or when the session ends normally.
 */
export function stopIdleTimer() {
  _stopTimerInternal();
}

/**
 * Temporarily pause the timer (e.g., during a modal).
 * Call resumeIdleTimer() to restart.
 */
export function pauseIdleTimer() {
  if (!_started) return;
  _pausedUntil = Date.now() + 3600000; // arbitrary far future; actual resume will reset

  if (_timerId) { clearTimeout(_timerId); _timerId = null; }
  _stopDisplayUpdates();
}

/**
 * Resume the timer after a pause.
 */
export function resumeIdleTimer() {
  if (!_started) return;
  _pausedUntil = null;
  _resetActivity();
  _resetCountdown();
  _startDisplayUpdates();
}

/**
 * Returns true if the timer is currently active.
 */
export function isTimerActive() {
  return _started;
}

// Expose key functions on the window object so other modules (utils.js, ui.js)
// can call them without creating circular import dependencies.
window.tudIdleTimeout = {
  start: startIdleTimer,
  stop: stopIdleTimer,
  pause: pauseIdleTimer,
  resume: resumeIdleTimer,
  isActive: isTimerActive,
};
