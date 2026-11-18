import { v4 as uuidv4 } from 'uuid';
import { evaluateGoogleAdsAlerts, type AlertEvaluation } from './alerts';
import { createGoogleAdsClient } from './client';
import { readGoogleAdsConfig, requireGoogleAdsConfig, secretValues, GOOGLE_ADS_REQUIRED_ENV_KEYS } from './config';
import { postgresGoogleAdsSyncStore } from './store';
import { runGoogleAdsSync, type GoogleAdsSyncResult, type RunGoogleAdsSyncOptions } from './sync';

/** Production wiring: credentials from the server env, PostgreSQL store. */
export async function runGoogleAdsSyncNow(options: RunGoogleAdsSyncOptions): Promise<GoogleAdsSyncResult> {
  return runGoogleAdsSync({ pauseMs: 150, ...options }, {
    store: postgresGoogleAdsSyncStore,
    newId: uuidv4,
    createClient: async () => {
      const config = requireGoogleAdsConfig();
      return { client: createGoogleAdsClient(config), loginCustomerId: config.loginCustomerId, extraCustomerIds: config.customerIds, secrets: secretValues(config) };
    },
  });
}

/**
 * After a sync that stored data (succeeded or partial), recompute alerts from
 * the synced tables. Alert errors never fail the sync; they are returned.
 */
export async function evaluateAlertsAfterSync(result: GoogleAdsSyncResult): Promise<{ evaluation: AlertEvaluation | null; error: string | null }> {
  if (result.status !== 'succeeded' && result.status !== 'partial') return { evaluation: null, error: null };
  try {
    return { evaluation: await evaluateGoogleAdsAlerts(), error: null };
  } catch (error) {
    return { evaluation: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Safe-to-show configuration status: key names only, never values. */
export function googleAdsConfigStatus(): { configured: boolean; missing: string[]; invalid: string[]; requiredKeys: readonly string[] } {
  const status = readGoogleAdsConfig();
  return status.configured
    ? { configured: true, missing: [], invalid: [], requiredKeys: GOOGLE_ADS_REQUIRED_ENV_KEYS }
    : { configured: false, missing: status.missing, invalid: status.invalid, requiredKeys: GOOGLE_ADS_REQUIRED_ENV_KEYS };
}
