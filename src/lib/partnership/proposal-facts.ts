/**
 * Verified Dupoin facts for B2B proposals. These are fixed text, never written
 * by the AI and not editable per proposal. Change them here, in code review.
 *
 * Sources: the Partnership team's approved proposals (Tadakado 16:9 deck and
 * Kopi Kenangan A4 doc) and the verified list confirmed by Marketing on
 * 2026-11-15 (license number, awards, Bappebti rating).
 *
 * Safe to import from the browser.
 */

export type ProposalLanguage = 'id' | 'en';

export interface VerifiedAward {
  title: string;
  year: string;
  by: string;
}

export interface VerifiedFacts {
  companyName: string;
  shortName: string;
  whoWeAreTitle: string;
  aboutParagraph: string;
  aboutParagraphLong: string;
  advantagesTitle: string;
  advantages: string[];
  regulatoryTitle: string;
  supervision: string[];
  memberships: string[];
  regulatoryStatement: string;
  licenseLabel: string;
  licenseNumber: string;
  awards: VerifiedAward[];
  rating: { title: string; years: string; by: string };
}

export const BAPPEBTI_LICENSE = '423/BAPPEBTI/SI/VII/2004';
export const SUPERVISORS = ['BAPPEBTI', 'OJK', 'BI'] as const;
export const MEMBERSHIPS = ['JFX', 'KBI', 'ASPEBTINDO'] as const;

/** Award names stay in English in both languages: they are the issuers' titles. */
export const VERIFIED_AWARDS: readonly VerifiedAward[] = [
  { title: 'Most Trusted Broker', year: '2025', by: 'CNN Indonesia' },
  { title: 'Highest Trading Volume Broker', year: '2025', by: 'CNBC' },
  { title: 'Top Futures Broker', year: '2026', by: 'Bloomberg Technoz' },
  { title: 'Best Growth Trading Platform', year: '2024', by: 'CNBC' },
  { title: 'Biggest Bilateral Trading Volume', year: '2025', by: 'JFX' },
  { title: 'Best Rated Broker', year: '2024', by: 'BAPPEBTI' },
];

const EN: VerifiedFacts = {
  companyName: 'PT Dupoin Futures Indonesia',
  shortName: 'Dupoin Futures Indonesia',
  whoWeAreTitle: 'Who Are We?',
  aboutParagraph:
    'PT Dupoin Futures Indonesia is a licensed Futures Brokerage Company (Pialang Berjangka) operating under the supervision of BAPPEBTI, OJK, and BI. Headquartered in South Jakarta, the Company provides futures and derivatives brokerage services across Indonesia through advanced electronic trading systems.',
  aboutParagraphLong:
    'PT Dupoin Futures Indonesia is a licensed Futures Brokerage Company (Pialang Berjangka) operating under the supervision of BAPPEBTI, OJK, and BI. Headquartered in South Jakarta, the Company provides futures and derivatives brokerage services across Indonesia through advanced electronic trading systems. Over the years, Dupoin has expanded its operational scale, client base, and technology infrastructure to support both multilateral and bilateral (SPA) trading mechanisms, serving retail and professional market participants with secure, reliable, and compliant market access.',
  advantagesTitle: 'Advantages Trading With Us',
  advantages: ['Superior trading platforms', 'Professional tools', 'Best trading ecosystem', 'Dedicated customer service'],
  regulatoryTitle: 'Regulatory Standing & Industry Membership',
  supervision: [...SUPERVISORS],
  memberships: [...MEMBERSHIPS],
  regulatoryStatement:
    'PT Dupoin Futures Indonesia is fully licensed & regulated by Bank Indonesia, BAPPEBTI, and OJK, and is a member of JFX, KBI, and ASPEBTINDO.',
  licenseLabel: 'BAPPEBTI License',
  licenseNumber: BAPPEBTI_LICENSE,
  awards: [...VERIFIED_AWARDS],
  rating: { title: 'A+++ Rating', years: '2023–2025', by: 'Bappebti' },
};

const ID: VerifiedFacts = {
  companyName: 'PT Dupoin Futures Indonesia',
  shortName: 'Dupoin Futures Indonesia',
  whoWeAreTitle: 'Siapa Kami?',
  aboutParagraph:
    'PT Dupoin Futures Indonesia adalah perusahaan Pialang Berjangka berizin yang beroperasi di bawah pengawasan BAPPEBTI, OJK, dan BI. Berkantor pusat di Jakarta Selatan, Perusahaan menyediakan layanan pialang berjangka dan derivatif di seluruh Indonesia melalui sistem perdagangan elektronik yang canggih.',
  aboutParagraphLong:
    'PT Dupoin Futures Indonesia adalah perusahaan Pialang Berjangka berizin yang beroperasi di bawah pengawasan BAPPEBTI, OJK, dan BI. Berkantor pusat di Jakarta Selatan, Perusahaan menyediakan layanan pialang berjangka dan derivatif di seluruh Indonesia melalui sistem perdagangan elektronik yang canggih. Dari tahun ke tahun, Dupoin terus memperluas skala operasional, basis nasabah, dan infrastruktur teknologinya untuk mendukung mekanisme perdagangan multilateral maupun bilateral (SPA), serta melayani pelaku pasar ritel dan profesional dengan akses pasar yang aman, andal, dan patuh regulasi.',
  advantagesTitle: 'Keunggulan Trading Bersama Kami',
  advantages: ['Platform trading unggulan', 'Tools profesional', 'Ekosistem trading terbaik', 'Layanan pelanggan khusus'],
  regulatoryTitle: 'Status Regulasi & Keanggotaan Industri',
  supervision: [...SUPERVISORS],
  memberships: [...MEMBERSHIPS],
  regulatoryStatement:
    'PT Dupoin Futures Indonesia berizin resmi dan diawasi oleh Bank Indonesia, BAPPEBTI, dan OJK, serta merupakan anggota JFX, KBI, dan ASPEBTINDO.',
  licenseLabel: 'Izin BAPPEBTI',
  licenseNumber: BAPPEBTI_LICENSE,
  awards: [...VERIFIED_AWARDS],
  rating: { title: 'Peringkat A+++', years: '2023–2025', by: 'Bappebti' },
};

export function verifiedFacts(language: ProposalLanguage): VerifiedFacts {
  return language === 'en' ? EN : ID;
}
