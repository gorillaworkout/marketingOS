import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { internalDocKind as storedKind } from '../src/lib/internal-docs-storage';
import {
  INTERNAL_DOC_FILE_ACCEPT,
  MAX_INTERNAL_DOC_BYTES,
  internalDocKind,
  internalDocUploadIssue,
  titleForInternalDocUpload,
} from '../src/lib/internal-docs-upload';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

test('upload checks match stored kind detection and the 15 MB limit', () => {
  const samples: Array<[string, string]> = [
    ['guide.pdf', 'application/pdf'],
    ['Guide.PDF', ''],
    ['runbook.docx', 'application/octet-stream'],
    ['notes.md', 'text/plain'],
    ['notes.MD', 'text/x-markdown'],
    ['plain.txt', 'text/plain'],
    ['readme', 'text/markdown'],
    ['readme', 'text/x-markdown'],
    ['readme', 'text/plain'],
    ['readme', 'application/pdf'],
    ['photo.png', 'image/png'],
    ['sheet.xlsx', 'application/vnd.ms-excel'],
    ['', ''],
  ];
  for (const [name, type] of samples) {
    assert.deepEqual(internalDocKind(name, type), storedKind(name, type), `${name} ${type}`);
  }
  assert.equal(MAX_INTERNAL_DOC_BYTES, 15 * 1024 * 1024);
  assert.match(INTERNAL_DOC_FILE_ACCEPT, /\.pdf/);
  assert.match(INTERNAL_DOC_FILE_ACCEPT, /\.docx/);
  assert.match(INTERNAL_DOC_FILE_ACCEPT, /\.md/);
  assert.match(INTERNAL_DOC_FILE_ACCEPT, /\.txt/);
});

test('rejected files explain empty, oversize, and unsupported types', () => {
  assert.equal(internalDocUploadIssue({ name: 'empty.txt', size: 0, type: 'text/plain' }), 'The file is empty.');
  assert.equal(internalDocUploadIssue({ name: 'big.pdf', size: MAX_INTERNAL_DOC_BYTES + 1, type: 'application/pdf' }), 'File is larger than 15 MB.');
  assert.equal(internalDocUploadIssue({ name: 'photo.png', size: 1200, type: 'image/png' }), 'Unsupported file type. Use PDF, DOCX, MD, or TXT.');
  assert.equal(internalDocUploadIssue({ name: 'ok.txt', size: 12, type: 'text/plain' }), null);
  assert.equal(internalDocUploadIssue({ name: 'limit.pdf', size: MAX_INTERNAL_DOC_BYTES, type: 'application/pdf' }), null);
});

test('optional title applies only to a single file', () => {
  assert.equal(titleForInternalDocUpload(1, '  Visitor wifi  '), 'Visitor wifi');
  assert.equal(titleForInternalDocUpload(1, '   '), '');
  assert.equal(titleForInternalDocUpload(2, 'Shared title'), '');
  assert.equal(titleForInternalDocUpload(0, 'Shared title'), '');
  assert.equal(titleForInternalDocUpload(1, 'a'.repeat(250)).length, 200);
});

test('FAQ upload UI drops many files and posts them one at a time with one access level', () => {
  const workspace = read('src/app/dashboard/internal-docs/InternalDocsWorkspace.tsx');
  const route = read('src/app/api/internal-docs/route.ts');
  assert.match(workspace, /data-testid="internal-docs-dropzone"/);
  assert.ok(workspace.indexOf('<FaqAskPanel') < workspace.indexOf('data-testid="internal-docs-dropzone"'));
  assert.match(workspace, /onDrop=\{onDrop\}/);
  assert.match(workspace, /type="file"/);
  assert.match(workspace, /multiple/);
  assert.match(workspace, /internalDocUploadIssue\(file\)/);
  assert.match(workspace, /titleForInternalDocUpload\(pending\.length, title\)/);
  assert.match(workspace, /body\.set\('file', item\.file\)/);
  assert.match(workspace, /body\.set\('accessLevel', level\)/);
  assert.match(workspace, /for \(let index = 0; index < pending\.length; index \+= 1\)/);
  assert.doesNotMatch(workspace, /Promise\.all/);
  assert.match(workspace, /Uploading \{uploadProgress\.current\} of \{uploadProgress\.total\}/);
  assert.match(workspace, /Choose a PDF, DOCX, MD, or TXT file\./);
  assert.match(workspace, /title="FAQ & Guides"/);
  assert.match(route, /requireInternalDocsManager/);
  assert.match(route, /form\.get\('file'\)/);
  assert.match(route, /internalDocUploadIssue\(file\)/);
  assert.match(route, /isInternalDocAccessLevel\(accessValue\)/);
  assert.doesNotMatch(route, /form\.getAll\('file'\)/);
});

test('FAQ sidebar icon is a help mark and stays at the top', () => {
  const layout = read('src/app/dashboard/layout.tsx');
  assert.match(layout, /href: '\/dashboard\/internal-docs', label: 'FAQ & Guides', icon: 'docs', feature: 'internal-docs'/);
  assert.match(layout, /docs: \[\s*\{ cx: 12, cy: 12, r: 10 \}/);
  assert.match(layout, /M9\.09 9a3 3 0 0 1 5\.83 1c0 2-3 3-3 3/);
  assert.doesNotMatch(layout, /docs: 'M6 3h8l4 4v14/);
  const sections = layout.slice(layout.indexOf('const sections'));
  assert.ok(sections.indexOf("label: 'FAQ & Guides'") < sections.indexOf("label: 'Overview'"));
});
