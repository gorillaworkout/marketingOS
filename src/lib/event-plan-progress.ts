/** English operator copy for Event Plan SSE progress. Search queries may stay bilingual; these strings are shown to the operator. */
export const EVENT_PLAN_PROGRESS = {
  searching(round: number) {
    return round > 1
      ? 'First price pack is thin. Searching again for venues and vendors…'
      : 'Searching public venue and vendor prices…';
  },
  reading(round: number) {
    return round > 1
      ? 'Reading additional public price pages…'
      : 'Reading public price pages…';
  },
  drafting: 'Drafting 3 event plan styles…',
  draftingStyle(label: string) {
    return `Drafting ${label}…`;
  },
  partialFailure(labels: string, count: number) {
    const styles = count === 1 ? 'style' : 'styles';
    return `${labels} failed. Showing ${count} ${styles} that succeeded.`;
  },
  drafted(count: number) {
    const options = count === 1 ? 'option' : 'options';
    return `${count} event plan ${options} drafted.`;
  },
  complete: 'Generation complete. Choose an event plan style.',
} as const;

const INDONESIAN_OPERATOR_COPY = /\b(mencari|membaca|menyusun|gagal|menampilkan|berhasil|narasumber|harga publik)\b/i;

export function assertEnglishEventPlanProgress(message: string): boolean {
  return message.trim().length > 0 && !INDONESIAN_OPERATOR_COPY.test(message);
}
