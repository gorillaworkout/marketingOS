'use client';

import { useEffect, useRef } from 'react';

/** Fired on window (and broadcast to other tabs) after a "Sync now" request finishes. */
export const SEO_SYNC_FINISHED_EVENT = 'seo:sync-finished';
const CHANNEL_NAME = 'marketingos-seo-sync';

type Listener = (event: Event) => void;
interface Target { addEventListener(type: string, listener: Listener): void; removeEventListener(type: string, listener: Listener): void }

export interface AutoRefreshEnv {
  document: Target & { visibilityState: string };
  window: Target;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: never) => void;
  now: () => number;
  /** Optional cross-tab channel (BroadcastChannel in the browser). */
  channel?: Target & { close(): void };
}

export interface AutoRefreshOptions {
  refresh: () => void | Promise<unknown>;
  /** Poll every `intervalMs` while true (e.g. while a sync run is 'running'). */
  poll: boolean;
  intervalMs?: number;
  /** Ignore triggers that arrive within this many ms of the previous refresh (focus + visibilitychange fire together). */
  minGapMs?: number;
}

/** Wires focus / visibility / sync-finished / polling triggers to `refresh`. Returns a cleanup function. */
export function startAutoRefresh(env: AutoRefreshEnv, options: AutoRefreshOptions): () => void {
  const { refresh, poll, intervalMs = 60_000, minGapMs = 2_000 } = options;
  let stopped = false;
  let inFlight = false;
  let last = Number.NEGATIVE_INFINITY;

  const trigger = () => {
    if (stopped || inFlight || env.document.visibilityState !== 'visible') return;
    const now = env.now();
    if (now - last < minGapMs) return;
    last = now;
    let result: void | Promise<unknown>;
    try { result = refresh(); } catch { return; }
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      inFlight = true;
      (result as Promise<unknown>).then(() => { inFlight = false; }, () => { inFlight = false; });
    }
  };

  env.document.addEventListener('visibilitychange', trigger);
  env.window.addEventListener('focus', trigger);
  env.window.addEventListener(SEO_SYNC_FINISHED_EVENT, trigger);
  env.channel?.addEventListener('message', trigger);
  const timer = poll ? env.setInterval(trigger, intervalMs) : null;

  return () => {
    stopped = true;
    env.document.removeEventListener('visibilitychange', trigger);
    env.window.removeEventListener('focus', trigger);
    env.window.removeEventListener(SEO_SYNC_FINISHED_EVENT, trigger);
    if (env.channel) { env.channel.removeEventListener('message', trigger); env.channel.close(); }
    if (timer !== null) env.clearInterval(timer as never);
  };
}

function browserEnv(): AutoRefreshEnv {
  return {
    document,
    window,
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: id => window.clearInterval(id as unknown as number),
    now: () => Date.now(),
    channel: typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : undefined,
  };
}

/** React hook around startAutoRefresh. `refresh` may change between renders without re-subscribing. */
export function useAutoRefresh(refresh: () => void | Promise<unknown>, options: { poll?: boolean; intervalMs?: number } = {}) {
  const { poll = false, intervalMs = 60_000 } = options;
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => startAutoRefresh(browserEnv(), { refresh: () => refreshRef.current(), poll, intervalMs }), [poll, intervalMs]);
}

/** Tell this tab and other open tabs that a sync finished so they refetch status/runs. */
export function notifySeoSyncFinished() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(SEO_SYNC_FINISHED_EVENT));
  if (typeof BroadcastChannel === 'function') {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ type: SEO_SYNC_FINISHED_EVENT, at: Date.now() });
    channel.close();
  }
}
