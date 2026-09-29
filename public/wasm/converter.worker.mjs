// Web Worker that runs the libvisio WASM converter off the main thread.
// Request:  { id, buffer: ArrayBuffer, format, cols, scale, limit }
// Response: { id, ok: true, output: ArrayBuffer, durationMs } | { id, ok: false, error }
import { convertVisio, resetConverter } from './converter-core.mjs';

self.onmessage = async (event) => {
  const { id, buffer, format, cols, scale, limit } = event.data;
  const startedAt = performance.now();
  try {
    const output = await convertVisio(new Uint8Array(buffer), { format, cols, scale, limit });
    self.postMessage(
      { id, ok: true, output: output.buffer, durationMs: Math.round(performance.now() - startedAt) },
      [output.buffer]
    );
  } catch (err) {
    if (err instanceof WebAssembly.RuntimeError) {
      resetConverter();
    }
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
