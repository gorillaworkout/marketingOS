import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedUser, type AuthorizedUser } from './auth';
import { canManageInternalDocs, type InternalDocsPrincipal } from './internal-docs-acl';

export function principalFromUser(user: AuthorizedUser): InternalDocsPrincipal {
  return { role: user.role, departmentName: user.departmentName };
}

export async function requireInternalDocsUser(request: NextRequest): Promise<
  { user: AuthorizedUser; principal: InternalDocsPrincipal } | NextResponse
> {
  const user = await getAuthorizedUser(request);
  if ('error' in user) return NextResponse.json({ error: user.error }, { status: user.status });
  return { user, principal: principalFromUser(user) };
}

export async function requireInternalDocsManager(request: NextRequest): Promise<
  { user: AuthorizedUser; principal: InternalDocsPrincipal } | NextResponse
> {
  const actor = await requireInternalDocsUser(request);
  if (actor instanceof NextResponse) return actor;
  if (!canManageInternalDocs(actor.principal)) {
    return NextResponse.json({ error: 'Forbidden: only IT and admins can manage internal documents' }, { status: 403 });
  }
  return actor;
}
