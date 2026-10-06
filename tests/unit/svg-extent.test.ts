import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { contentFrame, applyFrame, drawnExtent } from '../../public/wasm/svg-extent.mjs';
import { convertVisio } from '../../public/wasm/converter-core.mjs';

const svg = (body: string, viewBox = '0 0 100 10', size = 'width="1in" height="0.1in"') =>
  `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" ${size} viewBox="${viewBox}" >${body}</svg>`;

describe('stencil frame fitting', () => {
  it('leaves a stencil whose content fits its page alone', () => {
    expect(contentFrame(svg('<path d="M0,0 L100,0 L100,10 L0,10 Z"/>'))).toBeNull();
    // A stroke reaching just past the page is no reason to resize.
    expect(contentFrame(svg('<path d="M-0.3,0 L100.3,10"/>'))).toBeNull();
  });

  it('grows the frame to a picture that reaches past the page', () => {
    const source = svg('<image x="0" y="-20" width="100" height="50" xlink:href="data:image/png;base64,AAAA" />');
    const frame = contentFrame(source)!;
    expect(frame).toMatchObject({ x: 0, y: -20, width: 100, height: 50 });

    const fitted = applyFrame(source, frame);
    expect(fitted).toContain('viewBox="0 -20 100 50"');
    // Same drawing scale: 5x the height in user units is 5x the height in inches.
    expect(fitted).toContain('width="1in"');
    expect(fitted).toContain('height="0.5in"');
  });

  it('follows transforms, curves and arcs, and leaves text out', () => {
    expect(drawnExtent('<svg><g transform="translate(10,5)"><path d="M0 0h10v10z"/></g></svg>')).toEqual({ minX: 10, minY: 5, maxX: 20, maxY: 15 });
    const rotated = drawnExtent('<svg><image x="0" y="0" width="10" height="2" transform="rotate(90 0 0)"/></svg>')!;
    expect([rotated.minX, rotated.minY, rotated.maxX, rotated.maxY].map((v) => +v.toFixed(9) + 0)).toEqual([-2, 0, 0, 10]);
    // The curve bulges to y = -7.5 between its ends.
    expect(drawnExtent('<svg><path d="M0 0C0 -10 10 -10 10 0"/></svg>')!.minY).toBeCloseTo(-7.5, 5);
    // A half circle of radius 5 from (0,0) to (10,0) reaches y = -5 with the sweep flag set.
    expect(drawnExtent('<svg><path d="M0 0A5 5 0 0 1 10 0"/></svg>')!.minY).toBeCloseTo(-5, 1);
    expect(drawnExtent('<svg><path d="M0 0h1"/><text x="500" y="500">far away</text></svg>')).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 0 });
  });

  it('keeps the whole picture of masters whose page is smaller than it', async () => {
    const hpe = await fs.readFile(path.join(process.cwd(), 'orig_data', 'HPE-ProLiant-RL.vss'));
    const result = JSON.parse(new TextDecoder().decode(await convertVisio(hpe, { format: 'json' })));
    const psu = result.items.find((item: { title: string }) => item.title === 'FlexSlot Generic PSU');
    const psuSvg = Buffer.from(psu.svgBase64.split(',')[1], 'base64').toString('utf-8');

    // The master's page is 0.268" x 0.1", but its picture spans 0.159" of height.
    expect(psu.widthInches).toBeCloseTo(0.268, 3);
    expect(psu.heightInches).toBeCloseTo(0.1593, 3);
    const viewBox = /viewBox="([^"]+)"/.exec(psuSvg)![1].split(' ').map(Number);
    const picture = /<svg x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/.exec(psuSvg)!.slice(1).map(Number);
    expect(viewBox[1]).toBeLessThanOrEqual(picture[1]);
    expect(viewBox[1] + viewBox[3]).toBeGreaterThanOrEqual(picture[1] + picture[3] - 1e-3);
  });
});
