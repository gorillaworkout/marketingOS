import { queryAll } from '@/lib/database';

export interface SeoSiteRow {
  id: string;
  name: string;
  site_url: string;
  gsc_property: string | null;
  active: boolean;
  last_synced_at: string | null;
}

export type SeoConnectionStatus = 'not-configured' | 'missing-key' | 'never-synced' | 'connected';

/** Active sites first (oldest first), so the first row is the dashboard default. */
export async function listSeoSites(): Promise<SeoSiteRow[]> {
  return queryAll<SeoSiteRow & Record<string, unknown>>(
    'SELECT id, name, site_url, gsc_property, active, last_synced_at FROM seo_sites ORDER BY active DESC, created_at, id',
    [],
  );
}

export function connectionStatus(site: Pick<SeoSiteRow, 'gsc_property' | 'last_synced_at'>, keyConfigured: boolean): SeoConnectionStatus {
  if (!site.gsc_property) return 'not-configured';
  if (!keyConfigured) return 'missing-key';
  return site.last_synced_at ? 'connected' : 'never-synced';
}

export function defaultSiteId(sites: Array<Pick<SeoSiteRow, 'id' | 'active'>>): string | null {
  return sites.find(site => site.active)?.id ?? null;
}
