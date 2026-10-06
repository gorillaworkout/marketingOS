import { NextRequest } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { handleSettingsToken, postgresSyncDeps, type SyncHandlerDeps } from '@/lib/memory-sync';

type RouteContext = { params: Promise<{ id: string }> };

function settingsDeps(request: NextRequest): SyncHandlerDeps {
  return {
    ...postgresSyncDeps(),
    authorize: () => requireFeature(request, 'ai-research'),
  };
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return handleSettingsToken(request, id, settingsDeps(request));
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return handleSettingsToken(request, id, settingsDeps(request));
}
