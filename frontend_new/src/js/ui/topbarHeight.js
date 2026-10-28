// @ts-check
/**
 * Keeps `--topbar-h` in sync with the real height of the header.
 *
 * The day headings stick below the top bar and scroll anchors need the same
 * offset, and the bar is taller on phones (day selector) than on desktop (one
 * row). Measuring it is cheaper and more honest than repeating the two heights
 * as magic numbers in CSS.
 */

/**
 * @param {HTMLElement} topbar
 * @param {HTMLElement} appRoot Element the custom property is set on.
 * @returns {() => void} stop watching
 */
export function watchTopbarHeight(topbar, appRoot) {
  if (typeof ResizeObserver === 'undefined') return () => {};
  const observer = new ResizeObserver(() => {
    appRoot.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`);
  });
  observer.observe(topbar);
  return () => observer.disconnect();
}
