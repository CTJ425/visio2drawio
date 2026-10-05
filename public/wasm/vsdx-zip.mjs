// @ts-check
// Minimal ZIP reader for .vsdx packages. It relies on the platform's DecompressionStream, so it
// needs no dependency in the Web Worker or in Node. Shared by the worker and the unit tests.
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<{has(name: string): boolean, read(name: string): Promise<Uint8Array | null>}>}
 */
export async function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP package');

  const entryCount = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  /** @type {Map<string, { method: number, compressedSize: number, localOffset: number }>} */
  const entries = new Map();
  for (let n = 0; n < entryCount; n++) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      throw new Error('Corrupt ZIP central directory');
    }
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    entries.set(name, { method, compressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return {
    has: (name) => entries.has(name),
    async read(name) {
      const entry = entries.get(name);
      if (!entry) return null;
      // The local header repeats the name and extra field with lengths of its own.
      const nameLength = view.getUint16(entry.localOffset + 26, true);
      const extraLength = view.getUint16(entry.localOffset + 28, true);
      const start = entry.localOffset + 30 + nameLength + extraLength;
      const raw = bytes.subarray(start, start + entry.compressedSize);
      if (entry.method === 0) return raw;
      if (entry.method !== 8) throw new Error(`Unsupported ZIP compression method ${entry.method}`);
      const inflated = new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (raw)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(inflated).arrayBuffer());
    },
  };
}

/**
 * True when the bytes start like a ZIP archive, i.e. a .vsdx/.vssx rather than a binary .vsd/.vss.
 * @param {Uint8Array} bytes
 */
export function looksLikeZip(bytes) {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}
