import { describe, it, expect } from 'vitest';
import { minifyPathData, minifySvgPaths } from '../../public/wasm/svg-minify.mjs';

// The absolute points a path passes through, per subpath, so two spellings can be compared.
function trace(d: string): number[][][] {
  const tokens = d.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)!;
  const arity: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, Z: 0 };
  const subpaths: number[][][] = [];
  let x = 0, y = 0, startX = 0, startY = 0, cmd = '';
  for (let i = 0; i < tokens.length; ) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const args = tokens.slice(i, i + arity[cmd.toUpperCase()]).map(Number);
    i += args.length;
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M':
        [x, y] = [ox + args[0], oy + args[1]];
        [startX, startY] = [x, y];
        subpaths.push([[x, y]]);
        cmd = rel ? 'l' : 'L';
        break;
      case 'L': [x, y] = [ox + args[0], oy + args[1]]; subpaths.at(-1)!.push([x, y]); break;
      case 'H': x = (rel ? x : 0) + args[0]; subpaths.at(-1)!.push([x, y]); break;
      case 'V': y = (rel ? y : 0) + args[0]; subpaths.at(-1)!.push([x, y]); break;
      case 'C':
        subpaths.at(-1)!.push([ox + args[0], oy + args[1]], [ox + args[2], oy + args[3]], [ox + args[4], oy + args[5]]);
        [x, y] = [ox + args[4], oy + args[5]];
        break;
      case 'Z': [x, y] = [startX, startY]; subpaths.at(-1)!.push([NaN, NaN]); break;
    }
  }
  // A subpath that is only a move draws nothing.
  return subpaths.filter((points) => points.length > 1).map((points) => points.map(([px, py]) => [+px.toFixed(6), +py.toFixed(6)]));
}

describe('SVG path minification', () => {
  it('writes axis-aligned lines as h/v and drops moves that lead nowhere', () => {
    expect(minifyPathData('M443 427l47 0 0 6-47 0zm0 0m1-5 45 0 0 5-45 0zm0 0')).toBe('M443 427h47v6h-47zm1-5h45v5h-45z');
  });

  it('keeps numbers apart where joining them would change them', () => {
    // "0" followed by ".45" would read as 0.45
    expect(minifyPathData('M1 2l0 155.59.45 0')).toBe('M1 2v155.59h.45');
    expect(minifyPathData('M1 2c.45 0 .68-.45.68-.9')).toBe('M1 2c.45 0 .68-.45.68-.9');
    expect(minifyPathData('M1 2l3 0l4 0')).toBe('M1 2h3 4');
  });

  it('keeps a first relative move, which places the path', () => {
    expect(minifyPathData('m0 0l1 1')).toBe('m0 0l1 1');
  });

  it('leaves data it does not parse unchanged', () => {
    expect(minifyPathData('M0 0A1 1 0 0 1 2 2')).toBeNull();
    expect(minifyPathData('M0 0L1')).toBeNull();
    expect(minifySvgPaths('<path d="M0 0a1 1 0 011 1"/>')).toBe('<path d="M0 0a1 1 0 011 1"/>');
  });

  it('draws the same points as the original data', () => {
    const samples = [
      'M3311.11 481.15l19.3 0 0 155.14-19.3 0zm0 0',
      'M40 685l70 0 0 1-70 0zm0 0m1-7 68 0 0 1-68 0zm0 0m0 3 68 0 0 2-68 0zm0 0',
      'M108.49 682.82l.22 0c.45 0 .68-.45.68-.9l0-.45c-.23-.45-.45-.9-.9-.9l-.45 0c0-.22 0-.67 0-1.12l.23 0l0 0-.23 0zm5 5 1 1',
      'M1e2 2L3 4l0 5-6 0Z',
    ];
    for (const d of samples) {
      const minified = minifyPathData(d)!;
      expect(minified.length).toBeLessThan(d.length);
      expect(trace(minified)).toEqual(trace(d));
    }
  });
});
