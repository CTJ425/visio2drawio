import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const execFileAsync = promisify(execFile);

export interface StencilItem {
  id: number;
  title: string;
  widthInches: number;
  heightInches: number;
  svgBase64: string;
}

export interface PreviewResult {
  total: number;
  count: number;
  items: StencilItem[];
}

export interface ConvertOptions {
  format?: 'drawio' | 'mxlibrary' | 'json';
  cols?: number;
  scale?: number;
  limit?: number;
}

export function getBinaryPath(): string {
  const binaryPath = path.join(process.cwd(), 'bin', 'vss2drawio');
  if (!existsSync(binaryPath)) {
    throw new Error(`Converter binary not found at ${binaryPath}. Run 'npm run build:native' to compile it.`);
  }
  return binaryPath;
}

export async function convertVisioPreview(
  fileBuffer: Buffer | Uint8Array,
  originalFilename: string,
  limit: number = 60
): Promise<PreviewResult> {
  const binaryPath = getBinaryPath();
  const ext = path.extname(originalFilename) || '.vss';
  const randomId = crypto.randomBytes(8).toString('hex');
  const tempDir = os.tmpdir();
  const inputTempPath = path.join(tempDir, `v2d_in_${randomId}${ext}`);
  const outputTempPath = path.join(tempDir, `v2d_out_${randomId}.json`);

  try {
    await fs.writeFile(inputTempPath, fileBuffer);

    const args = [
      inputTempPath,
      outputTempPath,
      '--format',
      'json',
      '--limit',
      limit.toString(),
    ];

    await execFileAsync(binaryPath, args, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 60000,
    });

    if (!existsSync(outputTempPath)) {
      throw new Error('Conversion completed but no output file was created.');
    }

    const outputContent = await fs.readFile(outputTempPath, 'utf8');
    const parsed = JSON.parse(outputContent);

    if (Array.isArray(parsed)) {
      return {
        total: parsed.length,
        count: parsed.length,
        items: parsed,
      };
    }

    return {
      total: parsed.total || parsed.items?.length || 0,
      count: parsed.count || parsed.items?.length || 0,
      items: parsed.items || [],
    };
  } finally {
    await fs.unlink(inputTempPath).catch(() => {});
    await fs.unlink(outputTempPath).catch(() => {});
  }
}

export async function convertVisioFileStream(
  fileBuffer: Buffer | Uint8Array,
  originalFilename: string,
  options: ConvertOptions = {}
): Promise<{ stream: ReadableStream<Uint8Array>; size: number; cleanup: () => Promise<void> }> {
  const binaryPath = getBinaryPath();
  const format = options.format || 'drawio';
  const cols = options.cols && options.cols > 0 ? options.cols : 3;
  const scale = options.scale && options.scale > 0 ? options.scale : 120;

  const ext = path.extname(originalFilename) || '.vss';
  const randomId = crypto.randomBytes(8).toString('hex');
  const tempDir = os.tmpdir();
  const inputTempPath = path.join(tempDir, `v2d_in_${randomId}${ext}`);
  const outputTempPath = path.join(tempDir, `v2d_out_${randomId}.${format === 'mxlibrary' ? 'xml' : 'drawio'}`);

  await fs.writeFile(inputTempPath, fileBuffer);

  const args = [
    inputTempPath,
    outputTempPath,
    '--format',
    format,
    '--cols',
    cols.toString(),
    '--scale',
    scale.toString(),
  ];

  try {
    await execFileAsync(binaryPath, args, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 120000,
    });

    if (!existsSync(outputTempPath)) {
      throw new Error('Conversion completed but no output file was created.');
    }

    const stat = await fs.stat(outputTempPath);
    const nodeStream = createReadStream(outputTempPath);

    const cleanup = async () => {
      await fs.unlink(inputTempPath).catch(() => {});
      await fs.unlink(outputTempPath).catch(() => {});
    };

    nodeStream.on('close', () => {
      cleanup().catch(() => {});
    });

    nodeStream.on('error', () => {
      cleanup().catch(() => {});
    });

    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    return {
      stream: webStream,
      size: stat.size,
      cleanup,
    };
  } catch (err) {
    await fs.unlink(inputTempPath).catch(() => {});
    await fs.unlink(outputTempPath).catch(() => {});
    throw err;
  }
}
