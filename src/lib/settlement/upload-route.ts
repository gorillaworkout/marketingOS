import { decodeText, isZipOrXlsx } from './text-read';

export type SettlementFileRoute = 'deals_history' | 'standard';

const DEALS_HISTORY_TITLE = /Deals History Report/i;
const DEPOSIT_WITHDRAWAL_TITLE = /Deposit and Withdrawal Report/i;

/**
 * Only a UTF-16 LE Deals History report uses the chunked ingest.
 * The Deposit and Withdrawal export is also UTF-16 and has a Deal column, so the title decides.
 * xlsx and every other file stay on the content-detected standard upload.
 */
export function routeSettlementFile(firstBytes: Uint8Array, name: string): SettlementFileRoute {
  void name;
  if (isZipOrXlsx(firstBytes)) return 'standard';
  if (firstBytes.length < 2 || firstBytes[0] !== 0xff || firstBytes[1] !== 0xfe) return 'standard';
  const text = decodeText(firstBytes);
  if (DEPOSIT_WITHDRAWAL_TITLE.test(text)) return 'standard';
  if (DEALS_HISTORY_TITLE.test(text)) return 'deals_history';
  return 'standard';
}
