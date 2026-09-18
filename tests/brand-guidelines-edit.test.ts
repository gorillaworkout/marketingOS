import test from 'node:test';
import assert from 'assert/strict';
import { readFile } from 'node:fs/promises';

test('brand guideline edits send the row id in the JSON body that PUT requires', async () => {
  const page = await readFile('src/app/dashboard/brand-guidelines/page.tsx', 'utf8');
  const api = await readFile('src/app/api/brand-guidelines/route.ts', 'utf8');

  assert.match(page, /editing \? \{ id: editing\.id \}/);
  assert.doesNotMatch(page, /\/api\/brand-guidelines\?id=\$\{editing\.id\}/);
  assert.match(api, /const \{ id, brand_name/);
  assert.match(api, /if \(!id\) return NextResponse\.json\(\{ error: 'Guideline ID is required'/);
});
