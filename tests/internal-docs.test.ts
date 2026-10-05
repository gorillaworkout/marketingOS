import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  allowedAccessLevels,
  canManageInternalDocs,
  canReadItOnlyInternalDocs,
  isInternalDocVisible,
} from '../src/lib/internal-docs-acl';
import { getEmbedding } from '../src/lib/embeddings';
import { normalizeInspectorSource } from '../src/lib/ai-research-inspector';
import {
  buildInternalDocChunkQuery,
  buildInternalDocsListQuery,
  chunkDocumentText,
  citationsFromHits,
  formatInternalDocsPrompt,
  INTERNAL_DOCS_LOW_CONFIDENCE_ANSWER,
  INTERNAL_DOCS_NO_MATCH_ANSWER,
  internalDocsAskFallback,
  internalDocsRetrievalConfidence,
  mergeInternalDocSources,
  presentInternalDocsAnswer,
  rankInternalDocChunks,
  type InternalDocChunkRow,
  type InternalDocHit,
} from '../src/lib/internal-docs';
import { extractPlainText } from '../src/lib/internal-docs-extract';
import { internalDocKnowledgePayload } from '../src/lib/internal-docs-knowledge';
import { internalDocKind, resolveStoredInternalDoc, titleFromFilename } from '../src/lib/internal-docs-storage';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

const company = { role: 'member', departmentName: 'Marketing' };
const itMember = { role: 'member', departmentName: 'IT' };
const admin = { role: 'admin', departmentName: null };
const settlement = { role: 'member', departmentName: 'Settlement' };

test('IT department members and admins can read IT-only docs; other employees cannot', () => {
  assert.equal(canReadItOnlyInternalDocs(company), false);
  assert.equal(canReadItOnlyInternalDocs(settlement), false);
  assert.equal(canReadItOnlyInternalDocs({ role: 'member', departmentName: null }), false);
  assert.equal(canReadItOnlyInternalDocs(itMember), true);
  assert.equal(canReadItOnlyInternalDocs({ role: 'member', departmentName: ' it ' }), true);
  assert.equal(canReadItOnlyInternalDocs(admin), true);
  assert.equal(canManageInternalDocs(itMember), false);
  assert.equal(canManageInternalDocs({ role: 'member', departmentName: ' it ' }), false);
  assert.equal(canManageInternalDocs(company), false);
  assert.equal(canManageInternalDocs(admin), true);
  assert.deepEqual(allowedAccessLevels(company), ['company']);
  assert.deepEqual(allowedAccessLevels(itMember), ['company', 'it-only']);
  assert.equal(isInternalDocVisible('it-only', company), false);
  assert.equal(isInternalDocVisible('it-only', admin), true);
  assert.equal(isInternalDocVisible('company', company), true);
  assert.equal(isInternalDocVisible('secret', admin), false);
});

test('list and chunk queries always bind the caller access levels and stay off the knowledge graph', () => {
  const list = buildInternalDocsListQuery({ accessLevels: allowedAccessLevels(company), includeUnindexed: false, search: 'vpn_setup' });
  assert.match(list.sql, /FROM internal_documents/);
  assert.match(list.sql, /access_level = ANY\(\?::text\[\]\)/);
  assert.doesNotMatch(list.sql, /knowledge_entries/);
  assert.deepEqual(list.params[2], ['company']);
  assert.equal(list.params[3], false);
  assert.equal(list.params[5], '%vpn\\_setup%');

  const itList = buildInternalDocsListQuery({ accessLevels: allowedAccessLevels(itMember), includeUnindexed: true, search: '' });
  assert.deepEqual(itList.params[2], ['company', 'it-only']);

  const chunks = buildInternalDocChunkQuery();
  assert.match(chunks.sql, /FROM internal_document_chunks/);
  assert.match(chunks.sql, /JOIN internal_documents/);
  assert.match(chunks.sql, /access_level = ANY\(\?::text\[\]\)/);
  assert.match(chunks.sql, /status = 'indexed'/);
  assert.doesNotMatch(chunks.sql, /knowledge_entries/);
});

test('ranking drops IT-only chunks for a company employee even if they were loaded', async () => {
  const query = 'badge printer password reset';
  const embedding = await getEmbedding(query);
  const companyChunk: InternalDocChunkRow = {
    chunk_id: 'c1',
    document_id: 'doc-company',
    title: 'Office badge printer',
    access_level: 'company',
    content: 'The badge printer password reset code is stored with reception.',
    embedding: JSON.stringify(await getEmbedding('badge printer password reset reception')),
  };
  const secretChunk: InternalDocChunkRow = {
    chunk_id: 'c2',
    document_id: 'doc-it',
    title: 'IT root credentials',
    access_level: 'it-only',
    content: 'badge printer password reset root key is only for IT.',
    embedding: JSON.stringify(await getEmbedding('badge printer password reset root key IT')),
  };

  const companyHits = rankInternalDocChunks(query, embedding, [secretChunk, companyChunk], company, 5);
  assert.deepEqual(companyHits.map(hit => hit.documentId), ['doc-company']);
  assert.equal(companyHits.some(hit => /root credentials|IT-only|root key/i.test(`${hit.title} ${hit.excerpt}`)), false);

  const itHits = rankInternalDocChunks(query, embedding, [secretChunk, companyChunk], itMember, 5);
  assert.ok(itHits.some(hit => hit.documentId === 'doc-it'));
  assert.ok(itHits.some(hit => hit.documentId === 'doc-company'));
});

test('auditorium LED questions prefer the auditorium guide over LED running text', async () => {
  const queryVector = [1, 0];
  const ledHeavy = JSON.stringify(queryVector);
  const unrelated = JSON.stringify([0, 0]);
  const chunks: InternalDocChunkRow[] = [
    {
      chunk_id: 'run',
      document_id: 'doc-running',
      title: 'Cara menyalakan LED running text',
      access_level: 'company',
      content: 'Cara menyalakan LED running text di lobi. Hidupkan saklar LED running text, buka LED Studio, pilih program running text, lalu klik Send. The LED running text power switch is under reception. Restart the LED running text if the scroll freezes.',
      embedding: ledHeavy,
    },
    {
      chunk_id: 'hall',
      document_id: 'doc-hallway',
      title: 'Cara menyalakan LED sign',
      access_level: 'company',
      content: 'Cara menyalakan LED sign di lorong. The hallway LED sign shows the company name. Hidupkan saklar LED. Cara menyalakan LED sign ini berbeda dari layar video.',
      embedding: ledHeavy,
    },
    {
      chunk_id: 'clock',
      document_id: 'doc-clock',
      title: 'Cara menyalakan LED clock',
      access_level: 'company',
      content: 'Cara menyalakan LED clock di ruang rapat. The meeting room LED clock shows hours and minutes. Replace the LED clock battery yearly.',
      embedding: ledHeavy,
    },
    {
      chunk_id: 'aud',
      document_id: 'doc-auditorium',
      title: 'Auditorium LED power on',
      access_level: 'company',
      content: 'Power on the auditorium LED wall from the control room. Switch on the breaker labeled Auditorium LED, wait for a steady green status, then press Power on the controller. The auditorium LED wall should show the standby image. Shut down by pressing Power and waiting for the fans to stop. Do not use the lobby display controls for this screen.',
      embedding: unrelated,
    },
    {
      chunk_id: 'installed',
      document_id: 'doc-installed',
      title: 'Display maintenance',
      access_level: 'company',
      content: 'The panel was installed and scheduled. Controllers were enabled after the visit.',
      embedding: ledHeavy,
    },
    {
      chunk_id: 'it-aud',
      document_id: 'doc-it-auditorium',
      title: 'IT auditorium LED controller password',
      access_level: 'it-only',
      content: 'The auditorium LED controller root password is for IT only. Reset that auditorium LED password from the rack.',
      embedding: unrelated,
    },
  ];

  const expectAuditorium = (query: string) => {
    const hits = rankInternalDocChunks(query, queryVector, chunks, company, 6);
    assert.equal(hits[0]?.documentId, 'doc-auditorium', query);
    assert.equal(hits.some(hit => hit.documentId === 'doc-running'), false, query);
    assert.equal(hits.some(hit => hit.documentId === 'doc-installed'), false, query);
    assert.equal(hits.some(hit => hit.documentId === 'doc-it-auditorium'), false, query);
    assert.match(`${hits[0].title} ${hits[0].excerpt}`, /auditorium/i);
    const prompt = formatInternalDocsPrompt(hits, 'https://marketing.example');
    assert.match(prompt, /Auditorium LED power on/);
    assert.doesNotMatch(prompt, /running text/i);
    const citations = citationsFromHits(hits, 'https://marketing.example');
    assert.equal(citations[0]?.title, 'Auditorium LED power on');
    assert.match(citations[0].url, /\/dashboard\/internal-docs\/doc-auditorium$/);
  };

  expectAuditorium('cara menyalakan LED auditorium');
  expectAuditorium('how to turn on the auditorium LED');
  expectAuditorium('how do I power on the auditorium LED');

  const runningHits = rankInternalDocChunks('update the LED running text', queryVector, chunks, company, 6);
  assert.equal(runningHits[0]?.documentId, 'doc-running');
  assert.equal(runningHits.some(hit => hit.documentId === 'doc-auditorium'), false);

  const ledHits = rankInternalDocChunks('LED', queryVector, chunks, company, 6);
  assert.ok(ledHits.some(hit => hit.documentId === 'doc-running'));
  assert.equal(ledHits.some(hit => hit.documentId === 'doc-it-auditorium'), false);

  const itHits = rankInternalDocChunks('cara menyalakan LED auditorium', queryVector, chunks, itMember, 6);
  assert.ok(itHits.some(hit => hit.documentId === 'doc-auditorium'));
  assert.ok(itHits.some(hit => hit.documentId === 'doc-it-auditorium'));
  assert.equal(itHits.some(hit => hit.documentId === 'doc-running'), false);

  const embeddedQuery = 'cara menyalakan LED auditorium';
  const embedded = await Promise.all(chunks.map(async chunk => ({
    ...chunk,
    embedding: JSON.stringify(await getEmbedding(`${chunk.title}\n${chunk.content}`)),
  })));
  const embeddedHits = rankInternalDocChunks(embeddedQuery, await getEmbedding(embeddedQuery), embedded, company, 6);
  assert.equal(embeddedHits[0]?.documentId, 'doc-auditorium');
  assert.equal(embeddedHits.some(hit => hit.documentId === 'doc-running'), false);
});

test('LED Auditorium stays the confident source when Running Text shares the word LED', async () => {
  const queryVector = [1, 0];
  const ledHeavy = JSON.stringify(queryVector);
  const orthogonal = JSON.stringify([0, 1]);
  const running = (index: number): InternalDocChunkRow => ({
    chunk_id: `run-${index}`,
    document_id: 'doc-running',
    title: 'LED Running Text',
    access_level: 'company',
    content: `${'LED running text scroll. '.repeat(8)}The LED running text is not used in the auditorium lobby. Restart the LED running text if the scroll freezes.`,
    embedding: ledHeavy,
  });
  const auditorium = (index: number): InternalDocChunkRow => ({
    chunk_id: `aud-${index}`,
    document_id: 'doc-auditorium',
    title: 'LED Auditorium',
    access_level: 'company',
    content: 'Power on the LED Auditorium wall from the control room. Switch on the breaker labeled LED Auditorium, wait for a steady green status, then press Power on the controller. The LED Auditorium wall should show the standby image.',
    embedding: orthogonal,
  });
  const chunks = [
    ...Array.from({ length: 24 }, (_, index) => running(index)),
    ...Array.from({ length: 4 }, (_, index) => auditorium(index)),
  ];

  const expectAuditorium = (query: string) => {
    const hits = rankInternalDocChunks(query, queryVector, chunks, company, 6);
    assert.equal(hits[0]?.documentId, 'doc-auditorium', query);
    assert.equal(hits[0]?.subjectMatched, true, query);
    assert.equal(hits.every(hit => hit.documentId === 'doc-auditorium'), true, query);
    assert.equal(internalDocsRetrievalConfidence(query, hits), 'high', query);
    assert.equal(internalDocsAskFallback(query, hits), null, query);
    const prompt = formatInternalDocsPrompt(hits, 'https://marketing.example');
    assert.match(prompt, /LED Auditorium/);
    assert.doesNotMatch(prompt, /Running Text/i);
    const citations = citationsFromHits(hits, 'https://marketing.example');
    assert.equal(citations.length, 1);
    assert.equal(citations[0]?.title, 'LED Auditorium');
    assert.match(citations[0]?.excerpt || '', /LED Auditorium/);
  };

  expectAuditorium('LED Auditorium');
  expectAuditorium('how do I use the LED auditorium');

  const runningOnly = rankInternalDocChunks('LED Auditorium', queryVector, chunks.filter(chunk => chunk.document_id === 'doc-running'), company, 6);
  assert.equal(runningOnly[0]?.documentId, 'doc-running');
  assert.equal(runningOnly[0]?.subjectMatched, false);
  assert.equal(internalDocsRetrievalConfidence('LED Auditorium', runningOnly), 'low');
  const fallback = internalDocsAskFallback('LED Auditorium', runningOnly);
  assert.equal(fallback?.confidence, 'low');
  assert.equal(fallback?.answer, INTERNAL_DOCS_LOW_CONFIDENCE_ANSWER);
  assert.doesNotMatch(fallback?.answer || '', /Running Text|auditorium wall/i);

  const short = presentInternalDocsAnswer('See the picture.', [
    {
      documentId: 'doc-auditorium',
      title: 'LED Auditorium',
      accessLevel: 'company',
      chunkId: 'aud-0',
      excerpt: 'Power on the LED Auditorium wall from the control room. Switch on the breaker labeled LED Auditorium.',
      score: 3,
      subjectMatched: true,
    },
    {
      documentId: 'doc-running',
      title: 'LED Running Text',
      accessLevel: 'company',
      chunkId: 'run-0',
      excerpt: 'Restart the LED running text if the scroll freezes.',
      score: 1,
      subjectMatched: false,
    },
  ]);
  assert.match(short, /Power on the LED Auditorium wall/);
  assert.doesNotMatch(short, /running text/i);
  const longAnswer = `${'Switch on the auditorium breaker and wait for green. '.repeat(6)}Then press Power.`;
  assert.equal(presentInternalDocsAnswer(longAnswer, [{
    documentId: 'doc-auditorium',
    title: 'LED Auditorium',
    accessLevel: 'company',
    chunkId: 'aud-0',
    excerpt: 'Power on the LED Auditorium wall from the control room.',
    score: 3,
  }]), longAnswer.trim());
});

test('Lark password questions prefer the Lark guide over auditorium docs that only share a word', async () => {
  const queryVector = [1, 0, 0];
  const dominant = JSON.stringify(queryVector);
  const larkVector = JSON.stringify([0, 1, 0]);
  const fillers: InternalDocChunkRow[] = Array.from({ length: 8 }, (_, index) => ({
    chunk_id: `lark-note-${index}`,
    document_id: `doc-lark-note-${index}`,
    title: 'Lark standup notes',
    access_level: 'company',
    content: 'The team posted the daily update on Lark. Follow up in the Lark group after the standup.',
    embedding: dominant,
  }));
  const chunks: InternalDocChunkRow[] = [
    ...fillers,
    {
      chunk_id: 'aud',
      document_id: 'doc-auditorium',
      title: 'Auditorium LED password change',
      access_level: 'company',
      content: 'Change the auditorium LED controller password from the rack. Password change for the auditorium LED. Do not use the lobby display controls.',
      embedding: dominant,
    },
    {
      chunk_id: 'run',
      document_id: 'doc-running',
      title: 'LED running text',
      access_level: 'company',
      content: `${'Change the LED running text schedule. '.repeat(12)}The lobby LED does not use a password.`,
      embedding: dominant,
    },
    {
      chunk_id: 'lark',
      document_id: 'doc-lark',
      title: 'How to change your Lark password',
      access_level: 'company',
      content: `${'This handbook covers account security for everyday tools. '.repeat(30)}To change your Lark password, open Lark, choose Settings, then Account, and reset the Lark password. Confirm the new Lark password before you sign in again.`,
      embedding: larkVector,
    },
  ];

  const query = 'how to change Lark password';
  const hits = rankInternalDocChunks(query, queryVector, chunks, company, 6);
  assert.equal(hits[0]?.documentId, 'doc-lark');
  assert.equal(hits.some(hit => hit.documentId === 'doc-auditorium' && hits[0]?.documentId !== 'doc-lark'), false);
  assert.equal(internalDocsRetrievalConfidence(query, hits), 'high');
  assert.equal(internalDocsAskFallback(query, hits), null);
  const prompt = formatInternalDocsPrompt(hits, 'https://marketing.example');
  assert.match(prompt, /How to change your Lark password/);

  const weak = rankInternalDocChunks(query, queryVector, chunks.filter(chunk => chunk.document_id !== 'doc-lark'), company, 6);
  assert.notEqual(weak[0]?.documentId, 'doc-lark');
  assert.equal(internalDocsRetrievalConfidence(query, weak), 'low');
  const fallback = internalDocsAskFallback(query, weak);
  assert.equal(fallback?.confidence, 'low');
  assert.equal(fallback?.answer, INTERNAL_DOCS_LOW_CONFIDENCE_ANSWER);
  assert.match(fallback?.answer || '', /not contain a confident match/);
  assert.doesNotMatch(fallback?.answer || '', /auditorium/i);

  const resetHits = rankInternalDocChunks('how do I reset my Lark password?', queryVector, chunks, company, 6);
  assert.equal(resetHits[0]?.documentId, 'doc-lark');
  assert.equal(internalDocsRetrievalConfidence('how do I reset my Lark password?', resetHits), 'high');

  assert.equal(internalDocsAskFallback(query, [])?.confidence, 'none');
  assert.equal(internalDocsAskFallback(query, [])?.answer, INTERNAL_DOCS_NO_MATCH_ANSWER);
});

test('a laptop that will not turn on prefers the IT FAQ section over venue manuals that only mention a laptop', async () => {
  const queryVector = [1, 0];
  const laptopHeavy = JSON.stringify(queryVector);
  const orthogonal = JSON.stringify([0, 1]);
  const venue = (id: string, title: string, content: string): InternalDocChunkRow => ({
    chunk_id: id,
    document_id: id,
    title,
    access_level: 'company',
    content,
    embedding: laptopHeavy,
  });
  const faqLaptop = 'Company software catalog and printer names. '.repeat(8)
    + 'Laptop tidak menyala. If the laptop won\'t turn on or won\'t boot, connect the charger and hold the power button for ten seconds. '
    + 'A laptop that does not start still needs the charger light.';
  const chunks: InternalDocChunkRow[] = [
    venue(
      'doc-sound',
      'soundsystem Auditorium Area',
      'Connect the laptop HDMI output to the soundsystem in the Auditorium Area. The laptop HDMI cable is on the mixer. Select the laptop input on the soundsystem. The laptop plays audio through the auditorium soundsystem.',
    ),
    venue(
      'doc-running',
      'Running Text',
      'Connect a laptop to the LED running text controller. Open LED Studio on the laptop and send the running text program. The laptop USB port powers the running text dongle.',
    ),
    venue(
      'doc-led',
      'Manual Book LED Auditorium',
      'Connect the laptop to the LED processor with an HDMI cable. The laptop display mirrors to the auditorium LED wall. Press the laptop HDMI button on the switcher. The laptop should show the standby image on the LED Auditorium wall.',
    ),
    {
      chunk_id: 'faq-intro',
      document_id: 'doc-it-faq',
      title: 'FAQ IT Support',
      access_level: 'company',
      content: 'Visitor wifi password is printed at reception. The badge printer reset code is on the front panel.',
      embedding: orthogonal,
    },
    {
      chunk_id: 'faq-laptop',
      document_id: 'doc-it-faq',
      title: 'FAQ IT Support',
      access_level: 'company',
      content: faqLaptop,
      embedding: orthogonal,
    },
  ];

  const expectFaq = (query: string, section: RegExp) => {
    const hits = rankInternalDocChunks(query, queryVector, chunks, company, 6);
    assert.equal(hits[0]?.documentId, 'doc-it-faq', query);
    assert.equal(hits.every(hit => hit.documentId === 'doc-it-faq'), true, query);
    assert.equal(hits[0]?.chunkId, 'faq-laptop', query);
    assert.equal(internalDocsRetrievalConfidence(query, hits), 'high', query);
    assert.equal(internalDocsAskFallback(query, hits), null, query);
    assert.match(hits[0]?.excerpt || '', section);
    assert.doesNotMatch((hits[0]?.excerpt || '').slice(0, 90), /visitor wifi|HDMI|soundsystem|running text/i);
    const citations = citationsFromHits(hits, 'https://marketing.example');
    assert.equal(citations.length, 1);
    assert.equal(citations[0]?.title, 'FAQ IT Support');
  };

  expectFaq('laptop tidak bisa nyala', /tidak menyala|won't turn on|won't boot/i);

  const englishOnly = chunks.map(chunk => chunk.chunk_id === 'faq-laptop'
    ? {
      ...chunk,
      content: `${'Printer and account setup for new staff. '.repeat(8)}Laptop. Check the charger light, the power cable, and the battery before you decide it won't turn on or won't boot.`,
    }
    : chunk);
  const englishHits = rankInternalDocChunks('laptop tidak bisa nyala', queryVector, englishOnly, company, 6);
  assert.equal(englishHits[0]?.documentId, 'doc-it-faq');
  assert.equal(englishHits.every(hit => hit.documentId === 'doc-it-faq'), true);
  assert.equal(internalDocsRetrievalConfidence('laptop tidak bisa nyala', englishHits), 'high');
  assert.match(englishHits[0]?.excerpt || '', /won't turn on|won't boot/i);
  assert.doesNotMatch((englishHits[0]?.excerpt || '').slice(0, 90), /Printer and account setup/i);

  const missing = rankInternalDocChunks('laptop tidak bisa nyala', queryVector, chunks.filter(chunk => chunk.document_id !== 'doc-it-faq'), company, 6);
  assert.equal(internalDocsRetrievalConfidence('laptop tidak bisa nyala', missing), 'low');
  assert.equal(missing.some(hit => hit.documentId === 'doc-it-faq'), false);
});

test('unstable office wifi prefers the IT FAQ section over LED network setup that only mentions wifi', () => {
  const queryVector = [1, 0];
  const wifiHeavy = JSON.stringify(queryVector);
  const orthogonal = JSON.stringify([0, 1]);
  const running = 'HDPlayer LED Screen Network setup. Wifi SSID is HD-LED and the Wifi password is on the controller. Network Wifi SSIDs and passwords for the LED screen. The scroll speed looks stabil on the LED. '.repeat(4);
  const faqWifi = 'Company software catalog and printer names. '.repeat(8)
    + '1.2 Koneksi Wi-Fi Tidak Stabil (Wireless Unstable Issue). Interference from nearby devices, AP overload, and DNS can make the office connection drop. Toggle the wireless adapter, then renew the DNS. ';
  const chunks: InternalDocChunkRow[] = [
    {
      chunk_id: 'run',
      document_id: 'doc-running',
      title: 'Running Text',
      access_level: 'company',
      content: running,
      embedding: wifiHeavy,
    },
    {
      chunk_id: 'visitor',
      document_id: 'doc-visitor',
      title: 'Visitor wifi',
      access_level: 'company',
      content: 'The visitor wifi password is printed at reception. Guests use Dupoin-Guest.',
      embedding: wifiHeavy,
    },
    {
      chunk_id: 'faq-intro',
      document_id: 'doc-it-faq',
      title: 'FAQ IT Support',
      access_level: 'company',
      content: 'Visitor wifi password is printed at reception. The badge printer reset code is on the front panel.',
      embedding: orthogonal,
    },
    {
      chunk_id: 'faq-wifi',
      document_id: 'doc-it-faq',
      title: 'FAQ IT Support',
      access_level: 'company',
      content: faqWifi,
      embedding: orthogonal,
    },
  ];

  const expectFaq = (query: string) => {
    const hits = rankInternalDocChunks(query, queryVector, chunks, company, 6);
    assert.equal(hits[0]?.documentId, 'doc-it-faq', query);
    assert.equal(hits[0]?.chunkId, 'faq-wifi', query);
    assert.equal(hits.every(hit => hit.documentId === 'doc-it-faq'), true, query);
    assert.equal(internalDocsRetrievalConfidence(query, hits), 'high', query);
    assert.equal(internalDocsAskFallback(query, hits), null, query);
    assert.match(hits[0]?.excerpt || '', /1\.2 Koneksi Wi-Fi Tidak Stabil|Wireless Unstable Issue/);
    assert.match(hits[0]?.excerpt || '', /Interference|AP overload|wireless adapter/);
    assert.doesNotMatch((hits[0]?.excerpt || '').slice(0, 90), /HDPlayer|SSID|printer names|Visitor wifi/i);
    const citations = citationsFromHits(hits, 'https://marketing.example');
    assert.equal(citations.length, 1, query);
    assert.equal(citations[0]?.title, 'FAQ IT Support');
  };

  expectFaq('kenapa wifi gak stabil ya');
  expectFaq('koneksi wifi tidak stabil');
  expectFaq('wireless unstable');

  const englishOnly = chunks.map(chunk => chunk.chunk_id === 'faq-wifi'
    ? {
      ...chunk,
      content: `${'Printer and account setup for new staff. '.repeat(8)}The office Wi-Fi connection is unstable. Interference, AP overload, and DNS are the usual causes. Toggle the wireless adapter.`,
    }
    : chunk);
  const englishHits = rankInternalDocChunks('kenapa wifi gak stabil ya', queryVector, englishOnly, company, 6);
  assert.equal(englishHits[0]?.documentId, 'doc-it-faq');
  assert.equal(englishHits[0]?.chunkId, 'faq-wifi');
  assert.equal(englishHits.every(hit => hit.documentId === 'doc-it-faq'), true);
  assert.equal(internalDocsRetrievalConfidence('kenapa wifi gak stabil ya', englishHits), 'high');
  assert.match(englishHits[0]?.excerpt || '', /Wi-Fi connection is unstable|wireless adapter/);
  assert.doesNotMatch((englishHits[0]?.excerpt || '').slice(0, 90), /Printer and account setup|HDPlayer|SSID/i);

  const missing = rankInternalDocChunks('kenapa wifi gak stabil ya', queryVector, chunks.filter(chunk => chunk.document_id !== 'doc-it-faq'), company, 6);
  assert.equal(internalDocsRetrievalConfidence('kenapa wifi gak stabil ya', missing), 'low');
  assert.equal(missing.some(hit => hit.documentId === 'doc-it-faq'), false);
  assert.equal(missing[0]?.title, 'Running Text');

  const passwordHits = rankInternalDocChunks('Where is the visitor wifi password?', queryVector, chunks, company, 6);
  assert.equal(passwordHits[0]?.documentId, 'doc-visitor');
  assert.equal(internalDocsRetrievalConfidence('Where is the visitor wifi password?', passwordHits), 'high');
});

test('chunk retrieval orders lexical overlap ahead of recency', () => {
  const ranked = buildInternalDocChunkQuery(['lark', 'password', 'change']);
  assert.match(ranked.sql, /d\.title ILIKE \? ESCAPE/);
  assert.match(ranked.sql, /c\.content ILIKE \? ESCAPE/);
  assert.match(ranked.sql, /ORDER BY \(/);
  assert.match(ranked.sql, /DESC, d\.updated_at DESC/);
  assert.match(ranked.sql, /THEN 3 ELSE 0 END/);
  assert.equal(ranked.params.length, 10);
  assert.ok(ranked.params.some(param => typeof param === 'string' && param.includes('lark password')));
  assert.ok(ranked.params.some(param => typeof param === 'string' && param.includes('password lark')));
  assert.ok(ranked.params.every(param => typeof param === 'string' && (param.includes('lark') || param.includes('password') || param.includes('change'))));

  const plain = buildInternalDocChunkQuery();
  assert.match(plain.sql, /access_level = ANY\(\?::text\[\]\)/);
  assert.match(plain.sql, /status = 'indexed'/);
  assert.equal(plain.params.length, 0);
});

test('prompt and research citations include only the hits passed in, with document links', () => {
  const hits: InternalDocHit[] = [{
    documentId: '11111111-1111-1111-1111-111111111111',
    title: 'Visitor wifi',
    accessLevel: 'company',
    chunkId: 'chunk-1',
    excerpt: 'The visitor wifi password is printed at reception.',
    score: 0.8,
  }];
  const prompt = formatInternalDocsPrompt(hits, 'https://marketing.example');
  assert.match(prompt, /FAQ & GUIDES/);
  assert.match(prompt, /Visitor wifi/);
  assert.match(prompt, /https:\/\/marketing\.example\/dashboard\/internal-docs\/11111111-1111-1111-1111-111111111111/);
  assert.equal(formatInternalDocsPrompt([], 'https://marketing.example'), '');

  const citations = citationsFromHits(hits, 'https://marketing.example');
  assert.equal(citations.length, 1);
  assert.match(citations[0].url, /\/dashboard\/internal-docs\//);

  const payload = internalDocKnowledgePayload({
    documentId: hits[0].documentId,
    title: hits[0].title,
    accessLevel: 'it-only',
    text: hits[0].excerpt,
  });
  assert.equal(payload?.taskType, 'internal-docs');
  assert.equal(payload?.taskId, hits[0].documentId);
  assert.equal(payload?.audience, 'it-only');
  assert.equal(payload?.updateStylePreferences, false);
  assert.match(payload?.brief || '', /Visitor wifi/);
  assert.equal(internalDocKnowledgePayload({
    documentId: 'short',
    title: 'Visitor wifi',
    accessLevel: 'company',
    text: hits[0].excerpt,
  }), null);
  assert.equal(internalDocKnowledgePayload({
    documentId: hits[0].documentId,
    title: 'Visitor wifi',
    accessLevel: 'secret',
    text: hits[0].excerpt,
  }), null);

  const merged = mergeInternalDocSources({
    type: 'research',
    sourceCount: 0,
    grounding: 'empty',
    sources: [],
  }, hits, 'https://marketing.example');
  assert.equal(merged.grounding, 'ok');
  assert.equal(merged.sources[0].originChip, 'internal');
  assert.equal(merged.sources[0].title, 'FAQ & Guides: Visitor wifi');
  assert.equal(normalizeInspectorSource(merged.sources[0])?.originChip, 'internal');
  assert.equal(INTERNAL_DOCS_NO_MATCH_ANSWER.includes('you can access'), true);
});

test('plain text extraction, chunking, file kinds, and storage paths stay private', () => {
  const text = extractPlainText(new TextEncoder().encode('# Leave policy\n\nEmployees request leave in writing.'));
  assert.match(text, /Leave policy/);
  const chunks = chunkDocumentText(`${'Alpha policy. '.repeat(80)}\n\n${'Beta policy. '.repeat(80)}`);
  assert.ok(chunks.length >= 2);
  assert.equal(internalDocKind('handbook.pdf', 'application/octet-stream')?.ext, '.pdf');
  assert.equal(internalDocKind('notes.docx', '')?.ext, '.docx');
  assert.equal(internalDocKind('readme.md', 'text/plain')?.ext, '.md');
  assert.equal(internalDocKind('photo.png', 'image/png'), null);
  assert.equal(titleFromFilename('it-runbook.md'), 'it runbook');
  assert.equal(resolveStoredInternalDoc('../secrets.txt'), null);
  assert.equal(resolveStoredInternalDoc('notes.exe'), null);
  assert.ok(resolveStoredInternalDoc('11111111-1111-1111-1111-111111111111.pdf')?.endsWith('11111111-1111-1111-1111-111111111111.pdf'));
});

test('sidebar, routes, migration, and AI Research keep Internal Docs ACL separate from the knowledge graph', () => {
  const layout = read('src/app/dashboard/layout.tsx');
  const migration = read('db/migrations/020_internal_documents.sql');
  const chat = read('src/app/api/ai-research/chat/route.ts');
  const ask = read('src/app/api/internal-docs/ask/route.ts');
  const listRoute = read('src/app/api/internal-docs/route.ts');

  assert.match(layout, /href: '\/dashboard\/internal-docs', label: 'FAQ & Guides', icon: 'docs', feature: 'internal-docs' \}/);
  const sections = layout.slice(layout.indexOf('const sections'));
  assert.ok(sections.indexOf("label: 'FAQ & Guides'") < sections.indexOf("label: 'Overview'"));
  assert.doesNotMatch(layout.slice(layout.indexOf('const resourceItems'), layout.indexOf('export default')), /internal-docs/);
  assert.doesNotMatch(layout, /href: '\/dashboard\/internal-docs'[^}\n]*adminOnly/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS internal_documents/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS internal_document_chunks/);
  assert.match(migration, /'IT'/);
  assert.match(migration, /it-only/);
  const executable = migration.replace(/--.*$/gm, '');
  assert.doesNotMatch(executable, /knowledge_entries/);
  assert.doesNotMatch(executable, /\bDELETE FROM\b|\bDROP TABLE\b|\bTRUNCATE\b/i);
  assert.match(executable, /ON DELETE CASCADE/);

  assert.match(chat, /canAccessFeature\(auth, 'internal-docs'\)/);
  assert.match(chat, /retrieveInternalDocHits\(internalDocsPrincipal, query\)/);
  assert.match(chat, /departmentName: auth\.departmentName/);
  assert.match(chat, /formatInternalDocsPrompt\(internalDocHits/);
  assert.match(chat, /mergeInternalDocSources\(researchEvent, internalDocHits/);
  assert.match(chat, /const knowledgeContext = await fetchKnowledgeContext\(auth\.id, query, undefined, 5, 'internal'\)/);
  assert.match(chat, /sources: researchEvent\.sources/);
  assert.ok(chat.indexOf('const knowledgeContext') < chat.indexOf('buildAiResearchChatMessages({'));

  assert.match(ask, /retrieveInternalDocHits\(actor\.principal, question, INTERNAL_DOCS_ASK_LIMIT, documentId\)/);
  assert.match(ask, /resolveInternalDocsAskPlan\(question, hits, documentId\)/);
  assert.ok(ask.indexOf('resolveInternalDocsAskPlan') < ask.indexOf('generateContent'));
  assert.match(read('src/lib/internal-docs.ts'), /return internalDocsAskFallback\(question, hits\)/);
  assert.match(ask, /withCitationMedia/);
  assert.match(ask, /presentInternalDocsAnswer/);
  assert.match(read('src/lib/internal-docs.ts'), /persistInternalDocKnowledge/);
  assert.match(read('src/app/api/internal-docs/[id]/reindex/route.ts'), /persistInternalDocKnowledge/);
  assert.match(read('src/app/api/internal-docs/[id]/route.ts'), /deleteInternalDocKnowledge/);
  assert.match(read('src/app/api/internal-docs/[id]/route.ts'), /DELETE FROM internal_document_chunks WHERE document_id = \?/);
  assert.match(read('src/app/api/internal-docs/[id]/route.ts'), /executeTransaction/);
  assert.match(read('src/app/api/internal-docs/[id]/route.ts'), /syncInternalDocKnowledgeMeta/);
  const knowledge = read('src/lib/internal-docs-knowledge.ts');
  assert.match(knowledge, /DELETE FROM knowledge_edges/);
  assert.match(knowledge, /upsertTask: true/);
  assert.match(knowledge, /updateStylePreferences: false/);
  assert.match(listRoute, /listInternalDocuments\(actor\.principal/);
  assert.match(listRoute, /requireInternalDocsManager/);

  const access = read('src/lib/internal-docs-access.ts');
  assert.match(access, /requireFeature\(request, INTERNAL_DOCS_FEATURE\)/);
  assert.match(access, /only admins can manage FAQ & Guides/);
  assert.doesNotMatch(access, /only IT and admins/);
  assert.match(read('src/lib/auth.ts'), /ACCOUNT_FEATURE_LABELS\[feature\]/);
  assert.match(read('src/components/AiResearchSourcesPanel.tsx'), /internal: 'FAQ & Guides'/);
  const workspace = read('src/app/dashboard/internal-docs/InternalDocsWorkspace.tsx');
  assert.match(workspace, /title="FAQ & Guides"/);
  assert.match(workspace, /No guides yet/);
  assert.match(workspace, /FaqListSkeleton/);
  assert.match(workspace, /internal-docs-detail-loading/);
  assert.match(workspace, /internal-docs-upload-loading/);
  assert.match(workspace, /Opening document/);
  const feedback = read('src/app/dashboard/internal-docs/FaqFeedback.tsx');
  assert.match(feedback, /animate-spin/);
  assert.match(feedback, /internal-docs-list-loading/);
  assert.match(feedback, /Loading documents/);
  assert.doesNotMatch(workspace, /window\.confirm/);
  assert.doesNotMatch(workspace, /Internal Docs/);
  const reader = read('src/app/dashboard/internal-docs/GuideReader.tsx');
  assert.match(reader, /Delete “\{document\.title\}”\?/);
  assert.match(reader, /removes the guide, its indexed passages/);
  assert.match(reader, /canManage && confirmingDelete/);
  assert.match(reader, /Ask will no longer use it/);
  const askPanel = read('src/app/dashboard/internal-docs/FaqAskPanel.tsx');
  assert.match(askPanel, /data-testid="faq-ask-loading"/);
  assert.match(askPanel, /Looking through documents/);
  assert.match(askPanel, /Low confidence/);
  assert.match(read('src/app/dashboard/internal-docs/loading.tsx'), /InternalDocsLoading/);
  assert.equal(read('src/lib/authorization.ts').includes("'internal-docs': 'FAQ & Guides'"), true);
  const accounts = read('src/app/dashboard/accounts/AccountsClient.tsx');
  assert.match(accounts, /ACCOUNT_FEATURE_LABELS\[feature\]/);
  assert.match(accounts, /ACCOUNT_FEATURES/);
  const departmentsApi = read('src/app/api/admin/departments/route.ts');
  assert.match(departmentsApi, /isAccountFeature/);
  const imageRoute = read('src/app/api/generate-image/route.ts');
  assert.match(imageRoute, /hasGenerationFeature\(auth\)/);
  assert.doesNotMatch(imageRoute, /features\.length === 0/);

  const featureMigration = read('db/migrations/021_internal_docs_feature.sql');
  const featureSql = featureMigration.replace(/--.*$/gm, '');
  assert.match(featureMigration, /DROP CONSTRAINT IF EXISTS departments_permitted_features_valid/);
  assert.match(featureMigration, /'internal-docs'/);
  assert.match(featureMigration, /WHERE NOT \(permitted_features @> ARRAY\['internal-docs'\]::text\[\]\)/);
  assert.doesNotMatch(featureSql, /\bDELETE FROM\b|\bDROP TABLE\b|\bTRUNCATE\b/i);
  assert.doesNotMatch(featureSql, /knowledge_entries/);
});
