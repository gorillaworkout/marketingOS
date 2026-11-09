import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { HISTORY_KINDS } from '../src/lib/monthly-report/upload-history';
import { SETTLEMENT_UPLOAD_KINDS } from '../src/lib/settlement/detect';

test('settlement page is its own route and uses the shared composition', async () => {
  const page = await readFile('src/app/dashboard/settlement-report/page.tsx', 'utf8');
  assert.match(page, /PageHeader/);
  assert.match(page, /PageStack/);
  assert.match(page, /SettlementHome/);
  assert.doesNotMatch(page, /coming soon/i);
  const home = await readFile('src/components/settlement/SettlementHome.tsx', 'utf8');
  assert.match(home, /SettlementUploadPanel/);
  assert.match(home, /Upload history/);
  assert.match(home, /\/api\/settlement-report\/uploads/);
  const tabs = await readFile('src/components/monthly-report/ReportTabs.tsx', 'utf8');
  assert.doesNotMatch(tabs, /Settlement/);
  const layout = await readFile('src/app/dashboard/layout.tsx', 'utf8');
  assert.match(layout, /label: 'Onboarding Report'/);
  assert.match(layout, /href: '\/dashboard\/settlement-report', label: 'Settlement Report'/);
  const redirect = await readFile('src/app/dashboard/monthly-report/settlement/page.tsx', 'utf8');
  assert.match(redirect, /redirect\('\/dashboard\/settlement-report'\)/);
});

test('every settlement upload kind is a history kind with an Uploads-tab label', async () => {
  for (const kind of SETTLEMENT_UPLOAD_KINDS) assert.ok((HISTORY_KINDS as readonly string[]).includes(kind), kind);
  const uploads = await readFile('src/app/dashboard/monthly-report/uploads/page.tsx', 'utf8');
  for (const kind of SETTLEMENT_UPLOAD_KINDS) assert.match(uploads, new RegExp(`${kind}: '`));
});
