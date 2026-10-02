import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DUPOIN_DEFAULT_BRAND_GUIDELINE,
  ensureDefaultBrandGuideline,
  type BrandGuidelineDb,
} from '../src/lib/dupoin-default-brand-guideline';

type Row = {
  id: string;
  user_id: string;
  brand_name: string;
  tone_of_voice: string;
  target_market: string;
  key_messages: string;
  do_list: string;
  dont_list: string;
  examples: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function memoryDb(initial: Row[] = []): BrandGuidelineDb & { rows: Row[] } {
  const rows = initial.map(row => ({ ...row }));
  const db: BrandGuidelineDb & { rows: Row[] } = {
    rows,
    async queryOne(sql, values = []) {
      assert.match(sql, /SELECT COUNT\(\*\)::text AS count FROM brand_guidelines WHERE user_id = \?/);
      const userId = String(values[0]);
      return { count: String(rows.filter(row => row.user_id === userId).length) };
    },
    async execute(sql, values = []) {
      assert.match(sql, /INSERT INTO brand_guidelines/);
      rows.push({
        id: String(values[0]),
        user_id: String(values[1]),
        brand_name: String(values[2]),
        tone_of_voice: String(values[3]),
        target_market: String(values[4]),
        key_messages: String(values[5]),
        do_list: String(values[6]),
        dont_list: String(values[7]),
        examples: String(values[8]),
      });
      return 1;
    },
  };
  return db;
}

test('empty user gets the Dupoin guideline once', async () => {
  const db = memoryDb();
  await ensureDefaultBrandGuideline('user-empty', db);
  await ensureDefaultBrandGuideline('user-empty', db);

  assert.equal(db.rows.length, 1);
  const row = db.rows[0];
  assert.equal(row.user_id, 'user-empty');
  assert.match(row.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(row.brand_name, 'Dupoin Futures');
  assert.equal(row.tone_of_voice, DUPOIN_DEFAULT_BRAND_GUIDELINE.tone_of_voice);
  assert.equal(row.target_market, DUPOIN_DEFAULT_BRAND_GUIDELINE.target_market);
  assert.equal(row.key_messages, DUPOIN_DEFAULT_BRAND_GUIDELINE.key_messages);
  assert.equal(row.examples, DUPOIN_DEFAULT_BRAND_GUIDELINE.examples);
  assert.deepEqual(JSON.parse(row.do_list), [...DUPOIN_DEFAULT_BRAND_GUIDELINE.do_list]);
  assert.deepEqual(JSON.parse(row.dont_list), [...DUPOIN_DEFAULT_BRAND_GUIDELINE.dont_list]);
});

test('user who already has a guideline is left untouched', async () => {
  const existing: Row = {
    id: 'existing-id',
    user_id: 'user-has',
    brand_name: 'Custom Brand',
    tone_of_voice: 'Casual',
    target_market: 'Local',
    key_messages: 'Hello',
    do_list: '[]',
    dont_list: '[]',
    examples: 'Old example',
  };
  const db = memoryDb([existing]);
  await ensureDefaultBrandGuideline('user-has', db);
  assert.equal(db.rows.length, 1);
  assert.deepEqual(db.rows[0], existing);
});

test('migration inserts the same default only where a user has zero guidelines', async () => {
  const sql = await readFile('db/migrations/023_seed_dupoin_default_brand_guideline.sql', 'utf8');
  const guideline = DUPOIN_DEFAULT_BRAND_GUIDELINE;
  assert.match(sql, /INSERT INTO brand_guidelines/i);
  assert.match(sql, /WHERE NOT EXISTS \(/);
  assert.match(sql, /SELECT 1 FROM brand_guidelines bg WHERE bg\.user_id = u\.id/);
  assert.match(sql, new RegExp(escapeRegExp(guideline.brand_name)));
  assert.match(sql, new RegExp(escapeRegExp(guideline.tone_of_voice)));
  assert.match(sql, new RegExp(escapeRegExp(guideline.target_market)));
  assert.match(sql, new RegExp(escapeRegExp(guideline.key_messages)));
  assert.match(sql, new RegExp(escapeRegExp(guideline.examples)));
  assert.match(sql, new RegExp(escapeRegExp(JSON.stringify(guideline.do_list))));
  assert.match(sql, new RegExp(escapeRegExp(JSON.stringify(guideline.dont_list))));
  assert.doesNotMatch(sql, /DELETE FROM|UPDATE brand_guidelines/i);
});

test('GET /api/brand-guidelines ensures the default before listing', async () => {
  const api = await readFile('src/app/api/brand-guidelines/route.ts', 'utf8');
  const getFn = api.slice(api.indexOf('export async function GET'), api.indexOf('export async function POST'));
  const ensureAt = getFn.indexOf('ensureDefaultBrandGuideline(userId)');
  const selectAt = getFn.indexOf('SELECT id, brand_name');
  assert.ok(ensureAt >= 0, 'GET should call ensureDefaultBrandGuideline(userId)');
  assert.ok(selectAt > ensureAt, 'ensure should run before the list query');
});
