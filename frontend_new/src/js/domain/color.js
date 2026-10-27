// @ts-check
/**
 * Label colour for a study-defined activity colour (D11).
 *
 * The app never chooses activity colours - a study does - but it does have to
 * keep the label readable on whatever it was given, so the ink is picked by
 * luminance rather than assumed.
 */

/**
 * @param {string | null | undefined} colour e.g. "#3366cc"
 * @returns {'#000000' | '#ffffff'}
 */
export function readableInk(colour) {
  const rgb = parseHex(colour);
  if (!rgb) return '#000000';
  // Relative luminance, sRGB weights (WCAG 2.x).
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? '#000000' : '#ffffff';
}

/**
 * @param {string | null | undefined} colour
 * @returns {[number, number, number] | null}
 */
function parseHex(colour) {
  if (typeof colour !== 'string') return null;
  const value = colour.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(value)) return null;
  const full =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * Whether a study colour is usable as a fill at all.
 *
 * @param {string | null | undefined} colour
 * @returns {boolean}
 */
export function isColour(colour) {
  return parseHex(colour) !== null;
}
