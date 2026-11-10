import { PageHeader, PageStack } from '@/components/ui/dashboard';
import { SettlementNav } from '@/components/settlement/SettlementNav';
import { SettlementWorkspace } from '@/components/settlement/SettlementWorkspace';

export default function SettlementReportPage() {
  return (
    <PageStack>
      <PageHeader
        eyebrow="Reports"
        title="Settlement Report"
        description="Daily reconciliation of CRM against MT5, processing time, withdrawal %, margin in–out, and swap. Deals History adds commission and its own swap term. A date with no Deals History file stays Pending, not zero."
      />
      <SettlementNav />
      <SettlementWorkspace />
    </PageStack>
  );
}
