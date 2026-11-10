import { execute, queryAll } from '@/lib/database';
import { JISDOR_PAGE_URL, parseJisdorHtml, type JisdorFixing } from './jisdor';

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

/** One read of the public BI page. A block or an empty table stores nothing. */
export async function fetchPublishedJisdor(load: typeof fetch = fetch): Promise<{ ok: true; rows: JisdorFixing[] } | { ok: false; error: string; status: number }> {
  let html = '';
  try {
    const response = await load(JISDOR_PAGE_URL, { headers: { 'User-Agent': 'MarketingOS settlement' } });
    if (!response.ok) return { ok: false, error: `JISDOR page returned ${response.status}. Nothing was stored.`, status: 502 };
    html = await response.text();
  } catch {
    return { ok: false, error: 'JISDOR page could not be fetched. Nothing was stored.', status: 502 };
  }
  const rows = parseJisdorHtml(html);
  if (!rows.length) return { ok: false, error: 'Unrecognized JISDOR page. Nothing was stored.', status: 422 };
  return { ok: true, rows };
}
