import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { requiresAdminApiAccess } from '../src/lib/admin-api-access';
import {
  defaultSocialPostBrandGuidelineId,
  readSocialPostBrandGuidelines,
  socialPostGenerateRequestBody,
} from '../src/lib/social-post-brand-guideline';

const page = readFileSync(path.join(process.cwd(), 'src/app/dashboard/social-post/page.tsx'), 'utf8');
const auth = readFileSync(path.join(process.cwd(), 'src/lib/auth.ts'), 'utf8');

test('default guideline prefers Dupoin Futures, otherwise the first row, otherwise none', () => {
  assert.equal(defaultSocialPostBrandGuidelineId([]), '');
  assert.equal(
    defaultSocialPostBrandGuidelineId([
      { id: 'custom', brand_name: 'Custom Brand' },
      { id: 'other', brand_name: 'Other' },
    ]),
    'custom',
  );
  assert.equal(
    defaultSocialPostBrandGuidelineId([
      { id: 'custom', brand_name: 'Custom Brand' },
      { id: 'dupoin', brand_name: 'Dupoin Futures' },
    ]),
    'dupoin',
  );
  assert.equal(
    defaultSocialPostBrandGuidelineId([{ id: 'dupoin', brand_name: '  DUPOIN FUTURES  ' }]),
    'dupoin',
  );
});

test('brand guideline list reader keeps id and brand name in API order', () => {
  assert.deepEqual(readSocialPostBrandGuidelines(null), []);
  assert.deepEqual(readSocialPostBrandGuidelines({ guidelines: 'nope' }), []);
  assert.deepEqual(
    readSocialPostBrandGuidelines({
      guidelines: [
        { id: 'dupoin', brand_name: 'Dupoin Futures', tone_of_voice: 'Calm' },
        { id: '', brand_name: 'Missing id' },
        { id: 'named', brand_name: '   ' },
        { brand_name: 'No id' },
        { id: 'custom', brand_name: 'Custom Brand' },
      ],
    }),
    [
      { id: 'dupoin', brand_name: 'Dupoin Futures' },
      { id: 'custom', brand_name: 'Custom Brand' },
    ],
  );
});

test('generate body includes brandGuidelineId only when one is selected', () => {
  const fields = {
    brief: 'Gold outlook',
    platform: 'Instagram',
    targetAudience: 'Beginner trader',
    goal: 'Awareness',
  };
  assert.deepEqual(socialPostGenerateRequestBody({ ...fields, brandGuidelineId: 'dupoin' }), {
    ...fields,
    brandGuidelineId: 'dupoin',
  });
  assert.deepEqual(socialPostGenerateRequestBody({ ...fields, brandGuidelineId: '  dupoin  ' }), {
    ...fields,
    brandGuidelineId: 'dupoin',
  });
  for (const brandGuidelineId of ['', '   ', null, undefined] as const) {
    assert.deepEqual(socialPostGenerateRequestBody({ ...fields, brandGuidelineId }), fields);
    assert.equal('brandGuidelineId' in socialPostGenerateRequestBody({ ...fields, brandGuidelineId }), false);
  }
});

test('signed-in users may list their own guidelines; writes stay admin-only', () => {
  assert.equal(requiresAdminApiAccess('/api/brand-guidelines', 'GET'), false);
  assert.equal(requiresAdminApiAccess('/api/brand-guidelines', 'get'), false);
  assert.equal(requiresAdminApiAccess('/api/brand-guidelines', 'POST'), true);
  assert.equal(requiresAdminApiAccess('/api/brand-guidelines', 'PUT'), true);
  assert.equal(requiresAdminApiAccess('/api/brand-guidelines', 'DELETE'), true);
  assert.equal(requiresAdminApiAccess('/api/knowledge/save', 'POST'), false);
  assert.equal(requiresAdminApiAccess('/api/knowledge', 'GET'), true);
  assert.equal(requiresAdminApiAccess('/api/admin/users', 'GET'), true);
  assert.equal(requiresAdminApiAccess('/api/social-post/generate', 'POST'), false);
  assert.match(auth, /requiresAdminApiAccess\(pathname, request\.method\)/);
});

test('Social Post page offers a Brand guideline picker and sends the selected id', () => {
  assert.match(page, /Brand guideline/);
  assert.match(page, /data-testid="social-post-brand-guideline"/);
  assert.match(page, />None</);
  assert.match(page, /fetch\('\/api\/brand-guidelines'\)/);
  assert.match(page, /defaultSocialPostBrandGuidelineId/);
  assert.match(page, /readSocialPostBrandGuidelines/);
  assert.match(page, /socialPostGenerateRequestBody\(\{/);
  assert.match(page, /brandGuidelineId/);
  assert.match(page, /applyDupoinImagePromptLocks/);

  const imageStart = page.indexOf('const generateImage');
  const imageBody = page.slice(imageStart, page.indexOf("fetch('/api/generate-image'", imageStart));
  assert.doesNotMatch(imageBody, /brandGuidelineId/);
  assert.match(page, /aspectRatio: imageAspectRatio, includeSwipeLeft, dupoinAcademy \}/);
});
