// @ts-check
/**
 * Small element helpers, shared rather than copied.
 *
 * Every component used to carry its own three-line `el()`. Newer ones import it
 * from here; the older files keep theirs until they are touched, which is a
 * smaller diff than a rename sweep.
 */

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {string | null} [className]
 * @param {string | null} [text]
 * @returns {HTMLElementTagNameMap[K]}
 */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * A 24x24 stroke icon from one or more SVG path definitions.
 *
 * @param {string[]} paths
 * @returns {SVGSVGElement}
 */
export function icon(paths) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 't-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const path of paths) {
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', path);
    svg.append(shape);
  }
  return svg;
}

/**
 * A full-width button. `variant` picks the design system's modifier.
 *
 * @param {'primary' | 'secondary' | 'ghost'} variant
 * @param {string} label
 * @param {() => void} onClick
 * @returns {HTMLButtonElement}
 */
export function button(variant, label, onClick) {
  const node = el('button', `t-btn t-btn--${variant} t-btn--block`, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}
