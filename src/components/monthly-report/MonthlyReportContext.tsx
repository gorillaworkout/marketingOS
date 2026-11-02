'use client';

import { createContext, useContext, type ReactNode } from 'react';

export interface MonthlyReportPermissions { canUpload: boolean; isAdmin: boolean }

const Context = createContext<MonthlyReportPermissions>({ canUpload: false, isAdmin: false });

export function MonthlyReportProvider({ value, children }: { value: MonthlyReportPermissions; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useMonthlyReportPermissions = () => useContext(Context);
