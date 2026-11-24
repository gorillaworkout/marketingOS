import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { readUploadBody } from '@/lib/monthly-report/service';
import { parseMappingChoice } from '@/lib/cs-report/mapping';
import { UploadInputError, commitUploadFile, previewUpload } from '@/lib/cs-report/service';
import { getUserBrief } from '@/lib/cs-report/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Bulk upload of the CS workbook (current format). Body = the raw .xlsx.
 * ?mode=preview (default): parse every monthly sheet, per-sheet counts, warnings, name suggestions, new vs stored.
 * ?mode=commit&mapping={"Excel name":"user:<id>"|"agent:<id>"|"name"}: insert what is not stored yet
 * (agent+date, complaint key, week+channel) and log the upload. ?fileName= is the original name.
 */
export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'cs-report');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await readUploadBody(request);
  if (body instanceof NextResponse) return body;
  const params = request.nextUrl.searchParams;
  const fileName = (params.get('fileName') || 'upload.xlsx').slice(0, 200);
  if (!/\.xlsx$/i.test(fileName)) return NextResponse.json({ error: 'Upload the CS workbook as an .xlsx file.' }, { status: 400 });
  try {
    if (params.get('mode') === 'commit') {
      const mapping = parseMappingChoice(params.get('mapping'));
      if ('error' in mapping) return NextResponse.json({ error: mapping.error }, { status: 400 });
      const user = await getUserBrief(auth.id);
      const result = await commitUploadFile(body, fileName, mapping as Record<string, string>, { id: auth.id, name: user?.name ?? null });
      return NextResponse.json({ result });
    }
    return NextResponse.json({ preview: await previewUpload(body, fileName) });
  } catch (error) {
    if (error instanceof UploadInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('CS Report upload failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not read this workbook. Check that it is the CS Weekly Work List file (.xlsx).' }, { status: 400 });
  }
}
