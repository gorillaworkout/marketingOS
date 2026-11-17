/**
 * Competitor Intelligence: brand campaigns vs regular social content, plus
 * the free, login-free discovery helpers that feed them.
 *
 * Definition (Bayu, 17 Nov 2026): a CAMPAIGN is brand-level communication with
 * a named idea or tagline (brand comm), usually a hashtag, and a content
 * format/execution. Example: Gojek "Bersama Pasti Ada Jalan", #PastiAdaJalan,
 * executed as short inspiring-story videos. Giveaways, quizzes, and
 * educational posts are regular social content, summarized by pattern.
 *
 * Pure: no database, no network, no secrets. Safe to import from the browser.
 */
import * as cheerio from 'cheerio';
import { extractJson, inWindow, normalizeDate, refsFor, toRef, type ActivityWindow, type IntelSource, type SourceRef } from './intel';

export interface CampaignItem {
  name: string;
  /** Tagline / brand comm line, e.g. "Bersama Pasti Ada Jalan". Empty when no source states one. */
  brandComm: string;
  hashtags: string[];
  /** Content format / execution, e.g. "Short inspiring-story Reels". */
  format: string;
  /** Free text period as the sources state it, e.g. "Oct–Nov 2026" or "ongoing". */
  period: string;
  channels: string[];
  summary: string;
  date: string | null;
  month: string | null;
  sources: SourceRef[];
}

export const CONTENT_PATTERNS = ['giveaway', 'quiz', 'education', 'promo', 'other'] as const;
export type ContentPattern = (typeof CONTENT_PATTERNS)[number];
export const CONTENT_PATTERN_LABELS: Record<ContentPattern, string> = {
  giveaway: 'Giveaways',
  quiz: 'Quizzes / challenges',
  education: 'Educational content',
  promo: 'Trading promos / bonuses',
  other: 'Other recurring content',
};

export interface RegularContentItem {
  pattern: ContentPattern;
  /** One line describing the pattern, e.g. "Weekly Friday giveaway Reels". */
  summary: string;
  examples: string[];
  sources: SourceRef[];
}

/* ---------------- hashtags ---------------- */

/** Unique hashtags in order of first use, with the leading #. Unicode letters allowed. */
export function extractHashtags(text: string | null | undefined, max = 12): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/(^|[^\p{L}\p{N}_&/])#([\p{L}\p{N}_]{2,60})/gu)) {
    const tag = `#${match[2]}`;
    const key = tag.toLowerCase();
    if (/^#\d+$/.test(tag) || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

/* ---------------- Instagram public post pages ---------------- */

const IG_POST = /^https?:\/\/(?:www\.|m\.)?instagram\.com\/(?:([A-Za-z0-9._]{1,30})\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,40})/i;

export function isInstagramPostUrl(url: string | null | undefined): boolean {
  return Boolean(url && IG_POST.test(url.trim()));
}

/** https://www.instagram.com/p/<code>/ — the public post page (no login needed for its preview tags). */
export function canonicalInstagramPostUrl(url: string): string | null {
  const match = url.trim().match(IG_POST);
  return match ? `https://www.instagram.com/p/${match[3]}/` : null;
}

/** The official public embed with caption, used when the post page has no preview tags. */
export function instagramEmbedUrl(url: string): string | null {
  const match = url.trim().match(IG_POST);
  return match ? `https://www.instagram.com/p/${match[3]}/embed/captioned/` : null;
}

export interface InstagramPost {
  url: string;
  account: string | null;
  date: string | null;
  caption: string;
  hashtags: string[];
  mentions: string[];
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** "November 1, 2026" -> "2026-11-01" without going through the server's time zone. */
function englishDate(value: string): string | null {
  const match = value.match(/^([A-Za-z]+) (\d{1,2}), (\d{4})$/);
  const month = match ? MONTHS.indexOf(match[1].toLowerCase()) : -1;
  if (!match || month < 0) return null;
  return normalizeDate(`${match[3]}-${String(month + 1).padStart(2, '0')}-${match[2].padStart(2, '0')}`);
}

const mentionsIn = (text: string) => [...new Set([...text.matchAll(/(^|[^\w.])@([A-Za-z0-9._]{2,30})/g)].map(match => `@${match[2].replace(/\.$/, '')}`))].slice(0, 12);

/**
 * Reads the caption, account, and date from a public post page's preview tags
 * (og:description: `818 likes, 141 comments - gojekindonesia on November 1, 2026: "caption".`).
 * Returns null when the page carries no caption (login wall, removed post).
 */
export function parseInstagramPostPage(url: string, html: string): InstagramPost | null {
  const $ = cheerio.load(html);
  const description = ($('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '').trim();
  const title = ($('meta[property="og:title"]').attr('content') || '').trim();
  let account: string | null = null;
  let date: string | null = null;
  let caption = '';
  const full = description.match(/^(?:[\d.,]+[KkMm]? likes?, [\d.,]+[KkMm]? comments? - )?([A-Za-z0-9._]{1,30}) on ([A-Z][a-z]+ \d{1,2}, \d{4}): ["“]([\s\S]*?)["”]\.?\s*$/);
  if (full) {
    account = full[1];
    date = englishDate(full[2]);
    caption = full[3];
  } else {
    const fromTitle = title.match(/^(.+?) on Instagram: ["“]([\s\S]*?)["”]?\s*$/);
    if (fromTitle) caption = fromTitle[2];
  }
  caption = caption.replace(/\r\n?/g, '\n').trim();
  if (!caption) return null;
  const ogUrl = $('meta[property="og:url"]').attr('content') || '';
  if (!account) account = ogUrl.match(/instagram\.com\/([A-Za-z0-9._]{1,30})\/(?:p|reel)\//i)?.[1] ?? null;
  return { url: canonicalInstagramPostUrl(url) || url, account, date, caption: caption.slice(0, 2_200), hashtags: extractHashtags(caption), mentions: mentionsIn(caption) };
}

/** Caption from the public /embed/captioned/ page. No date there. */
export function parseInstagramEmbed(url: string, html: string): InstagramPost | null {
  const $ = cheerio.load(html);
  const box = $('.Caption').first();
  if (!box.length) return null;
  const account = box.find('.CaptionUsername').first().text().trim() || null;
  box.find('.CaptionUsername, .CaptionComments').remove();
  box.find('br').replaceWith('\n');
  const caption = box.text().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!caption) return null;
  return { url: canonicalInstagramPostUrl(url) || url, account, date: null, caption: caption.slice(0, 2_200), hashtags: extractHashtags(caption), mentions: mentionsIn(caption) };
}

/** Plain text stored as evidence `extracted_text` and given to the model. */
export function instagramPostText(post: InstagramPost): string {
  return [
    `Instagram post${post.account ? ` by @${post.account}` : ''}${post.date ? ` on ${post.date}` : ''}`,
    `Caption: ${post.caption}`,
    post.hashtags.length ? `Hashtags: ${post.hashtags.join(' ')}` : '',
    post.mentions.length ? `Mentions: ${post.mentions.join(' ')}` : '',
  ].filter(Boolean).join('\n');
}

/** "Instagram post by @x on 2026-11-01" -> 2026-11-01, so link evidence gets a date without a manual "observed on". */
export function dateFromExtractedText(text: string | null | undefined): string | null {
  const match = text?.match(/^Instagram post(?: by @[A-Za-z0-9._]+)? on (\d{4}-\d{2}-\d{2})/m);
  return match ? normalizeDate(match[1]) : null;
}

/* ---------------- brand hubs (sibling subdomains linked from the site) ---------------- */

/** "www.mifx.com" -> "mifx.com"; keeps two labels, or three for co.id / com.au style suffixes. */
export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const second = parts[parts.length - 2];
  const take = ['co', 'com', 'or', 'ac', 'go', 'net', 'org', 'web', 'my', 'biz'].includes(second) && parts[parts.length - 1].length === 2 ? 3 : 2;
  return parts.slice(-take).join('.');
}

const SKIP_HUB = /^(client|clients|my|portal|app|apps|login|signin|secure|account|accounts|auth|trade|webtrader|mt4|mt5|careers?|jobs|karir|cdn|static|assets|img|images|api|status|mail)\./i;
const HELP_HUB = /^(support|help|helpdesk|faq|bantuan|hc)\./i;

export interface BrandHub { kind: 'help-center' | 'landing'; url: string }

/**
 * Links from the crawled pages to sibling subdomains of the same brand domain
 * (for example support.mifx.com or get.mifx.com). Login, client-area, and
 * careers hosts are skipped. Nothing is guessed: only linked URLs are returned.
 */
export function findBrandHubs(pages: Array<{ url: string; html: string }>, website: string, max = 6): BrandHub[] {
  let siteHost = '';
  try { siteHost = new URL(website).hostname.toLowerCase(); } catch { return []; }
  const domain = registrableDomain(siteHost);
  const hubs = new Map<string, BrandHub>();
  for (const page of pages) {
    for (const match of page.html.matchAll(/href=["'](https?:\/\/[^"'#\s]+)["']/gi)) {
      let url: URL;
      try { url = new URL(match[1].replace(/&amp;/g, '&')); } catch { continue; }
      const host = url.hostname.toLowerCase();
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
      if (host === siteHost || host === `www.${domain}` || host === domain) continue;
      if (!host.endsWith(`.${domain}`) || SKIP_HUB.test(host)) continue;
      const help = HELP_HUB.test(host) || /\/hc(\/|$)/.test(url.pathname);
      const key = help ? `help:${host}` : `${host}${url.pathname}`;
      if (hubs.has(key)) continue;
      hubs.set(key, help ? { kind: 'help-center', url: `${url.origin}${url.pathname.match(/^\/hc\/[A-Za-z-]+/)?.[0] ?? '/hc'}` } : { kind: 'landing', url: `${url.origin}${url.pathname}` });
      if (hubs.size >= max) break;
    }
  }
  return [...hubs.values()];
}

/** Public Zendesk Help Center article list (no login), newest first. */
export function zendeskArticlesUrl(helpCenterUrl: string): string | null {
  try {
    const url = new URL(helpCenterUrl);
    const locale = url.pathname.match(/^\/hc\/([A-Za-z-]+)/)?.[1];
    return `${url.origin}/api/v2/help_center/${locale ? `${locale.toLowerCase()}/` : ''}articles.json?sort_by=created_at&sort_order=desc&per_page=50`;
  } catch {
    return null;
  }
}

/** Words in a title that point at a program, promo, or campaign (EN + ID). */
export const PROGRAM_PATTERN = /priority|program|promo|campaign|kampanye|bonus|cashback|reward|hadiah|undian|kompetisi|competition|championship|contest|lomba|giveaway|event|webinar|launch|luncur|baru|new|exclusive|eksklusif|member|loyalty|vip|hub/i;

export interface HelpArticle { title: string; url: string; createdAt: string | null; updatedAt: string | null; excerpt: string }

/**
 * Keeps help-center articles that are new in the window, plus program-like
 * articles (by title) that were updated in the window: ongoing programs such
 * as a loyalty tier stay visible. How-to FAQs created long ago are dropped.
 */
export function parseZendeskArticles(raw: unknown, window: ActivityWindow, max = 8): HelpArticle[] {
  const body = extractJson(raw);
  const list = Array.isArray(body?.articles) ? body.articles as Array<Record<string, unknown>> : [];
  const out: HelpArticle[] = [];
  for (const article of list) {
    const title = typeof article.title === 'string' ? article.title.trim() : '';
    const url = typeof article.html_url === 'string' ? article.html_url : '';
    if (!title || !/^https:\/\//.test(url) || article.draft === true) continue;
    const createdAt = normalizeDate(article.created_at);
    const updatedAt = normalizeDate(article.updated_at);
    const isNew = inWindow(createdAt, window);
    const isProgram = PROGRAM_PATTERN.test(title) && !/\?\s*$/.test(title) && inWindow(updatedAt, window);
    if (!isNew && !isProgram) continue;
    const text = typeof article.body === 'string' ? cheerio.load(article.body).text().replace(/\s+/g, ' ').trim() : '';
    out.push({ title: title.slice(0, 200), url, createdAt, updatedAt, excerpt: text.slice(0, 900) });
    if (out.length >= max) break;
  }
  return out;
}

/* ---------------- model output ---------------- */

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const strings = (value: unknown, max: number, each = 60) => (Array.isArray(value) ? value.map(item => text(item, each)).filter(Boolean).slice(0, max) : []);

const REGULAR_ONLY = /giveaway|give away|kuis|quiz|trivia|tebak|challenge|edukasi|education|educational|tips|tutorial|belajar|webinar|q&a|live session|market update|analisa harian|daily analysis/i;

function patternOf(value: string): ContentPattern {
  if (/giveaway|give away|undian|hadiah/i.test(value)) return 'giveaway';
  if (/kuis|quiz|trivia|tebak|challenge/i.test(value)) return 'quiz';
  if (/edukasi|education|tips|tutorial|belajar|webinar|analysis|analisa|market update/i.test(value)) return 'education';
  if (/promo|bonus|cashback|rebate|deposit|poin|points|reward|lot/i.test(value)) return 'promo';
  return 'other';
}

/**
 * Campaign guard. A campaign needs a name, a cited source, and at least a
 * brand comm line or a hashtag. Anything that is really a giveaway, quiz, or
 * educational post with no brand comm is moved to regular content.
 */
export function parseCampaignSections(body: Record<string, unknown> | null, sources: IntelSource[], window: ActivityWindow): { campaigns: CampaignItem[]; regularContent: RegularContentItem[] } {
  const campaigns: CampaignItem[] = [];
  const regular: RegularContentItem[] = [];
  if (!body) return { campaigns, regularContent: regular };
  const byId = new Map(sources.map(source => [source.id, source]));
  const addRegular = (pattern: ContentPattern, summary: string, examples: string[], refs: SourceRef[]) => {
    const existing = regular.find(item => item.pattern === pattern);
    if (existing) {
      if (summary && !existing.summary.includes(summary)) existing.summary = `${existing.summary}${existing.summary ? ' ' : ''}${summary}`.slice(0, 600);
      existing.examples = [...new Set([...existing.examples, ...examples])].slice(0, 6);
      for (const ref of refs) if (!existing.sources.some(source => source.id === ref.id)) existing.sources.push(ref);
      return;
    }
    regular.push({ pattern, summary: summary.slice(0, 600), examples: examples.slice(0, 6), sources: refs });
  };

  for (const entry of Array.isArray(body.campaigns) ? body.campaigns : []) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const name = text(record.name, 120);
    const cited = refsFor(record.sourceIds, byId);
    if (!name || !cited.length) continue;
    const brandComm = text(record.brandComm, 200);
    const citedText = cited.map(source => `${source.title} ${source.excerpt}`).join(' ');
    // Only hashtags that appear in a cited source survive; the model must not invent them.
    const hashtags = strings(record.hashtags, 8).map(tag => (tag.startsWith('#') ? tag : `#${tag}`))
      .filter(tag => citedText.toLowerCase().includes(tag.toLowerCase()));
    const format = text(record.format, 200);
    const summary = text(record.summary, 600);
    if (!brandComm && !hashtags.length) {
      addRegular(patternOf(`${name} ${format} ${summary}`), summary || name, [name], cited.map(toRef));
      continue;
    }
    if (!brandComm && REGULAR_ONLY.test(`${name} ${format}`)) {
      addRegular(patternOf(`${name} ${format}`), summary || name, [name], cited.map(toRef));
      continue;
    }
    const citedDates = cited.map(source => source.date).filter((date): date is string => Boolean(date));
    const inside = citedDates.filter(date => inWindow(date, window)).sort();
    let date = normalizeDate(record.date);
    if (date && !inWindow(date, window)) date = null;
    if (!date && inside.length) date = inside[inside.length - 1];
    campaigns.push({
      name, brandComm, hashtags, format, summary,
      period: text(record.period, 80),
      channels: strings(record.channels, 6, 40),
      date, month: date ? date.slice(0, 7) : null,
      sources: cited.map(toRef),
    });
    if (campaigns.length >= 20) break;
  }

  for (const entry of Array.isArray(body.regularContent) ? body.regularContent : []) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const cited = refsFor(record.sourceIds, byId);
    const summary = text(record.summary, 400);
    if (!cited.length || !summary) continue;
    const raw = text(record.pattern, 20).toLowerCase();
    const pattern = (CONTENT_PATTERNS as readonly string[]).includes(raw) ? raw as ContentPattern : patternOf(summary);
    addRegular(pattern, summary, strings(record.examples, 6, 120), cited.map(toRef));
  }
  regular.sort((a, b) => CONTENT_PATTERNS.indexOf(a.pattern) - CONTENT_PATTERNS.indexOf(b.pattern));
  return { campaigns, regularContent: regular };
}

/** Prompt block with the definition and few-shot examples. */
export const CAMPAIGN_DEFINITION = [
  'CAMPAIGN vs REGULAR SOCIAL CONTENT (most important rule):',
  '- A CAMPAIGN is brand-level communication built around a NAMED idea: a campaign/program name or tagline (brand comm), usually a hashtag, and a content format/execution that carries it across posts or channels.',
  '- A named program launched as a brand idea (for example a premium/loyalty tier announced with its own name and tagline, or a hashtag movement) IS a campaign when sources show its own name plus a tagline or hashtag.',
  '- REGULAR SOCIAL CONTENT is everyday posting: giveaways, quizzes/tebak-tebakan, educational tips, market updates, webinars, generic trading promos/bonuses. Summarize these by pattern under regularContent; never list them as campaigns.',
  '- Never invent a tagline or hashtag. brandComm and hashtags must be quoted from the sources; leave brandComm "" and hashtags [] when the sources do not state them.',
  '',
  'Example A (campaign): an Instagram post by @gojekindonesia: "...sekaligus sebagai pengingat Bersama, #PastiAdaJalan" told as short inspiring stories of kindness between drivers, merchants and customers ->',
  '{"name":"Bersama Pasti Ada Jalan","brandComm":"Bersama Pasti Ada Jalan","hashtags":["#PastiAdaJalan"],"format":"Short inspiring-story content (Reels) about everyday kindness; batik art collaboration","period":"Nov 2026","channels":["Instagram"],"summary":"Brand platform about togetherness, told through real stories.","sourceIds":["E1"]}',
  'Example B (regular content, NOT a campaign): "GIVEAWAY! Tebak harga emas besok, 3 pemenang dapat saldo trading" ->',
  'regularContent: {"pattern":"giveaway","summary":"Recurring guess-the-price giveaways with trading-balance prizes.","examples":["Tebak harga emas giveaway"],"sourceIds":["S3"]}',
].join('\n');

/* ---------------- treg Instagram posts (optional, paid) ---------------- */

export interface InstagramFeedPost extends InstagramPost {
  /** reel, carousel, photo, video — as the provider names it. */
  kind: string | null;
}

function postDate(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return normalizeDate(new Date((value > 1e12 ? value : value * 1000)).toISOString());
  if (typeof value === 'string' && /^\d{9,13}$/.test(value)) return postDate(Number(value));
  return normalizeDate(value);
}

function captionOf(post: Record<string, unknown>): string {
  const caption = post.caption;
  if (typeof caption === 'string') return caption;
  if (caption && typeof caption === 'object' && typeof (caption as Record<string, unknown>).text === 'string') return (caption as { text: string }).text;
  const edges = (post.edge_media_to_caption as { edges?: Array<{ node?: { text?: string } }> } | undefined)?.edges;
  if (edges?.[0]?.node?.text) return edges[0].node.text;
  for (const key of ['text', 'description', 'title']) if (typeof post[key] === 'string') return post[key] as string;
  return '';
}

/**
 * Posts from `treg.instagram.user.posts`. treg returns provider-native objects
 * in `output.posts`, so field names differ per provider; this reads the
 * common ones (caption/text, taken_at/timestamp, url/code, owner/username).
 */
export function parseTregInstagramPosts(raw: unknown, max = 12): InstagramFeedPost[] {
  const body = extractJson(raw);
  const output = body?.output && typeof body.output === 'object' ? body.output as Record<string, unknown> : body;
  const list = Array.isArray(output?.posts) ? output.posts : Array.isArray(output?.items) ? output.items : [];
  const posts: InstagramFeedPost[] = [];
  for (const entry of list as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const post = entry as Record<string, unknown>;
    const caption = captionOf(post).replace(/\r\n?/g, '\n').trim();
    const code = typeof post.code === 'string' ? post.code : typeof post.shortcode === 'string' ? post.shortcode : '';
    const rawUrl = typeof post.url === 'string' ? post.url : typeof post.permalink === 'string' ? post.permalink : code ? `https://www.instagram.com/p/${code}/` : '';
    const url = canonicalInstagramPostUrl(rawUrl) || '';
    if (!caption || !url) continue;
    const owner = post.owner;
    const account = typeof owner === 'string' ? owner : owner && typeof owner === 'object' && typeof (owner as Record<string, unknown>).username === 'string'
      ? (owner as { username: string }).username : typeof post.username === 'string' ? post.username : null;
    const kind = [post.kind, post.product_type, post.media_type, post.type].find(value => typeof value === 'string') as string | undefined;
    posts.push({
      url, account, kind: kind ?? null,
      date: postDate(post.taken_at ?? post.taken_at_timestamp ?? post.timestamp ?? post.created_at ?? post.date),
      caption: caption.slice(0, 2_200), hashtags: extractHashtags(caption), mentions: mentionsIn(caption),
    });
    if (posts.length >= max) break;
  }
  return posts;
}
