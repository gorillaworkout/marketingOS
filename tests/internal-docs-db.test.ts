import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, unlink } from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { closeDb, execute, queryOne } from '../src/lib/database';
import {
  findVisibleDocument,
  formatInternalDocsPrompt,
  listInternalDocuments,
  retrieveInternalDocHits,
  createIndexedDocument,
} from '../src/lib/internal-docs';
import { deleteInternalDocKnowledge } from '../src/lib/internal-docs-knowledge';
import { internalDocsDirectory, resolveStoredInternalDoc, storageKeyFor } from '../src/lib/internal-docs-storage';

const enabled = Boolean(process.env.DATABASE_URL);
const companyUser = { role: 'member', departmentName: 'Marketing' };
const itUser = { role: 'member', departmentName: 'IT' };
const COMPANY_FACT = 'company pineapple leave policy for all employees';
const IT_FACT = 'it-only orchid vault root key for administrators';

test('database ACL hides IT-only documents from company employees', { skip: !enabled }, async () => {
  const owner = await queryOne<{ id: string }>('SELECT id FROM users WHERE role = ? LIMIT 1', ['admin']);
  assert.ok(owner?.id);
  const companyId = uuidv4();
  const secretId = uuidv4();
  const companyKey = storageKeyFor(companyId, '.txt');
  const secretKey = storageKeyFor(secretId, '.txt');
  await mkdir(internalDocsDirectory(), { recursive: true });
  try {
    const company = await createIndexedDocument({
      id: companyId,
      title: 'Company pineapple handbook',
      originalName: 'pineapple.txt',
      mimeType: 'text/plain',
      fileExt: '.txt',
      fileSize: COMPANY_FACT.length,
      storageKey: companyKey,
      accessLevel: 'company',
      uploadedBy: owner.id,
      bytes: new TextEncoder().encode(COMPANY_FACT),
    });
    const secret = await createIndexedDocument({
      id: secretId,
      title: 'IT orchid vault',
      originalName: 'orchid.txt',
      mimeType: 'text/plain',
      fileExt: '.txt',
      fileSize: IT_FACT.length,
      storageKey: secretKey,
      accessLevel: 'it-only',
      uploadedBy: owner.id,
      bytes: new TextEncoder().encode(IT_FACT),
    });
    assert.equal(company.status, 'indexed');
    assert.equal(secret.status, 'indexed');

    const companyList = await listInternalDocuments(companyUser, '');
    const companySearch = await listInternalDocuments(companyUser, 'orchid vault');
    const itSearch = await listInternalDocuments(itUser, 'orchid vault');
    assert.equal(companyList.some(row => row.id === secretId), false);
    assert.equal(companyList.some(row => row.id === companyId), true);
    assert.equal(companySearch.length, 0);
    assert.equal(itSearch.some(row => row.id === secretId), true);

    const hidden = await findVisibleDocument<{ id: string; access_level: string }>(companyUser, secretId, false);
    const visible = await findVisibleDocument<{ id: string; access_level: string }>(itUser, secretId, false);
    assert.equal(hidden, undefined);
    assert.equal(visible?.id, secretId);

    const companyHits = await retrieveInternalDocHits(companyUser, 'orchid vault root key');
    const itHits = await retrieveInternalDocHits(itUser, 'orchid vault root key');
    assert.equal(companyHits.some(hit => hit.documentId === secretId || /orchid|vault/i.test(hit.title + hit.excerpt)), false);
    assert.equal(itHits.some(hit => hit.documentId === secretId), true);
    const prompt = formatInternalDocsPrompt(companyHits, 'https://marketing.example');
    assert.doesNotMatch(prompt, /orchid|vault|IT-only/i);
  } finally {
    await deleteInternalDocKnowledge(companyId).catch(() => undefined);
    await deleteInternalDocKnowledge(secretId).catch(() => undefined);
    await execute('DELETE FROM internal_documents WHERE id IN (?, ?)', [companyId, secretId]);
    for (const key of [companyKey, secretKey]) {
      const stored = resolveStoredInternalDoc(key);
      if (stored) await unlink(stored).catch(() => undefined);
    }
    await closeDb();
  }
});
