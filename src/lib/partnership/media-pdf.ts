/**
 * Media Monitoring PDF (A4), laid out like the Dataxet "Campaign & Sentiment
 * Performance Report": KPIs, mentions & engagement trend, top 5 posts, sentiment,
 * sentiment by channel, top sources, perception, key insights, recommendations.
 * Server only (pdfkit), reusing the proposal export's fonts, palette and logo.
 */
import PDFDocument from 'pdfkit';
import { PALETTE as C, dupoinLogo, imageSize, type FontWeight } from './proposal-art';
import { containBox, pdfFont, registerFonts } from './proposal-canvas';
import {
  AD_VALUE_FORMULA, MEDIA_CHANNEL_LABELS, MEDIA_SOURCE_LABELS, compactNumber, percent,
  type MediaDashboard, type MediaInsights, type MediaSettings,
} from './media';

const PAGE_W = 595.28;
const MARGIN_X = 48;
const TOP = 48;
const BOTTOM = 790;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const SENT_COLORS = { positive: '#2E9E6B', neutral: '#9AA0A6', negative: '#D64545', unscored: '#D9D9D9' } as const;

export function mediaReportFileName(settings: MediaSettings, dashboard: MediaDashboard): string {
  return `${settings.brandName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'Brand'}-Media-Monitoring-${dashboard.range.from}_to_${dashboard.range.to}.pdf`;
}

export async function renderMediaReportPdf(settings: MediaSettings, dashboard: MediaDashboard, insights: MediaInsights | null, generatedAt = new Date()): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: `${settings.brandName} Media Monitoring Report`, Author: 'MarketingOS' } });
  registerFonts(doc);
  const chunks: Buffer[] = [];
  doc.on('data', chunk => chunks.push(chunk as Buffer));
  const done = new Promise<Buffer>((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  let y = TOP;
  const font = (weight: FontWeight, size: number, color: string = C.ink) => doc.font(pdfFont(weight)).fontSize(size).fillColor(color);
  const addPage = () => { doc.addPage({ size: 'A4', margin: 0 }); y = TOP; };
  const ensure = (height: number) => { if (y + height > BOTTOM) addPage(); };
  const paragraph = (text: string, size = 10, color: string = C.body) => {
    if (!text) return;
    ensure(Math.min(doc.font(pdfFont('regular')).fontSize(size).heightOfString(text, { width: CONTENT_W, lineGap: 2 }), 100));
    font('regular', size, color).text(text, MARGIN_X, y, { width: CONTENT_W, lineGap: 2 });
    y = doc.y + 8;
  };
  const h2 = (text: string) => {
    ensure(70);
    y += 6;
    font('semibold', 15, C.ink).text(text, MARGIN_X, y, { width: CONTENT_W });
    y = doc.y + 4;
    doc.save().rect(MARGIN_X, y, 40, 3).fill(C.teal).restore();
    y += 12;
  };
  const bullets = (items: string[], size = 10) => {
    for (const item of items.filter(Boolean)) {
      const h = doc.font(pdfFont('regular')).fontSize(size).heightOfString(item, { width: CONTENT_W - 18, lineGap: 2 });
      ensure(h + 4);
      doc.save().circle(MARGIN_X + 5, y + size * 0.6, 2).fill(C.teal).restore();
      font('regular', size, C.body).text(item, MARGIN_X + 16, y, { width: CONTENT_W - 18, lineGap: 2 });
      y = doc.y + 3;
    }
    y += 4;
  };
  const table = (rows: string[][], widths: number[], align: Array<'left' | 'right' | 'center'> = []) => {
    const total = widths.reduce((sum, w) => sum + w, 0);
    const cols = widths.map(w => (w / total) * CONTENT_W);
    const pad = 6;
    rows.forEach((row, rowIndex) => {
      const head = rowIndex === 0;
      const h = Math.max(22, ...row.map((cell, index) => doc.font(pdfFont(head ? 'semibold' : 'regular')).fontSize(9).heightOfString(cell || ' ', { width: cols[index] - pad * 2 }) + pad * 2));
      ensure(h);
      let x = MARGIN_X;
      row.forEach((cell, index) => {
        doc.save().rect(x, y, cols[index], h).fill(head ? C.tealSoft : '#FFFFFF').restore();
        doc.save().rect(x, y, cols[index], h).lineWidth(0.5).stroke(C.tableLine).restore();
        font(head ? 'semibold' : 'regular', 9, C.ink).text(cell || ' ', x + pad, y + pad, { width: cols[index] - pad * 2, align: head ? 'left' : (align[index] ?? 'left') });
        x += cols[index];
      });
      y += h;
    });
    y += 10;
  };

  /* header */
  addPage();
  doc.save().rect(0, 0, PAGE_W, 96).fill(C.docBlack).restore();
  try {
    const logo = await dupoinLogo();
    const size = await imageSize(logo);
    const box = containBox({ x: PAGE_W - MARGIN_X - 110, y: 28, w: 110, h: 40 }, size);
    doc.image(logo, box.x, box.y, { width: box.w, height: box.h });
  } catch { /* logo optional */ }
  font('semibold', 20, C.teal).text('Media Monitoring Report', MARGIN_X, 28, { width: CONTENT_W - 130 });
  font('regular', 10, '#FFFFFF').text(`${settings.brandName} · ${dashboard.range.from} to ${dashboard.range.to}`, MARGIN_X, 58, { width: CONTENT_W - 130 });
  y = 116;

  if (insights?.executiveSummary) { h2('Executive Summary'); paragraph(insights.executiveSummary); }

  /* KPI tiles */
  const tiles: Array<[string, string]> = [
    ['Total Mentions', compactNumber(dashboard.totals.mentions)],
    ['Total Engagement', compactNumber(dashboard.totals.engagement)],
    ['Potential Reach (est.)', compactNumber(dashboard.totals.reach)],
    [`Ad Value (est., ${dashboard.currency})`, compactNumber(dashboard.totals.adValue)],
  ];
  ensure(70);
  const tileW = (CONTENT_W - 18) / 4;
  tiles.forEach(([label, value], index) => {
    const x = MARGIN_X + index * (tileW + 6);
    doc.save().roundedRect(x, y, tileW, 58, 6).fill(C.tealCell).restore();
    font('regular', 8, C.muted).text(label, x + 10, y + 9, { width: tileW - 20 });
    font('semibold', 18, C.ink).text(value, x + 10, y + 26, { width: tileW - 20 });
  });
  y += 70;
  font('regular', 8, C.muted).text(`Official (owned) mentions: ${dashboard.totals.official} · Earned: ${dashboard.totals.earned}. Sources: ${dashboard.bySource.map(row => `${MEDIA_SOURCE_LABELS[row.source]} ${row.mentions}`).join(', ') || 'none'}.`, MARGIN_X, y, { width: CONTENT_W });
  y = doc.y + 10;

  if (insights?.campaignOverview.length) { h2('Campaign Overview'); bullets(insights.campaignOverview); }

  /* trend chart */
  h2('Mentions & Engagement Trend');
  ensure(170);
  const chartH = 120;
  const series = dashboard.timeline;
  const maxM = Math.max(1, ...series.map(point => point.mentions));
  const maxE = Math.max(1, ...series.map(point => point.engagement));
  const barW = CONTENT_W / Math.max(1, series.length);
  doc.save().moveTo(MARGIN_X, y + chartH).lineTo(MARGIN_X + CONTENT_W, y + chartH).lineWidth(0.5).stroke(C.tableLine).restore();
  series.forEach((point, index) => {
    const h = (point.mentions / maxM) * chartH;
    if (h > 0) doc.save().rect(MARGIN_X + index * barW + barW * 0.15, y + chartH - h, Math.max(1, barW * 0.7), h).fill(C.teal).restore();
  });
  doc.save();
  series.forEach((point, index) => {
    const px = MARGIN_X + index * barW + barW / 2;
    const py = y + chartH - (point.engagement / maxE) * chartH;
    if (index === 0) doc.moveTo(px, py); else doc.lineTo(px, py);
  });
  if (series.length > 1) doc.lineWidth(1.2).stroke('#F2A93B');
  doc.restore();
  const step = Math.max(1, Math.ceil(series.length / 8));
  series.forEach((point, index) => {
    if (index % step === 0) font('regular', 7, C.muted).text(point.date.slice(5), MARGIN_X + index * barW - 8, y + chartH + 4, { width: 40 });
  });
  y += chartH + 18;
  font('regular', 8, C.muted).text(`Bars: mentions per day (max ${maxM}). Line: engagement per day (max ${compactNumber(maxE)}). Peak engagement ${dashboard.peaks.engagementDay ?? 'n/a'}; most mentions ${dashboard.peaks.mentionsDay ?? 'n/a'}.`, MARGIN_X, y, { width: CONTENT_W });
  y = doc.y + 8;
  if (insights?.trendNote) paragraph(insights.trendNote);

  /* top posts */
  h2('Top 5 Posts');
  table([
    ['Channel', 'Author / Source', 'Post', 'Engagement', 'Ad value (est.)'],
    ...dashboard.topPosts.map(post => [MEDIA_CHANNEL_LABELS[post.channel], post.author, post.title.slice(0, 140) || post.url.slice(0, 80), compactNumber(post.engagement), compactNumber(post.adValue)]),
  ], [13, 18, 41, 14, 14], ['left', 'left', 'left', 'right', 'right']);
  if (!dashboard.topPosts.length) paragraph('No posts in this range.');
  if (insights?.topPostsNote) paragraph(insights.topPostsNote);

  /* sentiment */
  h2('Sentiment Analysis');
  const scored = dashboard.sentiment.positive + dashboard.sentiment.neutral + dashboard.sentiment.negative;
  ensure(50);
  let x = MARGIN_X;
  for (const key of ['positive', 'neutral', 'negative', 'unscored'] as const) {
    const w = dashboard.totals.mentions ? (dashboard.sentiment[key] / dashboard.totals.mentions) * CONTENT_W : 0;
    if (w > 0) doc.save().rect(x, y, w, 16).fill(SENT_COLORS[key]).restore();
    x += w;
  }
  y += 22;
  font('regular', 9, C.body).text(`Positive ${dashboard.sentiment.positive} (${percent(dashboard.sentiment.positive, scored)}) · Neutral ${dashboard.sentiment.neutral} (${percent(dashboard.sentiment.neutral, scored)}) · Negative ${dashboard.sentiment.negative} (${percent(dashboard.sentiment.negative, scored)})${dashboard.sentiment.unscored ? ` · Not yet scored ${dashboard.sentiment.unscored}` : ''}`, MARGIN_X, y, { width: CONTENT_W });
  y = doc.y + 8;
  if (insights?.sentimentNote) paragraph(insights.sentimentNote);
  if (insights && (insights.sentimentDrivers.positive || insights.sentimentDrivers.negative)) {
    bullets([`Positive: ${insights.sentimentDrivers.positive}`, `Neutral: ${insights.sentimentDrivers.neutral}`, `Negative: ${insights.sentimentDrivers.negative}`]);
  }

  h2('Sentiment by Channel');
  table([
    ['Channel', 'Positive', 'Neutral', 'Negative', 'Total Mentions'],
    ...dashboard.byChannel.map(row => [MEDIA_CHANNEL_LABELS[row.channel], String(row.positive), String(row.neutral), String(row.negative), String(row.total)]),
  ], [30, 17, 17, 17, 19], ['left', 'right', 'right', 'right', 'right']);
  if (insights?.channelObservations.length) bullets(insights.channelObservations);

  h2('Top Sources');
  table([
    ['Source', 'Channel', 'Mentions', 'Engagement'],
    ...dashboard.topSources.map(source => [source.name, MEDIA_CHANNEL_LABELS[source.channel], String(source.mentions), compactNumber(source.engagement)]),
  ], [44, 22, 16, 18], ['left', 'left', 'right', 'right']);

  if (insights?.perception.summary) {
    h2('Perception Comparison');
    paragraph(insights.perception.summary);
    bullets([`Awareness: ${insights.perception.awareness}`, `Interpretation: ${insights.perception.interpretation}`, `Niche Discussion: ${insights.perception.nicheDiscussion}`]);
    paragraph(insights.perception.overallTone);
  }
  if (insights?.keyInsights.length) { h2('Key Insights'); bullets(insights.keyInsights.map((item, index) => `${index + 1}. ${item}`)); }
  if (insights && (insights.recommendations.strengths.length || insights.recommendations.fixes.length)) {
    h2('AI-based Recommendations');
    font('semibold', 10, C.ink).text('Strengths', MARGIN_X, y); y = doc.y + 4; bullets(insights.recommendations.strengths);
    font('semibold', 10, C.ink).text('Fixes', MARGIN_X, y); y = doc.y + 4; bullets(insights.recommendations.fixes);
    font('semibold', 10, C.ink).text('Additional', MARGIN_X, y); y = doc.y + 4; bullets(insights.recommendations.additional);
  }
  if (!insights) paragraph('Insights and recommendations were not generated for this range yet (use "Generate insights" on the page).', 9, C.muted);

  ensure(60);
  y += 6;
  font('regular', 7.5, C.muted).text(`${AD_VALUE_FORMULA} CPM used (${dashboard.currency}): ${Object.entries(settings.adValue.cpm).map(([channel, cpm]) => `${MEDIA_CHANNEL_LABELS[channel as keyof typeof MEDIA_CHANNEL_LABELS]} ${cpm.toLocaleString('en-US')}`).join(', ')}. Assumed readers per online article: ${settings.adValue.onlineMediaReach.toLocaleString('en-US')}; engagement-to-reach multiplier: ${settings.adValue.engagementToReach}. These are estimates, not audited figures.`, MARGIN_X, y, { width: CONTENT_W, lineGap: 1 });
  y = doc.y + 6;
  font('regular', 7.5, C.muted).text(`Generated by MarketingOS on ${generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC from Google Alerts, Google News, GDELT${dashboard.bySource.some(row => row.source === 'youtube_api') ? ', YouTube' : ''}${dashboard.bySource.some(row => row.source === 'treg') ? ' and treg' : ''} data. AI-assisted insights.`, MARGIN_X, y, { width: CONTENT_W });
  doc.end();
  return done;
}
