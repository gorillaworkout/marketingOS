/**
 * Document A4 template, modeled on the approved Kopi Kenangan proposal: black
 * header band with the title in Dupoin teal and the Dupoin logo, section
 * headings with a teal rule, grey-header tables. Server only (pdfkit).
 */
import PDFDocument from 'pdfkit';
import { PALETTE as C, decodeDataUrl, dupoinLogo, imageSize, laurelLeaves, starPoints } from './proposal-art';
import { containBox, pdfFont, registerFonts } from './proposal-canvas';
import { formatRupiah, type ProposalDocument } from './proposal';
import type { FontWeight } from './proposal-art';

const PAGE_W = 595.28;
const MARGIN_X = 62;
const TOP = 56;
const BOTTOM = 790;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

export async function renderDocumentPdf(model: ProposalDocument): Promise<{ data: Buffer; pages: number }> {
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: model.content.title, Author: 'Dupoin Futures Indonesia' } });
  registerFonts(doc);
  const chunks: Buffer[] = [];
  doc.on('data', chunk => chunks.push(chunk as Buffer));
  const done = new Promise<Buffer>((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  let pages = 0;
  let y = TOP;

  const addPage = () => { doc.addPage({ size: 'A4', margin: 0 }); pages += 1; y = TOP; };
  const ensure = (height: number) => { if (y + height > BOTTOM) addPage(); };
  const font = (weight: FontWeight, size: number, color: string = C.ink) => doc.font(pdfFont(weight)).fontSize(size).fillColor(color);
  const height = (text: string, weight: FontWeight, size: number, width = CONTENT_W, lineGap = 2) => doc.font(pdfFont(weight)).fontSize(size).heightOfString(text || ' ', { width, lineGap });

  const paragraph = (text: string, size = 11, color: string = C.ink, weight: FontWeight = 'regular') => {
    if (!text) return;
    const h = height(text, weight, size);
    ensure(Math.min(h, 120));
    font(weight, size, color).text(text, MARGIN_X, y, { width: CONTENT_W, lineGap: 2 });
    y = doc.y + 8;
  };
  const h2 = (text: string, minFollow = 80) => {
    ensure(46 + minFollow);
    y += 10;
    font('regular', 19, C.ink).text(text, MARGIN_X, y, { width: CONTENT_W });
    y = doc.y + 8;
    doc.save().roundedRect(MARGIN_X, y, CONTENT_W, 3.5, 1.7).fill(C.teal).restore();
    y += 16;
  };
  const h3 = (text: string) => {
    ensure(40);
    font('regular', 14, C.teal).text(text, MARGIN_X, y, { width: CONTENT_W });
    y = doc.y + 6;
  };
  const bullets = (items: string[], size = 11) => {
    for (const item of items) {
      const h = height(item, 'regular', size, CONTENT_W - 30);
      ensure(h + 4);
      doc.save().circle(MARGIN_X + 12, y + size * 0.6, 2.2).fill(C.ink).restore();
      font('regular', size).text(item, MARGIN_X + 24, y, { width: CONTENT_W - 30, lineGap: 2 });
      y = doc.y + 3;
    }
    y += 6;
  };
  const table = (rows: string[][], widths: number[], align: Array<'left' | 'center' | 'right'> = []) => {
    const padding = 8;
    const total = widths.reduce((sum, w) => sum + w, 0);
    const scale = CONTENT_W / total;
    const cols = widths.map(w => w * scale);
    const rowHeight = (row: string[], head: boolean) => Math.max(26, ...row.map((cell, index) => height(cell, head ? 'semibold' : 'regular', 10, cols[index] - padding * 2, 1) + padding * 2));
    const drawRow = (row: string[], head: boolean) => {
      const h = rowHeight(row, head);
      let x = MARGIN_X;
      row.forEach((cell, index) => {
        doc.save().rect(x, y, cols[index], h).fill(head ? C.tableHead : '#FFFFFF').restore();
        doc.save().rect(x, y, cols[index], h).lineWidth(0.6).stroke(C.tableLine).restore();
        font(head ? 'semibold' : 'regular', 10).text(cell, x + padding, y + padding, { width: cols[index] - padding * 2, align: head ? 'center' : (align[index] ?? 'left'), lineGap: 1 });
        x += cols[index];
      });
      y += h;
    };
    ensure(rowHeight(rows[0], true) + (rows[1] ? rowHeight(rows[1], false) : 0));
    drawRow(rows[0], true);
    for (const row of rows.slice(1)) {
      if (y + rowHeight(row, false) > BOTTOM) { addPage(); drawRow(rows[0], true); }
      drawRow(row, false);
    }
    y += 12;
  };
  const totalLine = (text: string) => {
    ensure(24);
    font('semibold', 11.5, C.teal).text(text, MARGIN_X, y, { width: CONTENT_W });
    y = doc.y + 14;
  };
  const cellRow = (rows: Array<{ label: string; value: string }>, valueSize: number) => {
    const cellW = CONTENT_W / Math.max(1, rows.length);
    ensure(82);
    rows.forEach((row, index) => {
      const last = index === rows.length - 1;
      const x = MARGIN_X + index * cellW;
      doc.save().rect(x, y, cellW, 52).fill(last ? C.teal : C.tealCell).restore();
      doc.save().rect(x, y, cellW, 52).lineWidth(0.6).stroke(C.line).restore();
      font('semibold', valueSize, last ? '#FFFFFF' : C.ink).text(row.value, x, y + (52 - valueSize * 1.2) / 2, { width: cellW, align: 'center' });
      doc.save().rect(x, y + 56, cellW, 16).fill(last ? C.teal : C.tealSoft).restore();
      font('semibold', 8.5, last ? '#FFFFFF' : C.ink).text(row.label, x, y + 59.5, { width: cellW, align: 'center' });
    });
    y += 82;
  };
  const percent = (value: string) => { const n = Number(value.replace(',', '.').replace(/[^\d.]/g, '')); return Number.isFinite(n) ? n : 0; };
  const bars = (rows: Array<{ label: string; value: string }>, x: number, width: number, startY: number) => {
    const max = Math.max(1, ...rows.map(row => percent(row.value)));
    let ry = startY;
    for (const row of rows) {
      font('semibold', 8, C.ink).text(row.label, x, ry + 3, { width: 86, height: 20, ellipsis: true });
      const barW = Math.max(4, (width - 160) * (percent(row.value) / max));
      const gradient = doc.linearGradient(x + 90, ry, x + 90 + barW, ry);
      gradient.stop(0, '#3DBBCA').stop(1, '#E9F8FA');
      doc.save().rect(x + 90, ry, barW, 18).fill(gradient).restore();
      font('semibold', 11, C.ink).text(row.value, x + width - 64, ry + 2, { width: 60, align: 'right' });
      ry += 24;
    }
    return ry;
  };

  /* ---------- Page 1 header ---------- */
  addPage();
  doc.rect(0, 0, PAGE_W, 132).fill(C.docBlack);
  const partnerLogo = decodeDataUrl(model.partnerLogo);
  font('light', 25, C.teal).text(`${model.facts.shortName} x ${model.partnerName}`, 30, 30, { width: partnerLogo ? 300 : 340, height: 92, lineGap: -3, ellipsis: true });
  const logo = await dupoinLogo();
  const logoBox = containBox({ x: partnerLogo ? 352 : 380, y: 28, w: partnerLogo ? 110 : 180, h: 76 }, await imageSize(logo));
  doc.image(logo, logoBox.x, logoBox.y, { width: logoBox.w, height: logoBox.h });
  if (partnerLogo) {
    const box = containBox({ x: 474, y: 34, w: 96, h: 64 }, await imageSize(partnerLogo));
    doc.save().roundedRect(box.x - 6, box.y - 6, box.w + 12, box.h + 12, 6).fill('#FFFFFF').restore();
    doc.image(partnerLogo, box.x, box.y, { width: box.w, height: box.h });
  }
  y = 156;

  const L = model.labels;
  const f = model.facts;
  const s = model.settings;
  const content = model.content;
  const include = content.include;

  if (include.projectOverview) { h2(L.sectionProject); paragraph(content.projectOverview); }

  if (include.aboutDupoin) {
    h2(L.aboutDoc);
    paragraph(f.aboutParagraphLong);
    h3(f.advantagesTitle);
    bullets(f.advantages);
    h3(f.regulatoryTitle);
    paragraph(f.regulatoryStatement);
    paragraph(`${f.licenseLabel}: ${f.licenseNumber}`, 11, C.ink, 'semibold');
  }

  if (include.numbers) {
    if (s.activeUsers.length || s.tradedLots.length) {
      h2(L.growth, 120);
      if (s.activeUsers.length) { cellRow(s.activeUsers, 22); paragraph(s.activeUsersNote, 9, C.body); }
      if (s.tradedLots.length) {
        ensure(120);
        font('semibold', 15, C.teal).text(L.tradedLots, MARGIN_X, y, { width: CONTENT_W, align: 'center' });
        y = doc.y + 8;
        cellRow(s.tradedLots, 17);
        paragraph(s.tradedLotsNote, 9, C.body);
      }
    }
    if (s.snapshots.length) {
      h2(L.numbers, 150);
      const snapshots = s.snapshots.slice(0, 2);
      const panelW = (CONTENT_W - 16 * (snapshots.length - 1)) / snapshots.length;
      ensure(190);
      const top = y;
      snapshots.forEach((snapshot, index) => {
        const x = MARGIN_X + index * (panelW + 16);
        font('semibold', 13, C.teal).text(snapshot.year, x, top, { width: panelW, align: 'center' });
        font('regular', 12, C.ink).text(snapshot.title, x, top + 17, { width: panelW, align: 'center' });
        const cellW = panelW / Math.max(1, snapshot.cells.length);
        snapshot.cells.forEach((cell, cellIndex) => {
          const cx = x + cellIndex * cellW;
          doc.save().rect(cx, top + 40, cellW, 112).fill(C.tealCell).restore();
          doc.save().rect(cx, top + 40, cellW, 112).lineWidth(0.6).stroke(C.line).restore();
          font('bold', cell.label ? 15 : 14, C.ink).text(cell.value, cx + 3, top + (cell.label ? 50 : 88), { width: cellW - 6, align: 'center' });
          if (cell.label) font('semibold', 7.5, C.ink).text(cell.label, cx + 4, top + 70, { width: cellW - 8, align: 'center', height: 80, ellipsis: true });
          doc.save().rect(cx, top + 152, cellW, 28).fill(C.teal).restore();
          font('semibold', 6.5, '#FFFFFF').text(cell.caption, cx + 3, top + 156, { width: cellW - 6, align: 'center', height: 24, ellipsis: true });
        });
      });
      y = top + 194;
    }
  }

  if (include.demographics) {
    h2(L.demographics, 200);
    const columnW = (CONTENT_W - 20) / 2;
    ensure(30 + Math.max(s.ageDistribution.length, s.occupation.length) * 24);
    const top = y;
    font('semibold', 10, C.steel).text(L.ageTitle, MARGIN_X, top, { width: columnW });
    font('semibold', 10, C.steel).text(L.occupationTitle, MARGIN_X + columnW + 20, top, { width: columnW });
    const end = Math.max(bars(s.ageDistribution, MARGIN_X, columnW, top + 22), bars(s.occupation, MARGIN_X + columnW + 20, columnW, top + 22));
    y = end + 6;
    paragraph(s.demographicsNote, 9.5, C.body);
  }

  if (include.products) {
    h2(L.products, 90);
    ensure(90);
    font('bold', 48, C.teal).text(s.productCount, MARGIN_X, y, { width: 150 });
    font('semibold', 18, C.ink).text(s.productLabel, MARGIN_X, y + 56, { width: 150 });
    s.productCategories.slice(0, 6).forEach((category, index) => {
      const x = MARGIN_X + 170 + (index % 3) * 100;
      const cy = y + 8 + Math.floor(index / 3) * 40;
      doc.save().roundedRect(x, cy, 92, 30, 3).fillAndStroke(C.tealSoft, C.line).restore();
      font('bold', 10, C.ink).text(category.toUpperCase(), x, cy + 9.5, { width: 92, align: 'center' });
    });
    y += 96;
  }

  if (include.marketLandscape) {
    h2(L.market, 150);
    paragraph(s.marketHeadline, 10, C.body);
    const columnW = (CONTENT_W - 20) / 2;
    const perColumn = Math.ceil(s.marketRegions.length / 2);
    ensure(perColumn * 24 + 6);
    const top = y;
    const end = Math.max(bars(s.marketRegions.slice(0, perColumn), MARGIN_X, columnW, top), bars(s.marketRegions.slice(perColumn), MARGIN_X + columnW + 20, columnW, top));
    y = end + 8;
    if (content.marketInsight) { h3(L.marketInsight); paragraph(content.marketInsight); }
  }

  if (include.awards) {
    h2(L.awards, 230);
    ensure(240);
    const badges = [...f.awards.map(award => ({ title: award.title, line: `${award.year} by ${award.by}` })), { title: f.rating.title, line: `${f.rating.years} by ${f.rating.by}` }];
    const drawBadge = (cx: number, cy: number, badge: { title: string; line: string }) => {
      const r = 36;
      for (const leaf of laurelLeaves(cx, cy, r, 6)) {
        doc.save().rotate(leaf.rotate, { origin: [leaf.x, leaf.y] }).ellipse(leaf.x, leaf.y, r * 0.1, r * 0.21).fill(C.teal).restore();
      }
      for (const offset of [-8, 0, 8]) doc.save().polygon(...starPoints(cx + offset, cy - r - 2, 2.8)).fill(C.teal).restore();
      const titleH = height(badge.title, 'semibold', 8.5, 66, 0);
      font('semibold', 8.5, C.ink).text(badge.title, cx - 33, cy - titleH / 2, { width: 66, align: 'center' });
      font('regular', 7, C.ink).text(badge.line, cx - 50, cy + r + 8, { width: 100, align: 'center' });
    };
    const top = y + 46;
    badges.slice(0, 4).forEach((badge, index) => drawBadge(MARGIN_X + CONTENT_W / 8 + index * (CONTENT_W / 4), top, badge));
    badges.slice(4).forEach(badge => drawBadge(PAGE_W / 2, top + 116, badge));
    y = top + 178;
  }

  if (include.digitalAssets) {
    h2(L.digitalAssets, 160);
    const columnW = (CONTENT_W - 16) / 2;
    const cards = [
      { heading: `${L.instagram} (${s.instagramHandle})`, rows: s.instagramStats, link: s.instagramUrl },
      { heading: `${L.website} (${s.websiteDomain})`, rows: s.websiteStats, link: s.websiteUrl },
    ];
    const rowH = (row: { label: string; value: string }) => Math.max(22, height(row.value, 'regular', 9, columnW * 0.62 - 12, 1) + 10, height(row.label, 'regular', 9, columnW * 0.38 - 12, 1) + 10);
    const heights = cards.map(card => 28 + card.rows.reduce((sum, row) => sum + rowH(row), 0));
    ensure(Math.max(...heights) + 24);
    const top = y;
    cards.forEach((card, index) => {
      const x = MARGIN_X + index * (columnW + 16);
      let ry = top;
      doc.save().rect(x, ry, columnW, 28).fill(C.tableHead).restore();
      doc.save().rect(x, ry, columnW, 28).lineWidth(0.6).stroke(C.tableLine).restore();
      font('semibold', 9.5, C.ink).text(card.heading, x, ry + 9, { width: columnW, align: 'center' });
      ry += 28;
      for (const row of card.rows) {
        const rh = rowH(row);
        doc.save().rect(x, ry, columnW * 0.38, rh).lineWidth(0.6).stroke(C.tableLine).restore();
        doc.save().rect(x + columnW * 0.38, ry, columnW * 0.62, rh).lineWidth(0.6).stroke(C.tableLine).restore();
        font('regular', 9, C.ink).text(row.label, x + 6, ry + 5, { width: columnW * 0.38 - 12 });
        font('regular', 9, C.ink).text(row.value, x + columnW * 0.38 + 6, ry + 5, { width: columnW * 0.62 - 12, lineGap: 1 });
        ry += rh;
      }
      if (card.link) font('regular', 9, C.steel).text(card.link.replace(/^https:\/\//, '').replace(/\/$/, ''), x, ry + 6, { width: columnW, link: card.link, underline: true });
    });
    y = top + Math.max(...heights) + 26;
  }

  if (include.collaborationScheme) {
    h2(`${L.schemeDoc} ${model.partnerName}`);
    if (content.schemeGoal) paragraph(content.schemeGoal, 11.5, C.ink, 'semibold');
    if (content.schemeHeading) h3(content.schemeHeading);
    bullets(content.schemeBullets);
    if (content.userJourney.length) {
      paragraph(`${L.userJourney}:`, 11, C.ink, 'semibold');
      paragraph(content.userJourney.join('  →  '));
    }
  }

  const t = model.totals;
  if (include.digitalExposure && t.exposureLines.length) {
    h2(L.exposureDoc, 110);
    table([[L.colNo, L.colContent, L.colPlatform, L.colQuantity, L.colValue], ...t.exposureLines.map(line => [`${line.no}.`, line.content, line.platform, line.quantity, formatRupiah(line.value)])], [34, 120, 120, 90, 100], ['center', 'left', 'left', 'left', 'left']);
    totalLine(`${L.exposureTotal}: ${formatRupiah(t.exposureTotal)}`);
  }

  if (include.offlineMaterials && model.offline.length) {
    h2(L.offline, 90);
    table([[L.colNo, L.colMaterial, L.colContent, L.colPlacement, L.colQuantity], ...model.offline.map(item => [`${item.no}.`, item.material, item.content, item.placement, String(item.quantity)])], [34, 120, 110, 120, 70], ['center', 'left', 'left', 'left', 'center']);
  }

  if (include.valuePackage) {
    h2(L.valuePackage, 110);
    const rows: string[][] = [[L.colNo, L.colItem, L.colFee, L.colNotes]];
    rows.push([`${rows.length}.`, L.baseFee, t.baseFee === null ? L.tbd : formatRupiah(t.baseFee), L.baseFeeNote]);
    for (const need of t.needLines) {
      rows.push([`${rows.length}.`, need.quantity !== null ? `${need.description} (${need.quantity.toLocaleString('id-ID')} qty)` : need.description, need.total ? formatRupiah(need.total) : '—', need.unitValue !== null ? `@${formatRupiah(need.unitValue)}` : L.contributionRow]);
    }
    rows.push([`${rows.length}.`, L.exposureValueRow, formatRupiah(t.exposureTotal), L.exposureValueNote]);
    table(rows, [34, 150, 110, 140], ['center', 'left', 'left', 'left']);
    totalLine(`${L.packageTotal}: ${formatRupiah(t.packageTotal)}`);
  }

  if (include.notes && content.notes.length) {
    ensure(60);
    paragraph(`${L.notes}:`, 11, C.ink, 'regular');
    bullets(content.notes, 10.5);
  }

  doc.end();
  return { data: await done, pages };
}
