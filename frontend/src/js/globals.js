// Global state
let isMobile = window.innerWidth < 1440;
let lastBreakpointState = isMobile;
let isReloading = false; // Prevent multiple reloads

function persistPendingTimelineStateBeforeReload() {
  try {
    if (typeof window.__TRAC_CAPTURE_PENDING_STATE === 'function') {
      const captured = window.__TRAC_CAPTURE_PENDING_STATE();
      if (captured) {
        console.log(
          'Captured pending timeline state before breakpoint reload.'
        );
      }
    }
  } catch (error) {
    console.warn(
      'Failed to capture pending timeline state before reload:',
      error
    );
  }
}

// Get current mobile state
export function getIsMobile() {
  return isMobile;
}
// Make getIsMobile available globally
window.getIsMobile = getIsMobile;

// Update function
export function updateIsMobile() {
  if (isReloading) return false;

  const newIsMobile = window.innerWidth < 1440;
  const breakpointChanged = newIsMobile !== lastBreakpointState;

  if (breakpointChanged) {
    isReloading = true;
    persistPendingTimelineStateBeforeReload();
    window.location.reload();
    return false; // Won't actually reach this point due to reload
  }

  isMobile = newIsMobile;
  lastBreakpointState = newIsMobile;
  return false;
}

// Initialize immediately
updateIsMobile();

export { isMobile };
