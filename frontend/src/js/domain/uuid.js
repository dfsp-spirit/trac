// @ts-check
/**
 * Client-generated ids for diary rows.
 *
 * `crypto.randomUUID()` only exists in secure contexts. Participants reach the
 * app over a LAN address (`http://192.168.x.x:3000/...`) while testing on a
 * phone, which is not a secure context, so calling it there throws and the save
 * fails before a request is made. `crypto.getRandomValues()` works everywhere,
 * so the fallback builds the same v4 layout by hand.
 */

/**
 * @returns {string} An RFC 4122 version 4 UUID.
 */
export function newUuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
