import { SettlementPrint } from '@/components/settlement/SettlementPrint';
import { generatedAtWib, todayWib } from '@/components/settlement/report/labels';

export default async function SettlementPrintPage({ searchParams }: { searchParams: Promise<{ preset?: string; anchor?: string; noprint?: string }> }) {
  const query = await searchParams;
  return <SettlementPrint preset={query.preset || 'month'} anchor={query.anchor || todayWib()} noprint={query.noprint === '1'} generatedAt={generatedAtWib()} />;
}
