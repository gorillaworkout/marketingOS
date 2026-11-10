/**
 * The same byte stream the upload panel uses. Tests drive this into the session engine
 * so a commit is reached from UTF-16 bytes, not from a source-text assertion.
 */
import {
  emptyUtf16LineState, finishUtf16LeLines, parseDealsFooter, parseDealsHeader, parseDealsRow, parseDealsTitle, pushUtf16LeLines, type ParsedDeal,
} from './deals-parse';

export interface IngestSink {
  open(titleLine: string): Promise<void>;
  chunk(deals: ParsedDeal[]): Promise<void>;
  commit(footer: { commission: number; swap: number }): Promise<void>;
}

export async function ingestDealsBytes(chunks: AsyncIterable<Uint8Array>, sink: IngestSink): Promise<{ deals: number }> {
  let decoder = emptyUtf16LineState();
  let header: ReturnType<typeof parseDealsHeader> = null;
  let opened = false;
  let sawFooter = false;
  let footer = { commission: 0, swap: 0 };
  let batch: ParsedDeal[] = [];
  let deals = 0;
  const flush = async () => {
    if (!batch.length) return;
    await sink.chunk(batch);
    deals += batch.length;
    batch = [];
  };
  const take = async (records: string[]) => {
    for (const record of records) {
      if (!opened && parseDealsTitle(record)) {
        await sink.open(record);
        opened = true;
      }
      if (!header) {
        header = parseDealsHeader(record);
        continue;
      }
      const foot = parseDealsFooter(header, record);
      if (foot) { footer = foot; sawFooter = true; continue; }
      const deal = parseDealsRow(header, record);
      if (!deal) continue;
      batch.push(deal);
      if (batch.length >= 2000) await flush();
    }
  };
  for await (const chunk of chunks) {
    const pushed = pushUtf16LeLines(decoder, chunk);
    decoder = pushed.state;
    await take(pushed.lines);
  }
  await take(finishUtf16LeLines(decoder));
  await flush();
  if (!opened) throw new Error('The file title was not parsed');
  if (!sawFooter) throw new Error('The file footer was not parsed');
  await sink.commit(footer);
  return { deals };
}
