// Marshalling between JS and the libvisio WASM build (vss2drawio.mjs).
// Shared by the browser Web Worker and the Node unit tests, so it must stay
// plain ESM that imports only files in this directory.
import createVss2drawio from './vss2drawio.mjs';
// Vendored from the emf-converter npm package (npm run vendor:emf).
import { convertMetafileToSvg } from './emf-converter.mjs';

let modulePromise = null;

export function loadConverter() {
  if (!modulePromise) {
    modulePromise = createVss2drawio().catch((err) => {
      modulePromise = null;
      throw err;
    });
  }
  return modulePromise;
}

// Drops the cached instance, e.g. after a WASM trap left it in an unknown state.
export function resetConverter() {
  modulePromise = null;
}

/**
 * Converts a Visio file held in memory.
 * @param {Uint8Array} input  raw .vss/.vsd/.vssx/.vsdx bytes
 * @param {{format?: 'drawio'|'mxlibrary'|'json', cols?: number, scale?: number, limit?: number}} options
 * @returns {Promise<Uint8Array>} UTF-8 encoded output document
 */
export async function convertVisio(input, options = {}) {
  const Module = await loadConverter();
  const format = options.format || 'drawio';
  const cols = Number.isFinite(options.cols) && options.cols > 0 ? options.cols : 3;
  const scale = Number.isFinite(options.scale) && options.scale > 0 ? options.scale : 120;
  const limit = Number.isFinite(options.limit) && options.limit >= 0 ? options.limit : 0;

  const inPtr = Module._malloc(input.length);
  const formatSize = Module.lengthBytesUTF8(format) + 1;
  const formatPtr = Module._malloc(formatSize);
  if (!inPtr || !formatPtr) {
    Module._free(inPtr);
    Module._free(formatPtr);
    throw new Error('記憶體不足，無法載入此檔案。');
  }

  let outPtr = 0;
  try {
    Module.HEAPU8.set(input, inPtr);
    Module.stringToUTF8(format, formatPtr, formatSize);
    outPtr = Module._v2d_convert(inPtr, input.length, formatPtr, cols, scale, limit);
  } finally {
    Module._free(inPtr);
    Module._free(formatPtr);
  }

  if (!outPtr) {
    throw new Error(Module.UTF8ToString(Module._v2d_last_error()) || '轉換失敗');
  }

  // Read HEAPU8 again: memory may have grown (and the buffer been replaced) during conversion.
  const heap = Module.HEAPU8;
  const end = heap.indexOf(0, outPtr);
  const output = heap.slice(outPtr, end);
  Module._v2d_free(outPtr);
  return postProcess(output);
}

const SVG_DATA_URI = /data:image\/svg\+xml(?:;base64)?,([A-Za-z0-9+/=]+)/g;
const METAFILE_HREF = /xlink:href="data:image\/[ew]mf;base64,([A-Za-z0-9+/=]+)"/g;

// Metafile base64 -> Promise of converted SVG base64 (or null). Kept across calls because the
// UI converts the same file for the preview and again for each download, and converting the
// pictures dominates the conversion time. Holds only the pictures of the latest call.
let metafileCache = new Map();

async function postProcess(output) {
  const text = new TextDecoder().decode(output);
  const svgs = new Map(); // mxlibrary repeats each SVG in its `data` and `xml` fields
  const metafiles = new Map(); // stencils often share the same picture
  const fixed = await replaceAsync(text, SVG_DATA_URI, (match, b64) => {
    if (!svgs.has(b64)) svgs.set(b64, embedMetafilesAsSvg(b64, metafiles));
    return svgs.get(b64).then((svgB64) => 'data:image/svg+xml;base64,' + svgB64);
  });
  metafileCache = metafiles;
  // draw.io splits styles on ';', so `image=data:image/svg+xml;base64,...` loses the image.
  // draw.io expects `image=data:image/svg+xml,...` and re-adds ';base64' itself.
  return new TextEncoder().encode(
    fixed.replaceAll('image=data:image/svg+xml;base64,', 'image=data:image/svg+xml,')
  );
}

// libvisio embeds Visio's EMF/WMF pictures as-is, and browsers (so draw.io) cannot render
// metafiles. Converts them to SVG; each stays a separate data URI so their ids cannot clash.
async function embedMetafilesAsSvg(svgB64, metafiles) {
  const svg = new TextDecoder().decode(fromBase64(svgB64));
  if (!svg.includes('data:image/emf') && !svg.includes('data:image/wmf')) return svgB64;

  const fixed = await replaceAsync(svg, METAFILE_HREF, async (match, metaB64) => {
    if (!metafiles.has(metaB64)) {
      metafiles.set(metaB64, metafileCache.get(metaB64) ?? metafileToSvgBase64(metaB64));
    }
    const metaSvgB64 = await metafiles.get(metaB64);
    if (!metaSvgB64) return match;
    // Visio stretches pictures to fill their frame.
    return `preserveAspectRatio="none" xlink:href="data:image/svg+xml;base64,${metaSvgB64}"`;
  });
  return toBase64(new TextEncoder().encode(fixed));
}

async function metafileToSvgBase64(metaB64) {
  let svg = null;
  try {
    // Caps the viewBox; without it wide pictures are clamped to 8192px, distorting the aspect ratio.
    svg = await convertMetafileToSvg(dropDualEmfPlus(fromBase64(metaB64)).buffer, { maxWidth: 4096, maxHeight: 4096 });
  } catch {
    // A malformed picture should not fail the whole stencil file; keep the original.
  }
  if (!svg) return null;
  return toBase64(new TextEncoder().encode(svg));
}

// emf-converter leaves out most of what the EMF+ records of Visio's pictures draw (a server
// front comes out as just its chassis ears). An EMF+ "dual" file also records the whole
// picture as plain GDI records, which it renders faithfully, so drop the EMF+ records there.
const EMR_HEADER = 1;
const EMR_COMMENT = 70;
const EMF_PLUS_TAG = 0x2b464d45; // 'EMF+'
const EMF_PLUS_HEADER = 0x4001;

function dropDualEmfPlus(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 88 || view.getUint32(0, true) !== EMR_HEADER) return bytes; // e.g. WMF

  const kept = [];
  let dual = false;
  for (let offset = 0; offset + 8 <= bytes.length; ) {
    const size = view.getUint32(offset + 4, true);
    if (size < 8 || offset + size > bytes.length) return bytes; // malformed; leave it as is
    const isEmfPlus =
      view.getUint32(offset, true) === EMR_COMMENT && size >= 20 && view.getUint32(offset + 12, true) === EMF_PLUS_TAG;
    if (!isEmfPlus) {
      kept.push(bytes.subarray(offset, offset + size));
    } else if (view.getUint16(offset + 16, true) === EMF_PLUS_HEADER) {
      dual = (view.getUint16(offset + 18, true) & 1) === 1;
    }
    offset += size;
  }
  if (!dual) return bytes;

  const out = new Uint8Array(kept.reduce((total, record) => total + record.length, 0));
  let at = 0;
  for (const record of kept) {
    out.set(record, at);
    at += record.length;
  }
  const outView = new DataView(out.buffer);
  outView.setUint32(48, out.length, true); // header nBytes
  outView.setUint32(52, kept.length, true); // header nRecords
  return out;
}

async function replaceAsync(text, regex, replacer) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(regex)) {
    parts.push(text.slice(last, match.index), await replacer(...match));
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return parts.join('');
}

function fromBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
