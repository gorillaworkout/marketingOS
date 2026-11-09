'use client';

import { createContext, useContext, type ReactNode } from 'react';

export interface SettlementPermissions { canUpload: boolean; isAdmin: boolean }

const Context = createContext<SettlementPermissions>({ canUpload: false, isAdmin: false });

export function SettlementProvider({ value, children }: { value: SettlementPermissions; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useSettlementPermissions = () => useContext(Context);
