export interface MarketResearchSourceStatus {
  outlet: string;
  status: 'ok' | 'error';
  candidateCount: number;
  sameDayCount: number;
  error?: string;
}

export class EmptyMarketResearchPoolError extends Error {
  readonly sourceStatus: MarketResearchSourceStatus[];

  constructor(sourceStatus: MarketResearchSourceStatus[]) {
    super(formatEmptyMarketResearchPoolMessage(sourceStatus));
    this.name = 'EmptyMarketResearchPoolError';
    this.sourceStatus = sourceStatus;
  }
}

export function formatMarketResearchSourceStatus(source: MarketResearchSourceStatus): string {
  if (source.status === 'error') return `Failed · ${source.error || 'Unavailable'}`;
  return `OK · ${source.candidateCount} kept / ${source.sameDayCount} same-day`;
}

export function formatEmptyMarketResearchPoolMessage(sourceStatus: MarketResearchSourceStatus[]): string {
  const ok = sourceStatus.filter(source => source.status === 'ok').length;
  const failed = sourceStatus.length - ok;
  const sameDay = sourceStatus.reduce((total, source) => total + source.sameDayCount, 0);
  const kept = sourceStatus.reduce((total, source) => total + source.candidateCount, 0);
  const details = sourceStatus.map(source => (
    source.status === 'ok'
      ? `${source.outlet}: ok, ${source.sameDayCount} same-day → ${source.candidateCount} kept`
      : `${source.outlet}: failed (${source.error || 'Unavailable'})`
  )).join('; ');
  return `No relevant same-day high-importance market news was found across Forex, Commodity, US Indices, or US Stocks. Feeds ok ${ok}/${sourceStatus.length} (${failed} failed), same-day items ${sameDay}, kept after symbol/importance filters ${kept}. ${details}`;
}
