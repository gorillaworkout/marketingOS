import type { CsStatus } from './fields';

/**
 * Leave status from the fill colour of an agent name cell.
 * Legend in the workbook: "Red : Sick Leave", "Yellow : Annual Leave". Real files use
 * several shades (F4CCCC, FF0000, EA4335, F54A45, pink FDDDEF; yellow FFF2CC, FAF1D1),
 * so the colour is classified by hue instead of an exact match.
 * White, near-grey, missing or theme-only fills are treated as Present.
 */
export function statusFromFill(argb: string | null | undefined): CsStatus {
  if (!argb || typeof argb !== 'string') return 'present';
  const hex = argb.trim().replace(/^#/, '');
  if (!/^([0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return 'present';
  const rgb = hex.length === 8 ? hex.slice(2) : hex;
  if (hex.length === 8 && hex.slice(0, 2) === '00' && rgb === '000000') return 'present';
  const r = parseInt(rgb.slice(0, 2), 16) / 255;
  const g = parseInt(rgb.slice(2, 4), 16) / 255;
  const b = parseInt(rgb.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  // Unsaturated (white, grey, black): no leave.
  if (delta < 0.08 || max === 0) return 'present';
  let hue: number;
  if (max === r) hue = 60 * (((g - b) / delta) % 6);
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);
  if (hue < 0) hue += 360;
  if (hue >= 300 || hue < 22) return 'sick';
  if (hue >= 22 && hue < 75) return 'annual_leave';
  return 'present';
}

export const LEAVE_FILLS: Record<Exclude<CsStatus, 'present'>, string> = { sick: 'FFF4CCCC', annual_leave: 'FFFFF2CC' };
