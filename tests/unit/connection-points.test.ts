import { describe, it, expect } from 'vitest';
import { convertVisio } from '../../public/wasm/converter-core.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

async function convertToText(filePath: string, options: Parameters<typeof convertVisio>[1]) {
  const bytes = await fs.readFile(filePath);
  return new TextDecoder().decode(await convertVisio(bytes, options));
}

// Connection points of each shape in a .drawio file, keyed by shape name; null when the
// style has none (draw.io then shows its default points).
function pointsByShape(xml: string): Map<string, number[][] | null> {
  const result = new Map<string, number[][] | null>();
  for (const [, value, style] of xml.matchAll(/<mxCell id="shape-\d+" value="([^"]*)" style="([^"]*)"/g)) {
    const points = style.match(/(?:^|;)points=(\[[^;]*\]);/);
    result.set(value, points ? JSON.parse(points[1]) : null);
  }
  return result;
}

describe('Visio connection points', () => {
  const fixturePath = path.join(process.cwd(), 'tests', 'fixtures', 'connection-points.vssx');
  const hpePath = path.join(process.cwd(), 'orig_data', 'HPE-ProLiant-RL.vss');

  it('maps .vssx connection points to draw.io points relative to the top-left corner', async () => {
    const xml = await convertToText(fixturePath, { format: 'drawio' });

    // Visio's (0, 0.5), (2, 0.5), (1, 1) on a 2in x 1in shape, with Visio's y axis pointing up.
    // The trailing 0 keeps draw.io from moving the point onto the shape outline.
    expect(pointsByShape(xml).get('Connection Box')).toEqual([[0, 0.5, 0], [1, 0.5, 0], [0.5, 0, 0]]);
  });

  it('keeps the image readable by draw.io next to the points', async () => {
    const xml = await convertToText(fixturePath, { format: 'drawio' });
    const style = xml.match(/style="([^"]*)"/)![1];

    expect(style).toMatch(/;points=\[\[0,0\.5,0\],\[1,0\.5,0\],\[0\.5,0,0\]\];image=data:image\/svg\+xml,[A-Za-z0-9+/=]+;$/);
  });

  it('adds the connection points to the mxlibrary shapes', async () => {
    const xml = await convertToText(fixturePath, { format: 'mxlibrary' });
    const decode = (s: string) =>
      s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const [entry] = JSON.parse(decode(xml.slice('<mxlibrary>'.length, xml.lastIndexOf('</mxlibrary>'))));

    // draw.io appends `style` to the image shape it builds from `data` (and ignores `xml` then).
    expect(entry.style).toContain('points=[[0,0.5,0],[1,0.5,0],[0.5,0,0]];');
    expect(entry).not.toHaveProperty('xml');
  });

  it('reads connection points from binary .vss stencils', async () => {
    const points = pointsByShape(await convertToText(hpePath, { format: 'drawio' }));

    // One point per RJ45 port across the middle of the card, plus one on each end
    const card = points.get('1GbE 4P Base-T OCP3')!;
    expect(card).toHaveLength(6);
    const ports = card.filter(([, y]) => Math.abs(y - 0.4524) < 1e-4).map(([x]) => x);
    expect(ports).toEqual([0.217, 0.4057, 0.5943, 0.783]);
    expect(card).toContainEqual([0.03, 0.5499, 0]);
    expect(card).toContainEqual([0.97, 0.5499, 0]);

    expect(points.get('10GbE 2P Base-T OCP3')).toHaveLength(4);
    expect(points.get('25GbE 2P SFP28 OCP3')).toHaveLength(6);
  });

  it('leaves draw.io default points on shapes without Visio connection points', async () => {
    const points = pointsByShape(await convertToText(hpePath, { format: 'drawio' }));

    expect(points.size).toBe(12);
    expect(points.get('RL300 Gen11 Rear')).toBeNull();
    expect([...points.values()].filter((p) => p !== null)).toHaveLength(4);
  });
});
