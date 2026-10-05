// @ts-check
// ShapeSheet formulas: only what inherited geometry cells need (Width*0.5, Geometry1.Y3,
// GUARD(...)). Anything else throws, and the caller falls back to the cached value.

/** @typedef {{ number?: number, name?: string, op?: string }} Token */

/**
 * @param {string} formula
 * @param {(name: string) => number} resolve  value of a cell reference such as `Width`
 * @returns {number}
 */
export function evaluateFormula(formula, resolve) {
  /** @type {Token[]} */
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
  /** @param {string} op */
  const isOp = (op) => peek()?.op === op;

  /** @returns {number} */
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
  /** @returns {number} */
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
  /** @returns {number} */
  function term() {
    let value = unary();
    while (isOp('*') || isOp('/')) value = take().op === '*' ? value * unary() : value / unary();
    return value;
  }
  /** @returns {number} */
  function expression() {
    let value = term();
    while (isOp('+') || isOp('-')) value = take().op === '+' ? value + term() : value - term();
    return value;
  }

  const value = expression();
  if (at < tokens.length || !Number.isFinite(value)) throw new Error('trailing input');
  return value;
}

/**
 * @param {string} name  upper case
 * @param {number[]} args
 * @returns {number}
 */
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
