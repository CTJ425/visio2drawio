import { describe, it, expect } from 'vitest';
import { convertVisio } from '../../public/wasm/converter-core.mjs';
import { isSupportedVisioFile } from '@/lib/converter';
import fs from 'node:fs/promises';
import path from 'node:path';

async function convertToText(filePath: string, options: Parameters<typeof convertVisio>[1] = {}) {
  const bytes = await fs.readFile(filePath);
  return new TextDecoder().decode(await convertVisio(bytes, options));
}

describe('Converter Unit Tests (WASM engine)', () => {
  const sampleVssPath = path.join(process.cwd(), 'samples', 'Dell-PowerEdge-RackServers', 'Dell-PowerEdge-XR.vss');
  const hpePath = path.join(process.cwd(), 'orig_data', 'HPE-ProLiant-RL.vss');

  it('should accept only Visio file extensions', () => {
    expect(isSupportedVisioFile('a.vss')).toBe(true);
    expect(isSupportedVisioFile('B.VSDX')).toBe(true);
    expect(isSupportedVisioFile('notes.txt')).toBe(false);
  });

  it('should parse stencils preview from sample .vss file', async () => {
    const result = JSON.parse(await convertToText(sampleVssPath, { format: 'json', limit: 10 }));

    expect(result.total).toBe(57);
    expect(result.count).toBe(10);
    expect(result.items).toHaveLength(10);
    expect(result.items[0]).toHaveProperty('title');
    expect(result.items[0].svgBase64).toContain('data:image/svg+xml;base64,');
  });

  it('should convert .vss file to drawio', async () => {
    const xml = await convertToText(sampleVssPath, { format: 'drawio', cols: 3, scale: 120 });

    expect(xml.length).toBeGreaterThan(1000);
    expect(xml).toContain('<?xml');
    expect(xml).toContain('<mxfile');
  });

  it('should convert .vss file to mxlibrary', async () => {
    const xml = await convertToText(sampleVssPath, { format: 'mxlibrary' });

    expect(xml.length).toBeGreaterThan(1000);
    expect(xml).toContain('<mxlibrary>');
  });

  it('should parse stencils preview from HPE-ProLiant-RL.vss with 12 stencils', async () => {
    const result = JSON.parse(await convertToText(hpePath, { format: 'json', limit: 60 }));

    expect(result.total).toBe(12);
    expect(result.count).toBe(12);
    expect(result.items).toHaveLength(12);
    expect(result.items.some((item: { title: string }) => item.title.includes('RL300 Gen11'))).toBe(true);
    expect(result.items[0].svgBase64).toContain('data:image/svg+xml;base64,');
  });

  it('should replace embedded EMF/WMF images with SVG, since browsers cannot render metafiles', async () => {
    const result = JSON.parse(await convertToText(hpePath, { format: 'json' }));
    const svgs: string[] = result.items.map((item: { svgBase64: string }) =>
      Buffer.from(item.svgBase64.split(',')[1], 'base64').toString('utf-8')
    );

    for (const svg of svgs) {
      expect(svg).not.toMatch(/data:image\/(emf|wmf)/);
    }
    // 11 of the 12 HPE stencils embed an EMF picture
    expect(svgs.filter((svg) => svg.includes('<image ')).length).toBe(11);
    expect(svgs.every((svg) => !svg.includes('<image ') || svg.includes('xlink:href="data:image/svg+xml;base64,'))).toBe(true);
  });

  it('should draw EMF+ dual pictures from their GDI records, which emf-converter renders completely', async () => {
    const result = JSON.parse(await convertToText(hpePath, { format: 'json' }));
    const front = result.items.find((item: { title: string }) => item.title === 'RL300 Gen11 8SFF Front');
    const svg = Buffer.from(front.svgBase64.split(',')[1], 'base64').toString('utf-8');
    const picture = svg.match(/xlink:href="data:image\/svg\+xml;base64,([^"]+)"/)![1];
    const pictureSvg = Buffer.from(picture, 'base64').toString('utf-8');

    // From EMF+ only the chassis ears come out (177 paths); the GDI records draw the
    // drive bays, vents and ports as well (750 paths).
    expect((pictureSvg.match(/<path/g) || []).length).toBeGreaterThan(500);
  });

  it('should reject invalid or unsupported files gracefully', async () => {
    const fakeBytes = new TextEncoder().encode('This is a plain text file, not Visio');
    await expect(convertVisio(fakeBytes, { format: 'json' })).rejects.toThrow(/Unsupported Visio file format/);
  });

  it('should keep working after a rejected file', async () => {
    await expect(convertVisio(new Uint8Array([1, 2, 3]))).rejects.toThrow();
    const xml = await convertToText(hpePath, { format: 'drawio' });
    expect(xml).toContain('<mxfile');
  });
});
