// Social accounts of a competitor: platform list, handle normalization, and
// profile URLs. Pure helpers shared by the store, the API, discovery, and the UI.

export const SOCIAL_PLATFORMS = ['instagram', 'tiktok', 'facebook', 'youtube', 'x', 'linkedin', 'telegram'] as const;
export type SocialPlatform = typeof SOCIAL_PLATFORMS[number];
export type SocialHandles = Partial<Record<SocialPlatform, string>>;

export const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', youtube: 'YouTube', x: 'X (Twitter)', linkedin: 'LinkedIn', telegram: 'Telegram',
};

export const SOCIAL_PLACEHOLDERS: Record<SocialPlatform, string> = {
  instagram: '@handle', tiktok: '@handle', facebook: 'page name or facebook.com/… link', youtube: '@handle or channel/UC… link',
  x: '@handle', linkedin: 'company/slug or link', telegram: '@channel',
};

/** Path segments that are platform pages, not accounts. */
const RESERVED: Record<SocialPlatform, Set<string>> = {
  instagram: new Set(['p', 'reel', 'reels', 'tv', 'explore', 'accounts', 'stories', 'direct', 'about', 'legal', 'developer', 'web', 'share']),
  tiktok: new Set(['discover', 'tag', 'music', 'search', 'foryou', 'following', 'live', 'upload', 'legal', 'about', 'embed', 'share', 'login', 'signup']),
  facebook: new Set(['sharer', 'sharer.php', 'share', 'share.php', 'dialog', 'plugins', 'tr', 'login', 'login.php', 'help', 'policies', 'privacy', 'legal', 'groups', 'events', 'hashtag', 'watch', 'gaming', 'marketplace', 'business', 'ads', 'pages', 'photo', 'photo.php', 'story.php', 'permalink.php', 'home.php', 'l.php', 'search', 'about', 'terms']),
  youtube: new Set(['watch', 'embed', 'results', 'playlist', 'shorts', 'feed', 'premium', 'about', 't', 'redirect', 'share', 'live', 'post', 'hashtag']),
  x: new Set(['intent', 'share', 'home', 'search', 'hashtag', 'i', 'explore', 'login', 'signup', 'settings', 'tos', 'privacy', 'about', 'messages', 'notifications', 'compose']),
  linkedin: new Set(['shareArticle', 'sharing', 'feed', 'login', 'signup', 'legal', 'help', 'jobs', 'learning', 'posts', 'pulse']),
  telegram: new Set(['share', 'joinchat', 's', 'addstickers', 'proxy', 'iv', 'login', 'apps', 'blog', 'faq']),
};

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^(www\.|m\.|mobile\.|web\.|business\.|id\.|en-gb\.|vm\.|vt\.)/, '');
}

/** Which platform a URL belongs to, or null. */
export function platformOfUrl(url: URL): SocialPlatform | null {
  const host = hostOf(url);
  if (host === 'instagram.com' || host === 'instagr.am') return 'instagram';
  if (host === 'tiktok.com') return 'tiktok';
  if (host === 'facebook.com' || host === 'fb.com' || host === 'fb.me') return 'facebook';
  if (host === 'youtube.com' || host === 'youtu.be') return 'youtube';
  if (host === 'x.com' || host === 'twitter.com') return 'x';
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return 'linkedin';
  if (host === 't.me' || host === 'telegram.me' || host === 'telegram.dog') return 'telegram';
  return null;
}

const SIMPLE = /^[A-Za-z0-9._]{1,40}$/;

/**
 * Account handle from a profile URL, or null for share/intent links, posts,
 * and generic platform pages. Values:
 * instagram / tiktok / x / telegram: the bare handle;
 * facebook: page slug or "profile.php?id=123"; youtube: "@handle", "channel/UC…", "c/name" or "user/name";
 * linkedin: "company/slug" (or "in/slug", "showcase/slug").
 */
export function handleFromUrl(raw: string): { platform: SocialPlatform; handle: string } | null {
  let url: URL;
  try { url = new URL(raw.trim().replace(/^\/\//, 'https://')); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const platform = platformOfUrl(url);
  if (!platform) return null;
  const parts = url.pathname.split('/').filter(Boolean).map(part => { try { return decodeURIComponent(part); } catch { return part; } });
  const first = parts[0] || '';
  const reserved = RESERVED[platform];
  switch (platform) {
    case 'instagram':
    case 'telegram': {
      if (!first || reserved.has(first.toLowerCase()) || first.startsWith('+')) return null;
      const handle = first.replace(/^@/, '');
      return SIMPLE.test(handle) && !/^_+$/.test(handle) ? { platform, handle } : null;
    }
    case 'tiktok': {
      if (!first.startsWith('@')) return null;
      const handle = first.slice(1);
      return SIMPLE.test(handle) ? { platform, handle } : null;
    }
    case 'x': {
      if (!first || reserved.has(first.toLowerCase())) return null;
      const handle = first.replace(/^@/, '');
      return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? { platform, handle } : null;
    }
    case 'facebook': {
      if (hostOf(url) === 'fb.me') return null;
      if (first.toLowerCase() === 'profile.php') {
        const id = url.searchParams.get('id');
        return id && /^\d{5,20}$/.test(id) ? { platform, handle: `profile.php?id=${id}` } : null;
      }
      if (!first || reserved.has(first.toLowerCase())) return null;
      if (first.toLowerCase() === 'people') {
        const id = parts.slice(1).find(part => /^\d{5,20}$/.test(part));
        return id ? { platform, handle: `profile.php?id=${id}` } : null;
      }
      return /^[A-Za-z0-9.\-_]{2,80}$/.test(first) ? { platform, handle: first } : null;
    }
    case 'youtube': {
      if (hostOf(url) === 'youtu.be') return null;
      if (first.startsWith('@')) return SIMPLE.test(first.slice(1).replace(/-/g, '_')) ? { platform, handle: first } : null;
      if (first === 'channel' && parts[1] && /^UC[A-Za-z0-9_-]{20,24}$/.test(parts[1])) return { platform, handle: `channel/${parts[1]}` };
      if ((first === 'c' || first === 'user') && parts[1] && /^[A-Za-z0-9._-]{1,80}$/.test(parts[1])) return { platform, handle: `${first}/${parts[1]}` };
      return null;
    }
    case 'linkedin': {
      if (!['company', 'in', 'showcase', 'school'].includes(first) || !parts[1]) return null;
      return /^[A-Za-z0-9\-_.%]{1,100}$/.test(parts[1]) ? { platform, handle: `${first}/${parts[1]}` } : null;
    }
  }
  return null;
}

/**
 * Normalize what a user typed (handle, @handle, or link) for one platform.
 * '' = empty (clears it); null = invalid.
 */
export function normalizeHandle(platform: SocialPlatform, value: unknown): string | null {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text) return '';
  if (/^(https?:)?\/\//i.test(text) || /^(www\.)?[a-z.]+\.(com|me|be)\//i.test(text)) {
    const parsed = handleFromUrl(/^https?:/i.test(text) ? text : `https://${text.replace(/^\/\//, '')}`);
    return parsed && parsed.platform === platform ? parsed.handle : null;
  }
  switch (platform) {
    case 'instagram': case 'telegram': case 'tiktok': {
      const handle = text.replace(/^@/, '');
      return SIMPLE.test(handle) ? handle : null;
    }
    case 'x': {
      const handle = text.replace(/^@/, '');
      return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
    }
    case 'facebook':
      if (/^profile\.php\?id=\d{5,20}$/.test(text)) return text;
      return /^[A-Za-z0-9.\-_]{2,80}$/.test(text) ? text : null;
    case 'youtube':
      if (/^@[A-Za-z0-9._-]{1,40}$/.test(text)) return text;
      if (/^channel\/UC[A-Za-z0-9_-]{20,24}$/.test(text)) return text;
      if (/^UC[A-Za-z0-9_-]{20,24}$/.test(text)) return `channel/${text}`;
      if (/^(c|user)\/[A-Za-z0-9._-]{1,80}$/.test(text)) return text;
      return /^[A-Za-z0-9._-]{1,40}$/.test(text) ? `@${text}` : null;
    case 'linkedin':
      if (/^(company|in|showcase|school)\/[A-Za-z0-9\-_.%]{1,100}$/.test(text)) return text;
      return /^[A-Za-z0-9\-_.]{1,100}$/.test(text) ? `company/${text}` : null;
  }
  return null;
}

/** Public profile URL for a stored handle. */
export function socialProfileUrl(platform: SocialPlatform, handle: string): string {
  switch (platform) {
    case 'instagram': return `https://www.instagram.com/${handle}/`;
    case 'tiktok': return `https://www.tiktok.com/@${handle}`;
    case 'facebook': return `https://www.facebook.com/${handle}`;
    case 'youtube': return `https://www.youtube.com/${handle}`;
    case 'x': return `https://x.com/${handle}`;
    case 'linkedin': return `https://www.linkedin.com/${handle}/`;
    case 'telegram': return `https://t.me/${handle}`;
  }
}

/** Display form: "@mifx" for handle platforms, the path for the others. */
export function socialDisplay(platform: SocialPlatform, handle: string): string {
  return ['instagram', 'tiktok', 'x', 'telegram'].includes(platform) ? `@${handle}` : handle;
}

/** Clean a stored/posted object into SocialHandles; invalid entries dropped. */
export function parseSocialHandles(value: unknown): SocialHandles {
  let raw = value;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { return {}; } }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: SocialHandles = {};
  for (const platform of SOCIAL_PLATFORMS) {
    const handle = normalizeHandle(platform, (raw as Record<string, unknown>)[platform]);
    if (handle) out[platform] = handle;
  }
  return out;
}

/** The handle used as the Instagram handle column (kept for older code and reports). */
export function withInstagram(handles: SocialHandles, instagramHandle: string | null): SocialHandles {
  return instagramHandle && !handles.instagram ? { ...handles, instagram: instagramHandle } : handles;
}
