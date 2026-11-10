import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { HISTORY_KINDS } from '../src/lib/monthly-report/upload-history';
import { SETTLEMENT_UPLOAD_KINDS } from '../src/lib/settlement/detect';

test('settlement report page composes the report view and has no access tab', async () => {
  const page = await readFile('src/app/dashboard/settlement-report/page.tsx', 'utf8');
  assert.match(page, /SettlementWorkspace/);
  assert.doesNotMatch(page, /coming soon/i);
  const workspace = await readFile('src/components/settlement/SettlementWorkspace.tsx', 'utf8');
  assert.match(workspace, /PageHeader/);
  assert.match(workspace, /PageStack/);
  assert.match(workspace, /SettlementDashboard/);
  assert.match(workspace, /SettlementReportView|SettlementDashboard/);
  assert.doesNotMatch(workspace, /SettlementHome/);
  assert.doesNotMatch(workspace, /Access/);
  const nav = await readFile('src/components/settlement/SettlementNav.tsx', 'utf8');
  assert.match(nav, /Report/);
  assert.match(nav, /Data sources/);
  assert.doesNotMatch(nav, /Access/);
  const data = await readFile('src/app/dashboard/settlement-report/data/page.tsx', 'utf8');
  assert.match(data, /SettlementDataSources/);
  const sources = await readFile('src/components/settlement/SettlementDataSources.tsx', 'utf8');
  assert.match(sources, /Upload history/);
  assert.match(sources, /\/api\/settlement-report\/uploads/);
  const printPage = await readFile('src/app/dashboard/settlement-report/print/page.tsx', 'utf8');
  assert.match(printPage, /noprint/);
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
