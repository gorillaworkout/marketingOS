import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { competitorIdFromSearch, competitorPageUrl, COMPETITOR_PARAM } from '../src/lib/partnership/competitor-param';

const page = readFileSync('src/app/dashboard/partnership/competitor-intelligence/page.tsx', 'utf8');
const modal = readFileSync('src/components/ui/ModalDialog.tsx', 'utf8');

test('competitor query param: read, set, and strip while keeping other params', () => {
  assert.equal(COMPETITOR_PARAM, 'competitor');
  assert.equal(competitorIdFromSearch(''), '');
  assert.equal(competitorIdFromSearch('?foo=1'), '');
  assert.equal(competitorIdFromSearch('?competitor=abc&x=1'), 'abc');
  assert.equal(competitorIdFromSearch('competitor=%20mifx%20'), 'mifx');
  assert.equal(competitorIdFromSearch(new URLSearchParams('competitor=xtb')), 'xtb');
  assert.equal(
    competitorPageUrl('/dashboard/partnership/competitor-intelligence', '', 'mifx'),
    '/dashboard/partnership/competitor-intelligence?competitor=mifx',
  );
  assert.equal(
    competitorPageUrl('/dashboard/partnership/competitor-intelligence', '?tab=1', 'mifx'),
    '/dashboard/partnership/competitor-intelligence?tab=1&competitor=mifx',
  );
  assert.equal(
    competitorPageUrl('/dashboard/partnership/competitor-intelligence', '?competitor=old&tab=1', null),
    '/dashboard/partnership/competitor-intelligence?tab=1',
  );
  assert.equal(
    competitorPageUrl('/dashboard/partnership/competitor-intelligence', '?competitor=old', ''),
    '/dashboard/partnership/competitor-intelligence',
  );
});

test('page: Open and the competitor name open a deep-linkable detail dialog', () => {
  assert.match(page, /competitorIdFromSearch\(searchParams\)/);
  assert.match(page, /router\.push\(competitorPageUrl\(pathname, searchParams, id\)/);
  assert.match(page, /<Button size="sm" aria-haspopup="dialog" onClick=\{\(\) => select\(competitor\.id\)\}>Open<\/Button>/);
  assert.match(page, /aria-haspopup="dialog" onClick=\{\(\) => select\(competitor\.id\)\}>\{competitor\.name\}/);
  assert.match(page, /testId="competitor-detail"/);
  assert.match(page, /onClose=\{\(\) => closeDetail\(\)\}/);
  const opportunities = page.indexOf('title="Opportunities for Dupoin"');
  const dialog = page.indexOf('testId="competitor-detail"');
  assert.ok(opportunities > 0 && dialog > opportunities, 'detail dialog should follow the page lists, not sit inline as a hidden section');
});

test('page: Refresh toolbar stays on the page, not inside the dialog', () => {
  const toolbar = page.indexOf('<RefreshToolbar');
  const comparison = page.indexOf('title="Comparison"');
  const dialog = page.indexOf('testId="competitor-detail"');
  assert.ok(toolbar > 0 && toolbar < comparison && comparison < dialog);
  assert.match(page, /pickForRefresh[\s\S]*closeDetail\('replace'\)/);
  assert.match(page, /const findSocial[\s\S]*closeDetail\('replace'\)/);
  assert.match(page, /data-testid="find-social"/);
  assert.match(page, /data-testid="report-mode"/);
  assert.match(page, /title="Instagram and other evidence"/);
  assert.match(page, /title="Refresh history"/);
  assert.match(page, /Cancel edit/);
});

test('page: X, Escape, backdrop, and the back button close the dialog', () => {
  assert.match(page, /if \(canBack\) router\.back\(\)/);
  assert.match(page, /router\.replace\(next, \{ scroll: false \}\)/);
  assert.match(modal, /event\.key === 'Escape'/);
  assert.match(modal, /data-testid=\{`\$\{testId\}-backdrop`\}/);
  assert.match(modal, /data-testid=\{`\$\{testId\}-close`\}/);
  assert.match(modal, /aria-label="Close"/);
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(modal, /event\.key !== 'Tab'/);
  assert.match(modal, /flex h-full w-full max-w-full flex-col/);
  assert.match(modal, /md:h-auto md:max-h-\[min\(56rem,calc\(100vh-2rem\)\)\] md:max-w-5xl/);
  assert.match(modal, /overflow-y-auto/);
});
