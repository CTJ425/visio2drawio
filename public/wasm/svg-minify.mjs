// @ts-check
// Lossless size reductions for the SVG that emf-converter writes for Visio's EMF/WMF pictures.
// Those pictures hold thousands of paths and make up most of a converted stencil, so their
// path data dominates the .xml/.drawio size. Every rewrite here draws exactly the same thing:
// numbers are kept as written, only redundant commands, letters and separators are dropped.

const PATH_DATA = /(\sd=")([^"]*)(")/g;
const TOKEN = /[MmLlHhVvCcSsQqTtZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
/** @type {Record<string, number>} */
const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, Z: 0 };

/**
 * Shortens the path data (`d` attributes) of an SVG document.
 * @param {string} svg
 * @returns {string}
 */
export function minifySvgPaths(svg) {
  return svg.replace(PATH_DATA, (match, open, d, close) => {
    const minified = minifyPathData(d);
    return minified == null ? match : open + minified + close;
  });
}

/**
 * Rewrites path data without changing what it draws:
 * - a relative line along an axis becomes `h`/`v` (`l0 6` -> `v6`),
 * - a relative move by `0 0` right before another move or the end of the path is dropped,
 * - repeated command letters and needless separators are left out.
 * Returns null for data it does not parse (arcs, whose flags need not be separated, or
 * anything malformed), which the caller keeps unchanged.
 * @param {string} d
 * @returns {string | null}
 */
export function minifyPathData(d) {
  const tokens = d.match(TOKEN);
  if (!tokens || tokens.join('').length !== d.replace(/[\s,]/g, '').length) return null;

  /** @type {{ cmd: string, args: string[] }[]} */
  const segments = [];
  let cmd = '';
  for (let i = 0; i < tokens.length; ) {
    const token = tokens[i];
    if (/[A-Za-z]/.test(token)) {
      cmd = token;
      i++;
      if (cmd === 'Z' || cmd === 'z') {
        segments.push({ cmd, args: [] });
        continue;
      }
    } else if (!cmd || cmd === 'Z' || cmd === 'z') {
      return null;
    }
    const arity = ARITY[cmd.toUpperCase()];
    const args = tokens.slice(i, i + arity);
    if (args.length !== arity || args.some((arg) => /[A-Za-z]/.test(arg) && !/[eE]/.test(arg))) return null;
    i += arity;
    segments.push({ cmd, args });
    // Coordinate pairs after a move are implicit lines.
    if (cmd === 'm') cmd = 'l';
    else if (cmd === 'M') cmd = 'L';
  }
  if (segments.length === 0 || !/[Mm]/.test(segments[0].cmd)) return null;

  /** @type {{ cmd: string, args: string[] }[]} */
  const kept = [];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment.cmd === 'l') {
      const [dx, dy] = segment.args.map(Number);
      if (dx === 0) {
        segment.cmd = 'v';
        segment.args = [segment.args[1]];
      } else if (dy === 0) {
        segment.cmd = 'h';
        segment.args = [segment.args[0]];
      }
    } else if (segment.cmd === 'm' && i > 0 && isZero(segment.args)) {
      // Moving nowhere matters only when something is drawn from there.
      const next = segments[i + 1];
      if (!next || next.cmd === 'm' || next.cmd === 'M') continue;
    }
    kept.push(segment);
  }

  let out = '';
  let last = '';
  let lastNumber = '';
  for (const { cmd, args } of kept) {
    // After a move the same letter would mean a line, so a move always repeats its letter.
    if (cmd !== last || cmd === 'm' || cmd === 'M') {
      out += cmd;
      lastNumber = '';
    }
    for (const arg of args) {
      if (lastNumber && !startsNewNumber(lastNumber, arg)) out += ' ';
      out += arg;
      lastNumber = arg;
    }
    last = cmd;
  }
  return out;
}

/** @param {string[]} args */
function isZero(args) {
  return args.every((arg) => Number(arg) === 0);
}

// Whether `next` written right after `prev` still reads as a separate number.
/** @param {string} prev @param {string} next */
function startsNewNumber(prev, next) {
  if (next[0] === '-' || next[0] === '+') return true;
  return next[0] === '.' && /[.eE]/.test(prev);
}
