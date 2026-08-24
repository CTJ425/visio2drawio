import { describe, it, expect } from 'vitest';
import { GET as healthRoute } from '@/app/api/health/route';
import { POST as previewRoute } from '@/app/api/preview/route';
import { POST as convertRoute } from '@/app/api/convert/route';
import { NextRequest } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('API Smoke Tests', () => {
  const sampleVssPath = path.join(process.cwd(), 'samples', 'Dell-PowerEdge-RackServers', 'Dell-PowerEdge-XR.vss');

  it('GET /api/health returns 200 with engine status', async () => {
    const res = await healthRoute();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.engine).toContain('libvisio');
  });

  it('POST /api/preview with valid .vss returns 200 and stencils', async () => {
    const fileBuffer = await fs.readFile(sampleVssPath);
    const blob = new Blob([fileBuffer]);
    const formData = new FormData();
    formData.append('file', blob, 'Dell-PowerEdge-XR.vss');
    formData.append('limit', '10');

    const req = new NextRequest('http://localhost:3000/api/preview', {
      method: 'POST',
      body: formData,
    });

    const res = await previewRoute(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.total).toBe(57);
    expect(data.items).toHaveLength(10);
  });

  it('POST /api/convert with drawio format returns 200 and XML stream', async () => {
    const fileBuffer = await fs.readFile(sampleVssPath);
    const blob = new Blob([fileBuffer]);
    const formData = new FormData();
    formData.append('file', blob, 'Dell-PowerEdge-XR.vss');
    formData.append('format', 'drawio');

    const req = new NextRequest('http://localhost:3000/api/convert', {
      method: 'POST',
      body: formData,
    });

    const res = await convertRoute(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/xml');
    expect(res.headers.get('content-disposition')).toContain('Dell-PowerEdge-XR.drawio');

    const text = await res.text();
    expect(text).toContain('<?xml');
    expect(text).toContain('<mxfile');
  });

  it('POST /api/convert with mxlibrary format returns 200 and library XML', async () => {
    const fileBuffer = await fs.readFile(sampleVssPath);
    const blob = new Blob([fileBuffer]);
    const formData = new FormData();
    formData.append('file', blob, 'Dell-PowerEdge-XR.vss');
    formData.append('format', 'mxlibrary');

    const req = new NextRequest('http://localhost:3000/api/convert', {
      method: 'POST',
      body: formData,
    });

    const res = await convertRoute(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/xml');
    expect(res.headers.get('content-disposition')).toContain('Dell-PowerEdge-XR.xml');

    const text = await res.text();
    expect(text).toContain('<mxlibrary>');
  });

  it('POST /api/preview with HPE-ProLiant-RL.vss returns 200 and 12 stencils', async () => {
    const hpePath = path.join(process.cwd(), 'orig_data', 'HPE-ProLiant-RL.vss');
    const fileBuffer = await fs.readFile(hpePath);
    const blob = new Blob([fileBuffer]);
    const formData = new FormData();
    formData.append('file', blob, 'HPE-ProLiant-RL.vss');
    formData.append('limit', '60');

    const req = new NextRequest('http://localhost:3000/api/preview', {
      method: 'POST',
      body: formData,
    });

    const res = await previewRoute(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.total).toBe(12);
    expect(data.items).toHaveLength(12);
  });

  it('POST /api/convert with HPE-ProLiant-RL.vss returns 200 and drawio XML stream', async () => {
    const hpePath = path.join(process.cwd(), 'orig_data', 'HPE-ProLiant-RL.vss');
    const fileBuffer = await fs.readFile(hpePath);
    const blob = new Blob([fileBuffer]);
    const formData = new FormData();
    formData.append('file', blob, 'HPE-ProLiant-RL.vss');
    formData.append('format', 'drawio');

    const req = new NextRequest('http://localhost:3000/api/convert', {
      method: 'POST',
      body: formData,
    });

    const res = await convertRoute(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/xml');
    expect(res.headers.get('content-disposition')).toContain('HPE-ProLiant-RL.drawio');

    const text = await res.text();
    expect(text).toContain('<?xml');
    expect(text).toContain('<mxfile');
  });

  it('POST /api/convert with missing file returns 400', async () => {
    const formData = new FormData();
    const req = new NextRequest('http://localhost:3000/api/convert', {
      method: 'POST',
      body: formData,
    });

    const res = await convertRoute(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
  });

  it('POST /api/convert with invalid file type returns 400', async () => {
    const blob = new Blob(['sample text']);
    const formData = new FormData();
    formData.append('file', blob, 'unsupported.exe');

    const req = new NextRequest('http://localhost:3000/api/convert', {
      method: 'POST',
      body: formData,
    });

    const res = await convertRoute(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('不支援的檔案格式');
  });
});

