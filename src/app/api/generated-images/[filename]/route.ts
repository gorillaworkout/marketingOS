import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getSession, type AuthError, type AuthResult } from '@/lib/auth';
import { generatedImageContentType, isSafeGeneratedImageFilename } from '@/lib/generated-images';

type RouteContext = { params: Promise<{ filename: string }> };

// Authenticated bytes: browsers may cache privately; shared/CDN caches must not.
const PRIVATE_CACHE = 'private, max-age=3600';

// Generated files are written after `next start` has booted. Serve them from a
// route handler rather than Next's startup-scanned /public static file list.
export async function GET(request: NextRequest, { params }: RouteContext) {
  const auth = await getSession(request);
  return respondGeneratedImage(auth, await params);
}

export async function respondGeneratedImage(
  auth: AuthResult | AuthError,
  params: { filename: string },
) {
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { filename } = params;
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
        'Cache-Control': PRIVATE_CACHE,
        'Content-Disposition': `inline; filename="${filename}"`,
      },
    });
  } catch {
    return new NextResponse('Unable to read image', { status: 500 });
  }
}
