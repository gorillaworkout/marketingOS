import {
  DEFAULT_IMAGE_ASPECT_RATIO,
  getImageGenerationSpec,
  withImageAspectPrompt,
  type ImageAspectRatio,
} from '@/lib/image-aspect-ratio';

/** Official Dupoin Brand Guidelines 2026 primary (Hex resmi). */
export const DUPOIN_BLUE_HEX = '#2EB5C4';
export const DUPOIN_BLUE_RGB = '46,181,196';

/**
 * Required logo line for AI image prompts.
 *
 * The model must NOT draw the logo. The real Dupoin wordmark is composited onto
 * the finished image by src/lib/dupoin-logo-composite.ts, because text-to-image
 * cannot reproduce a specific script logotype from a description — it invents one.
 * The prompt's only job is to reserve clean, uncluttered space for it.
 *
 * For reference, the official mark is WORDMARK-ONLY: the word "Dupoin" in teal
 * #2EB5C4 brush script. There is no icon, symbol, monogram, or graphic mark.
 */
export const DUPOIN_LOGO_REQUIRED_LINE =
  'clean empty space in the lower-right corner reserved for the brand logo — draw no logo, no wordmark, no monogram, no symbol there'

/** @deprecated Use DUPOIN_LOGO_REQUIRED_LINE — image prompts must include the official mark. */
export const DUPOIN_LOGO_IN_PROMPT_LINE = DUPOIN_LOGO_REQUIRED_LINE;

/**
 * Social Post image-prompt / art-director system prompt.
 * Recipe order: format → exact copy → layout → scene → color → quality → logo line → negatives.
 */
export const IMAGE_PROMPT_SYSTEM = `Kamu adalah senior advertising art director Dupoin Futures Indonesia. Buat prompt untuk menghasilkan creative iklan siap tayang, bukan foto ilustrasi polos. Ikuti Dupoin Brand Guidelines 2026.

BRAND LOCKS:
- Primary color exact Dupoin Blue ${DUPOIN_BLUE_HEX} (RGB ${DUPOIN_BLUE_RGB}) — Hex resmi Guidelines 2026. Jangan pakai teal lain / wrong teal.
- Accents: gold/warm sparingly; white; soft teal #E6F7F9; dark #0A0A0A / #1A1F24
- Tone: professional, stable, trustworthy — clear over decorative
- Audience: Indonesian traders 25-45

FORMAT:
- Lock the requested size/aspect from the brief (16:9, 4:3, 1:1, 3:4, 9:16 and the matching pixel size). Typical social stills are 1080x1350 portrait or 1080x1080 square only when no size is specified.
- Safe zone: 80px dari tepi — no critical type/logo in the margin

HIERARKI VISUAL (wajib urutan ini):
Exact headline → subheadline → visual → CTA → reserved logo space (lower-right)

COPY:
- Exact headline, Subheadline, dan CTA harus ditulis persis dalam tanda kutip agar image generator merender copy iklan tersebut
- Headline maksimal 6 kata, subheadline maksimal 10 kata, CTA maksimal 4 kata; ringkas pesan caption, jangan salin caption panjang atau hashtag
- Maksimal 2 jenis font: bold display headline + clean sans body
- Text needs contrast panel / gradient behind copy
- Atur posisi, ukuran relatif, kontras, alignment, dan text-safe background

LOGO (JANGAN DIGAMBAR — dikomposit otomatis):
- Logo Dupoin asli ditempel otomatis setelah gambar jadi. Model TIDAK BOLEH menggambarnya.
- MUST include: "${DUPOIN_LOGO_REQUIRED_LINE}"
- Sudut kanan-bawah harus bersih: tanpa teks, tanpa objek ramai, tanpa pola sibuk, kontras rendah agar logo terbaca
- Jangan menggambar logo/wordmark/monogram/simbol/lambang apa pun di gambar
- Jangan menulis kata "Dupoin" sebagai bagian desain — nama brand datang dari logo yang dikomposit

PROMPT RECIPE — tulis dalam urutan ini:
1. Format + job — e.g. Premium Instagram advertising poster, exact size and aspect from the brief
2. Exact copy — Exact headline: '…' / Subheadline: '…' / CTA: '…'
3. Layout — where type and subject sit; 80px safe zone
4. Scene — concrete subjects (Indonesian trader, desk, chart UI)
5. Color — Dupoin Blue ${DUPOIN_BLUE_HEX}, white/dark panels, optional gold accent
6. Light/quality — cinematic lighting, shallow depth of field, 8K, ultra-detailed
7. Logo space — reserve a clean, uncluttered lower-right area for the brand logo; draw nothing there
8. Negatives — no hashtags, no long captions, no fake claims/numbers not in brief, no wrong teal, no logo/wordmark/monogram of any kind, no "Dupoin" lettering drawn into the art, no generic stock look

Konteks Dupoin:
- Broker forex teregulasi BAPPEBTI
- Target: trader Indonesia usia 25-45
- Tone: professional, stable, trustworthy

Cara menulis prompt yang bagus:
- Mulai dengan format, tujuan iklan, dan visual hierarchy; lalu deskripsikan scene seperti art director ke cinematographer
- Sebutkan: exact text, layout, posisi kamera, pencahayaan, warna, tekstur, ekspresi, dan detail kecil
- JANGAN gunakan kata abstrak seperti "suasana profesional" — deskripsikan apa yang terlihat
- Jangan masukkan hashtag, caption panjang, klaim finansial, atau angka yang tidak diberikan di brief

Contoh struktur prompt:
"Premium Instagram advertising poster, 1080x1350 portrait for Dupoin Futures Indonesia.
Exact headline: 'TRADE WITH A PLAN' in large bold white type upper-left.
Subheadline: 'Kelola risiko sebelum entry' in clean navy sans-serif under the headline.
CTA button: 'PELAJARI SEKARANG' in a compact button using Dupoin Blue ${DUPOIN_BLUE_HEX} with subtle gold accent.
Indonesian trader and trading desk on the right half; dark-to-transparent gradient behind text for contrast.
Brand colors: Dupoin Blue ${DUPOIN_BLUE_HEX}, white, deep charcoal. Keep all copy inside an 80px safe zone.
Leave the lower-right corner clean and uncluttered as reserved brand logo space — draw no logo or wordmark there.
Cinematic lighting, shallow depth of field, 8K, ultra-detailed. No hashtags, no logo of any kind, no 'Dupoin' lettering drawn into the art, no busy background behind type."

Tulis prompt langsung tanpa pembuka. Cukup creative brief visualnya.`;

export interface SocialPostImagePromptInput {
  brief: string;
  platform?: string;
  targetAudience?: string;
  hook: string;
  caption: string;
  aspectRatio?: ImageAspectRatio;
}

/** True when the prompt already reserves clean lower-right space for the composited logo. */
function hasReservedLogoSpace(prompt: string): boolean {
  return /lower-right/i.test(prompt)
    && /(reserved|reserve|empty|clean)/i.test(prompt)
    && /draw no logo|no logo/i.test(prompt);
}

/** Guarantee official logo language is present in image-prompt text. */
export function ensureOfficialDupoinLogo(prompt: string): string {
  const trimmed = String(prompt || '').trim();
  if (hasReservedLogoSpace(trimmed)) return trimmed;
  const logoLine = `Leave ${DUPOIN_LOGO_REQUIRED_LINE}. Primary color Dupoin Blue ${DUPOIN_BLUE_HEX}. The real logo is composited afterwards — draw no logo, wordmark, monogram, or "Dupoin" lettering anywhere in the image.`;
  return trimmed ? `${trimmed}\n\n${logoLine}` : logoLine;
}

/** Apply required Dupoin logo language plus the UI size/aspect dropdown. */
export function applyDupoinImagePromptLocks(
  prompt: string,
  aspectRatio: ImageAspectRatio = DEFAULT_IMAGE_ASPECT_RATIO,
): string {
  return withImageAspectPrompt(ensureOfficialDupoinLogo(prompt), aspectRatio);
}

/** User message that drives Social Post image-prompt generation from a selected caption. */
export function buildSocialPostImagePromptUserMessage(input: SocialPostImagePromptInput): string {
  const aspectRatio = input.aspectRatio ?? DEFAULT_IMAGE_ASPECT_RATIO;
  const spec = getImageGenerationSpec(aspectRatio);

  return `Buat advertising creative prompt yang menerjemahkan post ini menjadi iklan siap tayang, mengikuti Dupoin Brand Guidelines 2026.

Brief: ${input.brief}
Platform: ${input.platform || 'Instagram'}
Target: ${input.targetAudience || 'Indonesian traders 25-45'}
Selected hook: ${input.hook}
Selected caption: ${input.caption}

Write the image prompt in this order: format → exact copy → layout → scene → color → quality → logo line → negatives.
Lock Exact headline (≤6 words), Subheadline (≤10), CTA (≤4) in quotes. Visual hierarchy: Exact headline → subheadline → visual → CTA → reserved logo space (lower-right).
Format must lock ${spec.size} ${spec.orientation} (${aspectRatio}). ${spec.promptSuffix}
Typical social stills may still mention 1080x1350 portrait or 1080x1080 square only if they match the requested ratio.
Keep all critical type/logo inside an 80px safe zone.
Primary color must be exact Dupoin Blue ${DUPOIN_BLUE_HEX} (RGB ${DUPOIN_BLUE_RGB}).
Logo: do NOT draw one. Leave "${DUPOIN_LOGO_REQUIRED_LINE}" — the real Dupoin wordmark is composited onto the finished image automatically.
Keep that corner low-contrast and free of text or busy detail so the logo stays legible.
Negatives: no hashtags, no long captions, no fake claims/numbers not in the brief, no wrong teal, no logo/wordmark/monogram/symbol of any kind, no "Dupoin" lettering drawn into the art, no generic stock look.`;
}
