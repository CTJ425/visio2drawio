// @ts-check
// Number formatting, escaping and base64 for the XML and SVG the .vsdx converter writes.

/**
 * At most three decimals, without trailing zeros.
 * @param {number} value
 */
export function number(value) {
  return Number(value.toFixed(3)).toString();
}

/** @param {string} text */
export function escapeAttribute(text) {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** @param {string} text */
export function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** @param {Uint8Array} bytes */
export function bytesToBase64(bytes) {
  let binary = '';
  // In chunks: one call per byte is slow, and too many arguments overflow the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** @param {string} text  encoded as UTF-8 */
export function toBase64(text) {
  return bytesToBase64(new TextEncoder().encode(text));
}

/**
 * @param {string} mime
 * @param {Uint8Array | string} bytesOrText  a string is encoded as UTF-8
 */
export function imageDataUri(mime, bytesOrText) {
  const base64 = typeof bytesOrText === 'string' ? toBase64(bytesOrText) : bytesToBase64(bytesOrText);
  // draw.io splits styles on ';', so the URI omits ';base64' (draw.io re-adds it when rendering).
  return `data:${mime},${base64}`;
}
