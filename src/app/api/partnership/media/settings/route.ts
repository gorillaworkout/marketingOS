import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { normalizeMediaSettings } from '@/lib/partnership/media';
import { getMediaSettings, saveMediaSettings } from '@/lib/partnership/media-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ settings: await getMediaSettings() });
}

/**
 * Saves keywords, hashtags, official handles, language and the ad-value estimate.
 * Google Alerts feeds are managed on the Google Alerts page; any alertFeeds sent here are ignored.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Send the settings as JSON.' }, { status: 400 });
  const current = await getMediaSettings();
  const { alertFeeds: _ignored, ...rest } = body;
  void _ignored;
  const { settings, errors } = normalizeMediaSettings({ ...rest, alertFeeds: current.alertFeeds }, current);
  if (errors.length) return NextResponse.json({ error: errors.join(' '), errors }, { status: 400 });
  await saveMediaSettings(settings, auth.id);
  return NextResponse.json({ settings: await getMediaSettings() });
}
