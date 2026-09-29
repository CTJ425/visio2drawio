// Browser-side client for the libvisio WASM converter.
// Conversion runs in a Web Worker (public/wasm/converter.worker.mjs), so files
// never leave the user's machine and the site can be served as static assets.

export interface StencilItem {
  id: number;
  title: string;
  widthInches: number;
  heightInches: number;
  svgBase64: string;
}

export interface PreviewResult {
  total: number;
  count: number;
  items: StencilItem[];
}

export type OutputFormat = 'drawio' | 'mxlibrary';

export interface ConvertOptions {
  format?: OutputFormat | 'json';
  cols?: number;
  scale?: number;
  limit?: number;
}

export interface ConvertResult {
  bytes: Uint8Array<ArrayBuffer>;
  durationMs: number;
}

export const SUPPORTED_EXTENSIONS = ['.vss', '.vsd', '.vssx', '.vsdx'];

export function isSupportedVisioFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return SUPPORTED_EXTENSIONS.some(ext => lowerName.endsWith(ext));
}

type WorkerResponse =
  | { id: number; ok: true; output: ArrayBuffer; durationMs: number }
  | { id: number; ok: false; error: string };

const WORKER_URL = '/wasm/converter.worker.mjs';

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, { resolve: (r: ConvertResult) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(WORKER_URL, { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.ok) {
      request.resolve({ bytes: new Uint8Array(response.output), durationMs: response.durationMs });
    } else {
      request.reject(new Error(response.error));
    }
  };
  worker.onerror = (event) => {
    // A failed module load or an uncaught error kills every in-flight request.
    const error = new Error(event.message || '轉換引擎載入失敗，請重新整理頁面後再試。');
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

export async function convertVisioFile(file: File, options: ConvertOptions = {}): Promise<ConvertResult> {
  if (!isSupportedVisioFile(file.name)) {
    throw new Error(`不支援的檔案格式「${file.name}」。請選擇 .vss, .vsd, .vssx 或 .vsdx 檔案。`);
  }

  const buffer = await file.arrayBuffer();
  const id = nextRequestId++;
  return new Promise<ConvertResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, buffer, ...options }, [buffer]);
  });
}

export async function previewVisioFile(
  file: File,
  limit: number = 60
): Promise<PreviewResult & { durationMs: number }> {
  const { bytes, durationMs } = await convertVisioFile(file, { format: 'json', limit });
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  return {
    total: parsed.total ?? parsed.items?.length ?? 0,
    count: parsed.count ?? parsed.items?.length ?? 0,
    items: parsed.items ?? [],
    durationMs,
  };
}
