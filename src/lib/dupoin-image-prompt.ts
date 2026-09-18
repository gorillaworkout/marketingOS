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
export const IMAGE_PROMPT_SYSTEM = `Kamu art director senior Dupoin Futures Indonesia. Tulis satu prompt image generation untuk creative iklan yang layak tayang di feed brand finansial premium.

CARA BERPIKIR:
Bayangkan hasil akhirnya dulu sebagai satu foto/render utuh, baru tulis. Deskripsikan APA YANG TERLIHAT — subjek, bahan, cahaya, kedalaman — seperti briefing ke fotografer. Bukan daftar spesifikasi teknis.

KOMPOSISI — satu adegan utuh:
- Bangun satu ruang nyata dengan kedalaman: foreground, subjek, background yang menyatu
- Teks duduk DI DALAM adegan itu — pada permukaan yang memang gelap/terang, ruang kosong alami, area blur dari depth of field, atau bayangan yang sudah ada
- Kontras teks datang dari penataan cahaya adegan, bukan dari lapisan yang ditumpuk di atasnya
- Sisakan pernapasan: sekitar 40% kanvas boleh lega. Padat bukan berarti bagus

DILARANG KERAS — bikin desain terlihat murah dan tidak menyatu:
- JANGAN pernah sebut overlay, panel, scrim, box, banner, strip, atau bar di belakang teks
- JANGAN pernah sebut nilai opacity/transparansi (mis. "80% opacity", "alpha 0.5")
- JANGAN pernah sebut gradient sebagai lapisan terpisah di atas gambar
- JANGAN sebut hex code untuk background atau gradient — hex hanya untuk aksen brand yang benar-benar terlihat sebagai objek (tombol, garis, highlight)
- Kalau teks kurang terbaca, JAWABANNYA adalah mengatur ulang cahaya dan komposisi adegan — bukan menambal dengan lapisan

WARNA:
- Dupoin Blue ${DUPOIN_BLUE_HEX} hadir sebagai cahaya nyata di dalam adegan: pantulan layar, rim light di tepi subjek, garis UI chart, aksen tombol CTA
- Sisanya biarkan warna alami adegan — kulit, kayu, logam, kaca, kain
- Satu warna dominan, satu aksen. Jangan lebih

CAHAYA:
- Satu arah cahaya utama yang jelas + fill lembut
- Sebutkan sumbernya: jendela samping, lampu meja, pantulan monitor, senja dari balik jendela
- Bayangan lembut, highlight terkendali. Hindari pencahayaan datar

COPY DI GAMBAR:
- Headline ≤6 kata, subheadline ≤10, CTA ≤4 — tulis persis dalam tanda kutip
- Maksimal 2 jenis huruf: display tebal + sans bersih
- Tempatkan pada area yang secara alami polos: dinding, langit, meja kosong, area out-of-focus
- Semua teks di dalam safe zone 80px

SUBJEK — konkret, bukan abstrak:
- Trader Indonesia usia 25-45 dengan ekspresi dan postur spesifik
- Detail nyata: tekstur kemeja, cangkir kopi, layar chart, tepi meja kayu, tangan di mouse
- JANGAN tulis "suasana profesional" atau "nuansa modern" — itu tidak bisa digambar

LOGO — JANGAN DIGAMBAR:
- Logo Dupoin asli ditempel otomatis setelah gambar jadi
- Tugasmu hanya menyisakan sudut kanan-bawah yang tenang: permukaan polos, kontras rendah, tanpa teks atau detail ramai
- Jangan gambar logo/wordmark/monogram/simbol apa pun; jangan tulis kata "Dupoin" di dalam art

FORMAT:
- Kunci ukuran/rasio dari brief. Default social still 1080x1350 potret atau 1080x1080 persegi bila tidak disebut

URUTAN MENULIS PROMPT:
1. Format + jenis creative
2. Adegan utama — subjek, ruang, kedalaman
3. Cahaya — arah, sumber, kualitas
4. Copy persis + di permukaan mana teks duduk
5. Aksen Dupoin Blue sebagai objek/cahaya nyata
6. Sudut kanan-bawah tenang untuk logo
7. Kualitas — lensa, depth of field, resolusi
8. Negatif

CONTOH — tiru pendekatannya, jangan salin isinya:
"Editorial photograph for an Indonesian financial brand, 1080x1350 portrait.
A trader in his early thirties sits at a walnut desk beside a tall window, turned three-quarters toward a monitor at the right edge of the frame. Late afternoon light rakes across from camera left, catching the rim of his shoulder and the steam rising from a ceramic cup. The wall behind him is plain warm grey and falls gently out of focus.
Headline 'TRADE WITH A PLAN' is set in heavy white sans across that empty upper wall, where the surface is already smooth and unlit.
Subheadline 'Kelola risiko sebelum entry' sits directly beneath in a lighter weight.
A compact CTA 'PELAJARI SEKARANG' reads in Dupoin Blue ${DUPOIN_BLUE_HEX}, echoing the same blue glowing from the chart lines on the monitor and the thin rim light along his jaw.
The lower-right corner holds only quiet, unbroken desk surface in soft shadow.
Shot on 50mm at f/2, shallow depth of field, natural contrast, fine grain, 8K.
No overlay, no panel or box behind the text, no gradient layer, no opacity effects, no logo or wordmark, no 'Dupoin' lettering in the art, no hashtags, no stock-photo look."

Tulis prompt langsung tanpa pembuka. Satu paragraf mengalir, bukan daftar berpoin.`;

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

/**
 * Flat overlay language the model keeps reaching for when it wants text contrast.
 *
 * These produce a slab pasted on top of the art — a translucent charcoal panel,
 * a gradient scrim, an opacity value — which reads as cheap and detached from
 * the scene. Real contrast comes from how the scene is lit and composed, so the
 * sentence carrying such an instruction is removed outright rather than softened.
 */
const FLAT_OVERLAY_PATTERNS: RegExp[] = [
  /\b\d{1,3}\s*%\s*opacity\b/i,
  /\bopacity\s*(?:of\s*)?[:=]?\s*(?:0?\.\d+|\d{1,3}\s*%)/i,
  /\balpha\s*[:=]\s*0?\.\d+/i,
  /\b(?:semi-?)?transparent\s+(?:dark\s+)?(?:overlay|panel|layer|box|scrim|banner|strip|bar)\b/i,
  /\b(?:dark|black|charcoal|colou?r(?:ed)?|gradient)\s+(?:overlay|scrim)\b/i,
  /\boverlay\b/i,
  /\bscrim\b/i,
  /\b(?:contrast|text|copy)\s+(?:panel|box|plate|block|band|bar|strip)\b/i,
  /\b(?:panel|box|plate|band|bar|strip)\s+behind\s+(?:the\s+)?(?:text|copy|headline|type)\b/i,
  /\bgradient\s+(?:layer|overlay|wash|fill|sheet)\b/i,
  /\bfilled?\s+(?:only\s+)?with\s+a\s+[^.]*\bgradient\b/i,
];

/** Sentences describing a flat slab over the art; the scene's own lighting should carry contrast. */
export function stripFlatOverlayLanguage(prompt: string): string {
  const text = String(prompt || '');
  if (!text.trim()) return '';

  const drops = (segment: string): boolean => {
    const candidate = segment.trim();
    if (!candidate) return false;
    // Keep our own negative instructions, which legitimately name these words.
    if (/^\s*(?:no|jangan|avoid|without)\b/i.test(candidate)) return false;
    if (/\bDILARANG\b/i.test(candidate)) return false;
    return FLAT_OVERLAY_PATTERNS.some(pattern => pattern.test(candidate));
  };

  // Work line by line so paragraph breaks survive: collapsing them would make
  // this non-idempotent, and applyDupoinImagePromptLocks may run twice.
  const cleanedLines = text.split('\n').map(line => {
    if (!line.trim()) return line;
    // Split on sentence boundaries so one bad clause does not take the line with it.
    const sentences = line.split(/(?<=[.!?])\s+/);
    const kept = sentences.filter(sentence => !drops(sentence));
    if (kept.length === sentences.length) return line;
    return kept.join(' ').replace(/[ \t]{2,}/g, ' ').trim();
  });

  return cleanedLines
    .filter((line, index) => line.trim() || (index > 0 && cleanedLines[index - 1].trim()))
    .join('\n')
    .trim();
}

/** Negatives appended to every generated prompt so the renderer never adds a slab back. */
const SCENE_INTEGRITY_NEGATIVES =
  'No overlay, no translucent panel or box behind the text, no gradient layer over the image, '
  + 'no opacity or transparency effects. Text contrast must come from the scene\'s own lighting and composition.';

/** Apply required Dupoin logo language plus the UI size/aspect dropdown. */
export function applyDupoinImagePromptLocks(
  prompt: string,
  aspectRatio: ImageAspectRatio = DEFAULT_IMAGE_ASPECT_RATIO,
): string {
  const cleaned = stripFlatOverlayLanguage(prompt);
  const guarded = cleaned.includes(SCENE_INTEGRITY_NEGATIVES)
    ? cleaned
    : `${cleaned}\n\n${SCENE_INTEGRITY_NEGATIVES}`;
  return withImageAspectPrompt(ensureOfficialDupoinLogo(guarded), aspectRatio);
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

Tulis satu paragraf mengalir yang mendeskripsikan satu adegan utuh — bukan daftar berpoin.

Format: kunci ${spec.size} ${spec.orientation} (${aspectRatio}). ${spec.promptSuffix}
Adegan: subjek konkret dengan kedalaman nyata, arah cahaya yang jelas, dan permukaan polos tempat teks bisa duduk secara alami.
Copy: Exact headline (≤6 kata), Subheadline (≤10), CTA (≤4) dalam tanda kutip, ditempatkan pada area adegan yang memang sudah bersih. Semua dalam safe zone 80px.
Warna: Dupoin Blue ${DUPOIN_BLUE_HEX} muncul sebagai cahaya atau objek nyata di dalam adegan — pantulan layar, rim light, garis chart, tombol CTA. Bukan sebagai lapisan.
Logo: JANGAN digambar. Sisakan sudut kanan-bawah tenang dan berkontras rendah; wordmark Dupoin asli ditempel otomatis setelah gambar jadi.

DILARANG: overlay, panel, box, scrim, banner, atau bar di belakang teks; nilai opacity/transparansi; gradient sebagai lapisan di atas gambar; hex code untuk background. Kalau teks kurang terbaca, atur ulang cahaya dan komposisi — jangan menambal dengan lapisan.
Negatif lain: no hashtags, no long captions, no fake claims/numbers not in the brief, no wrong teal, no logo/wordmark/monogram/symbol of any kind, no "Dupoin" lettering drawn into the art, no generic stock look.`;
}
