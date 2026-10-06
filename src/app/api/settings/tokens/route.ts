import { NextRequest } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { handleSettingsTokens, postgresSyncDeps, type SyncHandlerDeps } from '@/lib/memory-sync';

function settingsDeps(request: NextRequest): SyncHandlerDeps {
  return {
    ...postgresSyncDeps(),
    authorize: () => requireFeature(request, 'ai-research'),
  };
}

export async function GET(request: NextRequest) {
  return handleSettingsTokens(request, settingsDeps(request));
}

export async function POST(request: NextRequest) {
  return handleSettingsTokens(request, settingsDeps(request));
}
