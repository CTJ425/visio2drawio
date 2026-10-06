// @ts-check
// Fits a stencil's SVG frame to what it draws. libvisio sizes each stencil by its master's
// page, and some masters have a page far smaller than their picture (Dell EMC's rack and
// enclosure shapes come out 0.1" wide or tall), so everything outside the page was cut off.
// Text is left out of the extent: libvisio writes Visio's wrapped text as single long lines.

/** @typedef {[number, number, number, number, number, number]} Matrix  a b c d e f */
/** @typedef {{ minX: number, minY: number, maxX: number, maxY: number }} Extent */

const IDENTITY = /** @type {Matrix} */ ([1, 0, 0, 1, 0, 0]);
const TAG = /<(\/?)([\w:-]+)((?:[^>"]|"[^"]*")*)>|<!--[\s\S]*?-->/g;

/**
 * The frame (in viewBox units) that holds both the page and every shape and picture, or null
 * when the content already fits the page.
 * @param {string} svg  a stencil SVG as libvisio writes it
 * @returns {{ x: number, y: number, width: number, height: number, page: { x: number, y: number, width: number, height: number } } | null}
 */
export function contentFrame(svg) {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0];
  const viewBox = root && /\sviewBox="([^"]*)"/.exec(root)?.[1].trim().split(/[\s,]+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || viewBox.some((v) => !Number.isFinite(v)) || viewBox[2] <= 0 || viewBox[3] <= 0) return null;
  const [px, py, pw, ph] = viewBox;

  const extent = drawnExtent(svg);
  if (!extent) return null;
  // Strokes and antialiasing reach a little past a shape's edge; that is no reason to resize.
  const tolerance = Math.max(0.5, 0.01 * Math.max(pw, ph));
  if (extent.minX >= px - tolerance && extent.minY >= py - tolerance && extent.maxX <= px + pw + tolerance && extent.maxY <= py + ph + tolerance) {
    return null;
  }
  const minX = Math.min(px, extent.minX);
  const minY = Math.min(py, extent.minY);
  const maxX = Math.max(px + pw, extent.maxX);
  const maxY = Math.max(py + ph, extent.maxY);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, page: { x: px, y: py, width: pw, height: ph } };
}

/**
 * Rewrites the root element so the SVG shows `frame`: the viewBox becomes the frame and the
 * width and height grow by the same factor, so the drawing keeps its scale.
 * @param {string} svg
 * @param {{ x: number, y: number, width: number, height: number, page: { width: number, height: number } }} frame
 * @returns {string}
 */
export function applyFrame(svg, frame) {
  const sx = frame.width / frame.page.width;
  const sy = frame.height / frame.page.height;
  return svg.replace(/<svg\b[^>]*>/, (root) =>
    root
      .replace(/\sviewBox="[^"]*"/, ` viewBox="${[frame.x, frame.y, frame.width, frame.height].map(format).join(' ')}"`)
      .replace(/(\swidth=")([\d.eE+-]+)([a-z%]*)"/, (m, open, value, unit) => `${open}${format(Number(value) * sx)}${unit}"`)
      .replace(/(\sheight=")([\d.eE+-]+)([a-z%]*)"/, (m, open, value, unit) => `${open}${format(Number(value) * sy)}${unit}"`)
  );
}

/** @param {number} value */
function format(value) {
  return String(Math.round(value * 10000) / 10000);
}

/**
 * Bounds of the paths, rectangles, ellipses and images an SVG draws, in root user units.
 * @param {string} svg
 * @returns {Extent | null}
 */
export function drawnExtent(svg) {
  /** @type {Extent} */
  const extent = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  /** @type {{ name: string, matrix: Matrix, skip: boolean }[]} */
  const stack = [];
  for (const match of svg.matchAll(TAG)) {
    const [, closing, name, attributeText] = match;
    if (!name) continue;
    if (closing) {
      stack.pop();
      continue;
    }
    const selfClosing = attributeText.trimEnd().endsWith('/');
    const parent = stack.at(-1);
    const isRoot = stack.length === 0;
    const attributes = readAttributes(attributeText);
    const matrix = multiply(parent?.matrix ?? IDENTITY, attributes.transform ? parseTransform(attributes.transform) : IDENTITY);
    // Definitions draw nothing where they are; nested SVGs we inline are bounded by their box.
    const skip = Boolean(parent?.skip) || /^(defs|clipPath|mask|pattern|symbol|marker|linearGradient|radialGradient|text|style|title|desc)$/.test(name) || (!isRoot && name === 'svg');

    if (!parent?.skip) {
      if (name === 'path' && attributes.d) addPath(extent, attributes.d, matrix);
      else if (name === 'rect' || name === 'image' || (name === 'svg' && !isRoot)) {
        const x = Number(attributes.x ?? 0), y = Number(attributes.y ?? 0);
        const w = Number(attributes.width ?? 0), h = Number(attributes.height ?? 0);
        if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) {
          for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) addPoint(extent, matrix, cx, cy);
        }
      } else if (name === 'ellipse' || name === 'circle') {
        const cx = Number(attributes.cx ?? 0), cy = Number(attributes.cy ?? 0);
        const rx = Number(attributes.rx ?? attributes.r ?? 0), ry = Number(attributes.ry ?? attributes.r ?? 0);
        for (let k = 0; k < 16; k++) {
          const t = (k / 16) * 2 * Math.PI;
          addPoint(extent, matrix, cx + rx * Math.cos(t), cy + ry * Math.sin(t));
        }
      } else if (name === 'line' || name === 'polyline' || name === 'polygon') {
        const values = name === 'line'
          ? [attributes.x1, attributes.y1, attributes.x2, attributes.y2].map(Number)
          : (attributes.points ?? '').trim().split(/[\s,]+/).map(Number);
        for (let k = 0; k + 1 < values.length; k += 2) addPoint(extent, matrix, values[k], values[k + 1]);
      }
    }
    if (!selfClosing) stack.push({ name, matrix, skip });
  }
  return Number.isFinite(extent.minX) ? extent : null;
}

/** @param {string} text */
function readAttributes(text) {
  /** @type {Record<string, string>} */
  const attributes = {};
  for (const [, name, value] of text.matchAll(/([\w:-]+)="([^"]*)"/g)) attributes[name.replace(/^xlink:/, '')] = value;
  return attributes;
}

/** @param {Extent} extent @param {Matrix} m @param {number} x @param {number} y */
function addPoint(extent, m, x, y) {
  const tx = m[0] * x + m[2] * y + m[4];
  const ty = m[1] * x + m[3] * y + m[5];
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
  extent.minX = Math.min(extent.minX, tx);
  extent.minY = Math.min(extent.minY, ty);
  extent.maxX = Math.max(extent.maxX, tx);
  extent.maxY = Math.max(extent.maxY, ty);
}

/** @param {Matrix} a @param {Matrix} b @returns {Matrix} */
function multiply(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/** @param {string} transform @returns {Matrix} */
function parseTransform(transform) {
  let m = IDENTITY;
  for (const [, kind, args] of transform.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const v = args.trim().split(/[\s,]+/).map(Number);
    /** @type {Matrix} */
    let t = IDENTITY;
    if (kind === 'matrix' && v.length === 6) t = /** @type {Matrix} */ (v);
    else if (kind === 'translate') t = [1, 0, 0, 1, v[0] || 0, v[1] || 0];
    else if (kind === 'scale') t = [v[0], 0, 0, v[1] ?? v[0], 0, 0];
    else if (kind === 'rotate') {
      const r = ((v[0] || 0) * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
      const cx = v[1] || 0, cy = v[2] || 0;
      t = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
    } else if (kind === 'skewX') t = [1, 0, Math.tan(((v[0] || 0) * Math.PI) / 180), 1, 0, 0];
    else if (kind === 'skewY') t = [1, Math.tan(((v[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = multiply(m, t);
  }
  return m;
}

const PATH_TOKEN = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
/** @type {Record<string, number>} */
const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** @param {Extent} extent @param {string} d @param {Matrix} m */
function addPath(extent, d, m) {
  const tokens = d.match(PATH_TOKEN) ?? [];
  let x = 0, y = 0, startX = 0, startY = 0, cmd = '';
  let lastControlX = 0, lastControlY = 0, lastKind = '';
  /** @param {number} px @param {number} py */
  const add = (px, py) => addPoint(extent, m, px, py);
  for (let i = 0; i < tokens.length; ) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    const upper = cmd.toUpperCase();
    const arity = ARITY[upper];
    if (arity == null) return;
    const v = tokens.slice(i, i + arity).map(Number);
    if (v.length < arity || v.some((n) => !Number.isFinite(n))) return;
    i += arity;
    const rel = cmd !== upper;
    const ox = rel ? x : 0, oy = rel ? y : 0;
    let kind = upper;
    switch (upper) {
      case 'M':
        x = ox + v[0]; y = oy + v[1]; startX = x; startY = y; add(x, y);
        cmd = rel ? 'l' : 'L';
        break;
      case 'L': x = ox + v[0]; y = oy + v[1]; add(x, y); break;
      case 'H': x = (rel ? x : 0) + v[0]; add(x, y); break;
      case 'V': y = (rel ? y : 0) + v[0]; add(x, y); break;
      case 'C': case 'S': {
        const [x1, y1] = upper === 'C' ? [ox + v[0], oy + v[1]] : lastKind === 'C' ? [2 * x - lastControlX, 2 * y - lastControlY] : [x, y];
        const [x2, y2] = upper === 'C' ? [ox + v[2], oy + v[3]] : [ox + v[0], oy + v[1]];
        const [x3, y3] = upper === 'C' ? [ox + v[4], oy + v[5]] : [ox + v[2], oy + v[3]];
        addCubic(add, x, y, x1, y1, x2, y2, x3, y3);
        lastControlX = x2; lastControlY = y2; kind = 'C';
        x = x3; y = y3;
        break;
      }
      case 'Q': case 'T': {
        const [x1, y1] = upper === 'Q' ? [ox + v[0], oy + v[1]] : lastKind === 'Q' ? [2 * x - lastControlX, 2 * y - lastControlY] : [x, y];
        const [x2, y2] = upper === 'Q' ? [ox + v[2], oy + v[3]] : [ox + v[0], oy + v[1]];
        // A quadratic is the cubic with these control points.
        addCubic(add, x, y, x + (2 / 3) * (x1 - x), y + (2 / 3) * (y1 - y), x2 + (2 / 3) * (x1 - x2), y2 + (2 / 3) * (y1 - y2), x2, y2);
        lastControlX = x1; lastControlY = y1; kind = 'Q';
        x = x2; y = y2;
        break;
      }
      case 'A': {
        const ex = ox + v[5], ey = oy + v[6];
        addArc(add, x, y, v[0], v[1], v[2], v[3] !== 0, v[4] !== 0, ex, ey);
        x = ex; y = ey;
        break;
      }
      case 'Z': x = startX; y = startY; break;
    }
    lastKind = kind;
  }
}

/**
 * @param {(x: number, y: number) => void} add
 * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
 * @param {number} x2 @param {number} y2 @param {number} x3 @param {number} y3
 */
function addCubic(add, x0, y0, x1, y1, x2, y2, x3, y3) {
  add(x0, y0);
  add(x3, y3);
  for (const [p0, p1, p2, p3] of [[x0, x1, x2, x3], [y0, y1, y2, y3]]) {
    // Roots of the derivative, where the curve turns.
    const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
    const roots = Math.abs(a) < 1e-12 ? (Math.abs(b) < 1e-12 ? [] : [-c / b]) : (() => {
      const disc = b * b - 4 * a * c;
      if (disc < 0) return [];
      const s = Math.sqrt(disc);
      return [(-b + s) / (2 * a), (-b - s) / (2 * a)];
    })();
    for (const t of roots) {
      if (t <= 0 || t >= 1) continue;
      const mt = 1 - t;
      const px = mt ** 3 * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t ** 3 * x3;
      const py = mt ** 3 * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t ** 3 * y3;
      add(px, py);
    }
  }
}

// SVG arc endpoint parameters to points along the arc (SVG 1.1 implementation notes F.6.5).
/**
 * @param {(x: number, y: number) => void} add
 * @param {number} x1 @param {number} y1 @param {number} rx @param {number} ry @param {number} angle
 * @param {boolean} largeArc @param {boolean} sweep @param {number} x2 @param {number} y2
 */
function addArc(add, x1, y1, rx, ry, angle, largeArc, sweep, x2, y2) {
  add(x1, y1);
  add(x2, y2);
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return;
  const phi = (angle * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry, cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  /** @type {(ux: number, uy: number, vx: number, vy: number) => number} */
  const angleOf = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta = angleOf(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angleOf((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;
  const steps = 32;
  for (let k = 1; k < steps; k++) {
    const t = theta + (delta * k) / steps;
    add(cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos);
  }
}
