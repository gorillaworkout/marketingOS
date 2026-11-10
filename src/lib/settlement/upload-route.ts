import { decodeText, isZipOrXlsx } from './text-read';

export type SettlementFileRoute = 'deals_history' | 'standard';

/**
 * UTF-16 LE Deals History (a header containing "Deal") uses the chunked ingest.
 * xlsx and every other text export stay on the content-detected standard upload.
 */
export function routeSettlementFile(firstBytes: Uint8Array, name: string): SettlementFileRoute {
  void name;
  if (isZipOrXlsx(firstBytes)) return 'standard';
  if (firstBytes.length >= 2 && firstBytes[0] === 0xff && firstBytes[1] === 0xfe && decodeText(firstBytes).includes('Deal')) return 'deals_history';
  return 'standard';
}
