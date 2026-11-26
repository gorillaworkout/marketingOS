'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, FormField, Select } from '@/components/ui/dashboard';
import { ModalDialog } from '@/components/ui/ModalDialog';
import { imageModelLabel } from '@/lib/image-models';
import { DEFAULT_EDIT_IMAGE_MODEL, EDIT_IMAGE_MODELS, LEGACY_EDIT_NOTE, MAX_EDIT_INSTRUCTION } from '@/lib/image-edit-shared';

export interface EditableImage {
  filename: string;
  url: string;
  hasOriginal?: boolean;
  logo?: 'dupoin' | 'academy' | 'none' | null;
  footer?: boolean | null;
  includeSwipeLeft?: boolean | null;
}

type JobStatus = { status?: string; progress?: number; message?: string; error?: string; result?: { imageUrl?: string; fileName?: string } };

/**
 * Gallery "Edit": a text instruction applied to the whole image. The result
 * is saved as a new image (the original is kept) with the same logo, footer
 * and Swipe options. Mask / inpaint is a later phase.
 */
export function ImageEditDialog({ image, onClose, onSaved }: { image: EditableImage | null; onClose: () => void; onSaved: () => void }) {
  const [instruction, setInstruction] = useState('');
  const [model, setModel] = useState<string>(DEFAULT_EDIT_IMAGE_MODEL);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => () => { cancelled.current = true; }, []);

  const close = () => {
    if (running) return;
    setInstruction('');
    setMessage('');
    setError('');
    setResultUrl(null);
    onClose();
  };

  const submit = async () => {
    if (!image || !instruction.trim()) return;
    setRunning(true);
    setError('');
    setResultUrl(null);
    setMessage('Starting the edit…');
    try {
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: instruction.trim(),
          editOf: image.filename,
          model,
          type: 'generate-image',
          logo: image.logo ?? 'dupoin',
          footer: image.footer !== false,
          includeSwipeLeft: image.includeSwipeLeft === true,
        }),
      });
      const started = await res.json().catch(() => ({})) as { jobId?: string; error?: string };
      if (!res.ok || !started.jobId) throw new Error(started.error || 'The edit could not start.');
      for (let attempt = 0; attempt < 120 && !cancelled.current; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 2500));
        const poll = await fetch(`/api/generate-image?jobId=${encodeURIComponent(started.jobId)}`, { cache: 'no-store' });
        const job = await poll.json().catch(() => ({})) as JobStatus;
        if (job.message) setMessage(job.message);
        if (job.status === 'done' && job.result?.imageUrl) {
          setResultUrl(job.result.imageUrl);
          setMessage('Saved as a new image. The original is kept.');
          onSaved();
          return;
        }
        if (job.status === 'error' || !poll.ok) throw new Error(job.error || 'The edit failed.');
      }
      throw new Error('The edit is taking too long. Check the gallery in a minute.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The edit failed.');
      setMessage('');
    } finally {
      setRunning(false);
    }
  };

  return (
    <ModalDialog open={image !== null} title="Edit image" onClose={close} testId="image-edit-dialog">
      {image && (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wide text-[var(--mos-text-faint)]">{resultUrl ? 'Result' : 'Original'}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resultUrl ?? image.url} alt={image.filename} className="max-h-[50vh] w-full rounded-lg object-contain bg-[var(--mos-surface)]" />
            <p className="break-all font-mono text-[11px] text-[var(--mos-text-faint)]">{image.filename}</p>
          </div>
          <div className="space-y-4">
            <FormField label="What should change?" hint={`Describe one change to the whole image. ${MAX_EDIT_INSTRUCTION} characters or fewer.`}>
              <textarea
                value={instruction}
                maxLength={MAX_EDIT_INSTRUCTION}
                onChange={event => setInstruction(event.target.value)}
                rows={5}
                data-testid="image-edit-instruction"
                placeholder="e.g. Change the background to a dark blue trading floor, keep the person and the headline"
                className="w-full rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-surface)] p-3 text-sm"
              />
            </FormField>
            <FormField label="Model" hint="Only models that can edit an image are listed.">
              <Select value={model} onChange={event => setModel(event.target.value)} data-testid="image-edit-model">
                {EDIT_IMAGE_MODELS.map(id => <option key={id} value={id}>{imageModelLabel(id)}</option>)}
              </Select>
            </FormField>
            {!image.hasOriginal && (
              <p data-testid="image-edit-legacy-note" className="rounded-[var(--mos-radius-control)] border border-amber-400/30 bg-amber-400/10 p-3 text-xs leading-5 text-amber-200">{LEGACY_EDIT_NOTE}</p>
            )}
            <p className="text-xs text-[var(--mos-text-faint)]">The logo, footer and Swipe left options of the original are applied again. The result is saved as a new image; the original stays in the gallery.</p>
            {message && <p role="status" className="text-sm text-[var(--mos-text-secondary)]">{message}</p>}
            {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button onClick={close} disabled={running}>{resultUrl ? 'Close' : 'Cancel'}</Button>
              <Button variant="primary" data-testid="image-edit-submit" disabled={running || !instruction.trim()} onClick={() => void submit()}>
                {running ? 'Editing…' : resultUrl ? 'Edit again' : 'Apply edit'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ModalDialog>
  );
}
