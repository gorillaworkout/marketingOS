import { PageHeader, PageStack } from '@/components/ui/dashboard';
import { SettlementDataSources } from '@/components/settlement/SettlementDataSources';
import { SettlementNav } from '@/components/settlement/SettlementNav';

export default function SettlementDataPage() {
  return (
    <PageStack>
      <PageHeader
        eyebrow="Reports"
        title="Settlement Report"
        description="Upload CRM, MT5, the Dealing FTD list, and Deals History. The report reads what is stored here."
      />
      <SettlementNav />
      <SettlementDataSources />
    </PageStack>
  );
}
