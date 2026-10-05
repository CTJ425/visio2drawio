// @ts-check
// The .vsdx package as a shape model: style sheets, masters and pages, and the cell lookup that
// follows Visio's inheritance (the shape's own cell, then its master shape, then its style sheets).
import { parseXml, childrenOf, childOf } from './vsdx-xml.mjs';

/** @typedef {import('./vsdx-xml.mjs').XmlElement} XmlElement */
/** @typedef {{ has(name: string): boolean, read(name: string): Promise<Uint8Array | null> }} ZipReader */
/**
 * A ShapeSheet cell: cached value and formula. `inherited` marks a cell copied from the master.
 * @typedef {{ v?: string, f?: string, inherited?: boolean }} Cell
 */
/** @typedef {Map<string, Cell>} Cells */
/** @typedef {{ type: string | undefined, deleted?: boolean, cells: Cells }} GeometryRow */
/** @typedef {{ cells: Cells, rows: Map<number, GeometryRow> }} GeometrySection */
/** @typedef {{ text: string, cp: number, pp: number }} TextRun */
/**
 * @typedef {object} Shape
 * @property {string} id  unique within its page or master
 * @property {string} type  'Shape', 'Group', 'Foreign' or 'Guide'
 * @property {Shape | null} parent
 * @property {Shape[]} children
 * @property {Shape | null} proto  the master shape this shape inherits cells from
 * @property {Master | null} instanceMaster  the master of the instance this shape belongs to
 * @property {boolean} isInstance  true for the top shape of a master instance
 * @property {string | undefined} lineStyle
 * @property {string | undefined} fillStyle
 * @property {string | undefined} textStyle
 * @property {Cells} cells
 * @property {Map<number, GeometrySection>} geometry
 * @property {Map<number, Cells>} character
 * @property {Map<number, Cells>} paragraph
 * @property {TextRun[] | null} text
 * @property {{ type: string | undefined, relId: string | undefined } | null} foreign
 */
/** @typedef {{ source: string, uri: string, x: number, y: number, width: number, height: number }} MasterPicture */
/**
 * @typedef {object} Master
 * @property {string} id
 * @property {string | undefined} name
 * @property {string | undefined} nameU
 * @property {number} pageWidth
 * @property {number} pageHeight
 * @property {Map<string, Shape>} shapesById
 * @property {Shape | null} top
 * @property {MasterPicture} [picture]  cached by the converter
 */
/** @typedef {{ lineStyle: string | undefined, fillStyle: string | undefined, textStyle: string | undefined, cells: Cells }} StyleSheet */
/**
 * @typedef {object} VisioDocument
 * @property {Map<string, StyleSheet>} styleSheets
 * @property {Map<number, string>} colors  document colour table, index -> #rrggbb
 * @property {Map<number, string>} faces  font id -> name
 * @property {Map<string, Master>} masters
 */
/**
 * @typedef {object} Page
 * @property {string} id
 * @property {string} name
 * @property {number} width  inches
 * @property {number} height  inches
 * @property {Shape[]} shapes  top-level shapes in drawing order
 * @property {Map<string, Shape>} shapesById  every shape of the page, nested ones included
 * @property {XmlElement[]} connects
 * @property {Set<number>} hiddenLayers
 * @property {Map<string, string>} rels  relationship id -> package part
 */
/** @typedef {{ masters: Map<string, Master>, instanceMaster: Master | null, shapesById: Map<string, Shape> }} ParseContext */

// ---------------------------------------------------------------------------------------------
// Package parts
// ---------------------------------------------------------------------------------------------

/**
 * @param {ZipReader} zip
 * @param {string} name
 */
async function readXml(zip, name) {
  const bytes = await zip.read(name);
  return bytes ? parseXml(new TextDecoder().decode(bytes)) : null;
}

/**
 * @param {string} baseDir
 * @param {string} target
 */
function resolvePart(baseDir, target) {
  const parts = target.startsWith('/') ? [] : baseDir.split('/').filter(Boolean);
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop();
    else if (piece && piece !== '.') parts.push(piece);
  }
  return parts.join('/');
}

/**
 * Relationship id -> part path, for the rels file that belongs to `partName`.
 * @param {ZipReader} zip
 * @param {string} partName
 * @returns {Promise<Map<string, string>>}
 */
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

/**
 * The part an element's <Rel r:id> points at.
 * @param {Map<string, string>} rels
 * @param {XmlElement} element
 */
function relTarget(rels, element) {
  const id = childOf(element, 'Rel')?.attrs['r:id'];
  return id === undefined ? undefined : rels.get(id);
}

// ---------------------------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------------------------

/**
 * @param {XmlElement | null} element
 * @returns {Cells}
 */
function parseCells(element) {
  const cells = new Map();
  for (const cell of childrenOf(element, 'Cell')) {
    cells.set(cell.attrs.N, { v: cell.attrs.V, f: cell.attrs.F });
  }
  return cells;
}

/**
 * Geometry sections by section index, each with its rows by row index.
 * @param {XmlElement} element
 * @returns {Map<number, GeometrySection>}
 */
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

/**
 * Character/Paragraph sections: row index -> cells.
 * @param {XmlElement} element
 * @param {string} sectionName
 * @returns {Map<number, Cells>}
 */
function parseRows(element, sectionName) {
  const rows = new Map();
  for (const section of childrenOf(element, 'Section')) {
    if (section.attrs.N !== sectionName) continue;
    for (const row of childrenOf(section, 'Row')) rows.set(Number(row.attrs.IX ?? 0), parseCells(row));
  }
  return rows;
}

/**
 * <Text> holds runs of text separated by <cp IX> (character style) and <pp IX> (paragraph style).
 * @param {XmlElement} element
 * @returns {TextRun[] | null}
 */
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

/**
 * @param {XmlElement} element
 * @param {ParseContext} context
 * @param {Shape | null} parent
 * @returns {Shape}
 */
function parseShape(element, context, parent) {
  /** @type {Shape} */
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

/**
 * @param {string} name
 * @returns {'lineStyle' | 'fillStyle' | 'textStyle'}
 */
function styleKind(name) {
  if (/^(Line|BeginArrow|EndArrow|Rounding)/.test(name)) return 'lineStyle';
  if (/^(Fill|Shdw)/.test(name)) return 'fillStyle';
  return 'textStyle';
}

/**
 * @param {VisioDocument} doc
 * @param {Shape} shape
 * @param {string} name
 * @returns {Cell | undefined}
 */
export function styleCell(doc, shape, name) {
  const kind = styleKind(name);
  /** @type {string | undefined} */
  let id;
  for (let x = /** @type {Shape | null} */ (shape); x && id === undefined; x = x.proto) id = x[kind];
  for (let guard = 0; id !== undefined && guard < 16; guard++) {
    const sheet = doc.styleSheets.get(id);
    if (!sheet) return undefined;
    const cell = sheet.cells.get(name);
    if (cell && cell.v !== 'Themed') return cell;
    id = sheet[kind];
  }
  return undefined;
}

/**
 * @param {VisioDocument} doc
 * @param {Shape} shape
 * @param {string} name
 * @returns {Cell | undefined}
 */
export function cellOf(doc, shape, name) {
  for (let x = /** @type {Shape | null} */ (shape); x; x = x.proto) {
    const cell = x.cells.get(name);
    if (cell) return cell;
  }
  return styleCell(doc, shape, name);
}

/**
 * A cell the shape itself (or its master) defines, ignoring style sheets.
 * @param {Shape} shape
 * @param {string} name
 */
export function hasOwnCell(shape, name) {
  for (let x = /** @type {Shape | null} */ (shape); x; x = x.proto) if (x.cells.has(name)) return true;
  return false;
}

/**
 * @param {VisioDocument} doc
 * @param {Shape} shape
 * @param {string} name
 * @param {number} fallback
 */
export function numberOf(doc, shape, name, fallback) {
  const value = parseFloat(cellOf(doc, shape, name)?.v ?? '');
  return Number.isFinite(value) ? value : fallback;
}

// Visio's default palette for colour cells that hold an index instead of "#rrggbb".
const DEFAULT_PALETTE = [
  '#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff',
  '#800000', '#008000', '#000080', '#808000', '#800080', '#008080', '#c0c0c0', '#e6e6e6',
  '#cdcdcd', '#b3b3b3', '#9a9a9a', '#808080', '#666666', '#4d4d4d', '#333333', '#1a1a1a',
];

/**
 * A colour cell value ("#rrggbb", "#rgb" or a palette index) as "#rrggbb".
 * @param {VisioDocument} doc
 * @param {string | undefined} value
 * @returns {string | null}
 */
export function parseColor(doc, value) {
  if (value === undefined) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(value)) return '#' + [...value.slice(1)].map((c) => c + c).join('').toLowerCase();
  if (/^\d+$/.test(value)) return doc.colors.get(Number(value)) ?? DEFAULT_PALETTE[Number(value)] ?? null;
  return null;
}

/**
 * @param {VisioDocument} doc
 * @param {Shape} shape
 * @param {string} name
 */
export function colorOf(doc, shape, name) {
  return parseColor(doc, cellOf(doc, shape, name)?.v);
}

// ---------------------------------------------------------------------------------------------
// Document and pages
// ---------------------------------------------------------------------------------------------

/**
 * Style sheets, colours, fonts and masters from visio/document.xml and visio/masters/.
 * @param {ZipReader} zip
 * @returns {Promise<VisioDocument>}
 */
export async function loadDocument(zip) {
  const documentRoot = await readXml(zip, 'visio/document.xml');
  /** @type {VisioDocument} */
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
      const part = relTarget(rels, entry);
      const contents = part ? await readXml(zip, part) : null;
      const sheetCells = parseCells(childOf(entry, 'PageSheet'));
      /** @type {Master} */
      const master = {
        id: entry.attrs.ID,
        name: entry.attrs.Name,
        nameU: entry.attrs.NameU,
        pageWidth: parseFloat(sheetCells.get('PageWidth')?.v ?? '') || 1,
        pageHeight: parseFloat(sheetCells.get('PageHeight')?.v ?? '') || 1,
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

/**
 * The foreground pages, in document order.
 * @param {ZipReader} zip
 * @param {VisioDocument} doc
 * @returns {Promise<Page[]>}
 */
export async function loadPages(zip, doc) {
  const pagesRoot = await readXml(zip, 'visio/pages/pages.xml');
  if (!pagesRoot) return [];
  const rels = await readRels(zip, 'visio/pages/pages.xml');
  /** @type {Page[]} */
  const pages = [];
  for (const entry of childrenOf(pagesRoot, 'Page')) {
    if (entry.attrs.Background === '1') continue;
    const part = relTarget(rels, entry);
    if (!part) continue;
    const contents = await readXml(zip, part);
    if (!contents) continue;

    const pageSheet = childOf(entry, 'PageSheet');
    const sheetCells = parseCells(pageSheet);
    const hiddenLayers = new Set();
    for (const section of childrenOf(pageSheet, 'Section')) {
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
      width: parseFloat(sheetCells.get('PageWidth')?.v ?? '') || 11,
      height: parseFloat(sheetCells.get('PageHeight')?.v ?? '') || 8.5,
      shapes,
      shapesById,
      connects: childrenOf(childOf(contents, 'Connects'), 'Connect'),
      hiddenLayers,
      rels: await readRels(zip, part),
    });
  }
  return pages;
}
