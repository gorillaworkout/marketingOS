/**
 * Event Plan → presentation model. Browser safe (no file or model access).
 *
 * The deck is built from the plan exactly as the user last left it: the
 * selected plan option plus the current quotation table and contingency.
 * Every slide section is optional and only appears when the plan has data
 * for it. Nothing here invents facts, numbers, or awards.
 */
import { scrubMissingPriceNotes } from './event-plan-pricing';
import {
  alignBudgetWithQuotation,
  parseContingencyPercent,
  parseParticipantCount,
  parseQuotationLines,
  parseSpeakerNames,
  quotationGrandTotal,
  type QuotationLine,
} from './event-plan-quotation';

/** What the page (or History) sends to the export route. */
export interface EventPlanDeckInput {
  eventName: string;
  location?: string;
  theme?: string;
  targetDate?: string;
  venueName?: string;
  participants?: number | null;
  speakers?: string[];
  quotations?: QuotationLine[];
  contingencyPercent?: number;
  option: Record<string, unknown>;
}

export interface DeckBudgetRow {
  category: string;
  vendor: string;
  description: string;
  qty: number | null;
  unitPrice: number | null;
  amount: number | null;
  currency: string;
  source: 'quotation' | 'estimate';
}

export interface DeckBudget {
  rows: DeckBudgetRow[];
  /** IDR total of quotation rows. Null without a quotation. */
  quotationSubtotal: number | null;
  contingencyPercent: number | null;
  contingency: number | null;
  /** IDR total of estimate rows that have a sourced price. */
  estimateSubtotal: number | null;
  /** Estimate rows still waiting for a price. */
  unpricedCount: number;
  total: number | null;
  ceilingNote?: string;
}

export interface DeckRundownItem { time: string; activity: string }
export interface DeckMilestone { label: string; text: string }

export interface EventPlanDeck {
  eventName: string;
  styleLabel: string;
  theme: string;
  location: string;
  venue: string;
  targetDate: string;
  participants: number | null;
  objective: string;
  concept: string;
  speakers: string[];
  budget: DeckBudget | null;
  rundown: DeckRundownItem[];
  timeline: DeckMilestone[];
  kpis: string[];
  risks: string[];
  sources: Array<{ title: string; url: string }>;
  language: 'en' | 'id';
}

const MAX_TEXT = 6000;

function text(value: unknown, max = MAX_TEXT): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

/** Drops emoji and pictographs (the style labels carry them; slide fonts do not). */
export function stripEmoji(value: string): string {
  return value.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s{2,}/g, ' ').trim();
}

function money(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.round(value);
  if (typeof value === 'string' && value.trim()) {
    const digits = value.replace(/\D/g, '');
    const parsed = digits ? Number(digits) : NaN;
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function list(value: unknown, maxItems = 40): string[] {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\n+/) : [];
  return source
    .map(item => (typeof item === 'string' ? cleanLine(item) : item && typeof item === 'object' ? cleanLine(Object.values(item as Record<string, unknown>).filter(v => typeof v === 'string').join(' — ')) : ''))
    .filter(Boolean)
    .slice(0, maxItems);
}

/** Strips markdown bullets, numbering, and emphasis from one line. */
function cleanLine(line: string): string {
  return line
    .replace(/^\s*(?:[-*•·▪►]+|\d{1,2}[.)])\s+/, '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`/g, '')
    .trim();
}

const TIME = String.raw`\d{1,2}[:.]\d{2}`;
const RUNDOWN_LINE = new RegExp(String.raw`^(${TIME}(?:\s*(?:WIB|WITA|WIT))?(?:\s*[-–—]\s*${TIME})?(?:\s*(?:WIB|WITA|WIT))?)\s*(?:[-–—:|]\s*)?(.+)$`, 'i');
const MILESTONE_LINE = /^((?:H|D|T)\s?[-−–]\s?\d+|(?:H|D)\s?\+\s?\d+|(?:Week|Minggu|Day|Hari|Month|Bulan|Phase|Fase|Tahap)\s*(?:ke-?\s*)?\d+(?:\s*[-–]\s*\d+)?|\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{4})?|\d{4}-\d{2}-\d{2})\s*[:\-–—|)]\s*(.+)$/i;

type Bucket = 'timeline' | 'rundown' | 'kpis' | 'risks';

function headingBucket(heading: string): Bucket | null {
  const h = heading.toLowerCase();
  if (/\bkpis?\b|success metric|metrics|indikator|target keberhasilan|key performance/.test(h)) return 'kpis';
  if (/risk|risiko|resiko|mitigat|contingency plan/.test(h)) return 'risks';
  if (/rundown|run of show|agenda|susunan acara|event day|hari h\b|day of event/.test(h)) return 'rundown';
  if (/timeline|milestone|checklist|preparation|persiapan|jadwal|schedule|pre-event|post-event|pasca/.test(h)) return 'timeline';
  return null;
}

function isHeading(raw: string): string | null {
  const line = raw.trim();
  if (!line) return null;
  const md = /^#{1,6}\s+(.+)$/.exec(line) || /^\*\*([^*]{2,70})\*\*:?$/.exec(line);
  if (md) return md[1].replace(/:$/, '').trim();
  if (/^[^:]{2,60}:$/.test(line) && !RUNDOWN_LINE.test(line)) return line.slice(0, -1).trim();
  return null;
}

/**
 * Splits the free-text plan timeline into rundown rows (clock times),
 * milestones (H-30, Week 2, dates), KPIs, and risks — using only the
 * lines the plan contains, in their original language.
 */
export function parseTimeline(value: string): { rundown: DeckRundownItem[]; timeline: DeckMilestone[]; kpis: string[]; risks: string[] } {
  const out = { rundown: [] as DeckRundownItem[], timeline: [] as DeckMilestone[], kpis: [] as string[], risks: [] as string[] };
  let source = text(value);
  if (!source) return out;
  // A single long paragraph: split it at sentence or semicolon boundaries.
  if (!source.includes('\n') && source.length > 160) source = source.split(/;\s+|(?<=\.)\s+(?=[A-Z0-9H])/).join('\n');
  let bucket: Bucket = 'timeline';
  for (const raw of source.split('\n')) {
    const heading = isHeading(raw);
    if (heading) {
      bucket = headingBucket(heading) ?? 'timeline';
      continue;
    }
    const line = cleanLine(raw);
    if (!line) continue;
    if (bucket === 'kpis') { out.kpis.push(line); continue; }
    if (bucket === 'risks') { out.risks.push(line); continue; }
    const time = RUNDOWN_LINE.exec(line);
    if (time) { out.rundown.push({ time: time[1].replace(/\s+/g, ' ').trim(), activity: time[2].trim() }); continue; }
    if (bucket === 'rundown') { out.rundown.push({ time: '', activity: line }); continue; }
    const milestone = MILESTONE_LINE.exec(line);
    if (milestone) { out.timeline.push({ label: milestone[1].trim(), text: milestone[2].trim() }); continue; }
    const labelled = /^([^:]{2,28}):\s+(.+)$/.exec(line);
    if (labelled) { out.timeline.push({ label: labelled[1].trim(), text: labelled[2].trim() }); continue; }
    out.timeline.push({ label: '', text: line });
  }
  out.rundown = out.rundown.slice(0, 80);
  out.timeline = out.timeline.slice(0, 80);
  return out;
}

const ID_WORDS = /\b(yang|dan|untuk|dengan|acara|peserta|kegiatan|tujuan|meningkatkan|melalui|sebagai|dari|akan|pembicara)\b/gi;
const EN_WORDS = /\b(the|and|for|with|event|participants|will|through|from|our|to)\b/gi;

function detectLanguage(parts: string[]): 'en' | 'id' {
  const sample = parts.join(' ');
  const id = sample.match(ID_WORDS)?.length ?? 0;
  const en = sample.match(EN_WORDS)?.length ?? 0;
  return id > en ? 'id' : 'en';
}

/**
 * Recomputes the budget from the current quotation table, so edits made
 * after generation (added, removed, or changed rows, new contingency)
 * are what the deck shows.
 */
export function liveDeckBudget(rawBudget: unknown, quotations: QuotationLine[], contingencyPercent: number): DeckBudget | null {
  const budget = rawBudget && typeof rawBudget === 'object' && !Array.isArray(rawBudget) ? rawBudget as Record<string, unknown> : null;
  const storedItems = Array.isArray(budget?.items) ? budget!.items : [];
  const estimatesOnly = storedItems.filter(item => item && typeof item === 'object' && (item as Record<string, unknown>).source !== 'quotation');
  const aligned = alignBudgetWithQuotation({ ...(budget || {}), items: estimatesOnly }, quotations);
  const hasQuotation = quotations.length > 0;
  const estimateRows: DeckBudgetRow[] = (Array.isArray(aligned.items) ? aligned.items : []).flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const row = scrubMissingPriceNotes(item as Record<string, unknown>, hasQuotation);
    const vendor = [text(row.suggestedVendor, 160), text(row.venue, 160)].filter(Boolean);
    return [{
      category: text(row.category, 60) || 'Other',
      vendor: [...new Set(vendor)].join(' · '),
      description: text(row.notes, 600),
      qty: null,
      unitPrice: null,
      amount: money(row.estimatedCost),
      currency: 'IDR',
      source: 'estimate' as const,
    }];
  });
  const quotationRows: DeckBudgetRow[] = quotations.map(line => ({
    category: line.category,
    vendor: line.vendor,
    description: [line.item, line.notes].filter(Boolean).join(' — '),
    qty: line.qty,
    unitPrice: line.unitPrice,
    amount: line.total,
    currency: line.currency,
    source: 'quotation' as const,
  }));
  const rows = [...quotationRows, ...estimateRows];
  if (!rows.length && !budget) return null;
  const totals = quotationGrandTotal(quotations, contingencyPercent);
  const priced = estimateRows.filter(row => row.amount !== null);
  const estimateSubtotal = priced.length ? priced.reduce((sum, row) => sum + (row.amount ?? 0), 0) : null;
  // A stored contingency that came from a since-removed quotation no longer applies.
  const hadQuotation = storedItems.some(item => item && typeof item === 'object' && (item as Record<string, unknown>).source === 'quotation');
  const storedContingency = hasQuotation || hadQuotation ? null : money(budget?.contingency);
  const contingency = hasQuotation ? totals.contingency : storedContingency;
  const parts = [hasQuotation ? totals.total : null, estimateSubtotal, hasQuotation ? null : storedContingency].filter((v): v is number => v !== null);
  return {
    rows,
    quotationSubtotal: hasQuotation ? totals.subtotal : null,
    contingencyPercent: hasQuotation ? parseContingencyPercent(contingencyPercent) : null,
    contingency,
    estimateSubtotal,
    unpricedCount: estimateRows.filter(row => row.amount === null).length,
    total: parts.length ? parts.reduce((sum, v) => sum + v, 0) : null,
    ceilingNote: text(budget?.ceilingNote, 300) || undefined,
  };
}

function isoDate(value: unknown): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

/** Builds the deck model from the plan state. Safe on untrusted input. */
export function buildEventPlanDeck(input: EventPlanDeckInput): EventPlanDeck {
  const option = input.option && typeof input.option === 'object' && !Array.isArray(input.option) ? input.option : {};
  const quotations = parseQuotationLines(input.quotations);
  const contingencyPercent = parseContingencyPercent(input.contingencyPercent);
  const hasQuotation = quotations.length > 0;
  const clean = scrubMissingPriceNotes(option, hasQuotation);
  const parsed = parseTimeline(text(clean.timeline));
  const speakers = parseSpeakerNames(input.speakers?.length ? input.speakers : clean.speakers);
  const research = clean.research && typeof clean.research === 'object' ? clean.research as Record<string, unknown> : {};
  const sources = (Array.isArray(research.sources) ? research.sources : []).flatMap(source => {
    if (!source || typeof source !== 'object') return [];
    const s = source as Record<string, unknown>;
    const url = text(s.url, 500);
    if (!/^https?:\/\//i.test(url)) return [];
    return [{ title: text(s.title, 160) || text(s.claim, 160), url }];
  }).filter((source, index, all) => all.findIndex(other => other.url === source.url) === index).slice(0, 12);
  const objective = text(clean.objective);
  const concept = text(clean.concept);
  const eventName = text(input.eventName, 160) || 'Event plan';
  return {
    eventName,
    styleLabel: stripEmoji(text(clean.styleLabel, 60) || text(clean.style, 60)),
    theme: text(clean.theme, 400) || text(input.theme, 400),
    location: text(input.location, 160),
    venue: text(input.venueName, 200) || text(clean.venue, 400),
    targetDate: isoDate(input.targetDate),
    participants: parseParticipantCount(input.participants),
    objective,
    concept,
    speakers,
    budget: liveDeckBudget(clean.budget, quotations, contingencyPercent),
    rundown: parsed.rundown,
    timeline: parsed.timeline,
    kpis: [...list(clean.kpis), ...list(clean.kpi), ...list(clean.successMetrics), ...parsed.kpis].slice(0, 30),
    risks: [...list(clean.risks), ...list(clean.riskMitigation), ...parsed.risks].slice(0, 30),
    sources,
    language: detectLanguage([eventName, objective, concept, text(clean.timeline, 1500)]),
  };
}

export function formatDeckIdr(value: number | null, currency = 'IDR'): string {
  if (value === null) return 'To be quoted';
  if (currency !== 'IDR') return `${currency} ${value.toLocaleString('en-US')}`;
  return `Rp ${Math.max(0, Math.round(value)).toLocaleString('id-ID')}`;
}

export function formatDeckDate(iso: string): string {
  if (!iso) return '';
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(date);
}

export function eventPlanPptxFilename(eventName: string, date = new Date()): string {
  const safeName = eventName.normalize('NFKD').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'Event';
  return `DUPOIN_${safeName}_EventPlan_${date.toISOString().slice(0, 10)}.pptx`;
}
