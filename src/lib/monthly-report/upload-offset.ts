import { DEFAULT_SOURCE_OFFSET, offsetFromFileName, parseOffset } from './onboarding-parse';

/**
 * Which UTC offset the export's wall-clock times are in: an explicit choice
 * wins, else the default (+07:00 WIB). A `+08_00`-style suffix in the file name
 * is the CRM's export timestamp zone, not the data's, so it is only reported
 * back (`fileNameOffset`) and never applied: applying it would shift every
 * event by an hour and break the duplicate check against rows stored at WIB.
 */
export function resolveUploadOffset(explicit: string | null | undefined, fileName: string): { offset: string; from: 'explicit' | 'default'; fileNameOffset: string | null } | { error: string } {
  const fileNameOffset = offsetFromFileName(fileName);
  if (explicit) {
    const minutes = parseOffset(explicit);
    if (minutes === null) return { error: `"${explicit}" is not a valid UTC offset (use e.g. +07:00)` };
    const sign = minutes < 0 ? '-' : '+';
    const abs = Math.abs(minutes);
    return { offset: `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`, from: 'explicit', fileNameOffset };
  }
  return { offset: DEFAULT_SOURCE_OFFSET, from: 'default', fileNameOffset };
}
