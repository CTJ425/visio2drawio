import { describe, it, expect } from 'vitest';
import { getBinaryPath, convertVisioPreview, convertVisioFileStream } from '@/lib/converter';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('Converter Unit Tests', () => {
  const sampleVssPath = path.join(process.cwd(), 'samples', 'Dell-PowerEdge-RackServers', 'Dell-PowerEdge-XR.vss');

  it('should locate valid vss2drawio binary', () => {
    const binaryPath = getBinaryPath();
    expect(binaryPath).toBeDefined();
    expect(binaryPath).toContain('bin/vss2drawio');
  });

  it('should parse stencils preview from sample .vss file', async () => {
    const fileBuffer = await fs.readFile(sampleVssPath);
    const result = await convertVisioPreview(fileBuffer, 'Dell-PowerEdge-XR.vss', 10);

    expect(result).toBeDefined();
    expect(result.total).toBe(57);
    expect(result.count).toBe(10);
    expect(result.items).toHaveLength(10);
    expect(result.items[0]).toHaveProperty('title');
    expect(result.items[0]).toHaveProperty('svgBase64');
    expect(result.items[0].svgBase64).toContain('data:image/svg+xml;base64,');
  });

  it('should convert .vss file to drawio stream', async () => {
    const fileBuffer = await fs.readFile(sampleVssPath);
    const { stream, size, cleanup } = await convertVisioFileStream(fileBuffer, 'Dell-PowerEdge-XR.vss', {
      format: 'drawio',
      cols: 3,
      scale: 120,
    });

    expect(stream).toBeDefined();
    expect(size).toBeGreaterThan(1000);

    const reader = stream.getReader();
    const { value } = await reader.read();
    expect(value).toBeDefined();
    const textChunk = new TextDecoder().decode(value);
    expect(textChunk).toContain('<?xml');
    expect(textChunk).toContain('<mxfile');

    await cleanup();
  });

  it('should convert .vss file to mxlibrary stream', async () => {
    const fileBuffer = await fs.readFile(sampleVssPath);
    const { stream, size, cleanup } = await convertVisioFileStream(fileBuffer, 'Dell-PowerEdge-XR.vss', {
      format: 'mxlibrary',
    });

    expect(stream).toBeDefined();
    expect(size).toBeGreaterThan(1000);

    const reader = stream.getReader();
    const { value } = await reader.read();
    const textChunk = new TextDecoder().decode(value);
    expect(textChunk).toContain('<mxlibrary>');

    await cleanup();
  });

  it('should parse stencils preview from HPE-ProLiant-RL.vss with 12 stencils', async () => {
    const hpePath = path.join(process.cwd(), 'orig_data', 'HPE-ProLiant-RL.vss');
    const fileBuffer = await fs.readFile(hpePath);
    const result = await convertVisioPreview(fileBuffer, 'HPE-ProLiant-RL.vss', 60);

    expect(result).toBeDefined();
    expect(result.total).toBe(12);
    expect(result.count).toBe(12);
    expect(result.items).toHaveLength(12);
    expect(result.items.some(item => item.title.includes('RL300 Gen11'))).toBe(true);
    expect(result.items[0]).toHaveProperty('svgBase64');
    expect(result.items[0].svgBase64).toContain('data:image/svg+xml;base64,');
  });

  it('should convert HPE-ProLiant-RL.vss to drawio stream', async () => {
    const hpePath = path.join(process.cwd(), 'orig_data', 'HPE-ProLiant-RL.vss');
    const fileBuffer = await fs.readFile(hpePath);
    const { stream, size, cleanup } = await convertVisioFileStream(fileBuffer, 'HPE-ProLiant-RL.vss', {
      format: 'drawio',
      cols: 3,
      scale: 120,
    });

    expect(stream).toBeDefined();
    expect(size).toBeGreaterThan(1000);

    const reader = stream.getReader();
    const { value } = await reader.read();
    expect(value).toBeDefined();
    const textChunk = new TextDecoder().decode(value);
    expect(textChunk).toContain('<?xml');
    expect(textChunk).toContain('<mxfile');

    await cleanup();
  });

  it('should reject invalid or unsupported files gracefully', async () => {
    const fakeBuffer = Buffer.from('This is a plain text file, not Visio');
    await expect(convertVisioPreview(fakeBuffer, 'test.txt')).rejects.toThrow();
  });
});

