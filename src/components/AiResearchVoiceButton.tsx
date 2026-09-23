'use client';

import { useEffect, useRef, useState } from 'react';
import {
  VOICE_LANG_EN,
  VOICE_LANG_ID,
  finalTranscript,
  getSpeechRecognitionConstructor,
  nextSpeechLang,
  voiceDeniedMessage,
  voiceFallbackMessage,
  voiceMissedMessage,
  voiceUnsupportedMessage,
  type SpeechRecognitionLike,
} from '@/lib/ai-research-voice';

const LISTENING_STATUS = 'Mendengarkan… bicara sekarang. Klik mic untuk berhenti.';

export function AiResearchVoiceButton({
  disabled,
  onTranscript,
  onStatus,
}: {
  disabled?: boolean;
  onTranscript: (text: string) => void;
  onStatus?: (message: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const onStatusRef = useRef(onStatus);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onStatusRef.current = onStatus;
  }, [onTranscript, onStatus]);

  const publish = (message: string) => {
    onStatusRef.current?.(message);
  };

  const stop = () => {
    const current = recognitionRef.current;
    recognitionRef.current = null;
    try {
      current?.stop();
    } catch {
      // Already stopped.
    }
    setListening(false);
  };

  useEffect(() => {
    if (!disabled) return;
    const current = recognitionRef.current;
    recognitionRef.current = null;
    try {
      current?.stop();
    } catch {
      // Already stopped.
    }
    // The mic is an external session. Drop the listening flag when send disables the composer.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external SpeechRecognition session
    setListening(false);
    onStatusRef.current?.('');
  }, [disabled]);

  useEffect(() => {
    return () => {
      const current = recognitionRef.current;
      recognitionRef.current = null;
      try {
        current?.stop();
      } catch {
        // Already stopped.
      }
    };
  }, []);

  const start = (lang: string) => {
    const scope = window as Window & {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = getSpeechRecognitionConstructor(scope);
    if (!Ctor) {
      setListening(false);
      publish(voiceUnsupportedMessage());
      return;
    }

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = event => {
      const spoken = finalTranscript(event);
      if (spoken.trim()) onTranscriptRef.current(spoken);
    };
    recognition.onerror = event => {
      const next = nextSpeechLang(lang, event.error);
      if (next) {
        try {
          recognition.stop();
        } catch {
          // The replacement session owns the mic.
        }
        start(next);
        return;
      }
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      setListening(false);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        publish(voiceDeniedMessage());
      } else if (event.error === 'aborted' || event.error === 'no-speech') {
        publish('');
      } else {
        publish(voiceMissedMessage());
      }
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      setListening(false);
      publish('');
    };

    recognitionRef.current = recognition;
    setListening(true);
    publish(lang === VOICE_LANG_EN ? `${voiceFallbackMessage()} ${LISTENING_STATUS}` : LISTENING_STATUS);
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setListening(false);
      publish(voiceUnsupportedMessage());
    }
  };

  const toggle = () => {
    if (disabled) return;
    if (listening) {
      stop();
      publish('');
      return;
    }
    start(VOICE_LANG_ID);
  };

  return (
    <button
      type="button"
      data-testid="ai-research-voice"
      data-listening={listening ? 'true' : 'false'}
      aria-pressed={listening}
      aria-label={listening ? 'Berhenti mendengarkan' : 'Input suara'}
      title={listening ? 'Mendengarkan… klik untuk berhenti' : 'Input suara (Chrome, Edge, Safari — id-ID, atau English)'}
      disabled={disabled}
      onClick={toggle}
      className={`p-2 rounded-xl transition-colors flex-shrink-0 disabled:opacity-30 ${
        listening
          ? 'bg-red-500/20 text-red-200'
          : 'text-[var(--mos-text-muted)] hover:text-[var(--mos-text)]'
      }`}
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
      </svg>
    </button>
  );
}
