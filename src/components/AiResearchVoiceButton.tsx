'use client';

import { useEffect, useRef, useState } from 'react';
import {
  VOICE_LANG_EN,
  VOICE_LANG_ID,
  finalTranscript,
  getSpeechRecognitionConstructor,
  nextSpeechLang,
  voiceDeniedMessage,
  voiceListeningStatus,
  voiceMissedMessage,
  voiceUnsupportedMessage,
  type SpeechRecognitionLike,
} from '@/lib/ai-research-voice';

export function AiResearchVoiceButton({
  disabled,
  onTranscript,
  onStatus,
}: {
  disabled?: boolean;
  onTranscript: (text: string) => void;
  onStatus?: (message: string, tone?: 'listening' | 'error') => void;
}) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const onStatusRef = useRef(onStatus);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onStatusRef.current = onStatus;
  }, [onTranscript, onStatus]);

  const publish = (message: string, tone: 'listening' | 'error' = 'error') => {
    onStatusRef.current?.(message, tone);
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
    publish(voiceListeningStatus(lang === VOICE_LANG_EN), 'listening');
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
    <>
      <button
        type="button"
        data-testid="ai-research-voice"
        data-listening={listening ? 'true' : 'false'}
        aria-pressed={listening}
        aria-label={listening ? 'Stop listening' : 'Voice input'}
        title={listening ? 'Listening… tap mic to stop' : 'Voice input (Chrome, Edge, Safari — id-ID, or English)'}
        disabled={disabled}
        onClick={toggle}
        className={`relative inline-flex items-center justify-center gap-1 p-2 rounded-xl transition-colors flex-shrink-0 disabled:opacity-30 ${
          listening
            ? 'ai-research-voice-active bg-red-500 text-white ring-2 ring-red-300 shadow-[0_0_0_4px_rgba(239,68,68,0.35)]'
            : 'text-[var(--mos-text-muted)] hover:text-[var(--mos-text)]'
        }`}
      >
        {listening && <span className="ai-research-voice-ripple" aria-hidden="true" />}
        <svg className="relative w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
        </svg>
        {listening && (
          <span className="ai-research-voice-bars relative" data-testid="ai-research-voice-bars" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        )}
      </button>
      <style>{`
        .ai-research-voice-ripple {
          position: absolute;
          inset: 0;
          border-radius: inherit;
          border: 2px solid rgba(254, 202, 202, 0.95);
          pointer-events: none;
          animation: ai-research-voice-pulse 1.15s ease-out infinite;
        }
        .ai-research-voice-bars {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          height: 14px;
        }
        .ai-research-voice-bars span {
          display: block;
          width: 2px;
          height: 12px;
          border-radius: 999px;
          background: currentColor;
          transform-origin: center;
          animation: ai-research-voice-bar 0.85s ease-in-out infinite;
        }
        .ai-research-voice-bars span:nth-child(2) { animation-delay: 0.16s; }
        .ai-research-voice-bars span:nth-child(3) { animation-delay: 0.32s; }
        @keyframes ai-research-voice-pulse {
          0% { transform: scale(1); opacity: 0.9; }
          100% { transform: scale(1.65); opacity: 0; }
        }
        @keyframes ai-research-voice-bar {
          0%, 100% { transform: scaleY(0.35); }
          50% { transform: scaleY(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .ai-research-voice-ripple,
          .ai-research-voice-bars span {
            animation: none;
          }
          .ai-research-voice-bars span { transform: scaleY(0.7); }
        }
      `}</style>
    </>
  );
}
