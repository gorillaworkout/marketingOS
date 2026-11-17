/**
 * Event Plan → 16:9 PPTX deck. Server only.
 *
 * Reuses the Partnership Proposal slide canvas and Dupoin art (warm paper,
 * light-blue blurs, Fira Sans, Dupoin Blue #2EB5C4, official logo file).
 * Each section is drawn only when the plan has data for it; long lists and
 * tables continue on extra slides instead of overflowing.
 */
import { PALETTE as C, dupoinLogo, imageSize } from './partnership/proposal-art';
import { createPptxCanvas, type Canvas } from './partnership/proposal-canvas';
import { verifiedFacts } from './partnership/proposal-facts';
import {
  buildEventPlanDeck,
  eventPlanPptxFilename,
  formatDeckDate,
  formatDeckIdr,
  type DeckBudgetRow,
  type EventPlanDeck,
  type EventPlanDeckInput,
} from './event-plan-deck';

export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const W = 960;
const LEFT = 64;
const CONTENT_W = W - LEFT * 2;
const TOP = 128;
const BOTTOM = 486;
const AREA_H = BOTTOM - TOP;
/** Our text measure is an estimate; keep a margin so PowerPoint never overflows. */
const SAFETY = 1.12;

type Logo = { data: Buffer; size: { width: number; height: number } };

interface Ctx {
  c: Canvas;
  deck: EventPlanDeck;
  logo: Logo;
  page: number;
}

/** Wrapped height estimate; heavier weights take wider glyphs. */
function measure(_ctx: Ctx, value: string, size: number, width: number, lineGap = 0, weight: 'regular' | 'semibold' = 'regular') {
  const charsPerLine = Math.max(1, Math.floor(width / (size * (weight === 'semibold' ? 0.58 : 0.5))));
  const lines = (value || ' ').split('\n').reduce((sum, part) => sum + Math.max(1, Math.ceil(part.length / charsPerLine)), 0);
  return lines * (size * 1.2 + lineGap) * SAFETY;
}

/** Largest size in `sizes` at which the text fits the box, or null. */
function fitSize(ctx: Ctx, value: string, width: number, height: number, sizes: number[], lineGap = 2, weight: 'regular' | 'semibold' = 'regular'): number | null {
  for (const size of sizes) if (measure(ctx, value, size, width, lineGap, weight) <= height) return size;
  return null;
}

/** Largest size at which a short value stays on one line (numbers, money). */
function fitLine(value: string, width: number, sizes: number[]): number {
  for (const size of sizes) if (value.length * size * 0.6 <= width) return size;
  return sizes[sizes.length - 1];
}

/** Splits text into chunks that each fit the box at `size`, on paragraph then sentence then word boundaries. */
function chunkText(ctx: Ctx, value: string, size: number, width: number, height: number, lineGap = 2): string[] {
  const pieces = value.split(/\n+/).flatMap(paragraph => paragraph.split(/(?<=[.!?])\s+/)).flatMap(sentence => {
    if (measure(ctx, sentence, size, width, lineGap) <= height) return [sentence];
    const words = sentence.split(/\s+/);
    const parts: string[] = [];
    let current = '';
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (current && measure(ctx, next, size, width, lineGap) > height) { parts.push(current); current = word; } else current = next;
    }
    if (current) parts.push(current);
    return parts;
  });
  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    const joiner = /[.!?]$/.test(current) ? ' ' : current ? '\n' : '';
    const next = current ? `${current}${joiner}${piece}` : piece;
    if (current && measure(ctx, next, size, width, lineGap) > height) { chunks.push(current); current = piece; } else current = next;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Greedy pagination by measured height. */
function paginate<T>(items: T[], heightOf: (item: T) => number, maxH: number, gap = 0): T[][] {
  const pages: T[][] = [];
  let page: T[] = [];
  let used = 0;
  for (const item of items) {
    const h = heightOf(item);
    if (page.length && used + h > maxH) { pages.push(page); page = []; used = 0; }
    page.push(item);
    used += h + gap;
  }
  if (page.length) pages.push(page);
  return pages;
}

async function slide(ctx: Ctx, kicker: string, title: string, cont = false) {
  const { c } = ctx;
  await c.newSlide('content');
  ctx.page += 1;
  c.text(kicker.toUpperCase(), { x: LEFT, y: 40, w: 600, h: 16, size: 11, weight: 'semibold', color: C.teal });
  c.text(cont ? `${title} (cont.)` : title, { x: LEFT, y: 58, w: 700, h: 40, size: 28, weight: 'semibold', color: C.ink });
  c.rect({ x: LEFT, y: 104, w: 44, h: 4, fill: C.teal, radius: 2 });
  c.image(ctx.logo.data, { x: W - LEFT - 92, y: 42, w: 92, h: 38 }, ctx.logo.size);
  c.line({ x1: LEFT, y1: 504, x2: W - LEFT, y2: 504, color: C.line, width: 0.8 });
  c.text(ctx.deck.eventName.length > 100 ? `${ctx.deck.eventName.slice(0, 99)}…` : ctx.deck.eventName, { x: LEFT, y: 512, w: 640, h: 16, size: 10, color: C.muted });
  c.text(String(ctx.page), { x: W - LEFT - 60, y: 512, w: 60, h: 16, size: 10, color: C.muted, align: 'right' });
}

function card(c: Canvas, x: number, y: number, w: number, h: number, fill = '#FFFFFF') {
  c.rect({ x, y, w, h, fill, opacity: fill === '#FFFFFF' ? 0.92 : 1, line: C.line, lineWidth: 0.8, radius: 10 });
}

/* ---------------- cover ---------------- */

async function cover(ctx: Ctx) {
  const { c, deck } = ctx;
  await c.newSlide('cover');
  ctx.page += 1;
  c.image(ctx.logo.data, { x: LEFT, y: 48, w: 132, h: 52 }, ctx.logo.size);
  const kicker = ['Event plan', deck.styleLabel].filter(Boolean).join('  ·  ').toUpperCase();
  c.text(kicker, { x: LEFT, y: 150, w: 600, h: 18, size: 13, weight: 'semibold', color: C.teal });
  const titleSize = fitSize(ctx, deck.eventName, 640, 156, [50, 44, 38, 32, 28, 24], 0, 'semibold') ?? 22;
  const titleH = Math.min(156, measure(ctx, deck.eventName, titleSize, 640, 0, 'semibold'));
  c.text(deck.eventName, { x: LEFT, y: 176, w: 640, h: 156, size: titleSize, weight: 'semibold', color: C.ink });
  c.rect({ x: LEFT, y: 186 + titleH, w: 64, h: 5, fill: C.teal, radius: 2 });
  if (deck.theme) c.text(deck.theme, { x: LEFT, y: 204 + titleH, w: 620, h: 48, size: 16, color: C.body });
  if (deck.targetDate) {
    const date = new Date(`${deck.targetDate}T00:00:00Z`);
    const day = String(date.getUTCDate());
    const month = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date).toUpperCase();
    const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(date).toUpperCase();
    c.rect({ x: 744, y: 150, w: 152, h: 184, fill: C.teal, radius: 16 });
    c.text(weekday, { x: 744, y: 168, w: 152, h: 16, size: 11, weight: 'semibold', color: '#FFFFFF', align: 'center' });
    c.text(day, { x: 744, y: 188, w: 152, h: 90, size: 72, weight: 'semibold', color: '#FFFFFF', align: 'center', valign: 'middle' });
    c.text(month, { x: 744, y: 284, w: 152, h: 22, size: 15, weight: 'semibold', color: '#FFFFFF', align: 'center' });
  }

  const facts = [
    ['Date', formatDeckDate(deck.targetDate)],
    ['Venue', deck.venue],
    ['Location', deck.location && deck.location !== deck.venue ? deck.location : ''],
    ['Participants', deck.participants ? `${deck.participants.toLocaleString('id-ID')} people` : ''],
  ].filter(([, value]) => value);
  if (facts.length) {
    const gap = 14;
    const w = (CONTENT_W - gap * (facts.length - 1)) / facts.length;
    facts.forEach(([label, value], index) => {
      const x = LEFT + index * (w + gap);
      card(c, x, 400, w, 82);
      c.rect({ x, y: 400, w: 5, h: 82, fill: C.teal });
      c.text(label.toUpperCase(), { x: x + 18, y: 412, w: w - 30, h: 14, size: 10, weight: 'semibold', color: C.tealDark });
      const size = fitSize(ctx, value, w - 30, 44, [15, 13.5, 12, 11], 1, 'semibold') ?? 10;
      c.text(value, { x: x + 18, y: 430, w: w - 30, h: 46, size, weight: 'semibold', color: C.ink, lineGap: 1 });
    });
  }
}

/* ---------------- overview ---------------- */

async function overview(ctx: Ctx) {
  const { c, deck } = ctx;
  const blocks = [['Objective', deck.objective], ['Concept', deck.concept]].filter(([, v]) => v) as Array<[string, string]>;
  if (!blocks.length) return;
  const themeH = deck.theme ? 40 : 0;
  const bodyTop = TOP + themeH;
  const bodyH = BOTTOM - bodyTop;
  const twoCol = blocks.length === 2;
  const colW = twoCol ? (CONTENT_W - 20) / 2 : CONTENT_W;
  const textW = colW - 44;
  const textH = bodyH - 64;
  // Same size for both columns, as large as fits.
  const size = [18, 17, 16, 15, 14, 13, 12].find(s => blocks.every(([, v]) => measure(ctx, v, s, textW, 3) <= textH));
  if (size) {
    await slide(ctx, 'Overview', 'Objective & concept');
    if (deck.theme) {
      c.rect({ x: LEFT, y: TOP - 4, w: CONTENT_W, h: 30, fill: C.tealSoft, radius: 15 });
      c.text(`Theme: ${deck.theme}`, { x: LEFT + 18, y: TOP - 4, w: CONTENT_W - 36, h: 30, size: 12.5, weight: 'semibold', color: C.tealDark, valign: 'middle' });
    }
    blocks.forEach(([label, value], index) => {
      const x = LEFT + index * (colW + 20);
      card(c, x, bodyTop, colW, bodyH);
      c.ellipse({ x: x + 22, y: bodyTop + 20, w: 26, h: 26, fill: C.teal });
      c.text(String(index + 1).padStart(2, '0'), { x: x + 22, y: bodyTop + 20, w: 26, h: 26, size: 10, weight: 'bold', color: '#FFFFFF', align: 'center', valign: 'middle' });
      c.text(label, { x: x + 58, y: bodyTop + 20, w: colW - 80, h: 26, size: 17, weight: 'semibold', color: C.ink, valign: 'middle' });
      c.text(value, { x: x + 22, y: bodyTop + 58, w: textW, h: textH, size, color: C.body, lineGap: 3 });
    });
    return;
  }
  // Too long for one slide: each block gets full-width slides of its own.
  for (const [label, value] of blocks) {
    const fullSize = fitSize(ctx, value, CONTENT_W - 44, AREA_H - 40, [20, 18, 17, 16, 15, 14], 3) ?? 14;
    const chunks = chunkText(ctx, value, fullSize, CONTENT_W - 44, AREA_H - 40, 3);
    for (const [index, chunk] of chunks.entries()) {
      await slide(ctx, 'Overview', label, index > 0);
      card(c, LEFT, TOP, CONTENT_W, AREA_H);
      c.text(chunk, { x: LEFT + 22, y: TOP + 20, w: CONTENT_W - 44, h: AREA_H - 40, size: fullSize, color: C.body, lineGap: 3 });
    }
  }
}

/* ---------------- at a glance ---------------- */

async function glance(ctx: Ctx) {
  const { c, deck } = ctx;
  const stats = [
    deck.participants ? ['Target participants', deck.participants.toLocaleString('id-ID'), 'people'] : null,
    deck.speakers.length ? ['Speakers', String(deck.speakers.length), deck.speakers.length === 1 ? 'confirmed name' : 'named in the plan'] : null,
    deck.targetDate ? ['Event date', formatDeckDate(deck.targetDate), ''] : null,
    deck.budget?.total ? ['Planned budget', formatDeckIdr(deck.budget.total), 'from the budget table'] : null,
  ].filter(Boolean) as string[][];
  if (!deck.participants) return; // Only an audience slide when the plan sets a participant count.
  await slide(ctx, 'Audience & participants', 'Event at a glance');
  const gap = 16;
  const w = (CONTENT_W - gap * (stats.length - 1)) / stats.length;
  stats.forEach(([label, value, note], index) => {
    const x = LEFT + index * (w + gap);
    const primary = index === 0;
    c.rect({ x, y: TOP + 10, w, h: 170, fill: primary ? C.teal : '#FFFFFF', opacity: primary ? 1 : 0.92, line: primary ? undefined : C.line, lineWidth: 0.8, radius: 12 });
    const color = primary ? '#FFFFFF' : C.ink;
    c.text(label.toUpperCase(), { x: x + 20, y: TOP + 30, w: w - 40, h: 16, size: 10.5, weight: 'semibold', color: primary ? '#FFFFFF' : C.tealDark });
    const size = /^[\d.,Rp ]+$/.test(value) ? fitLine(value, w - 40, [48, 40, 32, 26, 22, 18, 16]) : fitSize(ctx, value, w - 40, 80, [30, 26, 22, 18], 0, 'semibold') ?? 16;
    c.text(value, { x: x + 20, y: TOP + 56, w: w - 40, h: 86, size, weight: 'semibold', color, valign: 'middle' });
    if (note) c.text(note, { x: x + 20, y: TOP + 148, w: w - 40, h: 16, size: 11, color: primary ? '#FFFFFF' : C.muted });
  });
  const lines = [
    deck.venue ? `Venue: ${deck.venue}` : '',
    deck.location ? `Location: ${deck.location}` : '',
    deck.theme ? `Theme: ${deck.theme}` : '',
  ].filter(Boolean);
  if (lines.length) {
    card(c, LEFT, TOP + 204, CONTENT_W, AREA_H - 214);
    c.text('Planning basis', { x: LEFT + 24, y: TOP + 222, w: 400, h: 20, size: 14, weight: 'semibold', color: C.ink });
    c.bullets(lines, { x: LEFT + 24, y: TOP + 250, w: CONTENT_W - 48, h: AREA_H - 270, size: 13, color: C.body, gap: 6 });
  }
}

/* ---------------- speakers ---------------- */

function initials(name: string) {
  const parts = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2)).toUpperCase();
}

async function speakers(ctx: Ctx) {
  const { c, deck } = ctx;
  const perPage = 8;
  for (let start = 0; start < deck.speakers.length; start += perPage) {
    const page = deck.speakers.slice(start, start + perPage);
    await slide(ctx, 'Line-up', 'Speakers', start > 0);
    const cols = page.length <= 4 ? page.length : Math.ceil(page.length / 2);
    const rows = Math.ceil(page.length / cols);
    const gap = 16;
    const w = Math.min(260, (CONTENT_W - gap * (cols - 1)) / cols);
    const h = rows === 1 ? 220 : 168;
    page.forEach((name, index) => {
      const row = Math.floor(index / cols);
      const inRow = Math.min(cols, page.length - row * cols);
      const rowStart = LEFT + (CONTENT_W - (inRow * w + (inRow - 1) * gap)) / 2;
      const x = rowStart + (index % cols) * (w + gap);
      const y = TOP + 10 + row * (h + gap) + (rows === 1 ? 40 : 0);
      card(c, x, y, w, h);
      const r = rows === 1 ? 44 : 34;
      c.ellipse({ x: x + w / 2 - r, y: y + 22, w: r * 2, h: r * 2, fill: C.tealSoft });
      c.text(initials(name), { x: x + w / 2 - r, y: y + 22, w: r * 2, h: r * 2, size: rows === 1 ? 26 : 20, weight: 'semibold', color: C.tealDark, align: 'center', valign: 'middle' });
      const nameY = y + 34 + r * 2;
      const size = fitSize(ctx, name, w - 28, h - (nameY - y) - 12, [16, 14, 12.5, 11], 1, 'semibold') ?? 10;
      c.text(name, { x: x + 14, y: nameY, w: w - 28, h: h - (nameY - y) - 10, size, weight: 'semibold', color: C.ink, align: 'center', lineGap: 1 });
    });
  }
}

/* ---------------- rundown ---------------- */

const TABLE_STYLE = { headFill: C.teal, headColor: '#FFFFFF', lineColor: C.line, bodyColor: C.ink } as const;

function rowHeight(ctx: Ctx, cells: string[], colW: number[], size: number, padding: number) {
  return Math.max(...cells.map((cell, i) => measure(ctx, cell, size, colW[i] - padding * 2) + padding * 2));
}

async function rundown(ctx: Ctx) {
  const { c, deck } = ctx;
  if (!deck.rundown.length) return;
  const hasTimes = deck.rundown.some(item => item.time);
  const colW = hasTimes ? [170, CONTENT_W - 170] : [CONTENT_W];
  const size = 14;
  const padding = 8;
  const head = hasTimes ? ['Time', 'Activity'] : ['Activity'];
  const rows = deck.rundown.map(item => (hasTimes ? [item.time || '—', item.activity] : [item.activity]));
  const headH = rowHeight(ctx, head, colW, size, padding);
  const pages = paginate(rows, row => rowHeight(ctx, row, colW, size, padding), AREA_H - headH - 10);
  for (const [index, page] of pages.entries()) {
    await slide(ctx, 'Run of show', 'Rundown & agenda', index > 0);
    c.table([head, ...page], { x: LEFT, y: TOP, colW, size, padding, ...TABLE_STYLE, align: hasTimes ? ['left', 'left'] : ['left'] });
  }
}

/* ---------------- venue ---------------- */

async function venue(ctx: Ctx) {
  const { c, deck } = ctx;
  if (!deck.venue) return;
  await slide(ctx, 'Venue', 'Venue & logistics');
  const venueRows = (deck.budget?.rows || []).filter(row => /venue|tempat|gedung|hall|ballroom/i.test(row.category)).slice(0, 4);
  const leftW = venueRows.length ? 400 : CONTENT_W;
  c.rect({ x: LEFT, y: TOP, w: leftW, h: AREA_H, fill: C.teal, radius: 14 });
  c.text('VENUE', { x: LEFT + 28, y: TOP + 28, w: leftW - 56, h: 16, size: 11, weight: 'semibold', color: '#FFFFFF' });
  const size = fitSize(ctx, deck.venue, leftW - 56, 170, [30, 26, 22, 18, 15], 0, 'semibold') ?? 13;
  c.text(deck.venue, { x: LEFT + 28, y: TOP + 52, w: leftW - 56, h: 176, size, weight: 'semibold', color: '#FFFFFF' });
  const meta = [
    deck.location ? ['Location', deck.location] : null,
    deck.participants ? ['Planned for', `${deck.participants.toLocaleString('id-ID')} participants`] : null,
    deck.targetDate ? ['Date', formatDeckDate(deck.targetDate)] : null,
  ].filter(Boolean) as string[][];
  meta.forEach(([label, value], index) => {
    const y = TOP + 244 + index * 36;
    c.text(label.toUpperCase(), { x: LEFT + 28, y, w: 120, h: 30, size: 10, weight: 'semibold', color: '#E5F6F8', valign: 'middle' });
    c.text(value, { x: LEFT + 150, y, w: leftW - 178, h: 30, size: 13, weight: 'semibold', color: '#FFFFFF', valign: 'middle' });
  });
  if (!venueRows.length) return;
  const x = LEFT + leftW + 20;
  const w = CONTENT_W - leftW - 20;
  c.text('Venue lines in the budget', { x, y: TOP, w, h: 22, size: 15, weight: 'semibold', color: C.ink });
  const boxH = Math.min(120, (AREA_H - 34 - 10 * (venueRows.length - 1)) / venueRows.length);
  venueRows.forEach((row, index) => {
    const y = TOP + 34 + index * (boxH + 10);
    card(c, x, y, w, boxH);
    c.text(row.source === 'quotation' ? 'QUOTATION' : 'AI ESTIMATE', { x: x + 16, y: y + 12, w: 140, h: 14, size: 9.5, weight: 'semibold', color: C.tealDark });
    c.text(formatDeckIdr(row.amount, row.currency), { x: x + w - 216, y: y + 10, w: 200, h: 20, size: 15, weight: 'semibold', color: C.ink, align: 'right' });
    const detail = [row.vendor, row.description].filter(Boolean).join(' — ');
    const textH = boxH - 44;
    const s = fitSize(ctx, detail, w - 32, textH, [12, 11, 10], 1) ?? 9.5;
    c.text(detail, { x: x + 16, y: y + 36, w: w - 32, h: textH, size: s, color: C.body, lineGap: 1 });
  });
}

/* ---------------- budget ---------------- */

async function budgetSummary(ctx: Ctx) {
  const { c, deck } = ctx;
  const b = deck.budget;
  if (!b) return;
  const cards = [
    b.total !== null ? ['Total budget', formatDeckIdr(b.total), b.quotationSubtotal !== null ? 'quotation + contingency + priced estimates' : 'priced lines only'] : null,
    b.quotationSubtotal !== null ? ['Confirmed quotation', formatDeckIdr(b.quotationSubtotal), 'subtotal, IDR rows'] : null,
    b.contingency !== null ? ['Contingency', formatDeckIdr(b.contingency), b.contingencyPercent !== null ? `${b.contingencyPercent}% of quotation` : ''] : null,
    b.estimateSubtotal !== null ? ['Priced estimates', formatDeckIdr(b.estimateSubtotal), 'public price found'] : null,
    b.unpricedCount ? ['Awaiting a quote', String(b.unpricedCount), b.unpricedCount === 1 ? 'line without a price' : 'lines without a price'] : null,
  ].filter(Boolean) as string[][];
  const byCategory = new Map<string, number>();
  for (const row of b.rows) if (row.amount !== null && row.currency === 'IDR') byCategory.set(row.category, (byCategory.get(row.category) || 0) + row.amount);
  const categories = [...byCategory.entries()].sort((a, z) => z[1] - a[1]).slice(0, 6);
  if (!cards.length && !categories.length) return;
  await slide(ctx, 'Budget', 'Budget summary (IDR)');
  let y = TOP;
  if (cards.length) {
    const gap = 12;
    const w = (CONTENT_W - gap * (cards.length - 1)) / cards.length;
    cards.forEach(([label, value, note], index) => {
      const x = LEFT + index * (w + gap);
      const primary = index === 0 && label === 'Total budget';
      c.rect({ x, y, w, h: 104, fill: primary ? C.teal : '#FFFFFF', opacity: primary ? 1 : 0.92, line: primary ? undefined : C.line, lineWidth: 0.8, radius: 10 });
      c.text(label.toUpperCase(), { x: x + 14, y: y + 14, w: w - 28, h: 14, size: 9.5, weight: 'semibold', color: primary ? '#FFFFFF' : C.tealDark });
      const size = fitSize(ctx, value, w - 28, 30, [20, 18, 16, 14, 12.5], 0) ?? 11;
      c.text(value, { x: x + 14, y: y + 34, w: w - 28, h: 32, size, weight: 'semibold', color: primary ? '#FFFFFF' : C.ink, valign: 'middle' });
      if (note) c.text(note, { x: x + 14, y: y + 70, w: w - 28, h: 28, size: 9.5, color: primary ? '#FFFFFF' : C.muted });
    });
    y += 124;
  }
  if (categories.length) {
    const max = Math.max(...categories.map(([, v]) => v));
    const panelH = Math.min(BOTTOM - y - 24 - (b.ceilingNote ? 24 : 0), 44 + categories.length * 30);
    card(c, LEFT, y, CONTENT_W, panelH);
    c.text('Where the money goes', { x: LEFT + 20, y: y + 12, w: 400, h: 20, size: 13, weight: 'semibold', color: C.ink });
    const rowH = Math.min(30, (panelH - 44) / categories.length);
    categories.forEach(([category, value], index) => {
      const ry = y + 40 + index * rowH;
      c.text(category, { x: LEFT + 20, y: ry, w: 170, h: rowH - 6, size: 12, weight: 'semibold', color: C.body, valign: 'middle' });
      const barMax = CONTENT_W - 20 - 190 - 200;
      c.rect({ x: LEFT + 196, y: ry + 6, w: barMax, h: rowH - 18, fill: C.tealSoft, radius: 4 });
      c.rect({ x: LEFT + 196, y: ry + 6, w: Math.max(6, barMax * (value / max)), h: rowH - 18, fill: C.teal, radius: 4 });
      c.text(formatDeckIdr(value), { x: W - LEFT - 196, y: ry, w: 180, h: rowH - 6, size: 12, weight: 'semibold', color: C.ink, align: 'right', valign: 'middle' });
    });
    y += panelH + 10;
  }
  if (b.ceilingNote) { c.text(b.ceilingNote, { x: LEFT, y, w: CONTENT_W, h: 22, size: 11, color: '#B45309' }); y += 24; }
  if (y <= BOTTOM - 16) c.text('Quotation rows are confirmed vendor prices. AI estimates show a price only when a public source states one.', { x: LEFT, y: Math.max(y, BOTTOM - 16), w: CONTENT_W, h: 16, size: 10, color: C.muted });
}

function budgetCells(row: DeckBudgetRow): string[] {
  return [
    `${row.category}\n${row.source === 'quotation' ? 'Quotation' : 'AI estimate'}`,
    row.vendor || '—',
    row.description || '—',
    row.qty !== null ? row.qty.toLocaleString('id-ID') : '—',
    row.unitPrice !== null ? formatDeckIdr(row.unitPrice, row.currency) : '—',
    formatDeckIdr(row.amount, row.currency),
  ];
}

async function budgetTable(ctx: Ctx) {
  const { c, deck } = ctx;
  const b = deck.budget;
  if (!b?.rows.length) return;
  const colW = [112, 170, 274, 46, 110, 120];
  const size = 10;
  const padding = 4;
  const head = ['Category', 'Vendor', 'Item / notes', 'Qty', 'Unit price', 'Amount'];
  const align: Array<'left' | 'right'> = ['left', 'left', 'left', 'right', 'right', 'right'];
  const totals = [
    b.quotationSubtotal !== null ? ['Quotation subtotal', formatDeckIdr(b.quotationSubtotal)] : null,
    b.contingency !== null ? [`Contingency${b.contingencyPercent !== null ? ` (${b.contingencyPercent}%)` : ''}`, formatDeckIdr(b.contingency)] : null,
    b.estimateSubtotal !== null ? ['Priced estimates', formatDeckIdr(b.estimateSubtotal)] : null,
    b.total !== null ? ['Total', formatDeckIdr(b.total)] : null,
  ].filter(Boolean) as string[][];
  const stripH = totals.length ? 58 : 0;
  // Table rows grow to fit text in PowerPoint, so measure without the extra text margin.
  const heightOf = (row: string[]) => Math.max(...row.map((cell, i) => ctx.c.measure(cell, size, colW[i] - padding * 2) + padding * 2));
  const headH = heightOf(head);
  const rows = b.rows.map(budgetCells);
  const maxH = AREA_H - headH - 4;
  const pages = paginate(rows, heightOf, maxH);
  // The totals strip sits under the last table slide; start a new slide when it would not fit.
  const last = pages[pages.length - 1];
  if (totals.length && last.reduce((sum, row) => sum + heightOf(row), 0) + stripH + 12 > maxH) {
    const moved: string[][] = [];
    while (last.length > 1 && last.reduce((sum, row) => sum + heightOf(row), 0) + stripH + 12 > maxH) moved.unshift(last.pop()!);
    pages.push(moved);
  }
  for (const [index, page] of pages.entries()) {
    await slide(ctx, 'Budget', 'Budget breakdown (IDR)', index > 0);
    let height = 0;
    if (page.length) height = c.table([head, ...page], { x: LEFT, y: TOP, colW, size, padding, ...TABLE_STYLE, align });
    if (index === pages.length - 1 && totals.length) {
      const y = Math.min(TOP + height + 12, BOTTOM - stripH);
      const gap = 10;
      const w = (CONTENT_W - gap * (totals.length - 1)) / totals.length;
      totals.forEach(([label, value], i) => {
        const x = LEFT + i * (w + gap);
        const strong = label === 'Total';
        c.rect({ x, y, w, h: stripH, fill: strong ? C.teal : C.tealCell, line: strong ? undefined : C.line, lineWidth: 0.8, radius: 8 });
        c.text(label.toUpperCase(), { x: x + 14, y: y + 9, w: w - 28, h: 14, size: 9.5, weight: 'semibold', color: strong ? '#FFFFFF' : C.tealDark });
        c.text(value, { x: x + 14, y: y + 25, w: w - 28, h: 24, size: fitLine(value, w - 28, [17, 15, 13, 12]), weight: 'semibold', color: strong ? '#FFFFFF' : C.ink, valign: 'middle' });
      });
    }
  }
}

/* ---------------- timeline ---------------- */

async function timeline(ctx: Ctx) {
  const { c, deck } = ctx;
  if (!deck.timeline.length) return;
  const hasLabels = deck.timeline.some(item => item.label);
  const labelW = hasLabels ? 120 : 0;
  const textW = CONTENT_W - 40 - labelW - 24;
  const size = 13;
  const heightOf = (item: { text: string }) => Math.max(30, measure(ctx, item.text, size, textW, 1) + 16);
  const pages = paginate(deck.timeline, heightOf, AREA_H - 10, 6);
  for (const [index, page] of pages.entries()) {
    await slide(ctx, 'Preparation', 'Timeline & checklist', index > 0);
    let y = TOP + 4;
    const lineX = LEFT + 12;
    const totalH = page.reduce((sum, item) => sum + heightOf(item) + 6, 0) - 6;
    c.line({ x1: lineX, y1: y + 10, x2: lineX, y2: y + totalH - 14, color: C.line, width: 2 });
    page.forEach(item => {
      const h = heightOf(item);
      c.ellipse({ x: lineX - 7, y: y + 6, w: 14, h: 14, fill: C.teal });
      c.ellipse({ x: lineX - 3, y: y + 10, w: 6, h: 6, fill: '#FFFFFF' });
      if (hasLabels && item.label) {
        c.rect({ x: LEFT + 40, y: y + 2, w: labelW - 10, h: 22, fill: C.tealSoft, radius: 11 });
        c.text(item.label, { x: LEFT + 44, y: y + 2, w: labelW - 18, h: 22, size: 10.5, weight: 'semibold', color: C.tealDark, align: 'center', valign: 'middle' });
      }
      c.text(item.text, { x: LEFT + 40 + labelW + (hasLabels ? 4 : 0), y: y + 4, w: textW, h: h - 6, size, color: C.ink, lineGap: 1 });
      y += h + 6;
    });
  }
}

/* ---------------- KPIs & risks ---------------- */

async function numberedCards(ctx: Ctx, items: string[], kicker: string, title: string, accent: string) {
  const { c } = ctx;
  if (!items.length) return;
  const colW = (CONTENT_W - 16) / 2;
  const size = 14;
  const textW = colW - 70;
  const heights = items.map(item => Math.max(72, measure(ctx, item, size, textW, 1) + 30));
  // Two columns; each slide holds as many rows as fit.
  const pairs: number[][] = [];
  for (let i = 0; i < items.length; i += 2) pairs.push(i + 1 < items.length ? [i, i + 1] : [i]);
  const pages = paginate(pairs, pair => Math.max(...pair.map(i => heights[i])), AREA_H, 12);
  for (const [index, page] of pages.entries()) {
    await slide(ctx, kicker, title, index > 0);
    let y = TOP;
    for (const pair of page) {
      const h = Math.max(...pair.map(i => heights[i]));
      pair.forEach((itemIndex, col) => {
        const x = LEFT + col * (colW + 16);
        card(c, x, y, colW, h);
        c.ellipse({ x: x + 16, y: y + h / 2 - 15, w: 30, h: 30, fill: accent });
        c.text(String(itemIndex + 1), { x: x + 16, y: y + h / 2 - 15, w: 30, h: 30, size: 12, weight: 'bold', color: '#FFFFFF', align: 'center', valign: 'middle' });
        c.text(items[itemIndex], { x: x + 58, y: y + 12, w: textW, h: h - 24, size, color: C.ink, lineGap: 1, valign: 'middle' });
      });
      y += h + 12;
    }
  }
}

/* ---------------- sources & closing ---------------- */

async function sources(ctx: Ctx) {
  const { c, deck } = ctx;
  if (!deck.sources.length) return;
  const perPage = 6;
  for (let start = 0; start < deck.sources.length; start += perPage) {
    const page = deck.sources.slice(start, start + perPage);
    await slide(ctx, 'Research', 'Budget research sources', start > 0);
    page.forEach((source, i) => {
      const y = TOP + i * 56;
      card(c, LEFT, y, CONTENT_W, 48);
      c.ellipse({ x: LEFT + 14, y: y + 12, w: 24, h: 24, fill: C.tealSoft });
      c.text(String(start + i + 1), { x: LEFT + 14, y: y + 12, w: 24, h: 24, size: 10, weight: 'bold', color: C.tealDark, align: 'center', valign: 'middle' });
      c.text(source.title || source.url, { x: LEFT + 50, y: y + 7, w: CONTENT_W - 70, h: 18, size: 12.5, weight: 'semibold', color: C.ink });
      c.text(source.url, { x: LEFT + 50, y: y + 26, w: CONTENT_W - 70, h: 16, size: 10.5, color: C.steel, link: source.url });
    });
    c.text('Public pages read for the budget. They are not a verified quotation.', { x: LEFT, y: BOTTOM - 14, w: CONTENT_W, h: 16, size: 10, color: C.muted });
  }
}

async function closing(ctx: Ctx) {
  const { c, deck } = ctx;
  await c.newSlide('divider');
  ctx.page += 1;
  const f = verifiedFacts(deck.language);
  c.text(deck.language === 'id' ? 'Terima kasih' : 'Thank you', { x: LEFT, y: 150, w: 700, h: 80, size: 60, weight: 'light', color: C.steel });
  const nameSize = fitSize(ctx, deck.eventName, 700, 70, [22, 19, 16, 14], 1, 'semibold') ?? 13;
  c.text(deck.eventName, { x: LEFT, y: 236, w: 700, h: 72, size: nameSize, weight: 'semibold', color: C.ink, lineGap: 1 });
  c.image(ctx.logo.data, { x: LEFT, y: 318, w: 130, h: 52 }, ctx.logo.size);
  c.rect({ x: LEFT, y: 404, w: CONTENT_W, h: 82, fill: C.tealSoft, radius: 10 });
  c.text(f.companyName, { x: LEFT + 20, y: 414, w: CONTENT_W - 40, h: 18, size: 12.5, weight: 'semibold', color: C.tealDark });
  c.text(f.regulatoryStatement, { x: LEFT + 20, y: 434, w: CONTENT_W - 40, h: 30, size: 11, color: C.body, lineGap: 1 });
  c.text(`${f.licenseLabel}: ${f.licenseNumber}`, { x: LEFT + 20, y: 464, w: CONTENT_W - 40, h: 16, size: 11, weight: 'semibold', color: C.ink });
}

export interface EventPlanPptx { data: Buffer; fileName: string; slides: number; deck: EventPlanDeck }

/** Draws the deck for a built model. */
export async function renderEventPlanDeck(deck: EventPlanDeck, canvas: Canvas = createPptxCanvas(`${deck.eventName} — Event plan`)): Promise<{ data: Buffer; slides: number }> {
  const data = await dupoinLogo();
  const ctx: Ctx = { c: canvas, deck, logo: { data, size: await imageSize(data) }, page: 0 };
  await cover(ctx);
  await overview(ctx);
  await glance(ctx);
  await speakers(ctx);
  await rundown(ctx);
  await venue(ctx);
  await budgetSummary(ctx);
  await budgetTable(ctx);
  await timeline(ctx);
  await numberedCards(ctx, deck.kpis, 'Measurement', 'KPIs & success metrics', C.teal);
  await numberedCards(ctx, deck.risks, 'Risk management', 'Risks & mitigation', '#E08A2E');
  await sources(ctx);
  await closing(ctx);
  return { data: await canvas.finish(), slides: ctx.page };
}

export async function exportEventPlanPptx(input: EventPlanDeckInput, now = new Date()): Promise<EventPlanPptx> {
  const deck = buildEventPlanDeck(input);
  const { data, slides } = await renderEventPlanDeck(deck);
  return { data, slides, deck, fileName: eventPlanPptxFilename(deck.eventName, now) };
}
