/** A brand guideline row the Social Post picker can show. */
export type SocialPostBrandGuideline = {
  id: string;
  brand_name: string;
};

const DUPOIN_FUTURES_BRAND_NAME = 'dupoin futures';

/**
 * Default picker value.
 * Prefer a guideline named "Dupoin Futures" (case-insensitive). Otherwise the first row. Otherwise none.
 */
export function defaultSocialPostBrandGuidelineId(
  guidelines: readonly Pick<SocialPostBrandGuideline, 'id' | 'brand_name'>[],
): string {
  if (guidelines.length === 0) return '';
  const dupoin = guidelines.find(
    (guideline) => guideline.brand_name.trim().toLowerCase() === DUPOIN_FUTURES_BRAND_NAME,
  );
  return (dupoin ?? guidelines[0]).id;
}

/** Keep usable `{ id, brand_name }` rows from `GET /api/brand-guidelines`, in response order. */
export function readSocialPostBrandGuidelines(payload: unknown): SocialPostBrandGuideline[] {
  if (!payload || typeof payload !== 'object') return [];
  const raw = (payload as { guidelines?: unknown }).guidelines;
  if (!Array.isArray(raw)) return [];

  const guidelines: SocialPostBrandGuideline[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = (item as { id?: unknown }).id;
    const brandName = (item as { brand_name?: unknown }).brand_name;
    if (typeof id !== 'string' || !id.trim()) continue;
    if (typeof brandName !== 'string' || !brandName.trim()) continue;
    guidelines.push({ id, brand_name: brandName });
  }
  return guidelines;
}

export type SocialPostGenerateFields = {
  brief: string;
  platform: string;
  targetAudience: string;
  goal: string;
  brandGuidelineId?: string | null;
};

/** Caption-generation body. Omits `brandGuidelineId` when the picker is None. */
export function socialPostGenerateRequestBody(fields: SocialPostGenerateFields): {
  brief: string;
  platform: string;
  targetAudience: string;
  goal: string;
  brandGuidelineId?: string;
} {
  const body: {
    brief: string;
    platform: string;
    targetAudience: string;
    goal: string;
    brandGuidelineId?: string;
  } = {
    brief: fields.brief,
    platform: fields.platform,
    targetAudience: fields.targetAudience,
    goal: fields.goal,
  };
  const brandGuidelineId = fields.brandGuidelineId?.trim();
  if (brandGuidelineId) body.brandGuidelineId = brandGuidelineId;
  return body;
}
