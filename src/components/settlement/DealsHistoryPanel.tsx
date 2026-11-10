'use client';

import { useState } from 'react';
import { Panel, SectionHeader } from '@/components/ui/dashboard';
import { MAX_CHUNK_BYTES, MAX_CHUNK_DEALS, emptyUtf16LineState, finishUtf16LeLines, parseDealsFooter, parseDealsHeader, parseDealsRow, parseDealsTitle, pushUtf16LeLines, type ParsedDeal } from '@/lib/settlement/deals-parse';

async function post(payload: unknown) {
  const body = JSON.stringify(payload);
  if (body.length > MAX_CHUNK_BYTES) throw new Error('The chunk is larger than 25 MB');
  const response = await fetch('/api/settlement-report/deals-history', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Upload failed (${response.status})`);
  return data as { sessionId?: string; idempotent?: boolean };
}

/** Streams a UTF-16 Deals History file in chunks of at most 2,000 deals. Does not replace phase 1 uploads. */
export function DealsHistoryPanel({ onImported }: { onImported?: () => void }) {
  const [status, setStatus] = useState('Choose the MT5 Deals History export. A date with no file stays Pending, not zero.');
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    setStatus('Reading…');
    const reader = file.stream().getReader();
    let decoder = emptyUtf16LineState();
    let header: ReturnType<typeof parseDealsHeader> = null;
    let title = '';
    let footer = { commission: 0, swap: 0 };
    let batch: ParsedDeal[] = [];
    let seq = 1;
    let sessionId = '';
    const flush = async () => {
      if (!batch.length || !sessionId) return;
      if (batch.length > MAX_CHUNK_DEALS) throw new Error(`A chunk can contain at most ${MAX_CHUNK_DEALS} deals`);
      const hash = `${seq}:${batch[0].deal}:${batch.at(-1)?.deal}:${batch.length}:${batch.reduce((sum, deal) => sum + deal.commission, 0)}`;
      await post({ action: 'chunk', sessionId, seq, hash, deals: batch });
      seq += 1;
      batch = [];
    };
    const take = async (lines: string[]) => {
      for (const line of lines) {
        if (!title && parseDealsTitle(line)) {
          title = line;
          if (!sessionId) {
            const opened = await post({ action: 'open', fileName: file.name, title, footerCommission: 0, footerSwap: 0 });
            sessionId = opened.sessionId ?? '';
          }
        }
        if (!header) { header = parseDealsHeader(line); continue; }
        const foot = parseDealsFooter(header, line);
        if (foot) { footer = foot; continue; }
        const deal = parseDealsRow(header, line);
        if (!deal) continue;
        batch.push(deal);
        if (batch.length >= MAX_CHUNK_DEALS) await flush();
      }
    };
    try {
      for (;;) {
        const step = await reader.read();
        if (step.done) break;
        const pushed = pushUtf16LeLines(decoder, step.value);
        decoder = pushed.state;
        await take(pushed.lines);
      }
      await take(finishUtf16LeLines(decoder));
      await flush();
      await post({ action: 'commit', sessionId, footerCommission: footer.commission, footerSwap: footer.swap });
      setStatus(`Imported ${file.name}. Re-uploading the same deals does not double-count.`);
      onImported?.();
    } catch (error) {
      if (sessionId) await post({ action: 'abort', sessionId }).catch(() => undefined);
      setStatus(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <SectionHeader
        title="Deals History"
        description="UTF-16 MT5 Deals History, sent in chunks of 2,000 deals (25 MB request limit). Rows match on Deal. A smaller overlapping file does not delete deals it does not contain."
        action={<input aria-label="Choose Deals History file" type="file" accept=".csv,.txt" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} />}
      />
      <p className="px-5 pb-4 text-xs text-[var(--mos-text-muted)]">{status}</p>
    </Panel>
  );
}
