import { DEFAULT_SOURCE_OFFSET, offsetFromFileName, parseOffset } from './onboarding-parse';

/**
 * Which UTC offset the export's wall-clock times are in: an explicit choice
 * wins, then a `+0700`-style suffix in the file name, then the default (+08:00).
 */
export function resolveUploadOffset(explicit: string | null | undefined, fileName: string): { offset: string; from: 'explicit' | 'file name' | 'default' } | { error: string } {
  if (explicit) {
    if (parseOffset(explicit) === null) return { error: `"${explicit}" is not a valid UTC offset (use e.g. +08:00)` };
    const minutes = parseOffset(explicit)!;
    const sign = minutes < 0 ? '-' : '+';
    const abs = Math.abs(minutes);
    return { offset: `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`, from: 'explicit' };
  }
  const fromName = offsetFromFileName(fileName);
  if (fromName) return { offset: fromName, from: 'file name' };
  return { offset: DEFAULT_SOURCE_OFFSET, from: 'default' };
}
