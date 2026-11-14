export type ArticleJobStatus = 'running' | 'done' | 'error';

export interface ArticleJob {
  id: string;
  ownerId: string;
  status: ArticleJobStatus;
  progress: number;
  message: string;
  events: Array<Record<string, unknown>>;
  result?: Record<string, unknown>;
  error?: string;
}

export interface ArticleJobStore {
  create(ownerId: string): ArticleJob;
  get(id: string, ownerId: string): ArticleJob | undefined;
  push(id: string, ownerId: string, event: Record<string, unknown>): void;
  finish(id: string, ownerId: string, result: Record<string, unknown>): void;
  fail(id: string, ownerId: string, error: string): void;
}

const globalJobs = globalThis as typeof globalThis & {
  __marketingOsArticleJobs?: Map<string, ArticleJob>;
};

export function createArticleJobStore(): ArticleJobStore {
  const jobs = globalJobs.__marketingOsArticleJobs ??= new Map<string, ArticleJob>();
  return {
    create(ownerId) {
      const job: ArticleJob = {
        id: crypto.randomUUID(),
        ownerId,
        status: 'running',
        progress: 5,
        message: 'Starting the article…',
        events: [],
      };
      jobs.set(job.id, job);
      return job;
    },
    get(id, ownerId) {
      const job = jobs.get(id);
      return job?.ownerId === ownerId ? job : undefined;
    },
    push(id, ownerId, event) {
      const job = jobs.get(id);
      if (!job || job.ownerId !== ownerId || job.status !== 'running') return;
      job.events.push(event);
      if (typeof event.progress === 'number') job.progress = event.progress;
      if (typeof event.message === 'string') job.message = event.message;
    },
    finish(id, ownerId, result) {
      const job = jobs.get(id);
      if (!job || job.ownerId !== ownerId) return;
      job.status = 'done';
      job.progress = 100;
      job.result = result;
      job.message = 'Article draft complete. Run manual fact and originality checks before publishing.';
    },
    fail(id, ownerId, error) {
      const job = jobs.get(id);
      if (!job || job.ownerId !== ownerId) return;
      job.status = 'error';
      job.error = error;
      job.message = error;
    },
  };
}
