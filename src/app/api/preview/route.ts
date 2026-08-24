import { NextRequest, NextResponse } from 'next/server';
import { convertVisioPreview } from '@/lib/converter';

export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: '請使用 POST 方法並夾帶 Visio 檔案以取得預覽。',
    },
    { status: 405 }
  );
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const limit = parseInt((formData.get('limit') as string) || '60', 10);

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

    const result = await convertVisioPreview(buffer, file.name, limit);

    return NextResponse.json({
      success: true,
      fileName: file.name,
      total: result.total,
      count: result.count,
      items: result.items,
    });
  } catch (error: any) {
    console.error('Preview error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || '預覽 Visio 檔案時發生錯誤，請確認檔案是否損毀。',
      },
      { status: 500 }
    );
  }
}
