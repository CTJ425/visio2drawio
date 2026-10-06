// Turns the SVG pictures of a draw.io library (.xml) into PNG, as draw.io itself does with
// large images it inserts. Visio's vendor stencils hold thousands of paths per shape, and
// draw.io redraws every library thumbnail from that SVG: a 281-shape library blocked the page
// for seconds on import and again while scrolling the sidebar. A PNG of the whole picture
// draws in a fraction of that time.
//
// Runs on the page, not in the converter's Web Worker: workers cannot decode SVG images.

export interface RasterizeOptions {
  /** Pixels per draw.io unit, so shapes stay sharp up to this zoom level. */
  pixelRatio?: number;
  /** Longest side in pixels, to bound memory for very large shapes. */
  maxSide?: number;
  onProgress?: (done: number, total: number) => void;
}

interface LibraryEntry {
  title?: string;
  w?: number;
  h?: number;
  data?: string;
  [key: string]: unknown;
}

const XML_ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '"': '&quot;', "'": '&apos;', '<': '&lt;', '>': '&gt;' };

/**
 * Returns the library with each SVG picture replaced by a PNG of the same picture. Entries
 * whose picture cannot be drawn keep their SVG.
 */
export async function rasterizeLibrary(library: Uint8Array, options: RasterizeOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
  const pixelRatio = options.pixelRatio ?? 4;
  const maxSide = options.maxSide ?? 2048;
  const text = new TextDecoder().decode(library);
  const open = text.indexOf('<mxlibrary>');
  const close = text.lastIndexOf('</mxlibrary>');
  if (open < 0 || close < open) throw new Error('不是 Draw.io 形狀庫 (.xml)');

  const json = text.slice(open + '<mxlibrary>'.length, close).replace(/&(amp|quot|apos|lt|gt);/g, (_, name) => XML_ENTITIES[name]);
  const entries: LibraryEntry[] = JSON.parse(json);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.data?.startsWith('data:image/svg+xml')) {
      const png = await svgToPng(entry.data, entry.w ?? 100, entry.h ?? 100, pixelRatio, maxSide);
      if (png) entry.data = png;
    }
    options.onProgress?.(i + 1, entries.length);
    // Lets the page repaint between shapes.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const escaped = JSON.stringify(entries).replace(/[&"'<>]/g, (c) => XML_ESCAPES[c]);
  return new TextEncoder().encode(`${text.slice(0, open)}<mxlibrary>${escaped}${text.slice(close)}`);
}

// Draws the whole picture into a canvas of the shape's aspect ratio: draw.io shows library
// images stretched to the shape's size, so this is what it would show, only pre-rendered.
async function svgToPng(dataUri: string, width: number, height: number, pixelRatio: number, maxSide: number): Promise<string | null> {
  try {
    const image = new Image();
    image.src = dataUri;
    await image.decode();
    const scale = Math.min(pixelRatio, maxSide / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch {
    // An SVG the browser cannot draw (or a canvas it will not export) stays vector.
    return null;
  }
}
