import {
  effectiveBrandTerms, firstIndexOf, hostMatches, hostOf, listItems, parseCompetitor, rate, termRegex,
} from './visibility';

/**
 * AI Visibility gap analysis. Pure and deterministic: it reads stored prompts
 * and answers (no network, no database) and explains where the brand is
 * missing, who AI named instead, which sources it cited, what AI says the
 * brand is, and what to fix on the brand site.
 *
 * Copy rules for anything meant for the brand site (recommendations, page
 * titles, FAQ questions, llms.txt, JSON-LD):
 * - never name a configured competitor (scrubCompetitors runs on every string);
 * - never assert an unverified fact; ask to "publish verifiable evidence".
 */

// ---------- Input ----------

export interface GapPromptInput {
  id: string;
  prompt: string;
  brand_terms: string[];
  competitors: string[];
  active: boolean;
  last_checked_at?: string | Date | null;
}

/** A stored check. `response` may be omitted for older (lifetime-only) rows. */
export interface GapCheckInput {
  id: string;
  prompt_id: string | null;
  model: string;
  answered_model: string | null;
  response?: string | null;
  mentioned: boolean | null;
  rank_in_answer: number | null;
  cited_urls: string[];
  site_cited: boolean;
  competitors_mentioned: string[];
  error: string | null;
  created_at: string | Date;
}

export interface GapInput {
  siteName: string;
  siteHost: string;
  /** Models currently configured; models seen only in history are appended. */
  models: string[];
  prompts: GapPromptInput[];
  /** All stored checks (lifetime). */
  lifetime: GapCheckInput[];
  /** Latest check per prompt x model, with the full response. */
  latest: GapCheckInput[];
  generatedAt?: Date;
}

// ---------- Output ----------

export type PromptStatus = 'unchecked' | 'zero' | 'weak' | 'partial' | 'strong';
export type TopicKey = 'comparison' | 'rules' | 'certification' | 'recognition' | 'international' | 'competition' | 'clubs' | 'general';
export type FlagKind = 'combined' | 'narrow-aliases' | 'alias-collision' | 'leading';

export interface CellResult {
  checkId: string;
  mentioned: boolean | null;
  rank: number | null;
  siteCited: boolean;
  fallback: boolean;
  error: string | null;
  createdAt: string;
}

export interface NamedEntity { name: string; configured: boolean; answers: number; bestRank: number | null; models: string[] }

export interface PromptFlag { promptId: string; prompt: string; kind: FlagKind; message: string }

export interface PromptGap {
  id: string;
  prompt: string;
  active: boolean;
  aliases: string[];
  competitors: string[];
  cells: Record<string, CellResult | undefined>;
  latestYes: number;
  latestTotal: number;
  lifetimeMentions: number;
  lifetimeAnswers: number;
  lastChecked: string | null;
  status: PromptStatus;
  topic: TopicKey;
  competitorsMentioned: string[];
  citedUrls: string[];
  /** Entities AI listed in answers that did not mention the brand, recomputed from the text. */
  namedInstead: NamedEntity[];
  /** Cited domains in answers that did not mention the brand. */
  sourcesWhenMissing: string[];
  likelyGap: string;
  flags: FlagKind[];
  /** Brand aliases that overlap a competitor alias. */
  collidingAliases: string[];
}

export interface ModelSummary {
  model: string;
  latestAnswers: number;
  latestMentions: number;
  latestRate: number | null;
  latestSiteCited: number;
  lifetimeAnswers: number;
  lifetimeMentions: number;
  lifetimeRate: number | null;
  fallbacks: number;
  errors: number;
}

export interface GapSummary {
  promptsTracked: number;
  promptsChecked: number;
  latestAnswers: number;
  latestMentions: number;
  latestRate: number | null;
  lifetimeAnswers: number;
  lifetimeMentions: number;
  lifetimeRate: number | null;
  byModel: ModelSummary[];
  weakestModel: string | null;
  strongestModel: string | null;
  zeroVisibility: Array<{ id: string; prompt: string }>;
  fullVisibility: Array<{ id: string; prompt: string }>;
}

export interface AnswerRow {
  promptId: string;
  prompt: string;
  model: string;
  answeredModel: string | null;
  createdAt: string;
  mentioned: boolean | null;
  rank: number | null;
  siteCited: boolean;
  competitorsMentioned: string[];
  citedUrls: string[];
  response: string;
  error: string | null;
}

export interface SourceRow {
  domain: string;
  latestCitations: number;
  lifetimeCitations: number;
  whenBrandMissing: number;
  whenBrandPresent: number;
  isSite: boolean;
  isCompetitor: boolean;
  kind: SourceKind;
}

export type SourceKind = 'encyclopedia' | 'video' | 'social' | 'news' | 'government' | 'organisation' | 'directory' | 'other';

export type EntityVerdict = 'not-mentioned' | 'described-as-recognised' | 'contradictory' | 'mentioned-not-recognised';

export interface EntityModel {
  model: string;
  answersMentioning: number;
  answersTotal: number;
  /** What the answers say the brand is (verbatim sentences). */
  excerpts: string[];
  recognisedStatements: string[];
  negativeStatements: string[];
  uncertainStatements: string[];
  /** Sentences where another organisation is described as the official/recognised body. */
  otherBodyStatements: string[];
  verdict: EntityVerdict;
}

export interface EntityUnderstanding {
  brandLabel: string;
  acronyms: string[];
  byModel: EntityModel[];
  expansions: Array<{ expansion: string; count: number; models: string[] }>;
  contradictions: string[];
}

export type RecCategory = 'content' | 'entity' | 'third-party' | 'tracking';
export type RecPriority = 'high' | 'medium' | 'low';

export interface PageSuggestion { topic: TopicKey; slug: string; h1: string; faq: string[]; prompts: number }

export interface Recommendation {
  id: string;
  priority: RecPriority;
  category: RecCategory;
  title: string;
  why: string;
  actions: string[];
  pages?: PageSuggestion[];
  snippet?: { label: string; language: 'json' | 'text'; code: string };
}

export interface GapReport {
  site: { name: string; host: string };
  generatedAt: string;
  language: 'id' | 'en';
  models: string[];
  summary: GapSummary;
  prompts: PromptGap[];
  answers: AnswerRow[];
  sources: { domains: SourceRow[]; answersWithCitation: number; siteCitedAnswers: number; latestAnswers: number };
  entity: EntityUnderstanding;
  flags: PromptFlag[];
  recommendations: Recommendation[];
  aiSummary?: string | null;
}

// ---------- Small helpers ----------

const iso = (value: string | Date | null | undefined): string | null => (value == null ? null : new Date(value).toISOString());
const comparable = (check: GapCheckInput) => !check.error && !!check.answered_model && check.answered_model === check.model;
const norm = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const tokens = (value: string) => norm(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const alnum = (value: string) => norm(value).replace(/[^a-z0-9]/g, '');

function stripMarkdown(text: string): string {
  return text.replace(/\*\*|__|`|#+\s/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

/** Acronym aliases: 2–6 letters, all caps ("ICA"). */
export function isAcronym(term: string): boolean {
  return /^[\p{Lu}\p{N}]{2,6}$/u.test(term.trim());
}

const ID_WORDS = /\b(apa|yang|di|dan|bagaimana|siapa|untuk|cara|terbaik|mana|dengan|adalah|kapan|berapa|organisasi|rekomendasi)\b/giu;
export function detectLanguage(texts: string[]): 'id' | 'en' {
  let hits = 0;
  let words = 0;
  for (const text of texts) {
    hits += (text.match(ID_WORDS) ?? []).length;
    words += tokens(text).length;
  }
  return words > 0 && hits / words >= 0.06 ? 'id' : 'en';
}

// ---------- Competitor scrubbing ----------

export function competitorTerms(prompts: Array<Pick<GapPromptInput, 'competitors'>>): string[] {
  const out = new Set<string>();
  for (const prompt of prompts) for (const entry of prompt.competitors) for (const term of parseCompetitor(entry).terms) out.add(term);
  return [...out].sort((a, b) => b.length - a.length);
}

/** Replaces every competitor term (whole-term, case-insensitive) with a neutral phrase. */
export function scrubCompetitors(text: string, terms: string[], language: 'id' | 'en' = 'en'): string {
  const neutral = language === 'id' ? 'organisasi lain' : 'other organisations';
  let out = text;
  for (const term of terms) {
    if (!term.trim()) continue;
    out = out.replace(termRegex(term), neutral);
    // Also catch the term glued inside domains or handles (e.g. "xyz.or.id").
    const compact = alnum(term);
    if (compact.length >= 3) out = out.replace(new RegExp(`[\\w.-]*${compact}[\\w.-]*`, 'giu'), neutral);
  }
  const doubled = new RegExp(`(${neutral})(\\s*(?:,|dan|and|atau|or|/|\\|)\\s*${neutral})+`, 'giu');
  return out.replace(doubled, '$1').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
}

export function containsCompetitor(text: string, terms: string[]): boolean {
  return terms.some(term => term.trim() && (termRegex(term).test(text) || (alnum(term).length >= 3 && alnum(text).includes(alnum(term)))));
}

/** Blanks out every match of the terms (same length, so indices stay valid). */
export function maskTerms(text: string, terms: string[]): string {
  let out = text;
  for (const term of terms) if (term.trim()) out = out.replace(termRegex(term), match => ' '.repeat(match.length));
  return out;
}

// ---------- Entity ranking (recomputed from the answer text) ----------

export interface RankedEntity { name: string; isBrand: boolean; configured: boolean; rank: number; index: number }

const GENERIC_HEADS = /^(note|catatan|summary|ringkasan|kesimpulan|conclusion|tips?|langkah|step|cara|contoh|example|sumber|source|referensi|references?|disclaimer|faq|pros?|cons?|kelebihan|kekurangan|syarat|persyaratan|requirements?)\b/iu;

/** Short "head" of a list item: bold text, or text before ":" / " – " / " - " / "(". */
export function listItemHead(item: string): string | null {
  const body = item.replace(/^\s*(?:\d{1,2}[.)]|[-*+•])\s+/u, '');
  const bold = body.match(/^\*\*([^*]{2,100})\*\*/u)?.[1] ?? body.match(/\*\*([^*]{2,100})\*\*/u)?.[1];
  let head = (bold ?? body.split(/\n/)[0].split(/:\s|\s[–—-]\s|\s\(/u)[0]).replace(/[*_`#]/g, '').replace(/[:.,;]+$/u, '').trim();
  head = head.replace(/\s*\([^)]*\)\s*$/u, '').trim();
  if (head.length < 2 || head.length > 80) return null;
  const words = head.split(/\s+/);
  if (words.length > 8) return null;
  if (!/^[\p{Lu}\p{N}]/u.test(head)) return null;
  if (GENERIC_HEADS.test(head)) return null;
  return head;
}

/**
 * Ranks the brand, configured competitors and other listed entities by their
 * position in the answer: the 1-based list item when the answer is a list of
 * 2+ items, otherwise order of first mention.
 */
export function rankEntities(response: string, brandTerms: string[], competitors: string[]): RankedEntity[] {
  const text = response ?? '';
  const items = listItems(text);
  const isList = items.length >= 2;
  const positionOf = (index: number) => (isList ? items.findIndex(span => index >= span.start && index < span.end) : -1);
  const found: Array<{ name: string; isBrand: boolean; configured: boolean; index: number; item: number }> = [];
  // A brand alias inside a competitor's name ("X Federation" in "Rival X Federation") is not a brand mention.
  const allCompetitorTerms = competitors.flatMap(entry => parseCompetitor(entry).terms);
  const brandIndex = firstIndexOf(maskTerms(text, allCompetitorTerms.filter(term => brandTerms.some(alias => termRegex(alias).test(term)))), brandTerms);
  if (brandIndex !== -1) found.push({ name: brandTerms[0] ?? 'Brand', isBrand: true, configured: true, index: brandIndex, item: positionOf(brandIndex) });
  for (const entry of competitors) {
    const competitor = parseCompetitor(entry);
    const index = firstIndexOf(text, competitor.terms);
    if (index !== -1) found.push({ name: competitor.name, isBrand: false, configured: true, index, item: positionOf(index) });
  }
  if (isList) {
    items.forEach((span, itemIndex) => {
      if (found.some(hit => hit.item === itemIndex)) return;
      const head = listItemHead(text.slice(span.start, span.end));
      if (!head) return;
      if (firstIndexOf(head, brandTerms) !== -1) return;
      if (found.some(hit => norm(hit.name) === norm(head))) return;
      found.push({ name: head, isBrand: false, configured: false, index: span.start, item: itemIndex });
    });
  }
  const ordered = found.sort((a, b) => a.index - b.index);
  return ordered.map((hit, order) => ({
    name: hit.name, isBrand: hit.isBrand, configured: hit.configured, index: hit.index,
    rank: hit.item !== -1 ? hit.item + 1 : order + 1,
  })).sort((a, b) => a.rank - b.rank || a.index - b.index);
}

// ---------- Prompt flags ----------

const QUESTION_START = /^(apa|apakah|siapa|di\s?mana|dimana|bagaimana|kapan|mengapa|kenapa|berapa|manakah|rekomendasi|what|who|where|how|when|why|which|is|are|can|do|does|should|best|top)\b/iu;

/** Splits a prompt into the questions it bundles ("a?, b?" or "q1, q2, q3"). */
export function splitQuestions(prompt: string): string[] {
  const byMark = prompt.split(/\?+/u).map(part => part.replace(/^[\s,;]+|[\s,;]+$/gu, '')).filter(Boolean);
  if (byMark.length >= 2) return byMark;
  const byComma = prompt.split(/\s*[,;]\s*/u).map(part => part.trim()).filter(part => part.split(/\s+/).length >= 3);
  const questionLike = byComma.filter(part => QUESTION_START.test(part)).length;
  if (byComma.length >= 3 || questionLike >= 2) return byComma;
  return [prompt.trim()];
}

export function isCombinedPrompt(prompt: string): boolean {
  return splitQuestions(prompt).length >= 2;
}

/** Brand alias resembles a competitor alias (token subset either way). */
export function aliasCollisions(brandTerms: string[], competitors: string[]): Array<{ alias: string; competitor: string; term: string }> {
  const out: Array<{ alias: string; competitor: string; term: string }> = [];
  for (const alias of brandTerms) {
    const a = new Set(tokens(alias));
    if (a.size < 2) continue;
    for (const entry of competitors) {
      const competitor = parseCompetitor(entry);
      for (const term of competitor.terms) {
        const b = new Set(tokens(term));
        if (b.size < 2) continue;
        const aInB = [...a].every(token => b.has(token));
        const bInA = [...b].every(token => a.has(token));
        if (aInB || bInA) { out.push({ alias, competitor: competitor.name, term }); break; }
      }
    }
  }
  return out;
}

export function narrowAliasReason(promptTerms: string[], siteName: string, widest: number): string | null {
  const terms = effectiveBrandTerms(promptTerms, siteName);
  if (terms.length <= 1) return `Only "${terms[0] ?? siteName}" is tracked; answers that use the full name or another spelling are counted as missing.`;
  if (terms.every(isAcronym)) return 'Only acronyms are tracked; answers that use the full name are counted as missing, and short acronyms can match unrelated organisations.';
  if (widest > terms.length + 1) return `This prompt tracks ${terms.length} brand aliases while other prompts track up to ${widest}; results are not comparable.`;
  return null;
}

// ---------- Topics ----------

const TOPIC_RULES: Array<{ topic: TopicKey; pattern: RegExp }> = [
  { topic: 'comparison', pattern: /perbedaan|\bbeda\b|bandingkan|perbandingan|\bvs\.?\b|versus|difference|compare|comparison/giu },
  { topic: 'rules', pattern: /aturan|kategori|regulasi|peraturan|penilaian|rulebook|\brules?\b|categor|scoring|divisi|division/giu },
  { topic: 'certification', pattern: /sertifikasi|sertifikat|lisensi|certif|licen[cs]|pelatih|coach|\bjuri\b|judge|wasit|referee/giu },
  { topic: 'recognition', pattern: /resmi|diakui|pengakuan|induk|federasi|asosiasi|organisasi|official|recogni[sz]|governing|accredit|legal|terdaftar|kemenpora|koni|association|federation|organi[sz]ation/giu },
  { topic: 'international', pattern: /\bicu\b|world championship|internasional|international|timnas|tim nasional|national team|dunia|world/giu },
  { topic: 'competition', pattern: /kompetisi|kejuaraan|lomba|event|turnamen|festival|championship|competition|tournament|daftar|mendaftar|register|pendaftaran/giu },
  { topic: 'clubs', pattern: /klub|club|tempat belajar|tempat latihan|sekolah|school|kursus|belajar|learn|gym|terbaik|best|rekomendasi|recommend|anak/giu },
];

export function classifyTopic(prompt: string): TopicKey {
  let best: TopicKey = 'general';
  let bestScore = 0;
  for (const rule of TOPIC_RULES) {
    const score = (prompt.match(rule.pattern) ?? []).length;
    if (score > bestScore) { best = rule.topic; bestScore = score; }
  }
  return best;
}

interface TopicCopy { slug: string; h1: string; faq: string[]; gap: string }

function topicCopy(topic: TopicKey, brand: string, language: 'id' | 'en'): TopicCopy {
  const id = language === 'id';
  switch (topic) {
    case 'recognition': return id
      ? { slug: '/legalitas', h1: `Legalitas dan Dokumen Resmi ${brand}`, gap: 'Tidak ada bukti status resmi yang bisa diverifikasi AI.',
        faq: [`Apa dasar hukum ${brand}?`, `Lembaga mana yang mengakui ${brand}, dan di mana buktinya bisa diverifikasi?`, `Di mana dokumen resmi ${brand} bisa diunduh?`] }
      : { slug: '/official-status', h1: `${brand}: Legal Status and Official Documents`, gap: 'No verifiable evidence of official status that AI can cite.',
        faq: [`What is ${brand}'s legal basis?`, `Which institutions recognise ${brand}, and where can this be verified?`, `Where can ${brand}'s official documents be downloaded?`] };
    case 'international': return id
      ? { slug: '/keanggotaan-internasional', h1: `Keanggotaan Internasional dan Tim Nasional ${brand}`, gap: 'Tidak ada halaman tentang keanggotaan internasional dan seleksi tim nasional.',
        faq: [`Federasi internasional apa yang ${brand} ikuti, dan di mana daftar anggotanya bisa dicek?`, 'Bagaimana atlet dipilih untuk tim nasional?', 'Kejuaraan internasional apa saja yang diikuti tim nasional?'] }
      : { slug: '/international-membership', h1: `${brand}: International Membership and National Team`, gap: 'No page about international membership or national team selection.',
        faq: [`Which international federation is ${brand} a member of, and where is the member list?`, 'How are athletes selected for the national team?', 'Which international championships does the national team enter?'] };
    case 'certification': return id
      ? { slug: '/sertifikasi', h1: `Program Sertifikasi Pelatih dan Juri ${brand}`, gap: 'Tidak ada halaman program sertifikasi pelatih/juri dengan syarat dan daftar pemegang sertifikat.',
        faq: [`Bagaimana cara mendapatkan sertifikasi pelatih dari ${brand}?`, `Bagaimana cara menjadi juri bersertifikat ${brand}?`, 'Di mana daftar pemegang sertifikat bisa dicek?'] }
      : { slug: '/certification', h1: `${brand} Coach and Judge Certification`, gap: 'No certification page with requirements and a public register of certificate holders.',
        faq: [`How do I get a coaching certificate from ${brand}?`, `How do I become a ${brand}-certified judge?`, 'Where can I check the register of certificate holders?'] };
    case 'competition': return id
      ? { slug: '/kejuaraan', h1: `Kalender Kejuaraan dan Pendaftaran ${brand}`, gap: 'Tidak ada halaman kejuaraan dengan penyelenggara, jadwal, cara daftar, dan hasil.',
        faq: [`Kejuaraan apa saja yang diselenggarakan ${brand}?`, 'Bagaimana cara mendaftarkan tim sekolah atau klub?', 'Kapan dan di mana kejuaraan berikutnya?', 'Di mana hasil kejuaraan sebelumnya?'] }
      : { slug: '/championships', h1: `${brand} Championships Calendar and Registration`, gap: 'No championships page with organiser, dates, registration steps and results.',
        faq: [`Which championships does ${brand} organise?`, 'How does a school or club team register?', 'When and where is the next championship?', 'Where are past results published?'] };
    case 'rules': return id
      ? { slug: '/aturan-lomba', h1: `Aturan, Kategori, dan Sistem Penilaian Lomba ${brand}`, gap: 'Aturan dan kategori lomba tidak dipublikasikan sebagai halaman yang bisa dibaca AI.',
        faq: ['Kategori lomba apa saja yang tersedia?', 'Bagaimana sistem penilaiannya?', 'Di mana buku aturan resmi bisa diunduh?'] }
      : { slug: '/rules', h1: `${brand} Competition Rules, Categories and Scoring`, gap: 'Rules and categories are not published as a page AI can read.',
        faq: ['Which competition categories are available?', 'How is scoring done?', 'Where can the official rulebook be downloaded?'] };
    case 'clubs': return id
      ? { slug: '/klub', h1: `Direktori Klub dan Tempat Latihan Anggota ${brand}`, gap: 'Tidak ada direktori klub/tempat latihan per kota yang terhubung ke brand.',
        faq: ['Di mana tempat latihan terdekat di kota saya?', `Klub mana saja yang terdaftar sebagai anggota ${brand}?`, `Bagaimana sekolah atau klub bergabung dengan ${brand}?`] }
      : { slug: '/clubs', h1: `${brand} Member Clubs and Training Venues`, gap: 'No city-by-city directory of clubs and training venues linked to the brand.',
        faq: ['Where is the nearest training venue in my city?', `Which clubs are registered members of ${brand}?`, `How does a school or club join ${brand}?`] };
    case 'comparison': return id
      ? { slug: '/tentang', h1: `Tentang ${brand}: Peran, Struktur, dan Program`, gap: 'Halaman "Tentang" tidak menjelaskan peran dan bukti status brand dengan jelas.',
        faq: [`Apa itu ${brand}?`, `Apa peran ${brand} di tingkat nasional, dan apa buktinya?`, `Apa yang membedakan ${brand} dari organisasi lain?`] }
      : { slug: '/about', h1: `About ${brand}: Role, Structure and Programmes`, gap: 'The About page does not state the brand\'s role and evidence clearly.',
        faq: [`What is ${brand}?`, `What is ${brand}'s national role, and what is the evidence?`, `What makes ${brand} different from other organisations?`] };
    default: return id
      ? { slug: '/faq', h1: `Pertanyaan Umum tentang ${brand}`, gap: 'Pertanyaan ini belum dijawab langsung di situs.', faq: [] }
      : { slug: '/faq', h1: `${brand}: Frequently Asked Questions`, gap: 'The site does not answer this question directly.', faq: [] };
  }
}

// ---------- Sources ----------

export function sourceKind(domain: string): SourceKind {
  if (/wikipedia\.org$|wikidata\.org$|britannica\.com$/u.test(domain)) return 'encyclopedia';
  if (/youtube\.com$|youtu\.be$|vimeo\.com$|tiktok\.com$/u.test(domain)) return 'video';
  if (/instagram\.com$|facebook\.com$|x\.com$|twitter\.com$|linkedin\.com$|threads\.net$/u.test(domain)) return 'social';
  if (/\.go\.id$|\.gov(\.[a-z]{2})?$|\.mil$/u.test(domain)) return 'government';
  if (/(kompas|detik|tempo|liputan6|cnnindonesia|antaranews|tribunnews|okezone|sindonews|kumparan|republika|idntimes|jawapos|suara|viva|bbc|reuters|cnn|nytimes|theguardian|medium)\./u.test(domain)) return 'news';
  if (/\.or\.id$|\.org$|\.org\.[a-z]{2}$/u.test(domain)) return 'organisation';
  if (/google\.|maps\.|yelp\.|tripadvisor\.|foursquare\./u.test(domain)) return 'directory';
  return 'other';
}

function isCompetitorDomain(domain: string, terms: string[]): boolean {
  const compact = alnum(domain);
  return terms.some(term => { const t = alnum(term); return t.length >= 3 && compact.includes(t); });
}

// ---------- Entity understanding ----------

const RECOGNITION = /resmi|diakui|pengakuan|induk organisasi|badan induk|federasi nasional|official|recogni[sz]ed|recognition|governing body|national federation|sanctioned|terdaftar|accredited|terakreditasi|kemenpora|\bkoni\b|anggota resmi|member of/iu;
const NEGATION = /\b(tidak|bukan|belum|not|isn't|aren't|unofficial|no longer|tanpa|never)\b/iu;
const UNCERTAIN = /\b(mungkin|kemungkinan|tidak jelas|kurang jelas|tidak yakin|perlu (?:di)?verifikasi|sebaiknya (?:cek|periksa)|might|may be|unclear|not sure|uncertain|verify|unverified|I (?:could not|cannot) confirm)\b/iu;
const DEFINITIONAL = /\b(adalah|merupakan|ialah|is an?|is the|was founded|didirikan|berdiri)\b/iu;

export function sentencesOf(text: string): string[] {
  return stripMarkdown(text)
    .split(/\n+|(?<=[.!?])\s+(?=[\p{Lu}\d"“(])/u)
    .map(sentence => sentence.replace(/^\s*(?:\d{1,2}[.)]|[-*+•])\s+/u, '').replace(/\s+/g, ' ').trim())
    .filter(sentence => sentence.length >= 12 && sentence.length <= 600);
}

function pushUnique(list: string[], value: string, max: number) {
  if (list.length < max && !list.includes(value)) list.push(value);
}

export function acronymExpansions(text: string, acronym: string): string[] {
  const out: string[] = [];
  const escaped = acronym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const after = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}\\s*\\(([^)]{4,80})\\)`, 'gu');
  const before = new RegExp(`((?:[\\p{Lu}][\\p{L}'’-]*\\s+){1,7}[\\p{Lu}][\\p{L}'’-]*)\\s*\\(\\s*${escaped}\\s*\\)`, 'gu');
  const clean = stripMarkdown(text);
  for (const match of clean.matchAll(after)) if (/^[\p{Lu}]/u.test(match[1].trim())) out.push(match[1].trim());
  for (const match of clean.matchAll(before)) out.push(match[1].trim());
  return out;
}

/** Word initials match the acronym ("Indonesian Cheer Association" -> ICA). */
function initialsMatch(name: string, acronym: string): boolean {
  const initials = name.split(/\s+/).filter(word => /^[\p{L}]/u.test(word) && !/^(of|the|and|dan|untuk|for)$/iu.test(word)).map(word => word[0].toUpperCase()).join('');
  return initials === acronym.toUpperCase();
}

export function pickBrandLabel(aliasLists: string[][], siteName: string): { label: string; acronyms: string[] } {
  const counts = new Map<string, { term: string; n: number; order: number }>();
  let order = 0;
  for (const list of aliasLists) for (const term of list) {
    const key = norm(term);
    const entry = counts.get(key) ?? { term, n: 0, order: order++ };
    entry.n += 1;
    counts.set(key, entry);
  }
  const all = [...counts.values()].sort((a, b) => b.n - a.n || a.order - b.order).map(entry => entry.term);
  const acronyms = all.filter(isAcronym);
  const full = acronyms.length ? all.find(term => !isAcronym(term) && !/\./.test(term) && acronyms.some(acronym => initialsMatch(term, acronym))) : undefined;
  if (full) {
    const acronym = acronyms.find(item => initialsMatch(full, item))!;
    return { label: `${full} (${acronym})`, acronyms };
  }
  const named = all.find(term => !/\./.test(term) && !isAcronym(term));
  return { label: named ?? siteName ?? all[0] ?? 'Brand', acronyms };
}

function entityUnderstanding(
  models: string[], latest: GapCheckInput[], promptById: Map<string, GapPromptInput>, siteName: string, compTerms: string[], brandLabel: string, acronyms: string[],
): EntityUnderstanding {
  const expansionMap = new Map<string, { expansion: string; count: number; models: Set<string> }>();
  const byModel: EntityModel[] = models.map(model => {
    const result: EntityModel = {
      model, answersMentioning: 0, answersTotal: 0, excerpts: [], recognisedStatements: [], negativeStatements: [],
      uncertainStatements: [], otherBodyStatements: [], verdict: 'not-mentioned',
    };
    const definitional: string[] = [];
    const other: string[] = [];
    for (const check of latest) {
      if (check.model !== model || check.error || !check.response) continue;
      const prompt = check.prompt_id ? promptById.get(check.prompt_id) : undefined;
      if (!prompt) continue;
      result.answersTotal += 1;
      const brandTerms = effectiveBrandTerms(prompt.brand_terms, siteName);
      if (check.mentioned) result.answersMentioning += 1;
      for (const acronym of acronyms) {
        for (const expansion of acronymExpansions(check.response, acronym)) {
          const key = norm(expansion);
          const entry = expansionMap.get(key) ?? { expansion, count: 0, models: new Set<string>() };
          entry.count += 1;
          entry.models.add(model);
          expansionMap.set(key, entry);
        }
      }
      let lastSubject: 'brand' | 'other' | null = null;
      for (const sentence of sentencesOf(check.response)) {
        const masked = maskTerms(sentence, compTerms);
        const bi = firstIndexOf(masked, brandTerms);
        const ci = compTerms.length ? firstIndexOf(sentence, compTerms) : -1;
        const recMatch = RECOGNITION.exec(sentence);
        const ri = recMatch ? recMatch.index : -1;
        if (bi !== -1) { if (DEFINITIONAL.test(sentence)) pushUnique(definitional, sentence, 6); else pushUnique(other, sentence, 6); }
        let subject: 'brand' | 'other' | null = null;
        if (bi !== -1 || ci !== -1) {
          if (ri === -1) subject = bi !== -1 && (ci === -1 || bi <= ci) ? 'brand' : 'other';
          else {
            // Nearest named subject before the recognition word, else the nearest after it.
            const before = [bi, ci].filter(index => index !== -1 && index <= ri);
            const pick = before.length ? Math.max(...before) : Math.min(...[bi, ci].filter(index => index !== -1));
            subject = pick === bi ? 'brand' : 'other';
          }
        } else if (lastSubject && ri !== -1 && /^(status|statusnya|its|their|it|organisasi ini|asosiasi ini|lembaga ini|this organi[sz]ation|they|mereka|keduanya)\b|resminya|nya\b/iu.test(sentence)) {
          subject = lastSubject;
        }
        if (subject) lastSubject = subject;
        if (!subject) continue;
        const negative = NEGATION.test(sentence);
        const uncertain = UNCERTAIN.test(sentence);
        if (subject === 'brand') {
          if (bi === -1) pushUnique(other, sentence, 6);
          if (ri !== -1 && uncertain) pushUnique(result.uncertainStatements, sentence, 5);
          else if (ri !== -1 && negative) pushUnique(result.negativeStatements, sentence, 5);
          else if (ri !== -1) pushUnique(result.recognisedStatements, sentence, 5);
          else if (uncertain) pushUnique(result.uncertainStatements, sentence, 5);
        } else if (ri !== -1 && !negative && !uncertain) {
          pushUnique(result.otherBodyStatements, sentence, 5);
        }
      }
    }
    result.excerpts = [...definitional, ...other].slice(0, 4);
    const positive = result.recognisedStatements.length;
    const conflicting = result.negativeStatements.length + result.otherBodyStatements.length;
    if (!result.answersMentioning && !result.excerpts.length) result.verdict = 'not-mentioned';
    else if (positive && conflicting) result.verdict = 'contradictory';
    else if (positive) result.verdict = 'described-as-recognised';
    else result.verdict = 'mentioned-not-recognised';
    return result;
  });

  const expansions = [...expansionMap.values()]
    .map(entry => ({ expansion: entry.expansion, count: entry.count, models: [...entry.models] }))
    .sort((a, b) => b.count - a.count);
  const contradictions: string[] = [];
  const distinct = new Set(expansions.map(entry => alnum(entry.expansion)));
  if (distinct.size >= 2) contradictions.push(`AI expands the acronym in ${distinct.size} different ways: ${expansions.slice(0, 5).map(entry => `"${entry.expansion}" (${entry.count}×)`).join(', ')}.`);
  const recognisedBy = byModel.filter(entry => entry.recognisedStatements.length).map(entry => entry.model);
  const otherBy = byModel.filter(entry => entry.otherBodyStatements.length).map(entry => entry.model);
  if (recognisedBy.length && otherBy.length) contradictions.push(`Models disagree on the official body: ${recognisedBy.join(', ')} describe the brand as recognised, while ${otherBy.join(', ')} describe another organisation that way.`);
  else if (otherBy.length) contradictions.push(`${otherBy.join(', ')} describe another organisation as the official or recognised body, and no model says that of the brand.`);
  for (const entry of byModel) if (entry.verdict === 'contradictory') contradictions.push(`${entry.model} contradicts itself: it calls the brand recognised in one answer and denies it or names another body in another.`);
  return { brandLabel, acronyms, byModel, expansions, contradictions };
}

// ---------- Report ----------

function statusOf(yes: number, total: number): PromptStatus {
  if (!total) return 'unchecked';
  if (!yes) return 'zero';
  const share = yes / total;
  if (share < 0.5) return 'weak';
  if (share < 1) return 'partial';
  return 'strong';
}

export function buildGapReport(input: GapInput): GapReport {
  const generatedAt = (input.generatedAt ?? new Date()).toISOString();
  const promptById = new Map(input.prompts.map(prompt => [prompt.id, prompt]));
  const seenModels = new Set(input.models);
  const models = [...input.models];
  for (const check of [...input.latest, ...input.lifetime]) if (!seenModels.has(check.model)) { seenModels.add(check.model); models.push(check.model); }
  const compTerms = competitorTerms(input.prompts);
  const language = detectLanguage(input.prompts.map(prompt => prompt.prompt));
  const { label: brandLabel, acronyms } = pickBrandLabel(input.prompts.map(prompt => effectiveBrandTerms(prompt.brand_terms, input.siteName)), input.siteName);
  const widest = Math.max(0, ...input.prompts.map(prompt => effectiveBrandTerms(prompt.brand_terms, input.siteName).length));

  const latestByPrompt = new Map<string, GapCheckInput[]>();
  for (const check of input.latest) {
    if (!check.prompt_id || !promptById.has(check.prompt_id)) continue;
    const list = latestByPrompt.get(check.prompt_id) ?? [];
    list.push(check);
    latestByPrompt.set(check.prompt_id, list);
  }
  const lifetimeByPrompt = new Map<string, { answers: number; mentions: number; last: string | null }>();
  for (const check of input.lifetime) {
    if (!check.prompt_id) continue;
    const entry = lifetimeByPrompt.get(check.prompt_id) ?? { answers: 0, mentions: 0, last: null };
    const created = iso(check.created_at);
    if (created && (!entry.last || created > entry.last)) entry.last = created;
    if (comparable(check)) { entry.answers += 1; if (check.mentioned) entry.mentions += 1; }
    lifetimeByPrompt.set(check.prompt_id, entry);
  }

  // Sources
  const domainMap = new Map<string, SourceRow>();
  const domainRow = (domain: string) => {
    let row = domainMap.get(domain);
    if (!row) {
      row = { domain, latestCitations: 0, lifetimeCitations: 0, whenBrandMissing: 0, whenBrandPresent: 0,
        isSite: hostMatches(domain, input.siteHost), isCompetitor: isCompetitorDomain(domain, compTerms), kind: sourceKind(domain) };
      domainMap.set(domain, row);
    }
    return row;
  };
  for (const check of input.lifetime) {
    if (!comparable(check)) continue;
    for (const domain of new Set(check.cited_urls.map(hostOf).filter((host): host is string => !!host))) domainRow(domain).lifetimeCitations += 1;
  }
  let answersWithCitation = 0;
  let siteCitedAnswers = 0;
  let latestAnswerCount = 0;

  const flags: PromptFlag[] = [];
  const prompts: PromptGap[] = input.prompts.map(prompt => {
    const aliases = effectiveBrandTerms(prompt.brand_terms, input.siteName);
    const latest = latestByPrompt.get(prompt.id) ?? [];
    const cells: Record<string, CellResult | undefined> = {};
    let yes = 0;
    let total = 0;
    const competitorsMentioned = new Set<string>();
    const citedUrls = new Set<string>();
    const named = new Map<string, NamedEntity>();
    const missingSources = new Map<string, number>();
    for (const check of latest) {
      const fallback = !check.error && check.answered_model !== check.model;
      cells[check.model] = {
        checkId: check.id, mentioned: check.mentioned, rank: check.rank_in_answer, siteCited: check.site_cited,
        fallback, error: check.error, createdAt: iso(check.created_at) ?? '',
      };
      if (!comparable(check)) continue;
      total += 1;
      latestAnswerCount += 1;
      if (check.mentioned) yes += 1;
      if (check.site_cited) siteCitedAnswers += 1;
      if (check.cited_urls.length) answersWithCitation += 1;
      check.competitors_mentioned.forEach(name => competitorsMentioned.add(name));
      check.cited_urls.forEach(url => citedUrls.add(url));
      const domains = new Set(check.cited_urls.map(hostOf).filter((host): host is string => !!host));
      for (const domain of domains) {
        const row = domainRow(domain);
        row.latestCitations += 1;
        if (check.mentioned) row.whenBrandPresent += 1; else row.whenBrandMissing += 1;
      }
      if (!check.mentioned) {
        for (const domain of domains) missingSources.set(domain, (missingSources.get(domain) ?? 0) + 1);
        for (const entity of rankEntities(check.response ?? '', aliases, prompt.competitors)) {
          if (entity.isBrand) continue;
          const key = norm(entity.name);
          const entry = named.get(key) ?? { name: entity.name, configured: entity.configured, answers: 0, bestRank: null, models: [] };
          entry.answers += 1;
          entry.bestRank = entry.bestRank === null ? entity.rank : Math.min(entry.bestRank, entity.rank);
          if (!entry.models.includes(check.model)) entry.models.push(check.model);
          named.set(key, entry);
        }
      }
    }
    const lifetime = lifetimeByPrompt.get(prompt.id) ?? { answers: 0, mentions: 0, last: null };
    const topic = classifyTopic(prompt.prompt);
    const status = statusOf(yes, total);

    const promptFlags: FlagKind[] = [];
    const parts = splitQuestions(prompt.prompt);
    if (parts.length >= 2) {
      promptFlags.push('combined');
      flags.push({ promptId: prompt.id, prompt: prompt.prompt, kind: 'combined', message: `Bundles ${parts.length} questions into one prompt. AI answers them all superficially, so a "yes" hides which topics are actually missing. Track each question as its own prompt.` });
    }
    const narrow = narrowAliasReason(prompt.brand_terms, input.siteName, widest);
    if (narrow) {
      promptFlags.push('narrow-aliases');
      flags.push({ promptId: prompt.id, prompt: prompt.prompt, kind: 'narrow-aliases', message: `${narrow} Add the full name, common spellings and the domain as brand terms.` });
    }
    const collisions = aliasCollisions(aliases, prompt.competitors);
    for (const collision of collisions) {
      promptFlags.push('alias-collision');
      flags.push({ promptId: prompt.id, prompt: prompt.prompt, kind: 'alias-collision', message: `Brand alias "${collision.alias}" overlaps competitor alias "${collision.term}" (${collision.competitor}). An answer about the competitor can be counted as a brand mention. Remove or narrow this alias.` });
    }
    if (firstIndexOf(prompt.prompt, aliases) !== -1) {
      promptFlags.push('leading');
      flags.push({ promptId: prompt.id, prompt: prompt.prompt, kind: 'leading', message: 'The prompt already names the brand, so a "yes" does not show organic visibility. Keep it to check what AI says about the brand, but judge visibility on prompts that do not name it.' });
    }

    // Likely-gap notes are UI text (English); page titles and FAQs follow the site language.
    const copy = topicCopy(topic, brandLabel, 'en');
    const namedList = [...named.values()].sort((a, b) => Number(b.configured) - Number(a.configured) || b.answers - a.answers || (a.bestRank ?? 99) - (b.bestRank ?? 99)).slice(0, 8);
    let likelyGap = '';
    if (status === 'unchecked') likelyGap = 'Not checked yet.';
    else if (status === 'strong') likelyGap = 'Brand is mentioned by every model.';
    else {
      const bits = [copy.gap];
      if (namedList.length) bits.push(`AI named ${namedList.length} other ${namedList.length === 1 ? 'entity' : 'entities'} instead.`);
      if (missingSources.size) bits.push(`AI relied on ${missingSources.size} cited ${missingSources.size === 1 ? 'domain' : 'domains'} that do not mention the brand.`);
      else bits.push('AI cited no sources, so it answered from training data: the brand needs widely published, consistent references.');
      likelyGap = bits.join(' ');
    }
    return {
      id: prompt.id, prompt: prompt.prompt, active: prompt.active, aliases, competitors: prompt.competitors.map(entry => parseCompetitor(entry).name),
      cells, latestYes: yes, latestTotal: total, lifetimeMentions: lifetime.mentions, lifetimeAnswers: lifetime.answers,
      lastChecked: iso(prompt.last_checked_at) ?? lifetime.last, status, topic,
      competitorsMentioned: [...competitorsMentioned], citedUrls: [...citedUrls].slice(0, 50),
      namedInstead: namedList,
      sourcesWhenMissing: [...missingSources.entries()].sort((a, b) => b[1] - a[1]).map(([domain]) => domain).slice(0, 10),
      likelyGap, flags: [...new Set(promptFlags)], collidingAliases: [...new Set(collisions.map(hit => hit.alias))],
    };
  });

  // Summary
  const byModel: ModelSummary[] = models.map(model => {
    const latest = input.latest.filter(check => check.model === model && check.prompt_id && promptById.has(check.prompt_id));
    const lifetime = input.lifetime.filter(check => check.model === model);
    const latestOk = latest.filter(comparable);
    const lifetimeOk = lifetime.filter(comparable);
    const latestMentions = latestOk.filter(check => check.mentioned).length;
    const lifetimeMentions = lifetimeOk.filter(check => check.mentioned).length;
    return {
      model,
      latestAnswers: latestOk.length, latestMentions, latestRate: rate(latestMentions, latestOk.length),
      latestSiteCited: latestOk.filter(check => check.site_cited).length,
      lifetimeAnswers: lifetimeOk.length, lifetimeMentions, lifetimeRate: rate(lifetimeMentions, lifetimeOk.length),
      fallbacks: lifetime.filter(check => !check.error && check.answered_model !== check.model).length,
      errors: lifetime.filter(check => !!check.error).length,
    };
  });
  const rated = byModel.filter(row => row.latestRate !== null);
  const weakest = rated.length > 1 ? [...rated].sort((a, b) => a.latestRate! - b.latestRate!)[0] : null;
  const strongest = rated.length > 1 ? [...rated].sort((a, b) => b.latestRate! - a.latestRate!)[0] : null;
  const latestAnswers = byModel.reduce((sum, row) => sum + row.latestAnswers, 0);
  const latestMentions = byModel.reduce((sum, row) => sum + row.latestMentions, 0);
  const lifetimeAnswers = byModel.reduce((sum, row) => sum + row.lifetimeAnswers, 0);
  const lifetimeMentions = byModel.reduce((sum, row) => sum + row.lifetimeMentions, 0);
  const summary: GapSummary = {
    promptsTracked: input.prompts.length,
    promptsChecked: prompts.filter(prompt => prompt.status !== 'unchecked').length,
    latestAnswers, latestMentions, latestRate: rate(latestMentions, latestAnswers),
    lifetimeAnswers, lifetimeMentions, lifetimeRate: rate(lifetimeMentions, lifetimeAnswers),
    byModel,
    weakestModel: weakest && strongest && weakest.latestRate !== strongest.latestRate ? weakest.model : null,
    strongestModel: weakest && strongest && weakest.latestRate !== strongest.latestRate ? strongest.model : null,
    zeroVisibility: prompts.filter(prompt => prompt.status === 'zero').map(prompt => ({ id: prompt.id, prompt: prompt.prompt })),
    fullVisibility: prompts.filter(prompt => prompt.status === 'strong').map(prompt => ({ id: prompt.id, prompt: prompt.prompt })),
  };

  const answers: AnswerRow[] = input.latest
    .filter(check => check.prompt_id && promptById.has(check.prompt_id))
    .map(check => ({
      promptId: check.prompt_id!, prompt: promptById.get(check.prompt_id!)!.prompt, model: check.model, answeredModel: check.answered_model,
      createdAt: iso(check.created_at) ?? '', mentioned: check.mentioned, rank: check.rank_in_answer, siteCited: check.site_cited,
      competitorsMentioned: check.competitors_mentioned, citedUrls: check.cited_urls, response: check.response ?? '', error: check.error,
    }))
    .sort((a, b) => input.prompts.findIndex(p => p.id === a.promptId) - input.prompts.findIndex(p => p.id === b.promptId) || models.indexOf(a.model) - models.indexOf(b.model));

  const domains = [...domainMap.values()].sort((a, b) => b.latestCitations - a.latestCitations || b.lifetimeCitations - a.lifetimeCitations || a.domain.localeCompare(b.domain));
  const entity = entityUnderstanding(models, input.latest, promptById, input.siteName, compTerms, brandLabel, acronyms);

  const report: GapReport = {
    site: { name: input.siteName, host: input.siteHost }, generatedAt, language, models, summary, prompts, answers,
    sources: { domains, answersWithCitation, siteCitedAnswers, latestAnswers: latestAnswerCount },
    entity, flags, recommendations: [],
  };
  report.recommendations = buildRecommendations(report, input.prompts);
  return report;
}

// ---------- Recommendations ----------

function organizationJsonLd(report: GapReport, alternateNames: string[]): string {
  const host = report.site.host;
  const label = report.entity.brandLabel.replace(/\s*\([^)]*\)$/u, '');
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: label,
    alternateName: alternateNames,
    url: host ? `https://${host}/` : '<site URL>',
    logo: host ? `https://${host}/<path-to-logo>.png` : '<logo URL>',
    description: '<one-sentence description that matches your official documents>',
    foundingDate: '<YYYY-MM-DD from the deed of establishment>',
    address: { '@type': 'PostalAddress', streetAddress: '<street>', addressLocality: '<city>', addressCountry: 'ID' },
    sameAs: ['<official Instagram URL>', '<official YouTube URL>', '<Wikidata item URL, once it exists>', '<member listing URL on the international federation site, if any>'],
    subjectOf: host ? `https://${host}${report.language === 'id' ? '/legalitas' : '/official-status'}` : '<official status page URL>',
  }, null, 2);
}

function llmsTxt(report: GapReport, pages: PageSuggestion[]): string {
  const host = report.site.host ? `https://${report.site.host}` : '<site URL>';
  const lines = [
    `# ${report.entity.brandLabel}`,
    '',
    '> <One-sentence description that matches your official documents. State only what the documents on the official status page prove.>',
    '',
    '## Key pages',
    ...pages.map(page => `- [${page.h1}](${host}${page.slug})`),
    `- [Contact](${host}/contact)`,
    '',
    '## Evidence',
    `- [Official documents](${host}${report.language === 'id' ? '/legalitas' : '/official-status'}): registration, decrees and membership certificates, each with issuer, number and date.`,
  ];
  return lines.join('\n');
}

function faqJsonLd(page: PageSuggestion): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: page.faq.slice(0, 3).map(question => ({ '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: '<answer that links to the supporting document>' } })),
  }, null, 2);
}

/** Deterministic, competitor-free recommendations. */
export function buildRecommendations(report: GapReport, rawPrompts: Array<Pick<GapPromptInput, 'competitors'>>): Recommendation[] {
  const compTerms = competitorTerms(rawPrompts);
  const language = report.language;
  const brand = report.entity.brandLabel;
  const scrub = (text: string) => scrubCompetitors(text, compTerms, language);
  const recs: Recommendation[] = [];
  const s = report.summary;
  const losing = report.prompts.filter(prompt => prompt.status === 'zero' || prompt.status === 'weak' || prompt.status === 'partial');
  const recognitionVerdicts = report.entity.byModel.filter(model => model.answersTotal > 0);
  const recognisedEverywhere = recognitionVerdicts.length > 0 && recognitionVerdicts.every(model => model.verdict === 'described-as-recognised');
  const otherBody = report.entity.byModel.some(model => model.otherBodyStatements.length > 0);
  const collidingAliases = new Set(report.prompts.flatMap(prompt => prompt.collidingAliases.map(norm)));

  // 1. Official status evidence
  if (!recognisedEverywhere) {
    const notRec = recognitionVerdicts.filter(model => model.verdict !== 'described-as-recognised').map(model => model.model);
    recs.push({
      id: 'entity-official-status', priority: 'high', category: 'entity',
      title: `Publish verifiable evidence of ${brand}'s official status`,
      why: `${notRec.length ? `${notRec.join(', ')} do not describe ${brand} as the recognised national body in the stored answers.` : 'No stored answer describes the brand as the recognised national body.'}${otherBody ? ' At least one model describes another organisation as the official body.' : ''} AI repeats what it can verify from published sources.`,
      actions: [
        `Create an official status page (${language === 'id' ? '/legalitas' : '/official-status'}) listing each document that proves the status: issuer, document number, date and a downloadable scan or a link to the issuer's own listing.`,
        'State only what those documents say, in the same wording, and keep the page in sync with the documents.',
        'Ask each issuing institution and partner to link to this page or list the organisation on their own site; an external listing is stronger evidence than the brand\'s own claim.',
        'Link the page from the header or footer and from the About page, and reference it in the Organization JSON-LD (subjectOf).',
      ],
    });
  }

  // 2. Name consistency
  if (report.entity.expansions.length >= 2 || collidingAliases.size) {
    recs.push({
      id: 'entity-name-consistency', priority: 'high', category: 'entity',
      title: 'Use one official name and expansion everywhere',
      why: [
        report.entity.expansions.length >= 2 ? `AI uses ${report.entity.expansions.length} different expansions of the acronym.` : '',
        collidingAliases.size ? 'Some tracked brand aliases are generic and overlap another organisation\'s name, which confuses both AI and this report.' : '',
      ].filter(Boolean).join(' '),
      actions: [
        `Pick the exact legal name and acronym (${brand}) and use them identically on the site, social profiles, press releases and partner sites.`,
        'Avoid describing the brand with a generic phrase that matches another organisation\'s name; always pair the acronym with the full legal name on first use.',
        'Correct the name on third-party pages that use a wrong expansion.',
      ],
    });
  }

  // 3. Organization JSON-LD
  const alternateNames = [...new Set(report.prompts.flatMap(prompt => prompt.aliases))]
    .filter(alias => !/\./.test(alias) && !collidingAliases.has(norm(alias)) && !containsCompetitor(alias, compTerms)).slice(0, 6);
  recs.push({
    id: 'entity-organization-schema', priority: 'high', category: 'entity',
    title: 'Add Organization schema.org JSON-LD with sameAs links',
    why: 'Structured data tells crawlers and AI which name, website, logo and profiles belong to the same organisation.',
    actions: [
      'Put this JSON-LD in the <head> of the home page and the About page. Replace every <placeholder> with a real, verifiable value; leave a field out rather than guessing.',
      'List in sameAs only official profiles you control and listings on independent sites (Wikidata, international federation member list).',
      'Validate with the Rich Results Test and the Schema Markup Validator.',
    ],
    snippet: { label: 'Organization JSON-LD', language: 'json', code: organizationJsonLd(report, alternateNames) },
  });

  // 4. Content pages per losing topic
  // Bundled prompts are split so each question lands on the page for its own topic.
  const byTopic = new Map<TopicKey, { prompts: Set<string>; questions: string[] }>();
  for (const prompt of losing) {
    const questions = splitQuestions(prompt.prompt);
    for (const question of questions) {
      const topic = questions.length > 1 ? classifyTopic(question) : prompt.topic;
      const entry = byTopic.get(topic) ?? { prompts: new Set<string>(), questions: [] };
      entry.prompts.add(prompt.id);
      entry.questions.push(question);
      byTopic.set(topic, entry);
    }
  }
  const pages: PageSuggestion[] = [];
  for (const [topic, entry] of byTopic) {
    const copy = topicCopy(topic, brand, language);
    const questions = entry.questions.map(question => {
      const cleaned = scrub(question).replace(/[\s,;]+$/u, '');
      const sentence = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
      return /[?？]$/u.test(sentence) ? sentence : `${sentence}?`;
    });
    const faq = [...new Set([...questions, ...copy.faq].map(scrub))].slice(0, 8);
    pages.push({ topic, slug: copy.slug, h1: scrub(copy.h1), faq, prompts: entry.prompts.size });
  }
  pages.sort((a, b) => b.prompts - a.prompts);
  if (pages.length) {
    const zero = losing.filter(prompt => prompt.status === 'zero').length;
    recs.push({
      id: 'content-pages', priority: zero ? 'high' : 'medium', category: 'content',
      title: `Create ${pages.length} page${pages.length === 1 ? '' : 's'} that answer the questions AI cannot answer about ${brand}`,
      why: `${losing.length} prompt${losing.length === 1 ? ' is' : 's are'} missed by at least one model in the latest run (${zero} with zero mentions across all models).`,
      actions: [
        'Write one page per topic. Answer each question in the first two sentences under its own H2/H3, then give details, dates, numbers and links to supporting documents.',
        `Name ${brand} explicitly in each answer (not only "we"), so a quoted paragraph still identifies the organisation.`,
        'Link every page from the main navigation or a hub page, include it in sitemap.xml and request indexing in Google Search Console.',
        'Add FAQPage JSON-LD that mirrors the visible questions and answers.',
      ],
      pages,
    });
    recs.push({
      id: 'content-faq-schema', priority: 'medium', category: 'content',
      title: 'Mark up the new FAQs with FAQPage schema',
      why: 'FAQ markup gives AI clean question/answer pairs to quote.',
      actions: ['Add FAQPage JSON-LD to each new page, with the same questions and answers as the visible text.', 'Do not mark up questions that are not visible on the page.'],
      snippet: { label: `FAQPage JSON-LD (${pages[0].slug})`, language: 'json', code: faqJsonLd(pages[0]) },
    });
  }

  // 5. International federation membership
  if (report.prompts.some(prompt => prompt.topic === 'international' || prompt.topic === 'recognition')) {
    recs.push({
      id: 'entity-international-membership', priority: 'high', category: 'entity',
      title: 'Publish verifiable evidence of international federation membership',
      why: 'Several tracked questions ask which body is recognised internationally; AI looks for a member listing on the federation\'s own site.',
      actions: [
        'If the organisation holds membership in an international federation, publish the membership certificate (issuer, date, membership type) on a dedicated page.',
        'Link to the organisation\'s entry on the federation\'s official member list, and ask the federation to link back to the brand site.',
        'Add that member-list URL to sameAs in the Organization JSON-LD.',
      ],
    });
  }

  // 6. Wikidata / Wikipedia
  recs.push({
    id: 'entity-wikidata', priority: 'medium', category: 'entity',
    title: 'Create or complete a Wikidata item, and a Wikipedia article only when independent sources exist',
    why: 'AI models lean on Wikidata and Wikipedia to decide what an organisation is.',
    actions: [
      'Create or update a Wikidata item with the official name, acronym, official website, founding date, country and references to independent sources.',
      'Propose a Wikipedia article only when independent, reliable coverage exists (news articles, institution websites); cite those sources, not the brand site.',
      'Add the Wikidata URL to sameAs once it exists.',
    ],
  });

  // 7. News coverage
  recs.push({
    id: 'entity-news', priority: 'medium', category: 'entity',
    title: 'Earn independent news coverage that names the organisation correctly',
    why: report.sources.answersWithCitation ? `AI cited sources in ${report.sources.answersWithCitation} of ${report.sources.latestAnswers} latest answers; independent coverage is what it cites.` : 'AI rarely cited sources, so it answers from training data built on widely published coverage.',
    actions: [
      'Send press releases for championships, national team selection, certifications and results, using the exact official name and acronym and linking to the official status page.',
      'Build a newsroom page that lists every article about the organisation with links.',
    ],
  });

  // 8. NAP + llms.txt
  recs.push({
    id: 'entity-nap', priority: 'low', category: 'entity',
    title: 'Keep name, address and phone (NAP) identical everywhere',
    why: 'Inconsistent contact details make it harder to tie mentions to one organisation.',
    actions: ['Use the same name, address, phone and email on the site footer, Contact page, Google Business Profile, social profiles and directories.', 'Fix old addresses or names on partner and directory listings.'],
  });
  recs.push({
    id: 'entity-llms-txt', priority: 'low', category: 'entity',
    title: 'Publish /llms.txt pointing AI to the key pages',
    why: 'llms.txt is a short, emerging convention that gives AI crawlers a clean map of the site. It is cheap to add.',
    actions: ['Upload this file at the site root as /llms.txt after replacing the placeholder text.', 'Make sure robots.txt does not block AI crawlers you want (GPTBot, ClaudeBot, Google-Extended, PerplexityBot).'],
    snippet: { label: '/llms.txt', language: 'text', code: llmsTxt(report, pages.length ? pages : [{ topic: 'general', slug: '/about', h1: `About ${brand}`, faq: [], prompts: 0 }]) },
  });

  // 9. Third-party sources
  const thirdParty = report.sources.domains.filter(row => row.whenBrandMissing > 0 && !row.isSite && !row.isCompetitor && !containsCompetitor(row.domain, compTerms)).slice(0, 8);
  if (thirdParty.length) {
    const hint = (row: SourceRow) => {
      switch (row.kind) {
        case 'encyclopedia': return `${row.domain}: add or correct the entry with independent references`;
        case 'video': return `${row.domain}: publish official videos (events, explainers) whose titles and descriptions use the official name`;
        case 'social': return `${row.domain}: make sure the official profile exists, is verified where possible and links to the site`;
        case 'news': return `${row.domain}: pitch stories or press releases about events and results`;
        case 'government': return `${row.domain}: ask to be listed or linked where the institution lists organisations`;
        case 'directory': return `${row.domain}: claim and complete the listing`;
        default: return `${row.domain}: ask to be listed, quoted or linked`;
      }
    };
    recs.push({
      id: 'third-party-sources', priority: 'medium', category: 'third-party',
      title: 'Get listed on the sources AI cites when it leaves the brand out',
      why: `These domains were cited in answers that did not mention ${brand}.`,
      actions: thirdParty.map(row => `${hint(row)} (cited in ${row.whenBrandMissing} answer${row.whenBrandMissing === 1 ? '' : 's'} without the brand).`),
    });
  }

  // 10. Weakest model
  if (s.weakestModel) {
    const weak = s.byModel.find(row => row.model === s.weakestModel)!;
    recs.push({
      id: 'model-weakest', priority: 'medium', category: 'content',
      title: `Close the gap on ${weak.model}`,
      why: `${weak.model} mentions the brand in ${weak.latestRate ?? 0}% of latest answers, the lowest of all models.`,
      actions: ['Read this model\'s answers in the Answers sheet to see which organisations and sources it relies on.', 'Prioritise the pages and sources above for the prompts where only this model misses the brand.'],
    });
  }

  // 11. Tracking hygiene
  const kinds = new Set(report.flags.map(flag => flag.kind));
  if (kinds.size) {
    const actions: string[] = [];
    if (kinds.has('combined')) actions.push('Split bundled prompts into one question per prompt, so each topic gets its own yes/no.');
    if (kinds.has('narrow-aliases')) actions.push('Use the same full alias list on every prompt: acronym, full legal name, common spellings and the domain.');
    if (kinds.has('alias-collision')) actions.push('Remove brand aliases that overlap another organisation\'s name; they produce false "yes" results.');
    if (kinds.has('leading')) actions.push('Judge visibility on prompts that do not name the brand; use branded prompts only to check what AI says about it.');
    recs.push({
      id: 'tracking-hygiene', priority: 'medium', category: 'tracking',
      title: 'Fix prompt tracking so the numbers reflect reality',
      why: `${report.flags.length} tracking issue${report.flags.length === 1 ? '' : 's'} found across ${new Set(report.flags.map(flag => flag.promptId)).size} prompt(s); see Flags.`,
      actions,
    });
  }

  const order: Record<RecPriority, number> = { high: 0, medium: 1, low: 2 };
  return recs
    .map(rec => ({
      ...rec,
      title: scrub(rec.title), why: scrub(rec.why), actions: rec.actions.map(scrub),
      pages: rec.pages?.map(page => ({ ...page, h1: scrub(page.h1), faq: page.faq.map(scrub) })),
      snippet: rec.snippet ? { ...rec.snippet, code: scrubSnippet(rec.snippet.code, compTerms) } : undefined,
    }))
    .sort((a, b) => order[a.priority] - order[b.priority]);
}

function scrubSnippet(code: string, terms: string[]): string {
  // JSON must stay valid: only replace inside string values.
  return code.replace(/"((?:[^"\\]|\\.)*)"/g, (match, inner: string) => (containsCompetitor(inner, terms) ? JSON.stringify(scrubCompetitors(inner, terms)) : match));
}

// ---------- Optional LLM summary ----------

export const GAP_SUMMARY_SYSTEM = [
  'You write a short executive summary of an AI-visibility gap report for a non-technical marketing team.',
  'Rules: use only facts present in the data. Never state that the brand is officially recognised, accredited or a member of anything as a fact;',
  'say "publish verifiable evidence of ..." instead. Never name any competitor or other organisation. No URLs that are not in the data.',
  'Write in English, 5 to 8 bullet points, each starting with "- ". Finish with the three highest-impact fixes.',
].join(' ');

export function gapSummaryPrompt(report: GapReport): string {
  const digest = {
    brand: report.entity.brandLabel,
    summary: {
      latestRate: report.summary.latestRate, lifetimeRate: report.summary.lifetimeRate,
      byModel: report.summary.byModel.map(row => ({ model: row.model, latestRate: row.latestRate, lifetimeRate: row.lifetimeRate })),
      weakestModel: report.summary.weakestModel, zeroVisibilityPrompts: report.summary.zeroVisibility.length, prompts: report.summary.promptsTracked,
    },
    entity: report.entity.byModel.map(model => ({ model: model.model, verdict: model.verdict, mentioning: model.answersMentioning, total: model.answersTotal })),
    contradictions: report.entity.contradictions.length,
    losingTopics: [...new Set(report.prompts.filter(prompt => prompt.status === 'zero' || prompt.status === 'weak').map(prompt => prompt.topic))],
    flags: report.flags.map(flag => flag.kind),
    recommendations: report.recommendations.map(rec => ({ priority: rec.priority, title: rec.title })),
  };
  return `Gap report data (JSON):\n${JSON.stringify(digest)}`;
}

/** Cleans the model output: competitor names out, at most 1,500 characters. */
export function sanitizeGapSummary(output: string, report: GapReport, rawPrompts: Array<Pick<GapPromptInput, 'competitors'>>): string | null {
  const text = output.replace(/```[\s\S]*?```/g, '').trim();
  if (!text) return null;
  return scrubCompetitors(text, competitorTerms(rawPrompts), 'en').replace(/[ \t]+\n/g, '\n').slice(0, 1_500) || null;
}
