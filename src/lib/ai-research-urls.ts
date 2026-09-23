import type { AiResearchChatMessage } from './ai-research';
import {
  AI_RESEARCH_MAX_SOURCES,
  htmlToPlainText,
  isLikelyLoginWallHost,
  isPublicHttpUrl,
  prefersIndonesiaSources,
  type ResearchContext,
  type ResearchSource,
} from './ai-research-grounding';

export const AI_RESEARCH_MAX_CONTEXT_URLS = 3;
export const AI_RESEARCH_URL_TIMEOUT_MS = 8_000;
export const AI_RESEARCH_URL_MAX_BYTES = 500_000;
export const AI_RESEARCH_URL_MAX_CHARS = 8_000;
export const AI_RESEARCH_URL_TRUNCATION_NOTE = '[Catatan: teks halaman dipotong karena terlalu panjang.]';
export const AI_RESEARCH_URL_ONLY_PROMPT = 'Tolong rangkum dan jelaskan tautan yang disertakan.';
export const AI_RESEARCH_URL_MIN_TEXT = 40;

const CANDIDATE_SOURCE = "\\b(?:https?|file|ftp|data):\\/\\/[^\\s<>\"'`]+";

function candidatePattern(): RegExp {
  return new RegExp(CANDIDATE_SOURCE, 'gi');
}
const CLOSER_TO_OPENER: Record<string, string> = { ')': '(', ']': '[', '}': '{', '>': '<' };

export interface ScannedContextUrl {
  raw: string;
  url: string;
}

export interface ContextUrlScan {
  accepted: ScannedContextUrl[];
  blocked: ScannedContextUrl[];
  overflow: ScannedContextUrl[];
}

export interface ContextUrlFailure {
  url: string;
  error: string;
}

function trimUrlTail(raw: string): string {
  let value = raw.replace(/[.,;:!?]+$/g, '');
  while (value.length) {
    const closer = value.at(-1) || '';
    const opener = CLOSER_TO_OPENER[closer];
    if (!opener) break;
    const opens = value.split(opener).length - 1;
    const closes = value.split(closer).length - 1;
    if (closes <= opens) break;
    value = value.slice(0, -1);
  }
  return value;
}

function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

function ipv4FromMapped(host: string): string | null {
  const dotted = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (dotted) return dotted[1];
  const hex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hex) return null;
  const hi = Number.parseInt(hex[1], 16);
  const lo = Number.parseInt(hex[2], 16);
  if (hi > 0xffff || lo > 0xffff) return null;
  const value = ((hi << 16) | lo) >>> 0;
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join('.');
}

export function isNonPublicIpAddress(address: string): boolean {
  const host = bareHost(address);
  const mapped = ipv4FromMapped(host);
  if (mapped) return isNonPublicIpAddress(mapped);
  if (host === '::' || host === '::1') return true;
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:') || host.startsWith('ff')) return true;
  if (/^2001:db8:/i.test(host)) return true;

  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  const octets = host.split('.').map(part => Number(part));
  if (octets.some(value => value > 255)) return true;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 168 || b === 0)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && octets[2] === 100) return true;
  if (a === 203 && b === 0 && octets[2] === 113) return true;
  return false;
}

export function contextUrlBlockReason(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return 'tautan tidak valid';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'skema tidak didukung';
  if (!isPublicHttpUrl(parsed.toString())) return 'alamat tidak publik';
  const host = bareHost(parsed.hostname);
  if (isNonPublicIpAddress(host)) return 'alamat tidak publik';
  if (isLikelyLoginWallHost(parsed.toString())) return 'halaman membutuhkan login';
  if (!host.includes('.') && !host.includes(':')) return 'alamat tidak publik';
  return null;
}

function canonicalContextUrl(value: string): string | null {
  if (contextUrlBlockReason(value)) return null;
  const parsed = new URL(value);
  parsed.hash = '';
  return parsed.toString();
}

export function scanContextUrls(text: string, limit = AI_RESEARCH_MAX_CONTEXT_URLS): ContextUrlScan {
  const accepted: ScannedContextUrl[] = [];
  const blocked: ScannedContextUrl[] = [];
  const overflow: ScannedContextUrl[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(candidatePattern())) {
    const raw = trimUrlTail(match[0]);
    if (!raw) continue;
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      blocked.push({ raw, url: raw });
      continue;
    }
    parsed.hash = '';
    const key = parsed.toString().replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    const url = parsed.toString();
    const item = { raw, url };
    if (contextUrlBlockReason(url)) {
      blocked.push(item);
      continue;
    }
    if (accepted.length >= limit) overflow.push(item);
    else accepted.push({ raw, url: canonicalContextUrl(url) || url });
  }
  return { accepted, blocked, overflow };
}

export function isUrlOnlyQuery(text: string): boolean {
  const scan = scanContextUrls(text, 8);
  if (!scan.accepted.length && !scan.blocked.length && !scan.overflow.length) return false;
  const leftover = text
    .replace(candidatePattern(), ' ')
    .replace(/[\s?!.:,;]+/g, ' ')
    .trim();
  return leftover.length === 0;
}

export function contextPageText(
  raw: string,
  contentType = '',
  maxChars = AI_RESEARCH_URL_MAX_CHARS,
): { title: string; text: string; truncated: boolean } {
  const titleFromHeader = raw.match(/^\s*Title:\s*(.+)$/m)?.[1]?.trim() || '';
  const looksHtml = /html/i.test(contentType)
    || /<html[\s>]/i.test(raw.slice(0, 2500))
    || /<title[\s>]/i.test(raw.slice(0, 4000));
  let title = titleFromHeader;
  let plain = raw;
  if (looksHtml) {
    const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    title = title || (titleMatch ? htmlToPlainText(titleMatch[1]).slice(0, 180) : '');
    plain = htmlToPlainText(raw);
  } else {
    plain = htmlToPlainText(raw
      .replace(/^\s*Title:\s*.+$/m, ' ')
      .replace(/^\s*URL Source:\s*.+$/m, ' ')
      .replace(/^\s*Published Time:\s*.+$/m, ' ')
      .replace(/^\s*Markdown Content:\s*/m, ' ')
      .replace(/#{1,6}/g, ' '));
  }
  const collapsed = plain.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxChars) return { title, text: collapsed, truncated: false };
  const budget = Math.max(1, maxChars - AI_RESEARCH_URL_TRUNCATION_NOTE.length - 1);
  let sliced = collapsed.slice(0, budget);
  const space = sliced.lastIndexOf(' ');
  if (space >= Math.floor(budget * 0.7)) sliced = sliced.slice(0, space);
  return {
    title,
    text: `${sliced.trim()} ${AI_RESEARCH_URL_TRUNCATION_NOTE}`,
    truncated: true,
  };
}

export function mergeContextUrlSources(
  research: ResearchContext | null,
  urlSources: ResearchSource[],
  query: string,
): ResearchContext | null {
  if (!urlSources.length) return research;
  const seen = new Set(urlSources.map(source => source.url.replace(/\/$/, '')));
  const rest = (research?.sources || []).filter(source => !seen.has(source.url.replace(/\/$/, '')));
  return {
    query: research?.query || query,
    indonesiaPreferred: research?.indonesiaPreferred ?? prefersIndonesiaSources(query),
    sources: [...urlSources, ...rest].slice(0, AI_RESEARCH_MAX_SOURCES),
  };
}

export function applyContextUrlsToIncoming(
  incoming: AiResearchChatMessage[],
  failures: ContextUrlFailure[],
): AiResearchChatMessage[] {
  if (!incoming.length) return incoming;
  const lastIndex = incoming.length - 1;
  const last = incoming[lastIndex];
  if (!last || last.role !== 'user') return incoming;
  let content = last.content;
  if (isUrlOnlyQuery(content)) content = `${AI_RESEARCH_URL_ONLY_PROMPT}\n${content}`;
  if (failures.length) {
    const notes = failures
      .map(item => `[Tautan tidak diambil: ${item.url} — ${item.error}. Jangan mengarang isi halaman itu.]`)
      .join('\n');
    content = `${content}\n\n${notes}`;
  }
  if (content === last.content) return incoming;
  return incoming.map((message, index) => (index === lastIndex ? { ...message, content } : message));
}
