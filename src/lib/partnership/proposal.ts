/**
 * B2B Proposal Builder: input/content shapes, validation, totals, the AI draft
 * prompt and its guard, and the document model both renderers use.
 *
 * Fixed facts (About Dupoin, license, awards) come from proposal-facts.ts and
 * figures from proposal-settings.ts. The AI only writes narrative text, and a
 * guard drops any AI sentence with a number the user did not give.
 *
 * Safe to import from the browser. No database, no network, no secrets.
 */
import { DUPOIN_VERIFIED_FACTS, guardGeneratedText } from '@/lib/brand-fact-guard';
import { verifiedFacts, type ProposalLanguage, type VerifiedFacts } from './proposal-facts';
import type { LabelValue, OfflineMaterial, ProposalSettings, RateCardItem } from './proposal-settings';

export type { ProposalLanguage } from './proposal-facts';
export type ProposalTemplate = 'slide' | 'document';
export const PROPOSAL_TEMPLATES: readonly ProposalTemplate[] = ['slide', 'document'];
export const TEMPLATE_LABELS: Record<ProposalTemplate, string> = { slide: 'Slide 16:9', document: 'Document A4' };

export const SECTION_KEYS = [
  'projectOverview', 'aboutDupoin', 'numbers', 'demographics', 'products', 'marketLandscape', 'awards', 'digitalAssets',
  'collaborationScheme', 'digitalExposure', 'offlineMaterials', 'valuePackage', 'notes',
] as const;
export type SectionKey = typeof SECTION_KEYS[number];

export const SECTION_LABELS: Record<SectionKey, string> = {
  projectOverview: 'Project Overview',
  aboutDupoin: 'About Dupoin',
  numbers: 'Dupoin by Numbers',
  demographics: 'User Demographics',
  products: 'Our Products',
  marketLandscape: 'Market Landscape',
  awards: 'Company Awards',
  digitalAssets: 'Digital Assets',
  collaborationScheme: 'Collaboration Scheme',
  digitalExposure: 'Digital Exposure',
  offlineMaterials: 'Offline Material',
  valuePackage: 'Collaboration Value Package',
  notes: 'Notes',
};

export interface ExposureSelection {
  itemId: string;
  content: string;
  platform: string;
  quantityLabel: string;
  /**
   * Rupiah price per unit, typed per proposal. `null` = not filled in yet.
   * Every proposal has different numbers, so nothing is prefilled.
   */
  unitValue: number | null;
  units: number;
}

/**
 * Fixed Digital Exposure item offered as its own checkbox in the builder
 * (not part of the admin-editable item list, so it is always available).
 */
export const COLLAB_EXPOSURE_ITEM = {
  id: 'collab-exposure-content',
  label: 'Collaboration Exposure Content - 1x IG Reels + Mirrored TikTok',
  content: 'Collaboration Exposure Content',
  platform: 'Instagram Reels + mirrored TikTok (Dupoin & {partner})',
  quantityLabel: '1x',
} as const;

export interface OfflineSelection {
  materialId: string;
  material: string;
  content: string;
  placement: string;
  quantity: number;
}

export interface NeedItem {
  description: string;
  quantity: number | null;
  unitValue: number | null;
}

export interface ProposalInput {
  partnerName: string;
  partnerDescription: string;
  objective: string;
  collaborationScheme: string;
  userBenefit: string;
  exposures: ExposureSelection[];
  offline: OfflineSelection[];
  needs: NeedItem[];
  baseFee: number | null;
  notes: string;
  language: ProposalLanguage;
  template: ProposalTemplate;
  useCompetitorInsights: boolean;
  year: string;
}

export interface ProposalContent {
  title: string;
  projectOverview: string;
  schemeGoal: string;
  schemeHeading: string;
  schemeBullets: string[];
  userJourney: string[];
  exposureHighlights: string[];
  partnerSupport: string[];
  marketInsight: string;
  notes: string[];
  include: Record<SectionKey, boolean>;
}

/** Narrative fields the AI writes. Everything else in a proposal is fixed or computed. */
export const NARRATIVE_FIELDS = ['projectOverview', 'schemeGoal', 'schemeHeading', 'schemeBullets', 'userJourney', 'exposureHighlights', 'partnerSupport', 'marketInsight', 'notes'] as const;

const MAX_TEXT = 4_000;
const MAX_LIST = 12;
const clean = (value: unknown, max = MAX_TEXT) => (typeof value === 'string' ? value.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '');
const line = (value: unknown, max = 400) => clean(value, max).replace(/\s*\n\s*/g, ' ');
const list = (value: unknown, max = MAX_LIST): string[] => (Array.isArray(value) ? value.map(item => line(item)).filter(Boolean).slice(0, max) : []);
const int = (value: unknown, min: number, max: number): number | null => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.replace(/[^\d.-]/g, '')) : NaN;
  if (!Number.isFinite(number)) return null;
  return Math.max(min, Math.min(max, Math.round(number)));
};

export function currentYear(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Jakarta' }).format(now);
}

/** "Rp 3.000.000,-", as written in the approved proposals. */
export function formatRupiah(value: number): string {
  const rounded = Math.round(Math.max(0, value));
  return `Rp ${rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')},-`;
}

export const withPartner = (template: string, partnerName: string) => template.replace(/\{partner\}/g, partnerName || 'Partner');

/**
 * Price typed in the builder: digits only ("3.000.000", "Rp 3jt" is not parsed as 3jt).
 * Empty or 0 means "no price yet" and is stored as null.
 */
export function parsePrice(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /\d/.test(value) ? Number(value.replace(/[^\d]/g, '')) : NaN;
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.min(1e12, Math.round(number));
}

/** "3000000" -> "3.000.000" for the IDR price inputs; null -> "". */
export function formatPriceInput(value: number | null): string {
  return value === null ? '' : String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Validates the builder form. Item names come from the current settings; prices are typed per proposal. */
export function parseProposalInput(raw: unknown, settings: ProposalSettings, now: Date = new Date()): { value: ProposalInput } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Proposal input is missing.' };
  const body = raw as Record<string, unknown>;
  const partnerName = line(body.partnerName, 120);
  if (!partnerName) return { error: 'Partner name is required.' };

  const cardById = new Map<string, RateCardItem>(settings.rateCard.map(item => [item.id, item]));
  const exposures: ExposureSelection[] = [];
  for (const row of Array.isArray(body.exposures) ? body.exposures.slice(0, 30) : []) {
    const selection = row as Partial<ExposureSelection>;
    const itemId = line(selection?.itemId, 40);
    const units = int(selection?.units, 1, 100) ?? 1;
    const unitValue = parsePrice(selection?.unitValue);
    const card = itemId === COLLAB_EXPOSURE_ITEM.id ? COLLAB_EXPOSURE_ITEM : cardById.get(itemId);
    if (card) {
      if (exposures.some(row => row.itemId === itemId)) continue;
      exposures.push({ itemId, content: card.content, platform: card.platform, quantityLabel: card.quantityLabel, unitValue, units });
      continue;
    }
    // A row whose item was removed from Settings later keeps the values it was saved with.
    const content = line(selection?.content, 120);
    if (!itemId || !content) continue;
    exposures.push({ itemId, content, platform: line(selection?.platform, 160), quantityLabel: line(selection?.quantityLabel, 80) || '1x', unitValue, units });
  }

  const materialById = new Map<string, OfflineMaterial>(settings.offlineMaterials.map(item => [item.id, item]));
  const offline: OfflineSelection[] = [];
  for (const row of Array.isArray(body.offline) ? body.offline.slice(0, 20) : []) {
    const selection = row as Partial<OfflineSelection>;
    const materialId = line(selection?.materialId, 40);
    const material = materialById.get(materialId);
    const quantity = int(selection?.quantity, 1, 10_000) ?? material?.quantity ?? 1;
    const placement = line(selection?.placement, 160);
    if (material) {
      offline.push({ materialId, material: material.material, content: material.content, placement: placement || material.placement, quantity });
      continue;
    }
    const name = line(selection?.material, 120);
    if (!materialId || !name) continue;
    offline.push({ materialId, material: name, content: line(selection?.content, 160), placement, quantity });
  }

  const needs: NeedItem[] = [];
  for (const row of Array.isArray(body.needs) ? body.needs.slice(0, 12) : []) {
    const need = row as Partial<NeedItem>;
    const description = line(need?.description, 200);
    if (!description) continue;
    needs.push({ description, quantity: int(need?.quantity, 0, 10_000_000), unitValue: int(need?.unitValue, 0, 1e12) });
  }

  const language: ProposalLanguage = body.language === 'en' ? 'en' : 'id';
  const template: ProposalTemplate = body.template === 'document' ? 'document' : 'slide';
  const year = /^\d{4}$/.test(String(body.year ?? '')) ? String(body.year) : currentYear(now);

  return {
    value: {
      partnerName,
      partnerDescription: clean(body.partnerDescription, 2_000),
      objective: clean(body.objective, 1_000),
      collaborationScheme: clean(body.collaborationScheme, 2_000),
      userBenefit: clean(body.userBenefit, 1_000),
      exposures,
      offline,
      needs,
      baseFee: int(body.baseFee, 0, 1e12),
      notes: clean(body.notes, 2_000),
      language,
      template,
      useCompetitorInsights: body.useCompetitorInsights === true,
      year,
    },
  };
}

/** `value` is null when no price was typed: shown as (TBD), never as Rp 0. */
export interface ExposureLine { no: number; content: string; platform: string; quantity: string; value: number | null }
export interface NeedLine { description: string; quantity: number | null; unitValue: number | null; total: number }
export interface ProposalTotals {
  exposureLines: ExposureLine[];
  /** Sum of the priced lines only. */
  exposureTotal: number;
  /** Lines with a price / without one. */
  exposurePriced: number;
  exposureUnpriced: number;
  needLines: NeedLine[];
  needTotal: number;
  baseFee: number | null;
  packageTotal: number;
}

/** Exposure table and package totals. Computed here, never by the AI. */
export function computeTotals(input: Pick<ProposalInput, 'exposures' | 'needs' | 'baseFee' | 'partnerName'>): ProposalTotals {
  const exposureLines = input.exposures.map((item, index) => ({
    no: index + 1,
    content: item.content,
    platform: withPartner(item.platform, input.partnerName),
    quantity: item.units > 1 ? `${item.units} × ${item.quantityLabel}` : item.quantityLabel,
    value: item.unitValue === null || item.unitValue === undefined ? null : item.unitValue * item.units,
  }));
  const exposureTotal = exposureLines.reduce((sum, row) => sum + (row.value ?? 0), 0);
  const exposurePriced = exposureLines.filter(row => row.value !== null).length;
  const needLines = input.needs.map(need => ({
    description: need.description,
    quantity: need.quantity,
    unitValue: need.unitValue,
    total: need.quantity !== null && need.unitValue !== null ? need.quantity * need.unitValue : 0,
  }));
  const needTotal = needLines.reduce((sum, row) => sum + row.total, 0);
  const baseFee = input.baseFee;
  return {
    exposureLines, exposureTotal, exposurePriced, exposureUnpriced: exposureLines.length - exposurePriced,
    needLines, needTotal, baseFee, packageTotal: exposureTotal + needTotal + (baseFee ?? 0),
  };
}

/**
 * Digital Exposure table for both renderers. Empty-price rule:
 * - no item has a price: the Value column and the exposure total are left out;
 * - some items have a price: empty ones show (TBD) and the total says it excludes them;
 * - every item has a price: plain table and total.
 * An empty price is never printed as Rp 0 or as an old rate-card value.
 */
export function exposureTable(totals: ProposalTotals, L: ProposalLabels): { rows: string[][]; showValue: boolean; totalText: string | null } {
  const showValue = totals.exposurePriced > 0;
  const head = [L.colNo, L.colContent, L.colPlatform, L.colQuantity, ...(showValue ? [L.colValue] : [])];
  const rows = [head, ...totals.exposureLines.map(row => [`${row.no}.`, row.content, row.platform, row.quantity, ...(showValue ? [row.value === null ? L.tbd : formatRupiah(row.value)] : [])])];
  const totalText = showValue ? `${formatRupiah(totals.exposureTotal)}${totals.exposureUnpriced ? ` ${L.exposurePartial}` : ''}` : null;
  return { rows, showValue, totalText };
}

/** Package or exposure value for summary lines: Rupiah when there is a figure, (TBD) otherwise. */
export const valueOrTbd = (value: number, L: ProposalLabels) => (value > 0 ? formatRupiah(value) : L.tbd);

export const DEFAULT_INCLUDE: Record<SectionKey, boolean> = Object.fromEntries(SECTION_KEYS.map(key => [key, true])) as Record<SectionKey, boolean>;

const OVERVIEW: Record<ProposalLanguage, string> = {
  en: 'As part of efforts to increase brand awareness, Dupoin Futures Indonesia has implemented a strategy to expand our brand visibility by integrating into daily life routines of our potential users. One of key initiatives is establishing digital partnerships with lifestyle brands across various industries, ranging from health, culinary, food groceries, wellness, educational platforms, entertainment providers, to financial services.',
  id: 'Sebagai bagian dari upaya meningkatkan brand awareness, Dupoin Futures Indonesia menjalankan strategi untuk memperluas visibilitas brand dengan hadir dalam rutinitas sehari-hari calon pengguna kami. Salah satu inisiatif utamanya adalah membangun kemitraan digital dengan brand gaya hidup dari berbagai industri, mulai dari kesehatan, kuliner, kebutuhan pangan, wellness, platform edukasi, penyedia hiburan, hingga layanan keuangan.',
};

const splitLines = (value: string) => value.split(/\n+|(?<=[.!?])\s+(?=[A-Z])/).map(item => item.replace(/^[\s•\-*\d.)]+/, '').trim()).filter(Boolean);

/** A complete draft without AI: the approved boilerplate plus the form text. */
export function templateContent(input: ProposalInput): ProposalContent {
  const p = input.partnerName;
  const en = input.language === 'en';
  const schemeBullets = [...splitLines(input.collaborationScheme), ...splitLines(input.userBenefit)].slice(0, 6);
  return {
    title: en ? `Collaboration Proposal with ${p}` : `Proposal Kolaborasi dengan ${p}`,
    projectOverview: OVERVIEW[input.language],
    schemeGoal: input.objective ? `${en ? 'Main Goals' : 'Tujuan Utama'}: ${line(input.objective, 120)}` : (en ? 'Main Goals: User Acquisition' : 'Tujuan Utama: Akuisisi Pengguna'),
    schemeHeading: en ? 'Special Reward from Dupoin Indonesia' : 'Hadiah Spesial dari Dupoin Indonesia',
    schemeBullets: schemeBullets.length ? schemeBullets : [en
      ? `New users who download the Dupoin Futures Indonesia app and sign up receive a benefit from ${p}.`
      : `Pengguna baru yang mengunduh aplikasi Dupoin Futures Indonesia dan mendaftar akan mendapatkan benefit dari ${p}.`],
    userJourney: en
      ? [`User sees the Dupoin & ${p} collaboration poster and scans the QR code to download the Dupoin app.`, 'User downloads and signs up at the Dupoin Futures app.', `After signing up, user receives the ${p} benefit in the message/inbox menu.`]
      : [`Pengguna melihat poster kolaborasi Dupoin & ${p} lalu memindai QR code untuk mengunduh aplikasi Dupoin.`, 'Pengguna mengunduh dan mendaftar di aplikasi Dupoin Futures.', `Setelah mendaftar, pengguna menerima benefit dari ${p} di menu pesan/inbox.`],
    exposureHighlights: input.exposures.map(item => withPartner(`${item.content} (${item.platform})`, p)).slice(0, 6),
    partnerSupport: en
      ? [`Featured on ${p} brand offer channels`, `Social media awareness on ${p} channels`]
      : [`Tampil di kanal penawaran brand ${p}`, `Awareness media sosial di kanal ${p}`],
    marketInsight: '',
    notes: [
      ...(input.baseFee === null ? [en
        ? 'Base partnership fee will be discussed further based on promotional deal package including number of offline promotional material.'
        : 'Base partnership fee akan dibahas lebih lanjut berdasarkan paket promosi yang disepakati, termasuk jumlah materi promosi offline.'] : []),
      ...splitLines(input.notes),
    ].slice(0, 8),
    include: { ...DEFAULT_INCLUDE },
  };
}

/** Sanitizes saved or edited content; unknown keys are dropped, missing ones filled from the template. */
export function parseProposalContent(raw: unknown, input: ProposalInput): ProposalContent {
  const base = templateContent(input);
  if (!raw || typeof raw !== 'object') return base;
  const body = raw as Record<string, unknown>;
  const include = { ...DEFAULT_INCLUDE };
  if (body.include && typeof body.include === 'object') {
    for (const key of SECTION_KEYS) if (typeof (body.include as Record<string, unknown>)[key] === 'boolean') include[key] = (body.include as Record<string, boolean>)[key];
  }
  const pick = (key: keyof ProposalContent, fallback: string, max = MAX_TEXT) => (typeof body[key] === 'string' ? clean(body[key], max) : fallback);
  const pickList = (key: keyof ProposalContent, fallback: string[]) => (Array.isArray(body[key]) ? list(body[key]) : fallback);
  return {
    title: pick('title', base.title, 160) || base.title,
    projectOverview: pick('projectOverview', base.projectOverview),
    schemeGoal: pick('schemeGoal', base.schemeGoal, 200),
    schemeHeading: pick('schemeHeading', base.schemeHeading, 200),
    schemeBullets: pickList('schemeBullets', base.schemeBullets),
    userJourney: pickList('userJourney', base.userJourney).slice(0, 5),
    exposureHighlights: pickList('exposureHighlights', base.exposureHighlights),
    partnerSupport: pickList('partnerSupport', base.partnerSupport),
    marketInsight: pick('marketInsight', base.marketInsight, 1_500),
    notes: pickList('notes', base.notes),
    include,
  };
}

/* ---------------- AI draft ---------------- */

const SCALE: Record<string, number> = {
  k: 1e3, rb: 1e3, ribu: 1e3, thousand: 1e3,
  m: 1e6, jt: 1e6, juta: 1e6, mio: 1e6, million: 1e6, millions: 1e6,
  b: 1e9, bn: 1e9, billion: 1e9, miliar: 1e9, milyar: 1e9,
};

/** Digit tokens with separators removed; "30K" / "2 million" / "1.27M" become their full value. */
function numberTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(/(\d[\d.,]*)(?:\s*(k|rb|ribu|thousand|m|jt|juta|mio|millions?|bn|b|billion|miliar|milyar)\b)?/gi)) {
    const raw = match[1].replace(/[.,]+$/, '');
    if (!raw) continue;
    const scale = match[2] ? SCALE[match[2].toLowerCase()] : undefined;
    if (scale) {
      const separators = raw.match(/[.,]/g) ?? [];
      const base = separators.length === 1 ? Number(raw.replace(',', '.')) : Number(raw.replace(/[.,]/g, ''));
      if (Number.isFinite(base)) tokens.push(String(Math.round(base * scale)));
      continue;
    }
    tokens.push(raw.replace(/[.,]/g, ''));
  }
  return tokens;
}

/** Numbers the AI may repeat: anything the user typed, the competitor insights given, the year, and small counts. */
export function allowedNumbers(input: ProposalInput, extraText = ''): Set<string> {
  const source = [input.partnerName, input.partnerDescription, input.objective, input.collaborationScheme, input.userBenefit, input.notes, input.year, extraText,
    ...input.needs.map(need => `${need.description} ${need.quantity ?? ''} ${need.unitValue ?? ''}`)].join(' ');
  const allowed = new Set(numberTokens(source));
  for (let small = 0; small <= 12; small += 1) allowed.add(String(small));
  return allowed;
}

/** Drops sentences (or list items) that carry a number not present in the allowed set. */
export function guardNumbers(text: string, allowed: Set<string>): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  return sentences.filter(sentence => numberTokens(sentence).every(token => allowed.has(token))).join(' ').trim();
}

export function buildDraftPrompt(input: ProposalInput, insights: string[] = []): { system: string; user: string } {
  const language = input.language === 'en' ? 'English' : 'Bahasa Indonesia';
  const system = [
    'You write narrative copy for a B2B collaboration proposal from PT Dupoin Futures Indonesia (a licensed futures broker) to a lifestyle or business partner.',
    `Write in ${language}. Professional, warm, concise. Return one JSON object only.`,
    'Do NOT write company facts, licenses, regulators, awards, ratings, user statistics, prices, Rupiah values, or totals: the template inserts verified facts and computed figures itself.',
    'Do NOT invent numbers, dates, voucher values, durations, or quantities. Only repeat a number if it appears in the partner brief.',
    'Never promise trading profit or returns. No investment advice.',
    'JSON keys:',
    '"projectOverview": 1 paragraph (70-110 words) on why Dupoin partners with lifestyle brands and why this partner fits.',
    '"schemeGoal": short line like "Main Goals: User Acquisition" (translated to the language).',
    '"schemeHeading": short heading for the user reward, like "Special Reward from Dupoin Indonesia".',
    '"schemeBullets": 2-4 numbered-style sentences describing the collaboration mechanic and the user benefit.',
    '"userJourney": exactly 3 or 4 short steps from seeing the promotion to receiving the benefit.',
    '"exposureHighlights": 2-5 short bullets summarizing the selected exposure items.',
    '"partnerSupport": 2-3 short bullets of what the partner supports (channels, catalog, awareness).',
    '"marketInsight": 1-2 sentences linking the partnership to the market context given, or "" if none is given.',
    '"notes": 0-3 short notes on costs/terms, only from the brief.',
  ].join('\n');
  const exposureList = input.exposures.map(item => `- ${item.content} — ${withPartner(item.platform, input.partnerName)} — ${item.units > 1 ? `${item.units} × ` : ''}${item.quantityLabel}`).join('\n') || '- (none selected)';
  const offlineList = input.offline.map(item => `- ${item.material}: ${item.content} at ${withPartner(item.placement, input.partnerName)} (qty ${item.quantity})`).join('\n') || '- (none)';
  const needList = input.needs.map(need => `- ${need.description}${need.quantity !== null ? ` (qty ${need.quantity})` : ''}`).join('\n') || '- (none)';
  const user = [
    `Partner: ${input.partnerName}`,
    `Partner industry / description: ${input.partnerDescription || '(not given)'}`,
    `Objective: ${input.objective || 'User acquisition and brand awareness'}`,
    `Collaboration scheme: ${input.collaborationScheme || '(not given)'}`,
    `User benefit / promo: ${input.userBenefit || '(not given)'}`,
    `What Dupoin asks from the partner:\n${needList}`,
    `Selected digital exposure:\n${exposureList}`,
    `Offline materials:\n${offlineList}`,
    `Extra notes: ${input.notes || '(none)'}`,
    insights.length ? `Market context from Dupoin's competitor intelligence (read-only, use at most one point):\n${insights.map(item => `- ${item}`).join('\n')}` : 'Market context: (none)',
  ].join('\n\n');
  return { system, user };
}

function extractJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** Merges the AI JSON into the template draft. Empty or unsafe fields keep the template text. */
export function parseDraftResponse(raw: string, input: ProposalInput, insights: string[] = []): { content: ProposalContent; droppedSentences: number } | { error: string } {
  const body = extractJson(raw);
  if (!body) return { error: 'The AI response was not valid JSON.' };
  const base = templateContent(input);
  const allowed = allowedNumbers(input, insights.join(' '));
  let dropped = 0;
  // Numbers must come from the brief; award, license, and rating claims must match the verified register.
  const guard = (text: string) => guardGeneratedText(guardNumbers(text, allowed), DUPOIN_VERIFIED_FACTS).text.trim();
  const guardText = (value: unknown, max = MAX_TEXT) => {
    const original = clean(value, max);
    const safe = guard(original);
    if (safe !== original) dropped += 1;
    return safe;
  };
  const guardList = (value: unknown) => list(value).map(item => {
    const safe = guard(item);
    if (safe !== item) dropped += 1;
    return safe;
  }).filter(Boolean);
  const textOr = (value: unknown, fallback: string, max?: number) => guardText(value, max) || fallback;
  const listOr = (value: unknown, fallback: string[]) => {
    const items = guardList(value);
    return items.length ? items : fallback;
  };
  const content: ProposalContent = {
    ...base,
    projectOverview: textOr(body.projectOverview, base.projectOverview),
    schemeGoal: textOr(body.schemeGoal, base.schemeGoal, 200),
    schemeHeading: textOr(body.schemeHeading, base.schemeHeading, 200),
    schemeBullets: listOr(body.schemeBullets, base.schemeBullets),
    userJourney: listOr(body.userJourney, base.userJourney).slice(0, 4),
    exposureHighlights: listOr(body.exposureHighlights, base.exposureHighlights),
    partnerSupport: listOr(body.partnerSupport, base.partnerSupport),
    marketInsight: insights.length ? guardText(body.marketInsight, 1_500) : '',
    notes: [...base.notes.slice(0, input.baseFee === null ? 1 : 0), ...guardList(body.notes)].slice(0, 6),
  };
  return { content, droppedSentences: dropped };
}

export interface DraftDeps {
  complete: (system: string, user: string) => Promise<{ content: string; model: string | null }>;
}

/** Calls the model through `deps.complete` (generateContent in production) and merges the result. */
export async function draftProposalContent(input: ProposalInput, deps: DraftDeps, insights: string[] = []): Promise<{ content: ProposalContent; model: string | null; droppedSentences: number }> {
  const { system, user } = buildDraftPrompt(input, insights);
  const generated = await deps.complete(system, user);
  const parsed = parseDraftResponse(generated.content, input, insights);
  if ('error' in parsed) throw new Error(parsed.error);
  return { content: parsed.content, model: generated.model, droppedSentences: parsed.droppedSentences };
}

/* ---------------- Document model ---------------- */

export interface ProposalLabels {
  coverKicker: string;
  toc: string;
  sectionProject: string;
  sectionAbout: string;
  sectionScheme: string;
  sectionExposure: string;
  sectionPackage: string;
  aboutDoc: string;
  numbers: string;
  growth: string;
  tradedLots: string;
  demographics: string;
  ageTitle: string;
  occupationTitle: string;
  products: string;
  market: string;
  marketInsight: string;
  awards: string;
  digitalAssets: string;
  instagram: string;
  website: string;
  schemeDoc: string;
  userJourney: string;
  exposureDoc: string;
  exposureTotal: string;
  exposureEstimate: string;
  offline: string;
  valuePackage: string;
  whatWeNeed: string;
  whatWeOffer: string;
  supportFrom: string;
  totalValue: string;
  packageEstimate: string;
  packageTotal: string;
  notes: string;
  colNo: string;
  colContent: string;
  colPlatform: string;
  colQuantity: string;
  colValue: string;
  colMaterial: string;
  colPlacement: string;
  colItem: string;
  colFee: string;
  colNotes: string;
  baseFee: string;
  baseFeeNote: string;
  exposureValueRow: string;
  exposureValueNote: string;
  /** Appended to an exposure total when some items have no price yet. */
  exposurePartial: string;
  contributionRow: string;
  tbd: string;
  license: string;
  ratingBy: string;
}

export const PROPOSAL_LABELS: Record<ProposalLanguage, ProposalLabels> = {
  en: {
    coverKicker: 'Dupoin Futures Indonesia', toc: 'Table of contents',
    sectionProject: 'Project Overview', sectionAbout: 'About Dupoin Futures Indonesia', sectionScheme: 'Collaboration Schemes', sectionExposure: 'Digital Exposures', sectionPackage: 'Collaboration Package',
    aboutDoc: 'About Dupoin Indonesia', numbers: 'Dupoin by Numbers', growth: 'Trading Growth & Active User Base', tradedLots: 'Growth in Traded Lot Volume',
    demographics: 'User Demographic Profile', ageTitle: 'Age distribution of Dupoin users in %', occupationTitle: 'Occupation of Dupoin users in %',
    products: 'Our Products', market: 'Our Market Landscape', marketInsight: 'Market insight', awards: 'Company Awards', digitalAssets: 'Digital Assets',
    instagram: 'Instagram', website: 'Website', schemeDoc: 'Collaboration Scheme for', userJourney: 'User Journey',
    exposureDoc: 'Digital Exposure (Social Media & Published Articles)', exposureTotal: 'Total digital exposure value', exposureEstimate: 'Digital exposure estimation value',
    offline: 'Offline Promotional Material', valuePackage: 'Collaboration Value Package', whatWeNeed: 'What We Need?', whatWeOffer: 'What We Offer', supportFrom: 'Support From',
    totalValue: 'Total value', packageEstimate: 'Collaboration estimation package', packageTotal: 'Total collaboration value package', notes: 'Notes on costs',
    colNo: 'No.', colContent: 'Content', colPlatform: 'Platform', colQuantity: 'Quantity', colValue: 'Value', colMaterial: 'Material', colPlacement: 'Placement',
    colItem: 'Item', colFee: 'Fee', colNotes: 'Notes', baseFee: 'Base partnership fee', baseFeeNote: 'Calculation on discount products',
    exposureValueRow: 'Digital exposure value', exposureValueNote: 'Price may vary depends on agreed package', exposurePartial: '(excl. items marked TBD)', contributionRow: 'Partner contribution', tbd: '(TBD)',
    license: 'License', ratingBy: 'by',
  },
  id: {
    coverKicker: 'Dupoin Futures Indonesia', toc: 'Daftar isi',
    sectionProject: 'Gambaran Proyek', sectionAbout: 'Tentang Dupoin Futures Indonesia', sectionScheme: 'Skema Kolaborasi', sectionExposure: 'Eksposur Digital', sectionPackage: 'Paket Kolaborasi',
    aboutDoc: 'Tentang Dupoin Indonesia', numbers: 'Dupoin dalam Angka', growth: 'Pertumbuhan Trading & Pengguna Aktif', tradedLots: 'Pertumbuhan Volume Lot Transaksi',
    demographics: 'Profil Demografi Pengguna', ageTitle: 'Distribusi usia pengguna Dupoin (%)', occupationTitle: 'Pekerjaan pengguna Dupoin (%)',
    products: 'Produk Kami', market: 'Lanskap Pasar Kami', marketInsight: 'Insight pasar', awards: 'Penghargaan Perusahaan', digitalAssets: 'Aset Digital',
    instagram: 'Instagram', website: 'Website', schemeDoc: 'Skema Kolaborasi untuk', userJourney: 'Alur Pengguna',
    exposureDoc: 'Eksposur Digital (Media Sosial & Artikel)', exposureTotal: 'Total nilai eksposur digital', exposureEstimate: 'Estimasi nilai eksposur digital',
    offline: 'Materi Promosi Offline', valuePackage: 'Nilai Paket Kolaborasi', whatWeNeed: 'Yang Kami Butuhkan', whatWeOffer: 'Yang Kami Tawarkan', supportFrom: 'Dukungan dari',
    totalValue: 'Total nilai', packageEstimate: 'Estimasi paket kolaborasi', packageTotal: 'Total nilai paket kolaborasi', notes: 'Catatan biaya',
    colNo: 'No.', colContent: 'Konten', colPlatform: 'Platform', colQuantity: 'Jumlah', colValue: 'Nilai', colMaterial: 'Materi', colPlacement: 'Penempatan',
    colItem: 'Item', colFee: 'Biaya', colNotes: 'Catatan', baseFee: 'Base partnership fee', baseFeeNote: 'Dihitung dari produk diskon',
    exposureValueRow: 'Nilai eksposur digital', exposureValueNote: 'Harga dapat berubah sesuai paket yang disepakati', exposurePartial: '(belum termasuk item TBD)', contributionRow: 'Kontribusi partner', tbd: '(TBD)',
    license: 'Izin', ratingBy: 'oleh',
  },
};

export interface ProposalDocument {
  language: ProposalLanguage;
  template: ProposalTemplate;
  year: string;
  partnerName: string;
  partnerLogo: string | null;
  labels: ProposalLabels;
  facts: VerifiedFacts;
  settings: ProposalSettings;
  content: ProposalContent;
  totals: ProposalTotals;
  offline: Array<OfflineSelection & { no: number }>;
}

const placeholders = (rows: LabelValue[], partner: string) => rows.map(row => ({ label: withPartner(row.label, partner), value: withPartner(row.value, partner) }));

/** Everything a renderer needs, with `{partner}` resolved. */
export function buildProposalDocument(input: ProposalInput, content: ProposalContent, settings: ProposalSettings, partnerLogo: string | null = null): ProposalDocument {
  const partner = input.partnerName;
  return {
    language: input.language,
    template: input.template,
    year: input.year,
    partnerName: partner,
    partnerLogo,
    labels: PROPOSAL_LABELS[input.language],
    facts: verifiedFacts(input.language),
    settings: { ...settings, marketRegions: placeholders(settings.marketRegions, partner) },
    content,
    totals: computeTotals(input),
    offline: input.offline.map((item, index) => ({ ...item, no: index + 1, placement: withPartner(item.placement, partner) })),
  };
}

/** Accepts a PNG or JPEG data URL up to ~700 KB for the partner logo. */
export function parsePartnerLogo(raw: unknown): { value: string | null } | { error: string } {
  if (raw === null || raw === undefined || raw === '') return { value: null };
  if (typeof raw !== 'string') return { error: 'Partner logo must be an image.' };
  const match = raw.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return { error: 'Partner logo must be a PNG or JPEG image.' };
  if (match[2].length > 950_000) return { error: 'Partner logo must be 700 KB or smaller.' };
  return { value: raw };
}

export const safeFileName = (value: string) => value.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'proposal';
