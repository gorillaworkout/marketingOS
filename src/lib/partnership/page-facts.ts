import * as cheerio from 'cheerio';
import { inWindow, normalizeDate, type ActivityWindow, type PageFacts } from './intel';

/** Words in a URL or title that suggest campaign, event, partner, product, or news activity (EN + ID). */
export const ACTIVITY_PATTERN = /promo|promotion|campaign|kampanye|bonus|cashback|rebate|contest|kompetisi|lomba|giveaway|hadiah|undian|event|acara|webinar|seminar|workshop|expo|sponsor|partner|kerja-?sama|kolaborasi|collab|affiliate|\bib\b|introducing|news|berita|press|siaran-pers|media|blog|artikel|article|announcement|pengumuman|launch|peluncuran|new-|baru|award|penghargaan/i;

export function extractPageFacts(url: string, html: string): PageFacts {
  const $ = cheerio.load(html);
  const pageTitle = $('meta[property="og:title"]').attr('content')?.trim() || $('title').first().text().trim();
  const heading = $('h1').first().text().replace(/\s+/g, ' ').trim();
  // Many broker sites reuse one <title> on every page; the H1 tells the pages apart.
  const title = heading && !pageTitle.toLowerCase().includes(heading.toLowerCase()) ? `${heading} — ${pageTitle}` : pageTitle;
  const description = ($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '').trim();
  const dateCandidates = [
    $('meta[property="article:published_time"]').attr('content'),
    $('meta[name="date"]').attr('content'),
    $('meta[itemprop="datePublished"]').attr('content'),
    $('time[datetime]').first().attr('datetime'),
  ];
  for (const script of $('script[type="application/ld+json"]').toArray()) {
    const match = $(script).text().match(/"datePublished"\s*:\s*"([^"]+)"/);
    if (match) dateCandidates.push(match[1]);
  }
  const publishedAt = dateCandidates.map(normalizeDate).find(Boolean) || null;
  $('script, style, noscript, nav, footer, header, svg').remove();
  const excerpt = $('main').text().trim() ? $('main').text() : $('body').text();
  return {
    url,
    title: title.replace(/\s+/g, ' ').slice(0, 200),
    description: description.replace(/\s+/g, ' ').slice(0, 300),
    publishedAt,
    excerpt: excerpt.replace(/\s+/g, ' ').trim().slice(0, 1_200),
  };
}

/** A page is kept when it looks like activity and is not dated before the window. */
export function isActivityPage(facts: PageFacts, window: ActivityWindow): boolean {
  if (facts.publishedAt && !inWindow(facts.publishedAt, window)) return false;
  let path = '';
  try { path = new URL(facts.url).pathname; } catch { path = ''; }
  if (facts.publishedAt) return true;
  return ACTIVITY_PATTERN.test(path) || ACTIVITY_PATTERN.test(facts.title);
}
