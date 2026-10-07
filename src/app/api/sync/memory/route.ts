import { NextRequest } from 'next/server';
import { handleSyncMemory, postgresSyncDeps } from '@/lib/memory-sync';

export async function GET(request: NextRequest) {
  return handleSyncMemory(request, postgresSyncDeps());
}
