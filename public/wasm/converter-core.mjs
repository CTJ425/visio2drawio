// Marshalling between JS and the libvisio WASM build (vss2drawio.mjs).
// Shared by the browser Web Worker and the Node unit tests, so it must stay
// dependency-free plain ESM.
import createVss2drawio from './vss2drawio.mjs';

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
  return output;
}
