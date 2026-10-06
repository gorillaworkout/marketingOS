import { NextRequest } from 'next/server';
import { handleSyncImport, postgresSyncDeps } from '@/lib/memory-sync';

export async function POST(request: NextRequest) {
  return handleSyncImport(request, postgresSyncDeps());
}
