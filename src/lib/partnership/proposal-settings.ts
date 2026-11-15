/**
 * Admin-editable proposal settings: the rate card, offline materials, and the
 * "Dupoin by Numbers" figures. Defaults are copied exactly from the approved
 * Tadakado (16:9) and Kopi Kenangan (A4) proposals; nothing here is invented.
 * An admin can change them on Proposal Builder > Settings. Saved values live in
 * partnership_settings (key 'proposal').
 *
 * Safe to import from the browser.
 */

export interface RateCardItem {
  id: string;
  content: string;
  /** `{partner}` is replaced with the partner name. */
  platform: string;
  quantityLabel: string;
  /** Rupiah value of one unit of this package, as on the rate card. */
  value: number;
}

export interface OfflineMaterial {
  id: string;
  material: string;
  content: string;
  /** `{partner}` is replaced with the partner name. */
  placement: string;
  quantity: number;
}

export interface LabelValue { label: string; value: string }
export interface SnapshotCell { value: string; label: string; caption: string }
export interface Snapshot { year: string; title: string; cells: SnapshotCell[] }

export interface ProposalSettings {
  rateCard: RateCardItem[];
  offlineMaterials: OfflineMaterial[];
  snapshots: Snapshot[];
  activeUsers: LabelValue[];
  activeUsersNote: string;
  tradedLots: LabelValue[];
  tradedLotsNote: string;
  ageDistribution: LabelValue[];
  occupation: LabelValue[];
  demographicsNote: string;
  marketHeadline: string;
  marketRegions: LabelValue[];
  productCount: string;
  productLabel: string;
  productCategories: string[];
  instagramHandle: string;
  instagramUrl: string;
  instagramStats: LabelValue[];
  websiteDomain: string;
  websiteUrl: string;
  websiteStats: LabelValue[];
}

export const DEFAULT_PROPOSAL_SETTINGS: ProposalSettings = {
  rateCard: [
    { id: 'ig-feed-collab', content: 'Poster collaboration activity', platform: 'Instagram feed (collab)', quantityLabel: '1x', value: 3_000_000 },
    { id: 'ig-story', content: 'Promotion activity', platform: 'Instagram story (Dupoin & {partner})', quantityLabel: '2x/week (3 slides story)', value: 12_000_000 },
    { id: 'article', content: 'Collaboration article', platform: 'Dupoin Website', quantityLabel: '1x', value: 7_000_000 },
    { id: 'media-coverage', content: 'Media coverage', platform: 'Publishers (guarantee 2-3 media)', quantityLabel: '3x', value: 6_000_000 },
    { id: 'home-banner', content: 'Clickable Home banner (Apps & website)', platform: 'Dupoin Indonesia & {partner}', quantityLabel: '1 each', value: 50_000_000 },
  ],
  offlineMaterials: [
    { id: 'x-banner', material: 'X-Banner (60x160cm)', content: 'Collaboration info', placement: '{partner} offline store', quantity: 1 },
    { id: 'tent-card', material: 'Tent Card (A5)', content: 'QR code download Dupoin Apps', placement: 'at cashier desk', quantity: 1 },
  ],
  snapshots: [
    {
      year: '2025',
      title: 'Business Snapshot',
      cells: [
        { value: '#1', label: 'Top Broker Performance', caption: 'Broker Ranking (JFX)' },
        { value: '1,272,382', label: '', caption: 'Trading Volume' },
        { value: '4,113', label: '', caption: 'Monthly Active Users (MAU)' },
      ],
    },
    {
      year: '2026',
      title: 'Business Snapshot',
      cells: [
        { value: '#1', label: 'Futures Broker by Highest Transaction Volume & Bilateral Volume', caption: 'Broker Ranking (JFX & KBI)' },
        { value: '833.224,67', label: '', caption: 'Trading Volume (H1 2026)' },
        { value: '5979', label: '', caption: 'Avg. Monthly Active Users (Period: January-June 2026)' },
      ],
    },
  ],
  activeUsers: [
    { label: '2021', value: '695' },
    { label: '2022', value: '2K' },
    { label: '2023', value: '3K' },
    { label: '2024', value: '6K' },
    { label: '2025', value: '15K' },
  ],
  activeUsersNote:
    'Our growth trajectory highlights a significant upward trend, with active users reaching 15K in 2025. This rapid scaling reflects strong market confidence and a consistently expanding community of active traders.',
  tradedLots: [
    { label: '2021', value: '34K' },
    { label: '2022', value: '151K' },
    { label: '2023', value: '464K' },
    { label: '2024', value: '604K' },
    { label: '2025', value: '1,272M' },
  ],
  tradedLotsNote:
    'Our transaction volume showcases a powerful growth trend, surging to 1.27M in 2025. This 37x increase underscores Dupoin capability to facilitate large-scale, high-frequency trading.',
  ageDistribution: [
    { label: '15-25 years', value: '23.80%' },
    { label: '26-35 years', value: '37.90%' },
    { label: '36-45 years', value: '21.60%' },
    { label: '46-55 years', value: '9.40%' },
    { label: '56-65 years', value: '5.70%' },
    { label: '65+ years', value: '1.60%' },
  ],
  occupation: [
    { label: 'Private Employee', value: '42.30%' },
    { label: 'Student', value: '23.50%' },
    { label: 'Entrepreneur / Business Owner', value: '14.70%' },
    { label: 'Freelancer / Self-employed', value: '10.80%' },
    { label: 'Civil Servant (Government Employee)', value: '4.60%' },
    { label: 'Others', value: '4.10%' },
  ],
  demographicsNote: '38% of our users are Millenials (24-34 years old) and 43% of them are working in Private Employee.',
  marketHeadline: "Over 40% user concentration in Jakarta and West Java, Dupoin commands a powerful presence in the nation's primary financial hubs.",
  marketRegions: [
    { label: 'DKI Jakarta', value: '21.40%' },
    { label: 'West Java', value: '19.10%' },
    { label: 'Central Java', value: '13.80%' },
    { label: 'East Java', value: '10.60%' },
    { label: 'Bali', value: '6.90%' },
    { label: 'Banten', value: '4.50%' },
    { label: 'North Sumatra', value: '4.20%' },
    { label: 'Yogyakarta', value: '3.80%' },
    { label: 'East Kalimantan', value: '3.10%' },
    { label: 'South Sulawesi', value: '2.80%' },
    { label: 'Others', value: '9.80%' },
  ],
  productCount: '70+',
  productLabel: 'Instruments',
  productCategories: ['Forex', 'Metals', 'Futures', 'Stocks'],
  instagramHandle: '@dupoin.indonesia',
  instagramUrl: 'https://www.instagram.com/dupoin.indonesia/',
  instagramStats: [
    { label: 'Followers', value: '17.1 K' },
    { label: 'Monthly Reach', value: '900K' },
    { label: 'Audience', value: '65% Male, 35% Female' },
    { label: 'Age', value: '18-24 (22%), 25-34 (48%), 35-44 (22%), 45+ (8%)' },
  ],
  websiteDomain: 'www.dupoin.co.id',
  websiteUrl: 'https://www.dupoin.co.id/',
  websiteStats: [
    { label: 'Total Visits', value: '559.384' },
    { label: 'Monthly Visit', value: '200.000+' },
    { label: 'Device Distribution', value: 'Desktop 18%, Mobile Web 81%' },
    { label: 'Gender Distribution', value: 'Male (71%), Female (28%)' },
    { label: 'Age Distribution', value: '18-24 (13%), 25-34 (38%), 35-44 (16%), 45-54 (15%), 55-64 (10%), 65+ (4%)' },
  ],
};

const MAX_ROWS = 40;
const text = (value: unknown, max = 300) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

function labelValues(raw: unknown, fallback: LabelValue[]): LabelValue[] {
  if (!Array.isArray(raw)) return fallback;
  return raw.slice(0, MAX_ROWS).map(row => ({ label: text((row as LabelValue)?.label, 120), value: text((row as LabelValue)?.value, 200) }))
    .filter(row => row.label || row.value);
}

function money(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /\d/.test(value) ? Number(value.replace(/[^\d]/g, '')) : NaN;
  if (!Number.isFinite(number) || number < 0 || number > 1e13) return null;
  return Math.round(number);
}

/**
 * Validates a settings object from the admin editor (or the database) and
 * fills any missing part from the defaults. Returns errors for bad rate card
 * rows instead of silently dropping prices.
 */
export function parseProposalSettings(raw: unknown): { value: ProposalSettings } | { error: string } {
  if (!raw || typeof raw !== 'object') return { value: DEFAULT_PROPOSAL_SETTINGS };
  const input = raw as Partial<Record<keyof ProposalSettings, unknown>>;
  const d = DEFAULT_PROPOSAL_SETTINGS;

  let rateCard = d.rateCard;
  if (Array.isArray(input.rateCard)) {
    rateCard = [];
    const seen = new Set<string>();
    for (const row of input.rateCard.slice(0, MAX_ROWS)) {
      const item = row as Partial<RateCardItem>;
      const content = text(item?.content, 120);
      if (!content) return { error: 'Every rate card row needs a content name.' };
      const value = money(item?.value);
      if (value === null) return { error: `Rate card "${content}" needs a valid Rupiah value.` };
      let id = text(item?.id, 40) || slug(content) || `item-${rateCard.length + 1}`;
      while (seen.has(id)) id = `${id}-${rateCard.length + 1}`;
      seen.add(id);
      rateCard.push({ id, content, platform: text(item?.platform, 160), quantityLabel: text(item?.quantityLabel, 80) || '1x', value });
    }
  }

  let offlineMaterials = d.offlineMaterials;
  if (Array.isArray(input.offlineMaterials)) {
    offlineMaterials = [];
    const seen = new Set<string>();
    for (const row of input.offlineMaterials.slice(0, MAX_ROWS)) {
      const item = row as Partial<OfflineMaterial>;
      const material = text(item?.material, 120);
      if (!material) return { error: 'Every offline material needs a name.' };
      let id = text(item?.id, 40) || slug(material) || `material-${offlineMaterials.length + 1}`;
      while (seen.has(id)) id = `${id}-${offlineMaterials.length + 1}`;
      seen.add(id);
      const quantity = Math.max(1, Math.min(10_000, Math.round(Number(item?.quantity) || 1)));
      offlineMaterials.push({ id, material, content: text(item?.content, 160), placement: text(item?.placement, 160), quantity });
    }
  }

  const snapshots = Array.isArray(input.snapshots)
    ? input.snapshots.slice(0, 4).map(raw => {
      const snapshot = raw as Partial<Snapshot>;
      return {
        year: text(snapshot?.year, 20),
        title: text(snapshot?.title, 80),
        cells: Array.isArray(snapshot?.cells)
          ? snapshot.cells.slice(0, 4).map(cell => ({ value: text(cell?.value, 40), label: text(cell?.label, 120), caption: text(cell?.caption, 120) }))
          : [],
      };
    })
    : d.snapshots;

  const categories = Array.isArray(input.productCategories)
    ? input.productCategories.map(value => text(value, 40)).filter(Boolean).slice(0, 8)
    : d.productCategories;

  const url = (value: unknown, fallback: string) => {
    if (value === undefined) return fallback;
    const candidate = text(value, 300);
    if (!candidate) return '';
    return /^https:\/\/[^\s]+$/i.test(candidate) ? candidate : fallback;
  };

  return {
    value: {
      rateCard,
      offlineMaterials,
      snapshots,
      activeUsers: labelValues(input.activeUsers, d.activeUsers),
      activeUsersNote: input.activeUsersNote === undefined ? d.activeUsersNote : text(input.activeUsersNote, 600),
      tradedLots: labelValues(input.tradedLots, d.tradedLots),
      tradedLotsNote: input.tradedLotsNote === undefined ? d.tradedLotsNote : text(input.tradedLotsNote, 600),
      ageDistribution: labelValues(input.ageDistribution, d.ageDistribution),
      occupation: labelValues(input.occupation, d.occupation),
      demographicsNote: input.demographicsNote === undefined ? d.demographicsNote : text(input.demographicsNote, 600),
      marketHeadline: input.marketHeadline === undefined ? d.marketHeadline : text(input.marketHeadline, 600),
      marketRegions: labelValues(input.marketRegions, d.marketRegions),
      productCount: input.productCount === undefined ? d.productCount : text(input.productCount, 20),
      productLabel: input.productLabel === undefined ? d.productLabel : text(input.productLabel, 40),
      productCategories: categories,
      instagramHandle: input.instagramHandle === undefined ? d.instagramHandle : text(input.instagramHandle, 80),
      instagramUrl: url(input.instagramUrl, d.instagramUrl),
      instagramStats: labelValues(input.instagramStats, d.instagramStats),
      websiteDomain: input.websiteDomain === undefined ? d.websiteDomain : text(input.websiteDomain, 80),
      websiteUrl: url(input.websiteUrl, d.websiteUrl),
      websiteStats: labelValues(input.websiteStats, d.websiteStats),
    },
  };
}

/** Settings from the database, falling back to the defaults if the row is missing or broken. */
export function settingsOrDefault(raw: unknown): ProposalSettings {
  const parsed = parseProposalSettings(raw);
  return 'value' in parsed ? parsed.value : DEFAULT_PROPOSAL_SETTINGS;
}
