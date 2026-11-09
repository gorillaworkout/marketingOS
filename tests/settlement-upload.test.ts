import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SETTLEMENT_KIND_LABELS, SETTLEMENT_UPLOAD_KINDS } from '../src/lib/settlement/detect';
import { handleSettlementUpload, maskSample, parseForKind } from '../src/lib/settlement/upload-handlers';
import { crmDepositXlsx, crmWithdrawalXlsx, dayDeals, dayDeposits, dayWithdrawals, ftdRows, ftdXlsx, mt5DwText } from './fixtures/settlement';

const user = { id: 'u', role: 'admin' } as never;

describe('settlement upload handler', () => {
  it('labels every kind', () => {
    for (const kind of SETTLEMENT_UPLOAD_KINDS) assert.ok(SETTLEMENT_KIND_LABELS[kind]);
  });

  it('parses each kind through parseForKind', () => {
    assert.equal(parseForKind('settlement_crm_deposit', crmDepositXlsx(dayDeposits)).rows.length, 6);
    assert.equal(parseForKind('settlement_crm_withdrawal', crmWithdrawalXlsx(dayWithdrawals)).rows.length, 4);
    assert.equal(parseForKind('settlement_mt5_dw', mt5DwText(dayDeals)).rows.length, 11);
    assert.equal(parseForKind('settlement_ftd', ftdXlsx(ftdRows)).rows.length, 3);
  });

  it('masks account, login, uid and name in the preview sample', () => {
    const [row] = maskSample([{ reference: '1', accountNo: '2041125', uid: '1333700', name: 'AHMAD TAUFIK', login: '2424079' }]);
    assert.deepEqual(row, { reference: '1', accountNo: '20***25', uid: '13***00', name: 'AH***IK', login: '24***79' });
  });

  it('rejects an unknown file with 400 and a commit whose expect does not match with 409 (no DB touched)', async () => {
    const unknown = await handleSettlementUpload(user, Buffer.from('a,b\n1,2\n'), new URLSearchParams());
    assert.equal(unknown.status, 400);
    assert.equal((await unknown.json()).detectedKind, null);
    const mismatch = await handleSettlementUpload(user, mt5DwText(dayDeals), new URLSearchParams('mode=commit&expect=settlement_crm_deposit'));
    assert.equal(mismatch.status, 409);
  });
});
