/** Browser speech input for the Dupoin AI Research composer. No server STT. */

export const VOICE_LANG_ID = 'id-ID';
export const VOICE_LANG_EN = 'en-US';

export function voiceUnsupportedMessage(): string {
  return 'Input suara tidak tersedia di browser ini. Ketik pertanyaan, atau gunakan Chrome, Edge, atau Safari.';
}

export function voiceDeniedMessage(): string {
  return 'Mikrofon ditolak. Izinkan akses mic di browser, atau ketik pertanyaan.';
}

export function voiceFallbackMessage(): string {
  return 'Bahasa id-ID tidak didukung di browser ini. Beralih ke English.';
}

export function voiceMissedMessage(): string {
  return 'Suara tidak tertangkap. Coba lagi, atau ketik pertanyaan.';
}

export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export type SpeechRecognitionResultEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

/** Web Speech API constructor, including the Safari webkit prefix. */
export function getSpeechRecognitionConstructor(scope: {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
} | null | undefined): SpeechRecognitionConstructor | null {
  if (!scope) return null;
  const ctor = scope.SpeechRecognition || scope.webkitSpeechRecognition;
  return typeof ctor === 'function' ? ctor : null;
}

/**
 * Start on id-ID. If the engine reports the language is unsupported, switch to English once.
 * Any other error ends the session.
 */
export function nextSpeechLang(current: string, error?: string): string | null {
  if (error === 'language-not-supported' && current !== VOICE_LANG_EN) return VOICE_LANG_EN;
  return null;
}

/** Append a final transcript without eating a trailing space the user already typed. */
export function appendVoiceTranscript(current: string, transcript: string): string {
  const spoken = transcript.replace(/\s+/g, ' ').trim();
  if (!spoken) return current;
  if (!current) return spoken;
  return `${current}${/\s$/.test(current) ? '' : ' '}${spoken}`;
}

/** Join only final result chunks. Interim text is for the listening indicator. */
export function finalTranscript(event: SpeechRecognitionResultEventLike): string {
  let text = '';
  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    if (result?.isFinal) text += result[0]?.transcript || '';
  }
  return text;
}
