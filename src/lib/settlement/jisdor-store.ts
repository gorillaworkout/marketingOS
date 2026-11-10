import { execute, queryAll } from '@/lib/database';
import { JISDOR_PAGE_URL, type JisdorFixing } from './jisdor';

export async function listJisdorFixings(): Promise<JisdorFixing[]> {
  const rows = await queryAll<{ fixing_date: string; rate: string }>(
    `SELECT to_char(fixing_date, 'YYYY-MM-DD') AS fixing_date, rate::text FROM settlement_fx_rates ORDER BY fixing_date`,
  );
  return rows.map(row => ({ date: row.fixing_date, rate: Number(row.rate) }));
}

export async function saveJisdorFixings(rows: readonly JisdorFixing[]): Promise<number> {
  for (const row of rows) {
    await execute(
      `INSERT INTO settlement_fx_rates (fixing_date, rate, source_url) VALUES (?::date, ?::numeric, ?)
       ON CONFLICT (fixing_date) DO UPDATE SET rate = EXCLUDED.rate, source_url = EXCLUDED.source_url, fetched_at = CURRENT_TIMESTAMP`,
      [row.date, row.rate, JISDOR_PAGE_URL],
    );
  }
  return rows.length;
}
