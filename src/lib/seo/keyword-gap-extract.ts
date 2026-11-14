import * as cheerio from 'cheerio';
import { normalizePhrase } from './keyword-gap-bucket';

const STOP = new Set(`
a an the and or of for to in on with from by at as is are was were be this that these those
yang dan atau di ke dari untuk pada dengan adalah itu ini ada
`.split(/\s+/).filter(Boolean));

export interface PageCandidates {
  url: string;
  phrases: string[];
}

function keep(phrase: string): string | null {
  const normalized = normalizePhrase(phrase);
  const words = normalized.split(' ').filter(word => word && !STOP.has(word) && !/^\d+$/.test(word));
  if (words.length < 2 || words.length > 6) return null;
  if (words.join('').length < 6) return null;
  return words.join(' ');
}

function grams(text: string): string[] {
  const words = normalizePhrase(text).split(' ').filter(word => word && !STOP.has(word));
  const phrases: string[] = [];
  for (let size = 2; size <= 3; size += 1) {
    for (let index = 0; index <= words.length - size && phrases.length < 40; index += 1) {
      const phrase = keep(words.slice(index, index + size).join(' '));
      if (phrase) phrases.push(phrase);
    }
  }
  return phrases;
}

export function extractPageCandidates(url: string, html: string): string[] {
  const $ = cheerio.load(html);
  const bits = [
    $('title').first().text(),
    $('meta[name="description"]').attr('content') || '',
    ...$('h1, h2, h3').toArray().map(node => $(node).text()),
  ];
  $('script, style, noscript').remove();
  const body = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 4000);
  let slug = '';
  try { slug = new URL(url).pathname.split('/').filter(Boolean).join(' ').replace(/[-_]+/g, ' '); } catch { slug = ''; }
  const phrases = [...bits.flatMap(grams), ...grams(slug), ...grams(body)];
  return [...new Set(phrases)].slice(0, 40);
}

export function topCandidates(pages: PageCandidates[], limit = 150): string[] {
  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const phrase of page.phrases) counts.set(phrase, (counts.get(phrase) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([phrase]) => phrase);
}

const INTENTS = new Set(['informational', 'navigational', 'commercial', 'transactional']);

export function parseClusteredKeywords(text: string, allowed: string[]): Array<{ keyword: string; intent: 'informational' | 'navigational' | 'commercial' | 'transactional' | null }> {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(match[0]); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const allowedSet = new Set(allowed.map(normalizePhrase));
  const rows: Array<{ keyword: string; intent: 'informational' | 'navigational' | 'commercial' | 'transactional' | null }> = [];
  for (const item of parsed) {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const keyword = normalizePhrase(String(record.keyword || ''));
    if (!keyword || !allowedSet.has(keyword) || rows.some(row => row.keyword === keyword)) continue;
    const intent = INTENTS.has(String(record.intent)) ? String(record.intent) as 'informational' | 'navigational' | 'commercial' | 'transactional' : null;
    rows.push({ keyword, intent });
    if (rows.length >= 150) break;
  }
  return rows;
}
