import { NextResponse } from 'next/server';
import { buildHealthReport } from '@/lib/health';

const NO_STORE = { 'Cache-Control': 'no-store' };

/** Unauthenticated liveness/readiness for PM2, ALB, and ops. No secrets. */
export async function GET() {
  const { report, status } = await buildHealthReport();
  return NextResponse.json(report, { status, headers: NO_STORE });
}
