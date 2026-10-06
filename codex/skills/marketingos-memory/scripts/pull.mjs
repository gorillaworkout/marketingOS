#!/usr/bin/env node
import { runPull } from '../sync.mjs';

const result = await runPull({
  url: process.env.MARKETINGOS_API_URL,
  token: process.env.MARKETINGOS_API_TOKEN,
  query: process.argv.slice(2).join(' '),
  fetchImpl: globalThis.fetch,
});

if (!result.ok) {
  console.error(result.message);
  process.exitCode = 1;
} else {
  console.log(result.message);
}
