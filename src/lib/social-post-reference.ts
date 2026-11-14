import { isHttpUrl, isSocialNetworkUrl, REFERENCE_IMAGE_DESCRIPTION_MAX, REFERENCE_TEXT_MAX } from '@/lib/social-post-brief';

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, REFERENCE_TEXT_MAX);
}

export async function readPublicReferenceUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<{ text: string } | { error: string }> {
  if (!isHttpUrl(url)) return { error: 'Content reference URL must start with http:// or https://.' };
  if (isSocialNetworkUrl(url)) return { error: 'Social network URLs are not fetched. Paste the caption text instead.' };
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(8_000), redirect: 'follow' });
    if (!response.ok) return { error: 'That page could not be read. Paste the text instead.' };
    const type = response.headers.get('content-type') || '';
    if (!type.includes('text/html') && !type.includes('text/plain')) return { error: 'That URL is not a public article. Paste the text instead.' };
    const text = htmlToText(await response.text());
    if (!text) return { error: 'That page had no readable text. Paste the text instead.' };
    return { text };
  } catch {
    return { error: 'That page could not be read. Paste the text instead.' };
  }
}

export function clipDescription(text: string): string {
  return text.trim().slice(0, REFERENCE_IMAGE_DESCRIPTION_MAX);
}
