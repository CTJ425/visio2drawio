// @ts-check
// Converts the drawing pages of a .vsdx into draw.io pages with editable cells: one vertex per
// Visio shape and one edge per connector, attached to the shapes it joins in Visio.
//
// libvisio only reports the primitives it draws, so the structure (shapes, groups, connectors)
// comes from the package XML (vsdx-model.mjs). Master shapes (servers, switches...) are still
// drawn by libvisio: the caller passes the SVG it rendered for each master, and each instance
// becomes an image cell placed with the instance's own transform.
//
// Visio's y axis points up and its unit is the inch; draw.io's y axis points down. All geometry
// is carried in page inches with y up and flipped only when the cells are written.
import { loadDocument, loadPages, cellOf, hasOwnCell, numberOf } from './vsdx-model.mjs';
import {
  EPSILON,
  IDENTITY,
  multiply,
  invert,
  apply,
  translate,
  rotate,
  scaleBy,
  localToParent,
  placementOf,
  fractionIn,
  safeRatio,
} from './vsdx-transform.mjs';
import { buildPaths, isFullRectangle, lineStyleOf, fillStyleOf, shapeSvg } from './vsdx-geometry.mjs';
import { labelOf, textStyleFragment } from './vsdx-text.mjs';
import { number, escapeAttribute, toBase64, imageDataUri } from './vsdx-encode.mjs';

/** @typedef {import('./vsdx-model.mjs').ZipReader} ZipReader */
/** @typedef {import('./vsdx-model.mjs').Shape} Shape */
/** @typedef {import('./vsdx-model.mjs').Master} Master */
/** @typedef {import('./vsdx-model.mjs').MasterPicture} MasterPicture */
/** @typedef {import('./vsdx-model.mjs').Page} Page */
/** @typedef {import('./vsdx-model.mjs').VisioDocument} VisioDocument */
/** @typedef {import('./vsdx-transform.mjs').Matrix} Matrix */
/** @typedef {import('./vsdx-transform.mjs').Point} Point */
/** @typedef {import('./vsdx-transform.mjs').Placement} Placement */
/** @typedef {import('./vsdx-text.mjs').Label} Label */
/** @typedef {(bytes: Uint8Array) => Promise<string | null>} MetafileToSvg */
/**
 * @typedef {object} ConverterOptions
 * @property {number} scale  px per inch
 * @property {Map<string, string>} masterSvgs  master name -> SVG data URI
 * @property {ZipReader} zip
 * @property {string[]} warnings  collects what could not be converted
 * @property {MetafileToSvg} [metafileToSvg]
 */
/** A draw.io vertex standing for a Visio shape. @typedef {{ id: string, placement: Placement }} Vertex */
/** The shapes a connector's ends are glued to. @typedef {{ begin?: string, end?: string }} ConnectorEnds */
/** @typedef {{ point: Point, vertex?: Vertex, fraction?: { x: number, y: number } }} EdgeEnd */
/** @typedef {{ shape: Shape, parentMatrix: Matrix, matrix: Matrix, connects: ConnectorEnds | undefined }} PendingEdge */

/** @type {Record<string, string>} */
const MIME_BY_EXTENSION = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml' };

class PageConverter {
  /**
   * @param {VisioDocument} doc
   * @param {Page} page
   * @param {ConverterOptions} options
   */
  constructor(doc, page, options) {
    this.doc = doc;
    this.page = page;
    this.options = options;
    this.scale = options.scale;
    /** @type {string[]} */
    this.cells = [];
    /** @type {Map<string, Vertex>} Visio shape id -> its vertex */
    this.vertices = new Map();
    this.warnings = options.warnings;
    /** @type {PendingEdge[]} Connectors, written after every vertex they may attach to exists. */
    this.pendingEdges = [];
    /** @type {Map<string, ConnectorEnds>} */
    this.connectorsByShape = new Map();
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  point(x, y) {
    return { x: x * this.scale, y: (this.page.height - y) * this.scale };
  }

  /** @param {Placement} placement */
  geometryXml(placement) {
    const w = placement.w * this.scale;
    const h = placement.h * this.scale;
    const { x, y } = this.point(placement.cx, placement.cy);
    return `<mxGeometry x="${number(x - w / 2)}" y="${number(y - h / 2)}" width="${number(w)}" height="${number(h)}" as="geometry"/>`;
  }

  /** @param {Placement} placement */
  placementStyle(placement) {
    let style = '';
    const degrees = (((-placement.angle * 180) / Math.PI) % 360 + 360) % 360;
    if (degrees > 1e-6 && Math.abs(degrees - 360) > 1e-6) style += `rotation=${number(degrees)};`;
    if (placement.mirrored) style += 'flipH=1;';
    return style;
  }

  /**
   * @param {string} id
   * @param {string | null} value
   * @param {string} style
   * @param {Placement} placement
   */
  addVertex(id, value, style, placement) {
    this.cells.push(
      `<mxCell id="${id}" value="${escapeAttribute(value ?? '')}" style="${escapeAttribute(style)}" vertex="1" parent="1">${this.geometryXml(placement)}</mxCell>`
    );
  }

  /**
   * Walks the shape tree in drawing order, so later shapes stay on top as in Visio.
   * @param {Shape[]} shapes
   * @param {Matrix} parentMatrix
   * @param {Set<string>} targets  shapes a connector is glued to
   * @param {Map<string, ConnectorEnds>} connectorsByShape
   */
  async walk(shapes, parentMatrix, targets, connectorsByShape) {
    for (const shape of shapes) {
      if (shape.type === 'Guide' || this.isHidden(shape)) continue;
      const matrix = multiply(parentMatrix, localToParent(this.doc, shape));
      const isConnector = connectorsByShape.has(shape.id) || this.isOneDimensionalLine(shape);
      if (isConnector) {
        this.pendingEdges.push({ shape, parentMatrix, matrix, connects: connectorsByShape.get(shape.id) });
      } else if (shape.isInstance && shape.instanceMaster) {
        await this.emitMasterInstance(shape, shape.instanceMaster, parentMatrix, targets);
      } else if (shape.type === 'Group') {
        await this.emitOwnContent(shape, matrix, targets);
        if (targets.has(shape.id) && !this.vertices.has(shape.id)) this.emitAnchor(shape, matrix);
        await this.walk(shape.children, matrix, targets, connectorsByShape);
      } else {
        await this.emitOwnContent(shape, matrix, targets);
      }
    }
  }

  /** @param {Shape} shape */
  isHidden(shape) {
    const members = cellOf(this.doc, shape, 'LayerMember')?.v;
    if (!members) return false;
    const layers = members.split(';').filter((ix) => ix !== '');
    return layers.length > 0 && layers.every((ix) => this.page.hiddenLayers.has(Number(ix)));
  }

  /**
   * Lines drawn with Visio's line tools are 1-D shapes (BeginX/EndX) with an open path.
   * @param {Shape} shape
   */
  isOneDimensionalLine(shape) {
    if (shape.type !== 'Shape' || !hasOwnCell(shape, 'BeginX') || !hasOwnCell(shape, 'EndX')) return false;
    return numberOf(this.doc, shape, 'ObjType', 0) === 2 || (shape.proto && numberOf(this.doc, shape.proto, 'ObjType', 0) === 2);
  }

  /**
   * An invisible cell so that connectors attached to a group still have something to attach to.
   * @param {Shape} group
   * @param {Matrix} matrix
   */
  emitAnchor(group, matrix) {
    const width = numberOf(this.doc, group, 'Width', 0);
    const height = numberOf(this.doc, group, 'Height', 0);
    const placement = placementOf(matrix, Math.max(width, 0.01), Math.max(height, 0.01));
    const id = `s${group.id}`;
    this.vertices.set(group.id, { id, placement });
    this.addVertex(id, '', `fillColor=none;strokeColor=none;${this.placementStyle(placement)}`, placement);
  }

  /**
   * @param {Shape} shape  the top shape of the instance
   * @param {Master} master
   * @param {Matrix} parentMatrix
   * @param {Set<string>} targets
   */
  async emitMasterInstance(shape, master, parentMatrix, targets) {
    /** @param {string | undefined} name */
    const svgNamed = (name) => (name === undefined ? undefined : this.options.masterSvgs.get(name));
    const svg = svgNamed(master.name) ?? svgNamed(master.nameU);
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

  /**
   * The shape's own drawing: native rectangle, SVG path, or picture, plus its text.
   * @param {Shape} shape
   * @param {Matrix} matrix  shape-local -> page
   * @param {Set<string>} targets
   */
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
    const separateText = label !== null && this.hasOffsetTextBlock(shape, width, height);

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
        // Not null: every path left after the filter is drawn.
        const svg = /** @type {string} */ (shapeSvg(this.doc, shape, paths, width, height));
        this.addVertex(id, '', `shape=image;imageAspect=0;image=${imageDataUri('image/svg+xml', svg)};${this.placementStyle(placement)}`, placement);
        if (label && !separateText) this.emitText(shape, matrix, label, `t${shape.id}`, true);
      }
      if (label && separateText) this.emitText(shape, matrix, label, `t${shape.id}`, true);
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

  /**
   * A Foreign shape's embedded picture (PNG/JPEG/... as is, EMF/WMF converted to SVG).
   * @param {Shape} shape
   * @param {string} id
   * @param {Placement} placement
   * @returns {Promise<boolean>}  false when there is no picture or it could not be converted
   */
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

  /**
   * Visio positions text in a block that can sit apart from the shape (labels beside an icon).
   * @param {Shape} shape
   * @param {number} width
   * @param {number} height
   */
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

  /**
   * The shape's text block in its local inches.
   * @param {Shape} shape
   */
  textBlock(shape) {
    const w = numberOf(this.doc, shape, 'TxtWidth', numberOf(this.doc, shape, 'Width', 0));
    const h = numberOf(this.doc, shape, 'TxtHeight', numberOf(this.doc, shape, 'Height', 0));
    const pinX = numberOf(this.doc, shape, 'TxtPinX', numberOf(this.doc, shape, 'Width', 0) / 2);
    const pinY = numberOf(this.doc, shape, 'TxtPinY', numberOf(this.doc, shape, 'Height', 0) / 2);
    const locX = numberOf(this.doc, shape, 'TxtLocPinX', w / 2);
    const locY = numberOf(this.doc, shape, 'TxtLocPinY', h / 2);
    return { x: pinX - locX, y: pinY - locY, w, h, pinX, pinY, locX, locY, angle: numberOf(this.doc, shape, 'TxtAngle', 0) };
  }

  /**
   * A text-only cell at the shape's text block.
   * @param {Shape} shape
   * @param {Matrix} shapeMatrix  shape-local -> page, or parent -> page unless `shapeMatrixIsFinal`
   * @param {Label} label
   * @param {string} id
   */
  emitText(shape, shapeMatrix, label, id, shapeMatrixIsFinal = false) {
    const block = this.textBlock(shape);
    const matrix = shapeMatrixIsFinal ? shapeMatrix : multiply(shapeMatrix, localToParent(this.doc, shape));
    const blockMatrix = multiply(matrix, multiply(translate(block.pinX, block.pinY), multiply(rotate(block.angle), translate(-block.locX, -block.locY))));
    if (block.w <= EPSILON || block.h <= EPSILON) return;
    const placement = placementOf(blockMatrix, block.w, block.h);
    this.addVertex(id, label.html, `fillColor=none;strokeColor=none;${textStyleFragment(this.doc, shape, label, false)}${this.placementStyle(placement)}`, placement);
  }

  /**
   * One end of a connector: the vertex it is glued to (the nearest ancestor that has one when the
   * glued shape itself has none) and where on that vertex, or just the point when it is loose.
   * @param {ConnectorEnds | undefined} connects
   * @param {'begin' | 'end'} shapeEndName
   * @param {Point} absolute
   * @returns {EdgeEnd}
   */
  edgeEnd(connects, shapeEndName, absolute) {
    const targetId = connects?.[shapeEndName];
    if (targetId === undefined) return { point: absolute };
    let owner = this.page.shapesById.get(targetId);
    while (owner && !this.vertices.has(owner.id)) owner = owner.parent ?? undefined;
    const vertex = owner && this.vertices.get(owner.id);
    if (!vertex) return { point: absolute };
    return { point: absolute, vertex, fraction: fractionIn(vertex.placement, absolute[0], absolute[1]) };
  }

  emitEdges() {
    for (const { shape, parentMatrix, matrix, connects } of this.pendingEdges) {
      const paths = buildPaths(this.doc, shape).filter((path) => path.segments.length > 0);
      /** @type {Point[]} */
      const route = [];
      for (const segment of paths[0]?.segments ?? []) route.push(apply(matrix, segment.x, segment.y));

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
      /** @param {string} name */
      const arrow = (name) => (numberOf(this.doc, shape, name, 0) > 0 ? 'classic' : 'none');
      parts.push(`startArrow=${arrow('BeginArrow')}`, `endArrow=${arrow('EndArrow')}`);
      /** @type {Array<[string, EdgeEnd]>} */
      const ends = [['exit', source], ['entry', target]];
      for (const [prefix, edgeEnd] of ends) {
        if (edgeEnd.fraction) {
          parts.push(`${prefix}X=${number(edgeEnd.fraction.x)}`, `${prefix}Y=${number(edgeEnd.fraction.y)}`, `${prefix}Perimeter=0`);
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

  /** @returns {Promise<string[]>} the page's mxCell elements */
  async convert() {
    // Connect rows: which shape each end of a connector is glued to.
    /** @type {Set<string>} */
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

/**
 * A master's picture and the part of the master page it covers. libvisio sizes its SVG to the
 * master page, but a master's shapes can reach beyond it, and an <image> clips to its viewBox; so
 * the viewBox is widened to the extent of the master's shapes (SVG x = x * k, y = (pageHeight - y) * k,
 * with k the SVG units per master unit).
 * @param {VisioDocument} doc
 * @param {Master} master
 * @param {string} uri  `data:image/svg+xml,<base64>`
 * @returns {MasterPicture}  x, y, width, height in master page units
 */
function masterPicture(doc, master, uri) {
  if (master.picture?.source === uri) return master.picture;

  const extent = masterExtent(doc, master);
  /** @type {MasterPicture} */
  const picture = { source: uri, uri, x: 0, y: 0, width: master.pageWidth, height: master.pageHeight };
  const comma = uri.indexOf(',');
  const svg = comma >= 0 ? atob(uri.slice(comma + 1)) : '';
  const root = /<svg\b[^>]*>/.exec(svg)?.[0];
  const viewBox = root && /viewBox="([-\d.eE+ ]+)"/.exec(root)?.[1].trim().split(/\s+/).map(Number);
  const grows =
    extent.minX < -1e-6 || extent.minY < -1e-6 || extent.maxX > master.pageWidth + 1e-6 || extent.maxY > master.pageHeight + 1e-6;
  if (root && viewBox && viewBox.length === 4 && viewBox[2] > 0 && grows) {
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

/**
 * Bounding box of everything a master draws, in master page units.
 * @param {VisioDocument} doc
 * @param {Master} master
 */
function masterExtent(doc, master) {
  const extent = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  /**
   * @param {Shape} shape
   * @param {Matrix} parentMatrix
   */
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

/**
 * @param {ZipReader} zip
 * @param {{
 *   scale?: number,
 *   loadMasterSvgs: () => Promise<Map<string, string>>,
 *   metafileToSvg?: MetafileToSvg
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

  /** @type {string[]} */
  const warnings = [];
  const scale = options.scale ?? 120;
  const masterSvgs = doc.masters.size > 0 ? await options.loadMasterSvgs() : new Map();
  const diagrams = [];
  for (const page of pages) {
    const converter = new PageConverter(doc, page, { scale, masterSvgs, zip, warnings, metafileToSvg: options.metafileToSvg });
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
