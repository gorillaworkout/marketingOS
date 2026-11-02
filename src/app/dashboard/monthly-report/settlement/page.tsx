import { EmptyState, PageHeader, PageStack, Panel } from '@/components/ui/dashboard';
import { ReportTabs } from '@/components/monthly-report/ReportTabs';

export default function MonthlyReportSettlementPage() {
  return (
    <PageStack>
      <PageHeader eyebrow="Reports" title="Settlement Reports" description="Coming soon. Settlement reporting will live here, next to Onboarding Reports." />
      <ReportTabs />
      <Panel>
        <EmptyState title="Settlement — coming soon" description="Upload is not available yet. Settlement metrics will appear here once the data source is agreed." />
      </Panel>
    </PageStack>
  );
}
