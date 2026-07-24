export type ImageJobStatus = 'queued' | 'generating' | 'processing' | 'done' | 'error';

export interface ImageJobResult {
  success: true;
  imageUrl: string;
  fileName?: string;
  sopName?: string;
  model?: string;
}

export interface ImageJob {
  id: string;
  ownerId: string;
  status: ImageJobStatus;
  progress: number;
  message: string;
  result?: ImageJobResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export type ImageJobUpdate = Pick<ImageJob, 'status' | 'progress' | 'message'> &
  Pick<ImageJob, 'result' | 'error'>;

export interface ImageJobStore {
  create(ownerId: string): ImageJob;
  get(id: string, ownerId: string): ImageJob | undefined;
  update(id: string, ownerId: string, update: ImageJobUpdate): ImageJob | undefined;
}

export function createImageJobStore(): ImageJobStore {
  const jobs = new Map<string, ImageJob>();

  return {
    create(ownerId) {
      const now = new Date().toISOString();
      const job: ImageJob = {
        id: crypto.randomUUID(),
        ownerId,
        status: 'queued',
        progress: 10,
        message: '🎨 Starting Codex image generation...',
        createdAt: now,
        updatedAt: now,
      };
      jobs.set(job.id, job);
      return job;
    },
    get(id, ownerId) {
      const job = jobs.get(id);
      return job?.ownerId === ownerId ? job : undefined;
    },
    update(id, ownerId, update) {
      const job = jobs.get(id);
      if (!job || job.ownerId !== ownerId || isTerminalImageJobStatus(job.status)) return undefined;

      const now = new Date().toISOString();
      const next: ImageJob = {
        ...job,
        ...update,
        updatedAt: now,
        ...(isTerminalImageJobStatus(update.status) ? { completedAt: now } : {}),
      };
      jobs.set(id, next);
      return next;
    },
  };
}

export function isTerminalImageJobStatus(status: ImageJobStatus): boolean {
  return status === 'done' || status === 'error';
}
