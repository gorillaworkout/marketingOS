import { v4 as uuidv4 } from 'uuid';
import { queryAll } from '@/lib/database';
import { createAccessTokenProvider, createGscClient, loadServiceAccountKey, SeoConfigError } from './gsc-client';
import { postgresSeoSyncStore } from './gsc-store';
import { runSeoSync, type RunSeoSyncOptions, type SeoSyncResult } from './gsc-sync';

/** Production wiring: service account from GSC_SA_KEY_PATH, PostgreSQL store. */
export async function runSeoSyncForSite(options: RunSeoSyncOptions): Promise<SeoSyncResult> {
  return runSeoSync(options, {
    store: postgresSeoSyncStore,
    newId: uuidv4,
    createClient: async () => {
      const key = await loadServiceAccountKey();
      return createGscClient(createAccessTokenProvider(key), { serviceAccountEmail: key.clientEmail });
    },
  });
}

/** Safe-to-show service account status for admins: never returns key material or the path. */
export async function serviceAccountStatus(): Promise<{ configured: boolean; email: string | null; error: string | null }> {
  try {
    const key = await loadServiceAccountKey();
    return { configured: true, email: key.clientEmail, error: null };
  } catch (error) {
    return { configured: false, email: null, error: error instanceof SeoConfigError ? error.message : 'Unable to read the service account key.' };
  }
}

/** Active sites that have a GSC property, in dashboard order. */
export async function syncableSiteIds(): Promise<string[]> {
  const rows = await queryAll<{ id: string }>('SELECT id FROM seo_sites WHERE active = TRUE AND gsc_property IS NOT NULL ORDER BY created_at, id', []);
  return rows.map(row => row.id);
}
