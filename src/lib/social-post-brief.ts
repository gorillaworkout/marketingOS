/**
 * Social Post v2 brief: validation, platform rules, and the caption prompt block.
 * No database. Safe to import from tests and the browser.
 */

export const CONTENT_TYPES = ['photo', 'carousel', 'video'] as const;
export type SocialContentType = (typeof CONTENT_TYPES)[number];

export const TONE_PRESETS = ['brand-default', 'professional', 'friendly', 'educational', 'bold', 'inspirational', 'humorous', 'custom'] as const;
export type SocialTone = (typeof TONE_PRESETS)[number];

export const CTA_CHOICES = ['none', 'follow', 'learn-more', 'register', 'comment', 'visit-link'] as const;
export type SocialCta = (typeof CTA_CHOICES)[number];

export const KEY_MESSAGE_MAX = 200;
export const TONE_CUSTOM_MAX = 80;
export const REFERENCE_TEXT_MAX = 2_000;
export const REFERENCE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const REFERENCE_IMAGE_DESCRIPTION_MAX = 800;

export type SocialReference = {
  kind: 'text' | 'url' | 'image';
  text: string;
  url?: string;
  imageKey?: string;
};

export type SocialPostBriefInput = {
  contentType: SocialContentType;
  tone: SocialTone;
  toneCustom: string;
  cta: SocialCta;
  ctaUrl: string;
  keyMessage: string;
  reference: SocialReference | null;
};

const SOCIAL_HOSTS = ['instagram.com', 'tiktok.com', 'twitter.com', 'x.com', 'facebook.com', 'fb.com', 'linkedin.com', 'threads.net'];

export function platformKey(platform?: string): string {
  const lower = (platform || '').trim().toLowerCase();
  if (lower === 'twitter/x' || lower === 'x' || lower === 'x/twitter' || lower === 'twitter') return 'twitter';
  if (lower.startsWith('instagram')) return 'instagram';
  if (lower.startsWith('linkedin')) return 'linkedin';
  if (lower.startsWith('tiktok')) return 'tiktok';
  if (lower.startsWith('facebook')) return 'facebook';
  if (lower.startsWith('youtube')) return 'youtube';
  return lower;
}

export const HASHTAG_RANGES: Record<string, { min: number; max: number }> = {
  instagram: { min: 15, max: 20 },
  tiktok: { min: 3, max: 6 },
  linkedin: { min: 3, max: 5 },
  twitter: { min: 1, max: 3 },
  facebook: { min: 1, max: 3 },
};

/** Hashtags in a caption, including Unicode letters such as #dupoin. */
export function extractHashtags(caption: string): string[] {
  const found = caption.match(/#[\p{L}\p{N}_]+/gu) || [];
  const tags: string[] = [];
  for (const tag of found) {
    const key = tag.toLowerCase();
    if (!tags.some(existing => existing.toLowerCase() === key)) tags.push(tag);
  }
  return tags;
}

export function hashtagRange(platform?: string): { min: number; max: number } {
  return HASHTAG_RANGES[platformKey(platform)] || { min: 3, max: 8 };
}

/** Bold may use more emojis. LinkedIn stays at 1–2 even for Bold. */
export function emojiLimit(platform?: string, style?: string): number {
  const key = platformKey(platform);
  if (key === 'linkedin') return 2;
  if (style === 'bold') return key === 'instagram' || key === 'tiktok' ? 8 : 6;
  if (key === 'instagram') return 6;
  return 3;
}

export function platformOptimization(platform?: string): string {
  const key = platformKey(platform);
  const range = hashtagRange(platform);
  const lines: Record<string, string> = {
    instagram: `Platform: Instagram
- Use visually descriptive language
- Include ${range.min}-${range.max} relevant hashtags
- Keep caption scannable with line breaks and emojis
- Hook must grab attention in first line (before "more" cutoff)
- Optimal length: 138-150 characters for the hook`,
    linkedin: `Platform: LinkedIn
- Professional, thought-leadership tone
- No excessive emojis (1-2 max)
- Include industry insights or data points
- Use line breaks for readability
- Hashtags: ${range.min}-${range.max} professional hashtags
- Hook should provoke professional curiosity`,
    tiktok: `Platform: TikTok
- Trendy, casual, authentic voice
- Short punchy sentences
- Gen-Z friendly language
- Hook must work in first 1-2 seconds
- Hashtags: ${range.min}-${range.max}. Do not add #fyp unless the brief asks for it`,
    twitter: `Platform: X/Twitter
- Concise, punchy, under 280 characters
- Strong opinion or insight in the hook
- ${range.min}-${range.max} hashtags max
- Thread-worthy content if longer`,
    facebook: `Platform: Facebook
- Conversational, community-oriented
- Storytelling works well
- Moderate emoji use
- Engagement-focused (questions, polls)
- Hashtags: ${range.min}-${range.max}`,
    youtube: `Platform: YouTube
- SEO-optimized title and description
- Hook in first 5 seconds
- Clear chapter/section structure
- CTA for subscribe and engagement`,
  };
  return lines[key] || (platform ? `Platform: ${platform}\nOptimize content format and style for ${platform}.` : '');
}

const CTA_LABELS: Record<SocialCta, string> = {
  none: 'None',
  follow: 'Follow',
  'learn-more': 'Learn More',
  register: 'Register',
  comment: 'Comment',
  'visit-link': 'Visit Link',
};

export function ctaNeedsUrl(cta: SocialCta): boolean {
  return cta === 'register' || cta === 'visit-link';
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isSocialNetworkUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.replace(/^www\./, '').toLowerCase();
    return SOCIAL_HOSTS.some(blocked => host === blocked || host.endsWith(`.${blocked}`));
  } catch {
    return false;
  }
}

export function parseSocialPostBrief(raw: unknown): { ok: true; brief: SocialPostBriefInput } | { ok: false; error: string } {
  const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const contentType = typeof body.contentType === 'string' && (CONTENT_TYPES as readonly string[]).includes(body.contentType)
    ? body.contentType as SocialContentType
    : 'photo';
  const tone = typeof body.tone === 'string' && (TONE_PRESETS as readonly string[]).includes(body.tone)
    ? body.tone as SocialTone
    : 'brand-default';
  const toneCustom = typeof body.toneCustom === 'string' ? body.toneCustom.trim().slice(0, TONE_CUSTOM_MAX) : '';
  if (tone === 'custom' && !toneCustom) return { ok: false, error: 'Custom tone needs a short description (80 characters or fewer).' };
  const cta = typeof body.cta === 'string' && (CTA_CHOICES as readonly string[]).includes(body.cta)
    ? body.cta as SocialCta
    : 'none';
  const ctaUrl = typeof body.ctaUrl === 'string' ? body.ctaUrl.trim() : '';
  if (ctaUrl && !isHttpUrl(ctaUrl)) return { ok: false, error: 'CTA URL must start with http:// or https://.' };
  const keyMessage = typeof body.keyMessage === 'string' ? body.keyMessage.trim().slice(0, KEY_MESSAGE_MAX) : '';
  const reference = parseReference(body.reference);
  if (reference && 'error' in reference) return { ok: false, error: reference.error };
  return { ok: true, brief: { contentType, tone, toneCustom, cta, ctaUrl, keyMessage, reference } };
}

function parseReference(value: unknown): SocialReference | { error: string } | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const kind = raw.kind;
  if (kind !== 'text' && kind !== 'url' && kind !== 'image') return null;
  const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, kind === 'image' ? REFERENCE_IMAGE_DESCRIPTION_MAX : REFERENCE_TEXT_MAX) : '';
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  const imageKey = typeof raw.imageKey === 'string' ? raw.imageKey.trim() : '';
  if (kind === 'url') {
    if (!isHttpUrl(url)) return { error: 'Content reference URL must start with http:// or https://.' };
    if (isSocialNetworkUrl(url)) return { error: 'Social network URLs are stored as links only. Paste the caption text instead of asking us to fetch it.' };
  }
  if (kind === 'text' && text.length > REFERENCE_TEXT_MAX) return { error: `Content reference text must be ${REFERENCE_TEXT_MAX} characters or fewer.` };
  return { kind, text, ...(url ? { url } : {}), ...(imageKey ? { imageKey } : {}) };
}

export function toneLine(brief: SocialPostBriefInput): string {
  if (brief.tone === 'custom') return brief.toneCustom;
  if (brief.tone === 'brand-default') return 'Brand default (follow the brand guideline tone)';
  return brief.tone;
}

export function buildBriefPromptBlock(brief: SocialPostBriefInput): string {
  const lines = [
    `Content type: ${brief.contentType}`,
    `Tone of voice: ${toneLine(brief)} (use this for word choice; the style variant still sets structure and energy)`,
  ];
  if (brief.keyMessage) {
    lines.push(`Key message: "${brief.keyMessage.slice(0, KEY_MESSAGE_MAX)}" — this idea must appear in the caption, in the hook or the first two lines. A close paraphrase is allowed.`);
  }
  if (brief.cta !== 'none') {
    lines.push(`CTA: end with one clear "${CTA_LABELS[brief.cta]}" line.${brief.ctaUrl ? ` Use exactly this URL and no other URL: ${brief.ctaUrl}` : ' Do not invent a URL.'}`);
  }
  if (brief.reference?.text || brief.reference?.url) {
    const source = brief.reference.text || brief.reference.url || '';
    lines.push(`CONTENT_REFERENCE (inspiration for angle and format; do not copy wording):\n${source.slice(0, REFERENCE_TEXT_MAX)}`);
  }
  if (brief.contentType === 'carousel') {
    lines.push('Also return slides: 5 to 7 objects { "title", "text" }. The caption is the cover caption.');
  }
  if (brief.contentType === 'video') {
    lines.push('This is a video. Return videoHook (one line that can be spoken in 3 seconds) and shotList (3 to 5 short shot lines). Do not describe a still image.');
  }
  return lines.join('\n');
}

export function outputShape(contentType: SocialContentType): string {
  const extra = contentType === 'carousel'
    ? ', "slides": [{"title":"...","text":"..."}]'
    : contentType === 'video'
      ? ', "videoHook": "...", "shotList": ["..."]'
      : '';
  return `{ "hook": "...", "caption": "...", "hashtags": ["..."], "citationIds": [1], "cta": "..."${extra} }`;
}

const BANNED_TAG_BITS = ['dijamin', 'pastiuntung', 'tanparisiko', 'bebasrisiko', 'pastiprofit', 'uangmudah', 'cepatkaya'];

export function normalizeHashtag(raw: string): string | null {
  let tag = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (!tag) return null;
  if (!tag.startsWith('#')) tag = `#${tag}`;
  tag = tag.replace(/[^#a-z0-9_]/g, '');
  if (!/^#[a-z0-9_]{2,}$/.test(tag)) return null;
  if (BANNED_TAG_BITS.some(bit => tag.includes(bit))) return null;
  return tag;
}

export function dedupeHashtags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const normalized = normalizeHashtag(tag);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

const CTA_CUES: Record<string, string[]> = {
  follow: ['follow', 'ikuti'],
  'learn-more': ['learn more', 'pelajari', 'selengkapnya'],
  register: ['register', 'daftar'],
  comment: ['comment', 'komentar'],
  'visit-link': ['visit', 'kunjungi', 'http://', 'https://'],
};

export function ctaPresent(text: string, cta: string, ctaUrl?: string): boolean {
  if (!cta || cta === 'none') return true;
  const haystack = text.toLowerCase();
  if (ctaUrl && haystack.includes(ctaUrl.toLowerCase())) return true;
  return (CTA_CUES[cta] || []).some(cue => haystack.includes(cue));
}

export function keyMessagePresent(text: string, keyMessage: string): boolean {
  const message = keyMessage.trim().toLowerCase();
  if (!message) return true;
  const haystack = text.toLowerCase().replace(/\s+/g, ' ');
  if (haystack.includes(message.replace(/\s+/g, ' '))) return true;
  const words = message.split(/[^a-z0-9]+/).filter(word => word.length > 3);
  if (words.length === 0) return haystack.includes(message);
  const hits = words.filter(word => haystack.includes(word)).length;
  return hits / words.length >= 0.7;
}

export function captionUrls(text: string): string[] {
  return text.match(/https?:\/\/[^\s)]+/gi) || [];
}

export function urlsMatch(left: string, right: string): boolean {
  return left.replace(/[.,]+$/, '') === right.replace(/[.,]+$/, '');
}

export const VIDEO_HANDOFF_QUERY = 'from';
export const VIDEO_HANDOFF_VALUE = 'social-post';
export const VIDEO_HANDOFF_STORAGE_KEY = 'mos.social-post.video-handoff';

export type VideoHandoff = {
  brief: string;
  hook: string;
  shots: string[];
  platform: string;
  audience: string;
};

export function videoScriptHref(): string {
  return `/dashboard/video-script?${VIDEO_HANDOFF_QUERY}=${VIDEO_HANDOFF_VALUE}`;
}

/** Restore a saved generation brief from `tasks.output_data.input`. */
export function readStoredSocialPostInput(raw: unknown): (SocialPostBriefInput & {
  platform?: string;
  targetAudience?: string;
  goal?: string;
  brandGuidelineId?: string;
  campaignId?: string;
  competitorRefIds?: string[];
}) | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = parseSocialPostBrief(raw);
  if (!parsed.ok) return null;
  const body = raw as Record<string, unknown>;
  return {
    ...parsed.brief,
    ...(typeof body.platform === 'string' ? { platform: body.platform } : {}),
    ...(typeof body.targetAudience === 'string' ? { targetAudience: body.targetAudience } : {}),
    ...(typeof body.goal === 'string' ? { goal: body.goal } : {}),
    ...(typeof body.brandGuidelineId === 'string' && body.brandGuidelineId ? { brandGuidelineId: body.brandGuidelineId } : {}),
    ...(typeof body.campaignId === 'string' && body.campaignId ? { campaignId: body.campaignId } : {}),
    ...(Array.isArray(body.competitorRefIds) ? { competitorRefIds: body.competitorRefIds.filter((item): item is string => typeof item === 'string').slice(0, 3) } : {}),
  };
}
