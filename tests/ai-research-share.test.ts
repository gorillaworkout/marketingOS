import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AI_RESEARCH_SHARE_TTL_MS,
  isShareTokenShape,
  matchShareSnapshot,
  researchSharePath,
  shareExpiryFromNow,
  signResearchShareToken,
  verifyResearchShareToken,
} from '../src/lib/ai-research-share';

const read = (path: string) => readFileSync(path, 'utf8');
const SECRET = 'wave6-share-test-secret';
const ID = '11111111-1111-4111-8111-111111111111';
const NOW = 1_700_000_000_000;

test('share tokens are signed, reject tampering, and expire', () => {
  const exp = shareExpiryFromNow(NOW);
  assert.equal(exp - NOW, AI_RESEARCH_SHARE_TTL_MS);
  assert.equal(AI_RESEARCH_SHARE_TTL_MS, 30 * 24 * 60 * 60 * 1000);

  const token = signResearchShareToken({ id: ID, exp }, SECRET, NOW);
  assert.equal(verifyResearchShareToken(token, SECRET, NOW + 1_000)?.id, ID);
  assert.equal(verifyResearchShareToken(token, SECRET, exp)?.id, undefined);
  assert.equal(verifyResearchShareToken(token, 'other-secret', NOW), null);
  assert.equal(verifyResearchShareToken('v1~not-json~abcd', SECRET, NOW), null);
  assert.equal(verifyResearchShareToken('', SECRET, NOW), null);
  assert.equal(isShareTokenShape('not-a-token'), false);
  assert.equal(isShareTokenShape(token), true);

  const [version, payload, sig] = token.split('~');
  const flipped = `${payload.slice(0, -1)}${payload.endsWith('a') ? 'b' : 'a'}`;
  assert.equal(verifyResearchShareToken(`${version}~${flipped}~${sig}`, SECRET, NOW), null);
  assert.match(researchSharePath(token), new RegExp(`^/share/ai-research/${version}~`));
  assert.throws(() => signResearchShareToken({ id: 'nope', exp }, SECRET, NOW), /ID tidak valid/);
});

test('a share snapshot must match a stored assistant answer', () => {
  const messages = [
    { role: 'user', content: 'Apa yang menggerakkan harga emas?' },
    {
      role: 'assistant',
      content: 'Harga emas bergerak mengikuti dolar dan imbal hasil.\n\nSumber menyebut Fed.',
      sources: [
        { title: 'Reuters', url: 'https://www.reuters.com/markets/gold' },
        { title: 'bad', url: 'javascript:alert(1)' },
      ],
    },
  ];
  const snapshot = matchShareSnapshot(messages, 'Harga emas bergerak mengikuti dolar dan imbal hasil. Sumber menyebut Fed.');
  assert.equal(snapshot?.query, 'Apa yang menggerakkan harga emas?');
  assert.match(snapshot?.answer || '', /Sumber menyebut Fed/);
  assert.deepEqual(snapshot?.sources, [{ title: 'Reuters', url: 'https://www.reuters.com/markets/gold' }]);
  assert.equal(matchShareSnapshot(messages, 'Jawaban yang tidak pernah disimpan di thread ini.'), null);
  assert.equal(matchShareSnapshot(messages, '   '), null);
});

test('share route is authenticated and the public page is read-only', () => {
  const route = read('src/app/api/ai-research/share/route.ts');
  const page = read('src/app/share/ai-research/[token]/page.tsx');
  const migration = read('db/migrations/018_ai_research_shares.sql');
  assert.match(route, /requireFeature\(request, 'ai-research'\)/);
  assert.match(route, /matchShareSnapshot/);
  assert.match(route, /ai_research_shares/);
  assert.doesNotMatch(route, /user_id: auth\.id/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_research_shares/);
  assert.match(migration, /expires_at TIMESTAMPTZ NOT NULL/);
  assert.match(page, /loadPublicResearchShare/);
  assert.match(page, /await connection\(\)/);
  assert.doesNotMatch(page, /AiResearchPinFact|AiResearchWatchPanel|<textarea|Bagikan|Kirim ke Social Post/);
  assert.match(page, /data-testid="ai-research-share-view"/);
  assert.match(read('.env.example'), /AI_RESEARCH_SHARE_SECRET/);
});
