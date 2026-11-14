/**
 * Brand Voice and Campaign Memory for Social Post.
 * Prompt blocks stay inside the design caps. No database access.
 */

import { dedupeHashtags, isHttpUrl } from '@/lib/social-post-brief';

export const VOICE_CHARACTER_MAX = 1_500;
export const VOICE_SAMPLE_MAX = 2_200;
export const VOICE_SAMPLE_PROMPT_MAX = 400;
export const VOICE_BLOCK_MAX = 2_500;
export const VOICE_SAMPLES_IN_PROMPT = 3;
export const VOICE_SAMPLES_STORED_MAX = 20;
export const CAMPAIGN_BLOCK_MAX = 1_500;
export const CAMPAIGN_MATCH_MIN = 0.35;
export const BRAND_VOICE_WRITE_FEATURES = ['social-post', 'video-script', 'event-plan'] as const;

export type VoiceSample = {
  platform?: string | null;
  contentType?: string | null;
  caption: string;
  note?: string | null;
};

export type CampaignLink = { label: string; url: string };

export type CampaignInput = {
  name: string;
  status: 'planned' | 'active' | 'ended' | 'archived';
  startsOn: string | null;
  endsOn: string | null;
  objective: string | null;
  keyFacts: string[];
  approvedClaims: string[];
  links: CampaignLink[];
  hashtags: string[];
  notes: string | null;
};

const CAMPAIGN_STATUSES = ['planned', 'active', 'ended', 'archived'] as const;

export function canWriteBrandVoice(user: { role: string; features: readonly string[] }): boolean {
  return user.role === 'admin' || BRAND_VOICE_WRITE_FEATURES.some(feature => user.features.includes(feature));
}

/** Shared voices are admin-only. A personal voice belongs to its owner. */
export function canEditBrandVoice(
  user: { id: string; role: string },
  row: { userId: string; isShared: boolean },
): boolean {
  if (row.isShared) return user.role === 'admin';
  return user.role === 'admin' || user.id === row.userId;
}

/** Any social-post user may edit. Delete stays with the creator or an admin. */
export function canDeleteCampaign(user: { id: string; role: string }, row: { createdBy: string }): boolean {
  return user.role === 'admin' || user.id === row.createdBy;
}

export function clipText(value: string, max: number): string {
  const text = value.trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function parseStringList(value: unknown, itemMax: number, countMax: number): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\n+/)
      : [];
  const items: string[] = [];
  for (const item of source) {
    if (typeof item !== 'string') continue;
    const text = item.trim().slice(0, itemMax);
    if (!text || items.includes(text)) continue;
    items.push(text);
    if (items.length >= countMax) break;
  }
  return items;
}

function parseDate(value: unknown): string | null | { error: string } {
  if (value == null || value === '') return null;
  const text = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { error: 'Dates must use YYYY-MM-DD.' };
  return text;
}

export function parseCampaignInput(body: Record<string, unknown>): { ok: true; campaign: CampaignInput } | { ok: false; error: string } {
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  if (!name) return { ok: false, error: 'Campaign name is required.' };
  const status = typeof body.status === 'string' && (CAMPAIGN_STATUSES as readonly string[]).includes(body.status)
    ? body.status as CampaignInput['status']
    : 'active';
  const startsOn = parseDate(body.startsOn ?? body.starts_on);
  if (startsOn && typeof startsOn === 'object') return { ok: false, error: startsOn.error };
  const endsOn = parseDate(body.endsOn ?? body.ends_on);
  if (endsOn && typeof endsOn === 'object') return { ok: false, error: endsOn.error };
  const links = parseLinks(body.links);
  if (!links.ok) return links;
  return {
    ok: true,
    campaign: {
      name,
      status,
      startsOn,
      endsOn,
      objective: typeof body.objective === 'string' && body.objective.trim() ? body.objective.trim().slice(0, 500) : null,
      keyFacts: parseStringList(body.keyFacts ?? body.key_facts, 200, 12),
      approvedClaims: parseStringList(body.approvedClaims ?? body.approved_claims, 200, 12),
      links: links.links,
      hashtags: dedupeHashtags(parseStringList(body.hashtags, 60, 15)),
      notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 1_000) : null,
    },
  };
}

function parseLinks(value: unknown): { ok: true; links: CampaignLink[] } | { ok: false; error: string } {
  if (value == null || value === '') return { ok: true, links: [] };
  const source = Array.isArray(value) ? value : [];
  const links: CampaignLink[] = [];
  for (const item of source) {
    if (!item || typeof item !== 'object') continue;
    const label = String((item as { label?: unknown }).label || '').trim().slice(0, 80);
    const url = String((item as { url?: unknown }).url || '').trim();
    if (!url && !label) continue;
    if (!isHttpUrl(url)) return { ok: false, error: 'Campaign links must start with http:// or https://.' };
    links.push({ label: label || url, url });
    if (links.length >= 8) break;
  }
  return { ok: true, links };
}

export function campaignEmbeddingText(campaign: CampaignInput): string {
  return [
    campaign.name,
    campaign.objective,
    campaign.keyFacts.join('\n'),
    campaign.approvedClaims.join('\n'),
    campaign.hashtags.join(' '),
    campaign.notes,
  ].filter(Boolean).join('\n');
}

export function pickVoiceSamples(samples: VoiceSample[], platform?: string, contentType?: string): VoiceSample[] {
  const ranked = samples.map((sample, index) => ({ sample, index, score: sampleScore(sample, platform, contentType) }));
  ranked.sort((left, right) => right.score - left.score || left.index - right.index);
  const matching = ranked.filter(item => item.score > 0);
  const chosen = (matching.length > 0 ? matching : ranked).slice(0, VOICE_SAMPLES_IN_PROMPT);
  return chosen.map(item => item.sample);
}

function sampleScore(sample: VoiceSample, platform?: string, contentType?: string): number {
  const samplePlatform = (sample.platform || '').trim().toLowerCase();
  const wantedPlatform = (platform || '').trim().toLowerCase();
  const sampleType = (sample.contentType || '').trim().toLowerCase();
  const wantedType = (contentType || '').trim().toLowerCase();
  const platformMatch = Boolean(samplePlatform && wantedPlatform && samplePlatform === wantedPlatform);
  const platformMiss = Boolean(samplePlatform && wantedPlatform && samplePlatform !== wantedPlatform);
  const typeMatch = Boolean(sampleType && wantedType && sampleType === wantedType);
  const typeMiss = Boolean(sampleType && wantedType && sampleType !== wantedType);
  if (platformMiss || typeMiss) return 0;
  return (platformMatch ? 2 : 0) + (typeMatch ? 2 : 0) + 1;
}

export function buildBrandVoiceBlock(input: { character?: string | null; banned?: string[]; samples?: VoiceSample[] }): string {
  const character = clipText(input.character || '', VOICE_CHARACTER_MAX);
  const banned = (input.banned || []).map(item => item.trim()).filter(Boolean).slice(0, 30);
  const samples = (input.samples || []).slice(0, VOICE_SAMPLES_IN_PROMPT).map(sample => {
    const where = [sample.platform, sample.contentType].filter(Boolean).join(' / ');
    return `- ${where ? `${where}: ` : ''}${clipText(sample.caption, VOICE_SAMPLE_PROMPT_MAX)}`;
  });
  if (!character && banned.length === 0 && samples.length === 0) return '';
  const lines = ['BRAND_VOICE'];
  if (character) lines.push(`Character: ${character}`);
  if (banned.length) lines.push(`Banned phrases: ${banned.join('; ')}`);
  if (samples.length) lines.push('Samples (match the voice; do not copy wording):', ...samples);
  return clipText(lines.join('\n'), VOICE_BLOCK_MAX);
}

export function buildCampaignBlock(campaign: CampaignInput): string {
  const dates = [campaign.startsOn, campaign.endsOn].filter(Boolean).join(' to ');
  const lines = [
    'CAMPAIGN_MEMORY',
    `${campaign.name} (${campaign.status}${dates ? `, ${dates}` : ''})`,
    'These are the only promo facts you may state. Do not add prices, prizes, dates, or percentages that are not listed here. Never invent a URL.',
  ];
  if (campaign.links.length) lines.push(`Links (use these exactly):\n${campaign.links.map(link => `- ${link.label}: ${link.url}`).join('\n')}`);
  if (campaign.hashtags.length) lines.push(`Hashtags: ${campaign.hashtags.join(' ')}`);
  if (campaign.objective) lines.push(`Objective: ${campaign.objective}`);
  if (campaign.keyFacts.length) lines.push(`Key facts:\n${campaign.keyFacts.map(fact => `- ${fact}`).join('\n')}`);
  if (campaign.approvedClaims.length) lines.push(`Approved claims:\n${campaign.approvedClaims.map(claim => `- ${claim}`).join('\n')}`);
  return clipText(lines.join('\n'), CAMPAIGN_BLOCK_MAX);
}

export type CampaignCandidate = { id: string; name: string; status: string; embedding: string | null };

export function campaignAllowedText(campaign: CampaignInput, extra = ''): string {
  return [
    extra,
    campaign.name,
    campaign.objective,
    campaign.keyFacts.join(' '),
    campaign.approvedClaims.join(' '),
    campaign.notes,
  ].filter(Boolean).join('\n');
}

/** Numbers that look like prices or percentages and are not in the allowed campaign text. */
export function inventedPromoTokens(caption: string, allowed: string): string[] {
  const tokens = caption.match(/(?:rp|usd|\$)\s?\d[\d.,]*|\b\d+(?:[.,]\d+)?%/gi) || [];
  const haystack = allowed.toLowerCase().replace(/\s+/g, '');
  const unseen: string[] = [];
  for (const token of tokens) {
    const compact = token.toLowerCase().replace(/\s+/g, '');
    if (!haystack.includes(compact) && !unseen.includes(token)) unseen.push(token);
  }
  return unseen;
}

export type BrandVoiceChoice = {
  id: string;
  brand_name: string;
  tone_of_voice: string;
  voice_character: string;
  banned_phrases: string[];
  is_shared: boolean;
  can_edit: boolean;
};

export function readBrandVoiceChoices(payload: unknown): BrandVoiceChoice[] {
  if (!payload || typeof payload !== 'object') return [];
  const raw = (payload as { guidelines?: unknown }).guidelines;
  if (!Array.isArray(raw)) return [];
  const choices: BrandVoiceChoice[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = (item as { id?: unknown }).id;
    const brandName = (item as { brand_name?: unknown }).brand_name;
    if (typeof id !== 'string' || !id.trim()) continue;
    if (typeof brandName !== 'string' || !brandName.trim()) continue;
    choices.push({
      id,
      brand_name: brandName,
      tone_of_voice: stringField(item, 'tone_of_voice'),
      voice_character: stringField(item, 'voice_character'),
      banned_phrases: parseStringList((item as { banned_phrases?: unknown }).banned_phrases, 80, 30),
      is_shared: Boolean((item as { is_shared?: unknown }).is_shared),
      can_edit: Boolean((item as { can_edit?: unknown }).can_edit),
    });
  }
  return choices;
}

function stringField(item: object, key: string): string {
  const value = (item as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}
