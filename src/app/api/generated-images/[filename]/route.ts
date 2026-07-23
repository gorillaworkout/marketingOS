import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { generatedImageContentType, isSafeGeneratedImageFilename } from '@/lib/generated-images';

type RouteContext = { params: Promise<{ filename: string }> };

// Generated files are written after `next start` has booted. Serve them from a
// route handler rather than Next's startup-scanned /public static file list.
export async function GET(_request: Request, { params }: RouteContext) {
  const { filename } = await params;
  if (!isSafeGeneratedImageFilename(filename)) {
    return new NextResponse('Not found', { status: 404 });
  }

  const filePath = path.join(process.cwd(), 'public', 'outputs', 'images', filename);
  if (!fs.existsSync(filePath)) {
    return new NextResponse('Not found', { status: 404 });
  }

  try {
    return new NextResponse(fs.readFileSync(filePath), {
      headers: {
        'Content-Type': generatedImageContentType(filename) || 'application/octet-stream',
        'Cache-Control': 'public, max-age=3600',
        'Content-Disposition': `inline; filename="${filename}"`,
      },
    });
  } catch {
    return new NextResponse('Unable to read image', { status: 500 });
  }
}
