// @ts-check
// Visio text -> draw.io HTML labels: runs with their character styles, paragraph alignment.
import { numberOf, parseColor, styleCell } from './vsdx-model.mjs';
import { escapeHtml } from './vsdx-encode.mjs';

/** @typedef {import('./vsdx-model.mjs').Shape} Shape */
/** @typedef {import('./vsdx-model.mjs').Cell} Cell */
/** @typedef {import('./vsdx-model.mjs').VisioDocument} VisioDocument */
/** Font size in px, colour, Visio style bits (1 bold, 2 italic, 4 underline), font name.
 * @typedef {{ size: number, color: string, bits: number, font: string | null }} CharacterStyle */
/** @typedef {{ html: string, base: CharacterStyle, align: number }} Label */

/**
 * A cell of a Character row. A row does not fall back to row 0: a cell it leaves out comes from
 * the style sheet, as in Visio.
 * @param {VisioDocument} doc
 * @param {Shape} shape
 * @param {number} ix
 * @param {string} name
 * @returns {Cell | undefined}
 */
function characterCell(doc, shape, ix, name) {
  for (let x = /** @type {Shape | null} */ (shape); x; x = x.proto) {
    const cell = x.character.get(ix)?.get(name);
    if (cell) return cell;
  }
  return styleCell(doc, shape, name);
}

/**
 * @param {Shape} shape
 * @param {number} ix
 * @returns {number}  0 left, 1 centre, 2 right
 */
function paragraphAlignment(shape, ix) {
  for (let x = /** @type {Shape | null} */ (shape); x; x = x.proto) {
    const cell = x.paragraph.get(ix)?.get('HorzAlign');
    if (cell) return Number(cell.v);
  }
  return 1;
}

/**
 * @param {VisioDocument} doc
 * @param {Cell | undefined} cell  a font name, or an id into the document's font table
 */
function fontName(doc, cell) {
  if (!cell || cell.v === undefined || cell.v === '') return null;
  return /^\d+$/.test(cell.v) ? doc.faces.get(Number(cell.v)) ?? null : cell.v;
}

/**
 * @param {VisioDocument} doc
 * @param {Shape} shape
 * @param {number} ix
 * @param {number} scale  px per inch
 * @returns {CharacterStyle}
 */
function characterStyle(doc, shape, ix, scale) {
  const colorValue = characterCell(doc, shape, ix, 'Color')?.v;
  return {
    size: Math.round(parseFloat(characterCell(doc, shape, ix, 'Size')?.v ?? '0.1667') * scale * 10) / 10,
    color: colorValue === undefined ? '#000000' : parseColor(doc, colorValue) ?? '#000000',
    bits: parseInt(characterCell(doc, shape, ix, 'Style')?.v ?? '0', 10) || 0,
    font: fontName(doc, characterCell(doc, shape, ix, 'Font')),
  };
}

/**
 * HTML label with a span per run whose character style differs from the first one's.
 * @param {VisioDocument} doc
 * @param {Shape} shape
 * @param {number} scale  px per inch
 * @returns {Label | null}  null when the shape has no visible text
 */
export function labelOf(doc, shape, scale) {
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
  return { html, base, align: paragraphAlignment(shape, runs[0].pp) };
}

/**
 * Text in a filled or outlined box wraps at the box. A bare label or a separate text block is sized
 * to its text by Visio, so it must not wrap when the viewer's font is wider than the original.
 * @param {VisioDocument} doc
 * @param {Shape} shape
 * @param {Label} label
 * @param {boolean} wrap
 */
export function textStyleFragment(doc, shape, label, wrap) {
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
