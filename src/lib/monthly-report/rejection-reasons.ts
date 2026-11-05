/**
 * KYC rejection reasons from user_approved.Remark, mapped to the staff reject
 * guide categories (WNI / WNA). Rejected Reason is almost always empty in the
 * live Metabase export — Remark is the source of truth (Bayu 2026-11-05).
 *
 * Robot vs Staff. Robot (unchanged): Approver matches /robot|system/i, Approval
 * Method is Auto, Steps starts with auto_, OR Remark is a machine diagnostic
 * (Ekyc Status / Speech Script / HasSameIdentity / Face consistency /
 * isFirstAccount / livenessAuth). Deposit Robot video-verify failures stay
 * under Robot. Deposit Robot is still skipped for the Approver ranking only.
 *
 * Staff (Bayu 2026-11-05) only when ALL of: rejection row, Approver non-blank,
 * Approval Method /^manual$/i, Steps /^manual_kyc$/i, and Remark is human
 * language. manual_video_verify, auto_*, and machine Remarks (Ekyc, E-Kyc,
 * Speech Script Matching, HasSameIdentity, Face consistency, isFirstAccount,
 * livenessAuth, occupation:, openingPurpose:, fundSource:, isDemoTrade:) are
 * not Staff. A row that is neither Robot nor Staff is omitted from reason totals.
 * When a row matches both, Robot wins.
 */
import type { UserApprovedRow } from './user-approved-parse';

export type RejectSource = 'robot' | 'staff';

export interface GuideCategory {
  id: string;
  label: string;
  /** Fixed wording prefixes / phrases used for matching (uppercase). */
  templates: string[];
  /** Extra keywords/phrases that map to this category. */
  keywords?: string[];
}

/** Categories from the reject-reasons user guide (WNI + WNA), embedded so the xlsx stays off the repo. */
export const GUIDE_CATEGORIES: GuideCategory[] = [
  {
    id: 'ktp', label: 'KTP',
    templates: ['MOHON UNGGAH FOTO KTP ASLI'],
    keywords: ['FOTO KTP', 'UNGGAH KTP', 'KTP ASLI'],
  },
  {
    id: 'passport', label: 'Passport',
    templates: ['PLEASE SELECT PASSPORT', 'PLEASE UPLOAD A CLEAR, VALID, AND COMPLETE PHOTO OF YOUR ORIGINAL PASSPORT'],
    keywords: ['PASSPORT'],
  },
  {
    id: 'selfie', label: 'Selfie',
    templates: ['MOHON UNGGAH FOTO SELFIE'],
    keywords: ['FOTO SELFIE', 'SELFIE'],
  },
  {
    id: 'proof_of_address', label: 'Proof of Address',
    templates: ['PLEASE UPLOAD AN OFFICIAL DOCUMENT THAT SHOWS YOUR RESIDENTIAL ADDRESS'],
    keywords: ['PROOF OF ADDRESS', 'RESIDENTIAL ADDRESS'],
  },
  {
    id: 'data_diri', label: 'Personal Information',
    templates: ['MOHON LENGKAPI INFORMASI DATA DIRI', 'MOHON ISI SELURUH DETAIL ALAMAT'],
    keywords: ['DATA DIRI', 'DETAIL ALAMAT', 'ALAMAT TEMPAT TINGGAL', 'PENDIDIKAN TERAKHIR', 'IBU KANDUNG', 'PLEASE COMPLETE YOUR PERSONAL INFORMATION'],
  },
  {
    id: 'pekerjaan', label: 'Employment Information',
    templates: ['MOHON LENGKAPI INFORMASI PEKERJAAN', 'PERBAIKI DATA PEKERJAAN'],
    keywords: ['DATA PEKERJAAN', 'OCCUPATION', 'NAMA PERUSAHAAN', 'PLEASE COMPLETE YOUR EMPLOYMENT'],
  },
  {
    id: 'contact_person', label: 'Contact Person Information',
    templates: ['MOHON LENGKAPI INFORMASI KONTAK DARURAT', 'MOHON LENGKAPI INFORMASI CONTACT PERSON'],
    keywords: ['KONTAK DARURAT', 'CONTACT PERSON', 'EMERGENCY CONTACT'],
  },
  {
    id: 'sumber_dana', label: 'Financial Information',
    templates: ['MOHON LENGKAPI DATA SUMBER DANA', 'ANNUAL INCOME'],
    keywords: ['SUMBER DANA', 'ANNUAL INCOME', 'PENDAPATAN TAHUNAN', 'SOURCE OF FUNDS', 'FINANCIAL INFORMATION'],
  },
  {
    id: 'rekening_bank', label: 'Bank Account Information',
    templates: ['MOHON LENGKAPI INFORMASI REKENING BANK', 'PLEASE PROVIDE A VALID BANK ACCOUNT'],
    keywords: ['REKENING BANK', 'BANK ACCOUNT', 'ADD BANK'],
  },
  {
    id: 'pengalaman_investasi', label: 'Investment Experience Information',
    templates: ['MOHON LENGKAPI INFORMASI PENGALAMAN TRADING', 'PLEASE COMPLETE YOUR TRADING EXPERIENCE'],
    keywords: ['PENGALAMAN TRADING', 'PENGALAMAN INVESTASI', 'OPENING PURPOSE', 'INVESTMENT EXPERIENCE'],
  },
  {
    id: 'duplicate_account', label: 'Duplicate Account',
    templates: ['ANDA SUDAH PERNAH MENDAFTAR'],
    keywords: ['DUPLICATE ACCOUNT', 'SUDAH PERNAH MENDAFTAR', 'HASSAMEIDENTITY:1'],
  },
  {
    id: 'forbidden_occupation', label: 'Forbidden Occupation',
    templates: ['MOHON MAAF SAAT INI KAMI TIDAK BISA MENERIMA ANDA MENJADI NASABAH'],
    keywords: ['FORBIDEN OCCUPATION', 'FORBIDDEN OCCUPATION', 'TIDAK BISA MENERIMA ANDA'],
  },
  {
    id: 'restricted_country', label: 'Restricted Country',
    templates: ['WE APOLOGIZE, WE ARE UNABLE TO ACCEPT YOU AS OUR CLIENT'],
    keywords: ['RESTRICTED COUNTRY'],
  },
  {
    id: 'demo_account', label: 'Demo Account',
    templates: ['AKUN DEMO BELUM DITRANSAKSIKAN', 'MOHON TRANSAKSIKAN AKUN DEMO', 'DATA COMPLETED. DEMO ACCOUNT HAS NO TRANSACTION YET'],
    keywords: ['AKUN DEMO', 'DEMO ACCOUNT', 'TRANSAKSIKAN AKUN DEMO', 'DEMO NOT YET', 'ISDEMOTRADE:FALSE'],
  },
  {
    id: 'video_verifikasi', label: 'Video Verification',
    templates: ['MOHON PERBAIKI VIDEO VERIFIKASI', 'MOHON UPLOAD ULANG VIDEO VERIFIKASI'],
    keywords: ['VIDEO VERIFIKASI', 'VIDEO VERIFICATION', 'SPEECH SCRIPT MATCHING', 'FACE CONSISTENCY'],
  },
  {
    id: 'video_under_age', label: 'Video Verification - Under Age',
    templates: [],
    keywords: ['UNDER AGE', 'UNDERAGE', 'USIA DI BAWAH'],
  },
];

export const OTHER_CATEGORY_ID = 'other';
export const OTHER_CATEGORY_LABEL = 'Other';

/** Normalize for matching: uppercase, collapse whitespace, strip numbering prefixes. */
export function normalizeRemark(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[：]/g, ':')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/** Split a multi-reason Remark into segments (numbered list / newlines). */
export function splitRemarkSegments(remark: string): string[] {
  const trimmed = remark.replace(/\r\n/g, '\n').trim();
  if (!trimmed) return [];
  const byLine = trimmed.split(/\n+/).map(line => line.replace(/^\s*\d+[\.\)\-]\s*/, '').trim()).filter(Boolean);
  if (byLine.length > 1) return byLine;
  // Single line with "1. … 2. …" inline
  const inline = trimmed.split(/\s*\d+[\.\)\-]\s+/).map(s => s.trim()).filter(Boolean);
  if (inline.length > 1) return inline;
  return [trimmed];
}

function scoreCategory(normalizedSegment: string, category: GuideCategory): number {
  let score = 0;
  for (const template of category.templates) {
    const t = normalizeRemark(template);
    if (!t) continue;
    if (normalizedSegment.startsWith(t.slice(0, Math.min(40, t.length)))) score = Math.max(score, 100);
    else if (normalizedSegment.includes(t.slice(0, Math.min(28, t.length)))) score = Math.max(score, 80);
  }
  for (const keyword of category.keywords ?? []) {
    const k = normalizeRemark(keyword);
    if (k && normalizedSegment.includes(k)) score = Math.max(score, 50 + Math.min(20, k.length));
  }
  return score;
}

export interface MappedReason {
  categoryId: string;
  categoryLabel: string;
  matched: boolean;
  /** Raw segment that produced this mapping. */
  raw: string;
}

/** Map one Remark (possibly multi-reason) onto one or more guide categories. */
export function mapRemarkToCategories(remark: string | null | undefined): MappedReason[] {
  const text = (remark ?? '').trim();
  if (!text) return [{ categoryId: OTHER_CATEGORY_ID, categoryLabel: OTHER_CATEGORY_LABEL, matched: false, raw: '' }];
  const segments = splitRemarkSegments(text);
  const found = new Map<string, MappedReason>();
  for (const segment of segments) {
    const normalized = normalizeRemark(segment);
    let best: { cat: GuideCategory; score: number } | null = null;
    for (const cat of GUIDE_CATEGORIES) {
      const score = scoreCategory(normalized, cat);
      if (score > 0 && (!best || score > best.score)) best = { cat, score };
    }
    if (best && best.score >= 50) {
      if (!found.has(best.cat.id)) {
        found.set(best.cat.id, { categoryId: best.cat.id, categoryLabel: best.cat.label, matched: true, raw: segment });
      }
    } else {
      // Keep unmatched segment under Other (dedupe by raw text)
      const key = `other:${normalizeRemark(segment).slice(0, 120)}`;
      if (!found.has(key)) {
        found.set(key, { categoryId: OTHER_CATEGORY_ID, categoryLabel: OTHER_CATEGORY_LABEL, matched: false, raw: segment });
      }
    }
  }
  // Machine flag shortcuts for auto_kyc diagnostics
  const upper = normalizeRemark(text);
  if (/EKYC STATUS:/.test(upper) || /HASSAMEIDENTITY:/.test(upper)) {
    if (/HASSAMEIDENTITY:1/.test(upper)) {
      const cat = GUIDE_CATEGORIES.find(c => c.id === 'duplicate_account')!;
      found.set(cat.id, { categoryId: cat.id, categoryLabel: cat.label, matched: true, raw: text.slice(0, 160) });
    }
    if (/OCCUPATION:TRUE/.test(upper) || /OCCUPATION:FALSE/.test(upper)) {
      // occupation:True in these dumps means "occupation problem flagged"
      if (/OCCUPATION:TRUE/.test(upper)) {
        const cat = GUIDE_CATEGORIES.find(c => c.id === 'pekerjaan')!;
        found.set(cat.id, { categoryId: cat.id, categoryLabel: cat.label, matched: true, raw: 'occupation flag' });
      }
    }
    if (/OPENINGPURPOSE:TRUE/.test(upper) || /OPENINGPURPOSE:FALSE/.test(upper)) {
      if (/OPENINGPURPOSE:TRUE/.test(upper)) {
        const cat = GUIDE_CATEGORIES.find(c => c.id === 'pengalaman_investasi')!;
        found.set(cat.id, { categoryId: cat.id, categoryLabel: cat.label, matched: true, raw: 'openingPurpose flag' });
      }
    }
    if (/FUNDSOURCE:TRUE/.test(upper)) {
      const cat = GUIDE_CATEGORIES.find(c => c.id === 'sumber_dana')!;
      found.set(cat.id, { categoryId: cat.id, categoryLabel: cat.label, matched: true, raw: 'fundSource flag' });
    }
    if (found.size === 0) {
      found.set('other:ekyc', { categoryId: OTHER_CATEGORY_ID, categoryLabel: OTHER_CATEGORY_LABEL, matched: false, raw: text.slice(0, 200) });
    }
  }
  return [...found.values()];
}

/**
 * Robot rule (rejection reasons):
 *  1. Approver matches /robot|system/i (includes "Deposit Robot")
 *  2. OR Approval Method is Auto (case-insensitive)
 *  3. OR Steps starts with auto_
 *  4. OR Remark looks like a machine diagnostic
 */
export function isRobotRejection(row: Pick<UserApprovedRow, 'approver' | 'approvalMethod' | 'step' | 'remark'>): boolean {
  if (/robot|system/i.test(row.approver ?? '')) return true;
  if (/^auto$/i.test((row.approvalMethod ?? '').trim())) return true;
  if (/^auto_/i.test(row.step ?? '')) return true;
  const remark = row.remark ?? '';
  if (/Ekyc Status:|HasSameIdentity:|isFirstAccount:|livenessAuth:|Speech Script Matching|Face consistency/i.test(remark)) return true;
  return false;
}

/**
 * Machine / program Remark language. Broader than the Robot diagnostic check:
 * E-Kyc/EKyc and occupation:/openingPurpose:/fundSource:/isDemoTrade: flags
 * are not staff copy even when the Robot rule does not fire.
 */
const MACHINE_REMARK = /ekyc status|e-?kyc|speech script matching|hassameidentity|face consistency|isfirstaccount|livenessauth|occupation\s*:|openingpurpose\s*:|fundsource\s*:|isdemotrade\s*:/i;

export function isMachineRemark(remark: string | null | undefined): boolean {
  return MACHINE_REMARK.test(remark ?? '');
}

/**
 * Staff only when every inclusion rule holds (Bayu 2026-11-05).
 * Does not itself exclude Robot rows; the report assigns Robot first when both match.
 */
export function isStaffRejection(row: Pick<UserApprovedRow, 'approver' | 'approvalMethod' | 'step' | 'remark' | 'approvedStatus' | 'successStatus'>): boolean {
  if (!isRejectionRow(row)) return false;
  if (!(row.approver ?? '').trim()) return false;
  if (!/^manual$/i.test((row.approvalMethod ?? '').trim())) return false;
  if (!/^manual_kyc$/i.test((row.step ?? '').trim())) return false;
  if (isMachineRemark(row.remark)) return false;
  return true;
}

/** A row counts as a rejection when Approved Status or Success Status is Failed/Rejected. */
export function isRejectionRow(row: Pick<UserApprovedRow, 'approvedStatus' | 'successStatus'>): boolean {
  return /^(failed|rejected)$/i.test(row.approvedStatus ?? '')
    || /^(failed|rejected)$/i.test(row.successStatus ?? '');
}

export interface RejectionReasonStat {
  categoryId: string;
  categoryLabel: string;
  robot: number;
  staff: number;
  total: number;
  /** Sample raw remarks for admins (Other + a few matched). */
  samples: string[];
}

export interface RejectionReasonsReport {
  totalRejected: number;
  robotRejected: number;
  staffRejected: number;
  /** Rows whose Rejected Reason column was non-empty (almost always 0 in live data). */
  rejectedReasonColumnFilled: number;
  /** Rows where Rejected Reason === Remark when both filled. */
  rejectedReasonMatchesRemark: number;
  reasons: RejectionReasonStat[];
  robotRule: string;
}

const ROBOT_RULE_TEXT = 'Robot when Approver matches /robot|system/i, OR Approval Method is Auto, OR Steps starts with auto_, OR Remark looks like a machine diagnostic (Ekyc Status / Speech Script / HasSameIdentity / Face consistency / isFirstAccount / livenessAuth). Deposit Robot video-verify failures are included under Robot. Staff only when all of these hold: the row is Failed or Rejected, Approver is non-blank, Approval Method is Manual, Steps is manual_kyc, and Remark is not machine language (Ekyc Status, E-Kyc/EKyc, Speech Script Matching, HasSameIdentity, Face consistency, isFirstAccount, livenessAuth, occupation:, openingPurpose:, fundSource:, or similar program flags such as isDemoTrade:). manual_video_verify and auto_* are not Staff. Rows that are neither Robot nor Staff are omitted from reason totals.';

function wibDayFromIso(iso: string): string {
  return new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** Attribute rejections by Finished Time (else Create Time), matching the Approver final bucket. */
export function filterRejectionsByFinishedDay(rows: UserApprovedRow[], from: string, to: string): UserApprovedRow[] {
  return rows.filter(row => {
    if (!isRejectionRow(row)) return false;
    const day = wibDayFromIso(row.finishedTime ?? row.createTime);
    return day >= from && day <= to;
  });
}

export function buildRejectionReasonsReport(
  rows: UserApprovedRow[],
  range: { from: string; to: string },
): RejectionReasonsReport {
  const rejected = filterRejectionsByFinishedDay(rows, range.from, range.to);
  const byCategory = new Map<string, RejectionReasonStat>();
  let totalRejected = 0;
  let robotRejected = 0;
  let staffRejected = 0;
  let rejectedReasonColumnFilled = 0;
  let rejectedReasonMatchesRemark = 0;

  const bump = (categoryId: string, categoryLabel: string, source: RejectSource, sample: string) => {
    const key = categoryId === OTHER_CATEGORY_ID ? `${OTHER_CATEGORY_ID}::${normalizeRemark(sample).slice(0, 80)}` : categoryId;
    let row = byCategory.get(key);
    if (!row) {
      row = { categoryId, categoryLabel, robot: 0, staff: 0, total: 0, samples: [] };
      byCategory.set(key, row);
    }
    if (source === 'robot') row.robot += 1; else row.staff += 1;
    row.total += 1;
    if (sample && row.samples.length < 5 && !row.samples.includes(sample)) row.samples.push(sample);
  };

  for (const row of rejected) {
    // Empty Approver = unfinished KYC — never count in rejection reasons.
    if (!(row.approver ?? '').trim()) continue;
    const robot = isRobotRejection(row);
    const staff = isStaffRejection(row);
    // Neither column: manual_video_verify, non-manual methods, machine remarks the Robot rule misses.
    if (!robot && !staff) continue;
    const source: RejectSource = robot ? 'robot' : 'staff';
    totalRejected += 1;
    if (source === 'robot') robotRejected += 1; else staffRejected += 1;
    const remark = (row.remark ?? '').trim();
    const rejCol = (row.rejectedReason ?? '').trim();
    if (rejCol) {
      rejectedReasonColumnFilled += 1;
      if (remark && rejCol === remark) rejectedReasonMatchesRemark += 1;
    }
    // Prefer Remark; fall back to Rejected Reason when Remark empty.
    const text = remark || rejCol;
    const mapped = mapRemarkToCategories(text);
    for (const m of mapped) {
      bump(m.categoryId, m.categoryLabel, source, m.raw || text.slice(0, 200));
    }
  }

  const reasons = [...byCategory.values()].sort((a, b) => b.total - a.total || a.categoryLabel.localeCompare(b.categoryLabel));
  return {
    totalRejected,
    robotRejected,
    staffRejected,
    rejectedReasonColumnFilled,
    rejectedReasonMatchesRemark,
    reasons,
    robotRule: ROBOT_RULE_TEXT,
  };
}
