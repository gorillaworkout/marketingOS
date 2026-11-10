'use client';

import { useState } from 'react';
import { DealsHistoryPanel } from './DealsHistoryPanel';
import { SettlementDashboard } from './SettlementDashboard';
import { SettlementHome } from './SettlementHome';

/** Upload, coverage, and history stay above the report sections. A successful import reloads both. */
export function SettlementWorkspace() {
  const [reloadToken, setReloadToken] = useState(0);
  return (
    <>
      <SettlementHome onImported={() => setReloadToken(token => token + 1)} />
      <DealsHistoryPanel onImported={() => setReloadToken(token => token + 1)} />
      <SettlementDashboard reloadToken={reloadToken} />
    </>
  );
}
