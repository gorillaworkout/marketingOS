import {
  DEFAULT_IMAGE_ASPECT_RATIO,
  getImageGenerationSpec,
  stripImageAspectPrompt,
  withImageAspectPrompt,
  type ImageAspectRatio,
} from '@/lib/image-aspect-ratio';
import { BRAND_FACT_RULES } from '@/lib/brand-fact-guard';
import {
  DUPOIN_IG_ACADEMY_HEADER_BAND_PX,
  DUPOIN_IG_FOOTER_BAND_PX,
  chromeClearancePercents,
  swipePromptClearancePercent,
} from '@/lib/dupoin-ig-chrome-layout';

/** Official Dupoin Brand Guidelines 2026 primary (Hex resmi). */
export const DUPOIN_BLUE_HEX = '#2EB5C4';
export const DUPOIN_BLUE_RGB = '46,181,196';

/**
 * Required no-logo line for AI image prompts.
 *
 * The real logo (Dupoin wordmark + CNN badge, or the Dupoin Academy logo), the
 * regulatory footer and the optional Swipe left pill are composited from
 * public/brand/* by src/lib/dupoin-ig-chrome.ts after the image comes back.
 *
 * Model-facing text must never NAME the logo, the brand, or the pill text:
 * text-to-image models (Gemini Flash Image especially) tend to render any
 * name they read, even inside a "do not draw" sentence. That is how a garbled
 * "DUPOIN ACADEMY" ended up under the real composited logo. The prompt only
 * asks for plain empty bands and forbids logos/brand text generically.
 */
export const DUPOIN_LOGO_REQUIRED_LINE =
  'No logos, no brand names, no wordmarks, no monograms, no badges, no watermarks and no signature marks'

/**
 * Style lock baked onto every Social Post / Generate Image prompt.
 * Wording is stable so re-applying the lock does not stack copies.
 * It names no brand and no "Swipe left" text: the model draws only the
 * brief's own CTA, and the Swipe left pill is composited when it is asked for.
 */
export const DUPOIN_IG_STYLE_LOCK =
  `Visual style: dark navy or black field with atmospheric glow in cyan ${DUPOIN_BLUE_HEX}. `
  + `Large bold sans headlines, with key promo words in cyan ${DUPOIN_BLUE_HEX} and supporting copy in white; alignment may follow the scene. `
  + `If the brief gives a short CTA, set it in one filled cyan ${DUPOIN_BLUE_HEX} pill with white lettering just above the bottom band; if it gives none, draw no button. `
  + 'Draw no other UI text, page indicators, arrows or navigation hints. '
  + 'Subject may be a person, a physical award, or a laptop with charts.';

/**
 * Style lock used only when the fixed Swipe left pill will be composited.
 * The model must not paint a second button into the reserved band.
 */
export const DUPOIN_IG_STYLE_LOCK_SWIPE_COMPOSITED =
  `Visual style: dark navy or black field with atmospheric glow in cyan ${DUPOIN_BLUE_HEX}. `
  + `Large bold sans headlines, with key promo words in cyan ${DUPOIN_BLUE_HEX} and supporting copy in white; alignment may follow the scene. `
  + 'Draw no button, pill, arrow, page indicator or navigation hint anywhere; the area just above the bottom band must stay empty of type. '
  + 'Subject may be a person, a physical award, or a laptop with charts.';

/** Pre-fix style locks. They named "Dupoin" and "Swipe left"; kept only so stored prompts are stripped. */
const LEGACY_STYLE_LOCKS = [
  `Dupoin Instagram shell: dark navy or black field with atmospheric glow in Dupoin Blue ${DUPOIN_BLUE_HEX}. `
  + 'Large bold sans headlines, with key promo words in Dupoin Blue and supporting copy in white; alignment may follow the scene. '
  + 'CTA is one filled Dupoin Blue pill with white lettering, placed just above the footer band. '
  + 'When the brief is a carousel or story, the pill reads "Swipe left →"; otherwise use the brief\'s own short CTA inside that same filled pill. '
  + 'Subject may be a person, a physical award, or a laptop with charts.',
  `Dupoin Instagram shell: dark navy or black field with atmospheric glow in Dupoin Blue ${DUPOIN_BLUE_HEX}. `
  + 'Large bold sans headlines, with key promo words in Dupoin Blue and supporting copy in white; alignment may follow the scene. '
  + 'Do not draw a CTA pill, swipe button, arrow, or the words "Swipe left"; that pill is composited above the footer and the area just above the footer must stay empty of type. '
  + 'Subject may be a person, a physical award, or a laptop with charts.',
];

/** @deprecated Use DUPOIN_LOGO_REQUIRED_LINE — image prompts must include the official mark. */
export const DUPOIN_LOGO_IN_PROMPT_LINE = DUPOIN_LOGO_REQUIRED_LINE;

/**
 * Social Post image-prompt / art-director system prompt.
 * Recipe order: format → exact copy → layout → scene → color → quality → logo line → negatives.
 */
export const IMAGE_PROMPT_SYSTEM = `${BRAND_FACT_RULES}

Kamu art director senior Dupoin Futures Indonesia. Tulis satu prompt image generation untuk creative iklan yang layak tayang di feed brand finansial premium.

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
- Field dominan navy atau hitam. Dupoin Blue ${DUPOIN_BLUE_HEX} hadir sebagai cahaya nyata di dalam adegan: glow atmosfer, spotlight, rim light, pantulan layar, garis chart
- Kata promo kunci di headline memakai Dupoin Blue yang sama. Copy pendukung putih
- Pill CTA terisi Dupoin Blue dengan huruf putih. Bukan outline putih
- Satu warna dominan (navy/hitam), satu aksen. Jangan lebih

CAHAYA:
- Satu arah cahaya utama yang jelas + fill lembut
- Default feed Instagram: spotlight atau glow cyan di atas field navy/hitam, atau rim light Dupoin Blue di tepi subjek, award, atau laptop
- Bayangan lembut, highlight terkendali. Hindari pencahayaan datar dan kantor terang generik

COPY DI GAMBAR:
- Headline ≤6 kata, subheadline ≤10, CTA ≤4 — tulis persis dalam tanda kutip
- Headline besar, sans tebal. Kata promo kunci berwarna Dupoin Blue ${DUPOIN_BLUE_HEX}; copy pendukung putih. Alignment boleh kiri atau di tengah-bawah, mengikuti adegan
- CTA adalah satu pill terisi Dupoin Blue, huruf putih, pendek, duduk tepat di atas pita footer
- Kalau brief-nya carousel atau story, teks pill "Swipe left →". Selain itu pakai CTA dari brief di dalam pill yang sama
- Maksimal 2 jenis huruf: display tebal + sans bersih
- Tempatkan pada area tengah yang secara alami gelap
- Semua teks di zona tengah, minimal 80px dari tepi kiri dan kanan, di luar pita header dan footer

SUBJEK — konkret, bukan abstrak:
- Pilih yang paling konkret untuk brief: orang, trofi atau award fisik, atau laptop dengan chart
- Kalau orang: Trader Indonesia usia 25-45 dengan ekspresi dan postur spesifik
- Detail nyata: tekstur kemeja, layar chart, tepi laptop, logam award, tangan di mouse
- JANGAN tulis "suasana profesional" atau "nuansa modern" — itu tidak bisa digambar

CHROME — JANGAN DIGAMBAR:
- Jangan gambar badge CNN, laurel, atau footer regulasi. The official header lockup is composited later from the brand asset
- Jangan gambar logo, wordmark, monogram, laurel, badge, atau footer regulasi; jangan tulis kata "Dupoin" di dalam art
- Pita atas: kosong dari teks, wajah, dan logo. Background navy/hitam dan glow boleh menyambung di belakang lockup
- Pita bawah: kosong. Pill CTA duduk tepat di atasnya, bukan di dalamnya
- Chrome ini menempel di setiap rasio. Yang berubah hanya subjek, alignment headline, imbangan warna kata, teks CTA, dan imagery

FORMAT:
- Kunci ukuran/rasio dari brief. Feed publik sering 1080x1080 persegi; template chrome Bayu 1080x1350 potret. Jangan mengganti rasio yang sudah dikunci

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
A trader in his early thirties sits against a dark navy field, turned three-quarters toward camera, one hand resting on a laptop that shows a trading chart. The space behind him falls gently out of focus. A cyan atmospheric glow drops from above, catching the rim of his shoulder and the edge of the laptop in Dupoin Blue ${DUPOIN_BLUE_HEX}. The rest of the room stays black and quiet.
Headline 'JAGA MODALMU' is set in heavy Dupoin Blue sans, with the supporting line 'Rencana dulu' in white, on the dark field where the surface is already quiet.
Subheadline 'Baru kemudian entry' sits beneath in white.
A filled Dupoin Blue pill with white lettering reads 'Pelajari' just above the empty bottom band. A carousel or story uses that same pill with the words 'Swipe left →'.
The top band is only the continuing navy wall — no logo, no badge, no type. The bottom band is empty background.
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

/**
 * Every chrome reservation this module writes: optional "Leave …" sentences,
 * then the fixed no-logo sentence and the Dupoin Blue line. Covers the
 * original header+footer line and the Generate Image variants (no logo, no
 * footer), so re-applying the locks replaces rather than stacks.
 */
const TAIL_ALTERNATIVES = '(?:Draw no logo, no wordmark, no CNN badge, no laurel, no regulatory footer, and no "Dupoin" lettering anywhere in the image\\. Primary accent Dupoin Blue #2EB5C4 as real light inside the scene\\.|No logos, no brand names, no wordmarks, no monograms, no badges, no watermarks and no signature marks anywhere in the image\\. Primary accent colour #2EB5C4 \\(cyan\\) as real light inside the scene\\.)';
const CHROME_LOCK_RE = new RegExp(`\\n\\n(?:(?:Leave|Keep|Also keep) [^\\n]*? )?${TAIL_ALTERNATIVES}`, 'g');
const CHROME_LOCK_ONLY_RE = new RegExp(`^(?:(?:Leave|Keep|Also keep) [^\\n]*? )?${TAIL_ALTERNATIVES}$`);

const STYLE_LOCKS = [DUPOIN_IG_STYLE_LOCK, DUPOIN_IG_STYLE_LOCK_SWIPE_COMPOSITED, ...LEGACY_STYLE_LOCKS];

/** Drop a previously baked Instagram style lock so re-applying it cannot stack. */
export function stripDupoinStyleLock(prompt: string): string {
  let text = String(prompt || '');
  for (const lock of STYLE_LOCKS) {
    text = text.split(`\n\n${lock}`).join('');
  }
  return text;
}

/** Drop a previously baked chrome reservation so a new aspect ratio can replace the percentages. */
export function stripDupoinChromeLock(prompt: string): string {
  const text = String(prompt || '').replace(CHROME_LOCK_RE, '');
  return CHROME_LOCK_ONLY_RE.test(text.trim()) ? '' : text;
}

export type DupoinLogoChoice = 'dupoin' | 'academy' | 'none';

export interface DupoinImagePromptLockOptions {
  /** Reserve the composited Swipe left pill and tell the model not to draw it. */
  includeSwipeLeft?: boolean;
  /** Reserve the taller centered Dupoin Academy logo instead of the Dupoin wordmark. */
  dupoinAcademy?: boolean;
  /** Generate Image logo choice. Wins over dupoinAcademy when set. "none" reserves no header band. */
  logo?: DupoinLogoChoice;
  /** Regulatory footer + risk warning. Default true. False reserves no footer band. */
  footer?: boolean;
  /** Dupoin Instagram style lock (navy field, Dupoin Blue). Default true. Off lets a visual reference set the look. */
  brandStyle?: boolean;
}

/** Normalise the logo choice from the new `logo` field or the older `dupoinAcademy` flag. */
export function resolveDupoinLogoChoice(options?: { logo?: unknown; dupoinAcademy?: unknown } | null): DupoinLogoChoice {
  const logo = options?.logo;
  if (logo === 'dupoin' || logo === 'academy' || logo === 'none') return logo;
  return options?.dupoinAcademy === true ? 'academy' : 'dupoin';
}

/** English reservation appended to every image prompt. Percentages follow the selected canvas. */
export function dupoinChromeLockLine(
  aspectRatio: ImageAspectRatio,
  options?: DupoinImagePromptLockOptions,
): string {
  const spec = getImageGenerationSpec(aspectRatio);
  const [width, height] = spec.size.split('x').map(Number);
  const logo = resolveDupoinLogoChoice(options);
  const footer = options?.footer !== false;
  const academy = logo === 'academy';
  const { headerPercent, footerPercent } = chromeClearancePercents(
    width,
    height,
    academy ? { headerPx: DUPOIN_IG_ACADEMY_HEADER_BAND_PX, footerPx: DUPOIN_IG_FOOTER_BAND_PX } : undefined,
  );
  const tail = `${DUPOIN_LOGO_REQUIRED_LINE} anywhere in the image. Primary accent colour ${DUPOIN_BLUE_HEX} (cyan) as real light inside the scene.`;
  // Neutral wording only: never name the logo, the brand, or the pill text
  // here, or the model paints them (see DUPOIN_LOGO_REQUIRED_LINE). The
  // Academy choice only changes how tall the clean top band is.
  const sentences: string[] = [];
  if (logo !== 'none') {
    sentences.push(`Keep the top ${headerPercent}% of the frame as clean, empty background (texture and lighting may continue) with no text, letters, faces, logos, icons or graphics in it.`);
  }
  if (footer) {
    sentences.push(`Keep the bottom ${footerPercent}% of the frame as clean, empty background with no text, letters, logos or graphics in it.`);
  }
  if (options?.includeSwipeLeft) {
    const where = footer ? 'directly above that bottom band' : 'just above the bottom edge';
    sentences.push(`Also keep about ${swipePromptClearancePercent(width, height)}% ${where} empty, with no text, buttons, pills or arrows.`);
  }
  if (sentences.length === 0) return tail;
  // Every reservation opens with "Keep …", which CHROME_LOCK_RE relies on.
  return `${sentences.join(' ')} ${tail}`;
}

/** Guarantee the Instagram chrome reservation is present, replacing any stale percentages. */
export function ensureOfficialDupoinLogo(
  prompt: string,
  aspectRatio: ImageAspectRatio = DEFAULT_IMAGE_ASPECT_RATIO,
  options?: DupoinImagePromptLockOptions,
): string {
  const trimmed = stripDupoinChromeLock(prompt).trim();
  const logoLine = dupoinChromeLockLine(aspectRatio, options);
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

const LOGO_WORD_RE = /\b(?:logos?|logotypes?|wordmarks?|lockups?|watermarks?|monograms?)\b/i;
const NEGATION_RE = /\b(?:no|not|never|without|avoid|jangan|tanpa|free of|don't|do not)\b/i;
/** Quoted copy the user wants rendered: "…", “…”, or a 'single-quoted' phrase. */
const QUOTED_RE = /("[^"\n]*"|“[^”\n]*”|(?<=^|[\s(:])'[^'\n]+'(?=$|[\s.,;:!?)]))/;
const BRAND_NAME_RE = /\bDupoin(?:\s+(?:Futures|Academy))?(?:\s+Indonesia)?\b/g;

/**
 * Keep brand drawing out of the model's hands. The real logo is composited,
 * so a sentence asking the model to draw a logo/wordmark is dropped, and the
 * brand name outside quoted copy is neutralised ("Dupoin Blue" → "cyan",
 * "Dupoin Academy" → "the brand"). Quoted headline/CTA copy is left as typed.
 * Negative sentences ("no logos") are kept. Idempotent.
 */
export function stripBrandDrawingLanguage(prompt: string): string {
  const text = String(prompt || '');
  if (!text.trim()) return '';
  const lines = text.split('\n').map(line => {
    if (!line.trim()) return line;
    const sentences = line.split(/(?<=[.!?])\s+/);
    const kept = sentences.filter(sentence => !(LOGO_WORD_RE.test(sentence) && !NEGATION_RE.test(sentence)));
    const joined = kept.length === sentences.length ? line : kept.join(' ').replace(/[ \t]{2,}/g, ' ').trim();
    return joined
      .split(QUOTED_RE)
      .map((part, index) => (index % 2 === 1
        ? part
        : part.replace(/\bDupoin Blue\b/g, 'cyan').replace(BRAND_NAME_RE, 'the brand')))
      .join('');
  });
  return lines
    .filter((line, index) => line.trim() || (index > 0 && lines[index - 1].trim()))
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
  options?: DupoinImagePromptLockOptions,
): string {
  const includeSwipeLeft = options?.includeSwipeLeft === true;
  const logo = resolveDupoinLogoChoice(options);
  const dupoinAcademy = logo === 'academy';
  const footer = options?.footer !== false;
  const brandStyle = options?.brandStyle !== false;
  const cleaned = stripDupoinStyleLock(
    stripDupoinChromeLock(stripImageAspectPrompt(stripFlatOverlayLanguage(prompt))),
  );
  const debranded = stripBrandDrawingLanguage(cleaned).trim();
  const guarded = debranded.includes(SCENE_INTEGRITY_NEGATIVES)
    ? debranded
    : `${debranded}\n\n${SCENE_INTEGRITY_NEGATIVES}`.trim();
  const styleLock = includeSwipeLeft ? DUPOIN_IG_STYLE_LOCK_SWIPE_COMPOSITED : DUPOIN_IG_STYLE_LOCK;
  const withStyle = !brandStyle || guarded.includes(styleLock)
    ? guarded
    : `${guarded}\n\n${styleLock}`.trim();
  return withImageAspectPrompt(
    ensureOfficialDupoinLogo(withStyle, aspectRatio, { includeSwipeLeft, dupoinAcademy, logo, footer }),
    aspectRatio,
  );
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

Format: kunci ${spec.size} ${spec.orientation} (${aspectRatio}). ${spec.promptSuffix} Feed publik sering persegi 1080x1080; template chrome 1080x1350 potret. Jangan mengganti rasio ini. Chrome tetap menempel.
Adegan: subjek konkret dengan kedalaman nyata di field navy/hitam, glow atmosfer Dupoin Blue, dan permukaan gelap tempat teks bisa duduk di zona tengah. Subjek boleh orang, award fisik, atau laptop dengan chart.
Copy: Exact headline (≤6 kata) sans tebal — kata promo kunci dalam Dupoin Blue, copy pendukung putih. Subheadline (≤10) putih. CTA (≤4) di dalam pill terisi Dupoin Blue dengan huruf putih, tepat di atas pita bawah. Kalau brief carousel atau story, teks pill "Swipe left →"; selain itu pakai CTA brief di pill yang sama. Semua dalam safe zone 80px dari tepi kiri dan kanan.
Warna: background navy/hitam. Dupoin Blue ${DUPOIN_BLUE_HEX} muncul sebagai glow atmosfer, kata promo kunci, dan isi pill. Bukan sebagai lapisan.
Chrome: JANGAN digambar. Wordmark Dupoin kiri atas, badge CNN 2025, dan footer regulasi putih tipis ditempel otomatis setelah gambar jadi. Sisakan pita atas kosong dari teks, wajah, dan logo (background boleh menyambung). Sisakan pita bawah kosong.

DILARANG: overlay, panel, box, scrim, banner, atau bar di belakang teks; nilai opacity/transparansi; gradient sebagai lapisan di atas gambar; hex code untuk background. Kalau teks kurang terbaca, atur ulang cahaya dan komposisi — jangan menambal dengan lapisan.
Negatif lain: no hashtags, no long captions, no fake claims/numbers not in the brief, no wrong teal, no logo, no wordmark, no CNN badge, no laurel, no regulatory footer, no "Dupoin" lettering drawn into the art, no generic stock look.`;
}

/**
 * Remove everything applyDupoinImagePromptLocks adds (aspect line, chrome
 * reservation, style lock, scene negatives) so a stored prompt can be edited
 * as plain scene text on Generate Image. The server applies the locks again
 * from the chosen options.
 */
export function stripDupoinImagePromptLocks(prompt: string): string {
  const withoutLocks = stripDupoinStyleLock(stripDupoinChromeLock(stripImageAspectPrompt(String(prompt || ''))));
  return withoutLocks
    .split(`\n\n${SCENE_INTEGRITY_NEGATIVES}`).join('')
    .split(SCENE_INTEGRITY_NEGATIVES).join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
