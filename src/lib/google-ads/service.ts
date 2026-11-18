import { v4 as uuidv4 } from 'uuid';
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

/** Safe-to-show configuration status: key names only, never values. */
export function googleAdsConfigStatus(): { configured: boolean; missing: string[]; invalid: string[]; requiredKeys: readonly string[] } {
  const status = readGoogleAdsConfig();
  return status.configured
    ? { configured: true, missing: [], invalid: [], requiredKeys: GOOGLE_ADS_REQUIRED_ENV_KEYS }
    : { configured: false, missing: status.missing, invalid: status.invalid, requiredKeys: GOOGLE_ADS_REQUIRED_ENV_KEYS };
}
