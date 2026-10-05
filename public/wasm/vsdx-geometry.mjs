// @ts-check
// Visio geometry: path rows merged with the master's, turned into drawing segments, and drawn as
// SVG for shapes that are not plain rectangles. Segments are in the shape's local inches, y up.
import { numberOf, colorOf } from './vsdx-model.mjs';
import { EPSILON, multiply, apply, rotate, scaleBy } from './vsdx-transform.mjs';
import { evaluateFormula } from './vsdx-formula.mjs';
import { number } from './vsdx-encode.mjs';

/** @typedef {import('./vsdx-model.mjs').Shape} Shape */
/** @typedef {import('./vsdx-model.mjs').VisioDocument} VisioDocument */
/** @typedef {import('./vsdx-model.mjs').GeometrySection} GeometrySection */
/** @typedef {import('./vsdx-transform.mjs').Point} Point */
/** @typedef {{ op: 'M', x: number, y: number } | { op: 'L', x: number, y: number }} LineSegment */
/** @typedef {{ op: 'C', x1: number, y1: number, x2: number, y2: number, x: number, y: number }} CurveSegment */
/**
 * An elliptical arc ending at (x, y); `rotation` is the major axis angle, counter-clockwise.
 * @typedef {{ op: 'A', x: number, y: number, rx: number, ry: number, rotation: number, large: boolean, ccw: boolean }} ArcSegment
 */
/** @typedef {LineSegment | CurveSegment | ArcSegment} Segment */
/** @typedef {{ noFill: boolean, noLine: boolean, noShow: boolean, segments: Segment[] }} Path */
/** @typedef {{ visible: boolean, color: string, weight: number, dash: string | null }} LineStyle */
/** @typedef {{ visible: boolean, color: string }} FillStyle */

/**
 * Geometry of a shape merged with its master's: sections and rows match by index, a cell the
 * shape leaves out comes from the master, and Del='1' removes a master row.
 * @param {Shape} shape
 * @returns {Map<number, GeometrySection>}
 */
function mergedGeometry(shape) {
  /** @type {Map<number, GeometrySection>} */
  const merged = new Map();
  if (shape.proto) {
    for (const [sectionIx, section] of mergedGeometry(shape.proto)) {
      const rows = new Map();
      for (const [rowIx, row] of section.rows) {
        rows.set(rowIx, { type: row.type, cells: new Map([...row.cells].map(([k, c]) => [k, { ...c, inherited: true }])) });
      }
      merged.set(sectionIx, { cells: new Map(section.cells), rows });
    }
  }
  for (const [sectionIx, section] of shape.geometry) {
    const target = merged.get(sectionIx) ?? { cells: new Map(), rows: new Map() };
    for (const [name, cell] of section.cells) target.cells.set(name, cell);
    for (const [rowIx, row] of section.rows) {
      if (row.deleted) {
        target.rows.delete(rowIx);
        continue;
      }
      const existing = target.rows.get(rowIx) ?? { type: row.type, cells: new Map() };
      if (row.type) existing.type = row.type;
      for (const [name, cell] of row.cells) existing.cells.set(name, cell);
      target.rows.set(rowIx, existing);
    }
    merged.set(sectionIx, target);
  }
  return new Map([...merged].sort((a, b) => a[0] - b[0]));
}

/**
 * The shape's geometry sections as paths of segments.
 * @param {VisioDocument} doc
 * @param {Shape} shape
 * @returns {Path[]}
 */
export function buildPaths(doc, shape) {
  const width = numberOf(doc, shape, 'Width', 0);
  const height = numberOf(doc, shape, 'Height', 0);
  const protoWidth = shape.proto ? numberOf(doc, shape.proto, 'Width', width) : width;
  const protoHeight = shape.proto ? numberOf(doc, shape.proto, 'Height', height) : height;
  const scaleX = Math.abs(protoWidth) > EPSILON ? width / protoWidth : 1;
  const scaleY = Math.abs(protoHeight) > EPSILON ? height / protoHeight : scaleX;

  const sections = mergedGeometry(shape);
  const sectionNumber = new Map([...sections.keys()].map((ix) => [`Geometry${ix + 1}`, ix]));

  /**
   * A cell of a geometry row. An inherited cell is recomputed from its formula for this shape's
   * size when the formula is simple enough, else the master's value is scaled.
   * @param {number | undefined} sectionIx
   * @param {number} rowIx
   * @param {string} name
   * @returns {number}
   */
  function valueOf(sectionIx, rowIx, name, depth = 0) {
    if (sectionIx === undefined) return 0;
    const cell = sections.get(sectionIx)?.rows.get(rowIx)?.cells.get(name);
    if (!cell) return 0;
    const own = parseFloat(cell.v ?? '');
    if (!cell.inherited && Number.isFinite(own)) return own;
    if (cell.inherited && cell.f && depth < 12) {
      try {
        return evaluateFormula(cell.f, (ref) => {
          const geometryRef = /^(Geometry\d+)\.([A-Z])(\d+)$/.exec(ref);
          if (geometryRef) return valueOf(sectionNumber.get(geometryRef[1]), Number(geometryRef[3]), geometryRef[2], depth + 1);
          if (ref === 'Width') return width;
          if (ref === 'Height') return height;
          throw new Error(`unsupported reference ${ref}`);
        });
      } catch {
        // fall through to the master's cached value below
      }
    }
    if (!Number.isFinite(own)) return 0;
    if (name === 'X') return own * scaleX;
    if (name === 'Y') return own * scaleY;
    return own;
  }

  /** @type {Path[]} */
  const paths = [];
  for (const [sectionIx, section] of sections) {
    /** @param {string} name */
    const flag = (name) => parseFloat(section.cells.get(name)?.v ?? '') === 1;
    /** @type {Path} */
    const path = { noFill: flag('NoFill'), noLine: flag('NoLine'), noShow: flag('NoShow'), segments: [] };
    let x = 0;
    let y = 0;
    /** @param {number} nx @param {number} ny */
    const lineTo = (nx, ny) => {
      path.segments.push({ op: 'L', x: nx, y: ny });
      x = nx;
      y = ny;
    };
    /** @param {number} nx @param {number} ny */
    const moveTo = (nx, ny) => {
      path.segments.push({ op: 'M', x: nx, y: ny });
      x = nx;
      y = ny;
    };

    for (const [rowIx, row] of section.rows) {
      /** @param {string} name */
      const get = (name) => valueOf(sectionIx, rowIx, name);
      /** @param {string} name */
      const formulaOf = (name) => row.cells.get(name)?.f ?? row.cells.get(name)?.v ?? '';
      switch (row.type) {
        case 'MoveTo':
          moveTo(get('X'), get('Y'));
          break;
        case 'RelMoveTo':
          moveTo(get('X') * width, get('Y') * height);
          break;
        case 'LineTo':
        case 'SplineStart':
        case 'SplineKnot':
          lineTo(get('X'), get('Y'));
          break;
        case 'RelLineTo':
          lineTo(get('X') * width, get('Y') * height);
          break;
        case 'RelCubBezTo':
          path.segments.push({
            op: 'C',
            x1: get('A') * width,
            y1: get('B') * height,
            x2: get('C') * width,
            y2: get('D') * height,
            x: get('X') * width,
            y: get('Y') * height,
          });
          x = get('X') * width;
          y = get('Y') * height;
          break;
        case 'RelQuadBezTo': {
          const [qx, qy] = [get('A') * width, get('B') * height];
          const [ex, ey] = [get('X') * width, get('Y') * height];
          path.segments.push({
            op: 'C',
            x1: x + (2 / 3) * (qx - x),
            y1: y + (2 / 3) * (qy - y),
            x2: ex + (2 / 3) * (qx - ex),
            y2: ey + (2 / 3) * (qy - ey),
            x: ex,
            y: ey,
          });
          x = ex;
          y = ey;
          break;
        }
        case 'PolylineTo': {
          const numbers = (/POLYLINE\(([^)]*)\)/i.exec(formulaOf('A'))?.[1] ?? '').split(',').map(parseFloat);
          const [xAbsolute, yAbsolute] = [numbers[0] === 1, numbers[1] === 1];
          for (let i = 2; i + 1 < numbers.length; i += 2) {
            lineTo(xAbsolute ? numbers[i] : numbers[i] * width, yAbsolute ? numbers[i + 1] : numbers[i + 1] * height);
          }
          lineTo(get('X'), get('Y'));
          break;
        }
        case 'NURBSTo': {
          // A smooth curve is drawn through its control polygon; exact knot evaluation is not worth it
          // for the small port and drive icons that use it.
          const numbers = (/NURBS\(([^)]*)\)/i.exec(formulaOf('E'))?.[1] ?? '').split(',').map(parseFloat);
          const [xAbsolute, yAbsolute] = [numbers[2] === 1, numbers[3] === 1];
          for (let i = 4; i + 3 < numbers.length; i += 4) {
            lineTo(xAbsolute ? numbers[i] : numbers[i] * width, yAbsolute ? numbers[i + 1] : numbers[i + 1] * height);
          }
          lineTo(get('X'), get('Y'));
          break;
        }
        case 'ArcTo':
          // A circular arc is given by its sagitta; its bow direction is not worth guessing, so it is straight.
          lineTo(get('X'), get('Y'));
          break;
        case 'EllipticalArcTo': {
          const arc = ellipticalArc([x, y], [get('A'), get('B')], [get('X'), get('Y')], get('C'), get('D'));
          if (arc) path.segments.push(arc);
          else path.segments.push({ op: 'L', x: get('X'), y: get('Y') });
          x = get('X');
          y = get('Y');
          break;
        }
        case 'Ellipse': {
          const [cx, cy] = [get('X'), get('Y')];
          const rx = Math.hypot(get('A') - cx, get('B') - cy);
          const ry = Math.hypot(get('C') - cx, get('D') - cy);
          const rotation = Math.atan2(get('B') - cy, get('A') - cx);
          /** @param {number} t @returns {Point} */
          const at = (t) => [
            cx + rx * Math.cos(t) * Math.cos(rotation) - ry * Math.sin(t) * Math.sin(rotation),
            cy + rx * Math.cos(t) * Math.sin(rotation) + ry * Math.sin(t) * Math.cos(rotation),
          ];
          const [x0, y0] = at(0);
          const [x1, y1] = at(Math.PI);
          moveTo(x0, y0);
          path.segments.push({ op: 'A', x: x1, y: y1, rx, ry, rotation, large: false, ccw: true });
          path.segments.push({ op: 'A', x: x0, y: y0, rx, ry, rotation, large: false, ccw: true });
          x = x0;
          y = y0;
          break;
        }
        default:
          break;
      }
    }
    if (path.segments.length > 0) paths.push(path);
  }
  return paths;
}

/**
 * Arc from p0 to p2 passing through p1 on an ellipse whose major axis lies at `angle` and whose
 * major:minor ratio is `ratio` (Visio's EllipticalArcTo).
 * @param {Point} p0
 * @param {Point} p1
 * @param {Point} p2
 * @param {number} angle
 * @param {number} ratio
 * @returns {ArcSegment | null}  null when the points are collinear
 */
function ellipticalArc(p0, p1, p2, angle, ratio) {
  const stretch = ratio > EPSILON ? ratio : 1;
  const toCircle = multiply(scaleBy(1, stretch), rotate(-angle));
  const [a, b, c] = [apply(toCircle, ...p0), apply(toCircle, ...p1), apply(toCircle, ...p2)];
  const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(cross) < EPSILON || Math.abs(d) < EPSILON) return null;

  const centreX =
    ((a[0] ** 2 + a[1] ** 2) * (b[1] - c[1]) + (b[0] ** 2 + b[1] ** 2) * (c[1] - a[1]) + (c[0] ** 2 + c[1] ** 2) * (a[1] - b[1])) / d;
  const centreY =
    ((a[0] ** 2 + a[1] ** 2) * (c[0] - b[0]) + (b[0] ** 2 + b[1] ** 2) * (a[0] - c[0]) + (c[0] ** 2 + c[1] ** 2) * (b[0] - a[0])) / d;
  const radius = Math.hypot(a[0] - centreX, a[1] - centreY);
  const counterClockwise = cross > 0;

  /** @param {Point} p */
  const angleOf = (p) => Math.atan2(p[1] - centreY, p[0] - centreX);
  const full = Math.PI * 2;
  const span = counterClockwise
    ? (((angleOf(c) - angleOf(a)) % full) + full) % full
    : (((angleOf(a) - angleOf(c)) % full) + full) % full;

  return {
    op: 'A',
    x: p2[0],
    y: p2[1],
    rx: radius,
    ry: radius / stretch,
    rotation: angle,
    large: span > Math.PI,
    ccw: counterClockwise,
  };
}

/**
 * Axis-aligned rectangle covering the whole shape box: becomes a native draw.io rectangle.
 * @param {Path[]} paths
 * @param {number} width
 * @param {number} height
 */
export function isFullRectangle(paths, width, height) {
  if (paths.length !== 1) return false;
  /** @type {Point[]} */
  const points = [];
  for (const segment of paths[0].segments) {
    if (segment.op !== 'M' && segment.op !== 'L') return false;
    points.push([segment.x, segment.y]);
  }
  if (points.length > 1) {
    const [first, last] = [points[0], points[points.length - 1]];
    if (Math.abs(first[0] - last[0]) < 1e-6 && Math.abs(first[1] - last[1]) < 1e-6) points.pop();
  }
  if (points.length !== 4) return false;
  const tolerance = Math.max(width, height) * 1e-3 + 1e-6;
  const corners = new Set();
  for (const [x, y] of points) {
    const column = Math.abs(x) < tolerance ? 0 : Math.abs(x - width) < tolerance ? 1 : -1;
    const row = Math.abs(y) < tolerance ? 0 : Math.abs(y - height) < tolerance ? 1 : -1;
    if (column < 0 || row < 0) return false;
    corners.add(column * 2 + row);
  }
  return corners.size === 4;
}

/** @type {Record<number, string>} */
const DASH_PATTERNS = { 2: '5 3', 3: '1 2', 4: '5 2 1 2', 5: '5 2 1 2 1 2', 6: '8 3', 7: '8 3 1 3', 8: '8 3 1 3 1 3' };
// Visio has 23 line patterns; 0 is "no line" and 1 solid. The ones beyond the table are all dashed.
const DEFAULT_DASH = '4 3';

/**
 * @param {VisioDocument} doc
 * @param {Shape} shape
 * @returns {LineStyle}  weight in inches, dash in multiples of the line width
 */
export function lineStyleOf(doc, shape) {
  const pattern = numberOf(doc, shape, 'LinePattern', 1);
  return {
    visible: pattern !== 0,
    color: colorOf(doc, shape, 'LineColor') ?? '#000000',
    weight: numberOf(doc, shape, 'LineWeight', 0.01),
    dash: pattern > 1 ? DASH_PATTERNS[pattern] ?? DEFAULT_DASH : null,
  };
}

/**
 * @param {VisioDocument} doc
 * @param {Shape} shape
 * @returns {FillStyle}
 */
export function fillStyleOf(doc, shape) {
  const pattern = numberOf(doc, shape, 'FillPattern', 1);
  return { visible: pattern !== 0, color: colorOf(doc, shape, 'FillForegnd') ?? '#ffffff' };
}

/**
 * SVG whose user units are thousandths of an inch, covering the shape's local box.
 * @param {VisioDocument} doc
 * @param {Shape} shape
 * @param {Path[]} paths
 * @param {number} width
 * @param {number} height
 * @returns {string | null}  null when every path is hidden
 */
export function shapeSvg(doc, shape, paths, width, height) {
  const unit = 1000;
  const line = lineStyleOf(doc, shape);
  const fill = fillStyleOf(doc, shape);
  /** @param {number} y */
  const flipY = (y) => number((height - y) * unit);
  const strokeWidth = Math.max(line.weight * unit, 0.5);

  const elements = [];
  for (const path of paths) {
    if (path.noShow) continue;
    const commands = [];
    for (const segment of path.segments) {
      const x = number(segment.x * unit);
      if (segment.op === 'M' || segment.op === 'L') commands.push(`${segment.op}${x} ${flipY(segment.y)}`);
      else if (segment.op === 'C') {
        commands.push(
          `C${number(segment.x1 * unit)} ${flipY(segment.y1)} ${number(segment.x2 * unit)} ${flipY(segment.y2)} ${x} ${flipY(segment.y)}`
        );
      } else {
        // Counter-clockwise in y-up is sweep 0 on screen, and the x-axis rotation is clockwise there.
        commands.push(
          `A${number(segment.rx * unit)} ${number(segment.ry * unit)} ${number((-segment.rotation * 180) / Math.PI)} ${segment.large ? 1 : 0} ${segment.ccw ? 0 : 1} ${x} ${flipY(segment.y)}`
        );
      }
    }
    const first = path.segments[0];
    const last = path.segments[path.segments.length - 1];
    const closed = path.segments.length > 2 && Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6;
    const fillValue = fill.visible && !path.noFill ? fill.color : 'none';
    const strokeValue = line.visible && !path.noLine ? line.color : 'none';
    const dash = line.dash ? ` stroke-dasharray="${line.dash.split(' ').map((n) => number(Number(n) * strokeWidth)).join(' ')}"` : '';
    elements.push(
      `<path d="${commands.join('')}${closed ? 'Z' : ''}" fill="${fillValue}" stroke="${strokeValue}" stroke-width="${number(strokeWidth)}"${dash} stroke-linejoin="round"/>`
    );
  }
  if (elements.length === 0) return null;
  const [w, h] = [number(width * unit), number(height * unit)];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${elements.join('')}</svg>`;
}
