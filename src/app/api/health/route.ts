import { NextResponse } from 'next/server';
import { getBinaryPath } from '@/lib/converter';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function GET() {
  try {
    const binaryPath = getBinaryPath();
    const { stdout } = await execFileAsync(binaryPath, ['--help']);
    return NextResponse.json({
      status: 'ok',
      engine: 'libvisio-0.1 / librevenge-0.0',
      binary: binaryPath,
      help: stdout.trim(),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        status: 'error',
        message: error.message || 'Failed to verify converter binary',
      },
      { status: 500 }
    );
  }
}
