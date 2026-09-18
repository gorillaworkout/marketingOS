import { queryOne } from '@/lib/database';

export type HealthDatabaseStatus = 'ok' | 'error';

export interface HealthReport {
  ok: boolean;
  db: HealthDatabaseStatus;
  timestamp: string;
}

export async function pingDatabase(): Promise<void> {
  await queryOne('SELECT 1 AS ok');
}

export async function buildHealthReport(
  ping: () => Promise<unknown> = pingDatabase,
): Promise<{ report: HealthReport; status: number }> {
  const timestamp = new Date().toISOString();
  try {
    await ping();
    return { report: { ok: true, db: 'ok', timestamp }, status: 200 };
  } catch {
    return { report: { ok: false, db: 'error', timestamp }, status: 503 };
  }
}
