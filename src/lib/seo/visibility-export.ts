import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { EntityVerdict, GapReport, PromptGap, Recommendation } from './visibility-gaps';

/** CSV / XLSX / PDF builders for the AI Visibility export and gap report. */

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EXCEL_CELL_MAX = 32_000;

export const VERDICT_LABELS: Record<EntityVerdict, string> = {
  'described-as-recognised': 'Describes the brand as the recognised body',
  'mentioned-not-recognised': 'Mentions the brand, not as the recognised body',
  contradictory: 'Contradicts itself about the brand\'s status',
  'not-mentioned': 'Does not mention the brand',
};

export const STATUS_LABELS: Record<PromptGap['status'], string> = {
  unchecked: 'Not checked', zero: 'Zero visibility', weak: 'Weak', partial: 'Partial', strong: 'Visible on all models',
};

export function wib(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' WIB';
}

const pct = (value: number | null) => (value === null ? '—' : `${value}%`);

/** Spreadsheet formula injection guard. */
export function safeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function cellText(prompt: PromptGap, model: string): string {
  const cell = prompt.cells[model];
  if (!cell) return '—';
  if (cell.error) return 'error';
  if (cell.fallback) return 'fallback';
  if (cell.mentioned) return `yes${cell.rank ? ` #${cell.rank}` : ''}${cell.siteCited ? ' (cited)' : ''}`;
  return cell.siteCited ? 'no (site cited)' : 'no';
}

// ---------- Rows (shared by CSV and XLSX) ----------

export function promptRows(report: GapReport): Array<Array<string | number>> {
  const header = ['Prompt', 'Active', 'Status', 'Topic', 'Brand aliases', ...report.models.map(model => `${model} (latest)`),
    'Latest yes', 'Latest answers', 'Lifetime mentions', 'Lifetime answers', 'Last checked (WIB)', 'Competitors mentioned', 'Named instead (when missing)', 'Cited URLs', 'Flags', 'Likely gap'];
  return [header, ...report.prompts.map(prompt => [
    safeCell(prompt.prompt), prompt.active ? 'yes' : 'no', STATUS_LABELS[prompt.status], prompt.topic, safeCell(prompt.aliases.join('; ')),
    ...report.models.map(model => cellText(prompt, model)),
    prompt.latestYes, prompt.latestTotal, prompt.lifetimeMentions, prompt.lifetimeAnswers, wib(prompt.lastChecked),
    safeCell(prompt.competitorsMentioned.join('; ')),
    safeCell(prompt.namedInstead.map(entity => `${entity.name}${entity.bestRank ? ` (#${entity.bestRank})` : ''}`).join('; ')),
    safeCell(prompt.citedUrls.join(' ')), prompt.flags.join('; '), safeCell(prompt.likelyGap),
  ])];
}

export function gapReportCsv(report: GapReport): string {
  return '\uFEFF' + promptRows(report).map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';
}

// ---------- XLSX ----------

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2A44' } };

function addSheet(book: ExcelJS.Workbook, name: string, rows: Array<Array<string | number | null>>, widths: number[]) {
  const sheet = book.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  for (const row of rows) sheet.addRow(row.map(value => (typeof value === 'string' && value.length > EXCEL_CELL_MAX ? `${value.slice(0, EXCEL_CELL_MAX)}…` : value)));
  const head = sheet.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = HEADER_FILL;
  head.alignment = { vertical: 'middle', wrapText: true };
  sheet.columns.forEach((column, index) => { column.width = widths[index] ?? 18; column.alignment = { vertical: 'top', wrapText: true }; });
  return sheet;
}

function recommendationRows(recs: Recommendation[]): Array<Array<string>> {
  const rows: string[][] = [['Priority', 'Area', 'Recommendation', 'Why', 'Actions', 'Pages to create (H1 / FAQ)', 'Snippet']];
  for (const rec of recs) {
    rows.push([
      rec.priority, rec.category, safeCell(rec.title), safeCell(rec.why), safeCell(rec.actions.map(action => `• ${action}`).join('\n')),
      safeCell((rec.pages ?? []).map(page => `${page.slug} — ${page.h1}\n${page.faq.map(question => `  - ${question}`).join('\n')}`).join('\n\n')),
      rec.snippet ? safeCell(rec.snippet.code) : '',
    ]);
  }
  return rows;
}

export async function gapReportXlsx(report: GapReport): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = 'MarketingOS';
  book.created = new Date(report.generatedAt);
  const s = report.summary;

  const summary: Array<Array<string | number | null>> = [
    ['Metric', 'Value'],
    ['Site', `${report.site.name} (${report.site.host || 'no host'})`],
    ['Generated', wib(report.generatedAt)],
    ['Prompts tracked / checked', `${s.promptsTracked} / ${s.promptsChecked}`],
    ['Latest run: mentions / answers', `${s.latestMentions} / ${s.latestAnswers} (${pct(s.latestRate)})`],
    ['Lifetime: mentions / answers', `${s.lifetimeMentions} / ${s.lifetimeAnswers} (${pct(s.lifetimeRate)})`],
    ['Weakest model (latest)', s.weakestModel ?? '—'],
    ['Strongest model (latest)', s.strongestModel ?? '—'],
    ['Zero-visibility prompts', s.zeroVisibility.length],
    ['Visible on every model', s.fullVisibility.length],
    [],
    ['Model', 'Latest rate', 'Latest mentions / answers', 'Latest site cited', 'Lifetime rate', 'Lifetime mentions / answers', 'Fallbacks (excluded)', 'Errors'],
    ...s.byModel.map(row => [row.model, pct(row.latestRate), `${row.latestMentions} / ${row.latestAnswers}`, row.latestSiteCited, pct(row.lifetimeRate), `${row.lifetimeMentions} / ${row.lifetimeAnswers}`, row.fallbacks, row.errors]),
    [],
    ['Zero-visibility prompts'],
    ...s.zeroVisibility.map(prompt => [safeCell(prompt.prompt)]),
    [],
    ['Answers served by a fallback model and errors are excluded from rates. "Latest" = the most recent answer per prompt and model.'],
  ];
  const summarySheet = addSheet(book, 'Summary', summary, [34, 30, 24, 16, 14, 24, 18, 10]);
  summarySheet.getRow(12).font = { bold: true };

  addSheet(book, 'Prompts', promptRows(report), [48, 8, 16, 14, 30, ...report.models.map(() => 16), 10, 10, 10, 10, 20, 24, 30, 40, 18, 50]);

  const gapRows: Array<Array<string | number>> = [['Prompt', 'Status', 'Missed by', 'Named instead (configured first)', 'Sources cited when missing', 'Likely content gap']];
  for (const prompt of report.prompts.filter(item => item.status === 'zero' || item.status === 'weak' || item.status === 'partial')) {
    const missedBy = report.models.filter(model => prompt.cells[model] && !prompt.cells[model]!.error && !prompt.cells[model]!.fallback && !prompt.cells[model]!.mentioned);
    gapRows.push([
      safeCell(prompt.prompt), STATUS_LABELS[prompt.status], missedBy.join('\n'),
      safeCell(prompt.namedInstead.map(entity => `${entity.name}${entity.bestRank ? ` #${entity.bestRank}` : ''} (${entity.answers}×${entity.configured ? ', competitor' : ''})`).join('\n')),
      prompt.sourcesWhenMissing.join('\n'), safeCell(prompt.likelyGap),
    ]);
  }
  addSheet(book, 'Gaps', gapRows, [48, 16, 24, 40, 30, 60]);

  const entityRows: Array<Array<string | number>> = [['Model', 'Verdict', 'Answers mentioning brand', 'What AI says the brand is (excerpts)', 'Says brand is recognised', 'Denies / negative', 'Uncertain', 'Describes another body as official']];
  for (const model of report.entity.byModel) {
    entityRows.push([
      model.model, VERDICT_LABELS[model.verdict], `${model.answersMentioning} / ${model.answersTotal}`,
      safeCell(model.excerpts.map(text => `“${text}”`).join('\n')), safeCell(model.recognisedStatements.map(text => `“${text}”`).join('\n')),
      safeCell(model.negativeStatements.map(text => `“${text}”`).join('\n')), safeCell(model.uncertainStatements.map(text => `“${text}”`).join('\n')),
      safeCell(model.otherBodyStatements.map(text => `“${text}”`).join('\n')),
    ]);
  }
  entityRows.push([], ['Contradictions'], ...report.entity.contradictions.map(text => [safeCell(text)]));
  entityRows.push([], ['Acronym expansions used by AI', 'Count', 'Models'], ...report.entity.expansions.map(entry => [safeCell(entry.expansion), entry.count, entry.models.join(', ')]));
  addSheet(book, 'Entity understanding', entityRows, [24, 30, 14, 60, 50, 40, 40, 50]);

  addSheet(book, 'Answers', [
    ['Prompt', 'Model', 'Answered by', 'Checked (WIB)', 'Mentioned', 'Rank', 'Site cited', 'Competitors mentioned', 'Cited URLs', 'Answer', 'Error'],
    ...report.answers.map(row => [
      safeCell(row.prompt), row.model, row.answeredModel ?? '—', wib(row.createdAt), row.mentioned === null ? '—' : row.mentioned ? 'yes' : 'no',
      row.rank ?? '', row.siteCited ? 'yes' : 'no', safeCell(row.competitorsMentioned.join('; ')), safeCell(row.citedUrls.join('\n')), safeCell(row.response), row.error ?? '',
    ]),
  ], [40, 20, 20, 18, 10, 6, 10, 20, 40, 100, 24]);

  addSheet(book, 'Sources', [
    ['Domain', 'Type', 'Cited in latest answers', 'Cited when brand missing', 'Cited when brand present', 'Lifetime citations', 'Brand site', 'Competitor domain'],
    ...report.sources.domains.map(row => [row.domain, row.kind, row.latestCitations, row.whenBrandMissing, row.whenBrandPresent, row.lifetimeCitations, row.isSite ? 'yes' : '', row.isCompetitor ? 'yes' : '']),
    [],
    [`Latest answers with any citation: ${report.sources.answersWithCitation} / ${report.sources.latestAnswers}. Answers citing the brand site: ${report.sources.siteCitedAnswers}.`],
  ], [34, 14, 14, 14, 14, 14, 10, 12]);

  const recRows = recommendationRows(report.recommendations);
  if (report.aiSummary) recRows.splice(1, 0, ['summary', 'ai', 'AI summary (check before use)', '', safeCell(report.aiSummary), '', '']);
  addSheet(book, 'Recommendations', recRows, [10, 12, 40, 50, 80, 60, 60]);

  addSheet(book, 'Flags', [
    ['Prompt', 'Issue', 'What to change'],
    ...report.flags.map(flag => [safeCell(flag.prompt), flag.kind, safeCell(flag.message)]),
  ], [50, 16, 80]);

  return Buffer.from(await book.xlsx.writeBuffer());
}

// ---------- PDF ----------

const NAVY = '#0F2A44';
const ACCENT = '#2EB5C4';
const MUTED = '#5B6B7B';
const TEXT = '#1B2430';
const PRIORITY_COLORS: Record<string, string> = { high: '#C0392B', medium: '#D68910', low: '#2E86C1' };

/** Helvetica only covers WinAnsi; map common symbols and drop the rest. */
export function pdfText(value: string): string {
  return value
    .replace(/[\u2192\u21d2]/g, '->').replace(/[\u2264]/g, '<=').replace(/[\u2265]/g, '>=').replace(/\u00d7/g, 'x')
    .replace(/[\u2010-\u2012]/g, '-').replace(/\u2212/g, '-')
    .replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026]/gu, '');
}

export async function gapReportPdf(report: GapReport): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 48, right: 48 }, bufferPages: true,
    info: { Title: pdfText(`AI Visibility Gap Report - ${report.site.name}`), Creator: 'MarketingOS' } });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => { doc.on('end', () => resolve()); doc.on('error', reject); });
  const width = doc.page.width - 96;
  const left = 48;
  const bottom = () => doc.page.height - 56;
  const ensure = (space: number) => { if (doc.y + space > bottom()) doc.addPage(); };
  const t = (value: string) => pdfText(value);

  const heading = (text: string) => {
    ensure(60);
    doc.moveDown(0.8);
    const y = doc.y;
    doc.rect(left, y, 4, 18).fill(ACCENT);
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(15).text(t(text), left + 12, y + 1, { width: width - 12 });
    doc.moveDown(0.4);
    doc.x = left;
  };
  const sub = (text: string) => { ensure(36); doc.moveDown(0.4); doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11.5).text(t(text), left, doc.y, { width }); doc.moveDown(0.15); };
  const para = (text: string, options: { color?: string; size?: number; italic?: boolean } = {}) => {
    ensure(24);
    doc.fillColor(options.color ?? TEXT).font(options.italic ? 'Helvetica-Oblique' : 'Helvetica').fontSize(options.size ?? 10).text(t(text), left, doc.y, { width, lineGap: 1.5 });
  };
  const bullet = (text: string, indent = 0) => {
    ensure(20);
    const y = doc.y;
    doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(10).text('•', left + indent, y);
    doc.fillColor(TEXT).font('Helvetica').fontSize(10).text(t(text), left + indent + 12, y, { width: width - indent - 12, lineGap: 1.5 });
    doc.x = left;
  };
  const quote = (text: string) => {
    ensure(24);
    const y = doc.y;
    doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(9.5).text(t(`“${text}”`), left + 14, y, { width: width - 14, lineGap: 1 });
    doc.rect(left + 4, y, 2, doc.y - y).fill('#C9D3DD');
    doc.x = left;
    doc.moveDown(0.15);
  };
  const table = (head: string[], rows: string[][], widths: number[]) => {
    const total = widths.reduce((sum, value) => sum + value, 0);
    const cols = widths.map(value => (value / total) * width);
    const drawRow = (cells: string[], header: boolean) => {
      doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      const heights = cells.map((cell, index) => doc.heightOfString(t(cell), { width: cols[index] - 8 }));
      const height = Math.max(...heights) + 8;
      if (doc.y + height > bottom()) { doc.addPage(); if (!header) drawRow(head, true); }
      const y = doc.y;
      if (header) doc.rect(left, y, width, height).fill(NAVY);
      else doc.rect(left, y, width, height).fill('#F4F7FA');
      let x = left;
      cells.forEach((cell, index) => {
        doc.fillColor(header ? '#FFFFFF' : TEXT).font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).text(t(cell), x + 4, y + 4, { width: cols[index] - 8 });
        x += cols[index];
      });
      doc.y = y + height + 2;
      doc.x = left;
    };
    ensure(40);
    drawRow(head, true);
    for (const row of rows) drawRow(row, false);
    doc.moveDown(0.3);
  };

  // Cover band
  doc.rect(0, 0, doc.page.width, 120).fill(NAVY);
  doc.rect(0, 120, doc.page.width, 4).fill(ACCENT);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(22).text('AI Visibility Gap Report', left, 36, { width });
  doc.font('Helvetica').fontSize(12).fillColor('#D6E4F0').text(t(`${report.entity.brandLabel} · ${report.site.host || report.site.name}`), left, 68, { width });
  doc.fontSize(9).text(t(`Generated ${wib(report.generatedAt)} · ${report.summary.promptsTracked} prompts · ${report.models.length} AI models`), left, 88, { width });
  doc.y = 144;
  para('What this report shows: how often AI assistants mention the brand when asked the questions people ask, what they say the brand is, who they name instead, which sources they rely on, and what to fix on the site and elsewhere.', { color: MUTED, size: 9.5 });
  para('Internal report: competitor names appear where they were configured or named by AI. The suggested site copy never names competitors and never states a status as fact; it asks you to publish verifiable evidence.', { color: MUTED, size: 9, italic: true });

  const s = report.summary;
  heading('At a glance');
  table(['Latest run', 'Lifetime', 'Zero-visibility prompts', 'Weakest model'], [[
    `${pct(s.latestRate)} (${s.latestMentions}/${s.latestAnswers})`, `${pct(s.lifetimeRate)} (${s.lifetimeMentions}/${s.lifetimeAnswers})`,
    `${s.zeroVisibility.length} of ${s.promptsChecked}`, s.weakestModel ?? '—',
  ]], [1, 1, 1, 1.3]);
  table(['Model', 'Latest', 'Lifetime', 'Cites the site', 'Fallbacks / errors'],
    s.byModel.map(row => [row.model, `${pct(row.latestRate)} (${row.latestMentions}/${row.latestAnswers})`, `${pct(row.lifetimeRate)} (${row.lifetimeMentions}/${row.lifetimeAnswers})`, String(row.latestSiteCited), `${row.fallbacks} / ${row.errors}`]),
    [1.6, 1.1, 1.1, 0.8, 0.9]);
  if (report.aiSummary) {
    sub('Summary (AI-written, check before use)');
    for (const line of report.aiSummary.split(/\n+/).map(item => item.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean)) bullet(line);
  }

  heading('What AI says the brand is');
  for (const model of report.entity.byModel) {
    sub(`${model.model}: ${VERDICT_LABELS[model.verdict]}`);
    para(`Mentions the brand in ${model.answersMentioning} of ${model.answersTotal} latest answers.`, { color: MUTED, size: 9 });
    for (const excerpt of model.excerpts.slice(0, 2)) quote(excerpt);
    if (model.recognisedStatements.length) { para('Says the brand is recognised:', { size: 9 }); model.recognisedStatements.slice(0, 2).forEach(quote); }
    if (model.negativeStatements.length) { para('Denies or questions it:', { size: 9 }); model.negativeStatements.slice(0, 2).forEach(quote); }
    if (model.uncertainStatements.length) { para('Unsure:', { size: 9 }); model.uncertainStatements.slice(0, 2).forEach(quote); }
    if (model.otherBodyStatements.length) { para('Describes another organisation as the official body:', { size: 9 }); model.otherBodyStatements.slice(0, 2).forEach(quote); }
  }
  if (report.entity.contradictions.length) {
    sub('Contradictions');
    report.entity.contradictions.forEach(text => bullet(text));
  }

  const losing = report.prompts.filter(prompt => prompt.status === 'zero' || prompt.status === 'weak' || prompt.status === 'partial');
  heading(`Where the brand is missing (${losing.length})`);
  if (!losing.length) para('Every checked prompt mentions the brand on every model.');
  for (const prompt of losing.slice(0, 40)) {
    sub(prompt.prompt.length > 160 ? `${prompt.prompt.slice(0, 157)}…` : prompt.prompt);
    para(`${STATUS_LABELS[prompt.status]} · ${report.models.map(model => `${model}: ${cellText(prompt, model)}`).join(' · ')}`, { color: MUTED, size: 9 });
    if (prompt.namedInstead.length) bullet(`AI named instead: ${prompt.namedInstead.slice(0, 5).map(entity => `${entity.name}${entity.bestRank ? ` (#${entity.bestRank})` : ''}`).join(', ')}`);
    if (prompt.sourcesWhenMissing.length) bullet(`Sources it cited: ${prompt.sourcesWhenMissing.slice(0, 5).join(', ')}`);
    bullet(`Likely gap: ${prompt.likelyGap}`);
  }
  if (losing.length > 40) para(`…and ${losing.length - 40} more in the Excel export.`, { color: MUTED });

  heading('What to fix');
  for (const rec of report.recommendations) {
    ensure(70);
    doc.moveDown(0.5);
    const y = doc.y;
    doc.roundedRect(left, y, 54, 14, 3).fill(PRIORITY_COLORS[rec.priority] ?? MUTED);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8).text(rec.priority.toUpperCase(), left, y + 3.5, { width: 54, align: 'center' });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11.5).text(t(rec.title), left + 62, y + 1, { width: width - 62 });
    doc.x = left;
    doc.moveDown(0.2);
    para(rec.why, { color: MUTED, size: 9.5 });
    rec.actions.forEach(action => bullet(action));
    for (const page of rec.pages ?? []) {
      ensure(50);
      doc.moveDown(0.2);
      doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(10).text(t(`${page.slug} — H1: ${page.h1}`), left + 12, doc.y, { width: width - 12 });
      page.faq.forEach(question => bullet(question, 24));
    }
    if (rec.snippet) {
      const code = t(rec.snippet.code);
      doc.font('Courier').fontSize(7.5);
      const height = doc.heightOfString(code, { width: width - 16 }) + 12;
      if (height < bottom() - 56 - 20) ensure(height + 20);
      doc.moveDown(0.3);
      const top = doc.y;
      doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8.5).text(t(rec.snippet.label), left, top);
      const boxTop = doc.y + 2;
      if (boxTop + height <= bottom()) doc.rect(left, boxTop, width, height).fill('#F1F4F8');
      doc.fillColor(TEXT).font('Courier').fontSize(7.5).text(code, left + 8, boxTop + 6, { width: width - 16 });
      doc.x = left;
      doc.moveDown(0.8);
    }
  }

  const sources = report.sources.domains.filter(row => row.latestCitations > 0).slice(0, 20);
  heading('Sources AI cites');
  para(`${report.sources.answersWithCitation} of ${report.sources.latestAnswers} latest answers cite a source; ${report.sources.siteCitedAnswers} cite the brand site.`, { color: MUTED, size: 9.5 });
  if (sources.length) {
    table(['Domain', 'Type', 'Cited', 'When brand missing', 'Note'], sources.map(row => [row.domain, row.kind, String(row.latestCitations), String(row.whenBrandMissing), row.isSite ? 'brand site' : row.isCompetitor ? 'competitor' : '']), [2.2, 1, 0.6, 0.9, 0.9]);
  }

  if (report.flags.length) {
    heading('Tracking issues');
    for (const flag of report.flags.slice(0, 40)) bullet(`${flag.prompt.length > 90 ? `${flag.prompt.slice(0, 87)}…` : flag.prompt} — ${flag.message}`);
  }

  // Footer on every page
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const y = doc.page.height - 36;
    doc.page.margins.bottom = 0;
    doc.fillColor(MUTED).font('Helvetica').fontSize(8)
      .text(t(`AI Visibility Gap Report · ${report.site.name} · MarketingOS`), left, y, { width: width / 2, lineBreak: false })
      .text(`Page ${index + 1} of ${range.count}`, left + width / 2, y, { width: width / 2, align: 'right', lineBreak: false });
  }
  doc.end();
  await finished;
  return Buffer.concat(chunks);
}
