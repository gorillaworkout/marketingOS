#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { runPush } from '../sync.mjs';

const args = process.argv.slice(2);
const approve = args.includes('--approve');
const fileIndex = args.indexOf('--file');
let text = '';
let file = false;

if (fileIndex !== -1) {
  const path = args[fileIndex + 1];
  if (!path) {
    console.error('Name the chat file after --file.');
    process.exitCode = 1;
  } else {
    text = await readFile(path, 'utf8');
    file = true;
  }
} else {
  text = await new Promise(resolve => {
    const chunks = [];
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

if (process.exitCode) {
  // A missing file path already explained itself.
} else if (!text.trim()) {
  console.error('Add a chat to import.');
  process.exitCode = 1;
} else {
  const result = await runPush({
    url: process.env.MARKETINGOS_API_URL,
    token: process.env.MARKETINGOS_API_TOKEN,
    text,
    file,
    approve,
    fetchImpl: globalThis.fetch,
  });
  if (!result.ok) {
    console.error(result.message);
    process.exitCode = 1;
  } else {
    console.log(result.message);
  }
}
