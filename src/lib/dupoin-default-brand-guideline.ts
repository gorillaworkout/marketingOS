import { v4 as uuidv4 } from 'uuid';
import { execute, queryOne } from '@/lib/database';

/** Official Dupoin Futures voice guideline seeded when a user has none. */
export const DUPOIN_DEFAULT_BRAND_GUIDELINE = {
  brand_name: 'Dupoin Futures',
  tone_of_voice: 'Professional, stable, trustworthy — clarity over decoration',
  target_market: 'Indonesian and regional traders plus B2B partners interested in next-generation multi-channel trading software, systems, and liquidity services',
  key_messages: 'Trusted broker; fast execution; local support; next-gen multi-channel trading and liquidity',
  do_list: [
    'Use data-driven claims with clear context',
    'Include appropriate risk / investment disclaimers',
    'Prefer clarity and calm confidence over hype',
    'Stay aligned with Dupoin Blue #2EB5C4 and official brand voice',
    'Use the official Dupoin logo (graphical mark + wordmark), never invent logos',
  ],
  dont_list: [
    'Promise guaranteed profits or risk-free returns',
    'Use overly aggressive or fear-based language',
    'Mention competitors by name',
    'Invent, redraw, or AI-generate Dupoin logos / alternate wordmarks',
    'Use off-brand teal or unspecified logo colors',
  ],
  examples: 'Trade with clarity. Dupoin brings fast execution and local support so you can focus on decisions — not noise. Trading involves risk.',
} as const;

export interface BrandGuidelineDb {
  queryOne(sql: string, values?: unknown[]): Promise<{ count: string } | undefined>;
  execute(sql: string, values?: unknown[]): Promise<number>;
}

const postgresDb: BrandGuidelineDb = {
  queryOne: (sql, values) => queryOne<{ count: string }>(sql, values ?? []),
  execute,
};

/**
 * Inserts the Dupoin default when this user has zero brand guidelines.
 * Existing rows are left unchanged, including after later edits.
 */
export async function ensureDefaultBrandGuideline(userId: string, db: BrandGuidelineDb = postgresDb): Promise<void> {
  const row = await db.queryOne(
    'SELECT COUNT(*)::text AS count FROM brand_guidelines WHERE user_id = ?',
    [userId],
  );
  if (Number(row?.count ?? 0) > 0) return;

  const guideline = DUPOIN_DEFAULT_BRAND_GUIDELINE;
  await db.execute(
    `INSERT INTO brand_guidelines (id, user_id, brand_name, tone_of_voice, target_market, key_messages, do_list, dont_list, examples)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      userId,
      guideline.brand_name,
      guideline.tone_of_voice,
      guideline.target_market,
      guideline.key_messages,
      JSON.stringify(guideline.do_list),
      JSON.stringify(guideline.dont_list),
      guideline.examples,
    ],
  );
}
