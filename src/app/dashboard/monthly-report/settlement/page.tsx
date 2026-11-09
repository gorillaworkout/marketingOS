import { redirect } from 'next/navigation';

/** Old Onboarding tab. Settlement Report is its own menu. */
export default function MonthlyReportSettlementRedirect() {
  redirect('/dashboard/settlement-report');
}
