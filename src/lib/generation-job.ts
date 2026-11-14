/**
 * Server-side generation jobs that outlive the browser stream.
 * The POST route starts the job and returns `streamGenerationJob`, which writes a first
 * chunk at once (so nginx never waits on slow research) and a keepalive comment every
 * 10 seconds. A GET with `?jobId=` lets the browser reattach after the stream drops.
 * Same pattern as the Market News article route.
 */

export type GenerationJobStatus = 'running' | 'done' | 'error';

export interface GenerationJob {
  id: string;
  ownerId: string;
  status: GenerationJobStatus;
  progress: number;
  message: string;
  events: Array<Record<string, unknown>>;
  result?: Record<string, unknown>;
  error?: string;
  updatedAt: number;
}

export interface GenerationJobStore {
  create(ownerId: string, message?: string): GenerationJob;
  get(id: string, ownerId: string): GenerationJob | undefined;
  push(id: string, ownerId: string, event: Record<string, unknown>): void;
  finish(id: string, ownerId: string, result: Record<string, unknown>, message?: string): void;
  fail(id: string, ownerId: string, error: string): void;
}

export const GENERATION_KEEPALIVE_MS = 10_000;
/** Finished jobs stay readable for reattach for 30 minutes. */
const FINISHED_JOB_TTL_MS = 30 * 60_000;

const globalStores = globalThis as typeof globalThis & {
  __marketingOsGenerationJobs?: Map<string, Map<string, GenerationJob>>;
};

export function createGenerationJobStore(namespace: string): GenerationJobStore {
  const stores = globalStores.__marketingOsGenerationJobs ??= new Map();
  let jobs = stores.get(namespace);
  if (!jobs) {
    jobs = new Map<string, GenerationJob>();
    stores.set(namespace, jobs);
  }
  const map = jobs;
  const prune = () => {
    const cutoff = Date.now() - FINISHED_JOB_TTL_MS;
    for (const [id, job] of map) if (job.status !== 'running' && job.updatedAt < cutoff) map.delete(id);
  };
  const owned = (id: string, ownerId: string) => {
    const job = map.get(id);
    return job?.ownerId === ownerId ? job : undefined;
  };
  return {
    create(ownerId, message = 'Starting…') {
      prune();
      const job: GenerationJob = { id: crypto.randomUUID(), ownerId, status: 'running', progress: 0, message, events: [], updatedAt: Date.now() };
      map.set(job.id, job);
      return job;
    },
    get: owned,
    push(id, ownerId, event) {
      const job = owned(id, ownerId);
      if (!job || job.status !== 'running') return;
      job.events.push(event);
      if (typeof event.progress === 'number') job.progress = event.progress;
      if (typeof event.message === 'string') job.message = event.message;
      job.updatedAt = Date.now();
    },
    finish(id, ownerId, result, message) {
      const job = owned(id, ownerId);
      if (!job) return;
      job.status = 'done';
      job.progress = 100;
      job.result = result;
      if (message) job.message = message;
      job.updatedAt = Date.now();
    },
    fail(id, ownerId, error) {
      const job = owned(id, ownerId);
      if (!job) return;
      job.status = 'error';
      job.error = error;
      job.message = error;
      job.updatedAt = Date.now();
    },
  };
}

function sseData(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export const GENERATION_STREAM_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

/** Stream a job's events. The first chunk (a comment plus the job id) is written immediately. */
export function streamGenerationJob(
  store: GenerationJobStore,
  jobId: string,
  ownerId: string,
  options: { keepaliveMs?: number; pollMs?: number } = {},
): Response {
  const keepaliveMs = options.keepaliveMs ?? GENERATION_KEEPALIVE_MS;
  const pollMs = options.pollMs ?? 400;
  const encoder = new TextEncoder();
  let stopped = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (text: string) => {
        if (stopped) return;
        try { controller.enqueue(encoder.encode(text)); } catch { stopped = true; }
      };
      write(`: connected ${Date.now()}\n\n${sseData({ step: 'started', jobId, progress: 0 })}`);
      const keepalive = setInterval(() => write(`: keepalive ${Date.now()}\n\n`), keepaliveMs);
      let sent = 0;
      try {
        while (!stopped) {
          const current = store.get(jobId, ownerId);
          if (!current) break;
          while (sent < current.events.length) {
            write(sseData({ jobId, ...current.events[sent] }));
            sent += 1;
          }
          if (current.status !== 'running') break;
          await new Promise(resolve => setTimeout(resolve, pollMs));
        }
      } finally {
        clearInterval(keepalive);
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() {
      // The browser or proxy closed the stream. The server job keeps running.
      stopped = true;
    },
  });
  return new Response(stream, { headers: GENERATION_STREAM_HEADERS });
}

/** JSON status for `GET ?jobId=` reattach polling. */
export function generationJobStatus(job: GenerationJob) {
  return {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    result: job.result ?? null,
    error: job.error ?? null,
  };
}
