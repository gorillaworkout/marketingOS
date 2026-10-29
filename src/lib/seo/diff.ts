export interface DiffLine { type: 'same' | 'add' | 'remove'; text: string }

/** Above this many LCS cells the diff falls back to a whole-block replace. */
const MAX_CELLS = 4_000_000;

function splitLines(text: string): string[] {
  return text === '' ? [] : text.replace(/\r\n/g, '\n').split('\n');
}

/**
 * Line diff (longest common subsequence) between two texts. Common prefix and
 * suffix are trimmed first so typical edits stay cheap.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA -= 1; endB -= 1; }

  const head: DiffLine[] = a.slice(0, start).map(text => ({ type: 'same', text }));
  const tail: DiffLine[] = a.slice(endA).map(text => ({ type: 'same', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;

  if ((n + 1) * (m + 1) > MAX_CELLS) {
    return [
      ...head,
      ...midA.map(text => ({ type: 'remove' as const, text })),
      ...midB.map(text => ({ type: 'add' as const, text })),
      ...tail,
    ];
  }

  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] = midA[i] === midB[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) { middle.push({ type: 'same', text: midA[i] }); i += 1; j += 1; }
    else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) { middle.push({ type: 'remove', text: midA[i] }); i += 1; }
    else { middle.push({ type: 'add', text: midB[j] }); j += 1; }
  }
  while (i < n) { middle.push({ type: 'remove', text: midA[i] }); i += 1; }
  while (j < m) { middle.push({ type: 'add', text: midB[j] }); j += 1; }
  return [...head, ...middle, ...tail];
}

export function diffStats(diff: DiffLine[]): { added: number; removed: number } {
  return {
    added: diff.filter(line => line.type === 'add').length,
    removed: diff.filter(line => line.type === 'remove').length,
  };
}
