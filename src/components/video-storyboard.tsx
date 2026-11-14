'use client';

import { useState } from 'react';
import { Button, Panel, SectionHeader } from '@/components/ui/dashboard';
import { buildStoryboardImagePrompt, storyboardAspectRatio, type StoryboardScene, type VideoFormat } from '@/lib/video-script-format';

async function renderSceneImage(prompt: string, aspectRatio: string, taskId: string, brief: string): Promise<string> {
  const started = await fetch('/api/generate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, type: 'video-script', aspectRatio, taskId, brief }),
  });
  const job = await started.json().catch(() => ({}));
  if (!started.ok || !job.jobId) throw new Error(job.error || 'Image generation did not start.');
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const status = await fetch(`/api/generate-image?jobId=${encodeURIComponent(job.jobId)}`, { cache: 'no-store' });
    const payload = await status.json().catch(() => ({}));
    if (payload.status === 'done' && payload.result?.imageUrl) return payload.result.imageUrl as string;
    if (payload.status === 'error') throw new Error(payload.error || payload.message || 'Image generation failed.');
  }
  throw new Error('Image generation timed out.');
}

export function VideoStoryboard({
  taskId,
  fullScript,
  format,
  platform,
  brief,
  initialScenes,
}: {
  taskId: string | null;
  fullScript: string;
  format: VideoFormat;
  platform: string;
  brief: string;
  initialScenes: StoryboardScene[];
}) {
  const [scenes, setScenes] = useState<StoryboardScene[]>(initialScenes);
  const [busy, setBusy] = useState<number | 'all' | null>(null);
  const [error, setError] = useState('');

  const persist = async (next: StoryboardScene[]) => {
    if (!taskId) return;
    await fetch('/api/video-script/storyboard', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, format, scenes: next }),
    });
  };

  const paint = async (current: StoryboardScene[], number: number) => {
    const scene = current.find(item => item.number === number);
    if (!scene) return current;
    const next = current.map(item => item.number === number ? { ...item, imageError: undefined } : item);
    setScenes(next);
    try {
      const imageUrl = await renderSceneImage(buildStoryboardImagePrompt(scene, format), storyboardAspectRatio(platform), taskId || '', brief);
      const done = next.map(item => item.number === number ? { ...item, imageUrl, imageError: undefined } : item);
      setScenes(done);
      await persist(done);
      return done;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Image generation failed.';
      const failed = next.map(item => item.number === number ? { ...item, imageError: message } : item);
      setScenes(failed);
      await persist(failed);
      return failed;
    }
  };

  const generate = async () => {
    if (!fullScript.trim()) return;
    setBusy('all');
    setError('');
    const response = await fetch('/api/video-script/storyboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, fullScript, format, platform, brief }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data.scenes)) {
      setBusy(null);
      setError(data.error || 'The storyboard could not be created.');
      return;
    }
    let current = data.scenes as StoryboardScene[];
    setScenes(current);
    for (const scene of current) {
      setBusy(scene.number);
      current = await paint(current, scene.number);
    }
    setBusy(null);
  };

  const regenerate = async (number: number) => {
    setBusy(number);
    setError('');
    await paint(scenes, number);
    setBusy(null);
  };

  return (
    <Panel className="space-y-4">
      <SectionHeader title="Storyboard" description="One frame per scene. A failed frame can be retried without starting over." action={
        <Button type="button" variant="primary" disabled={busy !== null || !fullScript} onClick={() => void generate()}>
          {busy === 'all' ? 'Building scenes…' : 'Generate storyboard'}
        </Button>
      } />
      {error && <p className="text-sm text-red-300">{error}</p>}
      {scenes.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {scenes.map(scene => (
              <div key={scene.number} className="rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] p-3">
                <p className="text-xs uppercase tracking-wide text-[var(--mos-text-faint)]">Scene {scene.number} · {scene.duration}</p>
                <p className="mt-1 text-sm text-[var(--mos-text)]">{scene.shot}</p>
                {scene.onScreenText && <p className="mt-1 text-xs text-[var(--mos-text-secondary)]">On-screen: {scene.onScreenText}</p>}
                {scene.vo && <p className="mt-1 text-xs text-[var(--mos-text-muted)]">VO: {scene.vo}</p>}
                {scene.imageUrl && <img src={scene.imageUrl} alt={`Scene ${scene.number}`} className="mt-2 aspect-[9/16] w-full rounded object-cover" />}
                {scene.imageError && <p className="mt-2 text-xs text-red-300">{scene.imageError}</p>}
                {busy === scene.number && <p className="mt-2 text-xs text-[var(--mos-text-muted)]">Generating this frame…</p>}
                <Button type="button" className="mt-2" disabled={busy !== null} onClick={() => void regenerate(scene.number)}>Regenerate</Button>
              </div>
            ))}
          </div>
          {taskId && (
            <div className="flex flex-wrap gap-2">
              <a className="text-sm text-blue-300 underline" href={`/api/video-script/storyboard?taskId=${encodeURIComponent(taskId)}&kind=zip`}>Download images (zip)</a>
              <a className="text-sm text-blue-300 underline" href={`/api/video-script/storyboard?taskId=${encodeURIComponent(taskId)}&kind=pdf`}>Download PDF storyboard</a>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
