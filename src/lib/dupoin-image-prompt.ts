import {
  DEFAULT_IMAGE_ASPECT_RATIO,
  getImageGenerationSpec,
  stripImageAspectPrompt,
  withImageAspectPrompt,
  type ImageAspectRatio,
} from '@/lib/image-aspect-ratio';
import { chromeClearancePercents } from '@/lib/dupoin-ig-chrome';

/** Official Dupoin Brand Guidelines 2026 primary (Hex resmi). */
export const DUPOIN_BLUE_HEX = '#2EB5C4';
export const DUPOIN_BLUE_RGB = '46,181,196';

/**
 * Required chrome line for AI image prompts.
 *
 * The model must NOT draw the Dupoin wordmark, the CNN 2025 badge, or the
 * regulatory footer. Those pixels are composited from
 * public/brand/dupoin-ig-chrome.png by src/lib/dupoin-ig-chrome.ts.
 * Text-to-image invents logotypes and legal lines; the prompt only reserves
 * the top and bottom bands and describes the middle scene.
 */
export const DUPOIN_LOGO_REQUIRED_LINE =
  'Draw no logo, no wordmark, no CNN badge, no laurel, no regulatory footer, and no "Dupoin" lettering'

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
- Default feed Instagram: spotlight cyan dari atas, atau rim light Dupoin Blue di tepi subjek. Sumber lain (layar, lampu studio) boleh selama adegan tetap gelap dan moody
- Bayangan lembut, highlight terkendali. Hindari pencahayaan datar dan kantor terang generik

COPY DI GAMBAR:
- Headline ≤6 kata, subheadline ≤10, CTA ≤4 — tulis persis dalam tanda kutip
- Headline utama: sans tebal berwarna Dupoin Blue ${DUPOIN_BLUE_HEX}. Baris kedua: sans putih
- CTA adalah pill outline putih, pendek, duduk tepat di atas pita footer
- Maksimal 2 jenis huruf: display tebal + sans bersih
- Tempatkan pada area tengah yang secara alami gelap: dinding, langit, area out-of-focus
- Semua teks di zona tengah, minimal 80px dari tepi kiri dan kanan, di luar pita header dan footer

SUBJEK — konkret, bukan abstrak:
- Trader Indonesia usia 25-45 dengan ekspresi dan postur spesifik
- Detail nyata: tekstur kemeja, cangkir kopi, layar chart, tepi meja kayu, tangan di mouse
- JANGAN tulis "suasana profesional" atau "nuansa modern" — itu tidak bisa digambar

CHROME — JANGAN DIGAMBAR:
- Wordmark Dupoin, badge CNN 2025, dan footer regulasi putih ditempel otomatis dari aset setelah gambar jadi
- Jangan gambar logo, wordmark, monogram, laurel, badge, atau footer regulasi; jangan tulis kata "Dupoin" di dalam art
- Pita atas: kosong dari teks, wajah, dan logo. Background dan tekstur boleh menyambung di belakang lockup
- Pita bawah: kosong. CTA pill duduk tepat di atasnya, bukan di dalamnya
- Gaya feed Instagram Dupoin: background gelap/moody, Dupoin Blue sebagai spotlight atau rim light, bukan kantor terang generik

FORMAT:
- Kunci ukuran/rasio dari brief. Default social still 1080x1350 potret atau 1080x1080 persegi bila tidak disebut

URUTAN MENULIS PROMPT:
1. Format + jenis creative
2. Adegan utama — subjek, ruang, kedalaman
3. Cahaya — arah, sumber, kualitas
4. Copy persis + di permukaan mana teks duduk
5. Aksen Dupoin Blue sebagai objek/cahaya nyata
6. Pita atas dan pita bawah kosong untuk chrome yang ditempel kemudian
7. Kualitas — lensa, depth of field, resolusi
8. Negatif

CONTOH — tiru pendekatannya, jangan salin isinya:
"Editorial photograph for an Indonesian financial brand, 1080x1350 portrait, Dupoin Instagram still.
A trader in his early thirties sits in a dim studio, turned three-quarters toward camera, one hand resting on a phone that shows a trading chart. The wall behind him is a dark textured grid and falls gently out of focus. A single cyan spotlight drops from above, catching the rim of his shoulder and the edge of the phone in Dupoin Blue ${DUPOIN_BLUE_HEX}. The rest of the room stays deep and quiet.
Headline 'JAGA MODALMU' is set in heavy Dupoin Blue sans in the lower middle, where the background is already dark.
Subheadline 'Risiko duluan, baru entry' sits directly beneath in white.
A white outlined pill reads 'Swipe left →' just above the empty bottom band.
The top band is only the continuing dark wall — no logo, no badge, no type. The bottom band is empty background.
Shot on 50mm at f/2, shallow depth of field, moody contrast, fine grain, 8K.
No overlay, no panel or box behind the text, no gradient layer, no opacity effects, no logo or wordmark, no CNN badge, no laurel, no regulatory footer, no 'Dupoin' lettering in the art, no hashtags, no stock-photo look."

Tulis prompt langsung tanpa pembuka. Satu paragraf mengalir, bukan daftar berpoin.`;

export interface SocialPostImagePromptInput {
  brief: string;
  platform?: string;
  targetAudience?: string;
  hook: string;
  caption: string;
  aspectRatio?: ImageAspectRatio;
}

const CHROME_LOCK_RE = /\n\nLeave the top \d+% of the frame empty of type, faces, and logos \(background and texture may continue\) for the composited Dupoin header lockup, and the bottom \d+% empty for the composited white regulatory footer\. Draw no logo, no wordmark, no CNN badge, no laurel, no regulatory footer, and no "Dupoin" lettering anywhere in the image\. Primary accent Dupoin Blue #2EB5C4 as real light inside the scene\./g;

/** Drop a previously baked chrome reservation so a new aspect ratio can replace the percentages. */
export function stripDupoinChromeLock(prompt: string): string {
  return String(prompt || '').replace(CHROME_LOCK_RE, '');
}

/** English reservation appended to every image prompt. Percentages follow the selected canvas. */
export function dupoinChromeLockLine(aspectRatio: ImageAspectRatio): string {
  const spec = getImageGenerationSpec(aspectRatio);
  const [width, height] = spec.size.split('x').map(Number);
  const { headerPercent, footerPercent } = chromeClearancePercents(width, height);
  return `Leave the top ${headerPercent}% of the frame empty of type, faces, and logos (background and texture may continue) for the composited Dupoin header lockup, and the bottom ${footerPercent}% empty for the composited white regulatory footer. ${DUPOIN_LOGO_REQUIRED_LINE} anywhere in the image. Primary accent Dupoin Blue ${DUPOIN_BLUE_HEX} as real light inside the scene.`;
}

/** Guarantee the Instagram chrome reservation is present, replacing any stale percentages. */
export function ensureOfficialDupoinLogo(
  prompt: string,
  aspectRatio: ImageAspectRatio = DEFAULT_IMAGE_ASPECT_RATIO,
): string {
  const trimmed = stripDupoinChromeLock(prompt).trim();
  const logoLine = dupoinChromeLockLine(aspectRatio);
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

/** Apply the Instagram chrome reservation plus the UI size/aspect dropdown. */
export function applyDupoinImagePromptLocks(
  prompt: string,
  aspectRatio: ImageAspectRatio = DEFAULT_IMAGE_ASPECT_RATIO,
): string {
  const cleaned = stripDupoinChromeLock(stripImageAspectPrompt(stripFlatOverlayLanguage(prompt))).trim();
  const guarded = cleaned.includes(SCENE_INTEGRITY_NEGATIVES)
    ? cleaned
    : `${cleaned}\n\n${SCENE_INTEGRITY_NEGATIVES}`.trim();
  return withImageAspectPrompt(ensureOfficialDupoinLogo(guarded, aspectRatio), aspectRatio);
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
Adegan: subjek konkret dengan kedalaman nyata, background gelap/moody, satu sumber cahaya cyan (spotlight atau rim light), dan permukaan gelap tempat teks bisa duduk secara alami di zona tengah.
Copy: Exact headline (≤6 kata) dalam Dupoin Blue sebagai sans tebal, Subheadline (≤10) putih, CTA (≤4) di dalam pill outline putih tepat di atas pita bawah. Semua dalam safe zone 80px dari tepi kiri dan kanan.
Warna: Dupoin Blue ${DUPOIN_BLUE_HEX} muncul sebagai cahaya nyata di dalam adegan — spotlight, rim light, garis chart — dan sebagai warna headline. Bukan sebagai lapisan.
Chrome: JANGAN digambar. Wordmark Dupoin, badge CNN 2025, dan footer regulasi putih ditempel otomatis setelah gambar jadi. Sisakan pita atas kosong dari teks, wajah, dan logo (background boleh menyambung). Sisakan pita bawah kosong.

DILARANG: overlay, panel, box, scrim, banner, atau bar di belakang teks; nilai opacity/transparansi; gradient sebagai lapisan di atas gambar; hex code untuk background. Kalau teks kurang terbaca, atur ulang cahaya dan komposisi — jangan menambal dengan lapisan.
Negatif lain: no hashtags, no long captions, no fake claims/numbers not in the brief, no wrong teal, no logo, no wordmark, no CNN badge, no laurel, no regulatory footer, no "Dupoin" lettering drawn into the art, no generic stock look.`;
}
