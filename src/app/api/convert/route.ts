import { NextRequest, NextResponse } from 'next/server';
import { convertVisioFileStream } from '@/lib/converter';
import path from 'node:path';

export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: '請使用 POST 方法並夾帶 Visio 檔案進行轉檔，或透過 http://localhost:3000 網頁介面操作。',
    },
    { status: 405 }
  );
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const format = (formData.get('format') as 'drawio' | 'mxlibrary') || 'drawio';
    const cols = parseInt((formData.get('cols') as string) || '3', 10);
    const scale = parseFloat((formData.get('scale') as string) || '120');

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 });
    }

    const validExtensions = ['.vss', '.vsd', '.vssx', '.vsdx'];
    const lowerName = file.name.toLowerCase();
    const hasValidExt = validExtensions.some(ext => lowerName.endsWith(ext));

    if (!hasValidExt) {
      return NextResponse.json(
        {
          success: false,
          error: `不支援的檔案格式「${file.name}」。請上傳 .vss, .vsd, .vssx 或 .vsdx 檔案。`,
        },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { stream, size } = await convertVisioFileStream(buffer, file.name, {
      format,
      cols,
      scale,
    });

    const parsedPath = path.parse(file.name);
    const baseName = parsedPath.name;
    const outExt = format === 'mxlibrary' ? 'xml' : 'drawio';
    const outFilename = `${baseName}.${outExt}`;
    const encodedFilename = encodeURIComponent(outFilename);

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Length': size.toString(),
        'Content-Disposition': `attachment; filename="${outFilename}"; filename*=UTF-8''${encodedFilename}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('Convert error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || '轉換 Visio 檔案失敗，請確認檔案格式是否正確。',
      },
      { status: 500 }
    );
  }
}
