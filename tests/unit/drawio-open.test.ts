import { describe, it, expect } from 'vitest';
import { convertVisio } from '../../public/wasm/converter-core.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

async function convertToText(bytes: Uint8Array, options: Parameters<typeof convertVisio>[1]) {
  return new TextDecoder('utf-8').decode(await convertVisio(bytes, options));
}

describe('Draw.io File & Library Opening Compatibility Verification', () => {
  const hpePath = path.join(process.cwd(), 'orig_data', 'HPE-ProLiant-RL.vss');
  const xrPath = path.join(process.cwd(), 'samples', 'Dell-PowerEdge-RackServers', 'Dell-PowerEdge-XR.vss');
  const rackServersPath = path.join(process.cwd(), 'samples', 'Dell-PowerEdge-RackServers', 'Dell-PowerEdge-RackServers.vss');

  it('verifies HPE .drawio XML structure conforms exactly to draw.io (diagrams.net) schema', async () => {
    const buf = await fs.readFile(hpePath);
    const xml = await convertToText(buf, {
      format: 'drawio',
      cols: 3,
      scale: 120,
    });

    // 1. XML Header and root tags
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<mxfile host="app.diagrams.net"');
    expect(xml).toContain('<diagram id="visio-stencils" name="Visio Stencils">');
    expect(xml).toContain('<mxGraphModel');
    expect(xml).toContain('<root>');
    expect(xml).toContain('<mxCell id="0" />');
    expect(xml).toContain('<mxCell id="1" parent="0" />');

    // 2. Extract all mxCell elements
    const cellRegex = /<mxCell\s+id="([^"]+)"\s+value="([^"]*)"\s+style="([^"]+)"\s+vertex="1"\s+parent="1">\s*<mxGeometry\s+x="([^"]+)"\s+y="([^"]+)"\s+width="([^"]+)"\s+height="([^"]+)"\s+as="geometry"\s*\/>\s*<\/mxCell>/g;
    const matches = Array.from(xml.matchAll(cellRegex));
    expect(matches.length).toBe(12);

    for (const match of matches) {
      const [, id, value, style, x, y, width, height] = match;
      expect(id).toMatch(/^shape-\d+$/);
      expect(value.length).toBeGreaterThan(0);
      expect(parseFloat(x)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(y)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(width)).toBeGreaterThan(0);
      expect(parseFloat(height)).toBeGreaterThan(0);

      // Verify draw.io style string uses image=data:image/svg+xml;base64,
      expect(style).toContain('shape=image;');
      expect(style).toContain('image=data:image/svg+xml;base64,');

      // Extract Base64 SVG and decode
      const b64Match = style.match(/image=data:image\/svg\+xml;base64,([^;]+);/);
      expect(b64Match).not.toBeNull();
      const b64 = b64Match![1];
      const svgText = Buffer.from(b64, 'base64').toString('utf-8');

      // Verify decoded SVG is valid SVG XML
      expect(svgText).toContain('<svg');
      expect(svgText).toContain('</svg>');
      expect(svgText).toContain('xmlns="http://www.w3.org/2000/svg"');
    }
  });

  it('verifies HPE .xml mxlibrary conforms to draw.io custom shape library format', async () => {
    const buf = await fs.readFile(hpePath);
    const xml = await convertToText(buf, {
      format: 'mxlibrary',
    });

    expect(xml.startsWith('<mxlibrary>')).toBe(true);
    expect(xml.trimEnd().endsWith('</mxlibrary>')).toBe(true);

    const decodeXml = (s: string) =>
      s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

    const jsonStr = decodeXml(xml.slice('<mxlibrary>'.length, xml.lastIndexOf('</mxlibrary>')).trim());
    const libraryItems = JSON.parse(jsonStr);

    expect(Array.isArray(libraryItems)).toBe(true);
    expect(libraryItems.length).toBe(12);

    for (const item of libraryItems) {
      expect(item).toHaveProperty('title');
      expect(item).toHaveProperty('w');
      expect(item).toHaveProperty('h');
      expect(item).toHaveProperty('aspect', 'fixed');
      expect(item).toHaveProperty('data');
      expect(item).toHaveProperty('xml');

      expect(typeof item.w).toBe('number');
      expect(typeof item.h).toBe('number');
      expect(item.w).toBeGreaterThan(0);
      expect(item.h).toBeGreaterThan(0);

      // Verify item.data is valid svg data URI
      expect(item.data.startsWith('data:image/svg+xml;base64,')).toBe(true);
      const b64 = item.data.replace('data:image/svg+xml;base64,', '');
      const decodedSvg = Buffer.from(b64, 'base64').toString('utf-8');
      expect(decodedSvg).toContain('<svg');
      expect(decodedSvg).toContain('</svg>');

      // Verify item.xml is a valid mxGraphModel
      expect(item.xml).toContain('<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2"');
      expect(item.xml).toContain('</root></mxGraphModel>');
    }
  });

  it('verifies Dell XR and 55MB RackServers conversion integrity and draw.io openable XML', async () => {
    const xrBuf = await fs.readFile(xrPath);
    const xrXml = await convertToText(xrBuf, {
      format: 'drawio',
    });

    expect(xrXml).toContain('<mxfile host="app.diagrams.net"');
    const xrMatches = Array.from(xrXml.matchAll(/<mxCell\s+id="shape-(\d+)"/g));
    expect(xrMatches.length).toBe(57);

    // Large 55MB file
    const rackBuf = await fs.readFile(rackServersPath);
    const rackXml = await convertToText(rackBuf, {
      format: 'drawio',
    });

    expect(rackXml).toContain('<mxfile host="app.diagrams.net"');
    const rackMatches = Array.from(rackXml.matchAll(/<mxCell\s+id="shape-(\d+)"/g));
    expect(rackMatches.length).toBe(281);
  });
});
