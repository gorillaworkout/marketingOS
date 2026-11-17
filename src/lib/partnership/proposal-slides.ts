/**
 * Slide 16:9 template, modeled on the approved Tadakado deck: warm paper with
 * light-blue blurs, numbered section dividers 01-05, steel-blue headings and
 * teal Dupoin figures. Drawn on a Canvas, so PDF and PPTX share this layout.
 */
import { PALETTE as C, dupoinLogo, decodeDataUrl, imageSize, laurelLeaves } from './proposal-art';
import type { Canvas } from './proposal-canvas';
import { SLIDE_H, SLIDE_W } from './proposal-canvas';
import { exposureTable, formatRupiah, valueOrTbd, type ProposalDocument, type SectionKey } from './proposal';

interface Group { title: string; keys: SectionKey[] }

/** The five numbered groups of the deck, each shown if any of its sections is on. */
export function slideGroups(doc: ProposalDocument): Array<Group & { number: string }> {
  const L = doc.labels;
  const groups: Group[] = [
    { title: L.sectionProject, keys: ['projectOverview'] },
    { title: L.sectionAbout, keys: ['aboutDupoin', 'numbers', 'demographics', 'products', 'marketLandscape', 'awards', 'digitalAssets'] },
    { title: L.sectionScheme, keys: ['collaborationScheme'] },
    { title: L.sectionExposure, keys: ['digitalExposure', 'offlineMaterials'] },
    { title: L.sectionPackage, keys: ['valuePackage', 'notes'] },
  ];
  return groups.filter(group => group.keys.some(key => doc.content.include[key] && hasContent(doc, key)))
    .map((group, index) => ({ ...group, number: String(index + 1).padStart(2, '0') }));
}

function hasContent(doc: ProposalDocument, key: SectionKey): boolean {
  if (key === 'digitalExposure') return doc.totals.exposureLines.length > 0;
  if (key === 'offlineMaterials') return doc.offline.length > 0;
  if (key === 'notes') return doc.content.notes.length > 0;
  return true;
}

const on = (doc: ProposalDocument, key: SectionKey) => doc.content.include[key] && hasContent(doc, key);

function arrow(c: Canvas) {
  c.line({ x1: 66, y1: 66, x2: 108, y2: 66, color: C.ink, width: 1, arrow: true });
}

function title(c: Canvas, text: string, y = 44) {
  c.text(text, { x: 60, y, w: SLIDE_W - 120, h: 40, size: 26, weight: 'semibold', color: C.steel, align: 'center' });
}

async function cover(c: Canvas, doc: ProposalDocument) {
  await c.newSlide('cover');
  arrow(c);
  c.text(`${doc.labels.coverKicker} - ${doc.year}`, { x: 520, y: 56, w: 380, h: 22, size: 15, color: C.ink, align: 'right' });
  c.text(doc.content.title, { x: 72, y: 180, w: 640, h: 240, size: 54, weight: 'light', color: C.ink, valign: 'middle', lineGap: -4 });
  const logo = await dupoinLogo();
  c.image(logo, { x: 72, y: 450, w: 120, h: 44 }, await imageSize(logo));
  const partner = decodeDataUrl(doc.partnerLogo);
  if (partner) {
    c.text('×', { x: 200, y: 452, w: 30, h: 40, size: 22, color: C.muted, align: 'center', valign: 'middle' });
    c.image(partner, { x: 238, y: 448, w: 130, h: 48 }, await imageSize(partner));
  }
}

async function toc(c: Canvas, doc: ProposalDocument, groups: ReturnType<typeof slideGroups>) {
  await c.newSlide('content');
  c.text(doc.labels.toc, { x: 72, y: 50, w: 400, h: 30, size: 24, color: C.ink });
  groups.forEach((group, index) => {
    const column = index < 4 ? 0 : 1;
    const row = index < 4 ? index : index - 4;
    const x = 80 + column * 300;
    const y = 112 + row * 62;
    c.text(group.number, { x, y, w: 36, h: 24, size: 16, color: C.steel });
    c.text(group.title, { x: x + 40, y, w: 220, h: 50, size: 17, color: C.ink, lineGap: 1 });
  });
}

async function divider(c: Canvas, group: { number: string; title: string }) {
  await c.newSlide('divider');
  arrow(c);
  c.text(group.number, { x: 72, y: 270, w: 300, h: 80, size: 66, weight: 'light', color: C.steel });
  c.text(group.title, { x: 72, y: 352, w: 760, h: 110, size: 46, weight: 'light', color: C.steel });
}

async function projectOverview(c: Canvas, doc: ProposalDocument) {
  await c.newSlide('content');
  c.text(doc.content.projectOverview, { x: 470, y: 64, w: 430, h: 420, size: 17, color: C.ink, lineGap: 3 });
}

async function about(c: Canvas, doc: ProposalDocument) {
  const f = doc.facts;
  await c.newSlide('content');
  c.text(f.whoWeAreTitle, { x: 72, y: 70, w: 380, h: 26, size: 19, weight: 'semibold', color: C.steel });
  c.text(f.aboutParagraph, { x: 72, y: 104, w: 380, h: 260, size: 15, color: C.ink, lineGap: 2 });
  c.text(f.advantagesTitle, { x: 520, y: 70, w: 380, h: 50, size: 19, weight: 'semibold', color: C.steel });
  c.bullets(f.advantages, { x: 528, y: 126, w: 360, h: 200, size: 15, color: C.ink, gap: 6 });
  c.rect({ x: 72, y: 392, w: 816, h: 96, fill: C.tealSoft, radius: 8 });
  c.text(f.regulatoryTitle, { x: 92, y: 404, w: 776, h: 20, size: 13, weight: 'semibold', color: C.tealDark });
  c.text(f.regulatoryStatement, { x: 92, y: 426, w: 776, h: 36, size: 12, color: C.body, lineGap: 1 });
  c.text(`${f.licenseLabel}: ${f.licenseNumber}`, { x: 92, y: 462, w: 776, h: 18, size: 12, weight: 'semibold', color: C.ink });
}

async function numbers(c: Canvas, doc: ProposalDocument) {
  const s = doc.settings;
  await c.newSlide('content');
  title(c, doc.labels.numbers, 52);
  const snapshots = s.snapshots.slice(0, 2);
  const panelW = snapshots.length > 1 ? 400 : 560;
  const gap = 24;
  const startX = (SLIDE_W - (panelW * snapshots.length + gap * (snapshots.length - 1))) / 2;
  snapshots.forEach((snapshot, index) => {
    const x = startX + index * (panelW + gap);
    c.text(snapshot.year, { x, y: 110, w: panelW, h: 26, size: 19, weight: 'semibold', color: C.teal, align: 'center' });
    c.text(snapshot.title, { x, y: 134, w: panelW, h: 26, size: 19, color: C.ink, align: 'center' });
    c.rect({ x: x - 6, y: 168, w: panelW + 12, h: 250, fill: '#FFFFFF', opacity: 0.85 });
    const cells = snapshot.cells.length ? snapshot.cells : [{ value: '', label: '', caption: '' }];
    const cellW = panelW / cells.length;
    cells.forEach((cell, cellIndex) => {
      const cx = x + cellIndex * cellW;
      c.rect({ x: cx, y: 172, w: cellW, h: 196, fill: C.tealCell, line: C.line, lineWidth: 0.8 });
      const hasLabel = Boolean(cell.label);
      c.text(cell.value, { x: cx + 6, y: hasLabel ? 196 : 172, w: cellW - 12, h: hasLabel ? 30 : 196, size: hasLabel ? 24 : 22, weight: 'bold', color: C.ink, align: 'center', valign: hasLabel ? 'top' : 'middle' });
      if (hasLabel) c.text(cell.label, { x: cx + 6, y: 228, w: cellW - 12, h: 136, size: 12.5, weight: 'semibold', color: C.ink, align: 'center' });
      c.rect({ x: cx, y: 368, w: cellW, h: 46, gradient: ['#47C6D4', C.teal], line: '#FFFFFF', lineWidth: 0.5 });
      c.text(cell.caption, { x: cx + 4, y: 370, w: cellW - 8, h: 42, size: 9, weight: 'semibold', color: '#FFFFFF', align: 'center', valign: 'middle' });
    });
  });
}

function growthRow(c: Canvas, rows: Array<{ label: string; value: string }>, y: number, valueSize: number) {
  const width = 760;
  const x = (SLIDE_W - width) / 2;
  const cellW = width / Math.max(1, rows.length);
  rows.forEach((row, index) => {
    const last = index === rows.length - 1;
    const cx = x + index * cellW;
    c.rect({ x: cx, y, w: cellW, h: 62, fill: last ? C.teal : C.tealCell, line: C.line, lineWidth: 0.8 });
    c.text(row.value, { x: cx, y, w: cellW, h: 62, size: valueSize, weight: 'semibold', color: last ? '#FFFFFF' : C.ink, align: 'center', valign: 'middle' });
    c.rect({ x: cx, y: y + 66, w: cellW, h: 20, fill: last ? C.teal : C.tealSoft });
    c.text(row.label, { x: cx, y: y + 66, w: cellW, h: 20, size: 10, weight: 'semibold', color: last ? '#FFFFFF' : C.ink, align: 'center', valign: 'middle' });
  });
}

async function growth(c: Canvas, doc: ProposalDocument) {
  const s = doc.settings;
  if (!s.activeUsers.length && !s.tradedLots.length) return;
  await c.newSlide('content');
  title(c, doc.labels.growth, 40);
  if (s.activeUsers.length) {
    growthRow(c, s.activeUsers, 92, 26);
    c.text(s.activeUsersNote, { x: 140, y: 186, w: 680, h: 34, size: 10.5, color: C.body, align: 'center' });
  }
  if (s.tradedLots.length) {
    c.text(doc.labels.tradedLots, { x: 100, y: 262, w: 760, h: 28, size: 20, weight: 'semibold', color: C.teal, align: 'center' });
    growthRow(c, s.tradedLots, 300, 22);
    c.text(s.tradedLotsNote, { x: 140, y: 394, w: 680, h: 34, size: 10.5, color: C.body, align: 'center' });
  }
}

const percent = (value: string) => {
  const number = Number(value.replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(number) ? number : 0;
};

function barPanel(c: Canvas, label: string, index: number, rows: Array<{ label: string; value: string }>, x: number, y: number, w: number, h: number) {
  c.ellipse({ x, y: y - 26, w: 14, h: 14, fill: C.teal });
  c.text(String(index), { x, y: y - 26, w: 14, h: 14, size: 8, weight: 'bold', color: '#FFFFFF', align: 'center', valign: 'middle' });
  c.text(label, { x: x + 20, y: y - 28, w: w - 20, h: 18, size: 12, weight: 'semibold', color: C.steel });
  c.rect({ x, y, w, h, fill: C.tealCell, line: C.line, lineWidth: 1, radius: 8 });
  const max = Math.max(1, ...rows.map(row => percent(row.value)));
  const rowH = Math.min(36, (h - 16) / Math.max(1, rows.length));
  rows.forEach((row, rowIndex) => {
    const ry = y + 8 + rowIndex * rowH;
    c.text(row.label, { x: x + 12, y: ry, w: 80, h: rowH - 4, size: 8, weight: 'semibold', color: C.ink, valign: 'middle' });
    const barW = Math.max(6, (w - 210) * (percent(row.value) / max));
    c.rect({ x: x + 96, y: ry + 2, w: barW, h: rowH - 6, gradient: ['#3DBBCA', '#E9F8FA'] });
    c.text(row.value, { x: x + w - 110, y: ry, w: 100, h: rowH - 4, size: 18, weight: 'semibold', color: C.ink, align: 'right', valign: 'middle' });
  });
}

async function demographics(c: Canvas, doc: ProposalDocument) {
  const s = doc.settings;
  await c.newSlide('content');
  title(c, doc.labels.demographics, 32);
  barPanel(c, doc.labels.ageTitle, 1, s.ageDistribution, 72, 112, 392, 340);
  barPanel(c, doc.labels.occupationTitle, 2, s.occupation, 496, 112, 392, 340);
  c.text(s.demographicsNote, { x: 72, y: 470, w: 816, h: 30, size: 11, color: C.body, align: 'center' });
}

async function products(c: Canvas, doc: ProposalDocument) {
  const s = doc.settings;
  await c.newSlide('content');
  title(c, doc.labels.products, 48);
  c.rect({ x: 120, y: 118, w: 720, h: 360, fill: '#FFFFFF', opacity: 0.8 });
  c.text(s.productCount, { x: 150, y: 140, w: 270, h: 110, size: 92, weight: 'bold', color: C.teal });
  c.text(s.productLabel, { x: 150, y: 246, w: 270, h: 36, size: 28, weight: 'semibold', color: C.ink });
  s.productCategories.slice(0, 6).forEach((category, index) => {
    const x = 150 + (index % 2) * 160;
    const y = 300 + Math.floor(index / 2) * 52;
    c.rect({ x, y, w: 148, h: 40, fill: C.tealSoft, line: C.line, lineWidth: 1, radius: 3 });
    c.text(category.toUpperCase(), { x, y, w: 148, h: 40, size: 13, weight: 'bold', italic: true, color: C.ink, align: 'center', valign: 'middle' });
  });
  // Stylized app watchlist (no prices): the symbols shown in the approved deck.
  c.rect({ x: 560, y: 130, w: 220, h: 340, fill: '#16181D', radius: 26 });
  c.rect({ x: 572, y: 144, w: 196, h: 312, fill: '#0E0F12', radius: 18 });
  c.text('Markets', { x: 586, y: 158, w: 160, h: 20, size: 13, weight: 'semibold', color: '#FFFFFF' });
  ['XAUUSD', 'EURUSD', 'GBPUSD', 'AUDUSD', 'USDJPY', 'GBPJPY', 'DOW', 'WTI'].forEach((symbol, index) => {
    const y = 190 + index * 32;
    c.ellipse({ x: 586, y: y + 4, w: 14, h: 14, fill: index % 2 ? '#3DBBCA' : '#E8B13A' });
    c.text(symbol, { x: 608, y, w: 90, h: 22, size: 11, weight: 'semibold', color: '#FFFFFF', valign: 'middle' });
    c.rect({ x: 716, y: y + 3, w: 40, h: 16, fill: index % 3 === 1 ? '#C9403A' : '#2E9E6A', radius: 3 });
  });
}

async function market(c: Canvas, doc: ProposalDocument) {
  const s = doc.settings;
  await c.newSlide('content');
  title(c, doc.labels.market, 36);
  c.rect({ x: 72, y: 88, w: 816, h: doc.content.marketInsight ? 330 : 400, fill: '#FFFFFF', opacity: 0.85 });
  c.text(s.marketHeadline, { x: 96, y: 100, w: 768, h: 34, size: 12, color: C.ink, align: 'center' });
  const rows = s.marketRegions;
  const perColumn = Math.ceil(rows.length / 2);
  const max = Math.max(1, ...rows.map(row => percent(row.value)));
  const rowH = Math.min(36, ((doc.content.marketInsight ? 270 : 330)) / Math.max(1, perColumn));
  rows.forEach((row, index) => {
    const column = index < perColumn ? 0 : 1;
    const x = 104 + column * 396;
    const y = 144 + (index % perColumn) * rowH;
    c.text(row.label, { x, y, w: 120, h: rowH - 6, size: 11, weight: 'semibold', color: C.ink, valign: 'middle' });
    c.rect({ x: x + 126, y: y + 4, w: Math.max(6, 170 * (percent(row.value) / max)), h: rowH - 12, fill: C.teal, opacity: 0.85 });
    c.text(row.value, { x: x + 300, y, w: 60, h: rowH - 6, size: 12, weight: 'semibold', color: C.tealDark, align: 'right', valign: 'middle' });
  });
  if (doc.content.marketInsight) {
    c.rect({ x: 72, y: 428, w: 816, h: 72, fill: C.tealSoft, radius: 8 });
    c.text(doc.labels.marketInsight, { x: 92, y: 438, w: 776, h: 16, size: 11, weight: 'semibold', color: C.tealDark });
    c.text(doc.content.marketInsight, { x: 92, y: 456, w: 776, h: 40, size: 11.5, color: C.ink });
  }
}

/** Laurel wreath badge like the approved award art: teal leaves, three stars, text inside, year and issuer below. */
export function laurel(c: Canvas, cx: number, cy: number, r: number, lines: { title: string; year: string; by: string }) {
  for (const leaf of laurelLeaves(cx, cy, r)) c.ellipse({ x: leaf.x - r * 0.1, y: leaf.y - r * 0.2, w: r * 0.2, h: r * 0.4, fill: C.teal, rotate: leaf.rotate });
  for (const offset of [-12, 0, 12]) c.star(cx + offset, cy - r - 2, 4, C.teal);
  c.text(lines.title, { x: cx - r * 0.7, y: cy - r * 0.55, w: r * 1.4, h: r * 1.1, size: 12, weight: 'semibold', color: C.ink, align: 'center', valign: 'middle' });
  c.text(lines.year, { x: cx - 60, y: cy + r + 12, w: 120, h: 13, size: 9.5, weight: 'semibold', color: C.ink, align: 'center' });
  c.text(lines.by, { x: cx - 80, y: cy + r + 25, w: 160, h: 13, size: 9, color: C.ink, align: 'center' });
}

async function awards(c: Canvas, doc: ProposalDocument) {
  const f = doc.facts;
  await c.newSlide('content');
  title(c, doc.labels.awards, 40);
  c.rect({ x: 96, y: 92, w: 768, h: 410, fill: '#FFFFFF', opacity: 0.85 });
  const badges = [...f.awards.map(award => ({ title: award.title, year: award.year, by: `by ${award.by}` })), { title: f.rating.title, year: f.rating.years, by: `by ${f.rating.by}` }];
  const top = badges.slice(0, 4);
  top.forEach((badge, index) => laurel(c, 192 + index * 192, 178, 58, badge));
  badges.slice(4).forEach((badge, index, rest) => laurel(c, SLIDE_W / 2 + (index - (rest.length - 1) / 2) * 192, 372, 58, badge));
}

async function digitalAssets(c: Canvas, doc: ProposalDocument) {
  const s = doc.settings;
  await c.newSlide('content');
  title(c, doc.labels.digitalAssets, 36);
  const cards = [
    { heading: `${doc.labels.instagram} (${s.instagramHandle})`, link: s.instagramUrl, rows: s.instagramStats },
    { heading: `${doc.labels.website} (${s.websiteDomain})`, link: s.websiteUrl, rows: s.websiteStats },
  ];
  cards.forEach((card, index) => {
    const x = 72 + index * 420;
    c.rect({ x, y: 92, w: 396, h: 400, fill: '#FFFFFF', line: C.line, lineWidth: 1, radius: 10 });
    c.rect({ x, y: 92, w: 396, h: 40, fill: C.tealSoft, radius: 10 });
    c.text(card.heading, { x: x + 16, y: 92, w: 364, h: 40, size: 13, weight: 'semibold', color: C.ink, valign: 'middle' });
    let y = 146;
    for (const row of card.rows) {
      const height = Math.max(24, c.measure(row.value, 11, 220) + 10);
      if (y + height > 456) break;
      c.text(row.label, { x: x + 16, y, w: 130, h: height, size: 11, weight: 'semibold', color: C.body });
      c.text(row.value, { x: x + 156, y, w: 224, h: height, size: 11, color: C.ink });
      c.line({ x1: x + 16, y1: y + height - 4, x2: x + 380, y2: y + height - 4, color: '#E6EEF0', width: 0.6 });
      y += height;
    }
    if (card.link) c.text(card.link.replace(/^https:\/\//, '').replace(/\/$/, ''), { x: x + 16, y: 462, w: 364, h: 18, size: 11, color: C.steel, link: card.link });
  });
}

async function scheme(c: Canvas, doc: ProposalDocument) {
  await c.newSlide('content');
  c.text(doc.content.schemeGoal, { x: 60, y: 150, w: 620, h: 80, size: 28, color: C.ink, valign: 'bottom' });
  c.text(doc.content.schemeHeading, { x: 300, y: 252, w: 600, h: 28, size: 19, color: C.steel });
  c.bullets(doc.content.schemeBullets, { x: 312, y: 288, w: 590, h: 220, size: 15, color: C.ink, numbered: true, gap: 4 });
}

async function journey(c: Canvas, doc: ProposalDocument) {
  const steps = doc.content.userJourney.slice(0, 4);
  if (!steps.length) return;
  await c.newSlide('content');
  c.text(doc.labels.userJourney, { x: 72, y: 50, w: 400, h: 30, size: 22, color: C.ink });
  const cardW = 190;
  const gap = (816 - cardW * steps.length) / Math.max(1, steps.length - 1);
  steps.forEach((step, index) => {
    const x = steps.length === 1 ? (SLIDE_W - cardW) / 2 : 72 + index * (cardW + gap);
    c.rect({ x, y: 120, w: cardW, h: 330, fill: '#FFFFFF', line: C.line, lineWidth: 1, radius: 14 });
    c.ellipse({ x: x + cardW / 2 - 30, y: 150, w: 60, h: 60, fill: C.teal });
    c.text(String(index + 1), { x: x + cardW / 2 - 30, y: 150, w: 60, h: 60, size: 26, weight: 'bold', color: '#FFFFFF', align: 'center', valign: 'middle' });
    c.text(step, { x: x + 14, y: 232, w: cardW - 28, h: 200, size: 13, color: C.ink, align: 'center', lineGap: 1 });
    if (index < steps.length - 1 && gap > 18) c.line({ x1: x + cardW + 6, y1: 285, x2: x + cardW + gap - 6, y2: 285, color: C.steel, width: 1.5, arrow: true });
  });
}

async function exposure(c: Canvas, doc: ProposalDocument) {
  const L = doc.labels;
  await c.newSlide('content');
  title(c, L.exposureDoc, 36);
  const { rows, showValue, totalText } = exposureTable(doc.totals, L);
  const layout = showValue
    ? { colW: [44, 220, 220, 150, 146], align: ['center', 'left', 'left', 'left', 'right'] as Array<'left' | 'center' | 'right'> }
    : { colW: [44, 290, 290, 156], align: ['center', 'left', 'left', 'left'] as Array<'left' | 'center' | 'right'> };
  const height = c.table(rows, { x: 90, y: 96, colW: layout.colW, size: 11.5, headFill: C.header, headColor: '#FFFFFF', lineColor: C.line, padding: 8, align: layout.align });
  if (totalText) c.text(`${L.exposureEstimate}: ${totalText}`, { x: 72, y: Math.min(470, 96 + height + 26), w: 816, h: 30, size: 20, weight: 'semibold', color: C.ink, align: 'center' });
}

async function offline(c: Canvas, doc: ProposalDocument) {
  const L = doc.labels;
  await c.newSlide('content');
  title(c, L.offline, 36);
  const rows = [[L.colNo, L.colMaterial, L.colContent, L.colPlacement, L.colQuantity], ...doc.offline.map(item => [`${item.no}.`, item.material, item.content, item.placement, String(item.quantity)])];
  c.table(rows, { x: 110, y: 110, colW: [44, 200, 200, 196, 100], size: 12, headFill: C.header, headColor: '#FFFFFF', lineColor: C.line, padding: 9, align: ['center', 'left', 'left', 'left', 'center'] });
}

async function pack(c: Canvas, doc: ProposalDocument) {
  const L = doc.labels;
  const t = doc.totals;
  await c.newSlide('content');
  const needItems = t.needLines.map(line => (line.quantity !== null && line.unitValue !== null
    ? `${line.quantity.toLocaleString('id-ID')} qty ${line.description} (@${formatRupiah(line.unitValue).replace(/,-$/, ',-')})`
    : line.description));
  if (t.baseFee !== null) needItems.push(`${L.baseFee}: ${formatRupiah(t.baseFee)}`);
  const columns = [
    { head: L.whatWeNeed, items: needItems, total: t.needTotal + (t.baseFee ?? 0) },
    { head: L.whatWeOffer, items: doc.content.exposureHighlights.length ? doc.content.exposureHighlights : t.exposureLines.map(line => `${line.quantity} ${line.content}`), total: t.exposureTotal },
    { head: `${L.supportFrom} ${doc.partnerName}`, items: doc.content.partnerSupport, total: null as number | null },
  ];
  columns.forEach((column, index) => {
    const x = 72 + index * 280;
    c.rect({ x, y: 40, w: 256, h: 54, fill: C.header, radius: 8 });
    c.text(column.head, { x: x + 10, y: 40, w: 236, h: 54, size: 17, weight: 'semibold', color: '#FFFFFF', align: 'center', valign: 'middle' });
    c.rect({ x, y: 108, w: 256, h: 300, line: '#BCDDF0', lineWidth: 2 });
    c.bullets(column.items.length ? column.items : ['—'], { x: x + 20, y: 140, w: 220, h: 170, size: 14, color: C.ink, gap: 4 });
    if (column.total !== null && column.total > 0) c.text(`${L.totalValue}: ${formatRupiah(column.total).replace(/,-$/, '')}`, { x: x + 20, y: 340, w: 226, h: 40, size: 14, weight: 'semibold', color: C.ink });
  });
  c.text(`${L.packageEstimate}: ${valueOrTbd(t.packageTotal, L)}`, { x: 60, y: 432, w: 840, h: 34, size: 22, weight: 'semibold', color: C.ink, align: 'center' });
  if (t.baseFee === null && t.needLines.length === 0) c.text(`${L.baseFee}: ${L.tbd}`, { x: 60, y: 468, w: 840, h: 20, size: 12, color: C.muted, align: 'center' });
}

async function notes(c: Canvas, doc: ProposalDocument) {
  await c.newSlide('content');
  c.text(doc.labels.notes, { x: 72, y: 60, w: 600, h: 34, size: 24, color: C.ink });
  c.bullets(doc.content.notes, { x: 80, y: 120, w: 780, h: 360, size: 15, color: C.ink, gap: 8 });
}

/** Draws the whole deck; returns the slide count. */
export async function drawSlides(c: Canvas, doc: ProposalDocument): Promise<number> {
  let count = 0;
  const wrap = async (step: () => Promise<void>) => { await step(); count += 1; };
  const groups = slideGroups(doc);
  await wrap(() => cover(c, doc));
  await wrap(() => toc(c, doc, groups));
  for (const group of groups) {
    await wrap(() => divider(c, group));
    for (const key of group.keys) {
      if (!on(doc, key)) continue;
      if (key === 'projectOverview') await wrap(() => projectOverview(c, doc));
      if (key === 'aboutDupoin') await wrap(() => about(c, doc));
      if (key === 'numbers') {
        await wrap(() => numbers(c, doc));
        if (doc.settings.activeUsers.length || doc.settings.tradedLots.length) await wrap(() => growth(c, doc));
      }
      if (key === 'demographics') await wrap(() => demographics(c, doc));
      if (key === 'products') await wrap(() => products(c, doc));
      if (key === 'marketLandscape') await wrap(() => market(c, doc));
      if (key === 'awards') await wrap(() => awards(c, doc));
      if (key === 'digitalAssets') await wrap(() => digitalAssets(c, doc));
      if (key === 'collaborationScheme') {
        await wrap(() => scheme(c, doc));
        if (doc.content.userJourney.length) await wrap(() => journey(c, doc));
      }
      if (key === 'digitalExposure') await wrap(() => exposure(c, doc));
      if (key === 'offlineMaterials') await wrap(() => offline(c, doc));
      if (key === 'valuePackage') await wrap(() => pack(c, doc));
      if (key === 'notes') await wrap(() => notes(c, doc));
    }
  }
  void SLIDE_H;
  return count;
}
