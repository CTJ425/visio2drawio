// Marshalling between JS and the libvisio WASM build (vss2drawio.mjs).
// Shared by the browser Web Worker and the Node unit tests, so it must stay
// plain ESM that imports only files in this directory.
import createVss2drawio from './vss2drawio.mjs';
// Vendored from the emf-converter npm package (npm run vendor:emf).
import { convertMetafileToSvg } from './emf-converter.mjs';
import { readZip, looksLikeZip } from './vsdx-zip.mjs';
import { convertVsdxPages } from './vsdx-diagram.mjs';
import { minifySvgPaths } from './svg-minify.mjs';
import { contentFrame, applyFrame } from './svg-extent.mjs';

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
  const format = options.format || 'drawio';
  if (format === 'drawio') {
    const diagram = await convertDrawingPages(input, options);
    if (diagram) return diagram;
    return convertToGrid(input, options);
  }
  if (format === 'mxlibrary') return convertToLibrary(input, options);
  const stencils = await loadStencils(input, { limit: options.limit });
  for (const item of stencils.items) delete item.points;
  return new TextEncoder().encode(JSON.stringify(stencils, null, 2) + '\n');
}

const XML_ESCAPES = { '&': '&amp;', '"': '&quot;', "'": '&apos;', '<': '&lt;', '>': '&gt;' };
const xmlEscape = (text) => String(text).replace(/[&"'<>]/g, (c) => XML_ESCAPES[c]);

function scaleOption(options) {
  return Number.isFinite(options.scale) && options.scale > 0 ? options.scale : 120;
}

/**
 * The stencils of a Visio file as libvisio renders them, each SVG framed to everything it
 * draws: some masters have a page much smaller than their picture, and libvisio frames the
 * stencil by that page, which cut the rest off. `points` is each stencil's draw.io
 * `points=[...];` style ('' for none), relative to the fitted frame.
 * @returns {Promise<{ total: number, count: number, items: { title: string, widthInches: number, heightInches: number, svgBase64: string, points: string }[] }>}
 */
async function loadStencils(input, { limit = 0, withPoints = false } = {}) {
  const stencils = JSON.parse(new TextDecoder().decode(await runLibvisio(input, { format: 'json', limit })));
  const points = withPoints ? await connectionPointsByShape(input) : [];
  const pointsMatch = points.length === stencils.items.length;
  stencils.items.forEach((item, i) => {
    const style = pointsMatch ? points[i] : '';
    const svg = new TextDecoder().decode(fromBase64(item.svgBase64.slice(item.svgBase64.indexOf(',') + 1)));
    const frame = contentFrame(svg);
    if (!frame) {
      item.points = style;
      return;
    }
    item.svgBase64 = 'data:image/svg+xml;base64,' + toBase64(new TextEncoder().encode(applyFrame(svg, frame)));
    item.widthInches *= frame.width / frame.page.width;
    item.heightInches *= frame.height / frame.page.height;
    item.points = reframePoints(style, frame);
  });
  // Converts the metafile pictures inside the SVGs, as for every libvisio output.
  return JSON.parse(new TextDecoder().decode(await postProcess(new TextEncoder().encode(JSON.stringify(stencils)))));
}

// Connection points are fractions of the page; keeps them on the same spot of the larger frame.
function reframePoints(style, frame) {
  const list = /^points=(\[.*\]);$/.exec(style)?.[1];
  if (!list) return style;
  const round = (v) => Math.round(v * 10000) / 10000;
  const moved = JSON.parse(list).map(([x, y, ...rest]) => [
    round((frame.page.x + x * frame.page.width - frame.x) / frame.width),
    round((frame.page.y + y * frame.page.height - frame.y) / frame.height),
    ...rest,
  ]);
  return `points=${JSON.stringify(moved)};`;
}

// A draw.io custom library (File > Open Library). Each entry is in draw.io's own form for an
// image: draw.io builds the shape from `data` and appends `style` to its
// shape=image;verticalLabelPosition=bottom;verticalAlign=top;imageAspect=0;aspect=fixed;image=...;
// libvisio's own mxlibrary output also repeats each picture in an `xml` field, which draw.io
// never reads when `data` is set (so its connection points were lost); for large stencils
// that output outgrew the WASM memory and came out cut short.
async function convertToLibrary(input, options) {
  const scale = scaleOption(options);
  const stencils = await loadStencils(input, { withPoints: true });
  const entries = stencils.items.map((item) => ({
    title: item.title,
    w: libraryLength(item.widthInches, scale),
    h: libraryLength(item.heightInches, scale),
    aspect: 'fixed',
    data: item.svgBase64,
    style: 'labelBackgroundColor=default;' + item.points,
  }));
  return new TextEncoder().encode(`<mxlibrary>${xmlEscape(JSON.stringify(entries))}</mxlibrary>\n`);
}

function libraryLength(inches, scale) {
  const length = Math.round(inches * scale);
  return length > 0 ? length : 100;
}

// Every stencil on one draw.io page, in `cols` columns (each shape goes to the shortest),
// as libvisio's own draw.io output lays them out.
async function convertToGrid(input, options) {
  const scale = scaleOption(options);
  const cols = Number.isFinite(options.cols) && options.cols > 0 ? Math.floor(options.cols) : 3;
  const stencils = await loadStencils(input, { withPoints: true });
  const colWidth = 360, startX = 40, startY = 40, paddingX = 40, paddingY = 80;
  const colY = new Array(cols).fill(startY);
  const cells = stencils.items.map((item, i) => {
    const col = colY.indexOf(Math.min(...colY));
    const x = startX + col * (colWidth + paddingX);
    const y = colY[col];
    let w = item.widthInches * scale;
    let h = item.heightInches * scale;
    if (w <= 0) w = 100;
    if (h <= 0) h = 100;
    if (w > colWidth) {
      h *= colWidth / w;
      w = colWidth;
    }
    colY[col] = y + h + paddingY;
    // draw.io splits styles on ';', so the image URI omits ';base64' (draw.io re-adds it when rendering).
    const image = item.svgBase64.replace('data:image/svg+xml;base64,', 'data:image/svg+xml,');
    const style = `shape=image;verticalLabelPosition=bottom;labelBackgroundColor=default;verticalAlign=top;aspect=fixed;imageAspect=0;${item.points}image=${image};`;
    return (
      `        <mxCell id="shape-${i + 2}" value="${xmlEscape(item.title)}" style="${style}" vertex="1" parent="1">\n` +
      `          <mxGeometry x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" as="geometry" />\n` +
      '        </mxCell>\n'
    );
  });
  return new TextEncoder().encode(
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<mxfile host="app.diagrams.net" modified="2026-08-24T00:00:00.000Z" agent="visio2drawio" version="21.1.2" type="device">\n' +
      '  <diagram id="visio-stencils" name="Visio Stencils">\n' +
      '    <mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="3600" pageHeight="5000" math="0" shadow="0">\n' +
      '      <root>\n' +
      '        <mxCell id="0" />\n' +
      '        <mxCell id="1" parent="0" />\n' +
      cells.join('') +
      '      </root>\n' +
      '    </mxGraphModel>\n' +
      '  </diagram>\n' +
      '</mxfile>\n'
  );
}

// The `points=[...];` style of each stencil, in stencil order ('' for none). The JSON output
// has no connection points, so they come from the draw.io output, whose pictures are not needed.
async function connectionPointsByShape(input) {
  const text = new TextDecoder().decode(await runLibvisio(input, { format: 'drawio' }));
  return Array.from(text.matchAll(/<mxCell id="shape-\d+"[^>]*?\sstyle="([^"]*?);image=/g), (m) => /(?:^|;)(points=\[[^;]*\];)/.exec(m[1] + ';')?.[1] ?? '');
}

// A .vsdx drawing becomes one draw.io page per Visio page, with editable shapes and connectors.
// libvisio cannot do that (it only reports what to draw), so the pages are read from the package
// XML and only the masters' pictures come from libvisio. Returns null for anything else
// (binary .vsd/.vss, or a stencil .vssx with no drawing pages), which libvisio lays out as a grid.
async function convertDrawingPages(input, options) {
  if (!looksLikeZip(input)) return null;
  const scale = Number.isFinite(options.scale) && options.scale > 0 ? options.scale : 120;

  let result;
  try {
    const zip = await readZip(input);
    result = await convertVsdxPages(zip, {
      scale,
      loadMasterSvgs: () => loadMasterSvgs(input),
      metafileToSvg: metafileBytesToSvg,
    });
  } catch (err) {
    // A package this reader cannot follow still converts as a stencil grid rather than failing.
    console.warn('vsdx page conversion failed, falling back to the stencil layout:', err);
    return null;
  }
  if (!result) return null;
  for (const warning of result.warnings) console.warn(warning);
  return new TextEncoder().encode(result.xml);
}

// Master name -> SVG data URI, as libvisio renders each master of the package.
async function loadMasterSvgs(input) {
  const stencils = JSON.parse(new TextDecoder().decode(await convertWithLibvisio(input, { format: 'json', limit: 0 })));
  const svgs = new Map();
  for (const item of stencils.items ?? []) {
    if (!svgs.has(item.title)) {
      // draw.io splits styles on ';', so the URI omits ';base64' (draw.io re-adds it when rendering).
      svgs.set(item.title, item.svgBase64.replace('data:image/svg+xml;base64,', 'data:image/svg+xml,'));
    }
  }
  return svgs;
}

async function convertWithLibvisio(input, options = {}) {
  return postProcess(await runLibvisio(input, options));
}

// libvisio's output as it comes out of the WASM, with metafile pictures still embedded as is.
async function runLibvisio(input, options) {
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

const SVG_DATA_URI = /data:image\/svg\+xml(?:;base64)?,([A-Za-z0-9+/=]+)/g;
const METAFILE_IMAGE = /<image\b([^>]*?)\sxlink:href="data:image\/[ew]mf;base64,([A-Za-z0-9+/=]+)"([^>]*)>/g;

// Metafile base64 -> Promise of the converted SVG (or null). Kept across calls because the
// UI converts the same file for the preview and again for each download, and converting the
// pictures dominates the conversion time. Holds only the pictures of the latest call.
let metafileCache = new Map();

async function postProcess(output) {
  const text = new TextDecoder().decode(output);
  const svgs = new Map(); // shapes often repeat in the output
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
// metafiles. Converts them to SVG and writes that SVG into the shape's SVG, rather than as a
// nested base64 data URI that the shape's own base64 would encode a second time.
async function embedMetafilesAsSvg(svgB64, metafiles) {
  const svg = new TextDecoder().decode(fromBase64(svgB64));
  if (!svg.includes('data:image/emf') && !svg.includes('data:image/wmf')) return svgB64;

  const plain = imagesWithPlainAncestors(svg);
  let inlined = 0;
  const fixed = await replaceAsync(svg, METAFILE_IMAGE, async (match, before, metaB64, after, index) => {
    if (!metafiles.has(metaB64)) {
      metafiles.set(metaB64, metafileCache.get(metaB64) ?? metafileBytesToSvg(fromBase64(metaB64)));
    }
    const metaSvg = await metafiles.get(metaB64);
    if (!metaSvg) return match;
    return (
      (plain.has(index) && inlineSvgImage(before + after, metaSvg, `p${inlined++}`)) ||
      // Visio stretches pictures to fill their frame.
      `<image${before} preserveAspectRatio="none" xlink:href="data:image/svg+xml;base64,${toBase64(new TextEncoder().encode(metaSvg))}"${after}>`
    );
  });
  return toBase64(new TextEncoder().encode(fixed));
}

const IMAGE_ATTRIBUTE = /\s([\w:-]+)="([^"]*)"/g;
// Attributes that pass nothing on to the elements inside, so an SVG written below them draws
// the same as it does as a separate image.
const PLAIN_ATTRIBUTES = /^(?:version|xmlns(?::\w+)?|id|width|height|viewBox|x|y)$/;

// Draws `svg` where the `<image>` with these attributes was: a nested <svg> clips to the
// same box and, with preserveAspectRatio="none", stretches the same way. Its ids get
// `suffix` so two copies of a picture in one shape do not clash. Null when the image or the
// SVG has anything this does not account for; the caller then keeps the data URI.
function inlineSvgImage(imageAttributes, svg, suffix) {
  // Only a self-closing tag: anything inside an <image> would be left behind.
  if (!/\/\s*$/.test(imageAttributes)) return null;
  const box = {};
  for (const [, name, value] of imageAttributes.matchAll(IMAGE_ATTRIBUTE)) box[name] = value;
  if (imageAttributes.replace(IMAGE_ATTRIBUTE, '').trim() !== '/' || !Object.keys(box).every((name) => /^(?:x|y|width|height|transform)$/.test(name))) {
    return null;
  }

  const root = /^\s*(?:<\?xml[^>]*\?>\s*)?<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/.exec(svg);
  if (!root) return null;
  const rootAttributes = {};
  for (const [, name, value] of root[1].matchAll(IMAGE_ATTRIBUTE)) rootAttributes[name] = value;
  if (!rootAttributes.viewBox || Object.keys(rootAttributes).some((name) => !/^(?:xmlns|width|height|viewBox|style)$/.test(name))) {
    return null;
  }

  const ids = new Set(Array.from(root[2].matchAll(/\sid="([^"]+)"/g), (m) => m[1]));
  const body = ids.size === 0 ? root[2] : root[2]
    .replace(/(\sid=")([^"]+)"/g, (m, open, id) => `${open}${id}-${suffix}"`)
    .replace(/url\(#([^)]+)\)/g, (m, id) => (ids.has(id) ? `url(#${id}-${suffix})` : m))
    .replace(/(\s(?:xlink:)?href="#)([^"]+)"/g, (m, open, id) => (ids.has(id) ? `${open}${id}-${suffix}"` : m));

  const place = ['x', 'y', 'width', 'height'].filter((name) => box[name] != null).map((name) => ` ${name}="${box[name]}"`).join('');
  const style = rootAttributes.style != null ? ` style="${rootAttributes.style}"` : '';
  const nested = `<svg${place} viewBox="${rootAttributes.viewBox}" preserveAspectRatio="none" overflow="hidden"${style}>${body}</svg>`;
  // A nested <svg> takes no transform in SVG 1.1, so a group carries it.
  return box.transform != null ? `<g transform="${box.transform}">${nested}</g>` : nested;
}

// Offsets of the <image> tags whose ancestors carry only plain attributes. Content inlined
// anywhere else could inherit a fill, stroke or font that a separate image never sees.
function imagesWithPlainAncestors(svg) {
  const result = new Set();
  const stack = [];
  for (const match of svg.matchAll(/<(\/?)([\w:-]+)((?:[^>"]|"[^"]*")*)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g)) {
    const [, closing, name, attributes] = match;
    if (!name) continue;
    if (closing) {
      stack.pop();
      continue;
    }
    if (name === 'image' && stack.every((plain) => plain)) result.add(match.index);
    if (!attributes.trimEnd().endsWith('/')) {
      stack.push(Array.from(attributes.matchAll(IMAGE_ATTRIBUTE)).every(([, attribute]) => PLAIN_ATTRIBUTES.test(attribute)));
    }
  }
  return result;
}

async function metafileBytesToSvg(bytes) {
  try {
    // A view into a larger buffer (e.g. an entry of the .vsdx) must be copied: only .buffer is passed on.
    const own = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
    // Caps the viewBox; without it wide pictures are clamped to 8192px, distorting the aspect ratio.
    const svg = await convertMetafileToSvg(dropDualEmfPlus(own).buffer, { maxWidth: 4096, maxHeight: 4096 });
    return svg && minifySvgPaths(svg);
  } catch {
    // A malformed picture should not fail the whole file; keep the original.
    return null;
  }
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
    parts.push(text.slice(last, match.index), await replacer(...match, match.index));
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
