import { PageHeader, PageStack } from '@/components/ui/dashboard';
import { SettlementHome } from '@/components/settlement/SettlementHome';
import { SettlementNav } from '@/components/settlement/SettlementNav';

export default function SettlementReportPage() {
  return (
    <PageStack>
      <PageHeader
        eyebrow="Reports"
        title="Settlement Report"
        description="Upload the CRM deposit and withdrawal reports, the MT5 Deposit and Withdrawal export, and the Dealing FTD list. Reconciliation and the other sections follow in the next release."
      />
      <SettlementNav />
      <SettlementHome />
    </PageStack>
  );
}
