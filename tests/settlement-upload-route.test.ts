import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { routeSettlementFile } from '../src/lib/settlement/upload-route';

describe('settlement upload routing', () => {
  it('sends a UTF-16 Deals History header to the chunked flow and everything else to the standard flow', () => {
    const utf16 = (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    assert.equal(routeSettlementFile(utf16('Deal\tLogin\tCommission'), 'Deals-History-Oct1-5.csv'), 'deals_history');
    assert.equal(routeSettlementFile(utf16('Login\tAmount'), 'notes.csv'), 'standard');
    assert.equal(routeSettlementFile(Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'crm_deposit.xlsx'), 'standard');
    assert.equal(routeSettlementFile(Buffer.from('Deal,Login\n1,2\n'), 'plain.csv'), 'standard');
  });
});
