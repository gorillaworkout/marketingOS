'use client';

import { useEffect, useRef, useState } from 'react';
import { AI_RESEARCH_MAX_IMAGE_BYTES, isAllowedImageType } from '@/lib/ai-research';
import {
  AI_RESEARCH_CAMERA_ACCEPT,
  AI_RESEARCH_CAMERA_CAPTURE,
  cameraCaptureErrorMessage,
  cameraFileForAttachment,
  cameraPhotoWithinLimit,
  inPageCameraBlockReason,
  prefersOsCamera,
} from '@/lib/ai-research-camera';

type FacingMode = 'environment' | 'user';

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach(track => track.stop());
}

function readOsCameraPreference(): boolean {
  if (typeof window === 'undefined') return true;
  return prefersOsCamera({
    userAgent: navigator.userAgent,
    coarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    hoverNone: window.matchMedia?.('(hover: none)').matches ?? false,
  });
}

function readInPageCameraBlock(): string | null {
  if (typeof window === 'undefined') return 'Kamera di halaman butuh browser.';
  return inPageCameraBlockReason({
    secureContext: window.isSecureContext,
    hasGetUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
  });
}

async function requestCameraStream(facing: FacingMode): Promise<MediaStream> {
  const media = navigator.mediaDevices;
  if (!media?.getUserMedia) {
    const error = new Error('getUserMedia unavailable');
    error.name = 'NotSupportedError';
    throw error;
  }
  try {
    return await media.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: facing } },
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'OverconstrainedError' || name === 'NotFoundError' || name === 'ConstraintNotSatisfiedError') {
      return media.getUserMedia({ audio: false, video: true });
    }
    throw error;
  }
}

async function blobFromVideo(video: HTMLVideoElement): Promise<Blob> {
  const maxEdge = 1600;
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error('Camera preview is not ready');
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not capture photo');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error('Could not capture photo');
  return blob;
}

async function shrinkCameraPhoto(file: File): Promise<File> {
  const normalized = await cameraFileForAttachment(file);
  if (cameraPhotoWithinLimit(normalized.size) || normalized.type === 'image/gif' || !isAllowedImageType(normalized.type)) {
    return normalized;
  }
  try {
    const bitmap = await createImageBitmap(normalized);
    let edge = 1600;
    let quality = 0.82;
    let blob: Blob | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) break;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= AI_RESEARCH_MAX_IMAGE_BYTES) break;
      edge = Math.round(edge * 0.75);
      quality = Math.max(0.6, quality - 0.08);
    }
    bitmap.close();
    if (!blob || blob.size > AI_RESEARCH_MAX_IMAGE_BYTES) return normalized;
    const base = normalized.name.replace(/\.[^.]+$/, '') || `camera-${Date.now()}`;
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return normalized;
  }
}

export function AiResearchCameraButton({
  disabled,
  onCapture,
  onError,
}: {
  disabled?: boolean;
  onCapture: (file: File) => void;
  onError?: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [open, setOpen] = useState(false);
  const [facing, setFacing] = useState<FacingMode>('environment');
  const [phase, setPhase] = useState<'starting' | 'live' | 'error'>('starting');
  const [previewError, setPreviewError] = useState('');

  const closePreview = () => {
    setOpen(false);
    setPhase('starting');
    setPreviewError('');
  };

  const openFileCapture = () => {
    inputRef.current?.click();
  };

  useEffect(() => {
    if (!open) return;
    const video = videoRef.current;
    let cancelled = false;
    let localStream: MediaStream | null = null;

    const start = async () => {
      setPhase('starting');
      setPreviewError('');
      try {
        localStream = await requestCameraStream(facing);
        if (cancelled) {
          stopStream(localStream);
          return;
        }
        streamRef.current = localStream;
        if (video) {
          video.srcObject = localStream;
          await video.play();
        }
        if (!cancelled) setPhase('live');
      } catch (error) {
        stopStream(localStream);
        if (cancelled) return;
        if (streamRef.current === localStream) streamRef.current = null;
        setPhase('error');
        const name = error instanceof DOMException || error instanceof Error ? error.name : '';
        setPreviewError(cameraCaptureErrorMessage(name));
      }
    };

    void start();
    return () => {
      cancelled = true;
      stopStream(streamRef.current);
      streamRef.current = null;
      if (video) video.srcObject = null;
    };
  }, [open, facing]);

  const publishFile = async (file: File) => {
    const ready = await shrinkCameraPhoto(file);
    onCapture(ready);
    closePreview();
  };

  const handleInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || disabled) return;
    void publishFile(file);
  };

  const captureFrame = async () => {
    const video = videoRef.current;
    if (!video || phase !== 'live') return;
    try {
      const blob = await blobFromVideo(video);
      await publishFile(new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }));
    } catch (error) {
      setPhase('error');
      setPreviewError(error instanceof Error ? error.message : cameraCaptureErrorMessage());
    }
  };

  const openCamera = () => {
    if (disabled) return;
    if (readOsCameraPreference()) {
      openFileCapture();
      return;
    }
    const blocked = readInPageCameraBlock();
    if (blocked) {
      onError?.(blocked);
      openFileCapture();
      return;
    }
    setFacing('environment');
    setOpen(true);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={AI_RESEARCH_CAMERA_ACCEPT}
        capture={AI_RESEARCH_CAMERA_CAPTURE}
        className="hidden"
        tabIndex={-1}
        data-testid="ai-research-camera-input"
        onChange={handleInput}
      />
      <button
        type="button"
        data-testid="ai-research-camera"
        onClick={openCamera}
        disabled={disabled}
        className="text-[var(--mos-text-muted)] hover:text-[var(--mos-text)] disabled:opacity-30 p-2 rounded-xl transition-colors flex-shrink-0"
        title="Ambil foto lalu lampirkan"
        aria-label="Ambil foto dengan kamera"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
        </svg>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
          role="presentation"
          onClick={closePreview}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-research-camera-title"
            data-testid="ai-research-camera-dialog"
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--mos-border)] bg-[var(--mos-raised)] shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <h3 id="ai-research-camera-title" className="text-sm font-semibold text-[var(--mos-text)]">Kamera</h3>
              <button
                type="button"
                onClick={closePreview}
                className="text-[11px] text-[var(--mos-text-muted)] hover:text-[var(--mos-text)]"
              >
                Tutup
              </button>
            </div>
            <div className="bg-black">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                data-testid="ai-research-camera-preview"
                className={`aspect-[4/3] w-full bg-black object-contain ${phase === 'live' ? '' : 'opacity-40'}`}
              />
            </div>
            {previewError && (
              <p role="alert" data-testid="ai-research-camera-error" className="px-4 pt-3 text-[11px] leading-5 text-amber-100">
                {previewError}
              </p>
            )}
            {phase === 'starting' && !previewError && (
              <p className="px-4 pt-3 text-[11px] text-[var(--mos-text-muted)]">Membuka kamera…</p>
            )}
            <div className="flex flex-wrap gap-2 p-4">
              <button
                type="button"
                data-testid="ai-research-camera-shutter"
                onClick={() => { void captureFrame(); }}
                disabled={phase !== 'live'}
                className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-30"
              >
                Ambil foto
              </button>
              <button
                type="button"
                data-testid="ai-research-camera-switch"
                onClick={() => setFacing(current => current === 'environment' ? 'user' : 'environment')}
                disabled={phase === 'starting'}
                className="rounded-xl border border-[var(--mos-border)] px-3 py-2 text-xs text-[var(--mos-text)] disabled:opacity-30"
              >
                {facing === 'environment' ? 'Kamera depan' : 'Kamera belakang'}
              </button>
              <button
                type="button"
                data-testid="ai-research-camera-fallback"
                onClick={openFileCapture}
                className="rounded-xl border border-[var(--mos-border)] px-3 py-2 text-xs text-[var(--mos-text)]"
              >
                Pilih foto
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
