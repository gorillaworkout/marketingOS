import { PageHeader, PageStack } from '@/components/ui/dashboard';
import { SettlementNav } from '@/components/settlement/SettlementNav';
import { SettlementWorkspace } from '@/components/settlement/SettlementWorkspace';

export default function SettlementReportPage() {
  return (
    <PageStack>
      <PageHeader
        eyebrow="Reports"
        title="Settlement Report"
        description="Daily reconciliation of CRM against MT5 (12:00 WIB cut-off), processing time, withdrawal %, margin in–out, and swap from Deposit & Withdrawal (CRM-S / CRM-SR)."
      />
      <SettlementNav />
      <SettlementWorkspace />
    </PageStack>
  );
}
