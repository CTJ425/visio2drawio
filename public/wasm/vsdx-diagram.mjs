// Converts the drawing pages of a .vsdx into draw.io pages with editable cells: one vertex per
// Visio shape and one edge per connector, attached to the shapes it joins in Visio.
//
// libvisio only reports the primitives it draws, so the structure (shapes, groups, connectors)
// comes from the package XML parsed here. Master shapes (servers, switches...) are still drawn
// by libvisio: the caller passes the SVG it rendered for each master, and each instance becomes
// an image cell placed with the instance's own transform.
//
// Visio's y axis points up and its unit is the inch; draw.io's y axis points down. All geometry
// is carried in page inches with y up and flipped only when the cells are written.
import { parseXml, childrenOf, childOf } from './vsdx-xml.mjs';

const EPSILON = 1e-9;

// ---------------------------------------------------------------------------------------------
// Package parts
// ---------------------------------------------------------------------------------------------

async function readXml(zip, name) {
  const bytes = await zip.read(name);
  return bytes ? parseXml(new TextDecoder().decode(bytes)) : null;
}

function resolvePart(baseDir, target) {
  const parts = target.startsWith('/') ? [] : baseDir.split('/').filter(Boolean);
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop();
    else if (piece && piece !== '.') parts.push(piece);
  }
  return parts.join('/');
}

// Relationship id -> part path, for the rels file that belongs to `partName`.
async function readRels(zip, partName) {
  const slash = partName.lastIndexOf('/');
  const dir = partName.slice(0, slash);
  const root = await readXml(zip, `${dir}/_rels/${partName.slice(slash + 1)}.rels`);
  const rels = new Map();
  for (const rel of childrenOf(root, 'Relationship')) {
    rels.set(rel.attrs.Id, resolvePart(dir, rel.attrs.Target));
  }
  return rels;
}

// ---------------------------------------------------------------------------------------------
// Shape model
// ---------------------------------------------------------------------------------------------

function parseCells(element) {
  const cells = new Map();
  for (const cell of childrenOf(element, 'Cell')) {
    cells.set(cell.attrs.N, { v: cell.attrs.V, f: cell.attrs.F });
  }
  return cells;
}

// Geometry sections: Map sectionIx -> { cells, rows: Map rowIx -> { type, cells } }.
function parseGeometry(element) {
  const sections = new Map();
  for (const section of childrenOf(element, 'Section')) {
    if (section.attrs.N !== 'Geometry') continue;
    const rows = new Map();
    for (const row of childrenOf(section, 'Row')) {
      rows.set(Number(row.attrs.IX), { type: row.attrs.T, deleted: row.attrs.Del === '1', cells: parseCells(row) });
    }
    sections.set(Number(section.attrs.IX ?? 0), { cells: parseCells(section), rows });
  }
  return sections;
}

// Character/Paragraph sections: Map rowIx -> cells.
function parseRows(element, sectionName) {
  const rows = new Map();
  for (const section of childrenOf(element, 'Section')) {
    if (section.attrs.N !== sectionName) continue;
    for (const row of childrenOf(section, 'Row')) rows.set(Number(row.attrs.IX ?? 0), parseCells(row));
  }
  return rows;
}

// <Text> holds runs of text separated by <cp IX> (character style) and <pp IX> (paragraph style).
function parseText(element) {
  const textElement = childOf(element, 'Text');
  if (!textElement) return null;
  const runs = [];
  let cp = 0;
  let pp = 0;
  for (const kid of textElement.kids) {
    if (typeof kid === 'string') {
      runs.push({ text: kid, cp, pp });
    } else if (kid.name === 'cp') {
      cp = Number(kid.attrs.IX ?? 0);
    } else if (kid.name === 'pp') {
      pp = Number(kid.attrs.IX ?? 0);
    }
  }
  return runs;
}

function parseShape(element, context, parent) {
  const shape = {
    id: element.attrs.ID,
    type: element.attrs.Type || 'Shape',
    parent,
    children: [],
    proto: null,
    instanceMaster: null,
    isInstance: element.attrs.Master !== undefined,
    lineStyle: element.attrs.LineStyle,
    fillStyle: element.attrs.FillStyle,
    textStyle: element.attrs.TextStyle,
    cells: parseCells(element),
    geometry: parseGeometry(element),
    character: parseRows(element, 'Character'),
    paragraph: parseRows(element, 'Paragraph'),
    text: parseText(element),
    foreign: null,
  };

  const foreignData = childOf(element, 'ForeignData');
  if (foreignData) {
    shape.foreign = { type: foreignData.attrs.ForeignType, relId: childOf(foreignData, 'Rel')?.attrs['r:id'] };
  }

  if (element.attrs.Master !== undefined) {
    const master = context.masters.get(element.attrs.Master);
    shape.instanceMaster = master ?? null;
    shape.proto = master?.top ?? null;
  } else {
    shape.instanceMaster = context.instanceMaster;
    if (element.attrs.MasterShape !== undefined && context.instanceMaster) {
      shape.proto = context.instanceMaster.shapesById.get(element.attrs.MasterShape) ?? null;
    }
  }

  context.shapesById.set(shape.id, shape);
  const nested = childOf(element, 'Shapes');
  if (nested) {
    const childContext = { ...context, instanceMaster: shape.instanceMaster };
    for (const child of childrenOf(nested, 'Shape')) shape.children.push(parseShape(child, childContext, shape));
  }
  return shape;
}

// ---------------------------------------------------------------------------------------------
// Cell lookup: own cell, then the master shape, then the style sheets
// ---------------------------------------------------------------------------------------------

function styleKind(name) {
  if (/^(Line|BeginArrow|EndArrow|Rounding)/.test(name)) return 'lineStyle';
  if (/^(Fill|Shdw)/.test(name)) return 'fillStyle';
  return 'textStyle';
}

function styleCell(doc, shape, name) {
  const kind = styleKind(name);
  let id;
  for (let x = shape; x && id === undefined; x = x.proto) id = x[kind];
  for (let guard = 0; id !== undefined && guard < 16; guard++) {
    const sheet = doc.styleSheets.get(id);
    if (!sheet) return undefined;
    const cell = sheet.cells.get(name);
    if (cell && cell.v !== 'Themed') return cell;
    id = sheet[kind];
  }
  return undefined;
}

function cellOf(doc, shape, name) {
  for (let x = shape; x; x = x.proto) {
    const cell = x.cells.get(name);
    if (cell) return cell;
  }
  return styleCell(doc, shape, name);
}

// A cell the shape itself (or its master) defines, ignoring style sheets.
function hasOwnCell(shape, name) {
  for (let x = shape; x; x = x.proto) if (x.cells.has(name)) return true;
  return false;
}

function numberOf(doc, shape, name, fallback) {
  const value = parseFloat(cellOf(doc, shape, name)?.v);
  return Number.isFinite(value) ? value : fallback;
}

// Visio's default palette for colour cells that hold an index instead of "#rrggbb".
const DEFAULT_PALETTE = [
  '#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff',
  '#800000', '#008000', '#000080', '#808000', '#800080', '#008080', '#c0c0c0', '#e6e6e6',
  '#cdcdcd', '#b3b3b3', '#9a9a9a', '#808080', '#666666', '#4d4d4d', '#333333', '#1a1a1a',
];

function colorOf(doc, shape, name) {
  const value = cellOf(doc, shape, name)?.v;
  if (value === undefined) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(value)) return '#' + [...value.slice(1)].map((c) => c + c).join('').toLowerCase();
  if (/^\d+$/.test(value)) return doc.colors.get(Number(value)) ?? DEFAULT_PALETTE[Number(value)] ?? null;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Affine transforms [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f
// ---------------------------------------------------------------------------------------------

const IDENTITY = [1, 0, 0, 1, 0, 0];

function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < EPSILON) return IDENTITY;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

const translate = (x, y) => [1, 0, 0, 1, x, y];
const rotate = (angle) => [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0];
const scaleBy = (sx, sy) => [sx, 0, 0, sy, 0, 0];

// Shape-local coordinates -> parent coordinates: flip and rotate about the pin.
function localToParent(doc, shape) {
  const pinX = numberOf(doc, shape, 'PinX', 0);
  const pinY = numberOf(doc, shape, 'PinY', 0);
  const locPinX = numberOf(doc, shape, 'LocPinX', 0);
  const locPinY = numberOf(doc, shape, 'LocPinY', 0);
  const angle = numberOf(doc, shape, 'Angle', 0);
  const flipX = numberOf(doc, shape, 'FlipX', 0) ? -1 : 1;
  const flipY = numberOf(doc, shape, 'FlipY', 0) ? -1 : 1;
  return multiply(
    translate(pinX, pinY),
    multiply(rotate(angle), multiply(scaleBy(flipX, flipY), translate(-locPinX, -locPinY)))
  );
}

// Where a w x h local box ends up: centre, size, rotation (radians, counter-clockwise, y up)
// and whether it is mirrored. A mirrored box is expressed as "flip horizontally, then rotate",
// which is how draw.io applies its flipH and rotation styles.
function placementOf(m, w, h) {
  const widthScale = Math.hypot(m[0], m[1]);
  const heightScale = Math.hypot(m[2], m[3]);
  const mirrored = m[0] * m[3] - m[1] * m[2] < 0;
  const [cx, cy] = apply(m, w / 2, h / 2);
  return {
    cx,
    cy,
    w: w * widthScale,
    h: h * heightScale,
    angle: mirrored ? Math.atan2(-m[1], -m[0]) : Math.atan2(m[1], m[0]),
    mirrored,
  };
}

// Page point -> fractions of the placed box measured from its top left, in the unflipped,
// unrotated frame that draw.io's exitX/entryX constraints use.
function fractionIn(placement, x, y) {
  const dx = x - placement.cx;
  const dy = y - placement.cy;
  const cos = Math.cos(-placement.angle);
  const sin = Math.sin(-placement.angle);
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  const u = 0.5 + localX / (placement.w || 1);
  return { x: placement.mirrored ? 1 - u : u, y: 0.5 - localY / (placement.h || 1) };
}

// ---------------------------------------------------------------------------------------------
// Formulas: only what inherited geometry cells need (Width*0.5, Geometry1.Y3, GUARD(...))
// ---------------------------------------------------------------------------------------------

function evaluateFormula(formula, resolve) {
  const tokens = [];
  const pattern = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?)|([A-Za-z_][\w.!]*)|(.))/gy;
  for (let match; pattern.lastIndex < formula.length && (match = pattern.exec(formula)); ) {
    if (match[1] !== undefined) tokens.push({ number: parseFloat(match[1]) });
    else if (match[2] !== undefined) tokens.push({ name: match[2] });
    else if (match[3] !== undefined) tokens.push({ op: match[3] });
  }

  let at = 0;
  const peek = () => tokens[at];
  const take = () => tokens[at++];
  const isOp = (op) => peek()?.op === op;

  function primary() {
    const token = take();
    if (!token) throw new Error('unexpected end');
    if (token.number !== undefined) return token.number;
    if (token.op === '(') {
      const value = expression();
      if (!isOp(')')) throw new Error('missing )');
      take();
      return value;
    }
    if (token.name === undefined) throw new Error(`unexpected ${token.op}`);
    if (!isOp('(')) return resolve(token.name);
    take();
    const args = [];
    while (!isOp(')')) {
      args.push(expression());
      if (isOp(',')) take();
      else if (!isOp(')')) throw new Error('bad argument list');
    }
    take();
    return callFunction(token.name.toUpperCase(), args);
  }
  function unary() {
    if (isOp('-')) {
      take();
      return -unary();
    }
    if (isOp('+')) {
      take();
      return unary();
    }
    const base = primary();
    if (isOp('^')) {
      take();
      return Math.pow(base, unary());
    }
    return base;
  }
  function term() {
    let value = unary();
    while (isOp('*') || isOp('/')) value = take().op === '*' ? value * unary() : value / unary();
    return value;
  }
  function expression() {
    let value = term();
    while (isOp('+') || isOp('-')) value = take().op === '+' ? value + term() : value - term();
    return value;
  }

  const value = expression();
  if (at < tokens.length || !Number.isFinite(value)) throw new Error('trailing input');
  return value;
}

function callFunction(name, args) {
  switch (name) {
    case 'GUARD':
      return args[0];
    case 'SQRT':
      return Math.sqrt(args[0]);
    case 'ABS':
      return Math.abs(args[0]);
    case 'MIN':
      return Math.min(...args);
    case 'MAX':
      return Math.max(...args);
    case 'SIN':
      return Math.sin(args[0]);
    case 'COS':
      return Math.cos(args[0]);
    case 'ATAN2':
      return Math.atan2(args[0], args[1]);
    case 'IF':
      return args[0] ? args[1] : args[2];
    default:
      throw new Error(`unsupported function ${name}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Geometry: Visio path rows -> drawing segments
// ---------------------------------------------------------------------------------------------

// Geometry of a shape merged with its master's: sections and rows match by index, a cell the
// shape leaves out comes from the master, and Del='1' removes a master row.
function mergedGeometry(shape) {
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

// Pen-style segments in the shape's local inches (y up):
//   { op: 'M'|'L', x, y } | { op: 'C', x1, y1, x2, y2, x, y } | { op: 'A', x, y, rx, ry, rotation, large, ccw }
function buildPaths(doc, shape) {
  const width = numberOf(doc, shape, 'Width', 0);
  const height = numberOf(doc, shape, 'Height', 0);
  const protoWidth = shape.proto ? numberOf(doc, shape.proto, 'Width', width) : width;
  const protoHeight = shape.proto ? numberOf(doc, shape.proto, 'Height', height) : height;
  const scaleX = Math.abs(protoWidth) > EPSILON ? width / protoWidth : 1;
  const scaleY = Math.abs(protoHeight) > EPSILON ? height / protoHeight : scaleX;

  const sections = mergedGeometry(shape);
  const sectionNumber = new Map([...sections.keys()].map((ix) => [`Geometry${ix + 1}`, ix]));

  function valueOf(sectionIx, rowIx, name, depth = 0) {
    const cell = sections.get(sectionIx)?.rows.get(rowIx)?.cells.get(name);
    if (!cell) return 0;
    const own = parseFloat(cell.v);
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

  const paths = [];
  for (const [sectionIx, section] of sections) {
    const flag = (name) => parseFloat(section.cells.get(name)?.v) === 1;
    const path = { noFill: flag('NoFill'), noLine: flag('NoLine'), noShow: flag('NoShow'), segments: [] };
    let x = 0;
    let y = 0;
    const lineTo = (nx, ny) => {
      path.segments.push({ op: 'L', x: nx, y: ny });
      x = nx;
      y = ny;
    };
    const moveTo = (nx, ny) => {
      path.segments.push({ op: 'M', x: nx, y: ny });
      x = nx;
      y = ny;
    };

    for (const [rowIx, row] of section.rows) {
      const get = (name) => valueOf(sectionIx, rowIx, name);
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

// Arc from p0 to p2 passing through p1 on an ellipse whose major axis lies at `angle` and whose
// major:minor ratio is `ratio` (Visio's EllipticalArcTo). Returns an 'A' segment in y-up inches.
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

// Axis-aligned rectangle covering the whole shape box: becomes a native draw.io rectangle.
function isFullRectangle(paths, width, height) {
  if (paths.length !== 1) return false;
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

// ---------------------------------------------------------------------------------------------
// Drawing: SVG for shapes that are not plain rectangles
// ---------------------------------------------------------------------------------------------

const DASH_PATTERNS = { 2: '5 3', 3: '1 2', 4: '5 2 1 2', 5: '5 2 1 2 1 2', 6: '8 3', 7: '8 3 1 3', 8: '8 3 1 3 1 3' };
// Visio has 23 line patterns; 0 is "no line" and 1 solid. The ones beyond the table are all dashed.
const DEFAULT_DASH = '4 3';

function number(value) {
  return Number(value.toFixed(3)).toString();
}

function escapeAttribute(text) {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function lineStyleOf(doc, shape) {
  const pattern = numberOf(doc, shape, 'LinePattern', 1);
  return {
    visible: pattern !== 0,
    color: colorOf(doc, shape, 'LineColor') ?? '#000000',
    weight: numberOf(doc, shape, 'LineWeight', 0.01),
    dash: pattern > 1 ? DASH_PATTERNS[pattern] ?? DEFAULT_DASH : null,
  };
}

function fillStyleOf(doc, shape) {
  const pattern = numberOf(doc, shape, 'FillPattern', 1);
  return { visible: pattern !== 0, color: colorOf(doc, shape, 'FillForegnd') ?? '#ffffff' };
}

// SVG whose user units are thousandths of an inch, covering the shape's local box.
function shapeSvg(doc, shape, paths, width, height) {
  const unit = 1000;
  const line = lineStyleOf(doc, shape);
  const fill = fillStyleOf(doc, shape);
  const flipY = (y) => number((height - y) * unit);
  const strokeWidth = Math.max(line.weight * unit, 0.5);

  const elements = [];
  for (const path of paths) {
    if (path.noShow) continue;
    const commands = [];
    for (const segment of path.segments) {
      const x = number(segment.x * unit);
      if (segment.op === 'M') commands.push(`M${x} ${flipY(segment.y)}`);
      else if (segment.op === 'L') commands.push(`L${x} ${flipY(segment.y)}`);
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

// ---------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------

function characterCell(doc, shape, ix, name) {
  for (let x = shape; x; x = x.proto) {
    const cell = x.character.get(ix)?.get(name);
    if (cell) return cell;
  }
  return styleCell(doc, shape, name);
}

function paragraphAlignment(doc, shape, ix) {
  for (let x = shape; x; x = x.proto) {
    const cell = x.paragraph.get(ix)?.get('HorzAlign');
    if (cell) return Number(cell.v);
  }
  return 1;
}

function fontName(doc, cell) {
  if (!cell || cell.v === undefined || cell.v === '') return null;
  return /^\d+$/.test(cell.v) ? doc.faces.get(Number(cell.v)) ?? null : cell.v;
}

function characterStyle(doc, shape, ix, scale) {
  const colorValue = characterCell(doc, shape, ix, 'Color')?.v;
  const probe = { cells: new Map([['Color', { v: colorValue }]]), proto: null };
  return {
    size: Math.round(parseFloat(characterCell(doc, shape, ix, 'Size')?.v ?? 0.1667) * scale * 10) / 10,
    color: colorValue === undefined ? '#000000' : colorOf(doc, probe, 'Color') ?? '#000000',
    bits: parseInt(characterCell(doc, shape, ix, 'Style')?.v ?? 0, 10) || 0,
    font: fontName(doc, characterCell(doc, shape, ix, 'Font')),
  };
}

// HTML label with a span per run whose character style differs from the first one's.
function labelOf(doc, shape, scale) {
  const runs = (shape.text ?? (shape.proto ? shape.proto.text : null))?.filter((run) => run.text !== '');
  if (!runs || runs.length === 0) return null;
  const joined = runs.map((run) => run.text).join('');
  if (joined.trim() === '') return null;

  const base = characterStyle(doc, shape, runs[0].cp, scale);
  let html = '';
  for (const run of runs) {
    const style = characterStyle(doc, shape, run.cp, scale);
    const css = [];
    if (style.size !== base.size) css.push(`font-size:${style.size}px`);
    if (style.color !== base.color) css.push(`color:${style.color}`);
    if (style.font && style.font !== base.font) css.push(`font-family:${style.font}`);
    if ((style.bits & 1) !== (base.bits & 1)) css.push(`font-weight:${style.bits & 1 ? 'bold' : 'normal'}`);
    if ((style.bits & 2) !== (base.bits & 2)) css.push(`font-style:${style.bits & 2 ? 'italic' : 'normal'}`);
    if ((style.bits & 4) !== (base.bits & 4)) css.push(`text-decoration:${style.bits & 4 ? 'underline' : 'none'}`);
    const body = escapeHtml(run.text.replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>');
    html += css.length ? `<span style="${css.join(';')}">${body}</span>` : body;
  }
  html = html.replace(/(<br>)+$/, '');
  if (html === '') return null;
  return { html, base, align: paragraphAlignment(doc, shape, runs[0].pp) };
}

// Text in a filled or outlined box wraps at the box. A bare label or a separate text block is sized
// to its text by Visio, so it must not wrap when the viewer's font is wider than the original.
function textStyleFragment(doc, shape, label, wrap) {
  const verticalAlign = numberOf(doc, shape, 'VerticalAlign', 1);
  const fragments = [
    `fontSize=${label.base.size}`,
    `fontColor=${label.base.color}`,
    `align=${['left', 'center', 'right'][label.align] ?? 'center'}`,
    `verticalAlign=${['top', 'middle', 'bottom'][verticalAlign] ?? 'middle'}`,
    wrap ? 'whiteSpace=wrap' : 'whiteSpace=nowrap',
    'html=1',
  ];
  if (label.base.font) fragments.push(`fontFamily=${label.base.font.replace(/;/g, '')}`);
  if (label.base.bits & 7) fragments.push(`fontStyle=${label.base.bits & 7}`);
  return fragments.join(';') + ';';
}

// ---------------------------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------------------------

function imageDataUri(mime, bytesOrText) {
  const base64 = typeof bytesOrText === 'string' ? toBase64(bytesOrText) : bytesToBase64(bytesOrText);
  // draw.io splits styles on ';', so the URI omits ';base64' (draw.io re-adds it when rendering).
  return `data:${mime},${base64}`;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const MIME_BY_EXTENSION = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml' };

class PageConverter {
  constructor(doc, page, options) {
    this.doc = doc;
    this.page = page;
    this.options = options;
    this.scale = options.scale;
    this.cells = [];
    this.vertices = new Map(); // Visio shape id -> { id, placement }
    this.warnings = options.warnings;
  }

  point(x, y) {
    return { x: x * this.scale, y: (this.page.height - y) * this.scale };
  }

  geometryXml(placement) {
    const w = placement.w * this.scale;
    const h = placement.h * this.scale;
    const { x, y } = this.point(placement.cx, placement.cy);
    return `<mxGeometry x="${number(x - w / 2)}" y="${number(y - h / 2)}" width="${number(w)}" height="${number(h)}" as="geometry"/>`;
  }

  placementStyle(placement) {
    let style = '';
    const degrees = (((-placement.angle * 180) / Math.PI) % 360 + 360) % 360;
    if (degrees > 1e-6 && Math.abs(degrees - 360) > 1e-6) style += `rotation=${number(degrees)};`;
    if (placement.mirrored) style += 'flipH=1;';
    return style;
  }

  addVertex(id, value, style, placement) {
    this.cells.push(
      `<mxCell id="${id}" value="${escapeAttribute(value ?? '')}" style="${escapeAttribute(style)}" vertex="1" parent="1">${this.geometryXml(placement)}</mxCell>`
    );
  }

  // Walks the shape tree in drawing order, so later shapes stay on top as in Visio.
  async walk(shapes, parentMatrix, targets, connectorsByShape) {
    for (const shape of shapes) {
      if (shape.type === 'Guide' || this.isHidden(shape)) continue;
      const matrix = multiply(parentMatrix, localToParent(this.doc, shape));
      const isConnector = connectorsByShape.has(shape.id) || this.isOneDimensionalLine(shape);
      if (isConnector) {
        this.pendingEdges.push({ shape, parentMatrix, matrix, connects: connectorsByShape.get(shape.id) });
      } else if (shape.isInstance && shape.instanceMaster) {
        await this.emitMasterInstance(shape, parentMatrix, targets);
      } else if (shape.type === 'Group') {
        await this.emitOwnContent(shape, matrix, targets);
        if (targets.has(shape.id) && !this.vertices.has(shape.id)) this.emitAnchor(shape, matrix);
        await this.walk(shape.children, matrix, targets, connectorsByShape);
      } else {
        await this.emitOwnContent(shape, matrix, targets);
      }
    }
  }

  isHidden(shape) {
    const members = cellOf(this.doc, shape, 'LayerMember')?.v;
    if (!members) return false;
    const layers = members.split(';').filter((ix) => ix !== '');
    return layers.length > 0 && layers.every((ix) => this.page.hiddenLayers.has(Number(ix)));
  }

  // Lines drawn with Visio's line tools are 1-D shapes (BeginX/EndX) with an open path.
  isOneDimensionalLine(shape) {
    if (shape.type !== 'Shape' || !hasOwnCell(shape, 'BeginX') || !hasOwnCell(shape, 'EndX')) return false;
    return numberOf(this.doc, shape, 'ObjType', 0) === 2 || (shape.proto && numberOf(this.doc, shape.proto, 'ObjType', 0) === 2);
  }

  // An invisible cell so that connectors attached to a group still have something to attach to.
  emitAnchor(group, matrix) {
    const width = numberOf(this.doc, group, 'Width', 0);
    const height = numberOf(this.doc, group, 'Height', 0);
    const placement = placementOf(matrix, Math.max(width, 0.01), Math.max(height, 0.01));
    const id = `s${group.id}`;
    this.vertices.set(group.id, { id, placement });
    this.addVertex(id, '', `fillColor=none;strokeColor=none;${this.placementStyle(placement)}`, placement);
  }

  async emitMasterInstance(shape, parentMatrix, targets) {
    const master = shape.instanceMaster;
    const svg = this.options.masterSvgs.get(master.name) ?? this.options.masterSvgs.get(master.nameU);
    const top = master.top;
    if (!svg || !top) {
      // No picture for this master: draw the shape from its own geometry.
      const matrix = multiply(parentMatrix, localToParent(this.doc, shape));
      await this.emitOwnContent(shape, matrix, targets);
      await this.walk(shape.children, matrix, targets, this.connectorsByShape);
      return;
    }

    // Master page -> instance page: undo the master top shape's own placement, scale it to the
    // instance's size (a master is usually dropped at a different scale), then place the instance.
    const widthRatio = safeRatio(numberOf(this.doc, shape, 'Width', 1), numberOf(this.doc, top, 'Width', 1));
    const heightRatio = safeRatio(numberOf(this.doc, shape, 'Height', 1), numberOf(this.doc, top, 'Height', 1), widthRatio);
    const toPage = multiply(
      parentMatrix,
      multiply(localToParent(this.doc, shape), multiply(scaleBy(widthRatio, heightRatio), invert(localToParent(this.doc, top))))
    );
    const picture = masterPicture(this.doc, master, svg);
    const placement = placementOf(multiply(toPage, translate(picture.x, picture.y)), picture.width, picture.height);
    const id = `s${shape.id}`;
    this.vertices.set(shape.id, { id, placement });
    const label = labelOf(this.doc, shape, this.scale);
    const style =
      `shape=image;imageAspect=0;image=${picture.uri};` +
      `verticalLabelPosition=middle;labelPosition=center;verticalAlign=middle;align=center;` +
      this.placementStyle(placement);
    this.addVertex(id, '', style, placement);
    if (label) this.emitText(shape, parentMatrix, label, `t${shape.id}`);
  }

  // The shape's own drawing: native rectangle, SVG path, or picture, plus its text.
  async emitOwnContent(shape, matrix, targets) {
    const width = numberOf(this.doc, shape, 'Width', 0);
    const height = numberOf(this.doc, shape, 'Height', 0);
    const label = labelOf(this.doc, shape, this.scale);
    const isTarget = targets.has(shape.id);
    const id = `s${shape.id}`;
    const placement = placementOf(matrix, width, height);

    if (shape.type === 'Foreign' && (await this.emitPicture(shape, id, placement))) {
      this.vertices.set(shape.id, { id, placement });
      if (label) this.emitText(shape, matrix, label, `t${shape.id}`, true);
      return;
    }

    const paths = buildPaths(this.doc, shape).filter((path) => !path.noShow);
    const line = lineStyleOf(this.doc, shape);
    const fill = fillStyleOf(this.doc, shape);
    const visibleGeometry = paths.some((path) => (fill.visible && !path.noFill) || (line.visible && !path.noLine));
    const separateText = label && this.hasOffsetTextBlock(shape, width, height);

    if (paths.length > 0 && visibleGeometry && width > EPSILON && height > EPSILON) {
      this.vertices.set(shape.id, { id, placement });
      if (isFullRectangle(paths, width, height)) {
        const stroke = line.visible && !paths[0].noLine ? `strokeColor=${line.color};strokeWidth=${number(Math.max(line.weight * this.scale, 0.5))};` : 'strokeColor=none;';
        const dash = line.visible && line.dash ? `dashed=1;dashPattern=${line.dash};` : '';
        const fillStyle = fill.visible && !paths[0].noFill ? `fillColor=${fill.color};` : 'fillColor=none;';
        const boxed = (fill.visible && !paths[0].noFill) || (line.visible && !paths[0].noLine);
        const textStyle = label && !separateText ? textStyleFragment(this.doc, shape, label, boxed) : 'html=1;';
        this.addVertex(id, !separateText && label ? label.html : '', `rounded=0;${fillStyle}${stroke}${dash}${textStyle}${this.placementStyle(placement)}`, placement);
      } else {
        const svg = shapeSvg(this.doc, shape, paths, width, height);
        this.addVertex(id, '', `shape=image;imageAspect=0;image=${imageDataUri('image/svg+xml', svg)};${this.placementStyle(placement)}`, placement);
        if (label && !separateText) this.emitText(shape, matrix, label, `t${shape.id}`, true);
      }
      if (separateText) this.emitText(shape, matrix, label, `t${shape.id}`, true);
      return;
    }

    if (label || isTarget) {
      if (width > EPSILON && height > EPSILON) this.vertices.set(shape.id, { id, placement });
      if (label && !separateText && width > EPSILON && height > EPSILON) {
        this.addVertex(id, label.html, `fillColor=none;strokeColor=none;${textStyleFragment(this.doc, shape, label, false)}${this.placementStyle(placement)}`, placement);
      } else if (label) {
        this.emitText(shape, matrix, label, `t${shape.id}`, true);
      } else if (width > EPSILON && height > EPSILON) {
        this.addVertex(id, '', `fillColor=none;strokeColor=none;${this.placementStyle(placement)}`, placement);
      }
    }
  }

  async emitPicture(shape, id, placement) {
    const rel = shape.foreign?.relId;
    const part = rel ? this.page.rels.get(rel) : null;
    if (!part) return false;
    const bytes = await this.options.zip.read(part);
    if (!bytes) return false;
    const extension = part.slice(part.lastIndexOf('.') + 1).toLowerCase();
    let uri = null;
    if (MIME_BY_EXTENSION[extension]) {
      uri = imageDataUri(MIME_BY_EXTENSION[extension], bytes);
    } else if ((extension === 'emf' || extension === 'wmf') && this.options.metafileToSvg) {
      const svg = await this.options.metafileToSvg(bytes);
      if (svg) uri = imageDataUri('image/svg+xml', svg);
    }
    if (!uri) {
      this.warnings.push(`Picture ${part} on page "${this.page.name}" could not be converted`);
      return false;
    }
    this.addVertex(id, '', `shape=image;imageAspect=0;image=${uri};${this.placementStyle(placement)}`, placement);
    return true;
  }

  // Visio positions text in a block that can sit apart from the shape (labels beside an icon).
  hasOffsetTextBlock(shape, width, height) {
    if (!hasOwnCell(shape, 'TxtWidth') || !hasOwnCell(shape, 'TxtPinX')) return false;
    const block = this.textBlock(shape);
    const tolerance = 0.02 + 0.05 * Math.max(width, height);
    return (
      Math.abs(block.x + block.w / 2 - width / 2) > tolerance ||
      Math.abs(block.y + block.h / 2 - height / 2) > tolerance ||
      Math.abs(block.w - width) > tolerance ||
      Math.abs(block.h - height) > tolerance
    );
  }

  textBlock(shape) {
    const w = numberOf(this.doc, shape, 'TxtWidth', numberOf(this.doc, shape, 'Width', 0));
    const h = numberOf(this.doc, shape, 'TxtHeight', numberOf(this.doc, shape, 'Height', 0));
    const pinX = numberOf(this.doc, shape, 'TxtPinX', numberOf(this.doc, shape, 'Width', 0) / 2);
    const pinY = numberOf(this.doc, shape, 'TxtPinY', numberOf(this.doc, shape, 'Height', 0) / 2);
    const locX = numberOf(this.doc, shape, 'TxtLocPinX', w / 2);
    const locY = numberOf(this.doc, shape, 'TxtLocPinY', h / 2);
    return { x: pinX - locX, y: pinY - locY, w, h, pinX, pinY, locX, locY, angle: numberOf(this.doc, shape, 'TxtAngle', 0) };
  }

  // A text-only cell at the shape's text block.
  emitText(shape, shapeMatrix, label, id, shapeMatrixIsFinal = false) {
    const block = this.textBlock(shape);
    const matrix = shapeMatrixIsFinal ? shapeMatrix : multiply(shapeMatrix, localToParent(this.doc, shape));
    const blockMatrix = multiply(matrix, multiply(translate(block.pinX, block.pinY), multiply(rotate(block.angle), translate(-block.locX, -block.locY))));
    if (block.w <= EPSILON || block.h <= EPSILON) return;
    const placement = placementOf(blockMatrix, block.w, block.h);
    this.addVertex(id, label.html, `fillColor=none;strokeColor=none;${textStyleFragment(this.doc, shape, label, false)}${this.placementStyle(placement)}`, placement);
  }

  edgeEnd(connects, shapeEndName, absolute) {
    const targetId = connects?.[shapeEndName];
    if (targetId === undefined) return { point: absolute };
    let owner = this.page.shapesById.get(targetId);
    while (owner && !this.vertices.has(owner.id)) owner = owner.parent;
    if (!owner) return { point: absolute };
    const vertex = this.vertices.get(owner.id);
    return { point: absolute, vertex, fraction: fractionIn(vertex.placement, absolute[0], absolute[1]) };
  }

  emitEdges() {
    for (const { shape, parentMatrix, matrix, connects } of this.pendingEdges) {
      const paths = buildPaths(this.doc, shape).filter((path) => path.segments.length > 0);
      const toPage = (x, y) => apply(matrix, x, y);
      const route = [];
      for (const segment of paths[0]?.segments ?? []) route.push(toPage(segment.x, segment.y));

      const begin = apply(parentMatrix, numberOf(this.doc, shape, 'BeginX', 0), numberOf(this.doc, shape, 'BeginY', 0));
      const end = apply(parentMatrix, numberOf(this.doc, shape, 'EndX', 0), numberOf(this.doc, shape, 'EndY', 0));
      if (route.length < 2) route.splice(0, route.length, begin, end);
      route[0] = begin;
      route[route.length - 1] = end;

      const source = this.edgeEnd(connects, 'begin', begin);
      const target = this.edgeEnd(connects, 'end', end);

      const line = lineStyleOf(this.doc, shape);
      const parts = ['html=1', 'rounded=0', `strokeColor=${line.visible ? line.color : 'none'}`, `strokeWidth=${number(Math.max(line.weight * this.scale, 0.5))}`];
      if (line.dash) parts.push('dashed=1', `dashPattern=${line.dash}`);
      const arrow = (name) => (numberOf(this.doc, shape, name, 0) > 0 ? 'classic' : 'none');
      parts.push(`startArrow=${arrow('BeginArrow')}`, `endArrow=${arrow('EndArrow')}`);
      for (const [prefix, end] of [['exit', source], ['entry', target]]) {
        if (end.fraction) {
          parts.push(`${prefix}X=${number(end.fraction.x)}`, `${prefix}Y=${number(end.fraction.y)}`, `${prefix}Perimeter=0`);
        }
      }

      const label = labelOf(this.doc, shape, this.scale);
      const waypoints = route
        .slice(1, -1)
        .map((p) => this.point(p[0], p[1]))
        .map((p) => `<mxPoint x="${number(p.x)}" y="${number(p.y)}"/>`)
        .join('');
      const sourcePoint = this.point(begin[0], begin[1]);
      const targetPoint = this.point(end[0], end[1]);
      const attributes =
        (source.vertex ? ` source="${source.vertex.id}"` : '') + (target.vertex ? ` target="${target.vertex.id}"` : '');
      this.cells.push(
        `<mxCell id="e${shape.id}" value="${escapeAttribute(label?.html ?? '')}" style="${escapeAttribute(parts.join(';') + ';')}" edge="1" parent="1"${attributes}>` +
          `<mxGeometry relative="1" as="geometry">` +
          `<mxPoint x="${number(sourcePoint.x)}" y="${number(sourcePoint.y)}" as="sourcePoint"/>` +
          `<mxPoint x="${number(targetPoint.x)}" y="${number(targetPoint.y)}" as="targetPoint"/>` +
          (waypoints ? `<Array as="points">${waypoints}</Array>` : '') +
          `</mxGeometry></mxCell>`
      );
    }
  }

  async convert() {
    this.pendingEdges = [];
    // Connect rows: which shape each end of a connector is glued to.
    this.connectorsByShape = new Map();
    const targets = new Set();
    for (const connect of this.page.connects) {
      const { FromSheet: from, FromCell: cell, ToSheet: to } = connect.attrs;
      targets.add(to);
      const ends = this.connectorsByShape.get(from) ?? {};
      if (cell === 'BeginX' || cell === 'BeginY') ends.begin = to;
      else if (cell === 'EndX' || cell === 'EndY') ends.end = to;
      this.connectorsByShape.set(from, ends);
    }

    await this.walk(this.page.shapes, IDENTITY, targets, this.connectorsByShape);
    this.emitEdges();
    return this.cells;
  }
}

// A master's picture and the part of the master page it covers. libvisio sizes its SVG to the
// master page, but a master's shapes can reach beyond it, and an <image> clips to its viewBox; so
// the viewBox is widened to the extent of the master's shapes (SVG x = x * k, y = (pageHeight - y) * k,
// with k the SVG units per master unit).
function masterPicture(doc, master, uri) {
  if (master.picture?.source === uri) return master.picture;

  const extent = masterExtent(doc, master);
  const picture = { source: uri, uri, x: 0, y: 0, width: master.pageWidth, height: master.pageHeight };
  const comma = uri.indexOf(',');
  const svg = comma >= 0 ? atob(uri.slice(comma + 1)) : '';
  const root = /<svg\b[^>]*>/.exec(svg)?.[0];
  const viewBox = root && /viewBox="([-\d.eE+ ]+)"/.exec(root)?.[1].trim().split(/\s+/).map(Number);
  const grows =
    extent.minX < -1e-6 || extent.minY < -1e-6 || extent.maxX > master.pageWidth + 1e-6 || extent.maxY > master.pageHeight + 1e-6;
  if (viewBox && viewBox.length === 4 && viewBox[2] > 0 && grows) {
    const k = viewBox[2] / master.pageWidth;
    const widened = {
      x: Math.min(0, extent.minX),
      y: Math.min(0, extent.minY),
      width: Math.max(master.pageWidth, extent.maxX) - Math.min(0, extent.minX),
      height: Math.max(master.pageHeight, extent.maxY) - Math.min(0, extent.minY),
    };
    const box = [widened.x * k, (master.pageHeight - (widened.y + widened.height)) * k, widened.width * k, widened.height * k];
    const fixedRoot = root
      .replace(/viewBox="[^"]*"/, `viewBox="${box.map(number).join(' ')}"`)
      .replace(/\swidth="[^"]*"/, ` width="${number(box[2] / 72)}in"`)
      .replace(/\sheight="[^"]*"/, ` height="${number(box[3] / 72)}in"`);
    Object.assign(picture, widened, { uri: `${uri.slice(0, comma + 1)}${toBase64(svg.replace(root, fixedRoot))}` });
  }
  master.picture = picture;
  return picture;
}

// Bounding box of everything a master draws, in master page units.
function masterExtent(doc, master) {
  const extent = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const visit = (shape, parentMatrix) => {
    const matrix = multiply(parentMatrix, localToParent(doc, shape));
    const width = numberOf(doc, shape, 'Width', 0);
    const height = numberOf(doc, shape, 'Height', 0);
    for (const [x, y] of [[0, 0], [width, 0], [0, height], [width, height]]) {
      const [px, py] = apply(matrix, x, y);
      extent.minX = Math.min(extent.minX, px);
      extent.maxX = Math.max(extent.maxX, px);
      extent.minY = Math.min(extent.minY, py);
      extent.maxY = Math.max(extent.maxY, py);
    }
    for (const child of shape.children) visit(child, matrix);
  };
  if (master.top) visit(master.top, IDENTITY);
  return Number.isFinite(extent.minX) ? extent : { minX: 0, minY: 0, maxX: master.pageWidth, maxY: master.pageHeight };
}

function safeRatio(numerator, denominator, fallback = 1) {
  return Math.abs(denominator) > EPSILON ? numerator / denominator : fallback;
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

async function loadDocument(zip) {
  const documentRoot = await readXml(zip, 'visio/document.xml');
  const doc = { styleSheets: new Map(), colors: new Map(), faces: new Map(), masters: new Map() };

  for (const sheet of childrenOf(childOf(documentRoot, 'StyleSheets'), 'StyleSheet')) {
    doc.styleSheets.set(sheet.attrs.ID, {
      lineStyle: sheet.attrs.LineStyle,
      fillStyle: sheet.attrs.FillStyle,
      textStyle: sheet.attrs.TextStyle,
      cells: parseCells(sheet),
    });
  }
  for (const entry of childrenOf(childOf(documentRoot, 'Colors'), 'ColorEntry')) {
    doc.colors.set(Number(entry.attrs.IX), entry.attrs.RGB.toLowerCase());
  }
  for (const face of childrenOf(childOf(documentRoot, 'FaceNames'), 'FaceName')) {
    doc.faces.set(Number(face.attrs.ID), face.attrs.NameU ?? face.attrs.Name);
  }

  const mastersRoot = await readXml(zip, 'visio/masters/masters.xml');
  if (mastersRoot) {
    const rels = await readRels(zip, 'visio/masters/masters.xml');
    for (const entry of childrenOf(mastersRoot, 'Master')) {
      const part = rels.get(childOf(entry, 'Rel')?.attrs['r:id']);
      const contents = part ? await readXml(zip, part) : null;
      const pageSheet = childOf(entry, 'PageSheet');
      const sheetCells = pageSheet ? parseCells(pageSheet) : new Map();
      const master = {
        id: entry.attrs.ID,
        name: entry.attrs.Name,
        nameU: entry.attrs.NameU,
        pageWidth: parseFloat(sheetCells.get('PageWidth')?.v) || 1,
        pageHeight: parseFloat(sheetCells.get('PageHeight')?.v) || 1,
        shapesById: new Map(),
        top: null,
      };
      doc.masters.set(master.id, master);
      const topElements = childrenOf(childOf(contents, 'Shapes'), 'Shape');
      if (topElements.length > 0) {
        const context = { masters: doc.masters, instanceMaster: null, shapesById: master.shapesById };
        master.top = parseShape(topElements[0], context, null);
      }
    }
  }
  return doc;
}

async function loadPages(zip, doc) {
  const pagesRoot = await readXml(zip, 'visio/pages/pages.xml');
  if (!pagesRoot) return [];
  const rels = await readRels(zip, 'visio/pages/pages.xml');
  const pages = [];
  for (const entry of childrenOf(pagesRoot, 'Page')) {
    if (entry.attrs.Background === '1') continue;
    const part = rels.get(childOf(entry, 'Rel')?.attrs['r:id']);
    const contents = part ? await readXml(zip, part) : null;
    if (!contents) continue;

    const sheetCells = parseCells(childOf(entry, 'PageSheet') ?? { kids: [] });
    const hiddenLayers = new Set();
    for (const section of childrenOf(childOf(entry, 'PageSheet'), 'Section')) {
      if (section.attrs.N !== 'Layer') continue;
      for (const row of childrenOf(section, 'Row')) {
        if (parseCells(row).get('Visible')?.v === '0') hiddenLayers.add(Number(row.attrs.IX));
      }
    }

    const shapesById = new Map();
    const context = { masters: doc.masters, instanceMaster: null, shapesById };
    const shapes = childrenOf(childOf(contents, 'Shapes'), 'Shape').map((element) => parseShape(element, context, null));
    pages.push({
      id: entry.attrs.ID,
      name: entry.attrs.Name || entry.attrs.NameU || `Page ${pages.length + 1}`,
      width: parseFloat(sheetCells.get('PageWidth')?.v) || 11,
      height: parseFloat(sheetCells.get('PageHeight')?.v) || 8.5,
      shapes,
      shapesById,
      connects: childrenOf(childOf(contents, 'Connects'), 'Connect'),
      hiddenLayers,
      rels: await readRels(zip, part),
    });
  }
  return pages;
}

/**
 * @param {{has(name: string): boolean, read(name: string): Promise<Uint8Array | null>}} zip
 * @param {{
 *   scale?: number,
 *   loadMasterSvgs: () => Promise<Map<string, string>>,
 *   metafileToSvg?: (bytes: Uint8Array) => Promise<string | null>
 * }} options  loadMasterSvgs: master name -> `data:image/svg+xml,<base64>` rendered by libvisio;
 *   called only when the package has masters.
 * @returns {Promise<{xml: string, pageCount: number, warnings: string[]} | null>}
 *   null when the package has no drawing pages with shapes (it is a stencil).
 */
export async function convertVsdxPages(zip, options) {
  if (!zip.has('visio/pages/pages.xml')) return null;
  const doc = await loadDocument(zip);
  const pages = (await loadPages(zip, doc)).filter((page) => page.shapes.length > 0);
  if (pages.length === 0) return null;

  const warnings = [];
  const scale = options.scale ?? 120;
  const masterSvgs = doc.masters.size > 0 ? await options.loadMasterSvgs() : new Map();
  const diagrams = [];
  for (const page of pages) {
    const converter = new PageConverter(doc, page, { ...options, masterSvgs, zip, scale, warnings });
    const cells = await converter.convert();
    diagrams.push(
      `  <diagram id="page-${escapeAttribute(page.id)}" name="${escapeAttribute(page.name)}">\n` +
        `    <mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${Math.round(page.width * scale)}" pageHeight="${Math.round(page.height * scale)}" math="0" shadow="0">\n` +
        `      <root>\n        <mxCell id="0"/>\n        <mxCell id="1" parent="0"/>\n` +
        cells.map((cell) => `        ${cell}\n`).join('') +
        `      </root>\n    </mxGraphModel>\n  </diagram>\n`
    );
  }

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<mxfile host="app.diagrams.net" agent="visio2drawio" version="21.1.2" type="device">\n' +
    diagrams.join('') +
    '</mxfile>\n';
  return { xml, pageCount: pages.length, warnings };
}
