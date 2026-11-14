/**
 * Video Script v2 formats and storyboard scene shaping.
 * Safe to import from the browser. No database and no network.
 */

export const VIDEO_FORMATS = [
  'talking-head',
  'b-roll',
  'interview',
  'street-interview',
  'motion-graphic',
  'event-recap',
] as const;

export type VideoFormat = (typeof VIDEO_FORMATS)[number];

export const VIDEO_FORMAT_LABELS: Record<VideoFormat, string> = {
  'talking-head': 'Talking Head',
  'b-roll': 'B-Roll / Cinematic',
  interview: 'Interview / Podcast',
  'street-interview': 'Street Interview',
  'motion-graphic': 'Motion Graphic / Explainer',
  'event-recap': 'Event Recap / Documentation',
};

const STRUCTURE: Record<VideoFormat, string> = {
  'talking-head': 'Structure: to-camera lines spoken by one presenter, with short cutaways marked [CUTAWAY]. Write the spoken line, then the cutaway visual. Do not write a host/guest interview.',
  'b-roll': 'Structure: a shot list. Each beat is [SHOT], then [VO] and a [MUSIC] cue. No to-camera presenter monologue and no interview questions.',
  interview: 'Structure: a host/guest Q&A. Label every line HOST: or GUEST:. Include the question and the guest answer. Do not write a street vox pop.',
  'street-interview': 'Structure: vox-pop questions. For each beat write the question, the expected answer type (one-word, short opinion, or story), and the street visual. Label them QUESTION, EXPECTED ANSWER, and VISUAL. If the brief is a plan, a test, or hypothetical, write the questions as a simulation or a plan. Do not present the answers as a real interview that already happened.',
  'motion-graphic': 'Structure: scene-by-scene. Each scene has ON-SCREEN TEXT and VO. The on-screen text is what the graphic shows. Do not rely on a talking-head presenter.',
  'event-recap': 'Structure: a timeline of moments. Each beat has a time, the moment, and a shot list line. Label them TIME, MOMENT, and SHOT. If the brief is a plan, a test, or hypothetical, write a production plan or a simulation. Do not present it as documentation of a real event.',
};

export function parseVideoFormat(value: unknown): VideoFormat | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  return (VIDEO_FORMATS as readonly string[]).includes(key) ? key as VideoFormat : null;
}

export function videoFormatInstruction(format: VideoFormat): string {
  return `VIDEO FORMAT: ${VIDEO_FORMAT_LABELS[format]}\n${STRUCTURE[format]}`;
}

/** Pick a format from a Social Post handoff. An unknown brief stays Talking Head. */
export function suggestVideoFormat(input: { brief?: string; shots?: string[]; contentType?: string }): VideoFormat {
  const text = `${input.brief || ''} ${(input.shots || []).join(' ')}`.toLowerCase();
  if (/\bstreet interview\b|\bvox[- ]?pop\b/.test(text)) return 'street-interview';
  if (/\b(podcast|host and guest|guest interview)\b/.test(text)) return 'interview';
  if (/\b(motion graphic|explainer|animated)\b/.test(text)) return 'motion-graphic';
  if (/\b(event recap|awarding|documentation|recap)\b/.test(text)) return 'event-recap';
  if (/\b(cinematic|b-roll|b roll)\b/.test(text) || (input.shots || []).some(shot => shot.trim())) return 'b-roll';
  return 'talking-head';
}

export function storyboardAspectRatio(platform?: string): '9:16' | '16:9' {
  const value = (platform || '').toLowerCase();
  if (value === 'youtube') return '16:9';
  return '9:16';
}

export type StoryboardScene = {
  number: number;
  shot: string;
  onScreenText: string;
  vo: string;
  duration: string;
  imageUrl?: string;
  imageError?: string;
};

export const STORYBOARD_SCENE_MAX = 8;

export function normalizeStoryboardScenes(value: unknown): StoryboardScene[] {
  const source = Array.isArray(value) ? value : [];
  const scenes: StoryboardScene[] = [];
  for (const item of source) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const shot = text(raw.shot || raw.shotDescription || raw.visual).slice(0, 400);
    if (!shot) continue;
    scenes.push({
      number: scenes.length + 1,
      shot,
      onScreenText: text(raw.onScreenText || raw.on_screen_text).slice(0, 160),
      vo: text(raw.vo || raw.voiceover).slice(0, 500),
      duration: text(raw.duration).slice(0, 20) || '5s',
      ...(typeof raw.imageUrl === 'string' && raw.imageUrl.startsWith('/api/generated-images/') ? { imageUrl: raw.imageUrl } : {}),
      ...(typeof raw.imageError === 'string' && raw.imageError.trim() ? { imageError: raw.imageError.trim().slice(0, 240) } : {}),
    });
    if (scenes.length >= STORYBOARD_SCENE_MAX) break;
  }
  return scenes;
}

/** A script with timestamp blocks still becomes scenes when the model returns nothing usable. */
export function scenesFromScript(script: string): StoryboardScene[] {
  const chunks = script.split(/\n(?=\s*\[?\d{1,2}:\d{2})/).map(chunk => chunk.trim()).filter(Boolean);
  const source = chunks.length > 1 ? chunks : script.split(/\n{2,}/).map(chunk => chunk.trim()).filter(Boolean);
  return normalizeStoryboardScenes(source.slice(0, STORYBOARD_SCENE_MAX).map(chunk => {
    const vo = (chunk.match(/\[VO:([^\]]+)\]/i) || [])[1] || '';
    const visual = (chunk.match(/\[(?:VISUAL|SHOT):([^\]]+)\]/i) || [])[1] || chunk.split('\n')[0];
    return { shot: visual, vo, onScreenText: '', duration: '5s' };
  }));
}

export function buildStoryboardImagePrompt(scene: StoryboardScene, format: VideoFormat): string {
  const onScreen = scene.onScreenText ? `On-screen text, rendered in the scene itself: "${scene.onScreenText}".` : 'No superimposed caption slab.';
  return [
    `Storyboard frame ${scene.number} for a Dupoin Futures ${VIDEO_FORMAT_LABELS[format]} video.`,
    `Shot: ${scene.shot}`,
    onScreen,
    'Photoreal production still. No competitor logos, no invented prices, no guaranteed-profit claims. Do not draw a license number, an award badge, a ranking, or a most-trusted mark.',
  ].join('\n');
}

export function withStoryboard(
  outputData: unknown,
  storyboard: { format: VideoFormat; scenes: StoryboardScene[] },
): Record<string, unknown> {
  const current = outputData && typeof outputData === 'object' && !Array.isArray(outputData)
    ? { ...(outputData as Record<string, unknown>) }
    : {};
  return { ...current, format: storyboard.format, storyboard };
}

export function readStoredStoryboard(value: unknown): { format: VideoFormat; scenes: StoryboardScene[] } | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { format?: unknown; scenes?: unknown };
  const format = parseVideoFormat(raw.format);
  if (!format) return null;
  return { format, scenes: normalizeStoryboardScenes(raw.scenes) };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
